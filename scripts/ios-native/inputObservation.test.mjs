import assert from "node:assert/strict";
import test from "node:test";
import { startInputObservation } from "./inputObservation.mjs";

const healthy = { schemaVersion: 2, events: 1, heartbeat: true, closed: true, stopRequested: true,
  exitObserved: true, unexpectedExit: false, forcedStop: false, dropped: 0, oversizedLines: 0,
  unterminatedLines: 0, error: null, exitCode: 0, exitSignal: null };

test("observation retains strict health and forwards the pinned environment", async () => {
  const env = { DEVELOPER_DIR: "pinned" }; let stops = 0;
  const stop = startInputObservation("device", "path", { env, start: (device, path, options) => {
    assert.equal(device, "device"); assert.equal(path, "path"); assert.equal(options.env, env);
    return async () => { stops++; return healthy; };
  } });
  const first = stop(); assert.equal(stop(), first);
  assert.deepEqual(await first, { ...healthy, status: "available" }); assert.equal(stops, 1);
});

for (const [name, start] of [
  ["requested xcrun exit 143", () => async () => ({ ...healthy, exitCode: 143, error: "input-log-exit-failed" })],
  ["premature exit", () => async () => ({ ...healthy, unexpectedExit: true })],
  ["truncated capture", () => async () => ({ ...healthy, dropped: 1 })],
  ["start failure", () => { throw new Error("private startup detail"); }],
  ["retention failure", () => async () => { throw new Error("private retention detail"); }],
]) {
  test(`${name} is unavailable and cannot turn a successful flow into failure`, async () => {
    const stop = startInputObservation("device", "path", { start });
    let completed = false;
    try { completed = true; } finally {
      const trace = await stop(); assert.equal(trace.status, "unavailable");
      assert(!JSON.stringify(trace).includes("private"));
    }
    assert.equal(completed, true);
  });
  test(`${name} preserves the original failed flow error`, async () => {
    const stop = startInputObservation("device", "path", { start });
    const flowError = new Error("real flow assertion failed");
    await assert.rejects(async () => {
      try { throw flowError; } finally { assert.equal((await stop()).status, "unavailable"); }
    }, (error) => error === flowError);
  });
}
