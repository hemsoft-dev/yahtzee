import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import test from "node:test";
import { assertionEnvironment, parseAssertionResults, retainAssertionResults } from "./assertion/retention.mjs";
import { nativeInteraction } from "./interaction.mjs";

const source = "a".repeat(40);
const env = { THIRDROLL_ASSERT_ENABLE: "1", THIRDROLL_ASSERT_SOURCE: source, GITHUB_RUN_ID: "1", GITHUB_RUN_ATTEMPT: "1", GITHUB_TOKEN: "private-token" };
const identity = { THIRDROLL_ASSERT_ENABLE: "1", THIRDROLL_ASSERT_SOURCE: source, THIRDROLL_ASSERT_RUN: "1", THIRDROLL_ASSERT_ATTEMPT: "1" };
const proof = { status: "prepared", kind: "qualification-original-assertion-result", source, runId: "1", attempt: "1",
  upstreamSource: "14a408335e17a090df1e26bdbeaf80d8122a8fd8", sourceInverseExact: true, originalPublicDescriptorsPreserved: 63,
  additionalSyntheticBridges: 4, orchestraSHA256: "b".repeat(64) };
const row = (seq, stage, phase, extra = {}) => ({ v: 1, source, run: "1", attempt: "1", pid: 123, id: 1, flow: 4, command: 8,
  runtimeCommand: 9, selector: 1, polarity: 1, seq, stage, phase, query: 0, monoNs: 100 + seq, matches: -1, condition: -1, error: 0, ...extra });
const records = () => [row(0, 1, 0), row(1, 2, 0, { query: 1 }), row(2, 2, 1, { query: 1, matches: 1 }),
  row(3, 3, 1, { condition: 1 }), row(4, 1, 1, { condition: 1 })];
const text = rows => rows.map(value => "THIRDROLL_ASSERT " + JSON.stringify(value) + "\n").join("");
function temporary() { return mkdtempSync(join(tmpdir(), "assertion-retention-")); }
function remove(path) { assert(path.startsWith(resolve(tmpdir()) + sep + "assertion-retention-")); rmSync(path, { recursive: true }); }

test("assertion metadata forwards only the exact phone5 scope and independently bound proof", () => {
  assert.deepEqual(assertionEnvironment(env, "scenario", "/owned/phone-5-solo-light", () => JSON.stringify(proof)), identity);
  for (const [prefix, path] of [["reset", "/owned/phone-5-solo-light"], ["scenario", "/owned/phone-6-solo-light"]]) {
    assert.deepEqual(assertionEnvironment(env, prefix, path, () => { throw new Error("must not read"); }), {});
  }
  for (const changed of [{ status: "failed" }, { source: "c".repeat(40) }, { runId: "2" }, { attempt: "2" },
    { sourceInverseExact: false }, { originalPublicDescriptorsPreserved: 62 }, { additionalSyntheticBridges: 5 }, { orchestraSHA256: "private-token" }]) {
    assert.deepEqual(assertionEnvironment(env, "scenario", "/owned/phone-5-solo-light", () => JSON.stringify({ ...proof, ...changed })), {});
  }
  assert.deepEqual(assertionEnvironment(env, "scenario", "/owned/phone-5-solo-light", () => "x".repeat(65537)), {});
  assert.deepEqual(assertionEnvironment(env, "scenario", "/owned/phone-5-solo-light", () => { throw new Error("private-token"); }), {});
  assert.deepEqual(assertionEnvironment({ ...env, THIRDROLL_ASSERT_ENABLE: "0" }, "scenario", "/owned/phone-5-solo-light"), {});
});

test("actual finite result vocabulary retains completed matcher/result boundaries without claiming AX or uniqueness", () => {
  const result = parseAssertionResults(text(records()), identity);
  assert.equal(result.status, "observed"); assert.deepEqual(result.records, records());
  assert.equal(result.nativeQueryIdentity, "unknown"); assert.equal(result.visibilityAndUniqueness, "unknown");
  assert.equal(result.targetGeometry, "unavailable-not-traversed");
  const absent = records(); absent[2].matches = 0; absent[3].condition = 0; absent[4].condition = 0; absent[4].phase = 2; absent[4].error = 1;
  assert.equal(parseAssertionResults(text(absent), identity).records[2].matches, 0);
  const ambiguous = records(); ambiguous[2].matches = 2;
  assert.equal(parseAssertionResults(text(ambiguous), identity).records[2].matches, 2);
  const thrown = [row(0, 1, 0), row(1, 1, 2, { error: 2 })];
  assert.equal(parseAssertionResults(text(thrown), identity).status, "observed");
});

test("partial, missing, stale, malformed and malicious records never export payloads", () => {
  for (const changed of [{ source: "c".repeat(40) }, { run: "2" }, { attempt: "2" }, { selector: 2 }, { command: 7 },
    { seq: 1 }, { matches: "private-token" }, { error: "private-token" }, { payload: "private-token" }, { monoNs: 1e20 }, { pid: 0 }]) {
    const result = parseAssertionResults(text([{ ...row(0, 1, 0), ...changed }]), identity);
    assert.equal(result.status, "unavailable"); assert(!JSON.stringify(result).includes("private-token"));
  }
  assert.equal(parseAssertionResults("private-token\n", identity).status, "unavailable");
  assert.equal(parseAssertionResults(text([row(0, 1, 0)]), identity).status, "partial");
  assert.equal(parseAssertionResults(text(records()).trimEnd(), identity).status, "partial");
  const missing = records(); missing.splice(2, 1); assert.equal(parseAssertionResults(text(missing), identity).status, "partial");
  const clock = records(); clock[2].monoNs = null; assert.equal(parseAssertionResults(text(clock), identity).status, "partial");
  const count = records(); count[2].matches = -1; assert.equal(parseAssertionResults(text(count), identity).status, "partial");
  assert.equal(parseAssertionResults("x".repeat(262145), identity).reason, "input-bound");
  const cap = [row(0, 1, 0), row(1, 4, 3), row(2, 1, 1)]; assert.equal(parseAssertionResults(text(cap), identity).status, "partial");
});

test("sequence/query/context bounds reject stale returns and excess contexts", () => {
  const wrong = records(); wrong[2].query = 2;
  assert.equal(parseAssertionResults(text(wrong), identity).status, "partial");
  const runtime = records(); runtime[2].runtimeCommand++;
  assert.equal(parseAssertionResults(text(runtime), identity).status, "partial");
  const duplicateReturn = records();
  duplicateReturn.splice(3, 0, { ...duplicateReturn[2] });
  duplicateReturn.forEach((entry, index) => { entry.seq = index; });
  assert.equal(parseAssertionResults(text(duplicateReturn), identity).status, "partial");
  const closed = [...records(), row(5, 2, 0, { query: 2 })];
  assert.equal(parseAssertionResults(text(closed), identity).status, "partial");
  const many = [];
  for (let pid = 1; pid <= 100; pid++) many.push(...records().map(r => ({ ...r, pid })));
  const result = parseAssertionResults(text(many), identity);
  assert(result.records.length <= 80 && result.retainedBytes <= 32768);
  assert.equal(result.status, "partial");
});

test("typed retention is immutable, preserves exact records and never copies raw diagnostic text", () => {
  const directory = temporary();
  try {
    const original = "secret-url/path/private-token\n" + text(records());
    const result = retainAssertionResults(original, identity, directory);
    const saved = readFileSync(join(directory, "scenario-assertion-results.json"), "utf8");
    assert(!saved.includes("private-token")); assert.deepEqual(JSON.parse(saved), result);
    assert.throws(() => retainAssertionResults(text(records()), identity, directory), { code: "EEXIST" });
    assert.equal(readFileSync(join(directory, "scenario-assertion-results.json"), "utf8"), saved);
    assert.throws(() => retainAssertionResults(text(records()), identity, join(directory, "absent")), { code: "ENOENT" });
  }
  finally { remove(directory); }
});

test("real interaction preserves one run, original return/error and close even with retention faults", async () => {
  for (const failed of [false, true]) for (const blocked of [false, true]) {
    const directory = temporary(), cwd = process.cwd(), original = new Error("original call error"), calls = [];
    let closes = 0, observedEnv;
    try {
      mkdirSync(join(directory, "reports/assertion-build"), { recursive: true });
      writeFileSync(join(directory, "reports/assertion-build/proof.json"), JSON.stringify(proof));
      const scenario = join(directory, "phone-5-solo-light"); mkdirSync(scenario);
      if (blocked) writeFileSync(join(scenario, "scenario-assertion-results.json"), "owned-original");
      process.chdir(directory);
      class UnavailableWorker { constructor() { throw new Error("private-metadata"); } }
      const promise = nativeInteraction({ device: "owned", bundleId: "fixture.app", directory: scenario, prefix: "scenario", env,
        evidenceWorker: UnavailableWorker, capture: async () => {}, exercise: async io => io.run([{ assertVisible: "Current: .*" }]),
        openSession: async ({ env: childEnv, onStderr }) => {
          observedEnv = childEnv;
          return { call: async name => {
            calls.push(name);
            if (name === "list_devices") return { devices: [{ device_id: "owned", platform: "ios", connected: true }] };
            if (name === "inspect_screen") return { ui_schema: { platform: "ios" }, elements: [] };
            onStderr(text(records())); if (failed) throw original; return { success: true };
          }, close: async () => { closes++; } };
        } });
      if (failed) await assert.rejects(promise, error => error === original); else await promise;
      assert.deepEqual(calls, ["list_devices", "inspect_screen", "run"]); assert.equal(closes, 1);
      for (const [key, value] of Object.entries(identity)) assert.equal(observedEnv[key], value);
      assert.equal(observedEnv.GITHUB_TOKEN, undefined);
      const saved = readFileSync(join(scenario, "scenario-assertion-results.json"), "utf8");
      assert(blocked ? saved === "owned-original" : JSON.parse(saved).status === "observed");
    } finally { process.chdir(cwd); remove(directory); }
  }
});
