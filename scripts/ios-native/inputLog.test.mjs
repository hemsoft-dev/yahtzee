import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { inputEvent, inputTraceUsable, startInputLog } from "./inputLog.mjs";

const line = (phase = "score-handler", extra = {}) => JSON.stringify({ eventMessage: "THIRD_ROLL_INPUT " + JSON.stringify({ phase, atMs: 123, monotonicMs: 10, sequence: 1, ...extra }), privateOSMetadata: "never retained" });
test("picker boundary accepts finite phases/IDs only, never labels/errors/native acknowledgment", () => {
  for (const phase of ["picker-press-in", "picker-press-out", "picker-handler", "picker-native-call", "picker-native-returned", "picker-native-threw", "picker-callback-cancel", "picker-callback-unknown", "picker-callback-late", "picker-callback-option-0", "picker-callback-option-3", "picker-observation-disabled", "picker-observation-detached", "picker-observation-superseded", "picker-inline-fallback"]) {
    const pickerId = phase === "picker-press-in" ? 1 : 0; assert.equal(inputEvent(line(phase, { pickerId }))?.phase, phase);
    for (const extra of [{ pickerId, title: "PRIVATE" }, { pickerId, error: "PRIVATE" }, { pickerId: 8192 }, { pickerId: -1 }, { pickerId, sequence: 8192 }, { pickerId, atMs: -1 }]) assert.equal(inputEvent(line(phase, extra)), null);
  }
  for (const phase of ["picker-opened", "picker-presented", "picker-callback-option-4"]) assert.equal(inputEvent(line(phase, { pickerId: 0 })), null);
});
test("Help parser accepts only finite private numeric schema and valid phase/sequence relationships", () => {
  for (const phase of ["help-press-in", "help-press-out", "help-handler", "help-callback-returned", "help-callback-threw", "help-observation-detached", "help-observation-disabled", "help-observation-superseded"]) {
    const helpId = phase === "help-press-in" ? 1 : 0;
    assert.equal(inputEvent(line(phase, { helpId }))?.phase, phase);
    for (const extra of [{ helpId, route: "/private" }, { helpId: -1 }, { helpId: 8192 }, { helpId, sequence: 8192 }, { helpId, atMs: -1 }, { helpId, nativeEvent: {} }]) assert.equal(inputEvent(line(phase, extra)), null);
  }
  assert.equal(inputEvent(line("help-native-ack", { helpId: 0 })), null);
  assert.equal(inputEvent(line("help-callback-returned", { helpId: 1 })), null);
});
function harness(options = {}) {
  const child = new EventEmitter(); child.stdout = new PassThrough(); const signals = [];
  child.kill = (signal) => {
    signals.push(signal);
    if (!options.hung) child.emit("close", options.exitCode ?? 0, options.exitSignal ?? null);
  };
  const path = join(mkdtempSync(join(tmpdir(), "native-input-")), "input.jsonl");
  const env = { DEVELOPER_DIR: "/Applications/Xcode_26.6.app/Contents/Developer", PRIVATE_ENV: "not-retained" };
  const stop = startInputLog("owned-device", path, { ...options, env, now: () => 456, launch: (command, args, settings) => {
    assert.equal(command, "xcrun"); assert.deepEqual(args.slice(0, 5), ["simctl", "spawn", "owned-device", "log", "stream"]);
    assert(args.includes("ndjson")); assert.equal(settings.env, env); return child;
  } });
  return { child, signals, stop, read: () => readFileSync(path, "utf8") };
}
const heartbeat = (h) => h.child.stdout.write(line("heartbeat") + "\n");

test("only explicit timestamp/phase fields survive the OS log boundary", () => {
  assert.equal(inputEvent(line()).phase, "score-handler");
  for (const raw of ["not json", line("private name"), line("heartbeat", { token: "secret" }), line("heartbeat", { atMs: -1 }), line("heartbeat", { sequence: 1.5 })]) assert.equal(inputEvent(raw), null);
});

test("producer sequence bound applies to every phase family and malformed streaming stays unavailable", async () => {
  const cases = [
    ["boot", {}], ["heartbeat", {}], ["score-handler", {}],
    ["resume-handler", { resumeId: 0 }], ["start-handler", { startId: 0 }],
    ["preference-dice-10-react-commit", { preferenceId: 0 }],
    ["start-preference-dice-intent", { startId: 1, preferenceId: 0 }],
  ];
  for (const [phase, extra] of cases) {
    assert.equal(inputEvent(line(phase, { ...extra, sequence: 8191 }))?.sequence, 8191);
    assert.equal(inputEvent(line(phase, { ...extra, sequence: 8192 })), null);
  }
  const h = harness(); heartbeat(h);
  h.child.stdout.write(line("heartbeat", { sequence: 8192 }) + "\n");
  const result = await h.stop();
  assert.equal(result.error, "input-log-malformed-record"); assert.equal(result.dropped, 1);
  assert.equal(inputTraceUsable(result), false);
  assert.deepEqual(h.read().trim().split("\n").map(JSON.parse).map((event) => event.sequence), [1]);
});

test("Resume protocol retains only a bounded numeric correlation ID and fixed observation phases", async () => {
  assert.equal(inputEvent(line("resume-handler", { resumeId: 1 })).resumeId, 1);
  assert.equal(inputEvent(line("resume-handler", { resumeId: 0 })).resumeId, 0);
  assert.equal(inputEvent(line("resume-press-in", { resumeId: 1 })).resumeId, 1);
  for (const phase of ["resume-press-out", "resume-observation-detached", "resume-observation-disabled", "resume-observation-superseded"]) {
    assert.equal(inputEvent(line(phase, { resumeId: 0 })).resumeId, 0);
    assert.equal(inputEvent(line(phase, { resumeId: 1 })), null);
  }
  for (const branch of ["loading", "setup", "play", "results"]) {
    assert.equal(inputEvent(line(`resume-react-commit-${branch}`, { resumeId: 0 })).resumeId, 0);
  }
  for (const raw of [line("resume-handler"), line("resume-handler", { resumeId: "player" }),
    line("resume-handler", { resumeId: 2 }), line("resume-handler", { resumeId: 8192, sequence: 8192 }),
    line("resume-press-in", { resumeId: 0 }), line("resume-press-in", { resumeId: 1, player: "private" }),
    line("resume-press-cancelled", { resumeId: 0 }),
    line("resume-react-commit-play", { resumeId: 1 }), line("resume-react-commit-paint", { resumeId: 0 }),
    line("resume-react-commit-play", { resumeId: -1 }), line("resume-handler", { resumeId: 1, name: "private" }),
    line("score-handler", { resumeId: 0 })]) assert.equal(inputEvent(raw), null);
  const h = harness(); heartbeat(h);
  h.child.stdout.write(line("resume-handler", { resumeId: 1 }) + "\n"
    + line("resume-react-commit-play", { sequence: 2, resumeId: 1 }) + "\n" + line("score-ack", { sequence: 3 }) + "\n");
  const result = await h.stop();
  assert.equal(inputTraceUsable(result), true); assert.equal(result.events, 4);
  assert.deepEqual(h.read().trim().split("\n").map(JSON.parse).map((event) => event.phase),
    ["heartbeat", "resume-handler", "resume-react-commit-play", "score-ack"]);
});

test("native touch boundary phases accept one bounded ID only and reject native values or other touch phases", async () => {
  for (const phase of ["resume-touch-end", "resume-touch-cancel"]) {
    assert.equal(inputEvent(line(phase, { resumeId: 0 })).resumeId, 0);
    for (const extra of [{ resumeId: 1 }, { resumeId: 2 }, { resumeId: -1 }, { resumeId: "0" }, { resumeId: 8192 }, { resumeId: 0, sequence: 8192 }, {},
      { resumeId: 0, identifier: 1 }, { resumeId: 0, timestamp: 1 }, { resumeId: 0, changedTouches: [] }, { resumeId: 0, pageX: 1 }, { resumeId: 0, target: 1 }, { resumeId: 0, reason: "PRIVATE" }, { resumeId: 0, nativeEvent: {} }]) {
      assert.equal(inputEvent(line(phase, extra)), null);
    }
    assert.equal(inputEvent(line(phase, { helpId: 0 })), null);
  }
  for (const phase of ["resume-touch-start", "resume-touch-move", "resume-touch-ended", "resume-native-cancel", "start-touch-end", "help-touch-end", "picker-touch-cancel"]) {
    for (const id of ["resumeId", "startId", "helpId", "pickerId"]) assert.equal(inputEvent(line(phase, { [id]: 0 })), null);
  }
  const h = harness(); heartbeat(h);
  const phases = ["resume-press-in", "resume-touch-cancel", "resume-press-out"];
  for (const [index, phase] of phases.entries()) h.child.stdout.write(line(phase, { resumeId: 1, sequence: index + 1 }) + "\n");
  const result = await h.stop();
  assert.equal(inputTraceUsable(result), true);
  assert.deepEqual(h.read().trim().split("\n").map(JSON.parse).slice(1).map((record) => record.phase), phases);
  // Collector health stays unrelated to which phases arrived.
  assert.equal(inputTraceUsable({ ...result, exitCode: 143, exitSignal: null }), false);
});

test("streamed press, handler and React commit retain one ID without changing capture health", async () => {
  const h = harness(); heartbeat(h);
  const phases = ["resume-press-in", "resume-handler", "resume-react-commit-play", "resume-press-out"];
  for (const [index, phase] of phases.entries()) h.child.stdout.write(line(phase, { resumeId: 1, sequence: index + 1 }) + "\n");
  const result = await h.stop();
  assert.equal(inputTraceUsable(result), true);
  const records = h.read().trim().split("\n").map(JSON.parse).slice(1);
  assert.deepEqual(records.map((record) => record.phase), phases);
  assert(records.every((record) => record.resumeId === 1));
  assert.equal(inputTraceUsable({ ...result, exitCode: 143, exitSignal: null }), false);
});
test("healthy fragmented streaming pins the developer directory and stops exactly once", async () => {
  const h = harness(); const bytes = line("heartbeat") + "\n" + line() + "\n";
  h.child.stdout.write(bytes.slice(0, 17)); h.child.stdout.write(bytes.slice(17));
  const first = h.stop(); assert.equal(h.stop(), first); const result = await first;
  assert.equal(inputTraceUsable(result), true); assert.equal(result.events, 2);
  assert.equal(result.exitCode, 0); assert.equal(result.stopRequested, true);
  assert.equal(result.unexpectedExit, false); assert.equal(result.forcedStop, false);
  assert.equal(result.startedAtMs, 456); assert.equal(result.closedAtMs, 456);
  const records = h.read().trim().split("\n").map(JSON.parse);
  assert.equal(records[1].receivedAtMs, 456); assert(!h.read().includes("privateOSMetadata")); assert(!h.read().includes("PRIVATE_ENV"));
  assert.deepEqual(h.signals, ["SIGTERM"]);
  for (const patch of [{ schemaVersion: 1 }, { dropped: 1 }, { oversizedLines: 1 }, { unterminatedLines: 1 }, { unexpectedExit: true }, { forcedStop: true }, { stopRequested: false }, { error: "broken" }, { exitCode: 7 }, { heartbeat: false }, { closed: false }]) assert.equal(inputTraceUsable({ ...result, ...patch }), false);
  assert.equal(inputTraceUsable({ heartbeat: true, closed: true, error: null }), false, "legacy receipt cannot certify complete capture");
});
for (const code of [0, 3]) test(`early exit ${code} after a heartbeat is unavailable, never healthy`, async () => {
  const h = harness(); heartbeat(h); h.child.emit("close", code, null);
  const result = await h.stop(); assert.equal(result.unexpectedExit, true); assert.equal(result.exitCode, code);
  assert.equal(result.error, "input-log-exited-before-stop"); assert.equal(inputTraceUsable(result), false);
  assert.deepEqual(h.signals, []);
});
test("a nonzero exit during requested shutdown is unavailable", async () => {
  const h = harness({ exitCode: 9 }); heartbeat(h); const result = await h.stop();
  assert.equal(result.error, "input-log-exit-failed"); assert.equal(inputTraceUsable(result), false);
});
test("an oversized line is counted once across fragments and invalidates capture", async () => {
  const h = harness(); heartbeat(h);
  h.child.stdout.write("x".repeat(10000)); h.child.stdout.write("x".repeat(10000)); h.child.stdout.write("x".repeat(10000) + "\n");
  const result = await h.stop(); assert.equal(result.dropped, 1); assert.equal(result.oversizedLines, 1);
  assert.equal(result.error, "input-log-oversized-record"); assert.equal(inputTraceUsable(result), false);
});
for (const tail of [line(), "x".repeat(20000)]) test(`unterminated ${tail.length > 16384 ? "oversized" : "normal"} tail is explicit incomplete evidence`, async () => {
  const h = harness(); heartbeat(h); h.child.stdout.write(tail);
  const result = await h.stop(); assert.equal(result.dropped, 1); assert.equal(result.unterminatedLines, 1);
  assert.equal(inputTraceUsable(result), false); assert(result.error);
});
test("event-limit truncation and malformed traced records are unavailable", async () => {
  for (const options of [{ limit: 1 }, {}]) {
    const h = harness(options); heartbeat(h); h.child.stdout.write((options.limit ? line() : line("heartbeat", { token: "secret" })) + "\n");
    const result = await h.stop(); assert.equal(result.dropped, 1); assert.equal(inputTraceUsable(result), false); assert(!h.read().includes("secret"));
  }
});
test("forced shutdown retains failure and uses the existing total budget", async () => {
  const h = harness({ hung: true, stopMs: 10 }); heartbeat(h);
  const result = await h.stop(); assert.equal(result.closed, false); assert.equal(result.forcedStop, true);
  assert.equal(inputTraceUsable(result), false); assert.deepEqual(h.signals, ["SIGTERM", "SIGKILL"]);
  h.child.emit("close", null, "SIGKILL");
});
test("process and stream errors cannot look like absence of a handler", async () => {
  for (const stream of [false, true]) {
    const h = harness(); heartbeat(h);
    (stream ? h.child.stdout : h.child).emit("error", new Error("private detail"));
    const result = await h.stop(); assert(result.error); assert.equal(inputTraceUsable(result), false); assert(!h.read().includes("private detail"));
  }
});

test("exit before stop remains premature even if close drains after stop", async () => {
  const h = harness(); heartbeat(h); h.child.emit("exit", 0, null);
  const resultPromise = h.stop(); queueMicrotask(() => h.child.emit("close", 0, null));
  const result = await resultPromise; assert.equal(inputTraceUsable(result), false);
  assert.equal(result.unexpectedExit, true); assert.deepEqual(h.signals, []);
});
test("stdout ending before requested shutdown invalidates the trace", async () => {
  const h = harness(); heartbeat(h); h.child.stdout.end();
  await new Promise((resolve) => setImmediate(resolve));
  const result = await h.stop(); assert.equal(inputTraceUsable(result), false);
  assert.equal(result.error, "input-log-stream-ended-before-stop");
});
test("a real owned subprocess is retired and retains an intentional exit receipt", async () => {
  const path = join(mkdtempSync(join(tmpdir(), "native-input-real-")), "input.jsonl");
  const child = spawn(process.execPath, ["-e", `process.stdout.write(${JSON.stringify(line("heartbeat") + "\n")});setInterval(()=>{},1000);`], { stdio: ["ignore", "pipe", "ignore"] });
  const ready = new Promise((resolve) => child.stdout.once("data", resolve));
  const stop = startInputLog("owned-device", path, { launch: () => child });
  let timer;
  try {
    await Promise.race([ready, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("child readiness timeout")), 5000); })]);
    const result = await stop(); assert.equal(inputTraceUsable(result), true, JSON.stringify(result));
    assert.equal(result.closed, true); assert.equal(result.unexpectedExit, false);
  } finally { clearTimeout(timer); child.kill("SIGKILL"); await stop(); }
});

test("Start and selection allowlists preserve fixed IDs and reject sensitive or unknown fields", () => {
  for (const [phase, extra] of [
    ["start-press-in", { startId: 1 }], ["start-handler", { startId: 0 }], ["start-decision-busy", { startId: 0 }],
    ["start-write-ack", { startId: 0 }], ["start-react-commit-play", { startId: 0 }],
    ["preference-dice-10-intent", { preferenceId: 1 }], ["preference-ai-3-react-commit", { preferenceId: 0 }],
    ["start-preference-dice-intent", { startId: 1, preferenceId: 0, sequence: 3 }],
  ]) {
    assert(inputEvent(line(phase, extra)));
    assert.equal(inputEvent(line(phase, { ...extra, name: "PRIVATE" })), null);
  }
  for (const [phase, extra] of [["start-press-in", { startId: 0 }], ["start-handler", { startId: 8192 }],
    ["start-write-ack", { startId: 1 }], ["start-native-paint", { startId: 0 }], ["preference-dice-999-intent", { preferenceId: 1 }],
    ["preference-dice-10-intent", { preferenceId: "PRIVATE" }]]) assert.equal(inputEvent(line(phase, extra)), null);
});
