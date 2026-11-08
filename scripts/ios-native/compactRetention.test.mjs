import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { compactEnvironment, compactChildEnvironment, compactRequest, bindCompactRequest, compactCollector } from "./compact/retention.mjs";
import { nativeInteraction } from "./interaction.mjs";
import { rpcClient } from "./mcp.mjs";

const source = "a".repeat(40), env = { PATH: "fixture", GITHUB_RUN_ID: "9", GITHUB_RUN_ATTEMPT: "2" };
const identity = compactChildEnvironment(compactEnvironment(env, "reset-document", source), "reset", "/fixture/reset-document");
const base = { v: 1, pid: 123, source, run: "9", attempt: "2", invoke: 1, flow: 4, route: 1, rpc: 7, monoUs: 1000 };
const entry = { ...base, seq: 0, stage: 0, phase: 0 };
const fact = { ...base, seq: 1, stage: 1, node: 2, parent: 1, outputParent: 1, depth: 1, rawHelp: 1, outputHelp: 1,
  kind: 2, reason: 0, post: 2, enabled: 1, rect: [1, 80, 99, 99] };
const summary = { ...base, seq: 2, stage: 2, query: 2, formatter: 2, handler: 2, visited: 2, kept: 2, zero: 0, empty: 0,
  preHelp: 1, preTarget: 1, postHelp: 1, postTarget: 1, partial: 0, facts: 1, queryBeginUs: 900, queryEndUs: 950, formatBeginUs: 960, formatEndUs: 990 };
const text = rows => rows.map(row => "THIRDROLL_COMPACT " + JSON.stringify(row) + "\n").join("");
function collect(value, binding = identity) {
  let saved, ordinary = "";
  const collector = compactCollector(binding, chunk => { ordinary += chunk; });
  collector.feed(value);
  const result = collector.retain("/fixture", (_path, bytes, options) => { assert.equal(options.flag, "wx"); saved = bytes; });
  assert.equal(JSON.stringify(result) + "\n", saved);
  return { result, saved, ordinary };
}

test("only the authored reset scope forwards exact current source/run identity", () => {
  assert.deepEqual(identity, { THIRDROLL_COMPACT_SOURCE: source, THIRDROLL_COMPACT_RUN: "9", THIRDROLL_COMPACT_ATTEMPT: "2", THIRDROLL_COMPACT_ROUTE: "1" });
  for (const name of ["scenario", "unknown", "reset-document-other"]) assert.equal(compactEnvironment(env, name, source), env);
  assert.equal(compactEnvironment({ ...env, GITHUB_RUN_ID: "secret" }, "reset-document", source).THIRDROLL_COMPACT_SOURCE, undefined);
  for (const phase of ["scenario", "complete", "hold"]) assert.deepEqual(compactChildEnvironment({ ...env, ...identity }, phase, "/fixture/reset-document"), {});
  assert.deepEqual(compactChildEnvironment({ ...env, ...identity }, "reset", "/fixture/reset-database"), {});
  assert.deepEqual(compactChildEnvironment({ ...env, ...identity, GITHUB_RUN_ID: "8" }, "reset", "/fixture/reset-document"), {});
  assert.deepEqual(compactRequest(identity, 1, 4), { v: 1, invoke: 1, flow: 4, route: 1 });
  for (const id of [0, 37, 1.5]) assert.equal(compactRequest(identity, id, 4), undefined);
  assert.equal(compactRequest({}, 1, 4), undefined);
});

test("metadata binds to the same original RPC id, with identical original arguments and unobserved objects", async () => {
  const params = { name: "inspect_screen", arguments: { device_id: "owned" } }, observation = compactRequest(identity, 1, 4);
  const copy = structuredClone(params);
  const bound = bindCompactRequest("tools/call", params, observation, 7);
  assert.equal(bound.arguments, params.arguments); assert.deepEqual(params, copy);
  assert.deepEqual(bound._meta, { "dev.hemsoft/compact": { v: 1, invoke: 1, flow: 4, route: 1, rpc: 7 } });
  assert.equal(bindCompactRequest("tools/call", params, undefined, 7), params);
  assert.equal(bindCompactRequest("tools/call", { name: "run" }, observation, 7).name, "run");
  assert.equal(bindCompactRequest("tools/call", params, { ...observation, secret: "do-not-export" }, 7), params);
  assert.equal(bindCompactRequest("tools/call", params, new Proxy({}, { ownKeys() { throw new Error(); } }), 7), params);
  const child = new EventEmitter(); child.stdout = new PassThrough(); child.stdin = new PassThrough();
  const rpc = rpcClient(child, { timeoutMs: 1000 });
  let sent;
  child.stdin.on("data", bytes => {
    sent = JSON.parse(bytes);
    child.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: sent.id, result: { original: 1 } }) + "\n");
  });
  assert.deepEqual(await rpc.request("tools/call", params, observation), { original: 1 });
  assert.equal(sent.id, sent.params._meta["dev.hemsoft/compact"].rpc);
  assert.deepEqual(sent.params.arguments, params.arguments);
  child.emit("close", 0, null);
});

test("complete same-invocation facts retain numeric branches and original parent/hoisting identities", () => {
  const value = collect(text([entry, fact, summary]));
  assert.equal(value.result.status, "observed"); assert.deepEqual(value.result.records, [entry, fact, summary]);
  assert(!value.saved.includes("Delete") && !value.saved.includes("help-viewport"));
  for (const reason of [1, 2]) {
    const dropped = { ...fact, reason, post: 0, enabled: -1, outputParent: 0, outputHelp: 0 };
    const result = collect(text([entry, dropped, { ...summary, kept: 1, zero: reason === 1 ? 1 : 0, empty: reason === 2 ? 1 : 0, postTarget: 0 }]));
    assert.equal(result.result.status, "observed");
    assert.equal(result.result.records[1].rawHelp, 1); assert.equal(result.result.records[1].outputHelp, 0);
  }
});

test("split/malicious/large/malformed observer chunks are removed before persistence while ordinary stderr is preserved", () => {
  const collector = compactCollector(identity, chunk => { ordinary += chunk; }); let ordinary = "", saved;
  const original = "before\n" + text([entry]) + "ordinary-long-" + "x".repeat(9000) + "\n" +
    "THIRDROLL_COMPACT {\"secret\":\"secret-token-path-private-UI\"}\n" +
    "THIRDROLL_COMPACT " + "private-secret".repeat(1000) + "\n" + text([fact, summary]) + "after\n";
  for (let i = 0; i < original.length; i += 7) collector.feed(original.slice(i, i + 7));
  const result = collector.retain("/fixture", (_path, bytes) => { saved = bytes; });
  assert.equal(result.status, "partial"); assert.equal(result.records.length, 3);
  assert.equal(ordinary, "before\nordinary-long-" + "x".repeat(9000) + "\nafter\n");
  assert(!saved.includes("private") && !ordinary.includes("secret"));
});

test("gaps, stale identities, unsupported fields, incomplete callbacks and capping remain partial or unavailable", () => {
  const bad = [
    [{ ...entry, source: "b".repeat(40) }, fact, summary],
    [entry, { ...fact, seq: 2 }, summary],
    [entry, fact, { ...summary, flow: 5 }],
    [entry, { ...fact, secret: "never-retained" }, summary],
    [entry, { ...fact, rect: [0, 0, Infinity, 1] }, summary],
    [entry, fact],
    [entry, fact, { ...summary, partial: 1 }],
    [entry, fact, { ...summary, facts: 2 }],
    [entry, fact, { ...summary, query: 3, formatter: 0 }],
    [entry, { ...fact, monoUs: null }, summary],
    [entry, fact, summary, fact],
  ];
  for (const rows of bad) {
    const result = collect(text(rows)).result;
    assert.notEqual(result.status, "observed"); assert.equal(result.absenceProvesNothing, true);
    assert(!JSON.stringify(result).includes("never-retained"));
  }
  assert.equal(collect(text([entry]).trimEnd()).result.status, "unavailable");
  const oversized = collect(text([entry, fact, summary]).repeat(10000)).result;
  assert(oversized.records.length <= 432 && oversized.retainedBytes <= 160 * 1024);
});

test("retention is once-only and immutable, and a sink failure cannot throw or overwrite evidence", () => {
  let writes = 0, frozen;
  const collector = compactCollector(identity); collector.feed(text([entry, fact, summary]));
  collector.retain("/fixture", (_path, bytes) => { writes++; frozen = bytes; });
  collector.feed("THIRDROLL_COMPACT private-after-close\n"); collector.retain("/fixture", () => { writes++; });
  assert.equal(writes, 1); assert(!frozen.includes("private-after-close"));
  const throwing = compactCollector(identity); throwing.feed(text([entry]));
  assert.equal(throwing.retain("/fixture", () => { throw new Error("private-error"); }).status, "unavailable");
});

test("the real interaction launcher forwards owned identity and retains the original failed inspection before close", async () => {
  const root = mkdtempSync(join(tmpdir(), "compact-integration-")), directory = join(root, "reset-document"); mkdirSync(directory);
  const commands = [], marker = new Error("original-inspect-error"); let inspections = 0, closed = 0;
  try {
    await assert.rejects(nativeInteraction({ directory, device: "owned", bundleId: "owned.app", prefix: "reset",
      env: compactEnvironment(env, "reset-document", source), capture: async () => {},
      openSession: async ({ env: childEnv, onStderr }) => {
        for (const key of Object.keys(identity)) assert.equal(childEnv[key], identity[key]);
        return { call: async (name, args, metadata) => {
          commands.push(name);
          if (name === "list_devices") { assert.equal(metadata, undefined); return { devices: [{ device_id: "owned", platform: "ios", connected: true }] }; }
          if (name === "inspect_screen") {
            inspections++; assert.deepEqual(metadata, { v: 1, invoke: inspections, flow: inspections === 1 ? 0 : 1, route: 1 });
            const binding = { ...base, invoke: inspections, flow: metadata.flow };
            onStderr(text([{ ...entry, ...binding }, { ...fact, ...binding }, { ...summary, ...binding }]));
            if (inspections === 2) throw marker;
            return { elements: [] };
          }
          assert.equal(metadata, undefined); return { success: true };
        }, close: async () => {
          closed++;
          const evidence = JSON.parse(readFileSync(join(directory, "reset-compact-results-1.json")));
          assert.equal(evidence.records.length, 6); assert.equal(evidence.status, "observed");
        } };
      }, exercise: async io => { await io.run([{ waitForAnimationToEnd: { timeout: 1000 } }]); await io.inspect(); },
    }), error => error === marker);
    assert.deepEqual(commands, ["list_devices", "inspect_screen", "run", "inspect_screen"]);
    assert.equal(inspections, 2); assert.equal(closed, 1);
  } finally { rmSync(root, { recursive: true }); }
});
