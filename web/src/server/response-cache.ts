// Public API answers kept in the server's memory.
//
// On Vercel the CDN kept /api/blocks and /api/sites for ten minutes
// (PUBLIC_CACHE's s-maxage), so a visitor almost never waited on the database.
// On AWS (ECS Express Mode, docs/AWS.md) nothing sits in front of the app:
// the load balancer caches nothing, so every wall page ran the full query,
// about two seconds warm and over ten cold. An ECS task is a long-running
// server, unlike a Vercel function, so it can keep answers itself.
//
// The same rule as the CDN had: fresh for ten minutes, then the old answer is
// served at once while a new one is built behind it, for up to a day. Identical
// requests that arrive while an answer is being built share it. Only answers
// every visitor gets alike go in here (no session, no personal filters).
//
// Held on globalThis: Next.js may load this module more than once (each route
// bundle, instrumentation), and they must all share one cache.

const FRESH_MS = 10 * 60_000;
const STALE_MS = 24 * 60 * 60_000;
/** Roughly what the cached bodies may take, in characters; the least recently used go first. */
const BUDGET = 150_000_000;

type Entry = { at: number; body: string; headers: Record<string, string>; size: number };
type Store = { entries: Map<string, Entry>; pending: Map<string, Promise<Entry>>; size: number };

declare global {
  var sectionaryResponses: Store | undefined;
}

const store = (): Store => (globalThis.sectionaryResponses ??= { entries: new Map(), pending: new Map(), size: 0 });

/** A cache key for a request: its path and its query, in a fixed order so `?a=1&b=2` and `?b=2&a=1` share an entry. */
export function keyOf(url: URL): string {
  const params = [...url.searchParams].sort(([a], [b]) => a.localeCompare(b));
  return `${url.pathname}?${new URLSearchParams(params)}`;
}

function remember(s: Store, key: string, entry: Entry) {
  const old = s.entries.get(key);
  if (old) {
    s.size -= old.size;
    s.entries.delete(key);
  }
  s.entries.set(key, entry);
  s.size += entry.size;
  // A Map keeps insertion order, and every hit re-inserts, so the first key is the least recently used.
  for (const [k, e] of s.entries) {
    if (s.size <= BUDGET) break;
    s.entries.delete(k);
    s.size -= e.size;
  }
}

function build(s: Store, key: string, make: () => Promise<{ body: unknown; headers?: Record<string, string> }>): Promise<Entry> {
  let pending = s.pending.get(key);
  if (!pending) {
    pending = make().then(({ body, headers = {} }) => {
      const text = JSON.stringify(body);
      const entry = { at: Date.now(), body: text, headers, size: text.length };
      remember(s, key, entry);
      return entry;
    });
    const settle = () => s.pending.delete(key);
    pending.then(settle, settle);
    s.pending.set(key, pending);
  }
  return pending;
}

/**
 * A JSON response from the cache, or built by `make` and kept. `headers` go
 * on every response (the Cache-Control); `make` may add its own, which are
 * kept with the body. `x-cache` says which it was: hit, stale or miss.
 * A failed build is not kept, and its error reaches the caller.
 */
export async function cachedJson(
  key: string,
  headers: Record<string, string>,
  make: () => Promise<{ body: unknown; headers?: Record<string, string> }>,
): Promise<Response> {
  const s = store();
  const hit = s.entries.get(key);
  const age = hit ? Date.now() - hit.at : Infinity;
  let entry: Entry;
  let state: "hit" | "stale" | "miss";
  if (hit && age < FRESH_MS + STALE_MS) {
    // Used: to the back of the queue, so it is the last to go.
    s.entries.delete(key);
    s.entries.set(key, hit);
    entry = hit;
    state = age < FRESH_MS ? "hit" : "stale";
    if (state === "stale") build(s, key, make).catch((error) => console.error("cache refresh failed", key, error));
  } else {
    entry = await build(s, key, make);
    state = "miss";
  }
  return new Response(entry.body, {
    headers: { "content-type": "application/json", ...headers, ...entry.headers, "x-cache": state },
  });
}
