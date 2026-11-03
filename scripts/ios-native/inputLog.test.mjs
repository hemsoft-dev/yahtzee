import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { inputEvent, startInputLog } from "./inputLog.mjs";

const line = (phase = "score-handler", extra = {}) => JSON.stringify({ eventMessage: "THIRD_ROLL_INPUT " + JSON.stringify({ phase, atMs: 123, monotonicMs: 10, sequence: 1, ...extra }), privateOSMetadata: "never retained" });
test("only explicit timestamp/phase fields survive the OS log boundary", () => {
  assert.equal(inputEvent(line()).phase, "score-handler");
  for (const raw of ["not json", line("private name"), line("heartbeat", { token: "secret" }), line("heartbeat", { atMs: -1 }), line("heartbeat", { sequence: 1.5 })]) assert.equal(inputEvent(raw), null);
});
function harness(options = {}) {
  const child = new EventEmitter(); child.stdout = new PassThrough(); const signals = [];
  child.kill = (signal) => { signals.push(signal); if (!options.hung) child.emit("close", 0); };
  const path = join(mkdtempSync(join(tmpdir(), "native-input-")), "input.jsonl");
  const stop = startInputLog("owned-device", path, { ...options, now: () => 456, launch: (command, args) => {
    assert.equal(command, "xcrun"); assert.deepEqual(args.slice(0, 5), ["simctl", "spawn", "owned-device", "log", "stream"]);
    assert(args.includes("ndjson")); return child;
  } });
  return { child, signals, stop, read: () => readFileSync(path, "utf8") };
}
test("fragmented streaming is sanitized, bounded and stopped exactly once", async () => {
  const h = harness({ limit: 2 }); const bytes = line("heartbeat") + "\n" + line() + "\n" + line() + "\n";
  h.child.stdout.write(bytes.slice(0, 17)); h.child.stdout.write(bytes.slice(17));
  h.child.stdout.write("x".repeat(20000) + "\n");
  const first = h.stop(); assert.equal(h.stop(), first);
  assert.deepEqual(await first, { events: 2, dropped: 1, heartbeat: true, error: null, closed: true });
  const records = h.read().trim().split("\n").map(JSON.parse);
  assert.equal(records[1].receivedAtMs, 456); assert(!h.read().includes("privateOSMetadata"));
  assert.deepEqual(h.signals, ["SIGTERM"]);
});
test("hung collector is terminated within its shutdown budget, never a flow replay", async () => {
  const h = harness({ hung: true, stopMs: 5 });
  const result = await h.stop(); assert.equal(result.closed, false);
  assert.deepEqual(h.signals, ["SIGTERM", "SIGKILL"]);
});
test("spawn failure is recorded as unavailable evidence, not absence of handler entry", async () => {
  const h = harness(); h.child.emit("error", new Error("private error message"));
  const result = await h.stop(); assert.equal(result.error, "input-log-spawn-failed"); assert.equal(h.read(), "");
});

test("stream errors invalidate evidence instead of being mistaken for an absent handler", async () => {
  const h = harness(); h.child.stdout.emit("error", new Error("private stream detail"));
  h.child.stdout.write(line() + "\n");
  const result = await h.stop(); assert.equal(result.error, "input-log-read-failed"); assert.equal(result.events, 0);
});
