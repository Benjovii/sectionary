// Image pipeline (SEC-9): JPEG -> WebP (full, or slices when taller than WebP
// allows) + 600px thumbnail + blurhash -> S3-compatible object storage.
//
//   npm run image-process -- data/myzoobox.com            # audit to data/images
//   npm run image-process -- data/myzoobox.com out/dir    # audit elsewhere
//
// The work is in src/images.ts (slicing, keys, images.json); this file reads the
// S3_* settings and uploads. Every page gets an images.json next to its
// manifest, which platform/src/import.ts reads. A run ends with
// <out>/_audit-<timestamp>.json and exits 1 if any image, upload or manifest failed.
//
// IMAGE_SLICE_HEIGHT (default 8192, at most 16383) sets the slice height.

import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { S3Client, PutObjectCommand, type ObjectCannedACL } from "@aws-sdk/client-s3";
import { DEFAULT_SLICE_HEIGHT, emptyAudit, processManifest, type Storage } from "./images.js";

// Same S3_* names as platform/.env, so the importer's S3_PUBLIC_BASE_URL matches what was uploaded.
try { process.loadEnvFile(resolve(import.meta.dirname, "../.env")); } catch {}

async function manifestsAt(input: string): Promise<string[]> {
  if ((await stat(input)).isFile()) return [input];
  const found: string[] = [];
  for (const entry of await readdir(input, { withFileTypes: true })) {
    const path = resolve(input, entry.name);
    if (entry.isDirectory()) found.push(...await manifestsAt(path));
    else if (entry.name === "manifest.json") found.push(path);
  }
  return found.sort();
}

function s3Storage(): { storage: Storage; bucket: string; publicUrl: string } {
  const names = ["S3_ENDPOINT", "S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY", "S3_PUBLIC_BASE_URL"] as const;
  const missing = names.filter((name) => !process.env[name]);
  if (missing.length) {
    console.error(`Missing ${missing.join(", ")}. Set them in .env (see .env.example); there are no defaults.`);
    process.exit(1);
  }
  const bucket = process.env.S3_BUCKET!;
  const s3 = new S3Client({
    region: process.env.S3_REGION || "auto",
    endpoint: process.env.S3_ENDPOINT!,
    credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID!, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY! },
    maxAttempts: 4, // the SDK backs off and retries throttling and 5xx
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true", // MinIO and other local S3s
  });
  // DigitalOcean Spaces (and S3) keep an upload private unless it says otherwise,
  // so the site's <img> tags would get 403; R2 ignores ACLs and is public by bucket setting.
  const ACL = (process.env.S3_ACL || undefined) as ObjectCannedACL | undefined;
  return {
    bucket,
    publicUrl: process.env.S3_PUBLIC_BASE_URL!.replace(/\/$/, ""),
    storage: { put: async (Key, Body, ContentType) => { await s3.send(new PutObjectCommand({ Bucket: bucket, Key, Body, ContentType, ACL, CacheControl: "public, max-age=86400" })); } },
  };
}

const input = resolve(process.argv[2] ?? "fixtures/manifests");
const output = resolve(process.argv[3] ?? "data/images");
const sliceHeight = Number(process.env.IMAGE_SLICE_HEIGHT || DEFAULT_SLICE_HEIGHT);

const manifestPaths = await manifestsAt(input);
if (!manifestPaths.length) {
  console.error(`No manifest.json files found under ${input}`);
  process.exit(1);
}
// Same root rule as the importer, so both derive the same keys.
const root = (await stat(input)).isDirectory() ? input : dirname(input);
const { storage, bucket, publicUrl } = s3Storage();
const audit = emptyAudit(sliceHeight);
console.log(`Processing ${manifestPaths.length} manifests into ${bucket} (${publicUrl}), slices of ${sliceHeight}px...`);

for (const manifestPath of manifestPaths) {
  const page = await processManifest(manifestPath, root, storage, audit, sliceHeight);
  const sliced = page ? Object.values(page.images).filter((i) => i.slices.length).length : 0;
  console.log(`  ${manifestPath.slice(root.length + 1)}: ${page ? Object.keys(page.images).length : 0} images${sliced ? `, ${sliced} sliced` : ""}`);
}
audit.finishedAt = new Date().toISOString();

await mkdir(output, { recursive: true });
const auditPath = resolve(output, `_audit-${audit.startedAt.replace(/[:.]/g, "-")}.json`);
await writeFile(auditPath, JSON.stringify({ ...audit, bucket, publicUrl }, null, 2));
console.log(`\nAudit: ${auditPath}`);
console.log(`  Manifests: ${audit.manifests.ok}/${audit.manifests.total} ok`);
console.log(`  Images: ${audit.images.ok}/${audit.images.total} ok, ${audit.images.sliced} sliced into ${audit.images.slices} slices`);
console.log(`  Uploads: ${audit.uploads.ok}/${audit.uploads.total} ok, ${(audit.uploads.bytes / 1024 / 1024).toFixed(2)} MB`);
for (const f of audit.failures.slice(0, 20)) console.error(`  FAILED ${f.stage} ${f.file}${f.key ? ` -> ${f.key}` : ""}: ${f.error}`);
process.exit(audit.failures.length ? 1 : 0);
