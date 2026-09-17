// Polite-crawler rules (SEC-6). Every network request the crawler or the
// harvester makes to a third-party site goes through this module:
//
//   * identifies itself: the real browser UA plus "SectionaryBot/<v> (+info url)"
//   * honours robots.txt (per-host cache; unreachable robots = do not crawl)
//   * paces navigations: at most one per second per host, or the site's
//     Crawl-delay if it asks for more (capped at 10 s)
//   * skips hosts on config/blocklist.txt (opt-outs), including subdomains
//   * relaxes the rules only for config/own-sites.txt: stores we manage
//     ourselves, where permission is ours to give
import robotsParserModule from 'robots-parser';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

// robots-parser's bundled typings do not expose a call signature under
// NodeNext module resolution; the runtime export is the parser function.
export type Robots = {
  isAllowed(url: string, ua?: string): boolean | undefined;
  getCrawlDelay(ua?: string): number | undefined;
};
export const robotsParser = robotsParserModule as unknown as (url: string, contents: string) => Robots;

export const BOT_NAME = 'SectionaryBot';
export const BOT_VERSION = '0.2';
/** Set SECTIONARY_BOT_URL once the /bot page exists on the real domain. */
export const BOT_INFO_URL = process.env.SECTIONARY_BOT_URL || '';
export const BOT_TOKEN = `${BOT_NAME}/${BOT_VERSION}${BOT_INFO_URL ? ` (+${BOT_INFO_URL})` : ''}`;

export const DEFAULT_INTERVAL_MS = 1000;
export const OWN_SITE_INTERVAL_MS = 500;
export const MAX_CRAWL_DELAY_MS = 10_000;
export const FETCH_TIMEOUT_MS = 20_000;

export const DESKTOP_BASE_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
export const MOBILE_BASE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

export function botUserAgent(base: string): string {
  return `${base} ${BOT_TOKEN}`;
}

export type Verdict = { ok: true } | { ok: false; reason: 'blocklist' | 'robots' | 'robots-unreachable' };

type Rule = {
  source: 'robots' | 'none' | 'error';
  isAllowed: (url: string) => boolean;
  delayMs: number | null;
};

/**
 * Shopify serves every store from one platform, so "one request per second
 * per host" is not enough on its own: too many stores at once and the whole
 * IP gets 429s. Requests to known Shopify hosts share one lane (two in
 * flight, spaced out); everything else shares a wider lane.
 */
export type Lane = 'shopify' | 'other';

export class Lanes {
  private inflight: Record<Lane, number> = { shopify: 0, other: 0 };
  private nextAt: Record<Lane, number> = { shopify: 0, other: 0 };
  private readonly limits: Record<Lane, { max: number; gapMs: number }> = { shopify: { max: 3, gapMs: 500 }, other: { max: 8, gapMs: 120 } };

  async run<T>(lane: Lane, fn: () => Promise<T>): Promise<T> {
    const lim = this.limits[lane];
    for (;;) {
      const now = Date.now();
      if (this.inflight[lane] < lim.max && now >= this.nextAt[lane]) {
        this.inflight[lane]++;
        this.nextAt[lane] = now + lim.gapMs;
        break;
      }
      await sleep(Math.max(25, this.nextAt[lane] - now));
    }
    try {
      return await fn();
    } finally {
      this.inflight[lane]--;
    }
  }
}

/** One set of lanes per process. */
export const lanes = new Lanes();

export function laneFor(platformHint: string | null | undefined): Lane {
  return (platformHint || '').toLowerCase() === 'shopify' ? 'shopify' : 'other';
}

/** Seconds to wait after a 429, from Retry-After when present, capped. */
export function retryAfterMs(res: Response, fallbackSeconds = 45, capSeconds = 90): number {
  const ra = Number(res.headers.get('retry-after'));
  return Math.min(ra > 0 ? ra : fallbackSeconds, capSeconds) * 1000;
}

/**
 * Node's fetch (undici) can throw an internal assertion from a socket event
 * handler when a server sends a malformed response. It surfaces as an
 * uncaught exception no try/catch can reach and takes the whole crawl down.
 * For a batch crawler the right response is to log it and carry on: the
 * request itself times out through its AbortSignal. Anything else is rethrown.
 */
let guardInstalled = false;
export function installFetchCrashGuard(): void {
  if (guardInstalled) return;
  guardInstalled = true;
  process.on('uncaughtException', (err: NodeJS.ErrnoException) => {
    const stack = String(err && err.stack);
    if (err && err.code === 'ERR_ASSERTION' && stack.includes('undici')) {
      console.warn('  (ignored an undici assertion from a malformed response)');
      return;
    }
    console.error(err);
    process.exit(1);
  });
}

export class PoliteError extends Error {
  constructor(public readonly reason: string, public readonly url: string) {
    super(`${reason}: ${url}`);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function hostOf(url: string): string {
  return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
}

/** Parse a hosts file: one host per line, # comments, www. stripped. */
export function parseHostList(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim().toLowerCase())
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => l.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, ''));
}

export class Politeness {
  private readonly rules = new Map<string, Promise<Rule>>();
  private readonly nextAt = new Map<string, number>();
  private readonly blocked: Set<string>;
  private readonly own: Set<string>;

  constructor(opts: { blocklist?: string[]; ownSites?: string[] } = {}) {
    this.blocked = new Set(opts.blocklist ?? []);
    this.own = new Set(opts.ownSites ?? []);
  }

  /** Load config/blocklist.txt and config/own-sites.txt (either may be missing). */
  static async fromConfig(dir = 'config'): Promise<Politeness> {
    const load = async (name: string) => {
      try {
        return parseHostList(await readFile(path.join(dir, name), 'utf8'));
      } catch {
        return [];
      }
    };
    return new Politeness({ blocklist: await load('blocklist.txt'), ownSites: await load('own-sites.txt') });
  }

  private static matches(set: Set<string>, host: string): boolean {
    const h = host.toLowerCase().replace(/^www\./, '');
    const parts = h.split('.');
    for (let i = 0; i < parts.length - 1; i++) if (set.has(parts.slice(i).join('.'))) return true;
    return false;
  }

  isBlocked(host: string): boolean {
    return Politeness.matches(this.blocked, host);
  }

  isOwn(host: string): boolean {
    return Politeness.matches(this.own, host);
  }

  /** robots.txt for the origin, fetched once per run. */
  private rule(origin: string, lane: Lane = 'other'): Promise<Rule> {
    let p = this.rules.get(origin);
    if (!p) {
      p = this.loadRule(origin, lane);
      this.rules.set(origin, p);
    }
    return p;
  }

  private async loadRule(origin: string, lane: Lane): Promise<Rule> {
    const robotsUrl = `${origin}/robots.txt`;
    const get = () =>
      fetch(robotsUrl, {
        headers: { 'user-agent': botUserAgent(DESKTOP_BASE_UA), accept: 'text/plain,*/*' },
        redirect: 'follow',
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
    try {
      await this.wait(hostOf(origin));
      // The robots request itself goes through the platform lane: Shopify
      // throttles robots.txt like any other page when too many stores are
      // asked at once.
      let res = await lanes.run(lane, get);
      // A 429 on robots.txt is the platform telling us to slow down, not a
      // rule. Back off once before giving the host up for this run.
      if (res.status === 429) {
        await sleep(retryAfterMs(res, 30, 60));
        res = await lanes.run(lane, get);
      }
      if (res.status === 200) {
        const txt = await res.text();
        const robots = robotsParser(robotsUrl, txt);
        const delay = robots.getCrawlDelay(BOT_NAME);
        return {
          source: 'robots',
          // A url outside this origin yields undefined; treat as allowed here,
          // the caller resolves the right origin first.
          isAllowed: (url) => robots.isAllowed(url, BOT_NAME) !== false,
          delayMs: typeof delay === 'number' ? Math.min(delay * 1000, MAX_CRAWL_DELAY_MS) : null,
        };
      }
      // No robots file (404/410) or one we may not read (401/403): the
      // convention is that everything is allowed.
      if ([401, 403, 404, 410].includes(res.status)) return { source: 'none', isAllowed: () => true, delayMs: null };
      // 5xx and anything odd: assume "not now" for this run.
      return { source: 'error', isAllowed: () => false, delayMs: null };
    } catch {
      return { source: 'error', isAllowed: () => false, delayMs: null };
    }
  }

  /** May we request this URL? Own sites bypass robots, never the block list. */
  async allowed(url: string, lane: Lane = 'other'): Promise<Verdict> {
    const host = hostOf(url);
    if (this.isBlocked(host)) return { ok: false, reason: 'blocklist' };
    if (this.isOwn(host)) return { ok: true };
    const rule = await this.rule(new URL(url).origin, lane);
    if (rule.source === 'error') return { ok: false, reason: 'robots-unreachable' };
    return rule.isAllowed(url) ? { ok: true } : { ok: false, reason: 'robots' };
  }

  /** Block until this host may be hit again, then reserve the next slot. */
  async wait(host: string, extraDelayMs: number | null = null): Promise<void> {
    const h = host.toLowerCase().replace(/^www\./, '');
    const base = this.isOwn(h) ? OWN_SITE_INTERVAL_MS : DEFAULT_INTERVAL_MS;
    const interval = Math.max(base, extraDelayMs ?? 0);
    const now = Date.now();
    const due = this.nextAt.get(h) ?? 0;
    if (due > now) await sleep(due - now);
    this.nextAt.set(h, Math.max(now, due) + interval);
  }

  /** Pacing plus the site's own Crawl-delay, for page navigations. */
  async waitFor(url: string, lane: Lane = 'other'): Promise<void> {
    const host = hostOf(url);
    const rule = this.isOwn(host) ? null : await this.rule(new URL(url).origin, lane);
    await this.wait(host, rule?.delayMs ?? null);
  }

  /**
   * A plain fetch that obeys every rule above. Throws PoliteError when refused.
   * The robots.txt request (inside `allowed`) and the request itself each take
   * the platform lane in turn; callers must NOT wrap this in `lanes.run`, or
   * the nested acquisition deadlocks once the lane is full.
   */
  async fetch(url: string, init: RequestInit = {}, lane: Lane = 'other'): Promise<Response> {
    const verdict = await this.allowed(url, lane);
    if (!verdict.ok) throw new PoliteError(verdict.reason, url);
    await this.waitFor(url, lane);
    const headers = new Headers(init.headers);
    if (!headers.has('user-agent')) headers.set('user-agent', botUserAgent(DESKTOP_BASE_UA));
    return lanes.run(lane, () => fetch(url, { redirect: 'follow', ...init, headers, signal: init.signal ?? AbortSignal.timeout(FETCH_TIMEOUT_MS) }));
  }
}
