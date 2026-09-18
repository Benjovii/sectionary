// The crawl queue (SEC-7): one SQLite file, data/queue.sqlite, using the
// SQLite that ships inside Node. No server, no install, survives a crash, and
// can be read by `--report` while a run is going (WAL mode).
//
// Deliberately NOT Postgres: the database is the platform lane's, and the
// capture lane must be able to run with nothing but this repo and a disk.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

export type StoreStatus = 'pending' | 'running' | 'done' | 'partial' | 'failed' | 'skipped';

export type StoreRow = {
  host: string;
  final_host: string | null;
  brand: string | null;
  platform: string | null;
  rank: number | null;
  priority: number;
  status: StoreStatus;
  attempts: number;
  reason: string | null;
  enqueued_at: string;
  started_at: string | null;
  finished_at: string | null;
  pages_total: number;
  pages_ok: number;
  blocks: number;
  ms: number;
  next_try_at: string | null;
  /** JSON array: the pages chosen for this store, so a resume captures the same ones without rediscovering them. */
  plan: string | null;
  bytes: number;
};

export type SeedRow = { host: string; finalHost?: string | null; brand?: string | null; platform?: string | null; rank?: number | null };

export type PageRecord = { url: string; type: string; status: string; reason: string | null; blocks: number; desktopMs: number | null; mobileMs: number | null };

const now = () => new Date().toISOString();

export class Queue {
  private readonly db: DatabaseSync;

  constructor(file: string) {
    mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec(`
      pragma journal_mode = WAL;
      pragma synchronous = NORMAL;
      pragma busy_timeout = 5000;
      create table if not exists stores (
        host text primary key,
        final_host text, brand text, platform text, rank integer,
        priority integer not null default 0,
        status text not null default 'pending',
        attempts integer not null default 0,
        reason text,
        enqueued_at text not null,
        started_at text, finished_at text,
        pages_total integer not null default 0,
        pages_ok integer not null default 0,
        blocks integer not null default 0,
        ms integer not null default 0,
        next_try_at text,
        plan text,
        bytes integer not null default 0
      );
      create table if not exists pages (
        host text not null, url text not null, type text, status text not null, reason text,
        blocks integer not null default 0, desktop_ms integer, mobile_ms integer, captured_at text not null,
        primary key (host, url)
      );
      create index if not exists stores_pick on stores (status, priority, rank);
    `);
    // Queue files made before a column existed get it added; a fresh file already has them all.
    for (const column of ['next_try_at text', 'plan text', 'bytes integer not null default 0']) {
      try {
        this.db.exec(`alter table stores add column ${column}`);
      } catch {
        /* column already there */
      }
    }
  }

  close(): void {
    this.db.close();
  }

  /** Add stores; hosts already in the queue keep their state. */
  enqueue(rows: SeedRow[], priority = 0): { added: number; existing: number } {
    const ins = this.db.prepare(
      `insert into stores (host, final_host, brand, platform, rank, priority, enqueued_at) values (?, ?, ?, ?, ?, ?, ?) on conflict (host) do nothing`,
    );
    let added = 0;
    this.db.exec('begin');
    try {
      for (const r of rows) {
        const res = ins.run(r.host, r.finalHost ?? null, r.brand ?? null, r.platform ?? null, r.rank ?? null, priority, now());
        added += Number(res.changes);
      }
      this.db.exec('commit');
    } catch (e) {
      this.db.exec('rollback');
      throw e;
    }
    return { added, existing: rows.length - added };
  }

  /** After a crash: whatever was mid-flight goes back in line. The interrupted attempt is not counted against the store. */
  resetRunning(): number {
    const res = this.db.prepare(`update stores set status = 'pending', attempts = max(attempts - 1, 0), started_at = null, next_try_at = null where status = 'running'`).run();
    return Number(res.changes);
  }

  /** Next store by priority, then traffic rank; stores cooling off after a failure wait their turn. Synchronous, so two workers in this process can never claim the same row. */
  claim(): StoreRow | null {
    const row = this.db
      .prepare(`select * from stores where status = 'pending' and (next_try_at is null or next_try_at <= ?) order by priority desc, (rank is null), rank asc, host asc limit 1`)
      .get(now()) as StoreRow | undefined;
    if (!row) return null;
    this.db.prepare(`update stores set status = 'running', attempts = attempts + 1, started_at = ?, reason = null where host = ?`).run(now(), row.host);
    return { ...row, status: 'running', attempts: row.attempts + 1 };
  }

  /** How long until the next cooling-off store may be tried again; null when nothing is waiting. */
  nextDueInMs(): number | null {
    const row = this.db.prepare(`select min(next_try_at) t from stores where status = 'pending' and next_try_at is not null`).get() as { t: string | null };
    return row.t ? Math.max(0, Date.parse(row.t) - Date.now()) : null;
  }

  /** Graceful stop: give the store back; the attempt is not counted, the time spent is. */
  release(host: string, ms = 0): void {
    this.db.prepare(`update stores set status = 'pending', attempts = max(attempts - 1, 0), started_at = null, ms = ms + ? where host = ?`).run(ms, host);
  }

  /** A transient failure: try again after a cool-off, unless the attempts are used up. */
  retryOrFail(host: string, reason: string, maxAttempts: number, delayMs = 0): StoreStatus {
    const row = this.db.prepare(`select attempts from stores where host = ?`).get(host) as { attempts: number } | undefined;
    const status: StoreStatus = row && row.attempts < maxAttempts ? 'pending' : 'failed';
    const nextTry = status === 'pending' && delayMs > 0 ? new Date(Date.now() + delayMs).toISOString() : null;
    this.db.prepare(`update stores set status = ?, reason = ?, finished_at = ?, next_try_at = ? where host = ?`).run(status, reason, status === 'failed' ? now() : null, nextTry, host);
    return status;
  }

  /** `ms` is added to what earlier, interrupted attempts already spent, so the average per store stays honest after a resume. */
  finish(host: string, o: { status: StoreStatus; reason: string | null; pagesTotal: number; pagesOk: number; blocks: number; ms: number; bytes?: number }): void {
    this.db
      .prepare(`update stores set status = ?, reason = ?, pages_total = ?, pages_ok = ?, blocks = ?, ms = ms + ?, bytes = ?, finished_at = ? where host = ?`)
      .run(o.status, o.reason, o.pagesTotal, o.pagesOk, o.blocks, o.ms, o.bytes ?? 0, now(), host);
  }

  /** What the browser saw, for stores that came without a platform (hosts added by hand). */
  setPlatform(host: string, platform: string): void {
    this.db.prepare(`update stores set platform = ? where host = ? and (platform is null or platform = '')`).run(platform, host);
  }

  /** Start these stores over: back in line, page records and page list forgotten, so everything is captured afresh. */
  reset(hosts: string[]): number {
    if (!hosts.length) return 0;
    const marks = hosts.map(() => '?').join(', ');
    this.db.prepare(`delete from pages where host in (${marks})`).run(...hosts);
    const res = this.db
      .prepare(
        `update stores set status = 'pending', attempts = 0, reason = null, started_at = null, finished_at = null, next_try_at = null, plan = null,
           pages_total = 0, pages_ok = 0, blocks = 0, ms = 0, bytes = 0 where host in (${marks})`,
      )
      .run(...hosts);
    return Number(res.changes);
  }

  setPlan(host: string, urls: string[]): void {
    this.db.prepare(`update stores set plan = ? where host = ?`).run(JSON.stringify(urls), host);
  }

  recordPage(host: string, p: PageRecord): void {
    this.db
      .prepare(
        `insert into pages (host, url, type, status, reason, blocks, desktop_ms, mobile_ms, captured_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)
         on conflict (host, url) do update set type = excluded.type, status = excluded.status, reason = excluded.reason, blocks = excluded.blocks,
           desktop_ms = excluded.desktop_ms, mobile_ms = excluded.mobile_ms, captured_at = excluded.captured_at`,
      )
      .run(host, p.url, p.type, p.status, p.reason, p.blocks, p.desktopMs, p.mobileMs, now());
  }

  /** A page already captured in full is not captured again when a store is resumed. */
  pageCaptured(host: string, url: string): { blocks: number } | null {
    const row = this.db.prepare(`select blocks from pages where host = ? and url = ? and status = 'captured'`).get(host, url) as { blocks: number } | undefined;
    return row ?? null;
  }

  requeue(statuses: StoreStatus[]): number {
    const marks = statuses.map(() => '?').join(', ');
    const res = this.db.prepare(`update stores set status = 'pending', attempts = 0, reason = null, started_at = null, finished_at = null, next_try_at = null where status in (${marks})`).run(...statuses);
    return Number(res.changes);
  }

  /** Every store the queue knows, in any state. */
  hosts(): string[] {
    return (this.db.prepare(`select host from stores`).all() as { host: string }[]).map((r) => r.host);
  }

  counts(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const r of this.db.prepare(`select status, count(*) n from stores group by status`).all() as { status: string; n: number }[]) out[r.status] = r.n;
    return out;
  }

  totals(): { stores: number; captured: number; pages: number; pagesCaptured: number; blocks: number; avgStoreMs: number; homeOnly: number; bytes: number } {
    const s = this.db.prepare(`select count(*) n, coalesce(avg(nullif(ms, 0)), 0) avg, coalesce(sum(bytes), 0) bytes from stores where status in ('done', 'partial')`).get() as { n: number; avg: number; bytes: number };
    const p = this.db.prepare(`select count(*) n, coalesce(sum(status = 'captured'), 0) ok, coalesce(sum(blocks), 0) blocks from pages`).get() as { n: number; ok: number; blocks: number };
    const all = this.db.prepare(`select count(*) n from stores`).get() as { n: number };
    const homeOnly = this.db.prepare(`select count(*) n from stores where status in ('done', 'partial') and pages_total <= 1`).get() as { n: number };
    return { stores: all.n, captured: s.n, pages: p.n, pagesCaptured: p.ok, blocks: p.blocks, avgStoreMs: Math.round(s.avg), homeOnly: homeOnly.n, bytes: s.bytes };
  }

  reasons(limit = 12): { scope: string; reason: string; n: number }[] {
    const stores = this.db
      .prepare(`select 'store' scope, reason, count(*) n from stores where reason is not null and status in ('failed', 'skipped', 'partial') group by reason order by n desc limit ?`)
      .all(limit) as { scope: string; reason: string; n: number }[];
    const pages = this.db
      .prepare(`select 'page' scope, reason, count(*) n from pages where reason is not null group by reason order by n desc limit ?`)
      .all(limit) as { scope: string; reason: string; n: number }[];
    return [...stores, ...pages];
  }

  list(status: StoreStatus, limit = 20): StoreRow[] {
    return this.db.prepare(`select * from stores where status = ? order by (rank is null), rank asc limit ?`).all(status, limit) as StoreRow[];
  }

  platformBreakdown(): { platform: string; status: string; n: number }[] {
    return this.db.prepare(`select coalesce(platform, 'unknown') platform, status, count(*) n from stores group by 1, 2 order by 1, 2`).all() as { platform: string; status: string; n: number }[];
  }
}
