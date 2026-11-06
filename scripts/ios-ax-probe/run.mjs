// Hosted macOS entry point for the AX query/tap probe. See docs/ios-ax-probe.md.
// Builds the owned fixture, creates one owned simulator, runs the fixed plan once,
// writes finite receipts to reports/ios-ax-probe/ and removes only what it created.
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { rpcClient } from "../ios-native/mcp.mjs";
import { BUDGET, DEVICES, FIXTURE, HOST, LIMITS, PLAN, STALL_CONTROLS, TOOL, correlateClock, countRunnerPatterns, deltaCounts,
  evaluateStage, fixtureWindow, parseFixtureEvents, publishableErrors } from "./protocol.mjs";
import { runProbeSession } from "./session.mjs";

const root = resolve(import.meta.dirname, "../..");
const fixtureSource = join(import.meta.dirname, "fixture");
const output = join(root, "reports/ios-ax-probe");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const hostMono = () => Number(process.hrtime.bigint()) / 1e9;

if (process.platform !== "darwin") throw new Error("The AX probe requires hosted macOS with Xcode and iOS simulators.");
if (existsSync(output)) throw new Error("Use a fresh checkout. Existing probe evidence was not overwritten.");
mkdirSync(output, { recursive: true });
const scratch = mkdtempSync(join(process.env.RUNNER_TEMP || tmpdir(), "ax-probe-"));
const state = join(scratch, "state"), work = join(scratch, "work"), build = join(scratch, "build");
for (const path of [state, work, build]) mkdirSync(path);

// Inputs outside the fixed choices are refused, and never copied into the receipt.
const device = DEVICES.find((name) => name === (process.env.AX_PROBE_DEVICE || DEVICES[0])) ?? null;
const stallMs = STALL_CONTROLS.find((value) => String(value) === (process.env.AX_PROBE_STALL_MS || "0")) ?? null;
const digits = (value) => (/^\d{1,20}$/.test(value ?? "") ? value : null);
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(PATH|HOME|USER|LOGNAME|SHELL|TMPDIR|JAVA_HOME|LANG|LC_ALL)$/.test(key)));
Object.assign(env, { DEVELOPER_DIR: HOST.developerDir, XDG_STATE_HOME: state, MAESTRO_CLI_NO_ANALYTICS: "true", MAESTRO_DISABLE_UPDATE_CHECK: "true",
  MAESTRO_CLI_ANALYSIS_NOTIFICATION_DISABLED: "true", MAESTRO_DRIVER_STARTUP_TIMEOUT: String(BUDGET.requestMs) });

const receipt = { schemaVersion: 1, kind: "ios-ax-probe", status: "running", startedAt: new Date().toISOString(),
  source: null, runId: digits(process.env.GITHUB_RUN_ID), runAttempt: digits(process.env.GITHUB_RUN_ATTEMPT),
  runnerImage: /^\d{1,8}(?:\.\d{1,8}){1,3}$/.test(process.env.ImageVersion ?? "") ? process.env.ImageVersion : null,
  architecture: process.arch === "arm64" ? "arm64" : "x86_64", device, stallControlMs: stallMs, budget: BUDGET, limits: LIMITS,
  host: {}, tool: {}, fixture: {}, simulator: {}, session: null, stages: [], runnerLog: null, clock: "unverified" };

function checkpoint() {
  const errors = publishableErrors(receipt);
  // A receipt that fails the privacy gate is replaced, never published.
  const value = errors.length ? { schemaVersion: 1, kind: "ios-ax-probe", status: "privacy-rejected", rejectedFields: errors.length } : receipt;
  writeFileSync(join(output, "receipt.json"), JSON.stringify(value, null, 2) + "\n");
  return errors.length === 0;
}
function journal(entry) { appendFileSync(join(output, "stage-events.jsonl"), JSON.stringify(entry) + "\n"); }

/** Captured output stays in memory; only parsed fixed fields reach the receipt. */
function run(executable, args, timeout = BUDGET.commandMs) {
  const result = spawnSync(executable, args, { cwd: work, env, encoding: "utf8", timeout, killSignal: "SIGKILL", maxBuffer: 16 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
  if (result.error || result.status !== 0 || result.signal) {
    // Compiler output contains only this checked-in fixture, not driver responses.
    // Keep a bounded diagnostic in CI so the first hosted build can be corrected.
    if (executable === "xcrun" && args.includes("swiftc")) {
      const diagnostic = (result.stderr ?? "").slice(0, 8192).split(scratch).join("<scratch>")
        .split(root).join("<source>").split(HOST.developerDir).join("<developer>");
      console.error(`Fixture compiler diagnostic (at most 8192 characters):\n${diagnostic}`);
    }
    throw new Error(`${executable} ${args[0] ?? ""} failed.`);
  }
  return result.stdout.trim();
}
const sim = (...args) => run("xcrun", ["simctl", ...args], args[0] === "bootstatus" ? BUDGET.bootMs : BUDGET.commandMs);
class Stop extends Error { constructor(status) { super(status); this.status = status; } }

function hostIdentity() {
  if (!existsSync(HOST.developerDir)) throw new Stop("unsupported-host");
  const version = /^Xcode (\d+\.\d+(?:\.\d+)?)\nBuild version ([0-9A-Za-z]+)$/m.exec(run("xcodebuild", ["-version"]));
  const sdk = run("xcrun", ["--sdk", "iphonesimulator", "--show-sdk-version"]);
  const runtime = JSON.parse(sim("list", "runtimes", "--json")).runtimes?.find((item) => item.identifier === HOST.runtime);
  receipt.host = { developerDir: HOST.developerDir, xcodeVersion: version?.[1] ?? null, xcodeBuild: /^\d{1,2}[A-Z]\d{1,5}[a-z]?$/.test(version?.[2] ?? "") ? version[2] : null,
    simulatorSdk: /^\d+(?:\.\d+){0,2}$/.test(sdk) ? sdk : null, runtime: HOST.runtime, runtimeAvailable: runtime?.isAvailable === true,
    runtimeVersion: /^\d+(?:\.\d+){0,2}$/.test(runtime?.version ?? "") ? runtime.version : null,
    runtimeBuild: /^\d{1,2}[A-Z]\d{1,5}[a-z]?$/.test(runtime?.buildversion ?? "") ? runtime.buildversion : null };
  // No fallback to another Xcode or runtime: the probe must match native qualification's host.
  const runtimeMatches = receipt.host.runtimeVersion === HOST.runtimeVersion || receipt.host.runtimeVersion?.startsWith(`${HOST.runtimeVersion}.`);
  if (receipt.host.xcodeVersion !== HOST.xcodeVersion || !receipt.host.runtimeAvailable || !runtimeMatches) throw new Stop("unsupported-host");
}

function toolIdentity() {
  const home = process.env.AX_PROBE_MAESTRO_HOME, zip = process.env.AX_PROBE_MAESTRO_ZIP;
  const hashFile = (path) => (path && existsSync(path) && lstatSync(path).isFile() ? sha256(readFileSync(path)) : null);
  const zipSha256 = hashFile(zip);
  receipt.tool = { maestroVersion: TOOL.maestroVersion, zipSha256, zip: zipSha256 === TOOL.zipSha256 ? "match" : "mismatch",
    jars: TOOL.jars.map((jar) => { const actual = hashFile(home && join(home, jar.member)); return { member: jar.member, sha256: actual, retained: actual === jar.sha256 ? "match" : "mismatch" }; }) };
  if (receipt.tool.zip !== "match" || receipt.tool.jars.some((jar) => jar.retained !== "match")) throw new Stop("tool-identity-mismatch");
}

function buildFixture() {
  const swift = join(fixtureSource, "AXProbeFixture.swift"), plist = join(fixtureSource, "Info.plist");
  receipt.fixture = { bundleId: FIXTURE.bundleId, sourceSha256: sha256(readFileSync(swift)), infoPlistSha256: sha256(readFileSync(plist)),
    deploymentTarget: HOST.deploymentTarget, executableSha256: null };
  const app = join(build, `${FIXTURE.executable}.app`); mkdirSync(app);
  try {
    run("plutil", ["-lint", plist]);
    run("xcrun", ["--sdk", "iphonesimulator", "swiftc", "-swift-version", "5", "-target", `${receipt.architecture}-apple-ios${HOST.deploymentTarget}-simulator`,
      "-module-name", FIXTURE.executable, "-parse-as-library", "-Onone", "-o", join(app, FIXTURE.executable), swift], BUDGET.buildMs);
    copyFileSync(plist, join(app, "Info.plist"));
    run("codesign", ["--force", "--sign", "-", "--timestamp=none", app]);
  } catch { throw new Stop("fixture-build-failed"); }
  receipt.fixture.executableSha256 = sha256(readFileSync(join(app, FIXTURE.executable)));
  return app;
}

let owned = null, container = null;
const reads = [];
function readFixture() {
  if (!container) return { state: "unavailable", events: [], invalidLines: 0 };
  const path = join(container, "Documents", FIXTURE.eventsFile);
  try {
    if (!lstatSync(path).isFile() || lstatSync(path).size > BUDGET.eventsBytes) return { state: "unavailable", events: [], invalidLines: 0 };
    const parsed = parseFixtureEvents(readFileSync(path, "utf8"));
    reads.push({ hostMono: hostMono(), wallMs: Date.now(), latest: parsed.events.at(-1) ?? null });
    return parsed;
  } catch { return { state: "unavailable", events: [], invalidLines: 0 }; }
}

/** Only this probe's isolated Maestro state; regular files, no links, bounded bytes. */
function readRunnerLogs() {
  const tests = join(state, "maestro", "tests");
  try {
    if (!lstatSync(tests).isDirectory()) return { state: "unavailable" };
    let text = "", files = 0;
    for (const folder of readdirSync(tests, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort()) {
      for (const name of readdirSync(join(tests, folder)).filter((item) => /^xctest_runner_[0-9_-]+\.log$/.test(item)).sort()) {
        const path = join(tests, folder, name), stat = lstatSync(path);
        if (!stat.isFile() || stat.isSymbolicLink()) continue;
        if (++files > BUDGET.runnerLogFiles || Buffer.byteLength(text) + stat.size > BUDGET.runnerLogBytes) return { state: "truncated", files };
        text += readFileSync(path, "utf8") + "\n";
      }
    }
    return files ? { state: "read", files, ...countRunnerPatterns(text) } : { state: "unavailable" };
  } catch { return { state: "unavailable" }; }
}

async function waitForFixture() {
  const until = Date.now() + BUDGET.fixtureReadyMs;
  while (Date.now() < until) {
    if (readFixture().events.some((event) => event.k === "appeared")) return;
    await delay(250);
  }
  throw new Stop("fixture-not-ready");
}

async function main() {
  try {
    if (device === null || stallMs === null) throw new Stop("setup-failed");
    receipt.source = run("git", ["-C", root, "rev-parse", "HEAD"]);
    if (!/^[0-9a-f]{40}$/.test(receipt.source)) throw new Stop("setup-failed");
    hostIdentity(); checkpoint();
    toolIdentity(); checkpoint();
    const app = buildFixture(); checkpoint();
    const type = JSON.parse(sim("list", "devicetypes", "--json")).devicetypes?.find((item) => item.name === device);
    if (!type) throw new Stop("unsupported-host");
    owned = sim("create", `AXProbe-${process.pid}`, type.identifier, HOST.runtime);
    if (!/^[0-9A-F]{8}-(?:[0-9A-F]{4}-){3}[0-9A-F]{12}$/.test(owned)) throw new Stop("setup-failed");
    receipt.simulator = { udid: owned, deviceType: type.identifier, runtime: HOST.runtime, fixturePid: null };
    sim("boot", owned); sim("bootstatus", owned, "-b");
    sim("install", owned, app);
    container = sim("get_app_container", owned, FIXTURE.bundleId, "data");
    const launch = { monoBefore: hostMono(), wallBeforeMs: Date.now() };
    const launched = sim("launch", owned, FIXTURE.bundleId, "-probeStallMs", String(stallMs));
    Object.assign(launch, { monoAfter: hostMono(), wallAfterMs: Date.now() });
    receipt.simulator.fixturePid = Number(/^dev\.hemsoft\.axprobe\.fixture: (\d{1,9})$/.exec(launched)?.[1] ?? NaN) || null;
    await waitForFixture(); checkpoint();

    let previousLog = readRunnerLogs();
    const result = await runProbeSession({ device: owned, journal, hostMono,
      openTransport: ({ deadline }) => {
        const child = spawn("maestro", ["mcp", "--no-viewer", "--working-dir", work], { cwd: work, env, stdio: ["pipe", "pipe", "pipe"] });
        // Driver stderr can hold arbitrary text; only its size is kept.
        let stderrBytes = 0; child.stderr.on("data", (chunk) => { stderrBytes += chunk.length; receipt.mcpStderrBytes = stderrBytes; });
        return rpcClient(child, { timeoutMs: BUDGET.requestMs, maxBytes: BUDGET.responseBytes, deadline });
      },
      observe: async () => {
        const log = readRunnerLogs(), fixture = readFixture();
        const observation = { runnerLog: deltaCounts(previousLog, log), fixtureEvents: fixture.state, fixtureEventCount: fixture.events.length };
        previousLog = log;
        return observation;
      } });
    receipt.session = result.session;
    receipt.stages = result.stages;
    receipt.status = result.status;

    // Final read: windows come from the complete fixture log, after every request ended.
    const final = readFixture(), log = readRunnerLogs();
    receipt.clock = correlateClock({ launch, launchEvent: final.events.find((event) => event.k === "launch"), reads });
    receipt.fixture.events = { state: final.state, count: final.events.length, invalidLines: final.invalidLines,
      launchPidMatches: final.events.find((event) => event.k === "launch")?.pid === receipt.simulator.fixturePid };
    receipt.runnerLog = log.state === "read" ? { state: "read", files: log.files, counts: log.counts, ipcTimeoutPids: log.ipcTimeoutPids,
      ipcTimeoutPidIsFixture: log.ipcTimeoutPids.length ? log.ipcTimeoutPids.includes(receipt.simulator.fixturePid) : null } : { state: log.state };
    for (const record of receipt.stages) {
      const stage = PLAN.find((item) => item.id === record.id);
      if (record.outcome === "not-run") { record.evaluation = { request: false, fixtureAck: null, met: false }; continue; }
      record.fixture = final.state === "unavailable" ? { state: "unavailable" } : fixtureWindow(final.events, receipt.clock, record, stage.fixtureAck ?? []);
      record.evaluation = evaluateStage(stage, record, record.fixture);
    }
  } catch (error) {
    receipt.status = error instanceof Stop ? error.status : "setup-failed";
  } finally {
    receipt.finishedAt = new Date().toISOString();
    // Only the simulator this process created is shut down and deleted.
    if (owned) {
      for (const args of [["terminate", owned, FIXTURE.bundleId], ["shutdown", owned], ["delete", owned]]) {
        spawnSync("xcrun", ["simctl", ...args], { env, stdio: "ignore", timeout: BUDGET.shutdownMs, killSignal: "SIGKILL" });
      }
      try { receipt.simulator.deleted = !run("xcrun", ["simctl", "list", "devices"]).includes(owned); } catch { receipt.simulator.deleted = null; }
    }
    if (!checkpoint()) receipt.status = "privacy-rejected";
    rmSync(scratch, { recursive: true, force: true });
  }
  const passed = receipt.status === "completed" && receipt.stages.length === PLAN.length && receipt.stages.every((stage) => stage.evaluation?.met === true);
  console.log(`AX probe ${receipt.status}; stages met ${receipt.stages.filter((stage) => stage.evaluation?.met === true).length}/${PLAN.length}.`);
  process.exitCode = passed ? 0 : 1;
}

await main();
