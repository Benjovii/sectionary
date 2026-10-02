// npm test   (node:test via tsx)
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import { BLOCK_TYPES, ECOMMERCE_BLOCK_TYPES, GLOBAL_BLOCK_TYPES, STYLE_TAGS, validateTags, type BlockTags } from "./taxonomy.js";
import {
  batchCost, blockIdOf, blockTypeAgreement, buildRequest, customIdOf, estimateRequest, inputHash, parseResult,
  planWithinCap, priceOf, resolveModel, sentSize, type BlockInput,
} from "./tagging.js";

const valid: BlockTags = {
  block_type: "subscription-picker", page_role: "conversion", style_tags: ["minimal", "photo-led"], industry: "supplements-wellness",
  description: "Subscribe & save 15% toggle with a 30/60/90-day delivery selector", patterns: ["Savings Badge", "delivery frequency dropdown"],
  has_price: true, has_reviews: false, has_video: false,
};

const block: BlockInput = {
  id: "0b5c1f7e-3c2a-4a5b-9a51-1d2e3f405162", host: "nativepet.com", pageType: "product", pageUrl: "https://nativepet.com/products/x",
  viewport: "desktop", blockIndex: 3, top: 640, height: 720, typeHint: "main-product", headline: "Probiotic Powder",
  text: "Subscribe & Save 20% One-time purchase Deliver every 30 days", buttons: 3, images: 6, videos: 0, siteIndustry: "pets",
  imageKey: "https://cdn.example/nativepet.com/products-x/blocks/d-03-main-product.webp", imageWidth: 1440, imageHeight: 720, blurhash: "LEHV6nWB2yk8pyo0adR*.7kCMdnj",
};

// ---------------------------------------------------------------- taxonomy

test("the taxonomy is PLAN.md section 8, all of it", () => {
  const plan = readFileSync(resolve(import.meta.dirname, "../../docs/PLAN.md"), "utf8");
  const section = plan.slice(plan.indexOf("## 8. Block taxonomy v1"), plan.indexOf("## 9."));
  const items = (label: string) => section.split(`${label}:`)[1].split(/\n\n/)[0].replace(/\([^)]*\)/g, "").replace(/\.\s*$/, "").split(",").map((s) => s.trim()).filter(Boolean);
  assert.equal(Object.keys(GLOBAL_BLOCK_TYPES).length, items("Global").length);
  assert.equal(Object.keys(ECOMMERCE_BLOCK_TYPES).length, items("E-commerce").length);
  assert.equal(BLOCK_TYPES.length, 47);
  assert.deepEqual([...STYLE_TAGS], items("Style"));
});

test("validateTags accepts a complete answer and normalises patterns", () => {
  const r = validateTags(valid);
  assert.ok(r.ok);
  assert.deepEqual(r.ok && r.tags.patterns, ["savings badge", "delivery frequency dropdown"]);
});

test("validateTags rejects anything outside the taxonomy or the contract", () => {
  const bad = (patch: Record<string, unknown>, expected: RegExp) => {
    const r = validateTags({ ...valid, ...patch });
    assert.equal(r.ok, false, JSON.stringify(patch));
    assert.match(!r.ok ? r.errors.join("; ") : "", expected);
  };
  bad({ block_type: "hero-banner" }, /block_type .* not in the taxonomy/);
  bad({ page_role: "above-fold" }, /page_role/);
  bad({ industry: "fashion" }, /industry/);
  bad({ style_tags: [] }, /1-3 tags/);
  bad({ style_tags: ["minimal", "bold", "dark", "pastel"] }, /1-3 tags/);
  bad({ style_tags: ["shiny"] }, /style tag "shiny"/);
  bad({ description: "two\nlines" }, /more than one line/);
  bad({ description: "x".repeat(201) }, /over 200/);
  bad({ patterns: Array(7).fill("p") }, /more than 6/);
  bad({ has_video: "yes" }, /has_video is not a boolean/);
  bad({ extra: 1 }, /unexpected field extra/);
  const { has_price: _, ...missing } = valid;
  assert.match((validateTags(missing) as { errors: string[] }).errors.join(), /missing has_price/);
  assert.equal(validateTags(null).ok, false);
});

// ---------------------------------------------------------------- models, prices, requests

test("Sonnet is the default model, Haiku the cheaper option, both from the environment", () => {
  assert.equal(resolveModel({}), "claude-sonnet-5-5");
  assert.equal(resolveModel({ TAGGER_MODEL: "haiku" }), "claude-haiku-4-5");
  assert.equal(resolveModel({ TAGGER_MODEL: "sonnet", TAGGER_SONNET_MODEL: "claude-sonnet-6" }), "claude-sonnet-6");
  assert.equal(resolveModel({ TAGGER_MODEL: "claude-opus-5-5" }), "claude-opus-5-5");
});

test("prices: known models, env override, and no price means no submission", () => {
  assert.deepEqual(priceOf("claude-sonnet-5-5", {}), { input: 2, output: 10 });
  assert.deepEqual(priceOf("claude-haiku-4-5", {}), { input: 1, output: 5 });
  assert.deepEqual(priceOf("claude-x", { TAGGER_PRICE_INPUT: "3", TAGGER_PRICE_OUTPUT: "15" }), { input: 3, output: 15 });
  assert.throws(() => priceOf("claude-unknown-9", {}), /TAGGER_PRICE_INPUT/);
});

test("batch cost is half the list price, with cache writes and reads priced", () => {
  const price = { input: 2, output: 10 };
  assert.equal(batchCost({ input_tokens: 1e6, output_tokens: 0 }, price), 1);
  assert.equal(batchCost({ input_tokens: 0, output_tokens: 1e6 }, price), 5);
  assert.equal(batchCost({ input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 1e6, cache_read_input_tokens: 1e6 }, price), 1.25 + 0.1);
});

test("custom ids round-trip to block ids and fit the Batch API's pattern", () => {
  const id = customIdOf(block.id);
  assert.match(id, /^[a-zA-Z0-9_-]{1,64}$/);
  assert.equal(blockIdOf(id), block.id);
  assert.throws(() => blockIdOf("tag-123"));
});

test("a request carries the screenshot, the cached system prompt and the taxonomy schema", () => {
  const image = { data: "UklGRg==", mediaType: "image/webp" as const, width: 1024, height: 512 };
  const sonnet = buildRequest(block, image, "claude-sonnet-5-5", {});
  assert.equal(sonnet.custom_id, customIdOf(block.id));
  assert.equal(sonnet.params.model, "claude-sonnet-5-5");
  assert.deepEqual(sonnet.params.thinking, { type: "between_tools" });
  const system = sonnet.params.system as Anthropic.Messages.TextBlockParam[];
  assert.deepEqual(system[0].cache_control, { type: "ephemeral" });
  const content = sonnet.params.messages[0].content as Anthropic.Messages.ContentBlockParam[];
  assert.equal(content[0].type, "image");
  assert.deepEqual((content[0] as Anthropic.Messages.ImageBlockParam).source, { type: "base64", media_type: "image/webp", data: "UklGRg==" });
  assert.match((content[1] as Anthropic.Messages.TextBlockParam).text, /Theme section hint: main-product/);
  const schema = sonnet.params.output_config?.format?.schema as { properties: { block_type: { enum: string[] } } };
  assert.equal(schema.properties.block_type.enum.length, 47);
  assert.equal("thinking" in buildRequest(block, image, "claude-haiku-4-5", {}).params, false);
});

test("the input hash changes with the inputs, the model and nothing else", () => {
  const h = inputHash(block, "claude-sonnet-5-5");
  assert.equal(inputHash({ ...block }, "claude-sonnet-5-5"), h);
  assert.notEqual(inputHash({ ...block, text: block.text + " now 25%" }, "claude-sonnet-5-5"), h);
  assert.notEqual(inputHash({ ...block, imageKey: "other.webp" }, "claude-sonnet-5-5"), h);
  assert.notEqual(inputHash(block, "claude-haiku-4-5"), h);
});

// ---------------------------------------------------------------- cost cap

test("the cost cap stops submission before the estimate would cross it", () => {
  const costs = [0.4, 0.4, 0.4, 0.4];
  assert.deepEqual(planWithinCap(costs, (c) => c, 0, 1).accepted.length, 2);
  const plan = planWithinCap(costs, (c) => c, 0.5, 1.3);
  assert.equal(plan.accepted.length, 2);
  assert.equal(plan.deferred.length, 2);
  assert.ok(Math.abs(plan.estimatedUsd - 0.8) < 1e-9);
  assert.equal(planWithinCap(costs, (c) => c, 2, 1).accepted.length, 0); // already over: nothing
  assert.equal(planWithinCap([0.5, 0.5], (c) => c, 0, 1).accepted.length, 2); // exactly at the cap is allowed
});

test("estimated cost of 30,000 typical blocks on Sonnet is under $150, Haiku about half", () => {
  // The estimate prices the system prompt as uncached and output at 300 tokens, so it errs high.
  const desktop = estimateRequest(block, sentSize(1440, 720), priceOf("claude-sonnet-5-5", {}), 300);
  const mobile = estimateRequest({ ...block, viewport: "mobile" }, sentSize(390, 1100), priceOf("claude-sonnet-5-5", {}), 300);
  const sonnet30k = 15000 * (desktop.usd + mobile.usd);
  assert.ok(sonnet30k < 150, `Sonnet estimate ${sonnet30k}`);
  const haiku = estimateRequest(block, sentSize(1440, 720), priceOf("claude-haiku-4-5", {}), 300);
  assert.ok(Math.abs(haiku.usd / desktop.usd - 0.5) < 1e-9);
  assert.deepEqual(sentSize(1440, 720), { width: 1024, height: 512 });
  assert.deepEqual(sentSize(390, 300), { width: 390, height: 300 });
});

// ---------------------------------------------------------------- results

const usage = { input_tokens: 1800, output_tokens: 160, cache_creation_input_tokens: 0, cache_read_input_tokens: 1500 };
function succeeded(text: string, stop_reason = "end_turn"): Anthropic.Messages.Batches.MessageBatchResult {
  return { type: "succeeded", message: { id: "msg", type: "message", role: "assistant", model: "claude-sonnet-5-5", stop_reason, stop_sequence: null, content: [{ type: "text", text, citations: null }], usage } } as unknown as Anthropic.Messages.Batches.MessageBatchResult;
}

test("a valid answer parses into tags with its usage", () => {
  const r = parseResult(succeeded(JSON.stringify(valid)));
  assert.equal(r.status, "succeeded");
  assert.equal(r.status === "succeeded" && r.tags.block_type, "subscription-picker");
  assert.deepEqual(r.usage, usage);
  assert.equal(parseResult(succeeded("```json\n" + JSON.stringify(valid) + "\n```")).status, "succeeded");
});

test("answers that are not valid taxonomy JSON are failures with a reason, never stored tags", () => {
  const invalid = parseResult(succeeded(JSON.stringify({ ...valid, block_type: "pricing-table" })));
  assert.equal(invalid.status, "invalid");
  assert.match((invalid as { error: string }).error, /block_type/);
  assert.match((parseResult(succeeded("I think this is a hero")) as { error: string }).error, /not JSON/);
  assert.match((parseResult(succeeded("", "refusal")) as { error: string }).error, /refusal/);
  assert.match((parseResult(succeeded('{"block_type": "he', "max_tokens")) as { error: string }).error, /max_tokens/);
});

test("errored, expired and canceled requests are partial failures to retry", () => {
  const errored = parseResult({ type: "errored", error: { type: "error", error: { type: "overloaded_error", message: "Overloaded" } } } as unknown as Anthropic.Messages.Batches.MessageBatchResult);
  assert.deepEqual(errored, { status: "errored", error: "overloaded_error: Overloaded", usage: null });
  assert.equal(parseResult({ type: "expired" }).status, "expired");
  assert.equal(parseResult({ type: "canceled" }).status, "canceled");
});

// ---------------------------------------------------------------- agreement

test("agreement counts every gold block, a missing answer is a miss", () => {
  const gold = new Map([["a", "hero"], ["b", "footer"], ["c", "faq"], ["d", "buy-box"]]);
  const predicted = new Map([["a", "hero"], ["b", "footer"], ["d", "subscription-picker"]]);
  const r = blockTypeAgreement(gold, predicted);
  assert.equal(r.total, 4);
  assert.equal(r.matched, 2);
  assert.equal(r.rate, 0.5);
  assert.deepEqual(r.confusions, [{ gold: "buy-box", predicted: "subscription-picker", count: 1 }, { gold: "faq", predicted: "(no answer)", count: 1 }]);
});
