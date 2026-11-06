import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import test from "node:test";
import { rpcClient } from "../ios-native/mcp.mjs";
import { BUDGET, PLAN, TEXT, stageArguments } from "./protocol.mjs";
import { runProbeSession } from "./session.mjs";

const DEVICE = "0A1B2C3D-0000-1111-2222-333344445555";
const text = (value) => ({ content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value) }] });
const hierarchy = (...texts) => text({ ui_schema: {}, elements: texts.map((txt) => ({ txt })) });

/** Child process stand-in for the real rpcClient transport. `reply` returning undefined never answers. */
function fakeMaestro(reply) {
  const child = new EventEmitter();
  const calls = [];
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = new Writable({
    write(chunk, _encoding, done) {
      for (const line of chunk.toString().split("\n").filter(Boolean)) {
        const message = JSON.parse(line);
        if (message.id === undefined) continue;
        calls.push(message);
        const result = message.method === "initialize" ? { protocolVersion: "2024-11-05", serverInfo: { name: "maestro" } } : reply(message.params, calls);
        if (result !== undefined) setImmediate(() => child.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }) + "\n"));
      }
      done();
    },
    final(done) { setImmediate(() => child.emit("close", 0, null)); done(); },
  });
  child.kill = () => child.emit("close", null, "SIGKILL");
  return { child, calls };
}

function scripted(overrides = {}) {
  const screens = { S01: hierarchy(TEXT.intro, TEXT.open), S02: hierarchy(TEXT.intro, TEXT.open), S05: hierarchy(TEXT.current, TEXT.duo), S08: hierarchy(TEXT.ack) };
  return (params) => {
    if (params.name === "list_devices") return text({ devices: [{ device_id: DEVICE, platform: "ios", connected: true }] });
    const stage = PLAN.find((item) => JSON.stringify(stageArguments(item, DEVICE)) === JSON.stringify(params.arguments) && item.tool === params.name
      && !scripted.seen.has(item.id));
    assert(stage, "Every request must be a plan stage's exact arguments.");
    scripted.seen.add(stage.id);
    if (Object.hasOwn(overrides, stage.id)) return overrides[stage.id];
    return stage.tool === "inspect_screen" ? screens[stage.id] : text({ success: true, commands_executed: 1 });
  };
}
scripted.seen = new Set();

async function probe(reply, { budget = BUDGET, plan = PLAN } = {}) {
  scripted.seen = new Set();
  const { child, calls } = fakeMaestro(reply);
  const journal = [];
  const result = await runProbeSession({ device: DEVICE, budget, plan, journal: (entry) => journal.push(entry),
    openTransport: ({ deadline }) => rpcClient(child, { timeoutMs: budget.requestMs, deadline }) });
  return { result, calls: calls.filter((call) => call.method === "tools/call").map((call) => call.params), journal };
}

test("a stage id is never sent twice, even if a plan repeats it", async () => {
  const { result, calls } = await probe((params) => (params.name === "list_devices"
    ? text({ devices: [{ device_id: DEVICE, platform: "ios", connected: true }] }) : hierarchy(TEXT.intro)), { plan: [PLAN[0], PLAN[0]] });
  assert.equal(calls.filter((call) => call.name === "inspect_screen").length, 1);
  assert.equal(result.status, "session-failed");
});

test("a healthy sequence sends every stage once, in order, with the plan's exact arguments", async () => {
  const { result, calls, journal } = await probe(scripted());
  assert.equal(result.status, "completed");
  assert.equal(result.session.shutdown, "closed");
  assert.deepEqual(calls.map((call) => call.name), ["list_devices", ...PLAN.map((stage) => stage.tool)]);
  assert.deepEqual(calls.slice(1).map((call) => call.arguments), PLAN.map((stage) => stageArguments(stage, DEVICE)));
  assert.deepEqual(result.stages.map((stage) => stage.boundary), ["query-returned", "query-returned", "command-returned", "command-returned",
    "query-returned", "command-returned", "command-returned", "query-returned", "command-returned"]);
  assert.equal(result.stages[0].includesDriverStartup, true);
  assert.deepEqual(journal.map((entry) => `${entry.event}:${entry.id}`), PLAN.flatMap((stage) => [`stage-start:${stage.id}`, `stage-end:${stage.id}`]));
  assert(result.stages.every((stage) => /^[0-9a-f]{64}$/.test(stage.argumentsSha256)));
});

test("an original assertion failure is recorded once and the fixed plan continues without replay", async () => {
  const { result, calls } = await probe(scripted({ S06: { isError: true, content: [{ type: "text", text: "Failed to run flow: Assertion is false: \"Current: Solo\" is visible" }] } }));
  const s06 = result.stages.find((stage) => stage.id === "S06");
  assert.equal(s06.boundary, "app-assertion-failed");
  assert.equal(s06.errorClass, "assertion-false");
  assert.equal(calls.filter((call) => call.arguments.yaml === stageArguments(PLAN[5], DEVICE).yaml).length, 1);
  assert.equal(result.stages.length, PLAN.length);
  assert.equal(result.status, "completed");
  assert(!JSON.stringify(result).includes("Current: Solo"), "Error text never reaches the result.");
});

test("a transport error stops the sequence; later stages are not run, not reported as absent", async () => {
  const { result, calls } = await probe(scripted({ S04: { isError: true, content: [{ type: "text", text: "Device became unreachable during touch" }] } }));
  assert.equal(result.status, "stopped");
  assert.equal(calls.length, 1 + 4);
  const later = result.stages.slice(4);
  assert(later.every((stage) => stage.outcome === "not-run" && stage.notRunReason === "stopped-after-S04" && stage.boundary === "not-run"));
  assert.equal(result.stages[3].unreachableOperation, "touch");
});

test("sensitivity control: a request that never answers ends at its bound with the start journaled", async () => {
  // A manufactured hang in a fake server. It exercises the bound; it does not reproduce XCTest IPC failure.
  const budget = { ...BUDGET, requestMs: 50, sessionMs: 5000 };
  const { result, calls, journal } = await probe(scripted({ S05: undefined }), { budget });
  const s05 = result.stages.find((stage) => stage.id === "S05");
  assert.equal(s05.outcome, "request-timeout");
  assert.equal(s05.boundary, "no-response");
  assert(s05.elapsedMs >= 40);
  assert(journal.some((entry) => entry.event === "stage-start" && entry.id === "S05"));
  assert(result.stages.slice(5).every((stage) => stage.notRunReason === "stopped-after-S05"));
  assert.equal(calls.length, 1 + 5);
  assert.equal(result.status, "stopped");
});

test("the session deadline stops further requests without sending them", async () => {
  let clock = 0;
  const { child, calls } = fakeMaestro((params) => { clock += 400; return scripted()(params); });
  scripted.seen = new Set();
  const result = await runProbeSession({ device: DEVICE, now: () => clock, budget: { ...BUDGET, sessionMs: 1000 },
    openTransport: () => rpcClient(child, { timeoutMs: 1000, deadline: Date.now() + 60000 }) });
  const sent = calls.filter((call) => call.method === "tools/call").length;
  assert(sent < 1 + PLAN.length);
  assert(result.stages.some((stage) => stage.notRunReason === "deadline-exhausted"));
  assert.equal(result.status, "stopped");
});

test("no flow is sent when the owned simulator is not connected", async () => {
  const { result, calls } = await probe((params) => (params.name === "list_devices" ? text({ devices: [{ device_id: "OTHER", platform: "ios", connected: true }] }) : assert.fail("sent")));
  assert.equal(result.status, "device-not-connected");
  assert.deepEqual(calls.map((call) => call.name), ["list_devices"]);
  assert.equal(result.stages.length, 0);
  assert.equal(result.session.shutdown, "closed");
});

test("a non-Maestro server is refused before any tool call", async () => {
  const child = new EventEmitter();
  child.stdout = new PassThrough(); child.stderr = new PassThrough();
  const sent = [];
  child.stdin = new Writable({ write(chunk, _e, done) {
    for (const line of chunk.toString().split("\n").filter(Boolean)) {
      const message = JSON.parse(line); sent.push(message.method);
      if (message.method === "initialize") setImmediate(() => child.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { protocolVersion: "2024-11-05", serverInfo: { name: "other" } } }) + "\n"));
    }
    done();
  }, final(done) { setImmediate(() => child.emit("close", 0, null)); done(); } });
  child.kill = () => child.emit("close", null, "SIGKILL");
  const result = await runProbeSession({ device: DEVICE, openTransport: ({ deadline }) => rpcClient(child, { timeoutMs: 1000, deadline }) });
  assert.equal(result.session.initialize, "unexpected-server");
  assert.deepEqual(sent, ["initialize"]);
});
