import { execFile } from "node:child_process";
import { constants, closeSync, fstatSync, lstatSync, openSync, readSync, realpathSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { readResultSynopsis } from "../driverEvidence.mjs";

const integer = (v, max) => Number.isSafeInteger(v) && v >= 0 && v <= max;
const errors = ["ERR_ASSERTION", "ENOENT", "EACCES", "ETIMEDOUT", "ENOBUFS", "ENOMEM", "EIO", "ERR_CHILD_PROCESS_STDIO_MAXBUFFER"];
const signals = ["SIGTERM", "SIGKILL", "SIGABRT", "SIGSEGV", "SIGBUS", "SIGILL", "SIGINT", "SIGQUIT", "SIGHUP", "SIGPIPE", "SIGTRAP"];
export function resultErrorClass(error) { try { return errors.indexOf(error?.code) + 1; } catch { return 0; } }
const unavailableCommand = () => ({ observed: false, exit: null, signal: 0, error: 0, threw: false });
function finiteCommand(value) {
  try {
    if (!value || Object.keys(value).sort().join() !== "error,exit,observed,signal,threw" || typeof value.observed !== "boolean" || typeof value.threw !== "boolean"
      || value.exit !== null && !integer(value.exit, 255) || !integer(value.signal, signals.length) || !integer(value.error, errors.length)) return unavailableCommand();
    return { observed: value.observed, exit: value.exit, signal: value.signal, error: value.error, threw: value.threw };
  } catch { return unavailableCommand(); }
}
function commandResult(result, threw = false) {
  try { return { observed: true, exit: integer(result?.status, 255) ? result.status : null,
    signal: signals.indexOf(result?.signal) + 1, error: resultErrorClass(result?.error), threw }; }
  catch { return unavailableCommand(); }
}
const notify = (sink, value) => { try { sink?.(value); } catch { /* Advisory observation preserves the original result/error. */ } };

/** The original executable/argument/options references and raw result/error are forwarded once. */
export function observedSpawn(spawn, executable, args, options, sink) {
  if (!sink) return spawn(executable, args, options);
  let result;
  try { result = spawn(executable, args, options); }
  catch (error) { notify(sink, { ...commandResult({ error }), threw: true }); throw error; }
  notify(sink, commandResult(result)); return result;
}

/** Only the two fixed tests and their suite may contribute lifecycle records. No messages survive. */
export function testLogSynopsis(text) {
  if (typeof text !== "string" || Buffer.byteLength(text) > 16 * 1024 * 1024) return { status: "unavailable", reason: "log-bound" };
  const events = [], names = ["test00ForwardOnceControls", "test10ActualDeviceInfoRequest"], outcomes = ["started", "passed", "failed", "skipped"];
  let at = 0, lines = 0, oversized = 0, truncated = false;
  const partialLastLine = text.length > 0 && !text.endsWith("\n");
  while (at < text.length) {
    if (++lines > 65536) { truncated = true; break; }
    const end = text.indexOf("\n", at); if (end < 0) break;
    if (end - at > 4096) { oversized++; at = end + 1; continue; }
    const line = text.slice(at, end).replace(/\r$/, ""); at = end + 1;
    const match = /^Test Case '-\[(?:[A-Za-z0-9_]+\.)?HSAXRequestQualificationTests (test00ForwardOnceControls|test10ActualDeviceInfoRequest)\]' (started|passed|failed|skipped)(?:[ .(]|$)/.exec(line)
      ?? /^Test case 'HSAXRequestQualificationTests\.(test00ForwardOnceControls|test10ActualDeviceInfoRequest)\(\)' (passed|failed|skipped) on /.exec(line);
    const suite = /^Test Suite 'HSAXRequestQualificationTests' (started|passed|failed|skipped) at /.exec(line);
    if (!match && !suite) continue;
    if (events.length === 64) { truncated = true; break; }
    events.push({ test: match ? names.indexOf(match[1]) + 1 : 0, outcome: outcomes.indexOf(match ? match[2] : suite[1]) + 1 });
  }
  return { status: truncated || oversized || partialLastLine ? "partial" : "observed", events, lines: Math.min(lines, 65536), oversized, truncated, partialLastLine,
    absenceProvesNothing: true, coverage: "fixed-test-lifecycle-lines-only" };
}

function readLog(root) {
  try {
    const path = join(root, "test.private"), before = lstatSync(path);
    if (!before.isFile() || before.isSymbolicLink() || before.size > 16 * 1024 * 1024) return { status: "unavailable", reason: "unsafe-or-bounded-log" };
    const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
    try {
      const stat = fstatSync(fd); if (!stat.isFile() || stat.ino !== before.ino || stat.dev !== before.dev || stat.size !== before.size) throw new Error();
      const bytes = Buffer.alloc(stat.size); let at = 0;
      while (at < bytes.length) { const n = readSync(fd, bytes, at, bytes.length - at, at); if (!n) throw new Error(); at += n; }
      const after = fstatSync(fd); if (after.size !== stat.size || after.mtimeMs !== stat.mtimeMs) throw new Error();
      return testLogSynopsis(bytes.toString("utf8"));
    } finally { closeSync(fd); }
  } catch { return { status: "unavailable", reason: "unreadable-log" }; }
}

const hash = (v, length) => typeof v === "string" && new RegExp(`^[a-f0-9]{${length}}$`).test(v) ? v : null;
const identifier = (v) => typeof v === "string" && /^[1-9][0-9]{0,15}$/.test(v) ? v : null;
function identity(receipt) {
  return { source: hash(receipt.source, 40), driverSource: hash(receipt.driverSource, 40), run: identifier(receipt.runId), attempt: identifier(receipt.runAttempt),
    executable: hash(receipt.driverBuild?.executableSha256, 64), plan: hash(receipt.driverBuild?.xctestrunSha256, 64),
    appManifest: hash(receipt.build?.manifestSha256, 64), appArchive: hash(receipt.build?.artifactSha256, 64) };
}
const reasons = new Set(["deadline", "unsafe-result", "unsupported-tool", "bounded-tool-unavailable", "unsupported-schema", "unreadable-result"]);
function finiteResult(result) {
  if (result?.status === "unavailable" && reasons.has(result.reason)) return { status: "unavailable", reason: result.reason };
  const kinds = new Set(["assertion-failure", "exception", "system-failure", "test-failure"]);
  if (result?.status !== "observed" || result.coverage !== "test-failure-summaries-only" || !Array.isArray(result.issues) || result.issues.length > 32
    || result.issues.some((i) => !kinds.has(i?.kind) || i.code !== null || i.severity !== "error")) return { status: "unavailable", reason: "unsupported-schema" };
  return { status: "observed", coverage: "test-failure-summaries-only", issues: result.issues.map((i) => ({ kind: i.kind, code: null, severity: "error" })) };
}

/** Fixed owned bundle only. Reuses the existing validated 1s/64KiB metadata reader; exports no bundle/payload. */
export async function retainPhase7({ privateRoot, output, receipt, command, extraction, failure }, { run = execFile, platform = process.platform } = {}) {
  let owned = false, metadataCommand = unavailableCommand(), result = { status: "unavailable", reason: "unreadable-result" };
  try {
    const stat = lstatSync(privateRoot); if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(privateRoot) !== resolve(privateRoot)) throw new Error();
    owned = true;
    result = finiteResult(await readResultSynopsis(privateRoot, join(privateRoot, "result.xcresult"), Date.now() + 1000, { platform,
      run: (executable, args, options, callback) => run(executable, args, { ...options,
        env: { PATH: "/usr/bin:/bin", DEVELOPER_DIR: "/Applications/Xcode_26.6.app/Contents/Developer" } }, (error, stdout, stderr) => {
        try { metadataCommand = commandResult({ status: error ? error.code : 0, signal: error?.signal, error }); } catch { metadataCommand = unavailableCommand(); }
        callback(error, stdout, stderr);
      }) }));
  } catch { /* No retention failure changes the original qualification outcome. */ }
  const record = { schemaVersion: 1, scope: "owned-pinned-AX-phase7-result", identity: identity(receipt),
    phase: integer(receipt.phase, 9) ? receipt.phase : null, command: finiteCommand(command),
    extraction: integer(extraction, 5) ? extraction : 0, caughtError: integer(failure, errors.length) ? failure : 0,
    log: owned ? readLog(privateRoot) : { status: "unavailable", reason: "unsafe-root" }, result: { ...result, command: metadataCommand },
    limits: ["not-a-passing-oracle", "absent-lines-do-not-prove-no-execution", "fixed-test-lines-may-be-incomplete", "result-issues-only-not-test-or-runner-cause",
      "legacy-reader-may-be-unavailable-on-pinned-host", "planned-product-not-loaded-image", "no-HTTP-wire-or-ordinary-driver-acceptance"] };
  try { writeFileSync(join(output, "test-result-synopsis.json"), JSON.stringify(record) + "\n", { flag: "wx" }); return record; }
  catch { return { schemaVersion: 1, status: "unavailable", reason: "synopsis-write-unavailable" }; }
}
