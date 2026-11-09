import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { annotation, exportProgress, runExport } from "./mobile-export.mjs";

// Fixed progress lines retained from actual successful main682/PR127 Windows exports.
const original = [
  "@yahtzee/mobile build: Starting Metro Bundler",
  "@yahtzee/mobile build: Android Bundled 17729ms node_modules\\entry.js (1341 modules)",
  "@yahtzee/mobile build: Exported: ../../reports/mobile/android",
  "@yahtzee/mobile build: Starting Metro Bundler",
  "@yahtzee/mobile build: iOS Bundled 15630ms node_modules\\entry.js (1195 modules)",
  "@yahtzee/mobile build: Exported: ../../reports/mobile/ios",
].join("\n") + "\n";

function collect() {
  const chunks = [];
  return { chunks, stream: new Writable({ write(chunk, _encoding, done) { chunks.push(Buffer.from(chunk)); done(); } }) };
}

test("actual retained progress is stable across every chunk boundary without exporting values", () => {
  const bytes = Buffer.from(original);
  for (let size = 1; size <= bytes.length; size++) {
    const rows = []; const progress = exportProgress((row) => rows.push(row), () => 20);
    for (let i = 0; i < bytes.length; i += size) progress.push(1, bytes.subarray(i, i + size));
    progress.end(1);
    assert.deepEqual(rows.map((r) => r.stage), [3, 4, 5, 6, 7, 8]);
    assert(rows.every((r) => Object.values(r).every(Number.isSafeInteger)));
    assert(!rows.map(annotation).join("").includes("node_modules"));
  }
});

test("unknown, oversized, partial and out-of-order lines are not invented stages", () => {
  const rows = []; const p = exportProgress((row) => rows.push(row));
  p.push(1, Buffer.from("secret=https://private.invalid/?token=hidden\n"));
  assert.equal(rows.length, 0);
  p.push(1, Buffer.from("@yahtzee/mobile build: Exported: ../../reports/mobile/ios\n"));
  p.push(2, Buffer.alloc(1024 * 1024, 65)); p.push(2, Buffer.from("\n"));
  p.push(1, Buffer.from([255, 254, 0])); p.end(1);
  assert.deepEqual(rows.map((r) => r.stage), [11]);
  assert(!rows.map(annotation).join("").includes("hidden"));
  p.emit("private-payload"); p.emit(123); p.emit(1, "private-error"); p.emit(1, 0, "secret-signal");
  assert.deepEqual(rows.map((r) => r.stage), [11]);
});

test("finite stages stay bounded, tolerate clocks and sink faults, and never turn partial into absence", () => {
  const rows = []; const p = exportProgress((row) => rows.push(row), () => { throw Error("private"); });
  for (let i = 0; i < 10000; i++) p.push(1, Buffer.from(original));
  p.emit(1); p.emit(2); p.emit(9, 7); p.emit(10, 0);
  assert(rows.length <= 10);
  assert(rows.every((r) => r.ms === -1));
  const broken = exportProgress(() => { throw Error("private"); });
  assert.doesNotThrow(() => { broken.push(1, Buffer.from(original)); broken.end(1); broken.emit(9); });
});

test("real subprocess forwards bytes once and preserves failing result with a broken diagnostic sink", async () => {
  const dir = mkdtempSync(join(tmpdir(), "export-process-"));
  const counter = join(dir, "count");
  const child = join(dir, "child.cjs");
  writeFileSync(child, `require('node:fs').appendFileSync(${JSON.stringify(counter)},'1');process.stdout.write(${JSON.stringify(original)});process.stderr.write('private-raw-error');process.exitCode=7;`);
  const out = collect(), err = collect();
  const result = await runExport({ command: process.execPath, args: [child], stdout: out.stream, stderr: err.stream,
    notice() { throw Error("diagnostic sink unavailable"); } });
  assert.equal(result.code, 7); assert.equal(result.signal, null); assert.equal(result.error, undefined);
  assert.equal(readFileSync(counter, "utf8"), "1");
  assert.equal(Buffer.concat(out.chunks).toString(), original);
  assert.equal(Buffer.concat(err.chunks).toString(), "private-raw-error");
});

test("stdout and stderr partial lines never become one invented marker", () => {
  const rows = [], p = exportProgress((row) => rows.push(row));
  p.push(1, Buffer.from("@yahtzee/mobile build: Starting "));
  p.push(2, Buffer.from("Metro Bundler\n"));
  p.end(1); p.end(2);
  assert.deepEqual(rows.map((r) => r.stage), [11]);
});

test("annotation formatting rejects arbitrary fields and payloads before output", () => {
  const row = { v: 1, stage: 1, seq: 1, ms: 0, code: -1, signal: 0 };
  for (const invalid of [{ ...row, raw: "private-token" }, { ...row, code: "private-error" }, { ...row, ms: Infinity }, { ...row, seq: 11 }]) {
    assert.throws(() => annotation(invalid), { message: "Invalid finite export observation" });
  }
});

test("early unavailable observation cannot consume the iOS completion slot", () => {
  const rows = [], p = exportProgress((row) => rows.push(row));
  p.emit(1); p.emit(2);
  p.push(2, Buffer.from("x".repeat(8193) + "\n"));
  p.push(1, Buffer.from(original));
  p.emit(9, 0);
  assert.deepEqual(rows.map((r) => r.stage), [1, 2, 11, 3, 4, 5, 6, 7, 8, 9]);
  assert.equal(rows.length, 10);
});

test("completed child without recognized exports is explicitly unavailable", async () => {
  const rows = [], out = collect(), err = collect();
  const result = await runExport({ command: process.execPath, args: ["-e", "console.log('unrecognized original output')"],
    stdout: out.stream, stderr: err.stream, notice: (row) => rows.push(row) });
  assert.equal(result.code, 0);
  assert.deepEqual(rows.map((r) => r.stage), [1, 2, 11, 9]);
});

test("real successful child records entry, spawn, ordered markers and close", async () => {
  const out = collect(), err = collect(), rows = [];
  const result = await runExport({ command: process.execPath, args: ["-e", `process.stdout.write(${JSON.stringify(original)})`],
    stdout: out.stream, stderr: err.stream, notice: (row) => rows.push(row) });
  assert.equal(result.code, 0);
  assert.deepEqual(rows.map((r) => r.stage), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.equal(rows.at(-1).code, 0);
  assert.equal(Buffer.concat(out.chunks).toString(), original);
});

test("actual spawn error stays failure and emits no arbitrary error payload", async () => {
  const rows = [], out = collect(), err = collect();
  const result = await runExport({ command: join(tmpdir(), "missing-export-command-22b89184"), stdout: out.stream,
    stderr: err.stream, notice: (row) => rows.push(row) });
  assert.equal(result.error.code, "ENOENT");
  assert(rows.some((r) => r.stage === 10 && r.code === 1));
  assert(!rows.map(annotation).join("").includes("missing-export-command"));
});

test("real child signal is retained as a non-successful termination", async () => {
  const rows = [], out = collect(), err = collect();
  const result = await runExport({ command: process.execPath, args: ["-e", "process.kill(process.pid,'SIGTERM')"],
    stdout: out.stream, stderr: err.stream, notice: (row) => rows.push(row) });
  assert(result.signal || result.code !== 0);
  assert(rows.some((r) => r.stage === 9));
});

test("pinned Bun workspace boundary preserves invocation, bytes and nonzero outcome", () => {
  assert.equal(spawnSync("bun", ["--revision"], { encoding: "utf8" }).stdout.trim(), "1.4.2+744846f84");
  const root = mkdtempSync(join(tmpdir(), "export-bun-"));
  const mobile = join(root, "apps", "mobile"); mkdirSync(mobile, { recursive: true });
  const counter = join(root, "count"), script = join(mobile, "child.cjs");
  writeFileSync(join(root, "package.json"), JSON.stringify({ workspaces: ["apps/*"], scripts: { "build:mobile": "bun run --filter @yahtzee/mobile build" } }));
  writeFileSync(join(mobile, "package.json"), JSON.stringify({ name: "@yahtzee/mobile", scripts: { build: "node child.cjs" } }));
  const payload = original.replaceAll("@yahtzee/mobile build: ", "");
  writeFileSync(script, `require('node:fs').appendFileSync(${JSON.stringify(counter)},'1');process.stdout.write(${JSON.stringify(payload)});process.stderr.write('original-stderr');process.exitCode=7;`);
  const opts = { cwd: root, encoding: "utf8", timeout: 10000, env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" } };
  const baseline = spawnSync("bun", ["run", "build:mobile"], opts);
  const observed = process.env.MOBILE_EXPORT_BASELINE === "1" ? spawnSync("bun", ["run", "build:mobile"], opts)
    : spawnSync(process.execPath, [fileURLToPath(new URL("./mobile-export.mjs", import.meta.url))], opts);
  assert(baseline.status > 0); assert.equal(observed.status, baseline.status);
  assert.equal(readFileSync(counter, "utf8"), "11");
  assert.equal(observed.stderr, baseline.stderr);
  assert.equal(observed.stdout.replace(/\n::notice title=Mobile export stage::[^\r\n]*\n/g, ""), baseline.stdout);
  assert.match(observed.stdout, new RegExp(`stage=9 .*code=${baseline.status} signal=0`));
});

test("workflow uses observation only on Windows and preserves the original deadline and Linux command", () => {
  const workflow = readFileSync(new URL("../../.github/workflows/quality.yml", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  assert.match(workflow, /validate:[\s\S]*?timeout-minutes: 15/);
  assert(workflow.includes("run: ${{ runner.os == 'Windows' && 'node scripts/workflows/mobile-export.mjs' || 'bun run build:mobile' }}"));
  assert(workflow.includes("EXPO_OFFLINE: '1'"));
});
