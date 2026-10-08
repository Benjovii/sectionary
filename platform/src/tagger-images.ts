// Block screenshots for the tagger, read from object storage.
//
// blocks.image_key is what the importer recorded: a public URL under
// S3_PUBLIC_BASE_URL, or a root-relative key ("/site/page/blocks/d-00-hero.webp")
// when that was unset. In order of preference:
//   1. S3 credentials set (S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY):
//      GetObject straight from the bucket, which also works for a private bucket.
//   2. An absolute image_key: fetched over HTTP.
//   3. TAGGER_IMAGE_BASE_URL set: fetched from <base>/<key>.
// A block whose screenshot cannot be read is not submitted (the tagger needs the
// screenshot, not just the text) and is listed in the report.

import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import sharp from "sharp";
import { IMAGE_MAX_SIDE, type PreparedImage } from "./tagging.js";

export type ImageSource = (imageKey: string) => Promise<Buffer>;

export function imageSource(env: NodeJS.ProcessEnv = process.env): ImageSource {
  const publicBase = env.S3_PUBLIC_BASE_URL?.replace(/\/$/, "");
  const keyOf = (imageKey: string) => (publicBase && imageKey.startsWith(`${publicBase}/`) ? imageKey.slice(publicBase.length + 1) : imageKey.replace(/^\/+/, ""));

  if (env.S3_ENDPOINT && env.S3_BUCKET && env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY) {
    const s3 = new S3Client({
      region: env.S3_REGION || "auto", endpoint: env.S3_ENDPOINT, maxAttempts: 4, forcePathStyle: env.S3_FORCE_PATH_STYLE === "true",
      credentials: { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY },
    });
    return async (imageKey) => {
      if (/^https?:\/\//.test(imageKey) && !(publicBase && imageKey.startsWith(publicBase))) return httpGet(imageKey);
      const out = await s3.send(new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: keyOf(imageKey) }));
      return Buffer.from(await out.Body!.transformToByteArray());
    };
  }
  const base = env.TAGGER_IMAGE_BASE_URL?.replace(/\/$/, "");
  return async (imageKey) => {
    if (/^https?:\/\//.test(imageKey)) return httpGet(imageKey);
    if (base) return httpGet(`${base}/${keyOf(imageKey)}`);
    throw new Error("no object storage configured (set S3_* or TAGGER_IMAGE_BASE_URL)");
  };
}

async function httpGet(url: string): Promise<Buffer> {
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`${res.status} for ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

/** Fit inside IMAGE_MAX_SIDE and re-encode as WebP for the request. */
export async function prepareImage(input: Buffer): Promise<PreparedImage> {
  const { data, info } = await sharp(input, { limitInputPixels: false })
    .resize(IMAGE_MAX_SIDE, IMAGE_MAX_SIDE, { fit: "inside", withoutEnlargement: true })
    .webp({ quality: 80 })
    .toBuffer({ resolveWithObject: true });
  return { data: data.toString("base64"), mediaType: "image/webp", width: info.width, height: info.height };
}
