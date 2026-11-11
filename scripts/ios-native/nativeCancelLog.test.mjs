import assert from "node:assert/strict";
import test from "node:test";
import { nativeCancelSummary, nativeTouchWindow, parseNativeCancel } from "./nativeCancelLog.mjs";
const row = (seq, k, extra = {}) => ({ s: 1, seq, pid: 20, k, origin: 0, q: 1, target: 4, cx: 0,
  u0: 10, u1: 10.001, w: 1000, tt: 9.9, x: 500, y: 600, fx: 400, fy: 500, fw: 200, fh: 200, ...extra });
const parse = (rows) => parseNativeCancel(rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
const boot = () => row(0, 0, { q: 0, installCode: 0, hookCount: 9 });
const peer = { kind: 1, state: 1, relation: 3, cancels: true, scrollPan: true };

test("only finite channel fields survive parsing; invalid text is not retained", () => {
  const rows = [boot(), row(1, 1), row(2, 4, { origin: 1 }), row(3, 4, { label: "private-name" })];
  const p = parse(rows); assert.equal(p.events.length, 3); assert.equal(p.invalidLines, 1);
  assert(!JSON.stringify(p).includes("private-name")); assert.equal(p.singleProcess, true);
  for (const change of [{ x: 1e10 }, { u0: null }, { origin: 5 }, { peer: { ...peer, label: "private" } }, { phase: 8 }, { hookCount: 8 }, { cx: 2049 }, { result: 2 }])
    assert.equal(parse([row(0, 1, change)]).invalidLines, 1);
});
test("bounds and unterminated lines remain explicit partial evidence", () => {
  assert.equal(parseNativeCancel("x".repeat(4 * 1024 * 1024 + 1)).state, "unavailable");
  const partial = parseNativeCancel(JSON.stringify(boot())); assert.equal(partial.partialLastLine, true); assert.equal(partial.events.length, 0);
  assert.equal(parse([row(0, 1), row(2, 4)]).contiguous, false);
  assert.equal(parse([boot(), row(1, 1, { pid: 21 })]).singleProcess, false);
  assert.equal(parse(Array.from({ length: 2050 }, (_, i) => row(i % 2049, 1))).state, "truncated");
  assert.equal(nativeCancelSummary(parse([boot(), row(1, 11)])).coverage, "partial-or-unavailable");
});
test("an actual RN cancel call in the same context precedes the attributed reset", () => {
  const p = parse([boot(), row(1, 1), row(2, 7, { origin: 3, cx: 4, peer }), row(3, 6, { origin: 3, cx: 4, peer }), row(4, 5, { origin: 3, cx: 4, peer })]);
  const s = nativeCancelSummary(p); assert.equal(s.installed, true); assert.equal(s.outcomes.length, 1);
  assert.equal(s.outcomes[0].origin, "rn-external-cancel-call"); assert.deepEqual(s.outcomes[0].peer, peer);
  assert.equal(s.outcomes[0].precedingStart, true); assert.equal(s.absenceProvesNothing, true);
});
test("recognizer co-occurrence or mismatched context does not establish cancellation ownership", () => {
  for (const extra of [[], [row(2, 7, { origin: 3, cx: 4, peer })], [row(2, 6, { origin: 3, cx: 5, peer })], [row(2, 6, { origin: 3, cx: 4, peer })]]) {
    const rows = [boot(), row(1, 1), ...extra, row(extra.length + 2, 5, { origin: 3, cx: 4, peer })];
    let s;
    assert.doesNotThrow(() => { s = nativeCancelSummary(parse(rows)); });
    assert.equal(s.outcomes[0].origin, "reset-entry-owner-unknown"); assert.deepEqual(s.outcomes[0].peer, {});
  }
});
test("a valid cancellation request in another call context cannot own this reset", () => {
  const s = nativeCancelSummary(parse([boot(), row(1, 1), row(2, 7, { origin: 3, cx: 5, peer }),
    row(3, 6, { origin: 3, cx: 5, peer }), row(4, 5, { origin: 3, cx: 4, peer })]));
  assert.equal(s.outcomes[0].origin, "reset-entry-owner-unknown");
  assert.deepEqual(s.outcomes[0].peer, {});
});
test("UIKit entry, detach and unmatched events retain distinct conservative outcomes", () => {
  assert.equal(nativeCancelSummary(parse([boot(), row(1, 1), row(2, 4, { origin: 1 })])).outcomes[0].origin, "uikit-cancel-entry-owner-unknown");
  assert.equal(nativeCancelSummary(parse([boot(), row(1, 5, { origin: 4 })])).outcomes[0].origin, "reset-during-detach");
  assert.equal(nativeCancelSummary(parse([boot(), row(1, 5)])).outcomes[0].precedingStart, false);
  assert.equal(nativeCancelSummary(parse([boot(), row(1, 1), row(2, 3), row(3, 5)])).outcomes.length, 0);
  assert.equal(nativeCancelSummary(parse([boot(), row(1, 1), row(2, 4), row(3, 5)])).outcomes.length, 1);
  assert.equal(nativeCancelSummary(parse([boot(), row(1, 4, { q: 0 })])).outcomes.length, 0);
});
test("native clock interval and point-in-live-target are bounded without claiming video alignment", () => {
  const sample = nativeTouchWindow(row(1, 4)); assert.equal(sample.state, "native-sample");
  assert(sample.conditionalWallEndMs >= sample.conditionalWallStartMs); assert(Math.abs(sample.sampleSpanMs - 1) < 1e-8);
  assert.equal(sample.inTargetBounds, true); assert.equal(nativeTouchWindow(row(1, 4, { x: -1 })).inTargetBounds, false);
  assert.equal(nativeTouchWindow(row(1, 4, { fw: 0 })).inTargetBounds, null);
  for (const change of [{ tt: 11 }, { tt: -21 }, { u1: 9 }, { u1: 12 }, { w: undefined }])
    assert.equal(nativeTouchWindow(row(1, 4, change)).state, "unavailable");
});
test("no native record or mixed processes can establish an absent cancellation", () => {
  const s = nativeCancelSummary(parse([])); assert.equal(s.installed, false); assert.equal(s.outcomes.length, 0); assert.equal(s.absenceProvesNothing, true);
  const mixed = nativeCancelSummary(parse([boot(), row(1, 1, { pid: 21 }), row(2, 4)])); assert.equal(mixed.outcomes.length, 0);
});
test("unknown recognizer classes are bucketed numerically; no other kind survives", () => {
  for (const kind of [9, 10]) {
    const candidate = { ...peer, kind, relation: 3, state: 3, scrollPan: false };
    assert.equal(parse([row(0, 4, { origin: 1, candidates: [candidate], peer: candidate })]).invalidLines, 0);
  }
  assert.equal(parse([row(0, 4, { origin: 1, candidates: [{ ...peer, kind: 11 }] })]).invalidLines, 1);
});
