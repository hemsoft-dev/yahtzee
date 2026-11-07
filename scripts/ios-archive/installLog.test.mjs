import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { constants, tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";
import { INSTALL_LIMITS, installCollector, installMarker } from "./installLog.mjs";
import { INSTALL_ARGS, installExit, installWriter, observeInstall } from "./install.mjs";

const temporary = (prefix) => realpathSync(mkdtempSync(join(tmpdir(), prefix)));
const secret = "DO_NOT_RETAIN_secret_header_token_URL_path";
const host = () => new EventEmitter();
const memoryWriter = () => { const rows = []; return { rows, emit: (r) => rows.push(r), finish: async () => ({ status: "observed", dropped: 0 }) }; };
// Fixed pinned src/install/error.rs names plus the exact frozen-lock message.
// This is test failure context only, never an installation acceptance oracle.
function fixtureErrors(value) {
  try {
    if (!Buffer.isBuffer(value) || value.length > 1024 * 1024) return { classes: [0], unavailable: true };
    const text = value.toString("utf8").replace(new RegExp(String.fromCharCode(27) + "\\[[0-?]*[ -/]*[@-~]", "g"), "");
    const names = ["AccessDenied", "FileNotFound", "MissingPackageJSON", "InvalidPackageJSON", "InvalidLockfile", "LockfileResolveFailed", "IntegrityCheckFailed", "NotDir", "NameTooLong", "SymLinkLoop", "SystemFdQuotaExceeded", "SystemResources", "NotSameFileSystem", "FailedToCopyFile", "NotSupported", "WriteFailed", "CorruptLockfile", "InstallFailed"];
    const classes = text.includes("lockfile had changes, but lockfile is frozen") ? [1] : [];
    for (const [i, name] of names.entries()) if (new RegExp("\\b" + name + "\\b").test(text)) classes.push(i + 2);
    return { classes: classes.length ? classes.slice(0, 8) : [0], partial: classes.length > 8 };
  } catch { return { classes: [0], unavailable: true }; }
}
const fixture = () => { const child = new EventEmitter(); child.pid = 123; child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = () => true; return child; };
const feed = (parts, options = {}) => { const rows = [], collector = installCollector({ emit: (r) => rows.push(r), ...options }); for (const p of parts) collector.push(2, p); return { rows, stats: collector.finish() }; };

test("offline failure context retains only fixed numeric Bun error families", () => {
  for (const [message, code] of [["lockfile had changes, but lockfile is frozen", 1], ["AccessDenied", 2], ["InvalidPackageJSON", 5]]) {
    const result = fixtureErrors(Buffer.from(`error: ${message}: ${secret}\n`)); assert.deepEqual(result.classes, [code]); assert(!JSON.stringify(result).includes(secret));
  }
  const many = fixtureErrors(Buffer.from("AccessDenied FileNotFound MissingPackageJSON InvalidPackageJSON InvalidLockfile LockfileResolveFailed IntegrityCheckFailed NotDir NameTooLong")); assert.equal(many.classes.length, 8); assert.equal(many.partial, true);
  const broken = Buffer.alloc(0); broken.toString = () => { throw new Error(secret); }; assert.equal(fixtureErrors(broken).unavailable, true);
  assert.deepEqual(fixtureErrors(Buffer.from(secret)).classes, [0]); assert.equal(fixtureErrors(Buffer.alloc(1024 * 1024 + 1)).unavailable, true);
  assert.equal(fixtureErrors({ toString() { throw new Error(secret); } }).unavailable, true);
});

test("only pinned finite markers survive, split chunks and ANSI are consumed before publication", () => {
  const input = `Cache Dir: ${secret}\nResolved peers [1.2ms]\nCreated store [2.1ms]\n[PackageManager] waiting for 4 tasks\nResolved, downloaded and extracted [4]\n${secret}\n`;
  const result = feed([...Buffer.from(input)].map((b) => Buffer.from([b])));
  assert.deepEqual(result.rows.map((r) => [r.stage, r.count]), [[4, null], [5, null], [6, 4], [3, 4]]);
  assert(!JSON.stringify(result).includes(secret));
  assert.deepEqual(installMarker("\x1b[32mCreated store [1.1ms]\x1b[0m"), { stage: 5, count: null });
  for (const line of [`Created store [1ms] ${secret}`, `Resolved peers [${secret}]`, "Resolved peers [1e20ms]", "[PackageManager] waiting for -1 tasks", "Created store [NaNms]"]) assert.equal(installMarker(line), null);
});

test("pinned compound duration markers retain slow peer/store completion with no duration payload", () => {
  const durations = ["0ns", "999ns", "1us", "999.9us", "1ms", "999.9ms", "1s", "59.9s", "1m", "1m5.2s", "2m400ms", "1h2m", "1d", "1w", "1y", "584y49w1d23h34m33.7s"];
  for (const duration of durations) for (const [prefix, stage] of [["Resolved peers", 4], ["Created store", 5]]) assert.deepEqual(installMarker(`${prefix} [${duration}]`), { stage, count: null });
  for (const duration of ["", "1m5sSECRET", "1s2m", "1m2m", "-1ms", "1e2ms", "1.5m", "1.22s", "999999999999999999999999999m", "1\u00b5s"]) assert.equal(installMarker(`Created store [${duration}]`), null);
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

test("actual missing executable closes with errno but exits shell-compatible127", async () => {
  const root = temporary("archive-missing-"), writer = memoryWriter();
  const result = await observeInstall({ cwd: root, env: process.env, host: host(), writer, spawnImpl: () => spawn(join(root, "absent-executable"), [], { stdio: ["ignore", "pipe", "pipe"] }) });
  assert.equal(result.error?.code, "ENOENT"); assert(result.code < 0); const target = {}; installExit(result, target); assert.equal(target.exitCode, 127); assert.equal(result.synopsis.code, null);
});

test("real EACCES close errno maps to126 on POSIX and preserves the error class", async () => {
  if (process.platform === "win32") {
    const child = fixture(), error = Object.assign(new Error(secret), { code: "EACCES" }), pending = observeInstall({ cwd: "/fixture", env: {}, writer: memoryWriter(), host: host(), spawnImpl: () => child }); child.stdout.end(); child.stderr.end(); child.emit("error", error); child.emit("close", -13, null);
    const result = await pending, target = {}; assert.equal(result.error, error); installExit(result, target); assert.equal(target.exitCode, 126); return;
  }
  const root = temporary("archive-denied-"), file = join(root, "not-executable"); writeFileSync(file, "owned nonexecutable fixture"); chmodSync(file, 0o600);
  const result = await observeInstall({ cwd: root, env: process.env, writer: memoryWriter(), host: host(), spawnImpl: () => spawn(file, [], { stdio: ["ignore", "pipe", "pipe"] }) }); assert.equal(result.error?.code, "EACCES"); assert(result.code < 0); const target = {}; installExit(result, target); assert.equal(target.exitCode, 126); assert.equal(result.synopsis.error, 2);
});

test("ignored terminal signals cannot report success or start an inspector", () => {
  for (const signal of ["SIGPIPE", "SIGUSR1"]) { const calls = [], target = { pid: 7, kill(...args) { calls.push(args); } }; installExit({ signal }, target);
    const n = constants.signals[signal]; assert.equal(target.exitCode, Number.isInteger(n) && n > 0 && n < 128 ? 128 + n : 1); assert.equal(calls.length, 0); }
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

test("real Node SIGPIPE handling cannot turn a terminal signal into success on POSIX", () => {
  if (process.platform === "win32") return;
  const root = temporary("archive-pipe-"), script = join(root, "pipe.mjs"), moduleURL = new URL("./install.mjs", import.meta.url).href;
  writeFileSync(script, `import {installExit} from ${JSON.stringify(moduleURL)};installExit({signal:'SIGPIPE'});`);
  const result = spawnSync(process.execPath, [script], { encoding: "buffer", maxBuffer: 1024 }); assert.equal(result.status, 128 + constants.signals.SIGPIPE); assert.equal(result.signal, null); assert.equal(result.stderr.length, 0);
});

test("actual pinned Bun offline workspace fixtures expose post-resolution verbose categories without changing lock", () => {
  const revision = spawnSync("bun", ["--revision"], { encoding: "utf8" }); assert.equal(revision.status, 0, "Installed Bun revision command must succeed"); assert(revision.stdout.trim() === "1.4.2+744846f84", "Fixture requires pinned Bun");
  const observed = [];
  for (const verbose of [false, true]) {
    const root = temporary("archive-offline-"); mkdirSync(join(root, "packages")); mkdirSync(join(root, "packages/local"));
    writeFileSync(join(root, "package.json"), JSON.stringify({ name: "archive-fixture", private: true, workspaces: ["packages/*"] })); writeFileSync(join(root, "packages/local/package.json"), JSON.stringify({ name: "archive-local", version: "1.0.0" }));
    const lock = JSON.stringify({ lockfileVersion: 3, configVersion: 1, workspaces: { "": { name: "archive-fixture" }, "packages/local": { name: "archive-local", version: "1.0.0" } }, packages: {} }); writeFileSync(join(root, "bun.lock"), lock);
    const result = spawnSync("bun", ["install", "--frozen-lockfile", "--ignore-scripts", "--offline", ...(verbose ? ["--verbose"] : [])], { cwd: root, encoding: "buffer", maxBuffer: 1024 * 1024 });
    const rows = [], collector = installCollector({ emit: (r) => rows.push(r) }); collector.push(1, result.stdout ?? Buffer.alloc(0)); collector.push(2, result.stderr ?? Buffer.alloc(0)); const coverage = collector.finish();
    const failure = { fixture: verbose ? 2 : 1, exit: Number.isSafeInteger(result.status) ? result.status : null,
      signal: ["SIGTERM", "SIGKILL", "SIGABRT", "SIGSEGV"].indexOf(result.signal) + 1,
      error: ["ENOENT", "EACCES", "ENOMEM", "ENOBUFS"].indexOf(result.error?.code) + 1,
      stdoutBytes: Math.min(result.stdout?.length ?? 0, 1_000_000_000), stderrBytes: Math.min(result.stderr?.length ?? 0, 1_000_000_000), bunErrors: fixtureErrors(result.stderr), stages: rows.map((r) => r.stage), coverage };
    assert.equal(result.status, 0, JSON.stringify(failure)); assert.equal(readFileSync(join(root, "bun.lock"), "utf8"), lock); assert(!coverage.partial, "Offline source markers must fit the finite collector"); observed.push(rows.map((r) => r.stage));
  }
  assert(!observed[0].includes(4) && !observed[0].includes(5), "Ordinary fixture has no verbose store timing markers"); assert(observed[1].includes(4) && observed[1].includes(5), "Pinned verbose fixture must expose peers/store categories");
});

test("workflow preserves archive requirements and adds verbosity only through the owned runner", () => {
  const source = readFileSync(new URL("../../.github/workflows/ios-archive.yml", import.meta.url), "utf8").replace(/\r\n/g, "\n"); assert(source.includes("- run: node scripts/ios-archive/install.mjs\n        timeout-minutes: 5")); assert(source.includes("bun-version: '1.4.2'")); assert(source.includes("node-version: '24.12.0'")); assert(source.includes("run: node scripts/ios-archive/run.mjs")); assert(!source.includes("continue-on-error"));
});
