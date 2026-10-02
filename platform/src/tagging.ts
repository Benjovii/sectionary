// AI tagger core (SEC-12): everything that does not touch the network or the
// database, so it can be tested on its own. The CLI is tagger.ts.

import { createHash } from "node:crypto";
import type Anthropic from "@anthropic-ai/sdk";
import { PROMPT_VERSION, TAGS_SCHEMA, systemPrompt, validateTags, type BlockTags } from "./taxonomy.js";

// ---------------------------------------------------------------- models and prices

/**
 * Sonnet by default, Haiku as the cheaper option. Both ids come from the
 * environment so a model change is a config change:
 *   TAGGER_MODEL=sonnet|haiku|<any model id>   (default sonnet)
 *   TAGGER_SONNET_MODEL (default claude-sonnet-5-5), TAGGER_HAIKU_MODEL (default claude-haiku-4-5)
 */
export function resolveModel(env: NodeJS.ProcessEnv = process.env): string {
  const choice = (env.TAGGER_MODEL || "sonnet").trim();
  if (choice === "sonnet") return env.TAGGER_SONNET_MODEL || "claude-sonnet-5-5";
  if (choice === "haiku") return env.TAGGER_HAIKU_MODEL || "claude-haiku-4-5";
  return choice;
}

export interface Price {
  /** Standard (non-batch) USD per million tokens. */
  input: number;
  output: number;
}

/** First-party list prices, standard rate; the Batch API bills half. Check https://claude.com/pricing when a model changes. */
const LIST_PRICES: [RegExp, Price][] = [
  [/^claude-sonnet-5-5/, { input: 2, output: 10 }],
  [/^claude-sonnet-5(?!-5)/, { input: 2, output: 10 }],
  [/^claude-haiku-4-5/, { input: 1, output: 5 }],
];
export const BATCH_DISCOUNT = 0.5;
export const CACHE_WRITE = 1.25; // x input price
export const CACHE_READ = 0.1;

/** Price per million tokens for `model`. TAGGER_PRICE_INPUT / TAGGER_PRICE_OUTPUT override; an unknown model without them has no price, and nothing is submitted. */
export function priceOf(model: string, env: NodeJS.ProcessEnv = process.env): Price {
  if (env.TAGGER_PRICE_INPUT && env.TAGGER_PRICE_OUTPUT) return { input: Number(env.TAGGER_PRICE_INPUT), output: Number(env.TAGGER_PRICE_OUTPUT) };
  const hit = LIST_PRICES.find(([re]) => re.test(model));
  if (!hit) throw new Error(`No price known for ${model}; set TAGGER_PRICE_INPUT and TAGGER_PRICE_OUTPUT (USD per million tokens, standard rate) so the cost cap can be enforced`);
  return hit[1];
}

export interface Usage { input_tokens: number; output_tokens: number; cache_creation_input_tokens?: number | null; cache_read_input_tokens?: number | null }

/** What a batch request with this usage costs, in USD. */
export function batchCost(usage: Usage, price: Price): number {
  const perToken = (p: number) => (p * BATCH_DISCOUNT) / 1e6;
  return usage.input_tokens * perToken(price.input)
    + (usage.cache_creation_input_tokens ?? 0) * perToken(price.input) * CACHE_WRITE
    + (usage.cache_read_input_tokens ?? 0) * perToken(price.input) * CACHE_READ
    + usage.output_tokens * perToken(price.output);
}

// ---------------------------------------------------------------- requests

/** Screenshots are sent at most this size on each side; detail beyond it does not change the label and costs tokens. */
export const IMAGE_MAX_SIDE = 1024;
export const MAX_TOKENS = 700;
const TEXT_CHARS = 700;

export interface BlockInput {
  id: string;
  host: string;
  pageType: string;
  pageUrl: string;
  viewport: string;
  blockIndex: number;
  top: number;
  height: number;
  typeHint: string;
  headline: string | null;
  text: string;
  buttons: number;
  images: number;
  videos: number;
  siteIndustry: string | null;
  imageKey: string | null;
  imageWidth: number | null;
  imageHeight: number | null;
  blurhash: string | null;
}

/** Batch custom ids allow [a-zA-Z0-9_-]{1,64}; a block uuid without dashes fits. */
export const customIdOf = (blockId: string) => `b_${blockId.replace(/-/g, "")}`;
export function blockIdOf(customId: string): string {
  const hex = customId.replace(/^b_/, "");
  if (!/^[0-9a-f]{32}$/i.test(hex)) throw new Error(`Not a tagger custom_id: ${customId}`);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** The text half of the request: what the DOM knew about the block. */
export function blockContext(b: BlockInput): string {
  const text = b.text.replace(/\s+/g, " ").trim();
  return [
    `Site: ${b.host}${b.siteIndustry && b.siteIndustry !== "other" ? ` (classified from its catalogue as ${b.siteIndustry})` : ""}`,
    `Page: ${b.pageType} page, ${b.pageUrl}`,
    `Viewport: ${b.viewport}; block ${b.blockIndex} of the page, ${Math.round(b.top)}px from the top, ${Math.round(b.height)}px tall`,
    `Theme section hint: ${b.typeHint}`,
    `Headline: ${b.headline?.trim() || "(none)"}`,
    `Contains: ${b.buttons} buttons, ${b.images} images, ${b.videos} videos`,
    `Text: ${text ? (text.length > TEXT_CHARS ? `${text.slice(0, TEXT_CHARS)}…` : text) : "(none)"}`,
  ].join("\n");
}

/** Same inputs, same hash: a block is submitted again only when its inputs, the model or the prompt changed. */
export function inputHash(b: BlockInput, model: string): string {
  const parts = [PROMPT_VERSION, model, blockContext(b), b.imageKey ?? "", b.imageWidth ?? "", b.imageHeight ?? "", b.blurhash ?? ""];
  return createHash("sha256").update(parts.join("\n")).digest("hex");
}

/** Thinking off for a classification: Haiku takes no thinking field; current Sonnet and Opus turn it off with between_tools. */
export function thinkingFor(model: string, env: NodeJS.ProcessEnv = process.env): { thinking?: Anthropic.Messages.ThinkingConfigParam } {
  if (env.TAGGER_THINKING === "adaptive") return { thinking: { type: "adaptive" } };
  if (/^claude-haiku/.test(model)) return {};
  return { thinking: { type: "between_tools" } };
}

export interface PreparedImage { data: string; mediaType: "image/webp" | "image/jpeg" | "image/png"; width: number; height: number }

export function buildRequest(b: BlockInput, image: PreparedImage, model: string, env: NodeJS.ProcessEnv = process.env): Anthropic.Messages.Batches.BatchCreateParams.Request {
  return {
    custom_id: customIdOf(b.id),
    params: {
      model,
      max_tokens: MAX_TOKENS,
      ...thinkingFor(model, env),
      // The system prompt is the same for every block: cached once per batch, read at a tenth of the price after.
      system: [{ type: "text", text: systemPrompt(), cache_control: { type: "ephemeral" } }],
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: image.mediaType, data: image.data } },
          { type: "text", text: blockContext(b) },
        ],
      }],
      output_config: { format: { type: "json_schema", schema: TAGS_SCHEMA as unknown as Record<string, unknown> } },
    },
  };
}

// ---------------------------------------------------------------- estimates and the cost cap

/** Conservative token guesses: ~3 characters a token for text, ~750 pixels a token for images. */
export const estimateTextTokens = (s: string) => Math.ceil(s.length / 3);
export const estimateImageTokens = (width: number, height: number) => Math.ceil((width * height) / 750);
/** The screenshot size actually sent, after fitting inside IMAGE_MAX_SIDE. */
export function sentSize(width: number, height: number): { width: number; height: number } {
  const scale = Math.min(1, IMAGE_MAX_SIDE / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

export interface Estimate { inputTokens: number; outputTokens: number; usd: number }

/**
 * Upper-end estimate for one request. The system prompt is priced as if it
 * were never cached (caching only lowers it), and output at
 * `expectedOutputTokens`, which the CLI raises to the average actually seen
 * once batches have come back.
 */
export function estimateRequest(b: BlockInput, sent: { width: number; height: number }, price: Price, expectedOutputTokens: number): Estimate {
  const inputTokens = estimateTextTokens(systemPrompt()) + estimateTextTokens(blockContext(b)) + estimateImageTokens(sent.width, sent.height) + 20;
  const outputTokens = Math.min(MAX_TOKENS, expectedOutputTokens);
  return { inputTokens, outputTokens, usd: batchCost({ input_tokens: inputTokens, output_tokens: outputTokens }, price) };
}

export interface CapPlan<T> { accepted: T[]; deferred: T[]; estimatedUsd: number }

/**
 * Take requests in order while `committedUsd` (spent plus still in flight) plus
 * what is taken stays within `capUsd`. Stops at the first request that would
 * cross the cap, so the cap is never exceeded by an estimate.
 */
export function planWithinCap<T>(items: T[], costOf: (item: T) => number, committedUsd: number, capUsd: number): CapPlan<T> {
  let total = committedUsd;
  const accepted: T[] = [];
  let i = 0;
  for (; i < items.length; i++) {
    const c = costOf(items[i]);
    if (total + c > capUsd) break;
    total += c;
    accepted.push(items[i]);
  }
  return { accepted, deferred: items.slice(i), estimatedUsd: total - committedUsd };
}

// ---------------------------------------------------------------- results

export type Outcome =
  | { status: "succeeded"; tags: BlockTags; usage: Usage }
  | { status: "invalid"; error: string; usage: Usage | null }
  | { status: "errored" | "expired" | "canceled"; error: string; usage: null };

/** One batch result line -> what to store. Anything that is not a valid answer in the taxonomy is a failure with a reason. */
export function parseResult(result: Anthropic.Messages.Batches.MessageBatchResult): Outcome {
  switch (result.type) {
    case "succeeded": {
      const message = result.message;
      const usage: Usage = message.usage;
      if (message.stop_reason === "refusal") return { status: "invalid", error: "refusal", usage };
      if (message.stop_reason === "max_tokens") return { status: "invalid", error: "hit max_tokens", usage };
      const text = message.content.flatMap((c) => (c.type === "text" ? [c.text] : [])).join("").trim();
      let json: unknown;
      try {
        json = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, ""));
      } catch {
        return { status: "invalid", error: `not JSON: ${text.slice(0, 120)}`, usage };
      }
      const checked = validateTags(json);
      return checked.ok ? { status: "succeeded", tags: checked.tags, usage } : { status: "invalid", error: checked.errors.join("; "), usage };
    }
    case "errored":
      return { status: "errored", error: `${result.error.error?.type ?? "error"}: ${result.error.error?.message ?? "unknown"}`, usage: null };
    case "expired":
      return { status: "expired", error: "expired before processing (24h)", usage: null };
    case "canceled":
      return { status: "canceled", error: "batch canceled", usage: null };
  }
}

// ---------------------------------------------------------------- evaluation

export interface Agreement {
  total: number;
  matched: number;
  rate: number;
  /** gold -> predicted -> count, mismatches only. */
  confusions: { gold: string; predicted: string; count: number }[];
}

/** Share of gold-labelled blocks whose predicted block_type equals the gold one. A missing prediction counts as a miss. */
export function blockTypeAgreement(gold: Map<string, string>, predicted: Map<string, string>): Agreement {
  let matched = 0;
  const confusion = new Map<string, number>();
  for (const [id, want] of gold) {
    const got = predicted.get(id) ?? "(no answer)";
    if (got === want) matched += 1;
    else confusion.set(`${want}\u0000${got}`, (confusion.get(`${want}\u0000${got}`) ?? 0) + 1);
  }
  const confusions = [...confusion].map(([k, count]) => { const [g, p] = k.split("\u0000"); return { gold: g, predicted: p, count }; })
    .sort((a, b) => b.count - a.count || a.gold.localeCompare(b.gold));
  return { total: gold.size, matched, rate: gold.size ? matched / gold.size : 0, confusions };
}
