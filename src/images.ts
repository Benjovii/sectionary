// Image pipeline core (SEC-9): JPEG screenshots -> WebP (full or sliced) + thumbnail + blurhash -> object storage.
//
// No environment, no network: storage is passed in, so tests run it against
// an in-memory store. The CLI is src/image-pipeline.ts.
//
// WebP cannot encode an image taller or wider than 16,383 px, and a full-page
// screenshot of a long store page is often 20,000-60,000 px tall. Such an image
// is cut into horizontal slices, top to bottom, each at most `sliceHeight` tall
// (8,192 by default), so the whole page is kept:
//
//   myzoobox.com/home/desktop.jpg (1440 x 30000)
//     -> myzoobox.com/home/desktop_s000.webp  rows     0-8191
//        myzoobox.com/home/desktop_s001.webp  rows  8192-16383
//        myzoobox.com/home/desktop_s002.webp  rows 16384-24575
//        myzoobox.com/home/desktop_s003.webp  rows 24576-29999
//        myzoobox.com/home/desktop_thumb.webp
//
// An image that fits is one `<base>.webp`, as before. An image wider than
// 16,383 px (never seen from the crawler, whose viewports are 1440 and 390) is
// scaled down to that width first and the record says so (`scale`).
//
// Keys are the image's path under the capture root with the extension swapped,
// the same keys platform/src/import.ts derives, so they are stable across runs.
// Each page also gets an `images.json` (next to its manifest and uploaded beside
// the images) listing every image, its slices in order and their offsets, which
// is what a consumer needs to stack the slices back into the page.

import { dirname, relative, resolve, sep } from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import sharp from "sharp";
import { encode as blurhashEncode } from "blurhash";
import type { Manifest } from "../web/src/contracts/manifest.js";

/** Largest width or height WebP can encode. */
export const WEBP_MAX_DIMENSION = 16383;
export const DEFAULT_SLICE_HEIGHT = 8192;
export const THUMB_WIDTH = 600;
/** A thumbnail of a tall image shows its top, cropped at this height. */
export const THUMB_MAX_HEIGHT = 1200;
const FULL_QUALITY = 80;
const THUMB_QUALITY = 75;
// A 1440 x 60,000 page is 86 MP; sharp's default guard is 268 MP. Lift it, the inputs are our own screenshots.
const SHARP_INPUT = { limitInputPixels: false } as const;

export interface Storage {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
}

export interface Slice {
  index: number;
  key: string;
  /** Offset of the slice's first row in the (scaled) image. */
  top: number;
  width: number;
  height: number;
  bytes: number;
}

export interface ImageRecord {
  /** The source file, relative to the capture root. */
  source: string;
  /** Source dimensions. */
  width: number;
  height: number;
  /** Below 1 when the source was wider than WebP allows and was scaled down first. */
  scale: number;
  /** The single full-size WebP, or null when the image was sliced. */
  webpKey: string | null;
  /** Empty unless sliced; ordered top to bottom, contiguous, covering the whole image. */
  slices: Slice[];
  thumbnailKey: string;
  thumbnailWidth: number;
  thumbnailHeight: number;
  /** Blurhash of the thumbnail, the placeholder shown until it loads. */
  blurhash: string;
  /** Bytes of every full-size WebP (one file or all slices). */
  bytes: number;
  thumbnailBytes: number;
}

export interface PageImages {
  version: 1;
  sliceHeight: number;
  /** Keyed by the manifest's own file reference (e.g. "blocks/d-00-hero.jpg", "desktop.jpg"). */
  images: Record<string, ImageRecord>;
}

export type Stage = "read" | "convert" | "upload" | "manifest";
export interface Failure { file: string; stage: Stage; key?: string; error: string }

export interface Audit {
  startedAt: string;
  finishedAt: string;
  sliceHeight: number;
  manifests: { total: number; ok: number; failed: number };
  images: { total: number; ok: number; failed: number; sliced: number; slices: number };
  uploads: { total: number; ok: number; failed: number; bytes: number };
  failures: Failure[];
}

/** Row ranges for an image `height` tall: one range if it fits, else consecutive ranges of at most `sliceHeight`. */
export function planSlices(height: number, sliceHeight = DEFAULT_SLICE_HEIGHT): { top: number; height: number }[] {
  if (!Number.isInteger(height) || height <= 0) throw new Error(`Bad image height ${height}`);
  if (!Number.isInteger(sliceHeight) || sliceHeight < 1 || sliceHeight > WEBP_MAX_DIMENSION) {
    throw new Error(`Slice height must be 1-${WEBP_MAX_DIMENSION}, got ${sliceHeight}`);
  }
  if (height <= WEBP_MAX_DIMENSION) return [{ top: 0, height }];
  const out: { top: number; height: number }[] = [];
  for (let top = 0; top < height; top += sliceHeight) out.push({ top, height: Math.min(sliceHeight, height - top) });
  return out;
}

/** "myzoobox.com/home/blocks/d-00-hero.jpg" -> "myzoobox.com/home/blocks/d-00-hero". */
export function baseKey(source: string): string {
  return source.split(sep).join("/").replace(/^\/+/, "").replace(/\.(jpe?g|png|webp)$/i, "");
}
export const webpKeyOf = (base: string) => `${base}.webp`;
export const thumbnailKeyOf = (base: string) => `${base}_thumb.webp`;
export const sliceKeyOf = (base: string, index: number) => `${base}_s${String(index).padStart(3, "0")}.webp`;

export interface Encoded {
  record: ImageRecord;
  files: { key: string; body: Buffer; contentType: string }[];
}

/** Everything one source image becomes. Pure: nothing is written or uploaded. */
export async function encodeImage(input: Buffer, source: string, sliceHeight = DEFAULT_SLICE_HEIGHT): Promise<Encoded> {
  const meta = await sharp(input, SHARP_INPUT).metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  if (!width || !height) throw new Error("Image has no dimensions");

  // Too wide for WebP: scale down to the limit. Everything below works on `working`.
  let working = input;
  let w = width;
  let h = height;
  let scale = 1;
  if (width > WEBP_MAX_DIMENSION) {
    scale = WEBP_MAX_DIMENSION / width;
    w = WEBP_MAX_DIMENSION;
    h = Math.max(1, Math.round(height * scale));
    working = await sharp(input, SHARP_INPUT).resize(w, h, { fit: "fill" }).png().toBuffer();
  }

  const base = baseKey(source);
  const files: Encoded["files"] = [];
  const plan = planSlices(h, sliceHeight);
  const slices: Slice[] = [];
  let bytes = 0;
  if (plan.length === 1) {
    const body = await sharp(working, SHARP_INPUT).webp({ quality: FULL_QUALITY }).toBuffer();
    files.push({ key: webpKeyOf(base), body, contentType: "image/webp" });
    bytes = body.length;
  } else {
    for (const [index, range] of plan.entries()) {
      const body = await sharp(working, SHARP_INPUT)
        .extract({ left: 0, top: range.top, width: w, height: range.height })
        .webp({ quality: FULL_QUALITY })
        .toBuffer();
      const key = sliceKeyOf(base, index);
      files.push({ key, body, contentType: "image/webp" });
      slices.push({ index, key, top: range.top, width: w, height: range.height, bytes: body.length });
      bytes += body.length;
    }
  }

  // Thumbnail: 600 wide (never enlarged), the top of the image when it would be taller than 1200.
  const thumbWidth = Math.min(THUMB_WIDTH, w);
  const fullThumbHeight = Math.max(1, Math.round((h * thumbWidth) / w));
  const thumbHeight = Math.min(fullThumbHeight, THUMB_MAX_HEIGHT);
  const sourceRows = Math.min(h, Math.ceil((thumbHeight * w) / thumbWidth));
  const thumb = await sharp(working, SHARP_INPUT)
    .extract({ left: 0, top: 0, width: w, height: sourceRows })
    .resize(thumbWidth, thumbHeight, { fit: "fill" })
    .webp({ quality: THUMB_QUALITY })
    .toBuffer();
  files.push({ key: thumbnailKeyOf(base), body: thumb, contentType: "image/webp" });

  return {
    record: {
      source: source.split(sep).join("/"),
      width, height, scale,
      webpKey: plan.length === 1 ? webpKeyOf(base) : null,
      slices,
      thumbnailKey: thumbnailKeyOf(base),
      thumbnailWidth: thumbWidth,
      thumbnailHeight: thumbHeight,
      blurhash: await blurhashOf(thumb),
      bytes,
      thumbnailBytes: thumb.length,
    },
    files,
  };
}

/** Deterministic 4x3 blurhash from a 32x32 sample. */
export async function blurhashOf(image: Buffer): Promise<string> {
  const { data, info } = await sharp(image, SHARP_INPUT).resize(32, 32, { fit: "fill" }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return blurhashEncode(new Uint8ClampedArray(data), info.width, info.height, 4, 3);
}

export function emptyAudit(sliceHeight: number): Audit {
  return {
    startedAt: new Date().toISOString(), finishedAt: "", sliceHeight,
    manifests: { total: 0, ok: 0, failed: 0 },
    images: { total: 0, ok: 0, failed: 0, sliced: 0, slices: 0 },
    uploads: { total: 0, ok: 0, failed: 0, bytes: 0 },
    failures: [],
  };
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * One manifest: every viewport screenshot and block image, encoded and uploaded,
 * then images.json written next to the manifest and uploaded beside the images.
 * An image counts as done only when every one of its files uploaded. Failures
 * are recorded in the audit and never stop the other images.
 */
export async function processManifest(manifestPath: string, root: string, storage: Storage, audit: Audit, sliceHeight = DEFAULT_SLICE_HEIGHT): Promise<PageImages | null> {
  audit.manifests.total += 1;
  const rel = (p: string) => relative(root, p).split(sep).join("/");
  let manifest: Manifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Manifest;
  } catch (e) {
    audit.manifests.failed += 1;
    audit.failures.push({ file: rel(manifestPath), stage: "manifest", error: errorText(e) });
    return null;
  }

  const dir = dirname(manifestPath);
  const refs = [
    ...(["desktop", "mobile"] as const).map((vp) => manifest.viewports[vp]).flatMap((v) => (v && "file" in v && v.file ? [v.file] : [])),
    ...manifest.blocks.flatMap((b) => (b.file ? [b.file] : [])),
  ];
  const page: PageImages = { version: 1, sliceHeight, images: {} };
  let failedHere = 0;

  for (const ref of [...new Set(refs)]) {
    audit.images.total += 1;
    const path = resolve(dir, ref);
    const source = rel(path);
    let encoded: Encoded;
    try {
      const input = await readFile(path).catch((e) => { throw Object.assign(new Error(errorText(e)), { stage: "read" as const }); });
      encoded = await encodeImage(input, source, sliceHeight);
    } catch (e) {
      audit.images.failed += 1;
      failedHere += 1;
      audit.failures.push({ file: source, stage: (e as { stage?: Stage }).stage ?? "convert", error: errorText(e) });
      continue;
    }

    let uploaded = true;
    for (const f of encoded.files) {
      audit.uploads.total += 1;
      try {
        await storage.put(f.key, f.body, f.contentType);
        audit.uploads.ok += 1;
        audit.uploads.bytes += f.body.length;
      } catch (e) {
        uploaded = false;
        audit.uploads.failed += 1;
        audit.failures.push({ file: source, stage: "upload", key: f.key, error: errorText(e) });
      }
    }
    if (!uploaded) {
      audit.images.failed += 1;
      failedHere += 1;
      continue;
    }
    audit.images.ok += 1;
    if (encoded.record.slices.length) {
      audit.images.sliced += 1;
      audit.images.slices += encoded.record.slices.length;
    }
    page.images[ref] = encoded.record;
  }

  // The index lists only what made it to storage, so a consumer never points at a missing object.
  const body = Buffer.from(JSON.stringify(page, null, 2) + "\n");
  await writeFile(resolve(dir, "images.json"), body);
  const indexKey = `${rel(dir)}/images.json`;
  audit.uploads.total += 1;
  try {
    await storage.put(indexKey, body, "application/json");
    audit.uploads.ok += 1;
    audit.uploads.bytes += body.length;
  } catch (e) {
    failedHere += 1;
    audit.uploads.failed += 1;
    audit.failures.push({ file: rel(manifestPath), stage: "upload", key: indexKey, error: errorText(e) });
  }

  if (failedHere) audit.manifests.failed += 1;
  else audit.manifests.ok += 1;
  return page;
}
