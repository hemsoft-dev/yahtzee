import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { nativeInteraction } from "./interaction.mjs";
import { startFlow, resumeFlow } from "./flows.mjs";

function harness() {
  const directory = mkdtempSync(join(tmpdir(), "native-session-")), calls = [], captures = [];
  let opened = 0, closed = 0, childEnv;
  const options = { directory, device: "owned", bundleId: "fixture.app", prefix: "scenario", env: { PATH: "fixture-path", GITHUB_TOKEN: "fixture-secret", UNRELATED: "not-forwarded" },
    capture: async (name) => captures.push(name),
    openSession: async ({ env, deadline, onStderr }) => {
      opened++; childEnv = env;
      assert(deadline > Date.now() && deadline <= Date.now() + 1200000);
      onStderr("GITHUB_TOKEN=fixture-secret\n");
      return { call: async (name, args) => {
        calls.push({ name, args });
        if (name === "list_devices") return { devices: [{ device_id: "owned", platform: "ios", connected: true }] };
        if (name === "inspect_screen") return { ui_schema: { platform: "ios" }, elements: [] };
        return { success: true, env_vars: { GITHUB_TOKEN: "fixture-secret" } };
      }, close: async () => { closed++; } };
    } };
  return { options, calls, captures, state: () => ({ opened, closed, childEnv }), cleanup: () => rmSync(directory, { recursive: true }) };
}
test("multiple authored flows and inspections use exactly one owned bounded session", async () => {
  const flow = harness();
  try {
    await nativeInteraction({ ...flow.options, exercise: async (io) => {
      await io.runFlow(startFlow("fixture.app", { ai: 0, dice: 5, orientation: "PORTRAIT" }));
      await io.run([{ waitForAnimationToEnd: { timeout: 5000 } }]);
      await io.inspect(); await io.runFlow(resumeFlow("fixture.app"));
      io.record({ action: "fixture" });
    } });
    const { opened, closed, childEnv } = flow.state();
    assert.equal(opened, 1); assert.equal(closed, 1); assert.deepEqual(childEnv, { PATH: "fixture-path" });
    assert.deepEqual(flow.calls.map((item) => item.name), ["list_devices", "run", "run", "inspect_screen", "run"]);
    assert.equal(readdirSync(flow.options.directory).filter((name) => name.endsWith(".yaml")).length, 3);
    assert(!readFileSync(join(flow.options.directory, "scenario-mcp.log"), "utf8").includes("fixture-secret"));
    assert.deepEqual(flow.captures, []);
    const timing = readFileSync(join(flow.options.directory, "scenario-tool-timing.jsonl"), "utf8");
    assert(!timing.includes("fixture-secret"));
    const entries = timing.trim().split("\n").map((line) => JSON.parse(line));
    assert.deepEqual(entries.map((item) => item.tool), ["list_devices", "run", "run", "inspect_screen", "run"]);
    assert(entries.every((item) => item.outcome === "returned" && item.elapsedMs >= 0));
    assert(entries.every((item) => Object.keys(item).sort().join(",") === "elapsedMs,flowSequence,outcome,started,tool"));
  } finally { flow.cleanup(); }
});
test("failure preserves its phase screenshot and closes the same session without replay", async () => {
  const flow = harness();
  try {
    await assert.rejects(nativeInteraction({ ...flow.options, exercise: async (io) => {
      await io.run([{ tapOn: { id: "die-0", retryTapIfNoChange: false } }]); throw new Error("Not acknowledged");
    } }), /Not acknowledged/);
    assert.equal(flow.state().opened, 1); assert.equal(flow.state().closed, 1);
    assert.equal(flow.calls.filter((item) => item.name === "run").length, 1);
    assert.deepEqual(flow.captures, ["scenario-failure"]);
  } finally { flow.cleanup(); }
});
test("throwing tool keeps its error and only timing metadata before failure capture", async () => {
  const flow = harness(); const open = flow.options.openSession;
  flow.options.openSession = async (options) => {
    const client = await open(options), call = client.call;
    return { ...client, call: async (name, args) => {
      if (name === "run") throw new Error("retained original transport failure");
      return call(name, args);
    } };
  };
  try {
    await assert.rejects(nativeInteraction({ ...flow.options, exercise: (io) => io.run([{ tapOn: { id: "die-0", retryTapIfNoChange: false } }]) }), /retained original transport failure/);
    const timing = readFileSync(join(flow.options.directory, "scenario-tool-timing.jsonl"), "utf8");
    const entries = timing.trim().split("\n").map((line) => JSON.parse(line));
    assert.equal(entries.at(-1).outcome, "threw"); assert.equal(entries.at(-1).flowSequence, 1);
    assert.deepEqual(Object.keys(entries.at(-1)).sort(), ["elapsedMs", "flowSequence", "outcome", "started", "tool"]);
    assert(!timing.includes("retained original transport failure"));
    assert(!timing.includes("die-0")); assert(!timing.includes("fixture-secret"));
    assert.deepEqual(flow.captures, ["scenario-failure"]); assert.equal(flow.state().closed, 1);
  } finally { flow.cleanup(); }
});
test("unwritable timing artifact cannot replace an actual transport error or replay its request", async () => {
  const flow = harness(), open = flow.options.openSession, original = new Error("original uncertain failure");
  let runs = 0;
  mkdirSync(join(flow.options.directory, "scenario-tool-timing.jsonl"));
  flow.options.openSession = async (options) => {
    const client = await open(options), call = client.call;
    return { ...client, call: async (name, args) => {
      if (name === "run") { runs++; throw original; }
      return call(name, args);
    } };
  };
  try {
    await assert.rejects(nativeInteraction({ ...flow.options, exercise: (io) => io.run([{ tapOn: { id: "die-0", retryTapIfNoChange: false } }]) }), (error) => error === original);
    assert.equal(runs, 1); assert.equal(flow.state().closed, 1);
    assert.deepEqual(flow.captures, ["scenario-failure"]);
    assert.equal((readFileSync(join(flow.options.directory, "scenario-mcp.log"), "utf8").match(/Native timing telemetry unavailable\./g) ?? []).length, 1);
  } finally { flow.cleanup(); }
});
test("unwritable timing artifact preserves returned tool data and records a fixed notice", async () => {
  const flow = harness();
  mkdirSync(join(flow.options.directory, "scenario-tool-timing.jsonl"));
  try {
    let received;
    await nativeInteraction({ ...flow.options, exercise: async (io) => { received = await io.inspect(); } });
    assert.deepEqual(received, { ui_schema: { platform: "ios" }, elements: [] });
    assert.deepEqual(flow.calls.map((call) => call.name), ["list_devices", "inspect_screen"]);
    assert.equal(flow.state().closed, 1); assert.deepEqual(flow.captures, []);
    const diagnostic = readFileSync(join(flow.options.directory, "scenario-mcp.log"), "utf8");
    assert.equal((diagnostic.match(/Native timing telemetry unavailable\./g) ?? []).length, 1);
    assert(!diagnostic.includes("fixture-secret"));
  } finally { flow.cleanup(); }
});
test("timing metadata is buffered without artifact writes between driver calls and flushed before return", async () => {
  const flow = harness(), timingPath = join(flow.options.directory, "scenario-tool-timing.jsonl");
  try {
    await nativeInteraction({ ...flow.options, exercise: async (io) => {
      assert(!existsSync(timingPath));
      await io.inspect(); assert(!existsSync(timingPath));
      await io.run([{ assertVisible: "safe fixture" }]); assert(!existsSync(timingPath));
    } });
    const entries = readFileSync(timingPath, "utf8").trim().split("\n").map(JSON.parse);
    assert.deepEqual(entries.map((entry) => entry.tool), ["list_devices", "inspect_screen", "run"]);
    assert(entries.every((entry) => entry.outcome === "returned"));
    assert.equal(flow.state().closed, 1);
  } finally { flow.cleanup(); }
});
test("timing buffer caps retained entries and reports overflow or failed flush exactly once", async () => {
  for (const failedFlush of [false, true]) {
    const flow = harness(), timingPath = join(flow.options.directory, "scenario-tool-timing.jsonl");
    if (failedFlush) mkdirSync(timingPath);
    try {
      await nativeInteraction({ ...flow.options, exercise: async (io) => { for (let index = 0; index < 2050; index++) await io.inspect(); } });
      assert.equal(flow.calls.length, 2051); assert.equal(flow.state().closed, 1);
      if (!failedFlush) {
        const entries = readFileSync(timingPath, "utf8").trim().split("\n").map(JSON.parse);
        assert.equal(entries.length, 2048); assert.equal(entries[0].tool, "list_devices");
        assert(entries.slice(1).every((entry) => entry.tool === "inspect_screen" && entry.outcome === "returned"));
      }
      const diagnostic = readFileSync(join(flow.options.directory, "scenario-mcp.log"), "utf8");
      assert.equal((diagnostic.match(/Native timing telemetry unavailable\./g) ?? []).length, 1);
      assert(!diagnostic.includes("fixture-secret"));
    } finally { flow.cleanup(); }
  }
});
test("required diagnostic write failure preserves the primary phase error but fails a successful phase", async () => {
  for (const failedExercise of [true, false]) {
    const flow = harness(), original = new Error("original phase failure");
    mkdirSync(join(flow.options.directory, "scenario-mcp.log"));
    try {
      const result = nativeInteraction({ ...flow.options, exercise: async () => { if (failedExercise) throw original; } });
      await assert.rejects(result, (error) => failedExercise ? error === original : error.code === "EISDIR");
      assert.equal(flow.state().closed, 1);
      assert.deepEqual(flow.captures, failedExercise ? ["scenario-failure"] : []);
    } finally { flow.cleanup(); }
  }
});
test("shutdown failure cannot mask the original uncertain tool error", async () => {
  const flow = harness(), open = flow.options.openSession;
  flow.options.openSession = async (options) => {
    const client = await open(options), call = client.call;
    return { call: async (name, args) => {
      if (name === "run") throw new Error("Local Maestro tools/call timed out.");
      return call(name, args);
    }, close: async () => { await client.close(); throw new Error("Local Maestro did not close within 60 seconds."); } };
  };
  try {
    await assert.rejects(nativeInteraction({ ...flow.options, exercise: (io) => io.run([{ tapOn: { id: "die-0", retryTapIfNoChange: false } }]) }), /Local Maestro tools\/call timed out/);
    assert.equal(flow.state().closed, 1); assert.deepEqual(flow.captures, ["scenario-failure"]);
    assert(readFileSync(join(flow.options.directory, "scenario-mcp.log"), "utf8").includes("shutdown failed"));
  } finally { flow.cleanup(); }
});
test("shutdown failure after a successful exercise still fails qualification", async () => {
  const flow = harness(), open = flow.options.openSession;
  flow.options.openSession = async (options) => {
    const client = await open(options);
    return { ...client, close: async () => { await client.close(); throw new Error("shutdown failure"); } };
  };
  try {
    await assert.rejects(nativeInteraction({ ...flow.options, exercise: async () => {} }), /shutdown failure/);
    assert.equal(flow.state().closed, 1);
    assert(readFileSync(join(flow.options.directory, "scenario-mcp.log"), "utf8").includes("shutdown failed"));
  } finally { flow.cleanup(); }
});
test("unbound or oversized authored flows cannot reach the driver", async () => {
  for (const yaml of [resumeFlow("another.app"), 'appId: "fixture.app"\n---\n' + "x".repeat(262144)]) {
    const flow = harness();
    try {
      await assert.rejects(nativeInteraction({ ...flow.options, exercise: (io) => io.runFlow(yaml) }), /owned application/);
      assert.equal(flow.calls.filter((item) => item.name === "run").length, 0);
      assert.equal(flow.state().closed, 1);
    } finally { flow.cleanup(); }
  }
});
