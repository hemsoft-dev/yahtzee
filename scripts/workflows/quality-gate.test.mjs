import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(new URL("../../.github/workflows/quality.yml", import.meta.url), "utf8").replaceAll("\r\n", "\n");
const jobs = Object.fromEntries([...workflow.matchAll(/^ {2}([\w-]+):\n([\s\S]*?)(?=^ {2}[\w-]+:|$(?![\s\S]))/gm)].map((m) => [m[1], m[2]]));

test("actual workflow keeps required names, unconditional jobs and read-only safeguards", () => {
  for (const [job, name] of [["validate", "Validate (${{ matrix.os }})"], ["mutation", "Core-rule mutation gate"], ["quality-gate", "quality-gate"]]) assert(jobs[job].includes(`name: ${name}\n`), job);
  for (const job of ["validate", "mutation"]) assert.doesNotMatch(jobs[job], /^ {4}(if|needs):/m);
  assert.match(workflow, /scripts\/workflows\/\*\.test\.mjs/);
  assert.doesNotMatch(workflow, /paths-ignore:|paths:/);
  assert.match(workflow, /permissions:\n {2}contents: read/);
  assert.match(jobs["quality-gate"], /if: \$\{\{ always\(\) \}\}/);
  assert.match(jobs["quality-gate"], /needs: \[validate, mutation\]/);
});

test("execute the actual aggregate shell with successful, failed, cancelled, skipped and missing dependencies", () => {
  const gate = jobs["quality-gate"];
  const shell = gate.split("        run: |\n")[1].split("\n").map((line) => line.replace(/^ {10}/, "")).join("\n");
  const refs = { validate: { result: "success" }, mutation: { result: "success" } };
  const declared = new Set(gate.match(/^ {4}needs: \[([^\]]+)\]/m)[1].split(", "));
  const execute = (needs) => {
    const env = { ...process.env };
    for (const [, key, ref] of gate.matchAll(/^ {10}([A-Z_]+): \$\{\{ needs\.([\w.-]+) \}\}$/gm)) {
      const [job, ...keys] = ref.split(".");
      env[key] = (declared.has(job) ? keys.reduce((obj, part) => obj?.[part], needs[job]) : undefined) ?? "";
    }
    const result = spawnSync(process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "bash", ["-c", shell], { env, encoding: "utf8" });
    assert.ifError(result.error);
    return result.status;
  };
  assert.equal(execute(refs), 0);
  for (const job of Object.keys(refs)) {
    for (const result of ["failure", "cancelled", "skipped", "", "queued", "in_progress"]) {
      const needs = structuredClone(refs); needs[job].result = result;
      assert.notEqual(execute(needs), 0, `${job} ${result}`);
    }
    const missing = structuredClone(refs); delete missing[job];
    assert.notEqual(execute(missing), 0, `missing ${job}`);
  }
});
