import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { BUDGET, FIXTURE, IDS, LIMITS, PLAN, TEXT, TOOL, boundaryOf, classifyToolError, correlateClock, countRunnerPatterns, deltaCounts,
  evaluateStage, fixtureWindow, flowYaml, hierarchyPredicates, interpret, parseFixtureEvents, publishableErrors, stageArguments, summarizeJournal } from "./protocol.mjs";

const HISTORICAL_IPC = "Failed to run flow: Device became unreachable during deviceInfo. XCTest: Failed to get list of active applications: Accessibility error kAXErrorIPCTimeout from AXUIElementCopyMultipleAttributeValues for 1102";
const tree = (...nodes) => ({ ui_schema: {}, elements: [{ cls: "Application", c: nodes }] });

test("the plan is finite, ordered, unique and sends one command per run request", () => {
  assert(PLAN.length <= BUDGET.stages);
  assert.deepEqual(PLAN.map((stage) => stage.id), ["S01", "S02", "S03", "S04", "S05", "S06", "S07", "S08", "S09"]);
  assert(Object.isFrozen(PLAN) && PLAN.every((stage) => Object.isFrozen(stage)));
  for (const stage of PLAN.filter((item) => item.tool === "run")) {
    const yaml = flowYaml(stage);
    assert(yaml.startsWith(`appId: ${JSON.stringify(FIXTURE.bundleId)}\n---\n`));
    assert.equal(yaml.split("\n").filter((line) => line.startsWith("- ")).length, 1);
    assert.deepEqual(JSON.parse(yaml.split("\n")[2].slice(`- ${stage.command}: `.length)), stage.value);
  }
  // Taps never ask Maestro to tap again when the screen does not change.
  assert(PLAN.filter((stage) => stage.command === "tapOn").every((stage) => stage.value.retryTapIfNoChange === false && stage.fixtureAck.length));
  assert(!PLAN.some((stage) => ["launchApp", "clearState", "stopApp"].includes(stage.command)), "The probe never relaunches or clears the fixture.");
});

test("invocation arguments are exact bytes derived from the plan", () => {
  const stage = PLAN.find((item) => item.id === "S06");
  assert.deepEqual(stageArguments(stage, "UDID"), { device_id: "UDID", yaml: `appId: "dev.hemsoft.axprobe.fixture"\n---\n- assertVisible: {"text":"Current: Solo"}\n` });
  assert.deepEqual(stageArguments(PLAN[0], "UDID"), { device_id: "UDID" });
  assert.throws(() => flowYaml(PLAN[0]));
});

test("hierarchy predicates are exact-match counts and keep no text", () => {
  const secret = "token-ghp_abcdefghijklmnop";
  const result = hierarchyPredicates(tree({ txt: TEXT.intro, rid: IDS.intro }, { txt: TEXT.open }, { a11y: TEXT.current }, { txt: `${TEXT.duo} ` }, { txt: secret }));
  assert.equal(result.state, "parsed");
  assert.deepEqual(result.counts, { intro: 1, open: 1, current: 1, duo: 0, ack: 0 });
  assert(!JSON.stringify(result).includes(secret));
  assert.equal(hierarchyPredicates({ nothing: true }).state, "unparseable");
  const wide = tree(...Array.from({ length: 50 }, () => ({ txt: "x" })));
  assert.equal(hierarchyPredicates(wide, 10).state, "truncated");
});

test("tool errors become finite classes: original assertion failure, AX query failure, transport", () => {
  const assertion = classifyToolError("Failed to run flow: Assertion is false: \"Current: Solo\" is visible");
  assert.equal(assertion.errorClass, "assertion-false");
  const ipc = classifyToolError(HISTORICAL_IPC);
  assert.equal(ipc.errorClass, "ax-query-failure");
  assert.equal(ipc.unreachableOperation, "deviceInfo");
  assert.equal(ipc.patterns.axIpcTimeout && ipc.patterns.activeAppsFailed && ipc.patterns.deviceUnreachable, true);
  assert.equal(classifyToolError("Device became unreachable during isScreenStatic").errorClass, "device-unreachable");
  assert.equal(classifyToolError("Device became unreachable during somethingNew").unreachableOperation, "other");
  assert.equal(classifyToolError("Element not found: Id matching regex: probe.open").errorClass, "element-not-found");
  assert.equal(classifyToolError("anything else").errorClass, "other-tool-error");
  for (const value of [assertion, ipc]) assert(!JSON.stringify(value).includes("Solo") && !JSON.stringify(value).includes("1102"));
});

test("interpret separates a positive query, an unsuccessful command and an unavailable response", () => {
  const [inspect, , assertStage] = PLAN;
  const positive = interpret(inspect, { content: [{ type: "text", text: JSON.stringify(tree({ txt: TEXT.intro })) }] });
  assert.equal(boundaryOf(positive), "query-returned");
  assert.equal(evaluateStage(inspect, positive).met, true);
  const missing = interpret(inspect, { content: [{ type: "text", text: JSON.stringify(tree({ txt: "Other" })) }] });
  assert.equal(boundaryOf(missing), "query-returned");
  assert.equal(evaluateStage(inspect, missing).met, false, "A returned query whose predicate is false is a finding, not a pass.");
  assert.equal(boundaryOf(interpret(inspect, { content: [{ type: "text", text: "not json" }] })), "response-unavailable");
  assert.equal(boundaryOf(interpret(inspect, { content: [] })), "response-unavailable");
  const failed = interpret(assertStage, { isError: true, content: [{ type: "text", text: "Assertion is false: x" }] });
  assert.equal(boundaryOf(failed), "app-assertion-failed");
  assert.equal(boundaryOf(interpret(assertStage, { isError: true, content: [{ type: "text", text: HISTORICAL_IPC }] })), "driver-query-error");
  assert.equal(boundaryOf(interpret(assertStage, { content: [{ type: "text", text: JSON.stringify({ success: false }) }] })), "command-returned-unsuccessful");
  assert.equal(boundaryOf({ outcome: "request-timeout" }), "no-response");
  assert.equal(boundaryOf({ outcome: "not-run" }), "not-run");
  const huge = interpret(inspect, { content: [{ type: "text", text: "x".repeat(32) }] }, 16);
  assert.equal(huge.response, "unparseable");
});

test("a tap counts only with its fixture acknowledgment; a missing log is unknown, not success", () => {
  const stage = PLAN.find((item) => item.id === "S04");
  const returned = { outcome: "returned", response: "parsed", runSuccess: true };
  assert.equal(evaluateStage(stage, returned, { acks: { "open-pressed": { seen: true }, "sheet-presented": { seen: true } } }).met, true);
  assert.equal(evaluateStage(stage, returned, { acks: { "open-pressed": { seen: true }, "sheet-presented": { seen: false } } }).met, false);
  assert.equal(evaluateStage(stage, returned, { state: "unavailable" }).met, null);
  assert.equal(evaluateStage(stage, { outcome: "request-timeout" }, { state: "unavailable" }).met, false);
});

test("fixture events parse strictly and windows separate callback, heartbeat and request bounds", () => {
  const lines = [
    { k: "launch", t: 100, w: 1e9, pid: 7 }, { k: "hb", t: 101, w: 1e9 + 1, n: 10, g: 110 },
    { k: "open-pressed", t: 102.2, w: 1e9 + 2.2 }, { k: "stall", t: 103.5, w: 1e9 + 3.5, g: 900 },
    { k: "sheet-presented", t: 104.5, w: 1e9 + 4.5 }, { k: "hb", t: 105, w: 1e9 + 5, n: 10, g: 900 },
  ].map((value) => JSON.stringify(value));
  const text = [...lines, "{\"k\":\"note\",\"t\":1,\"w\":1}", "{\"k\":\"hb\",\"t\":1,\"w\":1,\"text\":\"secret\"}", "not json", "{\"k\":\"hb\""].join("\n");
  const parsed = parseFixtureEvents(text);
  assert.equal(parsed.events.length, 6);
  assert.equal(parsed.invalidLines, 3, "Unknown kinds, extra keys and broken lines are counted; the unterminated tail is ignored.");
  assert(!JSON.stringify(parsed).includes("secret"));
  const record = { hostMonoStart: 102, hostMonoEnd: 104, wallStartMs: (1e9 + 2) * 1000, wallEndMs: (1e9 + 4) * 1000 };
  const window = fixtureWindow(parsed.events, "monotonic-verified", record, ["open-pressed", "sheet-presented"]);
  assert.deepEqual(window.acks["open-pressed"], { seen: true, offsetMs: 200, withinRequest: true });
  assert.deepEqual(window.acks["sheet-presented"], { seen: true, offsetMs: 2500, withinRequest: false });
  assert.equal(window.heartbeat.maxGapMs, 900);
  assert.equal(window.heartbeat.aliveAfter, true);
  assert.equal(fixtureWindow(parsed.events, "wall-verified", record, ["open-pressed"]).acks["open-pressed"].offsetMs, 200);
  const loose = fixtureWindow(parsed.events, "unverified", record, ["open-pressed"]);
  assert.equal(loose.state, "unwindowed");
  assert.equal(loose.acks["open-pressed"].offsetMs, null);
  assert.equal(parseFixtureEvents("x".repeat(BUDGET.eventsBytes + 1)).state, "unavailable");
});

test("clock correlation is verified only when launch and reads agree", () => {
  const launch = { monoBefore: 100, monoAfter: 101, wallBeforeMs: 5e11, wallAfterMs: 5e11 + 1000 };
  const launchEvent = { t: 101.5, w: 5e8 + 1.5 };
  assert.equal(correlateClock({ launch, launchEvent, reads: [{ hostMono: 110, wallMs: 5e11 + 10000, latest: { t: 109, w: 5e8 + 9 } }] }), "monotonic-verified");
  assert.equal(correlateClock({ launch, launchEvent: { t: 9000, w: 5e8 + 1.5 }, reads: [] }), "wall-verified");
  assert.equal(correlateClock({ launch, launchEvent: { t: 9000, w: 1 }, reads: [] }), "unverified");
  assert.equal(correlateClock({ launch, launchEvent, reads: [{ hostMono: 102, wallMs: 5e11 + 2000, latest: { t: 500, w: 5e8 + 900 } }] }), "unverified");
  assert.equal(correlateClock({ launch, launchEvent: undefined, reads: [] }), "unverified");
});

test("runner log phrases are counted per stage, with bounded IPC-timeout pids", () => {
  const log = ["Detected running apps: [x]", "[Start] View hierarchy snapshot for app", "[Done] View hierarchy snapshot for app",
    "Device orientation is 1", "Tapping 10.0, 20.5", "Tapping took 0.2", HISTORICAL_IPC, HISTORICAL_IPC.replace("1102", "1103")].join("\n");
  const counted = countRunnerPatterns(log, 1);
  assert.equal(counted.counts.activeAppsListed, 1);
  assert.equal(counted.counts.axIpcTimeout, 2);
  assert.equal(counted.counts.tapStarted, 1);
  assert.deepEqual(counted.ipcTimeoutPids, [1102]);
  const before = { state: "read", counts: { ...counted.counts, tapReturned: 0 } };
  assert.equal(deltaCounts(before, { state: "read", counts: counted.counts }).deltas.tapReturned, 1);
  assert.deepEqual(deltaCounts({ state: "unavailable" }, { state: "read", counts: counted.counts }), { state: "unavailable" });
});

test("journal closeout reports a started stage without an end as no response, never as not called", () => {
  const text = [{ event: "stage-start", id: "S01" }, { event: "stage-end", id: "S01" }, { event: "stage-start", id: "S02" }, { event: "stage-start", id: "S99" }]
    .map((value) => JSON.stringify(value)).join("\n") + "\nbroken\n";
  const summary = summarizeJournal(text);
  assert.deepEqual(summary.started, ["S01", "S02"]);
  assert.deepEqual(summary.startedWithoutEnd, [{ id: "S02", state: "no-response-before-termination" }]);
  assert.equal(summary.invalidLines, 2);
  assert.deepEqual(publishableErrors(summary), []);
});

test("the privacy gate admits finite receipts and rejects free text, secrets and oversize data", () => {
  const receipt = { schemaVersion: 1, kind: "ios-ax-probe", status: "completed", startedAt: "2026-11-06T08:08:06.249Z", source: "a".repeat(40),
    runId: "36833073038", runAttempt: "1", runnerImage: "20261102.0117.1", device: "iPad Pro 13-inch (M5)", limits: LIMITS, budget: BUDGET,
    tool: { zipSha256: TOOL.zipSha256, zip: "match", jars: TOOL.jars.map((jar) => ({ member: jar.member, sha256: jar.sha256, retained: "match" })) },
    host: { xcodeVersion: "26.6", xcodeBuild: "17F42", runtime: "com.apple.CoreSimulator.SimRuntime.iOS-26-5" },
    simulator: { udid: "0A1B2C3D-0000-1111-2222-333344445555", deviceType: "com.apple.CoreSimulator.SimDeviceType.iPad-Pro-13-inch-M5-12GB" },
    stages: [{ id: "S04", purpose: "open-tap", boundary: "command-returned", notRunReason: "stopped-after-S03", patterns: classifyToolError(HISTORICAL_IPC).patterns,
      fixture: { acks: { "open-pressed": { seen: true, offsetMs: 12 } } }, predicates: hierarchyPredicates(tree({ txt: TEXT.intro })) }] };
  assert.deepEqual(publishableErrors(receipt), []);
  for (const bad of ["Assertion is false: \"Current: Solo\" is visible", "GITHUB_TOKEN=ghp_x", "/Users/runner/work/x", "Solo", HISTORICAL_IPC]) {
    assert.notDeepEqual(publishableErrors({ ...receipt, note: bad }), [], bad);
  }
  assert.notDeepEqual(publishableErrors({ ...receipt, "free text key": 1 }), []);
  assert.notDeepEqual(publishableErrors({ list: Array.from({ length: 65 }, () => 1) }), []);
  assert.notDeepEqual(publishableErrors({ value: Number.NaN }), []);
  assert.notDeepEqual(publishableErrors({ big: Array.from({ length: 60 }, () => "a".repeat(64)) }, 1024), []);
});

test("the fixture source carries the plan's fixed strings and ack vocabulary", () => {
  const swift = readFileSync(new URL("./fixture/AXProbeFixture.swift", import.meta.url), "utf8");
  const plist = readFileSync(new URL("./fixture/Info.plist", import.meta.url), "utf8");
  for (const value of [...Object.values(TEXT), ...Object.values(IDS), FIXTURE.eventsFile]) assert(swift.includes(`"${value}"`), value);
  for (const kind of PLAN.flatMap((stage) => stage.fixtureAck ?? [])) assert(swift.includes(`event("${kind}"`), kind);
  assert(plist.includes(`<string>${FIXTURE.bundleId}</string>`) && plist.includes(`<string>${FIXTURE.executable}</string>`));
});
