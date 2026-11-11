import assert from "node:assert/strict";
import test from "node:test";
import { reissuableSuffix, systemGateCancelSince } from "./systemCancel.mjs";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MaestroError } from "./mcp.mjs";
import { nativeInteraction } from "./interaction.mjs";

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
  assert.deepEqual(systemGateCancelSince(log([boot(), began(1), cancelled(1)]), 1999000), { q: 1, beganWallMs: 2000000, cancelledWallMs: 2000060, beganSince: 1 });
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
const hold = ['- tapOn: {"point":"68,368","retryTapIfNoChange":false}',
  '- extendedWaitUntil: {"visible":{"id":"die-0","text":".*checked, Held"},"timeout":15000}'];

test("the re-sent suffix starts at the failed flow's tap and covers only passive commands after it", () => {
  assert.deepEqual(reissuableSuffix(lines, "Current: .*"), { lines, touches: "last" });
  const withWait = [lines[0], '- waitForAnimationToEnd: {"timeout":5000}', ...lines.slice(1)];
  assert.deepEqual(reissuableSuffix(withWait, "Current: .*").lines, withWait);
  assert.equal(reissuableSuffix(['- inputText: "x"', lines[1]], "Current: .*"), null, "effectful command before the assertion");
  assert.equal(reissuableSuffix(['- swipe: {"start":"1,2","end":"1,3"}', lines[1]], "Current: .*"), null);
  assert.equal(reissuableSuffix(lines, "Other"), null, "several effectful commands and no matching assertion");
  // A single-tap flow (hold, reroll, score) whose wait failed: the tap must be the only effectful command.
  assert.deepEqual(reissuableSuffix(hold, undefined), { lines: hold, touches: "only" });
  assert.equal(reissuableSuffix(['- swipe: {"start":"1,2","end":"1,3"}', ...hold], undefined), null);
  assert.equal(reissuableSuffix([hold[0], '- waitForAnimationToEnd: {"timeout":5000}'], undefined), null, "no check after the tap");
  assert.equal(reissuableSuffix(['- tapOn: {"text":"A"}', '- tapOn: {"text":"B"}', hold[1]], undefined), null);
});

function session(t, { failures = [], probe }) {
  const directory = mkdtempSync(join(tmpdir(), "system-cancel-"));
  t.after(() => rmSync(directory, { recursive: true }));
  const sent = [], reports = [];
  const options = { directory, device: "owned", bundleId: "com.hemsoft.thirdroll", prefix: "scenario", env: { PATH: "p" }, capture: async () => {},
    systemCancelProbe: probe, onSystemCancelReissue: (entry) => reports.push(entry),
    openSession: async () => ({ close: async () => {}, call: async (name, args) => {
      if (name === "list_devices") return { devices: [{ device_id: "owned", platform: "ios", connected: true }] };
      if (name === "inspect_screen") return { ui_schema: { platform: "ios" }, elements: [] };
      sent.push(args.yaml);
      const failure = failures.shift();
      if (failure) throw failure;
      return { success: true };
    } }) };
  return { options, sent, reports, geometry: () => { try { return readFileSync(join(directory, "scenario-geometry.jsonl"), "utf8"); } catch { return ""; } } };
}
const flowFailure = (assertion) => Object.assign(new MaestroError("flow-failed", "run", "application-flow"), assertion ? { assertion } : {});
const proof = async () => log([boot(), began(1, Date.now() / 1000 + 1), cancelled(1, [handler, gate], { w: Date.now() / 1000 + 1.06 })]);
const header = 'appId: "com.hemsoft.thirdroll"\n---\n';

test("a proven gate cancellation in a single-tap flow is re-sent once, recorded and reported", async (t) => {
  const s = session(t, { failures: [flowFailure()], probe: proof });
  await nativeInteraction({ ...s.options, exercise: async (io) => { await io.runFlow(header + hold.join("\n") + "\n"); } });
  assert.equal(s.sent.length, 2); assert.equal(s.sent[1], header + hold.join("\n") + "\n");
  assert.equal(s.reports.length, 1); assert.equal(s.reports[0].tap, hold[0]);
  assert.match(s.geometry(), /system-gesture-cancel-reissue/);
});

test("an authored flow re-sends from the tap before its failed assertion", async (t) => {
  const s = session(t, { failures: [flowFailure("Current: .*")], probe: proof });
  await nativeInteraction({ ...s.options, exercise: async (io) => { await io.runFlow(header + lines.join("\n") + "\n"); } });
  assert.equal(s.sent.length, 2); assert.equal(s.sent[1], header + lines.join("\n") + "\n");
});

test("no proof, the wrong failure kind, or a spent budget ends the run without a re-send", async (t) => {
  const cases = [
    { failures: [flowFailure()], probe: async () => log([boot(), began(1, Date.now() / 1000 + 1), ended(1)]) },
    { failures: [flowFailure()], probe: async () => { throw new Error("no container"); } },
    { failures: [flowFailure()], probe: undefined },
    { failures: [new MaestroError("device-unreachable", "run", "transport-uncertain")], probe: proof },
    { failures: [flowFailure(), flowFailure()], probe: proof, expectSent: 2 },
  ];
  for (const { failures, probe, expectSent = 1 } of cases) {
    const s = session(t, { failures, probe });
    await assert.rejects(nativeInteraction({ ...s.options, exercise: async (io) => { await io.runFlow(header + hold.join("\n") + "\n"); } }));
    assert.equal(s.sent.length, expectSent); assert.equal(s.reports.length, expectSent - 1);
  }
  // Two touches began during a single-tap flow: the cancelled one may not be the flow's tap.
  const two = session(t, { failures: [flowFailure()], probe: async () => log([boot(), began(1, Date.now() / 1000 + 1), ended(1),
    began(2, Date.now() / 1000 + 2), cancelled(2, [handler, gate], { w: Date.now() / 1000 + 2.06 })]) });
  await assert.rejects(nativeInteraction({ ...two.options, exercise: async (io) => { await io.runFlow(header + hold.join("\n") + "\n"); } }));
  assert.equal(two.sent.length, 1);
});

test("a session allows at most two re-sends", async (t) => {
  // Each flow fails once; the first two re-sends succeed, the third flow's failure is final.
  const s = session(t, { failures: [flowFailure(), null, flowFailure(), null, flowFailure()], probe: proof });
  await assert.rejects(nativeInteraction({ ...s.options, exercise: async (io) => {
    for (let i = 0; i < 3; i++) await io.runFlow(header + hold.join("\n") + "\n");
  } }));
  assert.equal(s.reports.length, 2);
});
