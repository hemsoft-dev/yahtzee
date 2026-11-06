import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { loadBuiltSimulator } from "./artifact.mjs";
import { DRIVER_REF, patchDriver, sha } from "./ax-request/patch.mjs";
import { compilerSummary, parseStages, requestCapability } from "./ax-request/parse.mjs";

assert.equal(process.platform, "darwin", "AX request qualification requires the pinned hosted macOS toolchain.");
assert.equal(process.arch, "arm64");
assert.equal(process.argv.length, 2, "This diagnostic accepts no alternate target or timing options.");
const root = resolve(import.meta.dirname, "../.."), output = join(root, "reports/ax-request-evidence");
const privateRoot = join(root, "reports/.ax-request-private"), source = join(root, "reports/ax-driver-source/maestro-ios-xctest-runner");
assert(!existsSync(output) && !existsSync(privateRoot), "Existing diagnostic evidence is never overwritten.");
mkdirSync(output, { recursive: true }); mkdirSync(privateRoot);
const env = { ...process.env, DEVELOPER_DIR: "/Applications/Xcode_26.6.app/Contents/Developer" };
const receipt = { schemaVersion: 1, kind: "qualification-copy-deviceInfo-AX-request", status: "running",
  source: null, driverSource: DRIVER_REF, runId: process.env.GITHUB_RUN_ID ?? null, runAttempt: process.env.GITHUB_RUN_ATTEMPT ?? null,
  requestMode: "actual-handler-direct-invocation-not-HTTP-wire", limits: ["standalone-capability-not-ordinary-matrix-acceptance",
    "private-query-internals-unobserved", "unknown-process-role-remains-unknown", "no-historical-cause-or-cure-claim"] };
let device;
const json = (name, value) => writeFileSync(join(output, name), JSON.stringify(value, null, 2) + "\n");
const phase = (value) => { receipt.phase = value; json("receipt.json", receipt); };
function command(executable, args, { cwd = root, capture = false, timeout = 180000, log = "commands.private" } = {}) {
  const fd = openSync(join(privateRoot, log), "a"); let result;
  try { result = spawnSync(executable, args, { cwd, env, encoding: "utf8", timeout, maxBuffer: 16 * 1024 * 1024,
    stdio: ["ignore", capture ? "pipe" : fd, fd] }); } finally { closeSync(fd); }
  assert.equal(result.error, undefined, `Owned command did not complete: ${executable}`);
  assert.equal(result.status, 0, `Owned command failed: ${executable}; private log retained locally, no payload dump.`);
  return capture ? result.stdout.trim() : "";
}
const sim = (...args) => command("xcrun", ["simctl", ...args], { capture: true, timeout: 600000 });
try {
  phase(1);
  receipt.source = command("git", ["rev-parse", "HEAD"], { capture: true });
  receipt.bunLockSha256 = sha(readFileSync(join(root, "bun.lock")));
  assert.equal(command("git", ["rev-parse", "HEAD"], { cwd: source, capture: true }), DRIVER_REF);
  assert.equal(command("git", ["status", "--porcelain"], { cwd: source, capture: true }), "");
  receipt.toolchain = { xcode: command("xcodebuild", ["-version"], { capture: true }), sdk: command("xcrun", ["--sdk", "iphonesimulator", "--show-sdk-version"], { capture: true }) };
  assert.equal(receipt.toolchain.xcode, "Xcode 26.6\nBuild version 17F113"); assert.equal(receipt.toolchain.sdk, "26.5");
  phase(2); receipt.patch = patchDriver(source); json("receipt.json", receipt);
  phase(3);
  const app = loadBuiltSimulator({ root, run: command, hash: sha, receipt, architecture: "arm64" });
  const types = JSON.parse(sim("list", "devicetypes", "--json")).devicetypes;
  const type = types.find((x) => x.name === "iPhone 17"); assert(type, "Expected pinned phone6 type.");
  phase(4); device = sim("create", `Dice-AX-request-${process.pid}`, type.identifier, "com.apple.CoreSimulator.SimRuntime.iOS-26-5");
  sim("boot", device); sim("bootstatus", device, "-b"); sim("install", device, app.app);
  const project = join(source, "maestro-driver-ios.xcodeproj"), derived = join(privateRoot, "derived");
  const common = ["-project", project, "-scheme", "maestro-driver-ios", "-configuration", "Debug", "-destination", `platform=iOS Simulator,id=${device}`,
    "-derivedDataPath", derived, "-onlyUsePackageVersionsFromResolvedFile", "CODE_SIGNING_ALLOWED=NO"];
  phase(5); command("xcodebuild", [...common, "build-for-testing"], { timeout: 2400000, log: "build.private" });
  const resolution = join(source, "maestro-driver-ios.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved");
  assert.equal(sha(readFileSync(resolution)), "0769349aecc7f83fb2729fba68c9583c3a51b324a0225485865dc064ccab48b4", "Pinned FlyingFox resolution must not drift.");
  assert.deepEqual(command("git", ["diff", "--name-only"], { cwd: source, capture: true }).split("\n").sort(),
    receipt.patch.files.map((f) => `maestro-ios-xctest-runner/maestro-driver-iosUITests/${f.path}`).sort());
  phase(6); const products = join(derived, "Build/Products"), plans = readdirSync(products).filter((n) => n.endsWith(".xctestrun")); assert.equal(plans.length, 1);
  const binary = join(products, "Debug-iphonesimulator/maestro-driver-iosUITests-Runner.app/PlugIns/maestro-driver-iosUITests.xctest/maestro-driver-iosUITests");
  receipt.driverBuild = { executableSha256: sha(readFileSync(binary)), xctestrunSha256: sha(readFileSync(join(products, plans[0]))),
    plannedTestClass: "HSAXRequestQualificationTests", executedImage: "planned-product-hash-not-loaded-image-attestation" };
  json("receipt.json", receipt);
  try {
    phase(7);
    command("xcodebuild", ["test-without-building", "-xctestrun", join(products, plans[0]), "-destination", `platform=iOS Simulator,id=${device}`,
      "-only-testing:maestro-driver-iosUITests/HSAXRequestQualificationTests", "-resultBundlePath", join(privateRoot, "result.xcresult")],
    { timeout: 1800000, log: "test.private" });
    receipt.testExecution = "passed";
  } finally {
    const log = readFileSync(join(privateRoot, "test.private"), "utf8"); assert(Buffer.byteLength(log) <= 16 * 1024 * 1024);
    const parsed = parseStages(log); receipt.observation = { ...parsed, events: undefined }; receipt.capability = requestCapability(parsed);
    receipt.controls = /HSAXRequestQualificationTests test00ForwardOnceControls[^\n]*passed/.test(log);
    receipt.actualRequestTest = /HSAXRequestQualificationTests test10ActualDeviceInfoRequest[^\n]*passed/.test(log);
    writeFileSync(join(output, "request-stages.jsonl"), parsed.events.map((e) => JSON.stringify(e)).join("\n") + "\n");
  }
  phase(8); assert(receipt.controls && receipt.actualRequestTest, "Both actual XCTest controls must pass; zero tests cannot qualify.");
  assert.equal(receipt.capability.status, "observed", "Positive actual-app AX query/response stages are required.");
  receipt.status = "passed"; phase(9);
} catch {
  const buildLog = join(privateRoot, "build.private");
  if (receipt.phase === 5 && existsSync(buildLog)) {
    const bytes = readFileSync(buildLog);
    receipt.compiler = bytes.length <= 16 * 1024 * 1024 ? compilerSummary(bytes.toString("utf8")) : { unavailable: "build-log-bound" };
  }
  receipt.status = "failed"; receipt.failure = "owned-build-test-or-positive-stage-gate-failed"; process.exitCode = 1;
} finally {
  json("receipt.json", receipt);
  if (device) {
    // Only this fresh owned device. Cleanup cannot replace the diagnostic result.
    try { sim("shutdown", device); } catch { receipt.cleanup = "shutdown-unavailable"; }
    try { sim("delete", device); } catch { receipt.cleanup = "delete-unavailable"; }
  }
  receipt.artifacts = readdirSync(output).filter((n) => n !== "receipt.json").map((path) => { const bytes = readFileSync(join(output, path)); return { path, bytes: bytes.length, sha256: sha(bytes) }; });
  json("receipt.json", receipt);
  console.log(JSON.stringify({ status: receipt.status, capability: receipt.capability?.status ?? "unavailable" }));
}
