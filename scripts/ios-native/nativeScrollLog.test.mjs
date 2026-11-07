import test from "node:test";
import assert from "node:assert/strict";
import { parseNativeScroll, nativeScrollSummary, scrollRange, scrollTouchWindow } from "./nativeScrollLog.mjs";
import { callback, lines, metrics, record } from "./fixtures/native-scroll.fixture.mjs";

test("owned callback pairs retain actual offset change and event completion without a stability claim", () => {
  const parsed = parseNativeScroll(lines(record(), record(1, { k: 1, instance: 1, window: 1, metrics: metrics() }), callback(2, 0),
    callback(3, 1, { metrics: metrics({ oy: 100000, by: 100000 }) }), callback(4, 0, { k: 10, call: 2 }), callback(5, 1, { k: 10, call: 2, metrics: metrics({ oy: 200000 }) })));
  assert.equal(parsed.contiguous, true); assert.equal(parsed.invalidLines, 0);
  const summary = nativeScrollSummary(parsed);
  assert.equal(summary.installationPrepared, true); assert.deepEqual(summary.ownedInstancesObserved, [1]);
  assert.equal(summary.completions.length, 2); assert.equal(summary.completions[1].kind, 10);
  assert.equal(summary.completions[0].ownership, "verified-help-pair"); assert.equal(summary.completions[0].futureStabilityProved, false);
  assert.equal(summary.movement[0].deltaMillipoints, 100000); assert.equal(summary.absenceProvesNothing, true);
  assert.equal(summary.completions[1].range.maximumMillipoints, 5770000);
});

test("finite schema rejects every invalid header bound and arbitrary/private nested values", () => {
  const invalid = [null, [], {}, { ...record(), secret: "SECRET" }, record(0, { v: 2 })];
  const bounds = { seq: [0, 2048], pid: [1, 1e9], epoch: [1, 1e15], k: [0, 14], phase: [0, 3], call: [0, 2048], instance: [0, 8], window: [0, 16], gesture: [0, 2048], q: [0, 2048], code: [0, 8], willDecelerate: [-1, 1] };
  for (const [key, [lo, hi]] of Object.entries(bounds)) for (const value of [lo - 1, hi + 1, 0.5, "SECRET", null]) invalid.push(record(0, { [key]: value }));
  for (const key of ["u0", "u1", "w"]) for (const value of [-1, 1e13, "SECRET", null]) invalid.push(record(0, { [key]: value }));
  for (const extra of [{ secret: "SECRET" }, { oy: "SECRET" }, { bw: 1e10 }, { drag: 1 }, { orientation: 5 }]) invalid.push(callback(0, 0, { metrics: metrics(extra) }));
  const missing = metrics(); delete missing.oy; invalid.push(callback(0, 0, { metrics: missing }));
  for (const row of invalid) {
    const parsed = parseNativeScroll(lines(row)); assert.equal(parsed.invalidLines, 1); assert.equal(parsed.events.length, 0);
    assert.equal(JSON.stringify(parsed).includes("SECRET"), false);
  }
  assert.equal(parseNativeScroll(undefined).status, "unavailable"); assert.equal(parseNativeScroll("x".repeat(4 * 1024 * 1024 + 1)).status, "unavailable");
});

test("touch/native clock correspondence is conditional and malformed clocks stay unknown", () => {
  const touch = { tt: 9.99, phase: 0, x: 516000, y: 1231000, sx: 516000, sy: 1231000 };
  const row = record(0, { k: 2, instance: 1, window: 1, q: 2, metrics: metrics(), touch });
  assert.equal(parseNativeScroll(lines(row)).events.length, 1);
  assert.equal(scrollTouchWindow(row).conditionalWallStartMs, (1000 + 9.99 - 10.001) * 1000);
  for (const extra of [{ u0: 11, u1: 10 }, { u1: 12 }, { touch: { ...touch, tt: 11 } }, { touch: { ...touch, tt: -100 } }, { touch: null }]) assert.equal(scrollTouchWindow({ ...row, ...extra }), null);
  for (const extra of [{ tt: "SECRET" }, { phase: 8 }, { x: 1e10 }, { private: "SECRET" }]) assert.equal(parseNativeScroll(lines({ ...row, touch: { ...touch, ...extra } })).invalidLines, 1);
  assert.equal(parseNativeScroll(lines({ ...row, touch: { ...touch, x: null, sx: null } })).events.length, 1);
});

test("callback ABI shapes retain willDecelerate only on drag-end and reject fabricated boundary rows", () => {
  for (const k of [6, 7, 9, 10, 11, 12]) assert.equal(parseNativeScroll(lines(callback(0, 0, { k }))).events.length, 1);
  for (const value of [0, 1]) assert.equal(parseNativeScroll(lines(callback(0, 0, { k: 8, willDecelerate: value }))).events.length, 1);
  for (const more of [{ phase: 3 }, { call: 0 }, { instance: 0 }, { q: 1 }, { touch: {} }, { willDecelerate: 0 }, { k: 8, willDecelerate: -1 }]) assert.equal(parseNativeScroll(lines(callback(0, 0, more))).invalidLines, 1);
  for (const more of [{ k: 1, instance: 0 }, { k: 2, instance: 0 }, { k: 13, phase: 0 }, { k: 13, call: 1 }, { k: 13, willDecelerate: 1 }, { k: 0, metrics: metrics() }, { k: 0, window: 1 }, { k: 14 }]) assert.equal(parseNativeScroll(lines(record(0, more))).invalidLines, 1);
  assert.equal(parseNativeScroll(lines(record(1, { k: 13, code: 2 }))).events.length, 1);
});

test("duplicates, missing entries, process epochs and contradictory pairs never invent a completion", () => {
  const cases = [[callback(0, 0)], [callback(0, 1)], [callback(0, 0), callback(1, 0), callback(2, 1)],
    [callback(0, 0), callback(1, 1), callback(2, 1)], [callback(0, 0), callback(1, 1, { instance: 2 })],
    [callback(0, 0), callback(1, 1, { k: 7 })], [callback(0, 0), callback(1, 1, { u0: 9 })],
    [callback(0, 0), callback(1, 1, { pid: 21 })], [callback(0, 0), callback(1, 1, { epoch: 10000001 })]];
  for (const rows of cases) assert.equal(nativeScrollSummary(parseNativeScroll(lines(...rows))).completions.length, 0);
  const failed = nativeScrollSummary(parseNativeScroll(lines(callback(0, 0), callback(1, 2)))); assert.equal(failed.completions[0].outcome, "threw-unknown");
  const unknown = nativeScrollSummary(parseNativeScroll(lines(callback(0, 0, { code: 7 }), callback(1, 1, { code: 7 }))));
  assert.equal(unknown.completions[0].ownership, "unknown"); assert.equal(unknown.completions[0].range, null); assert.equal(unknown.movement.length, 0);
  const windowChange = nativeScrollSummary(parseNativeScroll(lines(callback(0, 0, { k: 12 }), callback(1, 1, { k: 12, window: 0, metrics: null }))));
  assert.equal(windowChange.completions[0].endWindow, 0);
});

test("nominal range permits elastic offsets and never treats invalid extent/zoom as actual clamping", () => {
  assert.equal(scrollRange(metrics({ oy: -10001 })).elasticOrOutsideNominalRange, true);
  assert.equal(scrollRange(metrics({ oy: 5770001 })).elasticOrOutsideNominalRange, true);
  assert.equal(scrollRange(metrics({ oy: 0 })).elasticOrOutsideNominalRange, false);
  for (const value of [null, metrics({ zoom: 2000 }), metrics({ ch: -1 }), metrics({ bh: 0 }), metrics({ oy: null })]) assert.equal(scrollRange(value), null);
});

test("writer-prefix, budget and summary bounds retain partialness without absence or stable-scroll claims", () => {
  assert.equal(parseNativeScroll(JSON.stringify(record())).partialLastLine, true);
  assert.equal(parseNativeScroll(lines(record(1))).contiguous, false);
  assert.equal(parseNativeScroll("private secret\n").invalidLines, 1);
  const cap = parseNativeScroll(lines(...Array.from({ length: 2048 }, (_, i) => record(i)), record(2048, { k: 14 })));
  assert.equal(cap.events.length, 2049); assert.equal(cap.budgetReached, true);
  assert.equal(parseNativeScroll(lines(...cap.events, record(2048, { k: 14 }))).status, "truncated");
  const rows = Array.from({ length: 160 }, (_, i) => callback(i, i % 2, { call: Math.floor(i / 2) + 1, metrics: metrics({ oy: i * 1000 }) }));
  const summary = nativeScrollSummary(parseNativeScroll(lines(...rows)));
  assert.equal(summary.completions.length, 64); assert.equal(summary.completionsTruncated, true);
  assert.equal(summary.movement.length, 64); assert.equal(summary.movementTruncated, true);
  assert.equal(nativeScrollSummary(parseNativeScroll("")).ownedInstancesObserved.length, 0);
});


test("reset target v2 callback geometry is retained independently of AX acceptance", () => {
  const rect = { x: 176000, y: 967500, w: 680000, h: 81000 };
  const reset = { code: 0, visited: 40, matches: 1, depth: 8, t0: 10, t1: 10.001, id: 1,
    rect, contentRect: { ...rect, y: 8502000 }, clip: rect,
    ancestors: [{ ...rect, clips: true }], hidden: false, complete: true };
  const row = callback(0, 1, { v: 2, k: 10, reset });
  const parsed = parseNativeScroll(lines(row)); assert.equal(parsed.events.length, 1);
  assert.deepEqual(parsed.events[0].reset, reset); assert.equal(parsed.absenceProvesNothing, true);
});


test("native reset samples keep unknown reasons finite and reject unsafe or unrelated geometry", () => {
  const rect = { x: 176000, y: 967500, w: 680000, h: 81000 };
  const reset = { code: 0, visited: 40, matches: 1, depth: 8, t0: 10, t1: 10.001, id: 1,
    rect, contentRect: rect, clip: rect, ancestors: [{ ...rect, clips: true }], hidden: false, complete: true };
  const row = (value) => callback(0, 1, { v: 2, k: 10, reset: value });
  for (let code = 1; code <= 10; code++) {
    const unavailable = { ...reset, code, id: 0, rect: null, contentRect: null, clip: null, ancestors: [], hidden: null, complete: false };
    assert.equal(parseNativeScroll(lines(row(unavailable))).events.length, 1);
  }
  for (const extra of [{ secret: "PRIVATE" }, { code: 11 }, { visited: 257 }, { matches: 2 }, { depth: 17 }, { id: 17 },
    { t0: 11 }, { t1: Infinity }, { rect: { ...rect, x: "PRIVATE" } }, { clip: { ...rect, w: -1 } },
    { contentRect: { ...rect, h: 1e10 } }, { ancestors: Array(25).fill({ ...rect, clips: true }) },
    { ancestors: [{ ...rect, clips: true, text: "PRIVATE" }] }, { hidden: 1 }, { complete: false }, { code: 2 }]) {
    const parsed = parseNativeScroll(lines(row({ ...reset, ...extra }))); assert.equal(parsed.invalidLines, 1); assert(!JSON.stringify(parsed).includes("PRIVATE"));
  }
  for (const extra of [{ k: 6 }, { window: 0 }, { code: 7 }, { metrics: null }]) assert.equal(parseNativeScroll(lines({ ...row(reset), ...extra })).invalidLines, 1);
  assert.equal(parseNativeScroll(lines(callback(0, 1, { v: 2, k: 12, window: 0, metrics: null, reset: null }))).events.length, 1);
  const entries = Array.from({ length: 70 }, (_, i) => callback(i, 0, { v: 2, k: 10, call: i + 1, reset }));
  const summary = nativeScrollSummary(parseNativeScroll(lines(...entries))); assert.equal(summary.resetGeometry.length, 64); assert.equal(summary.resetGeometryTruncated, true);
  assert.equal(summary.completions.length, 0); assert.equal(summary.resetGeometry[0].AXAcceptance, "unknown");
  assert.equal(nativeScrollSummary(parseNativeScroll(lines(callback(0, 0, { k: 10 }), callback(1, 1, { v: 2, k: 10, reset })))).completions.length, 0);
});
