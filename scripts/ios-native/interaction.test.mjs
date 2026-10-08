import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
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
      assert(deadline > Date.now() && deadline <= Date.now() + 600000);
      onStderr("GITHUB_TOKEN=fixture-secret\n");
      return { call: async (name, args) => {
        calls.push({ name, args });
        if (name === "list_devices") return { devices: [{ device_id: "owned", platform: "ios", connected: true }] };
        if (name === "inspect_screen") return { ui_schema: { platform: "ios" }, elements: [{ txt: "fixture-secret", temp_clone_token: "injected-screen-token" }], env_vars: { GITHUB_TOKEN: "fixture-secret" } };
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

test("failed interaction retains a separate read-only screen and preserves earlier inspection", async () => {
  const flow = harness();
  try {
    const open = flow.options.openSession;
    let inspections = 0;
    flow.options.openSession = async (options) => {
      const client = await open(options), call = client.call;
      return { ...client, call: async (name, args) => {
        const result = await call(name, args);
        if (name === "inspect_screen") result.elements[0].id = ++inspections === 1 ? "before-tap" : "after-failure";
        return result;
      } };
    };
    await assert.rejects(nativeInteraction({ ...flow.options, exercise: async (io) => {
      await io.inspect();
      await io.run([{ tapOn: { id: "die-0", retryTapIfNoChange: false } }]);
      throw new Error("Not acknowledged");
    } }), /Not acknowledged/);
    const directory = flow.options.directory;
    for (const name of ["scenario-screen-failure.json", "scenario-screen-latest.json"]) {
      const artifact = readFileSync(join(directory, name), "utf8");
      for (const credential of ["GITHUB_TOKEN", "fixture-secret", "temp_clone_token", "injected-screen-token"]) assert(!artifact.includes(credential));
      assert.equal(JSON.parse(artifact).elements[0].txt, "<REDACTED>");
    }
    assert.equal(JSON.parse(readFileSync(join(directory, "scenario-screen-failure.json"), "utf8")).ui_schema.platform, "ios");
    assert.equal(JSON.parse(readFileSync(join(directory, "scenario-screen-latest.json"), "utf8")).ui_schema.platform, "ios");
    assert.equal(JSON.parse(readFileSync(join(directory, "scenario-screen-latest.json"), "utf8")).elements[0].id, "before-tap");
    assert.equal(JSON.parse(readFileSync(join(directory, "scenario-screen-failure.json"), "utf8")).elements[0].id, "after-failure");
    assert.equal(flow.calls.filter((item) => item.name === "run").length, 1);
    assert.equal(flow.calls.filter((item) => item.name === "inspect_screen").length, 2);
    assert.equal(flow.state().closed, 1);
  } finally { flow.cleanup(); }
});

test("a failed diagnostic write preserves the original error and still captures and closes", async () => {
  const flow = harness(), original = new Error("Original interaction failure");
  try {
    mkdirSync(join(flow.options.directory, "scenario-screen-failure.json"));
    await assert.rejects(nativeInteraction({ ...flow.options, exercise: async (io) => {
      await io.run([{ tapOn: { id: "die-0", retryTapIfNoChange: false } }]);
      throw original;
    } }), (error) => error === original);
    assert.equal(flow.calls.filter((item) => item.name === "inspect_screen").length, 1);
    assert.equal(flow.calls.filter((item) => item.name === "run").length, 1);
    assert.match(readFileSync(join(flow.options.directory, "scenario-screen-failure-unavailable.txt"), "utf8"), /^Failure screen inspection unavailable; the original interaction failure is preserved\.\n$/);
    assert.deepEqual(flow.captures, ["scenario-failure"]);
    assert.equal(flow.state().closed, 1);
  } finally { flow.cleanup(); }
});

test("a failed diagnostic read preserves the original error and does not replay a tap", async () => {
  const flow = harness();
  const original = new Error("Original missed tap");
  try {
    const open = flow.options.openSession;
    flow.options.openSession = async (options) => {
      const client = await open(options), call = client.call;
      return { ...client, call: async (name, args) => {
        if (name === "inspect_screen") throw new Error("Disconnected driver");
        return call(name, args);
      } };
    };
    await assert.rejects(nativeInteraction({ ...flow.options, exercise: async (io) => {
      await io.run([{ tapOn: { id: "die-0", retryTapIfNoChange: false } }]);
      throw original;
    } }), (error) => error === original);
    assert.equal(flow.calls.filter((item) => item.name === "run").length, 1);
    assert.equal(flow.state().closed, 1);
    assert.deepEqual(flow.captures, ["scenario-failure"]);
  } finally { flow.cleanup(); }
});

test("failure inspection stops at the remaining deadline without replacing the original error", async () => {
  const flow = harness(), originalNow = Date.now;
  const original = new Error("Original setup failure");
  let deadline;
  try {
    const open = flow.options.openSession;
    flow.options.openSession = async (options) => {
      deadline = options.deadline;
      const client = await open(options), call = client.call;
      return { ...client, call: (name, args) => name === "inspect_screen" ? new Promise(() => {}) : call(name, args) };
    };
    await assert.rejects(nativeInteraction({ ...flow.options, exercise: async () => {
      Date.now = () => deadline - 1;
      throw original;
    } }), (error) => error === original);
    assert.equal(flow.state().closed, 1);
    assert.deepEqual(flow.captures, ["scenario-failure"]);
    assert.equal(flow.calls.filter((item) => item.name === "run").length, 0);
  } finally { Date.now = originalNow; flow.cleanup(); }
});
