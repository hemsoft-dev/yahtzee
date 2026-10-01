import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
test("release tracker reflects the local native root without promoting draft acceptance", () => {
  const layout = read("apps/mobile/app/_layout.tsx");
  const tracker = read("apps/mobile/APP-STORE.md");
  const changelog = read("apps/mobile/CHANGELOG.md");
  const candidate = JSON.parse(read("apps/mobile/release/candidate.json"));
  assert.match(layout, /<LocalProvider>/);
  assert.doesNotMatch(layout, /ConvexProvider/);
  assert.doesNotMatch(tracker, /current native app still uses Convex|baseline PR under review/);
  assert.match(tracker, /local acknowledged SQLite saves/);
  assert.match(tracker, /Unsigned simulator qualification does not establish signed-device or store acceptance/);
  assert.match(tracker, /Draft capture automation/);
  assert.match(changelog, /No iOS version has shipped/);
  assert.match(changelog, /## Unreleased/);
  assert.equal(candidate.status, "draft");
  for (const key of ["sourceCommit", "appStoreId", "bundleIdentifier", "archiveSha256", "testFlightBuildId", "ownerApprovalEvidence", "nativeQualificationEvidence"]) {
    assert.equal(candidate[key], null, `${key} must not be fabricated by a documentation refresh`);
  }
});
