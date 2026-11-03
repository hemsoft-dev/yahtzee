import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(new URL("../../.github/workflows/quality.yml", import.meta.url), "utf8").replaceAll("\r\n", "\n");
function job(name) {
  const match = workflow.match(new RegExp(`^  ${name}:\\n([\\s\\S]*?)(?=^  [a-z][a-z-]*:|$(?![\\s\\S]))`, "m"));
  assert(match, `Missing ${name} job`);
  return match[1];
}

test("native build and all qualification groups use the same standard 14GB Intel runner", () => {
  // The artifact loader rejects an app built for a different simulator architecture.
  // Changing only the matrix runner would break all four groups after an expensive build.
  const build = job("native-build"), qualification = job("native");
  const runner = (source) => source.match(/^ {4}runs-on: (\S+)$/m)?.[1];
  assert.equal(runner(build), "macos-26-intel");
  assert.equal(runner(qualification), runner(build));
  assert.match(qualification, /group: \[phone-5, phone-6, tablet-8, tablet-10\]/);
  assert.match(job("quality-gate"), /needs: \[validate, mutation, native-build, native\]/);
});

