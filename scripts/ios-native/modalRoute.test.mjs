import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { modalBootstrapFlow, modalRouteRequested, ownedModalCapability, qualifyOwnedModal } from "./modalRoute.mjs";

const fresh = () => {
  const data = { active: null, history: { entries: [] }, highScores: { entries: [] }, preferences: { name: "" } };
  return { data, bytes: JSON.stringify(data) };
};

test("modal-only is explicit and cannot combine with any existing mode", () => {
  assert.equal(modalRouteRequested([]), false);
  for (const args of [["--build-only"], ["--refresh-pods"], ["--test-group=tablet-10"]]) assert.equal(modalRouteRequested(args), false);
  assert.equal(modalRouteRequested(["--modal-only"]), true);
  for (const extra of ["--build-only", "--refresh-pods", "--test-group=tablet-10", "--modal-only", "unexpected"])
    for (const args of [["--modal-only", extra], [extra, "--modal-only"]]) assert.throws(() => modalRouteRequested(args));
});

test("bootstrap only launches the owned app and establishes Setup, without gameplay or confirmation substitution", () => {
  const flow = modalBootstrapFlow("com.hemsoft.thirdroll");
  assert(flow.startsWith('appId: "com.hemsoft.thirdroll"\n---\n'));
  const commands = flow.split("\n").filter((line) => line.startsWith("- "));
  assert.deepEqual(commands.map((line) => line.split(":")[0]), ["- launchApp", "- setOrientation", "- assertVisible", "- takeScreenshot"]);
  assert.match(commands[0], /"clearState":true/); assert(!/tapOn|Help|Done|Start Game|repeat|retry/.test(flow));
  assert.throws(() => modalBootstrapFlow('other\n---\n- tapOn: "Delete"'));
});

test("actual prerequisite read precedes the single existing corruption helper and binds its bytes", async () => {
  const order = [], saved = fresh(), result = {}; let evidence;
  const actual = await qualifyOwnedModal({ bundleId: "com.hemsoft.thirdroll",
    bootstrap: async (flow) => { assert.match(flow, /modal-prerequisite/); order.push("bootstrap"); },
    readSave: () => { order.push("durable-read"); return saved; },
    report: (value) => { evidence = value; order.push("record"); },
    corrupt: async () => { order.push("same-corruption-helper"); return result; } });
  assert.equal(actual, result); assert.deepEqual(order, ["bootstrap", "durable-read", "record", "same-corruption-helper"]);
  assert.equal(evidence.sha256, createHash("sha256").update(saved.bytes).digest("hex"));
  assert.equal(evidence.bytes, Buffer.byteLength(saved.bytes)); assert.equal(evidence.gameplayRequired, false);
});

test("missing, nonfresh or oversized prerequisite cannot start corruption", async () => {
  const variants = [() => null, () => ({ ...fresh(), bytes: "x".repeat(65537) }), () => ({ ...fresh(), bytes: null }),
    () => { const s = fresh(); s.data.active = {}; return s; },
    () => { const s = fresh(); s.data.history.entries.push({}); return s; },
    () => { const s = fresh(); s.data.highScores.entries.push({}); return s; },
    () => { const s = fresh(); s.data.preferences.name = "existing"; return s; }];
  for (const readSave of variants) {
    let calls = 0;
    await assert.rejects(qualifyOwnedModal({ bundleId: "com.hemsoft.thirdroll", bootstrap: async () => {}, readSave,
      report: () => {}, corrupt: async () => { calls++; } }));
    assert.equal(calls, 0);
  }
});

test("bootstrap/read/report failures stop before corruption and keep the original exception", async () => {
  for (const failed of ["bootstrap", "readSave", "report"]) {
    const original = new Error(failed); let calls = 0;
    const dependencies = { bootstrap: async () => {}, readSave: fresh, report: () => {} };
    dependencies[failed] = () => { throw original; };
    await assert.rejects(qualifyOwnedModal({ ...dependencies, bundleId: "com.hemsoft.thirdroll", corrupt: async () => { calls++; } }), (error) => error === original);
    assert.equal(calls, 0);
  }
});

test("a failed original corruption sequence is never retried, relabeled or swallowed", async () => {
  const original = new Error("original native assertion"); let calls = 0;
  await assert.rejects(qualifyOwnedModal({ bundleId: "com.hemsoft.thirdroll", bootstrap: async () => {}, readSave: fresh, report: () => {},
    corrupt: async () => { calls++; throw original; } }), (error) => error === original);
  assert.equal(calls, 1);
});

function observed() {
  return [{ id: "corrupt-save/reset-document", nativeModalObservation: { files: [{ status: "retained-prefix", path: "native-modal-0.jsonl",
    health: { singleProcessEpoch: true, contiguous: true, invalidLines: 0, partialLastLine: false, budgetReached: false },
    summary: { installed: true, windows: [{ alert: 1, window: 1, adoption: "observed-owned-instance", hideEntered: true, hideReturned: true,
      dispatches: [{ id: 1, returned: true, threw: false }], touches: [{ q: 1, dispatch: 1, target: 1, phase: 3 }] }] } }] } }];
}
test("a positive owned-window prefix establishes only bounded dispatch/lifecycle capability", () => {
  const result = ownedModalCapability(observed()); assert.equal(result.status, "observed");
  assert.deepEqual(result.retained, [{ scope: "corrupt-save/reset-document", prefix: "native-modal-0.jsonl", alert: 1, window: 1,
    returnedTouchDispatches: 1, targets: [1], hideReturned: true }]);
  assert(result.limits.includes("target-zero-is-unknown")); assert(result.limits.includes("direct-callback-unavailable-cxx-reference-abi"));
  assert.equal(ownedModalCapability().status, "unavailable");
});
test("unavailable installation, unsafe prefix, malformed health or missing lifecycle cannot qualify", () => {
  const changes = [s => { s.id = "other"; }, s => { s.nativeModalObservation.files[0].path = "private/path"; },
    s => { s.nativeModalObservation.files[0].summary.installed = false; },
    s => { s.nativeModalObservation.files[0].health.singleProcessEpoch = false; },
    s => { s.nativeModalObservation.files[0].health.contiguous = false; },
    s => { s.nativeModalObservation.files[0].health.invalidLines = 1; },
    s => { s.nativeModalObservation.files[0].health.partialLastLine = true; },
    s => { s.nativeModalObservation.files[0].health.budgetReached = true; },
    s => { s.nativeModalObservation.files[0].summary.windows[0].adoption = "unavailable"; },
    s => { s.nativeModalObservation.files[0].summary.windows[0].hideReturned = false; },
    s => { s.nativeModalObservation.files[0].summary.windows[0].dispatches[0].returned = false; },
    s => { s.nativeModalObservation.files[0].summary.windows[0].dispatches[0].threw = true; },
    s => { s.nativeModalObservation.files[0].summary.windows[0].touches[0].target = 0; },
    s => { s.nativeModalObservation.files[0].summary.windows[0].touches[0].target = 2; },
    s => { s.nativeModalObservation.files[0].summary.windows[0].touches[0].phase = 0; },
    s => { s.nativeModalObservation.files[0].summary.windows[0].touches[0].phase = 4; },
    s => { s.nativeModalObservation.files[0].summary.windows[0].touches[0].q = 0; }];
  for (const change of changes) { const rows = observed(); change(rows[0]); assert.equal(ownedModalCapability(rows).status, "unavailable"); }
});
test("adoption, dispatch and hide cannot be borrowed from another window or retained process", () => {
  const rows = observed(), first = rows[0].nativeModalObservation.files[0], window = first.summary.windows[0];
  window.dispatches = []; window.touches = [];
  first.summary.windows.push({ ...window, window: 2, adoption: "unavailable", dispatches: [{ id: 1, returned: true }], touches: [{ q: 1, dispatch: 1, target: 1, phase: 3 }] });
  assert.equal(ownedModalCapability(rows).status, "unavailable");
  rows[0].nativeModalObservation.files.push({ ...observed()[0].nativeModalObservation.files[0], summary: { installed: true,
    windows: [{ ...window, window: 1, adoption: "unavailable", dispatches: [{ id: 1, returned: true }], touches: [{ q: 1, dispatch: 1, target: 1, phase: 3 }] }] } });
  assert.equal(ownedModalCapability(rows).status, "unavailable");
});
