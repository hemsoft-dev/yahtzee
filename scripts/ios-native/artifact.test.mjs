import assert from "node:assert/strict";
import { test } from "node:test";
import { safeArtifactPath, verifyArchivePaths, verifyBuild } from "./artifact.mjs";

const expected = { source: "a".repeat(40), architecture: "arm64", bunLockSha256: "b".repeat(64), runId: "123",
  config: { version: "1.0.0", ios: { bundleIdentifier: "com.example.dice", buildNumber: "1" } } };
const valid = () => ({ schemaVersion: 1, kind: "unsigned-ios-simulator-build", status: "passed", source: expected.source,
  architecture: expected.architecture, bunLockSha256: expected.bunLockSha256, runId: expected.runId, podInstallMode: "deployment", podLockNeedsReview: false,
  privacy: { errors: [] }, app: { directory: "Dice.app", bundleId: "com.example.dice", version: "1.0.0", build: "1" },
  artifacts: [{ path: "unsigned-simulator.app.tar.gz", bytes: 100, sha256: "c".repeat(64) }] });

test("only a passing deployment-mode build from the same source, workflow and architecture can feed native tests", () => {
  assert.doesNotThrow(() => verifyBuild(valid(), expected));
  for (const [key, value] of Object.entries({ source: "other", runId: "other", architecture: "x86_64", status: "failed",
    podInstallMode: "refresh-only", podLockNeedsReview: true, bunLockSha256: "other", kind: "unsigned-ios-simulator-tests" })) {
    assert.throws(() => verifyBuild({ ...valid(), [key]: value }, expected), key);
  }
  const drift = valid(); drift.privacy.errors.push("missing SDK manifest"); assert.throws(() => verifyBuild(drift, expected));
  const identity = valid(); identity.app.build = "2"; assert.throws(() => verifyBuild(identity, expected));
});

test("artifact inventories and archive members cannot traverse outside the owned app", () => {
  for (const path of ["../outside", "/outside", "C:/outside", "a/../../outside", "a\\outside", ".hidden", "a\nother"]) assert.equal(safeArtifactPath(path), false, path);
  assert.doesNotThrow(() => verifyArchivePaths(["Dice.app/", "Dice.app/Frameworks/Example.framework/Example"], "Dice.app"));
  for (const path of ["Other.app/Info.plist", "Dice.app/../outside", "/Dice.app/Info.plist"]) assert.throws(() => verifyArchivePaths([path], "Dice.app"));
  const duplicate = valid(); duplicate.artifacts.push(duplicate.artifacts[0]); assert.throws(() => verifyBuild(duplicate, expected));
  const unsafe = valid(); unsafe.artifacts[0].path = "../outside"; assert.throws(() => verifyBuild(unsafe, expected));
  const missing = valid(); missing.artifacts = []; assert.throws(() => verifyBuild(missing, expected));
});

test("Intel qualification accepts only the matching source-bound x86_64 simulator artifact", () => {
  const intel = { ...expected, architecture: "x86_64" };
  assert.doesNotThrow(() => verifyBuild({ ...valid(), architecture: "x86_64" }, intel));
  assert.throws(() => verifyBuild(valid(), intel));
});
