import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";
import { INSTALL_LIMITS, installCollector, installMarker } from "./installLog.mjs";
import { INSTALL_ARGS, installExit, installWriter, observeInstall } from "./install.mjs";

const temporary = (prefix) => realpathSync(mkdtempSync(join(tmpdir(), prefix)));
const secret = "DO_NOT_RETAIN_secret_header_token_URL_path";
const host = () => new EventEmitter();
const memoryWriter = () => { const rows = []; return { rows, emit: (r) => rows.push(r), finish: async () => ({ status: "observed", dropped: 0 }) }; };
const fixture = () => { const child = new EventEmitter(); child.pid = 123; child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = () => true; return child; };
const feed = (parts, options = {}) => { const rows = [], collector = installCollector({ emit: (r) => rows.push(r), ...options }); for (const p of parts) collector.push(2, p); return { rows, stats: collector.finish() }; };

test("only pinned finite markers survive, split chunks and ANSI are consumed before publication", () => {
  const input = `Cache Dir: ${secret}\nResolved peers [1.2ms]\nCreated store [2.1ms]\n[PackageManager] waiting for 4 tasks\nResolved, downloaded and extracted [4]\n${secret}\n`;
  const result = feed([...Buffer.from(input)].map((b) => Buffer.from([b])));
  assert.deepEqual(result.rows.map((r) => [r.stage, r.count]), [[4, null], [5, null], [6, 4], [3, 4]]);
  assert(!JSON.stringify(result).includes(secret));
  assert.deepEqual(installMarker("\x1b[32mCreated store [0.1ms]\x1b[0m"), { stage: 5, count: null });
  for (const line of [`Created store [1ms] ${secret}`, `Resolved peers [${secret}]`, "Resolved peers [1e20ms]", "[PackageManager] waiting for -1 tasks", "Created store [NaNms]"]) assert.equal(installMarker(line), null);
});

test("oversized, partial, malformed, record and byte bounds discard complete sensitive edges", () => {
  const partial = feed([`Resolved peers [1ms]${secret}`]); assert.equal(partial.rows.length, 0); assert.equal(partial.stats.partialLines, 1);
  const huge = feed([`${secret}${"x".repeat(800)}Created store [1ms]\nCreated store [2ms]\n`]); assert.equal(huge.rows.length, 1); assert.equal(huge.stats.oversized, 1);
  const capped = feed(["Created store [1ms]\n".repeat(100)]); assert.equal(capped.rows.length, INSTALL_LIMITS.events); assert(capped.stats.eventLimit);
  const bytes = feed([Buffer.alloc(INSTALL_LIMITS.bytes + 100, 65), "\nCreated store [1ms]\n"]); assert.equal(bytes.rows.length, 0); assert(bytes.stats.byteLimit);
  assert(!JSON.stringify([partial, huge, capped, bytes]).includes(secret));
});

test("classifier/sink/clock failures and injected nonfinite output never escape", () => {
  for (const classify of [() => { throw new Error(secret); }, () => ({ stage: 4, count: null, payload: secret }), () => ({ stage: 4, count: Infinity })]) {
    const result = feed(["Created store [1ms]\n"], { classify }); assert.equal(result.rows.length, 0); assert(!JSON.stringify(result).includes(secret));
  }
  const throwing = installCollector({ emit: () => { throw new Error(secret); }, clock: () => { throw new Error(secret); } }); throwing.push(1, "Created store [1ms]\n"); assert.equal(throwing.finish().sinkErrors, 1);
});

test("one original invocation forwards cwd/env/stdin and failed outcome; prefix and terminal retained before finish", async () => {
  const child = fixture(), writer = memoryWriter(), env = { GITHUB_SHA: "a".repeat(40), GITHUB_RUN_ID: "10", GITHUB_RUN_ATTEMPT: "1", PRIVATE: secret }, h = host(), cwd = "/fixture"; let calls = 0;
  const pending = observeInstall({ cwd, env, host: h, writer, spawnImpl: (exe, args, opts) => { calls++; assert.equal(exe, "bun"); assert.equal(args, INSTALL_ARGS); assert.equal(opts.cwd, cwd); assert.equal(opts.env, env); assert.deepEqual(opts.stdio, ["inherit", "pipe", "pipe"]); return child; } });
  child.stdout.write(`Cache Dir: ${secret}\nResolved peers [1ms]\n`); child.stderr.write("Created store [1ms]\n"); child.stdout.end(); child.stderr.end(); child.emit("close", 65, null);
  const result = await pending; assert.equal(calls, 1); assert.equal(result.code, 65); assert.equal(result.error, null); assert.deepEqual(writer.rows.filter((r) => r.kind === 1).map((r) => r.stage), [4, 5]); assert.equal(writer.rows.at(-1).kind, 4); assert(!JSON.stringify(writer.rows).includes(secret)); assert.equal(h.listenerCount("SIGTERM"), 0);
  assert.deepEqual(INSTALL_ARGS, ["install", "--frozen-lockfile", "--ignore-scripts", "--verbose"]);
});

test("same original error object, signal forwarding and terminal signal survive advisory faults", async () => {
  const child = fixture(), error = Object.assign(new Error(secret), { code: "EACCES" }), h = host(), kills = [];
  child.kill = (s) => kills.push(s);
  const pending = observeInstall({ cwd: "/fixture", host: h, env: {}, writer: { emit() { throw new Error(secret); }, finish() { throw new Error(secret); } }, collectorFactory() { throw new Error(secret); }, spawnImpl: () => child });
  h.emit("SIGTERM"); child.stdout.write(Buffer.alloc(100000)); child.stdout.end(); child.stderr.end(); child.emit("error", error); child.emit("close", null, "SIGTERM");
  const result = await pending; assert.equal(result.error, error); assert.equal(result.signal, "SIGTERM"); assert.deepEqual(kills, ["SIGTERM"]); assert.equal(result.synopsis.coverage.unavailable, true); assert(!JSON.stringify(result.synopsis).includes(secret));
  const target = { pid: 99, kill: (...args) => kills.push(args) }; installExit(result, target); assert.deepEqual(kills.at(-1), [99, "SIGTERM"]);
  const missing = Object.assign(new Error(secret), { code: "ENOENT" }); const threw = await observeInstall({ cwd: "/fixture", env: {}, host: h, writer: memoryWriter(), spawnImpl() { throw missing; } }); assert.equal(threw.error, missing); installExit(threw, target); assert.equal(target.exitCode, 127);
});

test("real Node child pipes drain large/split secret output and retain exit65 before cleanup", async () => {
  const root = temporary("archive-stream-"), script = join(root, "child.cjs"), writer = installWriter(root);
  writeFileSync(script, [
    "process.stdout.write(" + JSON.stringify(`Cache Dir: ${secret}\nResolved peers [1ms]\n`) + ");",
    "process.stdout.write(" + JSON.stringify(secret.repeat(200000) + "\n") + ");",
    "process.stderr.write(" + JSON.stringify(secret + "\n") + ");process.exitCode=65;",
  ].join("\n"));
  const result = await observeInstall({ cwd: root, env: process.env, host: host(), writer, spawnImpl: () => spawn(process.execPath, [script], { stdio: ["ignore", "pipe", "pipe"] }) });
  assert.equal(result.code, 65); const retained = readFileSync(join(root, "reports/archive-install-evidence/synopsis.jsonl"), "utf8"); assert(!retained.includes(secret)); const rows = retained.trim().split("\n").map(JSON.parse); assert(rows.some((r) => r.kind === 1 && r.stage === 4)); assert.equal(rows.at(-1).code, 65); assert(result.synopsis.coverage.byteLimit); assert.equal(result.synopsis.retention.status, "observed");
});

test("writer failure/old output never prevents a successful child or overwrites retained bytes", async () => {
  const root = temporary("archive-existing-"); mkdirSync(join(root, "reports")); mkdirSync(join(root, "reports/archive-install-evidence")); const path = join(root, "reports/archive-install-evidence/synopsis.jsonl"); writeFileSync(path, "retained");
  const child = fixture(), p = observeInstall({ cwd: root, env: {}, host: host(), spawnImpl: () => child }); child.stdout.end("Created store [1ms]\n"); child.stderr.end(); child.emit("close", 0, null); const result = await p; assert.equal(result.code, 0); assert.equal(result.synopsis.retention.status, "unavailable"); assert.equal(readFileSync(path, "utf8"), "retained");
});


test("linked report roots are unavailable and never receive a synopsis", async () => {
  const root = temporary("archive-link-"), target = temporary("archive-target-");
  symlinkSync(target, join(root, "reports"), process.platform === "win32" ? "junction" : "dir");
  const child = fixture(), pending = observeInstall({ cwd: root, env: {}, host: host(), spawnImpl: () => child }); child.stdout.end("Created store [1ms]\n"); child.stderr.end(); child.emit("close", 0, null);
  const result = await pending; assert.equal(result.code, 0); assert.equal(result.synopsis.retention.status, "unavailable");
});

test("an owned root reached through a linked ancestor creates no external reports", async () => {
  const base = temporary("archive-ancestor-"), target = temporary("archive-real-"); mkdirSync(join(target, "nested"));
  symlinkSync(target, join(base, "alias"), process.platform === "win32" ? "junction" : "dir");
  const child = fixture(), pending = observeInstall({ cwd: join(base, "alias/nested"), env: {}, host: host(), spawnImpl: () => child }); child.stdout.end(); child.stderr.end(); child.emit("close", 0, null);
  const result = await pending; assert.equal(result.code, 0); assert.equal(result.synopsis.retention.status, "unavailable"); assert(!existsSync(join(target, "nested/reports")), "Unavailable ownership must fail before creating evidence directories");
});

test("actual terminal signals retain the prefix and original process outcome on POSIX", () => {
  if (process.platform === "win32") { const target = { pid: 7, kill(pid, signal) { assert.equal(pid, 7); assert.equal(signal, "SIGTERM"); } }; installExit({ signal: "SIGTERM" }, target); return; }
  const root = temporary("archive-signal-"), script = join(root, "control.mjs");
  const moduleURL = new URL("./install.mjs", import.meta.url).href;
  writeFileSync(script, `import {spawn} from 'node:child_process';import {observeInstall,installExit} from ${JSON.stringify(moduleURL)};const r=await observeInstall({cwd:${JSON.stringify(root)},spawnImpl:()=>spawn(process.execPath,['-e',${JSON.stringify("process.stdout.write('Created store [1ms]\\n');process.kill(process.pid,'SIGTERM')")}],{stdio:['ignore','pipe','pipe']})});installExit(r);`);
  const result = spawnSync(process.execPath, [script], { encoding: "buffer", maxBuffer: 1024 }); assert.equal(result.signal, "SIGTERM"); assert.equal(result.status, null);
  const rows = readFileSync(join(root, "reports/archive-install-evidence/synopsis.jsonl"), "utf8").trim().split("\n").map(JSON.parse); assert.equal(rows.at(-1).signal, 2); assert.equal(rows.at(-1).code, null);
});

test("actual pinned Bun offline workspace fixtures expose post-resolution verbose categories without changing lock", () => {
  const revision = spawnSync("bun", ["--revision"], { encoding: "utf8" }); assert.equal(revision.status, 0, "Installed Bun revision command must succeed"); assert(revision.stdout.trim() === "1.4.2+744846f84", "Fixture requires pinned Bun");
  const observed = [];
  for (const verbose of [false, true]) {
    const root = temporary("archive-offline-"); mkdirSync(join(root, "packages")); mkdirSync(join(root, "packages/local"));
    writeFileSync(join(root, "package.json"), JSON.stringify({ name: "archive-fixture", private: true, workspaces: ["packages/*"] })); writeFileSync(join(root, "packages/local/package.json"), JSON.stringify({ name: "archive-local", version: "1.0.0" }));
    const lock = JSON.stringify({ lockfileVersion: 3, configVersion: 1, workspaces: { "": { name: "archive-fixture" }, "packages/local": { name: "archive-local", version: "1.0.0" } }, packages: {} }); writeFileSync(join(root, "bun.lock"), lock);
    const result = spawnSync("bun", ["install", "--frozen-lockfile", "--ignore-scripts", "--offline", ...(verbose ? ["--verbose"] : [])], { cwd: root, encoding: "buffer", maxBuffer: 1024 * 1024 }); assert.equal(result.status, 0, "Offline fixture must install successfully"); assert.equal(readFileSync(join(root, "bun.lock"), "utf8"), lock);
    const rows = [], collector = installCollector({ emit: (r) => rows.push(r) }); collector.push(1, result.stdout); collector.push(2, result.stderr); const coverage = collector.finish(); assert(!coverage.partial, "Offline source markers must fit the finite collector"); observed.push(rows.map((r) => r.stage));
  }
  assert(!observed[0].includes(4) && !observed[0].includes(5), "Ordinary fixture has no verbose store timing markers"); assert(observed[1].includes(4) && observed[1].includes(5), "Pinned verbose fixture must expose peers/store categories");
});

test("workflow preserves archive requirements and adds verbosity only through the owned runner", () => {
  const source = readFileSync(new URL("../../.github/workflows/ios-archive.yml", import.meta.url), "utf8").replace(/\r\n/g, "\n"); assert(source.includes("- run: node scripts/ios-archive/install.mjs\n        timeout-minutes: 5")); assert(source.includes("bun-version: '1.4.2'")); assert(source.includes("node-version: '24.12.0'")); assert(source.includes("run: node scripts/ios-archive/run.mjs")); assert(!source.includes("continue-on-error"));
});
