import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";
import { doneEvent, doneTraceUsable, startDoneLog } from "./doneLog.mjs";

const record = (phase, sequence, extra = {}) => ({ phase, atMs: 123, monotonicMs: 10, sequence, ...extra });
const raw = (value) => JSON.stringify({ eventMessage: "THIRD_ROLL_DONE " + JSON.stringify(value), privateOSMetadata: "never retained" });
function harness(options = {}) {
  const child = new EventEmitter(); child.stdout = new PassThrough(); const signals = [];
  child.kill = (signal) => {
    signals.push(signal);
    if (!options.hung) child.emit("close", options.exitCode ?? 0, options.exitSignal ?? null);
  };
  const path = options.path ?? join(mkdtempSync(join(tmpdir(), "native-done-")), "done.jsonl");
  const env = { DEVELOPER_DIR: "pinned", PRIVATE_ENV: "not-retained" };
  let launched;
  const stop = startDoneLog("owned-device", path, { ...options, env, now: () => 456, launch: (command, args, settings) => {
    launched = { command, args, settings }; return child;
  } });
  const flushed = () => new Promise((resolve) => { setImmediate(resolve); });
  return { child, signals, stop, launched, env, path, flushed, read: () => readFileSync(path, "utf8") };
}

test("the parser keeps finite records and rejects payloads, unknown phases and impossible IDs", () => {
  const valid = [
    record("done-process-start", 0), record("done-route-branch-help", 1), record("done-route-attach", 2, { routeId: 2 }),
    record("done-route-before-remove-go-back", 9, { routeId: 2, doneId: 4 }), record("done-route-before-remove-pop", 9, { routeId: 2 }),
    record("done-route-transition-start-closing", 9, { routeId: 2, doneId: 4 }), record("done-route-transition-end-opening", 9, { routeId: 2 }),
    record("done-press-in", 4, { routeId: 2, doneId: 4 }), record("done-handler", 4, { doneId: 4 }), record("done-router-back-returned", 6, { routeId: 2, doneId: 4 }),
    record("done-observation-superseded", 6, { doneId: 4 }), record("done-route-effect-cleanup", 6, { routeId: 2 }),
  ];
  for (const value of valid) assert.deepEqual(doneEvent(raw(value)), value);
  for (const value of [
    record("done-native-paint", 0), record("private route", 0), record("done-process-start", 1024), record("done-process-start", 1, { routeId: 0 }),
    record("done-process-start", 1, { route: "/PRIVATE" }), record("done-process-start", 0, { atMs: -1 }), record("done-process-start", 0, { atMs: 1.5 }), record("done-process-start", 0, { monotonicMs: -1 }),
    record("done-route-attach", 3, { routeId: 2 }), record("done-route-focus", 3), record("done-route-focus", 3, { routeId: 3 }), record("done-route-focus", 3, { routeId: 2, doneId: 1 }),
    record("done-route-transition-end-opening", 3, { routeId: 2, doneId: 1 }), record("done-press-in", 4, { doneId: 3 }), record("done-press-out", 4, { doneId: 4 }),
    record("done-handler", 4, { doneId: 5 }), record("done-handler", 4), record("done-handler", 4, { doneId: 1, routeId: 4 }), record("done-handler", 4, { doneId: 1, error: "PRIVATE" }), record("done-handler", 4, { doneId: "1" }),
  ]) assert.equal(doneEvent(raw(value)), null, JSON.stringify(value));
  for (const line of ["not json", "null", JSON.stringify({ eventMessage: 7 }), JSON.stringify({ eventMessage: "THIRD_ROLL_INPUT " + JSON.stringify(record("done-process-start", 0)) }), JSON.stringify({ eventMessage: "THIRD_ROLL_DONE null" })]) assert.equal(doneEvent(line), null);
});

test("a stream owns its device and marker, splits records, and retains only parsed fields", async () => {
  const h = harness();
  assert.equal(h.launched.command, "xcrun"); assert.deepEqual(h.launched.args.slice(0, 5), ["simctl", "spawn", "owned-device", "log", "stream"]);
  assert.equal(h.launched.settings.env, h.env);
  const predicate = h.launched.args[h.launched.args.indexOf("--predicate") + 1];
  assert.match(predicate, /THIRD_ROLL_DONE /); assert.doesNotMatch(predicate, /THIRD_ROLL_INPUT/);
  h.child.stdout.write('Filtering the log data using "eventMessage CONTAINS "THIRD_ROLL_DONE ""\n');
  const line = raw(record("done-process-start", 0)) + "\n";
  h.child.stdout.write(line.slice(0, 11)); h.child.stdout.write(line.slice(11));
  h.child.stdout.write(raw(record("done-route-branch-help", 1)) + "\n");
  await h.flushed();
  const trace = await h.stop();
  assert.deepEqual(h.signals, ["SIGTERM"]);
  assert.equal(doneTraceUsable(trace), true); assert.equal(trace.events, 2); assert.equal(trace.segments, 1); assert.equal(trace.sequenceGaps, 0);
  const lines = h.read().trim().split("\n").map((item) => JSON.parse(item));
  assert.deepEqual(lines[0], { ...record("done-process-start", 0), segment: 1, receivedAtMs: 456 });
  assert.doesNotMatch(h.read(), /private|never retained/i);
  assert.equal(await h.stop(), trace);
});

test("a sequence restart starts a new segment and missed records block completeness", async () => {
  const restarted = harness();
  for (const sequence of [0, 1, 0, 1]) restarted.child.stdout.write(raw(record("done-route-branch-help", sequence)) + "\n");
  await restarted.flushed();
  const clean = await restarted.stop();
  assert.equal(clean.segments, 2); assert.equal(clean.sequenceGaps, 0); assert.equal(doneTraceUsable(clean), true);
  assert.deepEqual(restarted.read().trim().split("\n").map((item) => JSON.parse(item).segment), [1, 1, 2, 2]);

  for (const sequences of [[1], [0, 2], [0, 1, 1]]) {
    const missed = harness();
    for (const sequence of sequences) missed.child.stdout.write(raw(record("done-route-branch-help", sequence)) + "\n");
    await missed.flushed();
    const trace = await missed.stop();
    assert.equal(trace.sequenceGaps, 1, sequences.join()); assert.equal(trace.error, null); assert.equal(doneTraceUsable(trace), false);
  }
});

test("malformed and oversized lines are unusable, private and do not discard later valid records", async () => {
  const h = harness();
  h.child.stdout.write(raw(record("done-private", 0, { route: "/PRIVATE" })) + "\n");
  h.child.stdout.write(JSON.stringify({ eventMessage: "THIRD_ROLL_DONE " + "x".repeat(17000) }) + "\n");
  h.child.stdout.write(raw(record("done-process-start", 0)) + "\n");
  await h.flushed();
  const trace = await h.stop();
  assert.equal(trace.events, 1); assert.equal(trace.dropped, 2); assert.equal(trace.oversizedLines, 1); assert.equal(trace.error, "done-log-malformed-record");
  assert.equal(doneTraceUsable(trace), false); assert.doesNotMatch(h.read() + JSON.stringify(trace), /PRIVATE/);
});

test("record and retained-byte bounds hold without a false complete receipt", async () => {
  for (const options of [{ limit: 2 }, { byteLimit: 100 }]) {
    const h = harness(options);
    for (let sequence = 0; sequence < 5; sequence++) h.child.stdout.write(raw(record("done-route-branch-help", sequence)) + "\n");
    await h.flushed();
    const trace = await h.stop();
    assert.equal(trace.error, "done-log-limit-reached"); assert(trace.dropped >= 3); assert.equal(doneTraceUsable(trace), false);
    assert(Buffer.byteLength(h.read()) <= (options.byteLimit ?? 1024));
  }
});

test("exit 143, signals, early exit, truncation, a stall and write failure are all unusable and never throw", async () => {
  const positive = raw(record("done-process-start", 0)) + "\n";
  const status = await (async () => {
    const h = harness({ exitCode: 143 }); h.child.stdout.write(positive); await h.flushed(); return h.stop();
  })();
  assert.equal(status.exitCode, 143); assert.equal(status.error, "done-log-exit-failed"); assert.equal(status.events, 1); assert.equal(doneTraceUsable(status), false);

  // The exit rule holds on its own, even for a receipt with no recorded error.
  const clean = { schemaVersion: 1, events: 1, closed: true, stopRequested: true, exitObserved: true, unexpectedExit: false, forcedStop: false,
    dropped: 0, oversizedLines: 0, unterminatedLines: 0, sequenceGaps: 0, error: null, exitCode: 0, exitSignal: null };
  assert.equal(doneTraceUsable(clean), true);
  for (const exit of [{ exitCode: 143 }, { exitCode: 1 }, { exitCode: null, exitSignal: "SIGKILL" }, { exitCode: null }]) assert.equal(doneTraceUsable({ ...clean, ...exit }), false, JSON.stringify(exit));

  const sigterm = harness({ exitCode: null, exitSignal: "SIGTERM" }); sigterm.child.stdout.write(positive); await sigterm.flushed();
  assert.equal(doneTraceUsable(await sigterm.stop()), true);

  const early = harness(); early.child.stdout.write(positive); await early.flushed(); early.child.emit("close", 0, null);
  const earlyTrace = await early.stop();
  assert.equal(earlyTrace.unexpectedExit, true); assert.equal(earlyTrace.error, "done-log-exited-before-stop"); assert.deepEqual(early.signals, []); assert.equal(doneTraceUsable(earlyTrace), false);

  const partial = harness(); partial.child.stdout.write(positive + '{"eventMessage":"THIRD'); await partial.flushed();
  const partialTrace = await partial.stop();
  assert.equal(partialTrace.unterminatedLines, 1); assert.equal(partialTrace.error, "done-log-unterminated-record"); assert.equal(doneTraceUsable(partialTrace), false);

  const started = Date.now();
  const hung = harness({ hung: true, stopMs: 50 }); hung.child.stdout.write(positive); await hung.flushed();
  const hungTrace = await hung.stop();
  assert.deepEqual(hung.signals, ["SIGTERM", "SIGKILL"]); assert.equal(hungTrace.forcedStop, true); assert.equal(hungTrace.closed, false);
  assert.equal(doneTraceUsable(hungTrace), false); assert(Date.now() - started < 1000);
  hung.child.emit("close", null, "SIGKILL");

  const empty = harness(); assert.equal(doneTraceUsable(await empty.stop()), false); // Zero records can never prove absence.

  const directory = mkdtempSync(join(tmpdir(), "native-done-"));
  assert.throws(() => startDoneLog("owned-device", join(directory, "missing", "done.jsonl"), { launch: () => { throw new Error("must not launch"); } }), /ENOENT/);
  assert.throws(() => startDoneLog("../not-owned", join(directory, "done.jsonl"), { launch: () => { throw new Error("must not launch"); } }));
});

test("the actual runner brackets each exercise with this advisory stream and leaves the input observer alone", () => {
  const runner = readFileSync(new URL("./run.mjs", import.meta.url), "utf8");
  const input = runner.indexOf('stopInputLog = startInputObservation(device, join(directory, "input-events.jsonl"), { env });');
  const done = runner.indexOf('stopDoneLog = startDoneObservation(device, join(directory, "done-events.jsonl"), { env });');
  const exercise = runner.indexOf("await nativeInteraction({ device, bundleId, directory, prefix: \"scenario\"");
  assert(input >= 0 && input < done && done < exercise);
  const success = runner.indexOf("result.inputTrace = await stopInputLog();");
  assert(exercise < success && success < runner.indexOf("result.doneTrace = await stopDoneLog();"));
  const cleanup = runner.indexOf("receipt.scenarios.at(-1).inputTrace = await stopInputLog();");
  const doneCleanup = runner.indexOf("receipt.scenarios.at(-1).doneTrace = await stopDoneLog();");
  assert(cleanup >= 0 && cleanup < doneCleanup && doneCleanup < runner.indexOf('spawnSync("xcrun", ["simctl", "shutdown", device]'));
});
