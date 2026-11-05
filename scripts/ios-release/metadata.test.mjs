import test from "node:test";
import assert from "node:assert/strict";
import { METADATA_LIMITS, metadataBlockers } from "./metadata.mjs";

const valid = () => ({ name: "Game", subtitle: "Dice", keywords: "dice", promotionalText: "Roll.", description: "Accepted copy" });
const blockersFor = (patch) => metadataBlockers({ ...valid(), ...patch });
const repeat = (text, count) => text.repeat(count);

test("each field accepts its exact maximum and rejects one more", () => {
  assert.deepEqual(metadataBlockers(valid()), []);
  for (const [field, { unit, min, max }] of Object.entries(METADATA_LIMITS)) {
    const allowed = min ? `${min} to ${max}` : `up to ${max}`;
    assert.deepEqual(blockersFor({ [field]: repeat("a", max) }), [], field);
    assert.deepEqual(blockersFor({ [field]: repeat("a", max + 1) }), [`Listing field outside limit: ${field} has ${max + 1} ${unit}; allowed ${allowed}`]);
  }
});

test("the name has Apple's two-character floor and other fields have no floor", () => {
  assert.deepEqual(blockersFor({ name: "ab" }), []);
  assert.deepEqual(blockersFor({ name: "a" }), ["Listing field outside limit: name has 1 characters; allowed 2 to 30"]);
  assert.deepEqual(blockersFor({ subtitle: "a", keywords: "a", promotionalText: "a", description: "a" }), []);
});

test("keywords count UTF-8 bytes, so multibyte text reaches the limit early", () => {
  const two = "\u00e9", three = "\u20ac", four = "\u{1F3B2}";
  for (const text of [repeat(two, 50), `a${repeat(three, 33)}`, repeat(four, 25)]) assert.deepEqual(blockersFor({ keywords: text }), [], text);
  for (const [text, bytes] of [[`a${repeat(two, 50)}`, 101], [`aa${repeat(three, 33)}`, 101], [`a${repeat(four, 25)}`, 101]]) {
    assert.ok(text.length <= 100);
    assert.deepEqual(blockersFor({ keywords: text }), [`Listing field outside limit: keywords has ${bytes} UTF-8 bytes; allowed up to 100`]);
  }
});

test("character fields do not count bytes", () => {
  const precomposed = "\u00e9";
  assert.deepEqual(blockersFor({ name: repeat(precomposed, 30), subtitle: repeat(precomposed, 30), promotionalText: repeat(precomposed, 170), description: repeat(precomposed, 4000) }), []);
  assert.deepEqual(blockersFor({ name: repeat(precomposed, 31) }), ["Listing field outside limit: name has 31 characters; allowed 2 to 30"]);
});

test("a character count Apple does not define is blocked only when it changes the result", () => {
  const emoji = "\u{1F3B2}", combining = "e\u0301";
  for (const name of [repeat(emoji, 15), repeat(combining, 15)]) assert.deepEqual(blockersFor({ name }), [], name);
  for (const name of [repeat(emoji, 16), repeat(combining, 16), `${repeat("a", 29)}${emoji}`]) {
    const [blocker, ...rest] = blockersFor({ name });
    assert.deepEqual(rest, []);
    assert.match(blocker, /^Listing field count ambiguous: name has \d+ to \d+ characters; allowed 2 to 30; Apple does not define the count$/);
  }
  assert.deepEqual(blockersFor({ name: repeat(emoji, 31) }), ["Listing field outside limit: name has 31 to 62 characters; allowed 2 to 30"]);
  for (const name of [emoji, combining]) assert.deepEqual(blockersFor({ name }), ["Listing field count ambiguous: name has 1 to 2 characters; allowed 2 to 30; Apple does not define the count"]);
});

test("text is measured exactly as given", () => {
  assert.deepEqual(blockersFor({ subtitle: `${repeat("a", 30)} ` }), ["Listing field outside limit: subtitle has 31 characters; allowed up to 30"]);
  assert.deepEqual(blockersFor({ keywords: `${repeat("a", 100)}\n` }), ["Listing field outside limit: keywords has 101 UTF-8 bytes; allowed up to 100"]);
  const banner = "DRAFT, NOT APPROVED FOR UPLOAD\n\n";
  assert.deepEqual(blockersFor({ description: `${banner}${repeat("a", 4000 - banner.length)}` }), []);
  assert.deepEqual(blockersFor({ description: `${banner}${repeat("a", 4001 - banner.length)}` }), ["Listing field outside limit: description has 4001 characters; allowed up to 4000"]);
  assert.deepEqual(blockersFor({ description: `${repeat("a", 3999)}\r\n` }), ["Listing field count ambiguous: description has 4000 to 4001 characters; allowed up to 4000; Apple does not define the count"]);
  const input = Object.freeze({ ...valid(), subtitle: `  ${repeat("a", 31)}  ` });
  const snapshot = { ...input };
  assert.equal(metadataBlockers(input).length, 1);
  assert.deepEqual(input, snapshot);
});

test("missing, blank or non-text required fields stay blocked", () => {
  for (const field of ["name", "subtitle", "keywords", "description"]) {
    for (const value of [undefined, null, "", "  \n", 30, true, [], {}]) assert.deepEqual(blockersFor({ [field]: value }), [`Listing field missing: ${field}`], `${field}: ${JSON.stringify(value)}`);
  }
});

test("promotional text may be absent, but a present value must be valid text", () => {
  for (const value of [undefined, null, "", "  "]) assert.deepEqual(blockersFor({ promotionalText: value }), []);
  for (const value of [170, false, [], {}]) assert.deepEqual(blockersFor({ promotionalText: value }), ["Listing field missing: promotionalText"], JSON.stringify(value));
});

test("ill-formed Unicode is blocked instead of counted", () => {
  for (const field of Object.keys(METADATA_LIMITS)) {
    for (const value of ["ab\ud83c", "\udfb2ab"]) assert.deepEqual(blockersFor({ [field]: value }), [`Listing field invalid: ${field} is not well-formed Unicode`]);
  }
});

test("every failing field is reported in a stable order", () => {
  assert.deepEqual(metadataBlockers({ subtitle: repeat("a", 31), promotionalText: repeat("a", 171) }), [
    "Listing field missing: name",
    "Listing field outside limit: subtitle has 31 characters; allowed up to 30",
    "Listing field missing: keywords",
    "Listing field outside limit: promotionalText has 171 characters; allowed up to 170",
    "Listing field missing: description",
  ]);
});
