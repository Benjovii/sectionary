// AI tagger v1: Tag blocks using Claude via Batch API
//
//   npm run tag-blocks -- --eval-create       # Create 200-block eval set
//   npm run tag-blocks -- --eval-test         # Test tagger on eval set
//   npm run tag-blocks -- --batch-submit      # Submit job to Batch API
//   npm run tag-blocks -- --batch-status JOB_ID
//   npm run tag-blocks -- --batch-retrieve JOB_ID
//
// Requires:
//   ANTHROPIC_API_KEY=...
//   DATABASE_URL=...

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { eq, isNull, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import Anthropic from "@anthropic-ai/sdk";
import {
  BLOCK_TAXONOMY,
  STYLE_TAGS,
  INDUSTRIES,
  getSystemPrompt,
  buildBatchItem,
  parseBatchResponse,
  type TaggingRequest,
  type TaggingResponse,
} from "./taxonomy.js";
import { blocks, captures } from "./schema.js";

try {
  process.loadEnvFile(resolve(import.meta.dirname, "../.env"));
} catch {}

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) throw new Error("ANTHROPIC_API_KEY required");

const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) throw new Error("DATABASE_URL required");

const client = postgres(dbUrl, { max: 1, prepare: false });
const db = drizzle(client);
const anthropic = new Anthropic({ apiKey });

interface EvalBlock {
  blockId: string;
  captureId: string;
  blockIndex: number;
  viewport: "desktop" | "mobile";
  imageKey: string;
  text: string;
  typeHint: string;
  blockType: string;
  pageRole: string;
  styleTags: string[];
  industry: string;
  description: string;
  patterns: string[];
  hasPrice: boolean;
  hasReviews: boolean;
  hasVideo: boolean;
}

// Create a stratified 200-block eval set
async function createEvalSet(): Promise<void> {
  console.log("Creating 200-block evaluation set...");

  // Sample blocks across different viewports
  const desktopBlocks = await db
    .select()
    .from(blocks)
    .where(eq(blocks.viewport, "desktop"))
    .orderBy(sql`random()`)
    .limit(100);

  const mobileBlocks = await db
    .select()
    .from(blocks)
    .where(eq(blocks.viewport, "mobile"))
    .orderBy(sql`random()`)
    .limit(100);

  const evalSet: EvalBlock[] = [
    ...desktopBlocks.map((b) => ({
      blockId: b.id,
      captureId: b.captureId,
      blockIndex: b.blockIndex,
      viewport: b.viewport as "desktop" | "mobile",
      imageKey: b.imageKey || "",
      text: b.text,
      typeHint: b.typeHint,
      blockType: "unknown", // To be filled in manually
      pageRole: "mid-page",
      styleTags: [],
      industry: "other",
      description: "",
      patterns: [],
      hasPrice: false,
      hasReviews: false,
      hasVideo: false,
    })),
    ...mobileBlocks.map((b) => ({
      blockId: b.id,
      captureId: b.captureId,
      blockIndex: b.blockIndex,
      viewport: b.viewport as "desktop" | "mobile",
      imageKey: b.imageKey || "",
      text: b.text,
      typeHint: b.typeHint,
      blockType: "unknown",
      pageRole: "mid-page",
      styleTags: [],
      industry: "other",
      description: "",
      patterns: [],
      hasPrice: false,
      hasReviews: false,
      hasVideo: false,
    })),
  ];

  const evalPath = resolve(import.meta.dirname, "../eval-set.json");
  await writeFile(evalPath, JSON.stringify(evalSet, null, 2));
  console.log(`Eval set saved to ${evalPath} (${evalSet.length} blocks)`);
  console.log(
    `\nNext: Manually tag block_type, pageRole, styleTags, industry, description, patterns, hasPrice, hasReviews, hasVideo`
  );
  console.log(`Then run: npm run tag-blocks -- --eval-test`);
}

// Test tagger on 10 random eval blocks
async function testEvalSet(): Promise<void> {
  console.log("Testing tagger on sample of eval blocks...");

  const evalPath = resolve(import.meta.dirname, "../eval-set.json");
  const evalSet = JSON.parse(await readFile(evalPath, "utf8")) as EvalBlock[];

  // Test on 10 blocks
  const sample = evalSet.sort(() => Math.random() - 0.5).slice(0, 10);

  let matches = 0;
  for (const block of sample) {
    console.log(
      `\n[${block.blockIndex}] ${block.viewport} - ${block.typeHint}`
    );
    console.log(`  Text: ${block.text.slice(0, 60)}...`);
    console.log(`  Expected block_type: ${block.blockType}`);

    // Call Claude Opus directly (not Batch)
    try {
      const resp = await anthropic.messages.create({
        model: "claude-opus-4-1",
        max_tokens: 500,
        system: getSystemPrompt(),
        messages: [
          {
            role: "user",
            content: `Analyze this block from a website.\n\nBlock context:\n- Text content: ${block.text.slice(0, 500)}\n- Block type hint: ${block.typeHint}\n- Viewport: ${block.viewport}\n\nClassify this block and return JSON.`,
          },
        ],
      });

      const respText =
        resp.content[0].type === "text" ? resp.content[0].text : "";
      const parsed = parseBatchResponse(block.blockId, respText);

      if (parsed) {
        console.log(`  Predicted block_type: ${parsed.blockType}`);
        if (parsed.blockType === block.blockType) {
          console.log("  ✓ MATCH");
          matches++;
        } else {
          console.log(`  ✗ MISMATCH`);
        }
      }
    } catch (e) {
      console.error(`  Error: ${(e as Error).message}`);
    }
  }

  const agreement = ((matches / sample.length) * 100).toFixed(1);
  console.log(`\nAgreement on sample: ${matches}/${sample.length} (${agreement}%)`);
  if (parseFloat(agreement) >= 90) {
    console.log("✓ Ready for full batch tagging!");
  } else {
    console.log(
      "✗ Refine the prompt and try again with eval-test before submitting batch."
    );
  }
}

// Submit batch job to Anthropic
async function submitBatch(): Promise<void> {
  console.log("Preparing batch submission...");

  // Get all untagged blocks
  const untaggedBlocks = await db
    .select()
    .from(blocks)
    .where(isNull(blocks.blockType))
    .limit(10000); // Start with 10k

  console.log(
    `Found ${untaggedBlocks.length} untagged blocks. Building batch requests...`
  );

  // For now, we'll simulate this since we need actual image data
  // In production, you'd fetch images from R2
  const requests = untaggedBlocks.slice(0, 100).map((b, idx) => ({
    custom_id: `tag-${b.id}`,
    params: {
      model: "claude-opus-4-1",
      max_tokens: 500,
      system: getSystemPrompt(),
      messages: [
        {
          role: "user",
          content: `Analyze this block.\n\nText: ${b.text.slice(0, 500)}\nType hint: ${b.typeHint}\nViewport: ${b.viewport}\n\nReturn JSON.`,
        },
      ],
    },
  }));

  console.log(
    `Submitting ${requests.length} blocks to Batch API (Haiku, $1.50 per 1k)...`
  );
  console.log(
    "Note: In production, you'd fetch images from R2 and include them as base64."
  );
  console.log(
    "\nTo submit a real batch, implement image fetching and base64 encoding."
  );
}

// Get batch job status
async function getBatchStatus(jobId: string): Promise<void> {
  console.log(`Checking status of batch job ${jobId}...`);
  // Implementation would use anthropic.messages.batches.retrieve(jobId)
  console.log("Batch status retrieval not yet implemented. Check Anthropic dashboard.");
}

// Retrieve batch results
async function retrieveBatchResults(jobId: string): Promise<void> {
  console.log(`Retrieving results for batch ${jobId}...`);
  // Implementation would use anthropic.messages.batches.results(jobId)
  console.log("Batch result retrieval not yet implemented.");
}

// Main
async function main(): Promise<void> {
  const cmd = process.argv[2];

  try {
    switch (cmd) {
      case "--eval-create":
        await createEvalSet();
        break;
      case "--eval-test":
        await testEvalSet();
        break;
      case "--batch-submit":
        await submitBatch();
        break;
      case "--batch-status":
        if (!process.argv[3]) throw new Error("Job ID required");
        await getBatchStatus(process.argv[3]);
        break;
      case "--batch-retrieve":
        if (!process.argv[3]) throw new Error("Job ID required");
        await retrieveBatchResults(process.argv[3]);
        break;
      default:
        console.log(`Usage:
  npm run tag-blocks -- --eval-create       # Create 200-block eval set
  npm run tag-blocks -- --eval-test         # Test tagger on 10 eval blocks
  npm run tag-blocks -- --batch-submit      # Submit full batch to Anthropic
  npm run tag-blocks -- --batch-status JOB_ID
  npm run tag-blocks -- --batch-retrieve JOB_ID`);
    }
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
