// The infrastructure smoke test (Ops task "Set up the infrastructure
// accounts"): one capture on this machine, uploaded to the block bucket, read
// back through the public URL. Done when it prints PASS on the VPS.
//
//   npm run hello-capture                       # captures https://example.com
//   npm run hello-capture -- https://our-own-site.example
//
// Captures our own or a neutral page only: the crawler rules (CONTRIBUTING.md)
// still apply, and third-party stores are captured by the crawler alone.
//
// Settings come from the environment: the S3_* values of .env.example. On the
// VPS they live outside the repo in /etc/sectionary/sectionary.env (see
// ops/vps-setup.sh); SECTIONARY_ENV points somewhere else, and a repo .env is
// the fallback on a PC. Nothing secret is printed.

import { existsSync } from "node:fs";
import { hostname } from "node:os";
import { resolve } from "node:path";
import { PutObjectCommand, S3Client, type ObjectCannedACL } from "@aws-sdk/client-s3";
import { chromium } from "playwright";
import sharp from "sharp";

for (const file of [process.env.SECTIONARY_ENV, "/etc/sectionary/sectionary.env", resolve(import.meta.dirname, "../.env")]) {
  if (file && existsSync(file)) {
    process.loadEnvFile(file);
    console.log(`Settings: ${file}`);
    break;
  }
}

const missing = ["S3_ENDPOINT", "S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY", "S3_PUBLIC_BASE_URL"].filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`FAIL  missing settings: ${missing.join(", ")}`);
  process.exit(1);
}

const url = process.argv[2] ?? "https://example.com";
const step = (s: string) => console.log(`...   ${s}`);

step(`capturing ${url} at 1440px`);
const browser = await chromium.launch();
let png: Buffer;
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await page.goto(url, { waitUntil: "load", timeout: 30_000 });
  png = await page.screenshot({ fullPage: false });
} finally {
  await browser.close();
}
const webp = await sharp(png).webp({ quality: 80 }).toBuffer();
step(`screenshot ${png.length} bytes, WebP ${webp.length} bytes`);

const key = `hello/${hostname().replace(/[^a-z0-9-]/gi, "-").toLowerCase()}-${new Date().toISOString().replace(/[:.]/g, "-")}.webp`;
const s3 = new S3Client({
  region: process.env.S3_REGION || "auto",
  endpoint: process.env.S3_ENDPOINT,
  credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID!, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY! },
  forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
});
step(`uploading to bucket ${process.env.S3_BUCKET} as ${key}`);
await s3.send(new PutObjectCommand({
  Bucket: process.env.S3_BUCKET, Key: key, Body: webp, ContentType: "image/webp",
  ACL: (process.env.S3_ACL || undefined) as ObjectCannedACL | undefined, CacheControl: "public, max-age=300",
}));

const publicUrl = `${process.env.S3_PUBLIC_BASE_URL!.replace(/\/$/, "")}/${key}`;
step(`reading back ${publicUrl}`);
const res = await fetch(publicUrl);
const body = Buffer.from(await res.arrayBuffer());
if (res.ok && body.equals(webp)) {
  console.log(`PASS  ${publicUrl}`);
} else {
  console.error(`FAIL  HTTP ${res.status}, ${body.length} bytes back (expected ${webp.length}). Private bucket? Set S3_ACL=public-read for DigitalOcean Spaces.`);
  process.exit(1);
}
