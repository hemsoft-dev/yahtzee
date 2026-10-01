import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const root = new URL("../../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const excludedTerms = ["player names", "saved games", "score history", "device identifiers", "credentials"];
function assertTemplate(content) {
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content);
  assert(frontmatter, "Missing classic template metadata");
  for (const key of ["name", "about"]) assert.match(frontmatter[1], new RegExp(`^${key}: \\S[^\\r\\n]*$`, "m"));
  assert.match(content, /This issue is public and requires a GitHub account/);
  const prohibition = /\bDo not include ([^.\r\n]+)\./.exec(content)?.[1];
  assert(prohibition, "Missing privacy prohibition");
  for (const excluded of excludedTerms) assert(prohibition.includes(excluded), `Missing privacy prohibition: ${excluded}`);
  assert.match(content, /approved private reporting contact is not available yet/);
  assert.match(content, /\[security reporting policy\]\(https:\/\/github\.com\/HemSoft\/yahtzee\/blob\/main\/SECURITY\.md\)/);
  assert.doesNotMatch(content, /\]\(\.\.\//);
  assert.doesNotMatch(content, /mailto:|itms-apps:|apps\.apple\.com|https:\/\/[^\s)]*\/security\/advisories\/new/);
}
function assertBlankEnabled(config) {
  const fields = config.split(/\r?\n/).filter((line) => line.startsWith("blank_issues_enabled:"));
  assert.equal(fields.length, 1, "Missing or duplicate blank-issue setting");
  assert.match(fields[0], /^blank_issues_enabled:\s+true(?:\s+#.*)?\s*$/);
}
for (const filename of ["bug_report.md", "feature_request.md"]) {
  test(`${filename} offers public non-sensitive reporting without requesting private game data`, () => {
    assertTemplate(read(`.github/ISSUE_TEMPLATE/${filename}`));
    assert(existsSync(new URL("SECURITY.md", root)));
  });
}
test("privacy guard rejects requests for the same sensitive terms instead of prohibiting them", () => {
  const original = read(".github/ISSUE_TEMPLATE/bug_report.md");
  assert.throws(() => assertTemplate(original.replace("Do not include player names", "Please include player names")));
  assert.throws(() => assertTemplate(original.replace("Do not include player names, saved games, score history, device identifiers, credentials or unreviewed logs and screenshots.", "Do not include player names. Please include saved games, score history, device identifiers and credentials.")));
});
test("classic template metadata permits standard optional fields and field ordering", () => {
  const original = read(".github/ISSUE_TEMPLATE/bug_report.md");
  const changed = original.replace(/^---\r?\n[\s\S]*?\r?\n---/, '---\ntitle: ""\nabout: Report a non-sensitive problem\nlabels: bug\nname: Bug report\nassignees: ""\n---');
  assert.doesNotThrow(() => assertTemplate(changed));
  assert.throws(() => assertTemplate(changed.replace("name: Bug report\n", "")));
  assert.throws(() => assertTemplate(changed.replace("about: Report a non-sensitive problem\n", "")));
});
test("blank-issue guard checks the boolean rather than freezing unrelated configuration", () => {
  assert.doesNotThrow(() => assertBlankEnabled('blank_issues_enabled: true\ncontact_links:\n  - name: Fixture\n    url: https://example.invalid/fixture\n    about: Test-only fixture\n'));
  for (const invalid of ["blank_issues_enabled: false\n", "# blank_issues_enabled: true\n", "blank_issues_enabled: true\nblank_issues_enabled: false\n"]) assert.throws(() => assertBlankEnabled(invalid));
});
test("sensitive-reporting policy does not invent a private channel or silently disable general reports", () => {
  const policy = read("SECURITY.md");
  assert.match(policy, /Private reporting is not available yet/);
  assert.match(policy, /private vulnerability reporting was disabled/);
  assert.match(policy, /does not enable it or promise a working private channel/);
  assert.match(policy, /Do not post vulnerabilities/);
  assert.match(policy, /Issue #44/);
  assert.match(policy, /not an approved policy for a published app/);
  assert.doesNotMatch(policy, /mailto:|https:\/\/github\.com\/HemSoft\/yahtzee\/security\/advisories\/new/);
  assertBlankEnabled(read(".github/ISSUE_TEMPLATE/config.yml"));
});
