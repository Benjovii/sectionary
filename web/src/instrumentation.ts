// Runs once when a server starts. On AWS it fills the server's answer cache
// (server/response-cache.ts) before the first visitor needs it, so a fresh
// task, after a deploy or a scale-out, does not make the first people to open
// the wall wait out cold database queries. Nothing runs on Vercel (its CDN
// caches instead), in development, or without a database.

export function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NODE_ENV !== "production" || process.env.VERCEL || !process.env.DATABASE_URL) return;
  if (!process.env.NEXT_PUBLIC_BLOCKS_SRC?.startsWith("/api/")) return;
  // register() must finish before the server takes requests, so the warm-up
  // starts a moment later, against the server's own port.
  setTimeout(() => void warm(`http://127.0.0.1:${process.env.PORT || 3000}`), 2_000);
}

/** Wall pages, by viewport switch, exactly as the wall asks for them (components/wall.tsx, PAGE_SIZE). */
const WALL = ["vp=desktop", "vp=mobile", "vp=desktop,mobile"].map((vp) => `/api/blocks?${vp}&limit=200`);

async function warm(origin: string) {
  const get = async (path: string) => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        const response = await fetch(origin + path);
        if (response.ok) return response;
      } catch {
        // Not listening yet: try again shortly.
      }
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
    return null;
  };

  const started = Date.now();
  // What every visitor's first screen needs: the wall at each viewport, the
  // library counts (limit=1, also the Sites directory), and the Sites list.
  await Promise.all([...WALL, "/api/blocks?limit=1"].map(get));
  for (let cursor = 0; cursor < 2_000; cursor += 200) {
    const page = await get(`/api/sites?${cursor ? `cursor=${cursor}&` : ""}limit=200`);
    const body = (await page?.json().catch(() => null)) as { nextCursor?: string | null } | null;
    if (!body?.nextCursor) break;
  }

  // The "similar" pools the block viewer reads (lib/load-blocks.ts), one
  // kind of block at a time so visitors' queries still get the connections.
  const counts = (await (await get("/api/blocks?limit=1"))?.json().catch(() => null)) as {
    facets?: { block?: { value: string }[] };
  } | null;
  const types = [...new Set((counts?.facets?.block ?? []).map((b) => b.value.replace(/-part$/, "")))];
  for (const type of types) {
    for (const vp of ["desktop", "mobile"]) await get(`/api/blocks?block=${encodeURIComponent(`${type},${type}-part`)}&vp=${vp}&limit=200&facets=0`);
  }
  console.log(`cache warm: ${types.length} block types in ${Math.round((Date.now() - started) / 1000)}s`);
}
