// Image pipeline: JPEG → WebP (full + thumbnail) + blurhash → R2
//
//   npm run image-process -- data/myzoobox.com
//
// Processes all JPEG files in a manifest directory:
// - Converts full-size and block JPEGs to WebP (quality 80)
// - Generates 600px thumbnail
// - Generates blurhash for each image
// - Uploads to R2, returns stable keys

import { readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, basename, resolve, sep, relative } from "node:path";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { encode as blurhashEncode } from "blurhash";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import type { Manifest } from "../web/src/contracts/manifest.js";

const R2_ACCESS_KEY = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_KEY = process.env.R2_SECRET_ACCESS_KEY;
const R2_BUCKET = process.env.R2_BUCKET ?? "sectionary-blocks";
const R2_ENDPOINT = process.env.R2_ENDPOINT ?? "https://YOUR-ACCOUNT.r2.googleapis.com";
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL ?? "https://blocks.sectionary.design";

if (!R2_ACCESS_KEY || !R2_SECRET_KEY) {
  console.error("R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY env vars required");
  process.exit(1);
}

interface ProcessedImage {
  key: string; // stable R2 key: site/page/filename
  webpKey: string; // full-size WebP key
  thumbnailKey: string; // 600px thumbnail WebP key
  blurhash: string; // blurhash of full-size image
  width: number;
  height: number;
  thumbnailWidth: number;
  thumbnailHeight: number;
  bytes: number;
  thumbnailBytes: number;
}

interface UploadTracker {
  totalFiles: number;
  successCount: number;
  failureCount: number;
  totalBytes: number;
  startTime: number;
}

const s3 = new S3Client({
  region: "auto",
  endpoint: R2_ENDPOINT,
  credentials: { accessKeyId: R2_ACCESS_KEY, secretAccessKey: R2_SECRET_KEY },
});

const tracker: UploadTracker = {
  totalFiles: 0,
  successCount: 0,
  failureCount: 0,
  totalBytes: 0,
  startTime: Date.now(),
};

// Deterministic blurhash from image pixels
async function generateBlurhash(buffer: Buffer): Promise<string> {
  const img = sharp(buffer);
  const metadata = await img.metadata();
  const width = metadata.width ?? 100;
  const height = metadata.height ?? 100;

  // Resize to 100x100 for blurhash computation (fast & small)
  const resized = await sharp(buffer)
    .resize(100, 100, { fit: "fill" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  // blurhash components: x=4, y=3
  return blurhashEncode(new Uint8ClampedArray(resized.data), resized.info.width, resized.info.height, 4, 3);
}

// Generate stable R2 key based on path and content
function generateR2Key(
  manifestPath: string,
  root: string,
  jpegFile: string,
  format: "webp" | "thumbnail" | "blurhash"
): string {
  const local = relative(root, resolve(dirname(manifestPath), jpegFile))
    .split(sep)
    .join("/");

  // Extract site/page from path: fixtures/manifests/myzoobox.com/home/manifest.json
  // → myzoobox.com/home/blocks/d-00-hero.webp
  const parts = local.split("/");
  parts[parts.length - 1] = parts[parts.length - 1]
    .replace(/\.jpg$/, "")
    .replace(/\.jpeg$/, "");

  if (format === "webp") {
    parts[parts.length - 1] = parts[parts.length - 1] + ".webp";
  } else if (format === "thumbnail") {
    parts[parts.length - 1] = parts[parts.length - 1] + "_thumb.webp";
  }

  return parts.join("/");
}

async function processImage(
  jpegPath: string,
  manifestPath: string,
  root: string
): Promise<ProcessedImage | null> {
  try {
    const jpegBuffer = await readFile(jpegPath);
    const metadata = await sharp(jpegBuffer).metadata();
    const width = metadata.width ?? 0;
    const height = metadata.height ?? 0;

    // Generate blurhash from original JPEG
    const blurhash = await generateBlurhash(jpegBuffer);

    // Convert to WebP (full size)
    const webpBuffer = await sharp(jpegBuffer).webp({ quality: 80 }).toBuffer();

    // Generate thumbnail (600px width, maintain aspect)
    const thumbnailBuffer = await sharp(jpegBuffer)
      .resize(600, 600, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 75 })
      .toBuffer();

    const thumbnailMetadata = await sharp(thumbnailBuffer).metadata();
    const thumbWidth = thumbnailMetadata.width ?? 600;
    const thumbHeight = thumbnailMetadata.height ?? 600;

    const key = generateR2Key(manifestPath, root, jpegPath, "webp").replace(
      /\.webp$/,
      ""
    );
    const webpKey = key + ".webp";
    const thumbnailKey = key + "_thumb.webp";

    return {
      key,
      webpKey,
      thumbnailKey,
      blurhash,
      width,
      height,
      thumbnailWidth: thumbWidth,
      thumbnailHeight: thumbHeight,
      bytes: webpBuffer.length,
      thumbnailBytes: thumbnailBuffer.length,
    };
  } catch (e) {
    console.error(`  Failed to process ${jpegPath}: ${(e as Error).message}`);
    return null;
  }
}

async function uploadToR2(
  key: string,
  buffer: Buffer,
  contentType: string
): Promise<boolean> {
  try {
    const upload = new Upload({
      client: s3,
      params: {
        Bucket: R2_BUCKET,
        Key: key,
        Body: buffer,
        ContentType: contentType,
      },
    });

    await upload.done();
    tracker.successCount++;
    tracker.totalBytes += buffer.length;
    return true;
  } catch (e) {
    console.error(`  R2 upload failed for ${key}: ${(e as Error).message}`);
    tracker.failureCount++;
    return false;
  }
}

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

async function processManifest(
  manifestPath: string,
  root: string
): Promise<{ site: string; page: string; blocks: ProcessedImage[] }> {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Manifest;
  const site = manifest.site.host;
  const page = manifest.page.slug;

  console.log(
    `Processing ${site}/${page} (${manifest.blocks.length} blocks)...`
  );

  const blocks: ProcessedImage[] = [];
  const blockDir = dirname(manifestPath);

  // Process full-page screenshots
  for (const viewport of ["desktop", "mobile"] as const) {
    const vp = manifest.viewports[viewport];
    if (vp && "file" in vp && vp.file) {
      const jpegPath = resolve(blockDir, vp.file);
      const processed = await processImage(jpegPath, manifestPath, root);
      if (processed) {
        // Upload full-size
        const jpegBuffer = await readFile(jpegPath);
        const webpBuffer = await sharp(jpegBuffer).webp({ quality: 80 }).toBuffer();
        await uploadToR2(processed.webpKey, webpBuffer, "image/webp");

        // Upload thumbnail
        const thumbBuffer = await sharp(jpegBuffer)
          .resize(600, 600, { fit: "inside", withoutEnlargement: true })
          .webp({ quality: 75 })
          .toBuffer();
        await uploadToR2(processed.thumbnailKey, thumbBuffer, "image/webp");

        blocks.push(processed);
        console.log(`  ✓ ${viewport} screenshot uploaded`);
      }
    }
  }

  // Process block screenshots
  for (const block of manifest.blocks) {
    if (block.file) {
      const jpegPath = resolve(blockDir, block.file);
      const processed = await processImage(jpegPath, manifestPath, root);
      if (processed) {
        // Upload full-size
        const jpegBuffer = await readFile(jpegPath);
        const webpBuffer = await sharp(jpegBuffer).webp({ quality: 80 }).toBuffer();
        await uploadToR2(processed.webpKey, webpBuffer, "image/webp");

        // Upload thumbnail
        const thumbBuffer = await sharp(jpegBuffer)
          .resize(600, 600, { fit: "inside", withoutEnlargement: true })
          .webp({ quality: 75 })
          .toBuffer();
        await uploadToR2(processed.thumbnailKey, thumbBuffer, "image/webp");

        blocks.push(processed);
      }
    }
  }

  return { site, page, blocks };
}

async function generateAuditManifest(
  input: string,
  output: string
): Promise<void> {
  const now = new Date().toISOString().split("T")[0];
  const elapsed = Date.now() - tracker.startTime;

  const auditData = {
    timestamp: new Date().toISOString(),
    date: now,
    totalFiles: tracker.totalFiles,
    successCount: tracker.successCount,
    failureCount: tracker.failureCount,
    totalBytes: tracker.totalBytes,
    totalMB: (tracker.totalBytes / 1024 / 1024).toFixed(2),
    elapsedMs: elapsed,
    elapsedSeconds: (elapsed / 1000).toFixed(1),
    bucket: R2_BUCKET,
    publicUrl: R2_PUBLIC_URL,
  };

  await writeFile(
    resolve(output, `_audit-${now}.json`),
    JSON.stringify(auditData, null, 2)
  );

  console.log(`\nAudit manifest written to ${output}/_audit-${now}.json`);
  console.log(`  Files: ${auditData.successCount}/${auditData.totalFiles}`);
  console.log(`  Bytes: ${auditData.totalMB} MB`);
  console.log(`  Time: ${auditData.elapsedSeconds}s`);
}

async function main(): Promise<void> {
  const input = resolve(process.argv[2] ?? "fixtures/manifests");
  const output = resolve(process.argv[3] ?? "data/images");

  const manifestPaths = await manifestsAt(input);
  if (!manifestPaths.length) {
    console.error(`No manifest.json files found under ${input}`);
    process.exit(1);
  }

  const root = (await import("node:fs/promises").then((fs) => fs.stat(input)))
    .isDirectory()
    ? input
    : dirname(input);

  console.log(`Processing ${manifestPaths.length} manifests...`);
  console.log(`R2 Bucket: ${R2_BUCKET}`);
  console.log(`Public URL: ${R2_PUBLIC_URL}\n`);

  tracker.totalFiles = manifestPaths.length;

  for (const manifestPath of manifestPaths) {
    try {
      await processManifest(manifestPath, root);
    } catch (e) {
      console.error(
        `Failed to process ${manifestPath}: ${(e as Error).message}`
      );
      tracker.failureCount++;
    }
  }

  await generateAuditManifest(input, output);
  process.exit(tracker.failureCount > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
