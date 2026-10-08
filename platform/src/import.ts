import { readdir, readFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { and, desc, eq, lt } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import sharp from "sharp";
import { encode as blurhashEncode } from "blurhash";
import type { Manifest, ManifestBlock } from "../../web/src/contracts/manifest.js";
import { blocks, captures, pages, sites, siteTech, captureDiffs } from "./schema.js";

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

// Page text can carry NUL characters, which Postgres rejects in text and jsonb ("invalid byte sequence ... 0x00").
const withoutNul = (_key: string, value: unknown) => typeof value === "string" ? value.replaceAll("\u0000", "") : value;

function themeFields(theme: Record<string, unknown> | null | undefined) {
  const string = (key: string) => typeof theme?.[key] === "string" ? theme[key] as string : null;
  return { themeName: string("name") ?? string("schema_name"), themeVersion: string("schema_version") };
}

// Generate blurhash from JPEG buffer
async function generateBlurhash(buffer: Buffer): Promise<string> {
  const metadata = await sharp(buffer).metadata();
  const width = metadata.width ?? 100;
  const height = metadata.height ?? 100;

  const resized = await sharp(buffer)
    .resize(100, 100, { fit: "fill" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  return blurhashEncode(new Uint8ClampedArray(resized.data), resized.info.width, resized.info.height, 4, 3);
}

// Get image dimensions and blurhash from JPEG
async function getImageMetadata(jpegPath: string): Promise<{ width: number; height: number; blurhash: string } | null> {
  try {
    const buffer = await readFile(jpegPath).catch(() => null);
    if (!buffer) return null;

    const metadata = await sharp(buffer).metadata();
    const blurhash = await generateBlurhash(buffer);
    return {
      width: metadata.width ?? 0,
      height: metadata.height ?? 0,
      blurhash,
    };
  } catch {
    return null;
  }
}

/** A storage key as the app loads it: under S3_PUBLIC_BASE_URL, else root-relative. */
function publicSrc(key: string): string {
  const base = process.env.S3_PUBLIC_BASE_URL?.replace(/\/$/, "");
  return base ? `${base}/${key}` : `/${key}`;
}

function imageKey(manifestPath: string, root: string, file: string | null): string | null {
  if (!file) return null;
  return publicSrc(relative(root, resolve(dirname(manifestPath), file))
    .split(sep)
    .join("/")
    .replace(/\.(jpg|jpeg)$/i, ".webp"));
}

// images.json, written next to the manifest by the image pipeline (src/images.ts):
// what was actually uploaded for each image, including the slices of one taller
// than WebP allows. Without it (pipeline not run yet) keys are derived as before.
type UploadedImage = {
  width: number; height: number; webpKey: string | null; thumbnailKey: string; blurhash: string;
  slices: { index: number; key: string; top: number; width: number; height: number }[];
};
async function uploadedImages(manifestPath: string): Promise<Record<string, UploadedImage>> {
  try {
    return (JSON.parse(await readFile(resolve(dirname(manifestPath), "images.json"), "utf8")) as { images: Record<string, UploadedImage> }).images;
  } catch (e) {
    if ((e as { code?: string }).code === "ENOENT") return {};
    throw e;
  }
}
const slicesOf = (img: UploadedImage) => img.slices.length
  ? img.slices.map((s) => ({ index: s.index, src: publicSrc(s.key), top: s.top, width: s.width, height: s.height }))
  : null;
/** A viewport as stored on the capture, plus where its screenshot went when the pipeline ran. */
function viewportWithImage<V extends object>(viewport: V | undefined, images: Record<string, UploadedImage>): V | null {
  if (!viewport) return null;
  const img = "file" in viewport && typeof viewport.file === "string" ? images[viewport.file] : undefined;
  if (!img) return viewport;
  return { ...viewport, image: { src: img.webpKey ? publicSrc(img.webpKey) : null, thumbnail: publicSrc(img.thumbnailKey), blurhash: img.blurhash, width: img.width, height: img.height, slices: slicesOf(img) } };
}

function thumbnailKey(imageKey: string | null): string | null {
  if (!imageKey) return null;
  return imageKey.replace(/\.webp$/, "_thumb.webp");
}

async function blockRow(captureId: string, block: ManifestBlock, manifestPath: string, root: string, images: Record<string, UploadedImage>) {
  const uploaded = block.file ? images[block.file] : undefined;
  if (uploaded) {
    return {
      ...blockFields(captureId, block),
      imageKey: publicSrc(uploaded.webpKey ?? uploaded.slices[0].key), thumbnailKey: publicSrc(uploaded.thumbnailKey),
      blurhash: uploaded.blurhash, imageWidth: uploaded.width, imageHeight: uploaded.height, imageSlices: slicesOf(uploaded),
    };
  }

  let imageWidth: number | null = null;
  let imageHeight: number | null = null;
  let blurhash: string | null = null;

  if (block.file) {
    const jpegPath = resolve(dirname(manifestPath), block.file);
    const meta = await getImageMetadata(jpegPath);
    if (meta) {
      imageWidth = meta.width;
      imageHeight = meta.height;
      blurhash = meta.blurhash;
    }
  }

  const iKey = imageKey(manifestPath, root, block.file);
  const tKey = thumbnailKey(iKey);

  return { ...blockFields(captureId, block), imageKey: iKey, thumbnailKey: tKey, blurhash, imageWidth, imageHeight, imageSlices: null };
}

function blockFields(captureId: string, block: ManifestBlock) {
  return {
    captureId, ref: block.ref, blockIndex: block.index, viewport: block.viewport, typeHint: block.typeHint,
    parentType: block.parentType, tag: block.tag, elementId: block.id, classes: block.classes,
    top: Math.round(block.top), height: Math.round(block.height), width: Math.round(block.width),
    text: block.text, textLength: block.textLength, headline: block.headline || null,
    buttons: block.buttons, images: block.images, videos: block.videos, background: block.bg, updatedAt: new Date(),
  };
}

// Detect changes between two sets of blocks
function detectBlockChanges(oldBlocks: ManifestBlock[], newBlocks: ManifestBlock[]): { added: number[]; removed: number[]; changed: number[] } {
  const oldMap = new Map(oldBlocks.map((b) => [b.index, b]));
  const newMap = new Map(newBlocks.map((b) => [b.index, b]));

  const added = Array.from(newMap.keys()).filter((idx) => !oldMap.has(idx));
  const removed = Array.from(oldMap.keys()).filter((idx) => !newMap.has(idx));
  const changed = Array.from(newMap.keys())
    .filter((idx) => oldMap.has(idx))
    .filter((idx) => {
      const old = oldMap.get(idx)!;
      const neu = newMap.get(idx)!;
      return (
        old.text !== neu.text ||
        old.typeHint !== neu.typeHint ||
        old.height !== neu.height ||
        old.top !== neu.top ||
        old.images !== neu.images ||
        old.videos !== neu.videos
      );
    });

  return { added, removed, changed };
}

const input = resolve(process.argv[2] ?? "fixtures/manifests");
const manifestPaths = await manifestsAt(input);
if (!manifestPaths.length) throw new Error(`No manifest.json files found under ${input}`);
const root = (await import("node:fs/promises").then((fs) => fs.stat(input))).isDirectory() ? input : dirname(input);
const client = postgres(url, { max: 1, prepare: false });
const db = drizzle(client);
let imported = 0;
let blockCount = 0;
let recaptureCount = 0;
const failed: string[] = [];

try {
  for (const manifestPath of manifestPaths) try {
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"), withoutNul) as Manifest;
    const images = await uploadedImages(manifestPath);
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

      // The capture just before this one, for diff detection. Strictly earlier,
      // so replaying the same manifest never diffs a capture against itself.
      const prevCapture = await tx.select({ id: captures.id }).from(captures)
        .where(and(eq(captures.pageId, page.id), lt(captures.capturedAt, new Date(manifest.page.capturedAt))))
        .orderBy(desc(captures.capturedAt)).limit(1);

      const [capture] = await tx.insert(captures).values({
        pageId: page.id, capturedAt: new Date(manifest.page.capturedAt),
        desktop: viewportWithImage(manifest.viewports.desktop, images), mobile: viewportWithImage(manifest.viewports.mobile, images),
      }).onConflictDoUpdate({ target: [captures.pageId, captures.capturedAt], set: {
        desktop: viewportWithImage(manifest.viewports.desktop, images), mobile: viewportWithImage(manifest.viewports.mobile, images), updatedAt: new Date(),
      }}).returning({ id: captures.id });

      // Insert/update blocks
      for (const block of manifest.blocks) {
        const row = await blockRow(capture.id, block, manifestPath, root, images);
        await tx.insert(blocks).values(row).onConflictDoUpdate({
          target: [blocks.captureId, blocks.viewport, blocks.blockIndex], set: row,
        });
      }

      // Detect recapture and create diff
      if (prevCapture.length > 0) {
        const oldBlocksDesktop = await tx.select().from(blocks)
          .where(and(eq(blocks.captureId, prevCapture[0].id), eq(blocks.viewport, "desktop")));
        const oldBlocksMobile = await tx.select().from(blocks)
          .where(and(eq(blocks.captureId, prevCapture[0].id), eq(blocks.viewport, "mobile")));

        const newBlocksDesktop = manifest.blocks.filter((b) => b.viewport === "desktop");
        const newBlocksMobile = manifest.blocks.filter((b) => b.viewport === "mobile");

        const diffDt = detectBlockChanges(oldBlocksDesktop.map((b) => ({
          index: b.blockIndex,
          text: b.text,
          typeHint: b.typeHint,
          height: b.height,
          top: b.top,
          images: b.images,
          videos: b.videos,
        } as any)), newBlocksDesktop.map((b) => ({
          index: b.index,
          text: b.text,
          typeHint: b.typeHint,
          height: b.height,
          top: b.top,
          images: b.images,
          videos: b.videos,
        } as any)));

        const diffMb = detectBlockChanges(oldBlocksMobile.map((b) => ({
          index: b.blockIndex,
          text: b.text,
          typeHint: b.typeHint,
          height: b.height,
          top: b.top,
          images: b.images,
          videos: b.videos,
        } as any)), newBlocksMobile.map((b) => ({
          index: b.index,
          text: b.text,
          typeHint: b.typeHint,
          height: b.height,
          top: b.top,
          images: b.images,
          videos: b.videos,
        } as any)));

        const addedCount = new Set([...diffDt.added, ...diffMb.added]).size;
        const removedCount = new Set([...diffDt.removed, ...diffMb.removed]).size;
        const changedCount = new Set([...diffDt.changed, ...diffMb.changed]).size;

        if (addedCount > 0 || removedCount > 0 || changedCount > 0) {
          await tx.insert(captureDiffs).values({
            pageId: page.id,
            fromCaptureId: prevCapture[0].id,
            toCaptureId: capture.id,
            addedBlockCount: addedCount,
            removedBlockCount: removedCount,
            changedBlockCount: changedCount,
            summary: { desktop: diffDt, mobile: diffMb },
          });
          recaptureCount++;
          console.log(`  recapture diff: +${addedCount} -${removedCount} ~${changedCount}`);
        }
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
  } catch (e) {
    // Each manifest is its own transaction, so one bad store doesn't stop the other 967.
    failed.push(manifestPath);
    console.error(`FAILED ${relative(root, manifestPath)}: ${(e as { cause?: Error }).cause?.message ?? (e as Error).message}`);
  }
  console.log(`Done: ${imported} manifests, ${blockCount} blocks, ${recaptureCount} recaptures with diffs${failed.length ? `, ${failed.length} failed` : ""}`);
  if (failed.length) process.exitCode = 1;
  // Typo tolerance corrects query words against the corpus vocabulary, so keep it current.
  // Skipped before migration 0004 (no view yet); new blocks still need `npm run embed`.
  await client`REFRESH MATERIALIZED VIEW CONCURRENTLY search_terms`.then(
    () => console.log("Refreshed search_terms. Run `npm run embed` for semantic search."),
    (e: { code?: string }) => { if (e.code !== "42P01") throw e; },
  );
} finally { await client.end(); }
