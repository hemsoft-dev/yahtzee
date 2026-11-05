import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { redactDriverLog, retainDriverLogs } from "./driverLogs.mjs";

test("driver evidence redacts credential environment values and authorization headers", () => {
  assert.equal(redactDriverLog("tap at 20,40 synthetic-secret-value Authorization: Bearer synthetic-token", { RUNTIME_TOKEN: "synthetic-secret-value", ORDINARY: "tap at" }),
    "tap at 20,40 <REDACTED> Authorization: Bearer <REDACTED>");
});
test("only known driver logs become non-hidden uploaded evidence", () => {
  const directory = mkdtempSync(join(tmpdir(), "native-driver-log-"));
  try {
    retainDriverLogs(directory, directory, "start", {});
    const source = join(directory, ".maestro/tests/run"); mkdirSync(source, { recursive: true });
    writeFileSync(join(source, "maestro.log"), "target score-ones");
    writeFileSync(join(source, "unrelated.json"), "not evidence");
    retainDriverLogs(directory, directory, "start", {});
    assert.equal(readFileSync(join(directory, "start-driver-0.log"), "utf8"), "target score-ones");
    assert.deepEqual(readdirSync(directory).sort(), [".maestro", "start-driver-0.log"]);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("isolated XCTest logs retain bounded redacted complete lines and exclude other files", async () => {
  const { retainXCTestLogs } = await import("./driverLogs.mjs");
  const directory = mkdtempSync(join(tmpdir(), "native-xctest-log-"));
  try {
    const state = join(directory, ".state"), source = join(state, "maestro/tests/session");
    mkdirSync(source, { recursive: true });
    writeFileSync(join(source, "unrelated.json"), "unrelated secret");
    const secret = "synthetic-runtime-secret";
    writeFileSync(join(source, "xctest_runner_2026-10-29_123456.log"), "x".repeat(600000) + `\nXCTest started ${secret}\nAuthorization: Bearer fixture-bearer\npartial ${secret.slice(0, 10)}`);
    const retained = retainXCTestLogs(state, directory, "scenario", { RUNTIME_TOKEN: secret });
    assert.deepEqual(retained, ["scenario-xctest-0.log"]);
    const text = readFileSync(join(directory, retained[0]), "utf8");
    assert(text.endsWith("XCTest started <REDACTED>\nAuthorization: Bearer <REDACTED>\n"));
    assert.equal(text.split("\n").filter((line) => line.startsWith("[XCTest middle omitted;")).length, 1);
    assert(!text.includes(secret)); assert(!text.includes("unrelated"));
    assert.deepEqual(retainXCTestLogs(join(directory, "missing"), directory, "scenario", {}), []);
  } finally { rmSync(directory, { recursive: true }); }
});
test("the XCTest log bound still holds when redaction lengthens the retained text", async () => {
  const { retainXCTestLogs } = await import("./driverLogs.mjs");
  const directory = mkdtempSync(join(tmpdir(), "native-xctest-bound-"));
  try {
    const state = join(directory, ".state"), source = join(state, "maestro/tests/session");
    mkdirSync(source, { recursive: true });
    const secret = "abcdefgh";
    writeFileSync(join(source, "xctest_runner_2026-11-02_123456.log"), `${secret}\n`.repeat(100000));
    const [name] = retainXCTestLogs(state, directory, "scenario", { RUNTIME_TOKEN: secret });
    const text = readFileSync(join(directory, name), "utf8");
    assert(Buffer.byteLength(text) <= 512 * 1024);
    assert(Buffer.byteLength(text) > 500 * 1024);
    assert.equal(new Set(text.slice(0, -1).split("\n").filter((line) => !line.startsWith("[XCTest middle omitted;"))).size, 1);
    assert(text.startsWith("<REDACTED>\n") && text.endsWith("<REDACTED>\n"));
    assert(!text.includes(secret));
  } finally { rmSync(directory, { recursive: true }); }
});

test("small complete logs are not duplicated and partial credential lines are excluded", async () => {
  const { retainXCTestLogs } = await import("./driverLogs.mjs");
  const directory = mkdtempSync(join(tmpdir(), "native-xctest-small-"));
  try {
    const state = join(directory, ".state"), source = join(state, "maestro/tests/session"); mkdirSync(source, { recursive: true });
    const file = join(source, "xctest_runner_123.log");
    writeFileSync(file, "original control\nend\nAuthorization: Bearer unfinished");
    const [name] = retainXCTestLogs(state, directory, "scenario", {});
    assert.equal(readFileSync(join(directory, name), "utf8"), "original control\nend\n");
    const coverage = JSON.parse(readFileSync(join(directory, name + ".coverage.json")));
    assert.equal(coverage.windows.length, 1); assert.equal(coverage.continuous, false);
    writeFileSync(file, "original control\nend\n"); retainXCTestLogs(state, directory, "scenario", {});
    assert.equal(JSON.parse(readFileSync(join(directory, name + ".coverage.json"))).continuous, true);
  } finally { rmSync(directory, { recursive: true }); }
});

test("only eight source logs from the explicit state are retained; links and traversal are denied", async () => {
  const { retainXCTestLogs } = await import("./driverLogs.mjs");
  const directory = mkdtempSync(join(tmpdir(), "native-xctest-exclusions-"));
  try {
    const state = join(directory, ".state"), source = join(state, "maestro/tests/session"); mkdirSync(source, { recursive: true });
    const other = join(directory, "other-session"); mkdirSync(other); writeFileSync(join(other, "xctest_runner_999.log"), "private other session\n");
    symlinkSync(other, join(state, "maestro/tests/linked"), "junction");
    for (let i = 0; i < 10; i++) writeFileSync(join(source, `xctest_runner_${i}.log`), `control ${i}\n`);
    const names = retainXCTestLogs(state, directory, "scenario", {}); assert.equal(names.length, 8);
    assert(names.every((name) => !readFileSync(join(directory, name), "utf8").includes("private")));
    assert.throws(() => retainXCTestLogs(state, directory, "../outside", {}));
    assert.deepEqual(retainXCTestLogs(join(state, "maestro/tests/linked"), directory, "scenario", {}), []);
  } finally { rmSync(directory, { recursive: true }); }
});

test("oversized XCTest evidence keeps the original control and the end with an explicit middle gap", async () => {
  const { retainXCTestLogs } = await import("./driverLogs.mjs");
  const directory = mkdtempSync(join(tmpdir(), "native-xctest-windows-"));
  try {
    const state = join(directory, ".state"), source = join(state, "maestro/tests/session");
    mkdirSync(source, { recursive: true });
    writeFileSync(join(source, "xctest_runner_2026-11-04_123456.log"), "Original Help control\n" + "middle line\n".repeat(100000) + "Screenshot timeout\n");
    const [name] = retainXCTestLogs(state, directory, "scenario", {});
    const text = readFileSync(join(directory, name), "utf8");
    assert(text.startsWith("Original Help control\n"));
    assert(text.endsWith("Screenshot timeout\n"));
    assert(Buffer.byteLength(text) <= 512 * 1024);
    const coverage = JSON.parse(readFileSync(join(directory, name + ".coverage.json")));
    assert.equal(coverage.continuous, false);
    assert.equal(coverage.windows.length, 2);
    assert(coverage.windows[0].sourceEnd < coverage.windows[1].sourceStart);
    assert(coverage.omittedBytes > 0);
  } finally { rmSync(directory, { recursive: true }); }
});
