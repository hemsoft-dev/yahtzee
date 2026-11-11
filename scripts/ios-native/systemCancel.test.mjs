import assert from "node:assert/strict";
import test from "node:test";
import { reissuableSuffix, systemGateCancelSince } from "./systemCancel.mjs";
import { runAuthoredFlow } from "./batches.mjs";

const gate = { kind: 9, state: 3, relation: 3, cancels: true, scrollPan: false };
const idle = { kind: 9, state: 0, relation: 3, cancels: true, scrollPan: false };
const handler = { kind: 4, state: 1, relation: 1, cancels: false, scrollPan: false };
let seq = 0;
const row = (k, extra = {}) => ({ s: 1, seq: seq++, pid: 7, k, origin: 0, q: 1, target: 0, cx: 0, u0: 1, u1: 1.001, w: 2000, ...extra });
const log = (rows) => { seq = 0; return rows.map((r, i) => JSON.stringify({ ...r, seq: i })).join("\n") + "\n"; };
const boot = () => row(0, { q: 0, installCode: 0, hookCount: 9 });
const began = (q, w = 2000) => row(1, { q, w, phase: 0, x: 201000, y: 411000, candidates: [handler, idle, idle] });
const cancelled = (q, candidates = [handler, gate], extra = {}) => row(4, { q, w: 2000.06, phase: 4, origin: 1, x: 201000, y: 411000, candidates, ...extra });
const ended = (q) => row(3, { q, w: 2000.1, phase: 3, x: 201000, y: 411000, candidates: [handler, idle] });

test("only a stationary tap cancelled while the system gesture gate is recognized qualifies", () => {
  assert.deepEqual(systemGateCancelSince(log([boot(), began(1), cancelled(1)]), 1999000), { q: 1, beganWallMs: 2000000, cancelledWallMs: 2000060 });
  assert.equal(systemGateCancelSince(log([boot(), began(1), ended(1)]), 1999000), null, "ended normally");
  assert.equal(systemGateCancelSince(log([boot(), began(1), cancelled(1, [handler, idle])]), 1999000), null, "gate not recognized");
  assert.equal(systemGateCancelSince(log([boot(), began(1), cancelled(1, [handler, { ...gate, relation: 2 }])]), 1999000), null, "not window level");
  assert.equal(systemGateCancelSince(log([boot(), began(1), cancelled(1, [handler, { ...gate, kind: 10 }])]), 1999000), null, "other private recognizer");
  assert.equal(systemGateCancelSince(log([boot(), began(1), row(2, { q: 1, phase: 1, x: 201000, y: 400000 }), cancelled(1)]), 1999000), null, "moved touch");
  assert.equal(systemGateCancelSince(log([boot(), began(1), cancelled(1, [handler, gate], { y: 500000 })]), 1999000), null, "position changed");
  assert.equal(systemGateCancelSince(log([boot(), began(1), cancelled(1)]), 2001000), null, "before the batch");
  assert.equal(systemGateCancelSince(log([boot(), began(1), cancelled(1), began(2), ended(2)]), 1999000), null, "a later touch exists");
  assert.equal(systemGateCancelSince("not json\n", 0), null);
  assert.equal(systemGateCancelSince(log([boot(), began(1), { ...cancelled(1), pid: 8 }]), 1999000), null, "mixed processes");
});

const lines = ['- tapOn: {"text":"AI opponents","enabled":true,"retryTapIfNoChange":false}', '- assertVisible: "Current: .*"',
  '- waitForAnimationToEnd: {"timeout":5000}', '- tapOn: {"text":"Solo","enabled":true,"retryTapIfNoChange":false}'];
test("the re-sent suffix starts at the tap right before the failed assertion, across passive commands only", () => {
  assert.deepEqual(reissuableSuffix(lines, "Current: .*"), lines);
  const withWait = [lines[0], '- waitForAnimationToEnd: {"timeout":5000}', ...lines.slice(1)];
  assert.deepEqual(reissuableSuffix(withWait, "Current: .*"), withWait);
  assert.equal(reissuableSuffix(['- inputText: "x"', lines[1]], "Current: .*"), null, "effectful command before the assertion");
  assert.equal(reissuableSuffix(['- swipe: {"start":"1,2","end":"1,3"}', lines[1]], "Current: .*"), null);
  assert.equal(reissuableSuffix(lines, "Other"), null); assert.equal(reissuableSuffix(lines, undefined), null);
  assert.equal(reissuableSuffix([lines[1]], "Current: .*"), null);
});

const yaml = `appId: "com.hemsoft.thirdroll"\n---\n${lines.join("\n")}\n`;
const failure = () => Object.assign(new Error("flow-failed"), { assertion: "Current: .*" });
test("runAuthoredFlow re-sends once only with native proof, and records it", async () => {
  const sent = [], records = [];
  let calls = 0;
  await runAuthoredFlow({ runFlow: async (y) => { sent.push(y); if (calls++ === 0) throw failure(); }, record: (v) => records.push(v),
    systemCancelProbe: async () => log([boot(), began(1, 3), cancelled(1, [handler, gate], { w: 3.06 })]) }, yaml, () => 2000);
  assert.equal(sent.length, 2); assert.equal(sent[1], yaml); assert.equal(records[0].kind, "system-gesture-cancel-reissue");

  for (const probe of [async () => log([boot(), began(1, 3), ended(1)]), async () => { throw new Error("no container"); }, undefined]) {
    let n = 0;
    await assert.rejects(runAuthoredFlow({ runFlow: async () => { n++; throw failure(); }, record: () => {}, systemCancelProbe: probe }, yaml, () => 2000), /flow-failed/);
    assert.equal(n, 1, "no re-send without proof");
  }
  let n = 0;
  await assert.rejects(runAuthoredFlow({ runFlow: async () => { n++; throw failure(); }, record: () => {},
    systemCancelProbe: async () => log([boot(), began(1, 3), cancelled(1, [handler, gate], { w: 3.06 })]) }, yaml, () => 2000), /flow-failed/);
  assert.equal(n, 2, "at most one re-send per authored flow");
  n = 0;
  await assert.rejects(runAuthoredFlow({ runFlow: async () => { n++; throw new Error("transport"); }, record: () => {},
    systemCancelProbe: async () => log([boot(), began(1, 3), cancelled(1, [handler, gate], { w: 3.06 })]) }, yaml, () => 2000), /transport/);
  assert.equal(n, 1, "only an authored positive assertion qualifies");
});
test("every re-send is also reported to the run, not only the geometry log", async () => {
  const reports = []; let calls = 0;
  await runAuthoredFlow({ runFlow: async () => { if (calls++ === 0) throw failure(); }, record: () => {}, reportReissue: (v) => reports.push(v),
    systemCancelProbe: async () => log([boot(), began(1, 3), cancelled(1, [handler, gate], { w: 3.06 })]) }, yaml, () => 2000);
  assert.equal(reports.length, 1); assert.equal(reports[0].assertion, "Current: .*"); assert.equal(reports[0].touch.q, 1);
});
