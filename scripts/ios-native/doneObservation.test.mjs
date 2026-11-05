import assert from "node:assert/strict";
import test from "node:test";
import { startDoneObservation } from "./doneObservation.mjs";

const healthy = { schemaVersion: 1, events: 1, retainedBytes: 90, dropped: 0, segments: 1, sequenceGaps: 0, closed: true, stopRequested: true,
  exitObserved: true, unexpectedExit: false, forcedStop: false, oversizedLines: 0, unterminatedLines: 0, error: null, exitCode: 0, exitSignal: null };

test("a healthy stream is available once and forwards the pinned environment", async () => {
  const env = { DEVELOPER_DIR: "pinned" }; let stops = 0;
  const stop = startDoneObservation("device", "path", { env, start: (device, path, options) => {
    assert.equal(device, "device"); assert.equal(path, "path"); assert.equal(options.env, env); assert.equal("budgetMs" in options, false);
    return async () => { stops++; return healthy; };
  } });
  const first = stop(); assert.equal(stop(), first);
  assert.deepEqual(await first, { ...healthy, status: "available" }); assert.equal(stops, 1);
});

for (const [name, start, error] of [
  ["requested exit 143", () => async () => ({ ...healthy, exitCode: 143, error: "done-log-exit-failed" }), "done-log-exit-failed"],
  ["premature exit", () => async () => ({ ...healthy, unexpectedExit: true }), null],
  ["a missed record", () => async () => ({ ...healthy, sequenceGaps: 1 }), null],
  ["no records", () => async () => ({ ...healthy, events: 0 }), null],
  ["start failure", () => { throw new Error("private startup detail"); }, "done-log-start-failed"],
  ["retention failure", () => async () => { throw new Error("private retention detail"); }, "done-log-retention-failed"],
  ["a stalled stop", () => () => new Promise(() => {}), "done-log-stop-stalled"],
]) {
  test(`${name} is unavailable and cannot turn a successful flow into failure`, async () => {
    const stop = startDoneObservation("device", "path", { start, budgetMs: 20 });
    const trace = await stop();
    assert.equal(trace.status, "unavailable"); assert.equal(trace.error, error);
    assert.doesNotMatch(JSON.stringify(trace), /private/);
  });
  test(`${name} preserves the original failed flow error`, async () => {
    const stop = startDoneObservation("device", "path", { start, budgetMs: 20 });
    const flowError = new Error("real flow assertion failed");
    await assert.rejects(async () => {
      try { throw flowError; } finally { assert.equal((await stop()).status, "unavailable"); }
    }, (error) => error === flowError);
  });
}

test("a stalled stop returns within its own budget", async () => {
  const started = Date.now();
  const trace = await startDoneObservation("device", "path", { start: () => () => new Promise(() => {}), budgetMs: 25 })();
  assert.equal(trace.error, "done-log-stop-stalled"); assert(Date.now() - started < 1000);
});
