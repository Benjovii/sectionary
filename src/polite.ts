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
import { Agent, fetch as undiciFetch } from 'undici';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * One HTTP agent for every crawler request. Node's default caps response
 * headers at 16 KB and some stores exceed it (Crumbl's home page did), which
 * surfaces as a "Headers Overflow" fetch failure. Timeouts are per phase so a
 * stalled body cannot hold a worker for longer than the fetch timeout.
 */
const agent = new Agent({ maxHeaderSize: 64 * 1024, headersTimeout: 15_000, bodyTimeout: 15_000, connect: { timeout: 10_000 } });

/** fetch() through the crawler agent; the return type is the standard Response. */
export function crawlerFetch(url: string, init: RequestInit = {}): Promise<Response> {
  return undiciFetch(url, { ...(init as object), dispatcher: agent } as Parameters<typeof undiciFetch>[1]) as unknown as Promise<Response>;
}

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
export const FETCH_TIMEOUT_MS = 12_000;

export const DESKTOP_BASE_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
export const MOBILE_BASE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

export function botUserAgent(base: string): string {
  return `${base} ${BOT_TOKEN}`;
}

export type Verdict = { ok: true } | { ok: false; reason: 'blocklist' | 'robots' | 'robots-unreachable' | 'dead' };

type Rule = {
  source: 'robots' | 'none' | 'error' | 'dead';
  isAllowed: (url: string) => boolean;
  delayMs: number | null;
};

/** A DNS failure is a dead host, not a transient problem on our side. */
function isDnsFailure(e: unknown): boolean {
  const code = (e as { cause?: { code?: string }; code?: string })?.cause?.code ?? (e as { code?: string })?.code;
  return code === 'ENOTFOUND' || code === 'ECONNREFUSED' || code === 'CERT_HAS_EXPIRED' || code === 'ERR_TLS_CERT_ALTNAME_INVALID';
}

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
  // Shopify answers 429 (robots.txt included) at two requests a second from
  // one IP across all its stores, measured 2026-09-17. One a second is clean.
  // The general lane is gentler than it looks: gallery entries carry no
  // platform hint, so many Shopify stores travel through it.
  private readonly limits: Record<Lane, { max: number; gapMs: number }> = { shopify: { max: 1, gapMs: 1000 }, other: { max: 4, gapMs: 300 } };

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
  return /shopify/i.test(platformHint || '') ? 'shopify' : 'other';
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
      crawlerFetch(robotsUrl, {
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
      // rule. Back off with growing waits before giving the host up for this run.
      for (let attempt = 1; res.status === 429 && attempt <= 2; attempt++) {
        await sleep(Math.max(retryAfterMs(res, 10, 60), attempt * 15_000));
        res = await lanes.run(lane, get);
      }
      if (res.status === 429) {
        // Still throttled on robots.txt itself. Nearly every store on a hosted
        // platform ships that platform's standard robots.txt, which allows the
        // home page and catalogue feeds, all the validator asks for. Assume the
        // conservative reading rather than lose the store; the page request
        // will say 429 itself if the throttle is real, and that is retried
        // slowly later. The capture crawler (a real browser) re-reads robots.
        return { source: 'none', isAllowed: (u) => !/\/(checkout|account|admin|cart|orders|search|login|customer)\b/.test(new URL(u).pathname), delayMs: null };
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
      // No robots file, or one we may not read (any 4xx but 429): the
      // convention is that everything is allowed; a site that blocks the bot
      // outright will say so again on the page request, which is then cached.
      if (res.status >= 400 && res.status < 500 && res.status !== 429) return { source: 'none', isAllowed: () => true, delayMs: null };
      // 429 (non-Shopify), 5xx and anything odd: assume "not now" for this run.
      return { source: 'error', isAllowed: () => false, delayMs: null };
    } catch (e) {
      if (isDnsFailure(e)) return { source: 'dead', isAllowed: () => false, delayMs: null };
      return { source: 'error', isAllowed: () => false, delayMs: null };
    }
  }

  /** A retry later in the same run should ask for robots.txt again, not reuse a remembered failure. */
  async forgetFailure(url: string): Promise<void> {
    const origin = new URL(url).origin;
    const p = this.rules.get(origin);
    if (p && (await p).source === 'error') this.rules.delete(origin);
  }

  /** May we request this URL? Own sites bypass robots, never the block list. */
  async allowed(url: string, lane: Lane = 'other'): Promise<Verdict> {
    const host = hostOf(url);
    if (this.isBlocked(host)) return { ok: false, reason: 'blocklist' };
    if (this.isOwn(host)) return { ok: true };
    const rule = await this.rule(new URL(url).origin, lane);
    if (rule.source === 'dead') return { ok: false, reason: 'dead' };
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
    return lanes.run(lane, () => crawlerFetch(url, { redirect: 'follow', ...init, headers, signal: init.signal ?? AbortSignal.timeout(FETCH_TIMEOUT_MS) }));
  }
}
