import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
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
