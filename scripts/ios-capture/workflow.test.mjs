import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Git may materialize this text file as CRLF on Windows. Action pins and
// permissions are unchanged; match the same source contract on either platform.
const workflow = readFileSync(new URL("../../.github/workflows/ios-capture-drafts.yml", import.meta.url), "utf8").replaceAll("\r\n", "\n");
const runner = readFileSync(new URL("./run.mjs", import.meta.url), "utf8");
test("capture workflow pins actions and reuses a same-run unsigned deployment build", () => {
  const actions = [...workflow.matchAll(/uses: ([^\s]+)@([^\s]+)/g)];
  assert.equal(actions.length, 9);
  for (const [, , revision] of actions) assert.match(revision, /^[a-f0-9]{40}$/);
  assert.match(workflow, /bun scripts\/ios-native\/run\.mjs --build-only/);
  assert.equal((workflow.match(/ios-capture-build-\$\{\{ github.sha \}\}/g) ?? []).length, 2);
  assert.match(runner, /loadBuiltSimulator/);
  assert.match(workflow, /permissions:\n {2}contents: read/);
  assert(!workflow.includes("secrets.") && !workflow.includes("pull_request_target"));
});
test("capture source guards output, isolated saves, exact effects and publication snapshots", () => {
  assert.match(runner, /!existsSync\(output\) && !existsSync\(published\)/);
  assert.match(runner, /!existsSync\(database\)/);
  assert.match(runner, /saved\[0\].value, bytes/);
  assert.match(runner, /accepted: false/);
  assert.match(runner, /snapshotEvidence\(output, published, receipt\)/);
  assert.match(runner, /Owned capture simulator cleanup failed/);
  assert(!runner.includes('sim("erase"') && !runner.includes('sim("delete", "all"'));
});
