import assert from "node:assert/strict";
import test from "node:test";
import { nativeModalSummary, parseNativeModal } from "./nativeModalLog.mjs";
const row = (seq, k, extra = {}) => ({ s: 1, seq, pid: 20, epoch: 123456, k, a: 1, win: 1, d: 0, q: 0, target: 0,
  code: 0, callbackDirect: false, u0: 10, u1: 10.001, w: 1000, ...extra });
const boot = () => row(0, 0, { a: 0, win: 0, hookCount: 3 });
const parse = (rows) => parseNativeModal(rows.map(JSON.stringify).join("\n") + "\n");
test("finite modal channel rejects payloads, prototype-like keys and fabricated direct callbacks", () => {
  const p = parse([boot(), row(1, 4), row(2, 6, { label: "private" })]);
  assert.equal(p.events.length, 2); assert.equal(p.invalidLines, 1); assert(!JSON.stringify(p).includes("private"));
  for (const delta of [{ toString: 5 }, { callbackDirect: true }, { x: 1e10 }, { epoch: 1e20 }, { code: 9 }, { target: 3 }, { phase: 8 }, { u0: null }])
    assert.equal(parse([row(0, 6, delta)]).invalidLines, 1);
  assert.equal(parse([row(0, 6, { candidates: [{ kind: 1, state: 1, relation: 2, cancels: true, label: "private" }] })]).invalidLines, 1);
});
test("only a successful owned adoption and matching dispatch return establish those boundaries", () => {
  const p = parse([boot(), row(1, 4), row(2, 6, { d: 1, q: 1, target: 1, phase: 0, tt: 9.99, x: 20, y: 30, fx: 0, fy: 0, fw: 40, fh: 50 }),
    row(3, 7, { d: 1, u1: 10.02 }), row(4, 9), row(5, 10)]);
  const s = nativeModalSummary(p); assert.equal(s.installed, true); assert.equal(s.windows[0].adoption, "observed-owned-instance");
  assert.equal(s.windows[0].dispatches[0].returned, true); assert.equal(s.windows[0].touches[0].sample.inTargetBounds, true);
  assert.equal(s.windows[0].hideEntered, true); assert.equal(s.windows[0].hideReturned, true);
  assert.equal(s.windows[0].callbackBoundary, "not-directly-observed"); assert.equal(s.directCallback, "unavailable-cxx-reference-abi");
});
test("other windows, unknown targets, exceptions and candidate states never become callback or causal proof", () => {
  const peer = { kind: 1, state: 1, relation: 2, cancels: true };
  const p = parse([boot(), row(1, 5, { code: 2 }), row(2, 6, { d: 1, q: 1, phase: 4, candidates: [peer] }),
    row(3, 7, { win: 2, d: 1 }), row(4, 8, { d: 1 })]);
  const s = nativeModalSummary(p); assert.equal(s.windows[0].adoption, "unavailable");
  assert.equal(s.windows[0].dispatches[0].returned, false); assert.equal(s.windows[0].dispatches[0].threw, true);
  assert.equal(s.windows[0].touches[0].target, 0); assert.equal(s.windows[0].nativeCancellationOwner, "UNKNOWN");
  assert.equal(s.windows[1].dispatches.length, 0); assert.equal(s.windows[0].hideReturned, false);
});
test("size, sequence, process epochs and writer boundaries preserve unknowns", () => {
  assert.equal(parseNativeModal("x".repeat(4 * 1024 * 1024 + 1)).state, "unavailable");
  assert.equal(parseNativeModal(JSON.stringify(boot())).partialLastLine, true);
  assert.equal(parse([boot(), row(2, 4)]).contiguous, false);
  const mixed = parse([boot(), row(1, 4, { epoch: 123457 })]); assert.equal(mixed.singleProcessEpoch, false);
  assert.equal(nativeModalSummary(mixed).windows.length, 0);
  assert.equal(nativeModalSummary(parse([boot(), row(1, 12)])).coverage, "partial-or-unavailable");
  assert.equal(nativeModalSummary(parse([])).absenceProvesNothing, true);
  const cap = parse(Array.from({ length: 2050 }, (_, i) => row(i % 2049, 4))); assert.equal(cap.state, "truncated");
});
test("touch detail cap and stale clocks are explicit and never imply an absent event", () => {
  const events = [boot(), row(1, 4), ...Array.from({ length: 34 }, (_, i) => row(i + 2, 6, { d: 1, q: 1, phase: 1, tt: 100 }))];
  const s = nativeModalSummary(parse(events)); assert.equal(s.windows[0].touches.length, 32); assert.equal(s.windows[0].touchRecordsTruncated, true);
  assert.equal(s.windows[0].touches[0].sample.state, "unavailable"); assert.equal(s.windows[0].dispatches[0].returned, false);
});
