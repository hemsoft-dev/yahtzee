import test from "node:test";
import assert from "node:assert/strict";
import { draftErrors, releaseBlockers, listingRecord } from "./check.mjs";

const commit = "a".repeat(40);
const archiveSha256 = "b".repeat(64);
function candidate() {
  return { schemaVersion: 1, versionNotes: "release/notes/1.0.0.md", status: "candidate", version: "1.0.0", buildNumber: "1", tag: "ios/v1.0.0", appStoreVersion: "1.0.0", sourceCommit: commit, bundleIdentifier: "example.originalgame", appStoreId: "123456", archiveSha256, testFlightBuildId: "test-build", ownerApprovalEvidence: "test-reference", nativeQualificationEvidence: "test-reference" };
}
function context() {
  return { commit, dirty: false, archiveSha256, expo: { version: "1.0.0", ios: { buildNumber: "1", bundleIdentifier: "example.originalgame" } } };
}

test("listing selection uses the assigned role, not another source's filename", () => {
  const files = [
    { role: "changelog", path: "misleading/listing.json", text: '{"status":"approved"}' },
    { role: "listing", path: "metadata/listing.json", text: '{"status":"draft"}' },
  ];
  assert.equal(listingRecord(files).status, "draft");
});

test("draft shape accepts an explicitly incomplete proposal without asserting readiness", () => {
  const draft = { ...candidate(), status: "draft", sourceCommit: null, archiveSha256: null, ownerApprovalEvidence: null };
  assert.deepEqual(draftErrors(draft), []);
  assert.ok(releaseBlockers(draft, context()).length >= 4);
});
test("rejects invalid schemas, malformed versions and non-string build numbers", () => {
  for (const input of [null, [], { ...candidate(), schemaVersion: 2 }, { ...candidate(), version: "latest" }, { ...candidate(), buildNumber: 1 }, { ...candidate(), buildNumber: "0" }, { ...candidate(), tag: "v1.0.0" }, { ...candidate(), appStoreVersion: "2.0.0" }]) assert.ok(draftErrors(input).length);
});
test("a matching synthetic record passes only the consistency check", () => {
  assert.deepEqual(releaseBlockers(candidate(), context()), []);
});
test("rejects stale source, dirty checkout, native version/build/identity drift and archive drift", () => {
  const variants = [
    { ...context(), commit: "c".repeat(40) }, { ...context(), dirty: true },
    { ...context(), expo: { ...context().expo, version: "0.1.0" } },
    { ...context(), expo: { version: "1.0.0", ios: { buildNumber: "2", bundleIdentifier: "example.originalgame" } } },
    { ...context(), expo: { version: "1.0.0", ios: { buildNumber: "1", bundleIdentifier: "other.app" } } },
    { ...context(), archiveSha256: null },
  ];
  for (const value of variants) assert.ok(releaseBlockers(candidate(), value).length);
});
test("requires app, beta and evidence references without claiming to authenticate them", () => {
  for (const key of ["appStoreId", "testFlightBuildId", "ownerApprovalEvidence", "nativeQualificationEvidence"]) assert.ok(releaseBlockers({ ...candidate(), [key]: null }, context()).length);
});

test("versioned notes cannot silently refer to another marketing version", () => {
  assert.ok(draftErrors({ ...candidate(), versionNotes: "release/notes/0.9.0.md" }).includes("Version notes path does not match the marketing version"));
  assert.ok(draftErrors({ ...candidate(), versionNotes: undefined }).length);
});
