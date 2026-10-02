// npm test (web): node:test under Node's type stripping, no database.
import { test } from "node:test";
import assert from "node:assert/strict";
import { detectIntents, editDistance, intentTerms, maxEdits, sameWord, TYPE_VOCABULARY } from "./search-intent.ts";
import { BLOCK_TYPES } from "../../../platform/src/taxonomy.ts";

test("every taxonomy block type has a vocabulary, and nothing else does", () => {
  assert.deepEqual(Object.keys(TYPE_VOCABULARY).sort(), [...BLOCK_TYPES].sort());
  for (const [type, terms] of Object.entries(TYPE_VOCABULARY)) assert.ok(terms.length > 0, type);
});

test("a query naming a block type is read as that type, typos included", () => {
  assert.deepEqual(detectIntents(["subscription", "picker", "with", "savings", "badge"]), [{ type: "subscription-picker", words: ["subscription", "picker"] }]);
  assert.deepEqual(detectIntents(["subscripton", "pickr", "with", "savngs", "badge"]), [{ type: "subscription-picker", words: ["subscripton", "pickr"] }]);
  assert.deepEqual(detectIntents(["size", "guide"]), [{ type: "size-guide", words: ["size", "guide"] }]);
  assert.deepEqual(detectIntents(["hero"]), [{ type: "hero", words: ["hero"] }]);
});

test("longer names win and a word belongs to one type", () => {
  assert.deepEqual(detectIntents(["product", "reviews", "with", "star", "rating"]), [{ type: "product-reviews", words: ["product", "reviews", "rating"] }]);
  assert.deepEqual(detectIntents(["newsletter", "signup", "with", "discount"]), [{ type: "newsletter", words: ["newsletter", "signup"] }]);
});

test("half a type name, or no type at all, is no intent", () => {
  assert.deepEqual(detectIntents(["picker"]), []);
  assert.deepEqual(detectIntents(["red", "shoes"]), []);
  assert.deepEqual(detectIntents([]), []);
});

test("an intent searches the tagged type first, then the copy that marks it", () => {
  const terms = intentTerms("subscription-picker");
  assert.equal(terms[0], '"subscription-picker"');
  assert.ok(terms.includes('"subscribe & save"') && terms.includes("autoship"));
});

test("typo distance: a typo is one edit (two from eight letters), a different word is not", () => {
  assert.equal(editDistance("savngs", "savings"), 1);
  assert.equal(editDistance("subscripton", "subscription"), 1);
  assert.equal(editDistance("badge", "bad"), 2);
  assert.ok(editDistance("badge", "bad", maxEdits("badge")) > maxEdits("badge")); // so "badge" is never corrected to "bad"
  assert.equal(maxEdits("pickr"), 1);
  assert.equal(maxEdits("subscription"), 2);
  assert.ok(sameWord("reviews", "review") && sameWord("pickr", "picker") && !sameWord("cta", "cat"));
});
