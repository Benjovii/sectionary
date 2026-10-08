// npm test   (node:test via tsx)
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import {
  DEFAULT_SLICE_HEIGHT, THUMB_MAX_HEIGHT, WEBP_MAX_DIMENSION,
  emptyAudit, encodeImage, planSlices, processManifest, type PageImages, type Storage,
} from "./images.js";

/** A JPEG `width` x `height`, each horizontal band of `band` rows one solid colour from `colours`, in order. */
async function bandedJpeg(width: number, height: number, band: number, colours: [number, number, number][]): Promise<Buffer> {
  const raw = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    const [r, g, b] = colours[Math.min(colours.length - 1, Math.floor(y / band))];
    for (let x = 0; x < width; x++) raw.set([r, g, b], (y * width + x) * 3);
  }
  return sharp(raw, { raw: { width, height, channels: 3 }, limitInputPixels: false }).jpeg({ quality: 90 }).toBuffer();
}
const plainJpeg = (width: number, height: number) => bandedJpeg(width, height, height, [[200, 120, 40]]);

async function dims(webp: Buffer) {
  const m = await sharp(webp, { limitInputPixels: false }).metadata();
  return { format: m.format, width: m.width!, height: m.height! };
}
async function meanColour(webp: Buffer): Promise<[number, number, number]> {
  const { channels } = await sharp(webp, { limitInputPixels: false }).stats();
  return [channels[0].mean, channels[1].mean, channels[2].mean];
}

const RED: [number, number, number] = [230, 20, 20];
const GREEN: [number, number, number] = [20, 230, 20];
const BLUE: [number, number, number] = [20, 20, 230];

test("planSlices keeps an image that fits whole", () => {
  assert.deepEqual(planSlices(800), [{ top: 0, height: 800 }]);
  assert.deepEqual(planSlices(WEBP_MAX_DIMENSION), [{ top: 0, height: WEBP_MAX_DIMENSION }]);
});

test("planSlices cuts a tall image into contiguous slices within the WebP limit", () => {
  assert.deepEqual(planSlices(WEBP_MAX_DIMENSION + 1), [{ top: 0, height: 8192 }, { top: 8192, height: 8192 }]);
  for (const height of [20000, 30000, 61234]) {
    const slices = planSlices(height);
    assert.equal(slices[0].top, 0);
    slices.forEach((s, i) => {
      assert.ok(s.height > 0 && s.height <= WEBP_MAX_DIMENSION);
      if (i) assert.equal(s.top, slices[i - 1].top + slices[i - 1].height);
    });
    const last = slices[slices.length - 1];
    assert.equal(last.top + last.height, height);
  }
  assert.equal(planSlices(30000, 10000).length, 3);
});

test("planSlices rejects slice heights WebP cannot hold", () => {
  assert.throws(() => planSlices(20000, WEBP_MAX_DIMENSION + 1));
  assert.throws(() => planSlices(20000, 0));
  assert.throws(() => planSlices(0));
});

test("a normal image becomes one WebP, a 600px thumbnail and a blurhash", async () => {
  const { record, files } = await encodeImage(await plainJpeg(1440, 800), "shop.com/home/blocks/d-00-hero.jpg");
  assert.equal(record.webpKey, "shop.com/home/blocks/d-00-hero.webp");
  assert.equal(record.thumbnailKey, "shop.com/home/blocks/d-00-hero_thumb.webp");
  assert.deepEqual(record.slices, []);
  assert.equal(record.scale, 1);
  assert.deepEqual([record.width, record.height], [1440, 800]);
  assert.deepEqual(files.map((f) => f.key), [record.webpKey, record.thumbnailKey]);
  assert.deepEqual(await dims(files[0].body), { format: "webp", width: 1440, height: 800 });
  assert.deepEqual(await dims(files[1].body), { format: "webp", width: 600, height: 333 });
  assert.deepEqual([record.thumbnailWidth, record.thumbnailHeight], [600, 333]);
  assert.match(record.blurhash, /^[0-9A-Za-z#$%*+,\-.:;=?@[\]^_{|}~]{28}$/); // 4x3 components
});

test("a page taller than WebP allows is sliced in order and nothing is lost", async () => {
  const height = 2 * DEFAULT_SLICE_HEIGHT + 3000; // 19,384 px: WebP cannot hold it whole
  const jpeg = await bandedJpeg(48, height, DEFAULT_SLICE_HEIGHT, [RED, GREEN, BLUE]);
  const { record, files } = await encodeImage(jpeg, "shop.com/home/desktop.jpg");

  assert.equal(record.webpKey, null);
  assert.deepEqual(record.slices.map((s) => [s.index, s.key, s.top, s.height]), [
    [0, "shop.com/home/desktop_s000.webp", 0, 8192],
    [1, "shop.com/home/desktop_s001.webp", 8192, 8192],
    [2, "shop.com/home/desktop_s002.webp", 16384, 3000],
  ]);
  const byKey = new Map(files.map((f) => [f.key, f.body]));
  const expected = [RED, GREEN, BLUE];
  for (const slice of record.slices) {
    const body = byKey.get(slice.key)!;
    const d = await dims(body);
    assert.deepEqual(d, { format: "webp", width: 48, height: slice.height });
    assert.ok(d.height <= WEBP_MAX_DIMENSION);
    assert.equal(slice.bytes, body.length);
    // Each slice carries its own band: the order is the page's order.
    const mean = await meanColour(body);
    expected[slice.index].forEach((c, i) => assert.ok(Math.abs(mean[i] - c) < 25, `slice ${slice.index} channel ${i}: ${mean[i]} vs ${c}`));
  }
  assert.equal(record.bytes, record.slices.reduce((sum, s) => sum + s.bytes, 0));

  // The thumbnail is the top of the page (red), cropped at the maximum height.
  const thumb = byKey.get(record.thumbnailKey)!;
  assert.deepEqual(await dims(thumb), { format: "webp", width: 48, height: THUMB_MAX_HEIGHT });
  assert.ok((await meanColour(thumb))[0] > 200);
});

test("a full-page desktop screenshot over 16,383px encodes", async () => {
  const { record, files } = await encodeImage(await plainJpeg(1440, 17000), "shop.com/product-x/desktop.jpg");
  assert.equal(record.slices.length, 3);
  for (const f of files) {
    const d = await dims(f.body);
    assert.ok(d.width <= WEBP_MAX_DIMENSION && d.height <= WEBP_MAX_DIMENSION, f.key);
  }
  assert.deepEqual([record.thumbnailWidth, record.thumbnailHeight], [600, THUMB_MAX_HEIGHT]);
});

test("an image wider than WebP allows is scaled to the limit", async () => {
  const { record, files } = await encodeImage(await plainJpeg(WEBP_MAX_DIMENSION + 617, 40), "x/wide.jpg");
  assert.ok(record.scale < 1);
  assert.equal(record.width, WEBP_MAX_DIMENSION + 617);
  assert.equal((await dims(files[0].body)).width, WEBP_MAX_DIMENSION);
});

test("keys and blurhash are stable across runs", async () => {
  const jpeg = await bandedJpeg(64, 18000, 9000, [RED, BLUE]);
  const a = await encodeImage(jpeg, "a.com/home/mobile.jpg");
  const b = await encodeImage(jpeg, "a.com/home/mobile.jpg");
  assert.deepEqual(a.record, b.record);
  assert.deepEqual(a.files.map((f) => f.key), b.files.map((f) => f.key));
  assert.deepEqual(a.files.map((f) => f.key), ["a.com/home/mobile_s000.webp", "a.com/home/mobile_s001.webp", "a.com/home/mobile_s002.webp", "a.com/home/mobile_thumb.webp"]);
});

/** A capture directory like the crawler writes, with a manifest that names the given files. */
async function captureDir(files: Record<string, Buffer | string>, blockFiles: string[], desktop: string | null) {
  const root = await mkdtemp(join(tmpdir(), "sectionary-images-"));
  const page = join(root, "shop.com", "home");
  await mkdir(join(page, "blocks"), { recursive: true });
  for (const [name, body] of Object.entries(files)) await writeFile(join(page, name), body);
  const manifest = {
    site: { host: "shop.com" }, page: { slug: "home" },
    viewports: { desktop: desktop ? { file: desktop, width: 1440, fullHeight: 0, strategy: "full", status: 200, ms: 1 } : undefined },
    blocks: blockFiles.map((file, index) => ({ index, file })),
  };
  await writeFile(join(page, "manifest.json"), JSON.stringify(manifest));
  return { root, manifestPath: join(page, "manifest.json"), page };
}

function memoryStorage(failKeys: (key: string) => boolean = () => false) {
  const objects = new Map<string, { body: Buffer; contentType: string }>();
  const storage: Storage = {
    async put(key, body, contentType) {
      if (failKeys(key)) throw new Error("503 SlowDown");
      objects.set(key, { body, contentType });
    },
  };
  return { storage, objects };
}

test("a page uploads every asset and an images.json consumers can rebuild it from", async () => {
  const { root, manifestPath, page } = await captureDir({
    "desktop.jpg": await bandedJpeg(32, 20000, 8192, [RED, GREEN, BLUE]),
    "blocks/d-00-hero.jpg": await plainJpeg(1440, 600),
  }, ["blocks/d-00-hero.jpg"], "desktop.jpg");
  const { storage, objects } = memoryStorage();
  const audit = emptyAudit(DEFAULT_SLICE_HEIGHT);

  const result = await processManifest(manifestPath, root, storage, audit);
  assert.ok(result);
  assert.deepEqual(audit.failures, []);
  assert.deepEqual(audit.manifests, { total: 1, ok: 1, failed: 0 });
  assert.deepEqual(audit.images, { total: 2, ok: 2, failed: 0, sliced: 1, slices: 3 });
  assert.deepEqual([...objects.keys()].sort(), [
    "shop.com/home/blocks/d-00-hero.webp", "shop.com/home/blocks/d-00-hero_thumb.webp",
    "shop.com/home/desktop_s000.webp", "shop.com/home/desktop_s001.webp", "shop.com/home/desktop_s002.webp",
    "shop.com/home/desktop_thumb.webp", "shop.com/home/images.json",
  ]);
  assert.equal(audit.uploads.ok, 7);

  // The index on disk and in storage is the same, and its slices rebuild the page height in order.
  const local = JSON.parse(await readFile(join(page, "images.json"), "utf8")) as PageImages;
  assert.deepEqual(JSON.parse(objects.get("shop.com/home/images.json")!.body.toString()), local);
  const desktop = local.images["desktop.jpg"];
  assert.equal(desktop.slices.reduce((top, s) => (assert.equal(s.top, top), top + s.height), 0), 20000);
  assert.equal(local.images["blocks/d-00-hero.jpg"].webpKey, "shop.com/home/blocks/d-00-hero.webp");
});

test("read, conversion and upload failures are counted and reported, the rest still upload", async () => {
  const { root, manifestPath, page } = await captureDir({
    "blocks/d-00-ok.jpg": await plainJpeg(400, 300),
    "blocks/d-01-corrupt.jpg": "not a jpeg at all",
    "blocks/d-03-upload.jpg": await plainJpeg(400, 300),
  }, ["blocks/d-00-ok.jpg", "blocks/d-01-corrupt.jpg", "blocks/d-02-missing.jpg", "blocks/d-03-upload.jpg"], null);
  const { storage, objects } = memoryStorage((key) => key.endsWith("d-03-upload_thumb.webp"));
  const audit = emptyAudit(DEFAULT_SLICE_HEIGHT);

  await processManifest(manifestPath, root, storage, audit);
  assert.deepEqual(audit.manifests, { total: 1, ok: 0, failed: 1 });
  assert.deepEqual(audit.images, { total: 4, ok: 1, failed: 3, sliced: 0, slices: 0 });
  assert.deepEqual(audit.failures.map((f) => [f.stage, f.file.split("/").pop(), f.key?.split("/").pop()]), [
    ["convert", "d-01-corrupt.jpg", undefined],
    ["read", "d-02-missing.jpg", undefined],
    ["upload", "d-03-upload.jpg", "d-03-upload_thumb.webp"],
  ]);
  assert.equal(audit.uploads.failed, 1);
  // Only the image whose every file landed is listed for consumers.
  const local = JSON.parse(await readFile(join(page, "images.json"), "utf8")) as PageImages;
  assert.deepEqual(Object.keys(local.images), ["blocks/d-00-ok.jpg"]);
  assert.ok(objects.has("shop.com/home/blocks/d-00-ok.webp"));
});

test("an unreadable manifest is a manifest failure", async () => {
  const root = await mkdtemp(join(tmpdir(), "sectionary-images-"));
  await writeFile(join(root, "manifest.json"), "{oops");
  const audit = emptyAudit(DEFAULT_SLICE_HEIGHT);
  assert.equal(await processManifest(join(root, "manifest.json"), root, memoryStorage().storage, audit), null);
  assert.deepEqual(audit.manifests, { total: 1, ok: 0, failed: 1 });
  assert.equal(audit.failures[0].stage, "manifest");
});
