import type { Block } from "@/contracts/block";
import { BLOCKS_SRC } from "@/lib/data-source";
import { database } from "@/server/db";

type Sql = ReturnType<typeof database>;

/**
 * The columns every Block comes from. Use it as `SELECT ${blockColumns(sql)} FROM ${blockJoins(sql)}`
 * so /api/blocks, boards, share links and the time machine return the same shape.
 */
export const blockColumns = (sql: Sql) => sql`b.id, s.host, p.type AS page_type, p.url AS page_url, p.title AS page_title,
  b.viewport, b.type_hint, b.headline, b.background, b.width, b.height, b.image_key,
  s.platform, s.theme_name, s.apps, b.buttons, b.images, b.videos, left(b.text, 400) AS text`;
export const blockJoins = (sql: Sql) => sql`blocks b JOIN captures c ON c.id=b.capture_id JOIN pages p ON p.id=c.page_id JOIN sites s ON s.id=p.site_id`;

export function toBlock(r: Record<string, unknown>): Block {
  return {
    id: r.id as string, host: r.host as string, pageType: r.page_type as string, pageUrl: r.page_url as string,
    pageTitle: (r.page_title as string | null) ?? null, viewport: r.viewport as Block["viewport"], typeHint: r.type_hint as string,
    headline: (r.headline as string | null) ?? null, bg: r.background as string, w: r.width as number, h: r.height as number,
    src: (r.image_key as string | null) ?? "", platform: (r.platform as string | null) ?? null, theme: (r.theme_name as string | null) ?? null,
    apps: (r.apps as string[]) ?? [], buttons: r.buttons as number, images: r.images as number, videos: r.videos as number, text: r.text as string,
  };
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const hasDatabase = () => Boolean(process.env.DATABASE_URL);

/**
 * Find one block by id from a trusted source: the database when it is
 * configured, otherwise the sample JSON the app itself serves. Never trust a
 * block object sent by the browser: its `src` would decide what the server fetches.
 */
export async function findBlock(id: string, origin: string): Promise<Block | null> {
  if (hasDatabase()) {
    if (!UUID.test(id)) return null;
    const sql = database();
    const [row] = await sql`SELECT ${blockColumns(sql)} FROM ${blockJoins(sql)} WHERE b.id=${id}`;
    return row ? toBlock(row) : null;
  }
  const res = await fetch(new URL(BLOCKS_SRC, origin), { cache: "force-cache" });
  if (!res.ok) return null;
  const set = (await res.json()) as { blocks?: Block[]; items?: Block[] };
  return (set.blocks ?? set.items ?? []).find((b) => b.id === id) ?? null;
}
