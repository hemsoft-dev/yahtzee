import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
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
    assert.equal(text, "XCTest started <REDACTED>\nAuthorization: Bearer <REDACTED>\n");
    assert(!text.includes(secret)); assert(!text.includes("unrelated"));
    assert.deepEqual(retainXCTestLogs(join(directory, "missing"), directory, "scenario", {}), []);
  } finally { rmSync(directory, { recursive: true }); }
});
