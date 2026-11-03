import assert from "node:assert/strict";
import { spawnSync, execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { nativeRequired } from "./docs-only-native.mjs";

const workflow = readFileSync(new URL("../../.github/workflows/quality.yml", import.meta.url), "utf8").replaceAll("\r\n", "\n");
const script = fileURLToPath(new URL("./docs-only-native.mjs", import.meta.url));
const jobs = Object.fromEntries([...workflow.matchAll(/^ {2}([\w-]+):\n([\s\S]*?)(?=^ {2}[\w-]+:|$(?![\s\S]))/gm)].map((m) => [m[1], m[2]]));
const event = (count = 1) => ({ pull_request: { changed_files: count, base: { sha: "a".repeat(40) }, head: { sha: "b".repeat(40) } } });

test("only complete added/modified allowlisted PR content can skip native", () => {
  for (const path of ["README.md", "docs/quality-policy.md", "docs/security/README.md", "site/pages.mjs", "site/style.css", "site/assets/iphone-help.png"]) {
    for (const status of ["A", "M"]) assert.equal(nativeRequired("pull_request", event(), () => `${status}\0${path}\0`), false, path);
  }
  for (const path of ["apps/mobile/App.tsx", ".github/workflows/quality.yml", "scripts/workflows/docs-only-native.mjs", "scripts/ios-native/run.mjs", "scripts/ios-capture/run.mjs", "package.json", "bun.lock", "new.md", "docs/privacy/proof.json", "site/build.mjs", "site/new.mjs", "docs/../package.json", "docs//guide.md", "docs\\guide.md"]) {
    assert.equal(nativeRequired("pull_request", event(), () => `M\0${path}\0`), true, path);
  }
  for (const raw of ["D\0docs/guide.md\0", "R100\0docs/old.md\0docs/new.md\0", "C100\0docs/old.md\0docs/new.md\0", "M\0README.md", "", "X\0README.md\0"]) {
    assert.equal(nativeRequired("pull_request", event(), () => raw), true, raw);
  }
  assert.equal(nativeRequired("pull_request", event(2), () => "M\0README.md\0M\0apps/mobile/App.tsx\0"), true);
  assert.equal(nativeRequired("pull_request", event(2), () => "M\0README.md\0"), true, "truncated diff");
  assert.equal(nativeRequired("pull_request", event(2), () => "M\0README.md\0M\0README.md\0"), true, "duplicate paths");
  assert.equal(nativeRequired("pull_request", event(2), () => "M\0README.md\0A\0site/style.css\0"), false);
});

test("push, merge groups, unknown events, absent metadata and git failures fail closed", () => {
  for (const name of ["push", "merge_group", "workflow_dispatch", undefined]) assert.equal(nativeRequired(name, event(), () => { throw Error("must not diff"); }), true);
  for (const data of [null, {}, event(0), event(-1), event(1.5), event("1"), { pull_request: { changed_files: 1 } }]) assert.equal(nativeRequired("pull_request", data, () => "M\0README.md\0"), true);
  assert.equal(nativeRequired("pull_request", event(), () => { throw Error("missing history"); }), true);
});

function jobCondition(job, changesResult, required, build = "success") {
  const condition = jobs[job].match(/^ {4}if: \$\{\{ (.*) \}\}$/m)[1];
  const expression = condition.replaceAll("!cancelled()", "true")
    .replaceAll("needs.changes.result", JSON.stringify(changesResult))
    .replaceAll("needs.changes.outputs.native-required", JSON.stringify(required))
    .replaceAll("needs.native-build.result", JSON.stringify(build));
  return Function(`return (${expression});`)();
}

test("actual workflow gates only native jobs and preserves required names, matrix and safeguards", () => {
  assert.match(jobs.changes, /fetch-depth: 0/);
  assert.match(jobs.changes, /native-required: \$\{\{ steps.classify.outputs.native-required \}\}/);
  assert.match(jobs.changes, /id: classify\n {8}run: node scripts\/workflows\/docs-only-native.mjs/);
  assert.match(jobs["native-build"], /needs: changes/);
  assert.match(jobs.native, /needs: \[changes, native-build\]/);
  for (const job of ["native-build", "native"]) {
    assert.equal(jobCondition(job, "success", "false"), false);
    for (const [result, required] of [["success", "true"], ["success", ""], ["failure", "false"], ["skipped", undefined]]) assert.equal(jobCondition(job, result, required), true);
    assert.match(jobs[job], /runs-on: macos-26/);
  }
  assert.equal(jobCondition("native", "success", "true", "failure"), false);
  assert.match(jobs.native, /group: \[phone-5, phone-6, tablet-8, tablet-10\]/);
  assert.match(jobs.native, /max-parallel: 4/);
  assert.match(jobs.native, /timeout-minutes: 60/);
  assert.match(jobs["native-build"], /timeout-minutes: 50/);
  for (const [job, name] of [["validate", "Validate (${{ matrix.os }})"], ["mutation", "Core-rule mutation gate"], ["native-build", "Build unsigned iOS simulator app"], ["native", "Native qualification (${{ matrix.group }})"], ["quality-gate", "quality-gate"]]) assert(jobs[job].includes(`name: ${name}\n`));
  for (const job of ["validate", "mutation"]) assert.doesNotMatch(jobs[job], /^ {4}(if|needs):/m);
  assert.match(workflow, /scripts\/workflows\/\*\.test\.mjs/);
  assert.doesNotMatch(workflow, /paths-ignore:|paths:/);
  assert.match(workflow, /permissions:\n {2}contents: read/);
  assert.match(jobs["quality-gate"], /if: \$\{\{ always\(\) \}\}/);
  assert.match(jobs["quality-gate"], /needs: \[changes, validate, mutation, native-build, native\]/);
});

test("execute the actual aggregate shell with successful, failed, cancelled and skipped dependencies", () => {
  const gate = jobs["quality-gate"];
  const shell = gate.split("        run: |\n")[1].split("\n").map((line) => line.replace(/^ {10}/, "")).join("\n");
  const refs = { changes: { result: "success", outputs: { "native-required": "true" } }, validate: { result: "success" }, mutation: { result: "success" }, "native-build": { result: "success" }, native: { result: "success" } };
  const execute = (needs) => {
    const env = { ...process.env };
    for (const [, key, ref] of gate.matchAll(/^ {10}([A-Z_]+): \$\{\{ needs\.([\w.-]+) \}\}$/gm)) {
      env[key] = ref.split(".").reduce((obj, part) => obj?.[part], needs) ?? "";
    }
    const result = spawnSync(process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "bash", ["-c", shell], { env, encoding: "utf8" });
    assert.ifError(result.error);
    return result.status;
  };
  assert.equal(execute(refs), 0);
  const safe = structuredClone(refs);
  safe.changes.outputs["native-required"] = "false";
  safe["native-build"].result = safe.native.result = "skipped";
  assert.equal(execute(safe), 0);
  assert.notEqual(execute({ ...refs, native: { result: "skipped" } }), 0);
  assert.notEqual(execute({ ...safe, native: { result: "success" } }), 0);
  for (const baseline of [refs, safe]) {
    for (const job of Object.keys(refs)) {
      for (const result of ["failure", "cancelled", "skipped"]) {
        if (baseline === safe && ["native", "native-build"].includes(job) && result === "skipped") continue;
        const needs = structuredClone(baseline);
        needs[job].result = result;
        assert.notEqual(execute(needs), 0, `${job} ${result}`);
      }
    }
  }
  for (const value of ["", "unknown"]) {
    const needs = structuredClone(refs);
    needs.changes.outputs["native-required"] = value;
    assert.notEqual(execute(needs), 0);
  }
});

test("workflow classifier command uses a real git diff and fails closed at its CLI boundary", () => {
  const dir = mkdtempSync(join(tmpdir(), "docs-native-"));
  try {
    const git = (...args) => execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();
    git("-c", "init.defaultBranch=main", "init", "--quiet");
    git("config", "core.autocrlf", "false");
    const commit = () => { git("add", "."); git("-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "--quiet", "-m", "fixture"); return git("rev-parse", "HEAD"); };
    writeFileSync(join(dir, "README.md"), "base\n");
    const base = commit();
    writeFileSync(join(dir, "README.md"), "safe\n");
    const safeHead = commit();
    writeFileSync(join(dir, "package.json"), "{}\n");
    const mixedHead = commit();
    git("mv", "README.md", "guide.md");
    const renameHead = commit();
    git("rm", "guide.md");
    const deleteHead = commit();
    const command = jobs.changes.match(/ {8}run: (node scripts\/workflows\/docs-only-native.mjs)/)[1];
    for (const [head, count, expected] of [[safeHead, 1, false], [safeHead, 2, true], [mixedHead, 2, true], [renameHead, 3, true], [deleteHead, 2, true], ["f".repeat(40), 1, true]]) {
      const data = { pull_request: { base: { sha: base }, head: { sha: head }, changed_files: count } };
      const eventPath = join(dir, "event.json");
      const output = join(dir, "output.txt");
      writeFileSync(eventPath, JSON.stringify(data));
      writeFileSync(output, "");
      const result = spawnSync(process.execPath, [command.split(" ")[1].replace("scripts/workflows/docs-only-native.mjs", script)], { cwd: dir, env: { ...process.env, GITHUB_EVENT_NAME: "pull_request", GITHUB_EVENT_PATH: eventPath, GITHUB_OUTPUT: output }, encoding: "utf8" });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(readFileSync(output, "utf8"), `native-required=${expected}\n`);
    }
    const output = join(dir, "output.txt");
    writeFileSync(output, "");
    const result = spawnSync(process.execPath, [script], { env: { ...process.env, GITHUB_EVENT_NAME: "pull_request", GITHUB_EVENT_PATH: join(dir, "missing.json"), GITHUB_OUTPUT: output } });
    assert.equal(result.status, 0);
    assert.equal(readFileSync(output, "utf8"), "native-required=true\n");
    writeFileSync(join(dir, "event.json"), "{");
    writeFileSync(output, "");
    const malformed = spawnSync(process.execPath, [script], { env: { ...process.env, GITHUB_EVENT_NAME: "pull_request", GITHUB_EVENT_PATH: join(dir, "event.json"), GITHUB_OUTPUT: output } });
    assert.equal(malformed.status, 0);
    assert.equal(readFileSync(output, "utf8"), "native-required=true\n");
    const failedOutput = spawnSync(process.execPath, [script], { env: { ...process.env, GITHUB_EVENT_NAME: "push", GITHUB_EVENT_PATH: join(dir, "event.json"), GITHUB_OUTPUT: join(dir, "absent", "output") } });
    assert.notEqual(failedOutput.status, 0, "an output-write failure must fail classification");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
