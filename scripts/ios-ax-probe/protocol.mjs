/**
 * Fixed vocabulary for the hosted AX query/tap probe. Pure functions, no I/O.
 *
 * The probe drives the pinned Maestro CLI against its own UIKit fixture, never
 * Yahtzee. Each query and each tap is a separate MCP request. Responses are
 * reduced to fixed booleans, counts and enum classes here; no response text,
 * hierarchy text or error text leaves these functions.
 */

export const FIXTURE = Object.freeze({ bundleId: "dev.hemsoft.axprobe.fixture", executable: "AXProbeFixture", eventsFile: "ax-probe-events.jsonl" });
export const TEXT = Object.freeze({ intro: "AX Probe Intro", open: "Choose Mode", current: "Current: Solo", duo: "Duo", ack: "Selected: Duo" });
export const IDS = Object.freeze({ intro: "probe.intro", open: "probe.open", ack: "probe.ack" });
export const DEVICES = Object.freeze(["iPad Pro 13-inch (M5)", "iPhone 17"]);
export const STALL_CONTROLS = Object.freeze([0, 3000]);
export const HOST = Object.freeze({
  developerDir: "/Applications/Xcode_26.6.app/Contents/Developer", xcodeVersion: "26.6",
  runtime: "com.apple.CoreSimulator.SimRuntime.iOS-26-5", runtimeVersion: "26.5", deploymentTarget: "17.0",
});
// Same pin as quality.yml. Jar hashes are the retained package-identity values for that archive.
export const TOOL = Object.freeze({
  maestroVersion: "2.10.0",
  zipSha256: "29b675e10cc12080e445e9bfb2e2b4e4dfb9c0f2e30d5884120d258b5e1cd991",
  jars: Object.freeze([
    Object.freeze({ member: "lib/maestro-cli-2.10.0.jar", sha256: "edf1a9ec465f1fbe7a325d2f166e1135f19deeb671f9dd76aeedf8e6f887845c" }),
    Object.freeze({ member: "lib/maestro-ios-driver.jar", sha256: "1a4e4582e7b415167782711c04b914df878899d04757a2de82c3bf7a5b4c99f1" }),
  ]),
});
// Request, session and shutdown limits equal native qualification's; the rest bound this probe only.
export const BUDGET = Object.freeze({
  requestMs: 300000, sessionMs: 1200000, shutdownMs: 60000, commandMs: 180000, bootMs: 300000, buildMs: 300000,
  fixtureReadyMs: 30000, eventsBytes: 1048576, eventLines: 20000, runnerLogBytes: 16777216, runnerLogFiles: 8,
  responseBytes: 8388608, hierarchyNodes: 20000, pids: 8, stages: 12, receiptBytes: 262144,
});
export const PROTOCOL_VERSIONS = Object.freeze(["2024-11-05", "2025-03-26", "2025-06-18"]);

// Which pinned source path each request exercises (Maestro ref 3ff37999, see docs/ios-ax-probe.md).
export const LAYERS = Object.freeze({
  "inspect-hierarchy": "mcp-inspect_screen>viewHierarchy>ViewHierarchyHandler>RunningApp.getForegroundApp+snapshot",
  "run-assert": "mcp-run>orchestra-assertVisible>viewHierarchy-polling",
  "run-tap": "mcp-run>orchestra-tapOn>viewHierarchy-lookup>TouchRouteHandler>ScreenSizeHelper+synthesize",
});

const inspect = (id, purpose, expect, extra = {}) => ({ id, tool: "inspect_screen", layer: "inspect-hierarchy", purpose, expect, ...extra });
const assertion = (id, purpose, value) => ({ id, tool: "run", layer: "run-assert", purpose, command: "assertVisible", value });
const tap = (id, purpose, value, fixtureAck) => ({ id, tool: "run", layer: "run-tap", purpose, command: "tapOn", value, fixtureAck });
const freeze = (value) => { if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };

/** The whole sequence. Each entry is sent at most once; there is no retry, replay or reconnect. */
export const PLAN = freeze([
  inspect("S01", "pre-tap-query-cold", { intro: "present", current: "absent", ack: "absent" }, { includesDriverStartup: true }),
  inspect("S02", "pre-tap-query-warm", { intro: "present", current: "absent", ack: "absent" }),
  assertion("S03", "intro-assertion", { text: TEXT.intro }),
  tap("S04", "open-tap", { id: IDS.open, retryTapIfNoChange: false }, ["open-pressed", "sheet-presented"]),
  inspect("S05", "sheet-query", { current: "present", duo: "present", ack: "absent" }),
  assertion("S06", "current-assertion", { text: TEXT.current }),
  tap("S07", "option-tap", { text: TEXT.duo, retryTapIfNoChange: false }, ["option-duo", "ack-set"]),
  inspect("S08", "ack-query", { ack: "present", current: "absent" }),
  assertion("S09", "ack-assertion", { text: TEXT.ack }),
]);

/** One command per request, same single-line JSON value form as native qualification. */
export function flowYaml(stage) {
  if (stage?.tool !== "run" || typeof stage.command !== "string") throw new Error("Only run stages have a flow.");
  return `appId: ${JSON.stringify(FIXTURE.bundleId)}\n---\n- ${stage.command}: ${JSON.stringify(stage.value)}\n`;
}

export function stageArguments(stage, device) {
  return stage.tool === "inspect_screen" ? { device_id: device } : { device_id: device, yaml: flowYaml(stage) };
}

const PREDICATES = Object.freeze({
  intro: [TEXT.intro, IDS.intro], open: [TEXT.open, IDS.open], current: [TEXT.current], duo: [TEXT.duo], ack: [TEXT.ack, IDS.ack],
});

/** Exact-match counts over inspect_screen's compact tree (`txt`, `a11y`, `rid`, children `c`). */
export function hierarchyPredicates(payload, limit = BUDGET.hierarchyNodes) {
  if (!payload || typeof payload !== "object" || !Array.isArray(payload.elements)) return { state: "unparseable" };
  const counts = Object.fromEntries(Object.keys(PREDICATES).map((key) => [key, 0]));
  const stack = payload.elements.map((node) => [node, 1]);
  let nodes = 0, depth = 0;
  while (stack.length) {
    const [node, level] = stack.pop();
    if (nodes >= limit) return { state: "truncated", nodes, depth };
    nodes++;
    if (!node || typeof node !== "object") continue;
    depth = Math.max(depth, level);
    const values = [node.txt, node.a11y, node.rid].filter((value) => typeof value === "string");
    for (const [key, accepted] of Object.entries(PREDICATES)) if (values.some((value) => accepted.includes(value))) counts[key]++;
    if (Array.isArray(node.c)) for (const child of node.c) stack.push([child, level + 1]);
  }
  return { state: "parsed", counts, nodes, depth };
}

export const ERROR_PATTERNS = Object.freeze([
  ["assertionFalse", /Assertion is false:/],
  ["elementNotFound", /Element not found:/],
  ["deviceUnreachable", /Device became unreachable during/],
  ["activeAppsFailed", /Failed to get list of active applications/],
  ["axIpcTimeout", /kAXErrorIPCTimeout/],
  ["driverConnect", /driver.*(?:install|connect).*(?:fail|error)|(?:Failed|Unable) to (?:install|connect).*driver/i],
  ["hierarchyFailure", /Snapshot failure while getting view hierarchy/],
  ["deviceInfoFailure", /Getting device info call failed/],
  ["tapFailure", /Error tapping point/],
  ["timeoutWording", /timed out|timeout/i],
]);
export const OPERATIONS = Object.freeze(["deviceInfo", "isScreenStatic", "viewHierarchy", "touch", "screenshot", "swipe", "inputText",
  "runningApp", "launchApp", "terminateApp", "pressKey", "pressButton", "eraseText", "keyboard", "status", "setOrientation"]);
export const ERROR_CLASSES = Object.freeze(["assertion-false", "element-not-found", "ax-query-failure", "device-unreachable",
  "driver-connect", "runner-route-failure", "other-tool-error"]);
/** Classes after which the driver connection is not trusted for another request. */
export const TRANSPORT_CLASSES = Object.freeze(["device-unreachable", "driver-connect"]);

/** Error text is matched in memory and dropped; only booleans and enums are returned. */
export function classifyToolError(text) {
  const value = typeof text === "string" ? text.slice(0, 65536) : "";
  const patterns = Object.fromEntries(ERROR_PATTERNS.map(([id, pattern]) => [id, pattern.test(value)]));
  const operation = /Device became unreachable during (\w+)/.exec(value)?.[1];
  const unreachableOperation = operation === undefined ? null : OPERATIONS.includes(operation) ? operation : "other";
  // Explicit application failures take precedence, as in native qualification.
  const errorClass = patterns.assertionFalse ? "assertion-false" : patterns.elementNotFound ? "element-not-found"
    : patterns.axIpcTimeout || patterns.activeAppsFailed ? "ax-query-failure"
      : patterns.deviceUnreachable ? "device-unreachable" : patterns.driverConnect ? "driver-connect"
        : patterns.hierarchyFailure || patterns.deviceInfoFailure || patterns.tapFailure ? "runner-route-failure" : "other-tool-error";
  return { errorClass, patterns, unreachableOperation };
}

function toolText(response, limit) {
  if (!Array.isArray(response?.content)) return null;
  const text = response.content.filter((item) => item?.type === "text" && typeof item.text === "string").map((item) => item.text).join("\n");
  return Buffer.byteLength(text) > limit ? null : text;
}

/** Reduce one MCP tools/call result to finite fields. */
export function interpret(stage, response, limit = BUDGET.responseBytes) {
  const text = toolText(response, limit);
  if (response?.isError === true) {
    const { errorClass, patterns, unreachableOperation } = classifyToolError(text ?? "");
    return { outcome: "tool-error", errorClass, patterns, unreachableOperation };
  }
  let payload;
  try { payload = text === null ? undefined : JSON.parse(text); } catch { payload = undefined; }
  if (payload === undefined) return { outcome: "returned", response: "unparseable" };
  if (stage.tool === "inspect_screen") return { outcome: "returned", response: "parsed", predicates: hierarchyPredicates(payload) };
  return { outcome: "returned", response: "parsed", runSuccess: payload?.success === true,
    commandsExecuted: Number.isSafeInteger(payload?.commands_executed) ? payload.commands_executed : null };
}

export const BOUNDARIES = Object.freeze(["query-returned", "command-returned", "command-returned-unsuccessful", "response-unavailable",
  "app-assertion-failed", "driver-query-error", "transport-error", "tool-error-other", "no-response", "not-run"]);

/** Which side of the request the stage ended on. A returned call is not proof of paint or AX state. */
export function boundaryOf(record) {
  if (record.outcome === "not-run") return "not-run";
  if (["request-timeout", "transport-closed", "deadline-exhausted"].includes(record.outcome)) return "no-response";
  if (record.outcome === "tool-error") {
    if (["assertion-false", "element-not-found"].includes(record.errorClass)) return "app-assertion-failed";
    if (["ax-query-failure", "runner-route-failure"].includes(record.errorClass)) return "driver-query-error";
    if (TRANSPORT_CLASSES.includes(record.errorClass)) return "transport-error";
    return "tool-error-other";
  }
  if (record.response !== "parsed") return "response-unavailable";
  if (record.predicates) return record.predicates.state === "parsed" ? "query-returned" : "response-unavailable";
  return record.runSuccess ? "command-returned" : "command-returned-unsuccessful";
}

/** `met` is null when the fixture acknowledgment needed for a tap is unavailable. */
export function evaluateStage(stage, record, window) {
  const boundary = boundaryOf(record);
  if (stage.tool === "inspect_screen") {
    if (boundary !== "query-returned") return { request: false, fixtureAck: null, met: false };
    const met = Object.entries(stage.expect).every(([key, rule]) => (rule === "present" ? record.predicates.counts[key] > 0 : record.predicates.counts[key] === 0));
    return { request: met, fixtureAck: null, met };
  }
  const request = boundary === "command-returned";
  if (!stage.fixtureAck) return { request, fixtureAck: null, met: request };
  const fixtureAck = window?.acks ? stage.fixtureAck.every((kind) => window.acks[kind]?.seen === true) : null;
  return { request, fixtureAck, met: request && fixtureAck === null ? null : request && fixtureAck === true };
}

export const FIXTURE_EVENTS = Object.freeze(["launch", "appeared", "open-pressed", "stall-control-done", "sheet-presented",
  "option-solo", "option-duo", "option-cancel", "ack-set", "hb", "stall"]);
const EVENT_INTS = Object.freeze(["n", "g", "pid"]);

/** Strict parse of the fixture's own fixed-vocabulary event log. Unknown shapes are counted, never kept. */
export function parseFixtureEvents(text, limits = BUDGET) {
  if (typeof text !== "string" || Buffer.byteLength(text) > limits.eventsBytes) return { state: "unavailable", events: [], invalidLines: 0 };
  const events = []; let invalidLines = 0;
  const lines = text.split("\n");
  // The last element is "" after a final newline, or a line still being written; neither is counted.
  lines.pop();
  for (const line of lines.slice(0, limits.eventLines)) {
    let value;
    try { value = JSON.parse(line); } catch { invalidLines++; continue; }
    const keys = value && typeof value === "object" && !Array.isArray(value) ? Object.keys(value) : null;
    const valid = keys && FIXTURE_EVENTS.includes(value.k) && Number.isFinite(value.t) && value.t >= 0 && Number.isFinite(value.w) && value.w > 0
      && keys.every((key) => ["k", "t", "w", ...EVENT_INTS].includes(key))
      && EVENT_INTS.every((key) => value[key] === undefined || (Number.isSafeInteger(value[key]) && value[key] >= 0 && value[key] <= 1e9));
    if (!valid) { invalidLines++; continue; }
    events.push(Object.fromEntries(["k", "t", "w", ...EVENT_INTS].filter((key) => value[key] !== undefined).map((key) => [key, value[key]])));
  }
  return { state: lines.length > limits.eventLines ? "truncated" : "parsed", events, invalidLines };
}

/**
 * Host and simulator processes share one Mac. The probe uses the monotonic clock
 * only if launch and every read are consistent with it; otherwise wall clock under
 * the same check; otherwise stage windows are not computed.
 */
export function correlateClock({ launch, launchEvent, reads }) {
  if (!launch || !launchEvent) return "unverified";
  const consistent = (eventKey, before, after, readKey, scale) => launchEvent[eventKey] >= before - 0.05 && launchEvent[eventKey] <= after + 5
    && reads.every((read) => !read.latest || read.latest[eventKey] <= read[readKey] / scale + 0.05);
  if (consistent("t", launch.monoBefore, launch.monoAfter, "hostMono", 1)) return "monotonic-verified";
  if (consistent("w", launch.wallBeforeMs / 1000, launch.wallAfterMs / 1000, "wallMs", 1000)) return "wall-verified";
  return "unverified";
}

/** Fixture acknowledgments and main-thread heartbeat for one request window. */
export function fixtureWindow(events, clock, record, ackKinds = []) {
  if (!Array.isArray(events)) return { state: "unavailable" };
  const field = clock === "monotonic-verified" ? "t" : clock === "wall-verified" ? "w" : null;
  if (!field || !Number.isFinite(record.hostMonoStart) || !Number.isFinite(record.hostMonoEnd)) {
    return { state: "unwindowed", clock, acks: Object.fromEntries(ackKinds.map((kind) => [kind, { seen: events.some((event) => event.k === kind), offsetMs: null, withinRequest: null }])) };
  }
  const start = field === "t" ? record.hostMonoStart : record.wallStartMs / 1000;
  const end = field === "t" ? record.hostMonoEnd : record.wallEndMs / 1000;
  const acks = Object.fromEntries(ackKinds.map((kind) => {
    const first = events.find((event) => event.k === kind && event[field] >= start);
    return [kind, first ? { seen: true, offsetMs: Math.round((first[field] - start) * 1000), withinRequest: first[field] <= end } : { seen: false, offsetMs: null, withinRequest: null }];
  }));
  const inside = events.filter((event) => event[field] > start && event[field] <= end);
  const kinds = {};
  for (const event of inside) if (!["hb", "stall"].includes(event.k)) kinds[event.k] = (kinds[event.k] ?? 0) + 1;
  // A heartbeat summarises the preceding second; a stall event closes a gap that may have begun earlier.
  const beats = events.filter((event) => event.k === "hb" && event[field] > start && event[field] <= end + 1.1);
  const stalls = events.filter((event) => event.k === "stall" && event[field] > start && event[field] - event.g / 1000 < end);
  const gaps = [...beats, ...stalls].map((event) => event.g);
  return { state: "windowed", clock, acks, events: kinds,
    heartbeat: { beats: beats.length, maxGapMs: gaps.length ? Math.max(...gaps) : null, stalls: stalls.length, aliveAfter: events.some((event) => event[field] > end) } };
}

// Fixed NSLog/XCTest phrases from the pinned runner source; counted, never retained.
export const RUNNER_PATTERNS = Object.freeze([
  ["deviceInfoHandled", /Device orientation is /],
  ["activeAppsListed", /Detected running apps:/],
  ["activeAppsFailed", /Failed to get list of active applications/],
  ["axIpcTimeout", /kAXErrorIPCTimeout/],
  ["hierarchyStart", /\[Start\] View hierarchy snapshot/],
  ["hierarchyDone", /\[Done\] View hierarchy snapshot/],
  ["hierarchySpringboard", /No foreground app found returning springboard/],
  ["hierarchyFailure", /Snapshot failure while getting view hierarchy/],
  ["screenSizeCached", /Returning cached screen size/],
  ["screenSizeFallback", /Failure while getting screen size/],
  ["tapStarted", /(?:Tapping|Long pressing) -?[\d.]+, -?[\d.]+/],
  ["tapReturned", /Tapping took /],
  ["tapError", /Error tapping:/],
]);

export function countRunnerPatterns(text, maxPids = BUDGET.pids) {
  const counts = Object.fromEntries(RUNNER_PATTERNS.map(([id]) => [id, 0]));
  const ipcTimeoutPids = [];
  for (const line of text.split("\n")) {
    for (const [id, pattern] of RUNNER_PATTERNS) if (pattern.test(line)) counts[id]++;
    const pid = /kAXErrorIPCTimeout from \w+ for (\d{1,9})\b/.exec(line)?.[1];
    if (pid && ipcTimeoutPids.length < maxPids && !ipcTimeoutPids.includes(Number(pid))) ipcTimeoutPids.push(Number(pid));
  }
  return { counts, ipcTimeoutPids };
}

export function deltaCounts(before, after) {
  if (before?.state !== "read" || after?.state !== "read") return { state: "unavailable" };
  return { state: "read", deltas: Object.fromEntries(Object.keys(after.counts).map((key) => [key, after.counts[key] - (before.counts[key] ?? 0)])) };
}

/** Stage journal closeout: a start with no end means no response before termination, never "not called". */
export function summarizeJournal(text) {
  const started = [], ended = [];
  let invalidLines = 0;
  for (const line of (typeof text === "string" ? text : "").split("\n").filter(Boolean).slice(0, 1000)) {
    let entry;
    try { entry = JSON.parse(line); } catch { invalidLines++; continue; }
    const known = PLAN.some((stage) => stage.id === entry?.id);
    if (entry?.event === "stage-start" && known && !started.includes(entry.id)) started.push(entry.id);
    else if (entry?.event === "stage-end" && known && !ended.includes(entry.id)) ended.push(entry.id);
    else invalidLines++;
  }
  return { started, ended, startedWithoutEnd: started.filter((id) => !ended.includes(id)).map((id) => ({ id, state: "no-response-before-termination" })), invalidLines };
}

export const STATUSES = Object.freeze(["running", "completed", "stopped", "session-failed", "device-not-connected", "unsupported-host",
  "tool-identity-mismatch", "fixture-build-failed", "fixture-not-ready", "setup-failed", "privacy-rejected"]);
export const LIMITS = Object.freeze(["fixture-not-yahtzee", "not-a-historical-replay", "pass-does-not-exonerate-historical-failures",
  "failure-does-not-reproduce-historical-failures", "returned-call-is-not-paint-or-ax-proof", "sensitivity-control-is-not-reproduction",
  "loaded-runner-image-not-attested", "single-sequence-no-retry"]);

const VOCABULARY = new Set([
  ...STATUSES, ...LIMITS, ...BOUNDARIES, ...ERROR_CLASSES, ...OPERATIONS, ...FIXTURE_EVENTS, ...DEVICES, ...Object.keys(LAYERS), ...Object.values(LAYERS),
  ...PLAN.flatMap((stage) => [stage.id, stage.purpose, stage.tool, stage.command].filter(Boolean)), ...TOOL.jars.map((jar) => jar.member),
  "parsed", "unparseable", "truncated", "unavailable", "windowed", "unwindowed", "read", "returned", "tool-error", "request-timeout",
  "transport-closed", "deadline-exhausted", "not-run", "monotonic-verified", "wall-verified", "unverified", "closed", "close-failed",
  "owned-device-connected", "owned-device-missing", "unexpected-server", "rpc-timeout", "present", "absent", "match", "mismatch",
  "arm64", "x86_64", "ios-ax-probe", "no-response-before-termination", "rpc-error", "startup", "list_devices", "initialize",
  HOST.developerDir, HOST.runtime, FIXTURE.bundleId,
]);
const FORMATS = Object.freeze([
  /^[0-9a-f]{64}$/, /^[0-9a-f]{40}$/, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/, /^[0-9A-F]{8}-(?:[0-9A-F]{4}-){3}[0-9A-F]{12}$/,
  /^\d{1,20}$/, /^\d{1,8}(?:\.\d{1,8}){1,3}$/, /^\d{1,2}[A-Z]\d{1,5}[a-z]?$/, /^stopped-after-S\d{2}$/,
  /^com\.apple\.CoreSimulator\.SimDeviceType\.[A-Za-z0-9-]{1,64}$/, /^com\.apple\.CoreSimulator\.SimRuntime\.iOS-\d{1,2}-\d{1,2}$/,
]);
const KEY = /^[A-Za-z][A-Za-z0-9]{0,47}$/;

/** Every string in a published file must be fixed vocabulary or a fixed format; no free text passes. */
export function publishableErrors(value, limit = BUDGET.receiptBytes) {
  const errors = [];
  const visit = (node, path) => {
    if (errors.length >= 8) return;
    if (node === null || typeof node === "boolean") return;
    if (typeof node === "number") { if (!Number.isFinite(node)) errors.push(`${path}: non-finite number`); return; }
    if (typeof node === "string") { if (!VOCABULARY.has(node) && !FORMATS.some((format) => format.test(node))) errors.push(`${path}: unpublishable string`); return; }
    if (Array.isArray(node)) { if (node.length > 64) errors.push(`${path}: array over bound`); node.forEach((item, index) => visit(item, `${path}[${index}]`)); return; }
    if (typeof node === "object") {
      for (const [key, child] of Object.entries(node)) {
        if (!KEY.test(key) && !VOCABULARY.has(key)) { errors.push(`${path}: unpublishable key`); continue; }
        visit(child, `${path}.${key}`);
      }
      return;
    }
    errors.push(`${path}: unsupported type`);
  };
  visit(value, "$");
  let bytes = Infinity;
  try { bytes = Buffer.byteLength(JSON.stringify(value)); } catch { /* reported below */ }
  if (bytes > limit) errors.push("$: receipt over byte bound");
  return errors;
}
