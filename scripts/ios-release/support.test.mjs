import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const root = new URL("../../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");

for (const filename of ["bug_report.md", "feature_request.md"]) {
  test(`${filename} offers public non-sensitive reporting without requesting private game data`, () => {
    const file = `.github/ISSUE_TEMPLATE/${filename}`;
    const content = read(file);
    assert.match(content, /^---\r?\nname: [^\r\n]+\r?\nabout: [^\r\n]+\r?\n---\r?\n/);
    assert.match(content, /This issue is public and requires a GitHub account/);
    for (const excluded of ["player names", "saved games", "score history", "device identifiers", "credentials"]) {
      assert(content.includes(excluded), `Missing privacy warning: ${excluded}`);
    }
    assert.match(content, /approved private reporting contact is not available yet/);
    assert.match(content, /\[security reporting policy\]\(https:\/\/github\.com\/HemSoft\/yahtzee\/blob\/main\/SECURITY\.md\)/);
    assert.doesNotMatch(content, /\]\(\.\.\//);
    assert(existsSync(new URL("SECURITY.md", root)));
    assert.doesNotMatch(content, /mailto:|itms-apps:|apps\.apple\.com|https:\/\/[^\s)]*\/security\/advisories\/new/);
  });
}

test("sensitive-reporting policy does not invent a private channel or silently disable general reports", () => {
  const policy = read("SECURITY.md");
  assert.match(policy, /Private reporting is not available yet/);
  assert.match(policy, /private vulnerability reporting was disabled/);
  assert.match(policy, /does not enable it or promise a working private channel/);
  assert.match(policy, /Do not post vulnerabilities/);
  assert.match(policy, /Issue #44/);
  assert.match(policy, /not an approved policy for a published app/);
  assert.doesNotMatch(policy, /mailto:|https:\/\/github\.com\/HemSoft\/yahtzee\/security\/advisories\/new/);
  assert.equal(read(".github/ISSUE_TEMPLATE/config.yml").trim(), "blank_issues_enabled: true");
});
