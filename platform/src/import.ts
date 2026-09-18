import { readdir, readFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import type { Manifest, ManifestBlock } from "../../web/src/contracts/manifest.js";
import { blocks, captures, pages, sites, siteTech } from "./schema.js";

try { process.loadEnvFile(resolve(import.meta.dirname, "../.env")); } catch {}
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required (set it in platform/.env)");

async function manifestsAt(input: string): Promise<string[]> {
  const stat = await import("node:fs/promises").then((fs) => fs.stat(input));
  if (stat.isFile()) return [input];
  const found: string[] = [];
  for (const entry of await readdir(input, { withFileTypes: true })) {
    const path = resolve(input, entry.name);
    if (entry.isDirectory()) found.push(...await manifestsAt(path));
    else if (entry.name === "manifest.json") found.push(path);
  }
  return found.sort();
}

function themeFields(theme: Record<string, unknown> | null | undefined) {
  const string = (key: string) => typeof theme?.[key] === "string" ? theme[key] as string : null;
  return { themeName: string("name") ?? string("schema_name"), themeVersion: string("schema_version") };
}

function imageKey(manifestPath: string, root: string, file: string | null): string | null {
  if (!file) return null;
  const local = relative(root, resolve(dirname(manifestPath), file)).split(sep).join("/");
  const base = process.env.S3_PUBLIC_BASE_URL?.replace(/\/$/, "");
  return base ? `${base}/${local}` : `/${local}`;
}

function blockRow(captureId: string, block: ManifestBlock, manifestPath: string, root: string) {
  return {
    captureId, ref: block.ref, blockIndex: block.index, viewport: block.viewport, typeHint: block.typeHint,
    parentType: block.parentType, tag: block.tag, elementId: block.id, classes: block.classes,
    top: Math.round(block.top), height: Math.round(block.height), width: Math.round(block.width),
    text: block.text, textLength: block.textLength, headline: block.headline || null,
    buttons: block.buttons, images: block.images, videos: block.videos, background: block.bg,
    imageKey: imageKey(manifestPath, root, block.file), updatedAt: new Date(),
  };
}

const input = resolve(process.argv[2] ?? "fixtures/manifests");
const manifestPaths = await manifestsAt(input);
if (!manifestPaths.length) throw new Error(`No manifest.json files found under ${input}`);
const root = (await import("node:fs/promises").then((fs) => fs.stat(input))).isDirectory() ? input : dirname(input);
const client = postgres(url, { max: 1, prepare: false });
const db = drizzle(client);
let imported = 0;
let blockCount = 0;

try {
  for (const manifestPath of manifestPaths) {
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Manifest;
    await db.transaction(async (tx) => {
      const tf = themeFields(manifest.site.theme);
      const [site] = await tx.insert(sites).values({
        host: manifest.site.host.toLowerCase(), origin: manifest.site.origin, brand: manifest.site.host.split(".")[0],
        title: manifest.page.type === "home" ? manifest.page.title ?? null : null, platform: manifest.site.platform ?? null,
        builder: manifest.site.builder ?? null, theme: manifest.site.theme ?? null, ...tf,
        apps: manifest.site.apps ?? [], currency: manifest.site.currency ?? null, locale: manifest.site.locale ?? null,
      }).onConflictDoUpdate({ target: sites.host, set: {
        origin: manifest.site.origin, platform: manifest.site.platform ?? null, builder: manifest.site.builder ?? null,
        theme: manifest.site.theme ?? null, ...tf,
        apps: sql`(SELECT coalesce(array_agg(DISTINCT app), '{}') FROM unnest(${sites.apps} || excluded.apps) app)`,
        title: manifest.page.type === "home" ? manifest.page.title ?? null : sql`${sites.title}`,
        currency: manifest.site.currency ?? null,
        locale: manifest.site.locale ?? null, updatedAt: new Date(),
      }}).returning({ id: sites.id });

      const [page] = await tx.insert(pages).values({
        siteId: site.id, url: manifest.page.url, type: manifest.page.type, slug: manifest.page.slug,
        title: manifest.page.title ?? null, description: manifest.page.description ?? null, canonical: manifest.page.canonical ?? null,
        ogImage: manifest.page.ogImage ?? null, lang: manifest.page.lang ?? null, h1: manifest.page.h1 ?? null,
      }).onConflictDoUpdate({ target: [pages.siteId, pages.url], set: {
        type: manifest.page.type, slug: manifest.page.slug, title: manifest.page.title ?? null,
        description: manifest.page.description ?? null, canonical: manifest.page.canonical ?? null,
        ogImage: manifest.page.ogImage ?? null, lang: manifest.page.lang ?? null, h1: manifest.page.h1 ?? null, updatedAt: new Date(),
      }}).returning({ id: pages.id });

      const [capture] = await tx.insert(captures).values({
        pageId: page.id, capturedAt: new Date(manifest.page.capturedAt),
        desktop: manifest.viewports.desktop ?? null, mobile: manifest.viewports.mobile ?? null,
      }).onConflictDoUpdate({ target: [captures.pageId, captures.capturedAt], set: {
        desktop: manifest.viewports.desktop ?? null, mobile: manifest.viewports.mobile ?? null, updatedAt: new Date(),
      }}).returning({ id: captures.id });

      for (const block of manifest.blocks) {
        const row = blockRow(capture.id, block, manifestPath, root);
        await tx.insert(blocks).values(row).onConflictDoUpdate({
          target: [blocks.captureId, blocks.viewport, blocks.blockIndex], set: row,
        });
      }

      const tech = [
        manifest.site.platform && { kind: "platform", name: manifest.site.platform },
        manifest.site.builder && { kind: "builder", name: manifest.site.builder },
        tf.themeName && { kind: "theme", name: tf.themeName, version: tf.themeVersion },
        ...(manifest.site.apps ?? []).map((name) => ({ kind: "app", name })),
      ].filter(Boolean) as { kind: string; name: string; version?: string | null }[];
      for (const item of tech) await tx.insert(siteTech).values({ siteId: site.id, ...item }).onConflictDoUpdate({
        target: [siteTech.siteId, siteTech.kind, siteTech.name], set: { version: item.version ?? null, updatedAt: new Date() },
      });
    });
    imported++;
    blockCount += manifest.blocks.length;
    console.log(`imported ${manifest.site.host} ${manifest.page.slug} (${manifest.blocks.length} blocks)`);
  }
  console.log(`Done: ${imported} manifests, ${blockCount} blocks`);
} finally { await client.end(); }
