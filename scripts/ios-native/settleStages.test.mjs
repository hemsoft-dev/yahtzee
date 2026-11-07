import test from "node:test";
import assert from "node:assert/strict";
import { parseStages, correlateStages, searchCommand } from "./settle/parse.mjs";
import { nativeInteraction } from "./interaction.mjs";
import { collectRoute } from "./settle/execute.mjs";
import { mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

const row = (seq, phase, more = {}) => ({ v: 1, seq, id: 1, stage: 1, phase, monoNs: seq * 1000000, pid: 42, wallMs: 100 + seq, ...more });
const log = (...rows) => rows.map((value) => `THIRDROLL_SETTLE ${JSON.stringify(value)}\n`).join("");

test("finite paired stages retain original return/error and conditional request boundaries", () => {
  const parsed = parseStages(log(row(0, 0), row(1, 1)));
  assert.equal(parsed.pairs[0].durationMs, 1);
  assert.equal(parsed.pairs[0].outcome, "returned");
  assert.equal(parsed.absenceProvesNothing, true);
  const [linked] = correlateStages(parsed, [{ tool: "run", flowSequence: 4, started: 99, elapsedMs: 4, outcome: "threw" }], { 4: 1 });
  assert.equal(linked.flowSequence, 4);
  assert.equal(linked.originalRequestOutcome, "threw");
  assert.equal(linked.correspondence, "conditional-local-wall");
  assert.equal(parseStages(log(row(0, 0), row(1, 2))).pairs[0].errorClass, "unknown");
});

test("partial prefixes, dropped records, duplicate IDs and clock contradictions never invent completion", () => {
  assert.equal(parseStages(log(row(0, 0))).pairs.length, 0);
  assert.equal(parseStages(log(row(0, 0), row(1, 1), row(2, 1))).pairs.length, 0);
  assert.equal(parseStages(log(row(0, 0), row(1, 1, { monoNs: -1 }))).pairs.length, 0);
  const gaps = parseStages(log(row(0, 0), row(2, 1)));
  assert.equal(gaps.contiguous, false);
  assert.equal(gaps.absenceProvesNothing, true);
  const pair = parseStages(log(row(0, 0), row(1, 1, { wallMs: 98 })));
  assert.equal(correlateStages(pair, [{ tool: "run", flowSequence: 1, started: 90, elapsedMs: 20, outcome: "returned" }], { 1: 1 })[0].flowSequence, null);
});

test("unknown keys and non-finite/private values are rejected, never echoed", () => {
  for (const extra of [{ privatePayload: "SECRET" }, { stage: 3 }, { id: 129 }, { seq: 256 }, { pid: 0 }, { wallMs: null }, { monoNs: 1e30 }]) {
    const parsed = parseStages(log(row(0, 0, extra)));
    assert.equal(parsed.invalid, 1);
    assert.equal(JSON.stringify(parsed).includes("SECRET"), false);
  }
  assert.equal(parseStages("not a stage SECRET\n").events.length, 0);
  assert.equal(parseStages("x".repeat(512 * 1024 + 1)).status, "unavailable");
});

test("classification admits only original fixed search operations and does not retain their payload", () => {
  const header = 'appId: "com.hemsoft.thirdroll"\n---\n';
  assert.equal(searchCommand(header + '- waitForAnimationToEnd: {"timeout":5000}\n'), 1);
  assert.equal(searchCommand(header + '- swipe: {"start":"516,1231","end":"516,231","duration":600}\n'), 2);
  for (const value of ['- waitForAnimationToEnd: {"timeout":6000}', '- tapOn: {"point":"1,2"}', '- swipe: {"start":"1,2","end":"3,4","duration":600,"private":"SECRET"}']) {
    assert.equal(searchCommand(header + value + "\n"), 0);
  }
  assert.equal(searchCommand(header + '- waitForAnimationToEnd: {"timeout":5000}\n- waitForAnimationToEnd: {"timeout":5000}'), 0);
});

test("v2 inner completion links only to a retained same-process containing outer span", () => {
  const outer = (seq, phase, more = {}) => row(seq, phase, { v: 2, parentId: 0, ...more });
  const inner = (seq, phase, more = {}) => outer(seq, phase, { id: 2, stage: 3, parentId: 1, ...more });
  const calls = [{ tool: "run", flowSequence: 4, started: 99, elapsedMs: 10, outcome: "returned" }];
  const linked = (rows) => correlateStages(parseStages(log(...rows)), calls, { 4: 1 });
  const [parent, child] = linked([outer(0, 0), inner(1, 0), inner(2, 1), outer(3, 1)]);
  assert.equal(parent.parentId, 0);
  assert.equal(child.parentCorrelation, "same-thread-source-scope");
  assert.equal(child.flowSequence, 4);
  assert.equal(child.durationMs, 1);
  assert.equal(child.outcome, "returned");
  const implicit = correlateStages(parseStages(log(outer(0, 0, { stage: 2 }), inner(1, 0, { stage: 4 }), inner(2, 2, { stage: 4 }), outer(3, 1, { stage: 2 }))),
    calls, { 4: 2 }).at(-1);
  assert.equal(implicit.parentCorrelation, "same-thread-source-scope");
  assert.equal(implicit.outcome, "threw");
  for (const change of [{ parentId: 3, id: 4 }, { stage: 4 }, { pid: 43 }, { monoNs: 8000000 }]) {
    const rows = [outer(0, 0), inner(1, 0, change), inner(2, 2, change), outer(3, 1)];
    assert.equal(linked(rows).at(-1).parentCorrelation, "unknown");
    assert.equal(linked(rows).at(-1).flowSequence, null);
  }
  assert.equal(linked([outer(0, 0), inner(1, 0), inner(2, 1)]).at(-1).parentCorrelation, "unknown");
  assert.equal(parseStages(log(inner(1, 0), inner(2, 1, { parentId: 0 }))).pairs.length, 0);
  for (const extra of [{ parentId: 2 }, { parentId: -1 }, { parentId: "1" }, { v: 4 }, { stage: 5 }, { secret: "SECRET" }]) {
    const parsed = parseStages(log(inner(1, 0, extra)));
    assert.equal(parsed.invalid, 1);
    assert.equal(JSON.stringify(parsed).includes("SECRET"), false);
  }
  assert.equal(parseStages(log(outer(0, 0, { parentId: 1 }))).invalid, 1);
  const capped = parseStages(log(...Array.from({ length: 258 }, (_, seq) => outer(seq, seq % 2, { id: Math.floor(seq / 2) + 1 }))));
  assert.equal(capped.events.length, 256);
  assert.equal(capped.budgetReached, true);
});

test("v3 decode and comparison pairs link only to the same version explicit-wait parent", () => {
  const outer = (seq, phase, more = {}) => row(seq, phase, { v: 3, parentId: 0, ...more });
  const child = (seq, phase, stage, more = {}) => outer(seq, phase, { id: 2, parentId: 1, stage, ...more });
  const calls = [{ tool: "run", flowSequence: 4, started: 99, elapsedMs: 10, outcome: "returned" }];
  for (const stage of [5, 6]) {
    const linked = (extra = {}) => correlateStages(parseStages(log(outer(0, 0, extra), child(1, 0, stage), child(2, 1, stage), outer(3, 1, extra))), calls, { 4: 1 }).at(-1);
    assert.equal(linked().parentCorrelation, "same-thread-source-scope");
    assert.equal(linked().flowSequence, 4);
    assert.equal(linked({ stage: 2 }).parentCorrelation, "unknown");
    assert.equal(linked({ v: 2 }).parentCorrelation, "unknown");
    assert.equal(parseStages(log(child(1, 0, stage, { v: 2 }))).invalid, 1);
  }
  assert.equal(parseStages(log(child(1, 0, 7))).invalid, 1);
});

test("cross-process or ambiguous wall correspondence stays unknown and bounded", () => {
  const parsed = parseStages(log(row(0, 0), row(1, 1, { pid: 43 })));
  assert.equal(parsed.multipleProcesses, true);
  assert.equal(parsed.pairs.length, 0);
  const pair = parseStages(log(row(0, 0), row(1, 1)));
  const calls = [1, 2].map((flowSequence) => ({ tool: "run", flowSequence, started: 99, elapsedMs: 4, outcome: "returned" }));
  assert.equal(correlateStages(pair, calls, { 1: 1, 2: 1 })[0].correspondence, "unknown");
  assert.equal(correlateStages(pair, [{ ...calls[0], elapsedMs: 0.1 }], { 1: 1 })[0].correspondence, "unknown");
  assert.deepEqual(correlateStages(pair, Array(2049).fill({}), {}), []);
});

test("v4 comparison CPU is conditional, finite, nullable and separate from elapsed time", () => {
  const cpu = (seq, phase, cpuNs, more = {}) => row(seq, phase, { v: 4, id: 2, parentId: 1, stage: 6, cpuNs, ...more });
  const paired = (a, b, more = {}) => parseStages(log(cpu(0, 0, a), cpu(1, 1, b, more)));
  assert.equal(paired(100, 500100).pairs[0]?.cpuDurationMs, 0.5);
  assert.equal(paired(100, 100).pairs[0]?.cpuDurationMs, 0);
  for (const [a, b] of [[null, null], [100, null], [null, 100], [200, 100]]) {
    assert.equal(paired(a, b).pairs[0]?.cpuDurationMs, null);
    assert.equal(paired(a, b).pairs[0]?.durationMs, 1);
  }
  assert.equal(paired(100, 200, { phase: 2 }).pairs[0]?.outcome, "threw");
  for (const cpuNs of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1, "SECRET", {}, false]) {
    const parsed = parseStages(log(cpu(0, 0, cpuNs)));
    assert.equal(parsed.invalid, 1);
    assert.equal(JSON.stringify(parsed).includes("SECRET"), false);
  }
  assert.equal(parseStages(log(cpu(0, 0, 10, { stage: 5 }))).invalid, 1);
  assert.equal(parseStages(log(cpu(0, 0, null, { stage: 5 }))).events.length, 1);
  assert.equal(parseStages(log(cpu(0, 0, null, { privatePayload: "SECRET" }))).invalid, 1);
  assert.equal(parseStages(log(row(0, 0), row(1, 1))).pairs[0].cpuDurationMs, null);
  assert.equal(parseStages(log(cpu(0, 0, 100), cpu(1, 1, 200, { pid: 43 }))).pairs.length, 0);
  const outer = (seq, phase) => row(seq, phase, { v: 4, parentId: 0, cpuNs: null });
  const scoped = correlateStages(parseStages(log(outer(0, 0), cpu(1, 0, 100), cpu(2, 1, 500100), outer(3, 1))),
    [{ tool: "run", flowSequence: 4, started: 99, elapsedMs: 10, outcome: "returned" }], { 4: 1 }).at(-1);
  assert.equal(scoped.parentCorrelation, "same-thread-source-scope");
  assert.equal(scoped.cpuDurationMs, 0.5);
  assert.equal(scoped.flowSequence, 4);
});

test("original interaction retains finite stages and preserves one submitted call and original error identity", async () => {
  for (const fail of [false, true]) {
    const directory = fileURLToPath(new URL(`../../reports/.settle-interaction-${randomUUID()}/`, import.meta.url));
    mkdirSync(directory, { recursive: true });
    const original = new Error("synthetic original failure"); let submitted = 0;
    const invoke = nativeInteraction({ device: "fixture", bundleId: "com.hemsoft.thirdroll", directory, prefix: "reset", env: {},
      capture: async () => {}, openSession: async ({ onStderr }) => ({
        close: async () => {}, call: async (name) => {
          if (name === "list_devices") return { devices: [{ device_id: "fixture", platform: "ios", connected: true }] };
          if (name === "inspect_screen") return {};
          assert.equal(name, "run"); submitted++;
          const wallMs = Date.now();
          onStderr(log(row(0, 0, { wallMs, monoNs: 0 }), row(1, fail ? 2 : 1, { wallMs, monoNs: 1 })));
          if (fail) throw original;
          return { success: true };
        } }), exercise: async ({ run }) => run([{ waitForAnimationToEnd: { timeout: 5000 } }]) });
    if (fail) await assert.rejects(invoke, (error) => error === original); else await invoke;
    const observed = collectRoute(directory);
    assert.equal(submitted, 1);
    assert.equal(observed.pairs.length, 1);
    assert.equal(observed.pairs[0].outcome, fail ? "threw" : "returned");
    assert.equal(observed.pairs[0].originalRequestOutcome, fail ? "threw" : "returned");
  }
});
