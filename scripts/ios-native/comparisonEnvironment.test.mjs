import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { nativeInteraction } from "./interaction.mjs";
import { captureEnvironment } from "./comparison/state.mjs";

const keys = ["THIRDROLL_COMPARISON_CAPTURE", "THIRDROLL_CAPTURE_SOURCE", "THIRDROLL_CAPTURE_ROUTE",
  "THIRDROLL_CAPTURE_DIRECTORY", "GITHUB_RUN_ID", "GITHUB_RUN_ATTEMPT"].sort();
const source = "a".repeat(40);

function fixture(name = "reset-document", modalOnly = true) {
  const root = mkdtempSync(join(tmpdir(), "comparison-environment-")), directory = join(root, name);
  mkdirSync(directory);
  const env = captureEnvironment({ PATH: "fixture-path", THIRDROLL_COMPARISON_CAPTURE: "1",
    GITHUB_RUN_ID: "42414569343", GITHUB_RUN_ATTEMPT: "1", GITHUB_TOKEN: "fixture-secret", UNRELATED: "private-value" },
  name, directory, modalOnly, source);
  return { directory, env };
}

async function run(value, { prefix = "reset", error } = {}) {
  let forwarded, opens = 0, closes = 0;
  const calls = [], started = Date.now();
  const result = nativeInteraction({ ...value, prefix, device: "owned", bundleId: "fixture.app", capture: async () => {},
    openSession: async ({ env, deadline }) => {
      forwarded = env; opens++;
      const budget = prefix === "scenario" ? 1200000 : 600000;
      assert(deadline >= started + budget && deadline <= Date.now() + budget);
      return { call: async (name) => {
        calls.push(name);
        if (name === "list_devices") return { devices: [{ device_id: "owned", platform: "ios", connected: true }] };
        if (name === "inspect_screen") return { elements: [] };
        return { success: true };
      }, close: async () => { closes++; } };
    }, exercise: async (io) => {
      await io.run([{ waitForAnimationToEnd: { timeout: 5000 } }]);
      if (error) throw error;
    } });
  if (error) await assert.rejects(result, (actual) => actual === error); else assert.equal(await result, undefined);
  assert.equal(opens, 1); assert.equal(closes, 1);
  assert.deepEqual(calls, ["list_devices", "inspect_screen", "run"]);
  assert.equal(forwarded.GITHUB_TOKEN, undefined); assert.equal(forwarded.UNRELATED, undefined);
  const log = readFileSync(join(value.directory, prefix + "-mcp.log"), "utf8");
  assert(!log.includes("fixture-secret") && !log.includes("private-value"));
  return Object.fromEntries(keys.filter(key => Object.hasOwn(forwarded, key)).map(key => [key, forwarded[key]]));
}

test("actual nativeInteraction forwards the isolated comparison identity without changing calls or errors", async () => {
  for (const name of ["reset-document", "reset-database"]) for (const failed of [false, true]) {
    const value = fixture(name), error = failed ? new Error("original-exercise-error") : undefined;
    assert.deepEqual(await run(value, { error }), Object.fromEntries(keys.map(key => [key, value.env[key]])));
  }
});

test("ordinary and unrelated sessions keep all comparison and CI identity keys filtered", async () => {
  for (const prefix of ["scenario", "hold", "complete"]) assert.deepEqual(await run(fixture(), { prefix }), {});
  assert.deepEqual(await run(fixture("reset-document", false)), {});
  assert.deepEqual(await run(fixture("unrelated")), {});
});

test("malformed or mismatched capture identity is entirely unavailable at the real launch boundary", async () => {
  const invalid = { THIRDROLL_COMPARISON_CAPTURE: "0", THIRDROLL_CAPTURE_SOURCE: "not-a-source",
    THIRDROLL_CAPTURE_ROUTE: "2", THIRDROLL_CAPTURE_DIRECTORY: "/unowned/.comparison-input",
    GITHUB_RUN_ID: "1\nprivate-value", GITHUB_RUN_ATTEMPT: "" };
  for (const [key, bad] of Object.entries(invalid)) {
    const value = fixture(); value.env[key] = bad;
    assert.deepEqual(await run(value), {}, key);
  }
  const missing = fixture(); delete missing.env.GITHUB_RUN_ID;
  assert.deepEqual(await run(missing), {});
});
