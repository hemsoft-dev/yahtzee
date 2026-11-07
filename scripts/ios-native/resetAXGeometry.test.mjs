import assert from "node:assert/strict";
import test from "node:test";
import { resetAXGeometry } from "./resetAXGeometry.mjs";

const target = () => ({ a11y: "Delete all local data", b: "[176,1349][856,1430]" });
const help = () => ({ rid: "help-viewport", b: "[0,106][1032,1356]", c: [target()] });
const screen = (nodes = [help()]) => ({ ui_schema: { platform: "ios", defaults: { enabled: true } }, elements: [
  { b: "[0,0][1032,1376]", c: nodes },
] });

test("retained modal AX rectangles stay clipped without inventing a later native or AX target", () => {
  // Numeric minimal control from f2a50bb artifact13575840174's last document decision.
  const input = screen(), before = JSON.stringify(input), result = resetAXGeometry(input);
  assert.equal(result.code, 0); assert.equal(result.target.bottom, 1430); assert.equal(result.viewport.bottom, 1356);
  assert.equal(result.ancestorIntersection.bottom, 1356); assert.equal(result.ancestorContained, false);
  assert.equal(result.targetAncestors.length, 2); assert.equal(result.enabled, true);
  assert.equal(JSON.stringify(input), before); assert(!JSON.stringify(result).includes("Delete"));
  assert.equal(Object.hasOwn(result, "nativeTarget"), false);
});

test("only the fixed action under one Help viewport contributes geometry", () => {
  const unrelated = target(), h = help(); h.c[0].enabled = false;
  const result = resetAXGeometry(screen([h, unrelated])); assert.equal(result.code, 0); assert.equal(result.enabled, false);
  h.c = []; assert.equal(resetAXGeometry(screen([h, unrelated])).code, 3);
  h.c = [target(), target()]; assert.equal(resetAXGeometry(screen([h])).code, 4);
  assert.equal(resetAXGeometry(screen([help(), help()])).code, 2);
  assert.equal(resetAXGeometry(screen([])).code, 1);
  const enabledUnknown = help(); enabledUnknown.c[0].enabled = "PRIVATE";
  assert.equal(resetAXGeometry(screen([enabledUnknown])).enabled, null);
});

test("invalid, oversized, deep, cyclic and throwing AX values remain finite unknowns", () => {
  for (const input of [null, {}, { ui_schema: { platform: "android" } }, { ui_schema: { platform: "ios", defaults: { enabled: false } }, elements: [] }]) assert.equal(resetAXGeometry(input).code, 5);
  const malformed = help(); malformed.c[0].b = "PRIVATE"; assert.equal(resetAXGeometry(screen([malformed])).code, 5);
  const wide = screen(Array.from({ length: 513 }, () => help())); assert.equal(resetAXGeometry(wide).code, 6);
  const deep = help(); let cursor = deep;
  for (let i = 0; i < 25; i++) { const next = { b: "[0,0][1,1]", c: [] }; cursor.c = [next]; cursor = next; }
  assert.equal(resetAXGeometry(screen([deep])).code, 6);
  const cycle = help(); cycle.c = [cycle]; assert.equal(resetAXGeometry(screen([cycle])).code, 6);
  const broken = screen(); Object.defineProperty(broken, "elements", { get() { throw new Error("PRIVATE"); } });
  const result = resetAXGeometry(broken); assert.equal(result.code, 5); assert(!JSON.stringify(result).includes("PRIVATE"));
  const privateNode = { a11y: "PRIVATE_LABEL_URL_TOKEN", b: "[0,0][1,1]", val: "PRIVATE" };
  assert(!JSON.stringify(resetAXGeometry(screen([help(), privateNode]))).includes("PRIVATE"));
});
