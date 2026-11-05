import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { appendFileSync, writeFileSync } from "node:fs";
import { StringDecoder } from "node:string_decoder";

// Never the input marker: this stream and the input stream cannot read each other's records.
const marker = "THIRD_ROLL_DONE ";
const recordLimit = 1024;
const lineLimit = 16384;
const retainedByteLimit = 256 * 1024;
const unlinked = new Set(["done-process-start", ...["root", "help", "history", "other"].map((branch) => `done-route-branch-${branch}`)]);
const closingStages = ["start", "end"].map((stage) => `done-route-transition-${stage}-closing`);
const routeWithDone = new Set(["done-route-effect-cleanup", "done-route-blur", "done-route-before-remove-go-back", ...closingStages]);
const routeOnly = new Set(["done-route-attach", "done-route-effect-reattach", "done-route-subscribe-failed", "done-route-focus", "done-route-gesture-cancel",
  "done-route-before-remove-pop", "done-route-before-remove-other", ...["start", "end"].map((stage) => `done-route-transition-${stage}-opening`)]);
const activation = new Set(["done-press-in", "done-press-out", "done-handler", "done-router-back-call", "done-router-back-returned", "done-router-back-threw",
  ...["detached", "disabled", "superseded"].map((end) => `done-observation-${end}`)]);
const validId = (id, sequence, allowEqual) => Number.isSafeInteger(id) && id >= 0 && (allowEqual ? id <= sequence : id < sequence);

export function doneEvent(line) {
  try {
    const message = JSON.parse(line).eventMessage;
    if (typeof message !== "string") return null;
    const offset = message.indexOf(marker); if (offset < 0) return null;
    const event = JSON.parse(message.slice(offset + marker.length));
    const { phase, atMs, monotonicMs, sequence, routeId, doneId } = event ?? {};
    if (!Number.isSafeInteger(sequence) || sequence < 0 || sequence >= recordLimit || !Number.isSafeInteger(atMs) || atMs < 0
      || !Number.isFinite(monotonicMs) || monotonicMs < 0) return null;
    const allowed = ["atMs", "monotonicMs", "phase", "sequence"];
    if (unlinked.has(phase)) { if (routeId !== undefined || doneId !== undefined) return null; }
    else if (routeWithDone.has(phase) || routeOnly.has(phase)) {
      const origin = phase === "done-route-attach";
      if (!validId(routeId, sequence, origin) || (origin && routeId !== sequence)) return null;
      if (doneId !== undefined && (!routeWithDone.has(phase) || !validId(doneId, sequence, false))) return null;
      allowed.push("routeId"); if (doneId !== undefined) allowed.push("doneId");
    } else if (activation.has(phase)) {
      const origin = phase === "done-press-in", handler = phase === "done-handler";
      if (!validId(doneId, sequence, origin || handler) || (origin && doneId !== sequence)) return null;
      if (routeId !== undefined && !validId(routeId, sequence, false)) return null;
      allowed.push("doneId"); if (routeId !== undefined) allowed.push("routeId");
    } else return null;
    return Object.keys(event).sort().join() === allowed.sort().join() ? event : null;
  } catch { return null; }
}

/** Collector shutdown checks only, not proof of app-event/window completeness. Exit 143 stays unusable. */
export function doneTraceUsable(trace) {
  return trace?.schemaVersion === 1 && trace.events > 0 && trace.closed === true && trace.stopRequested === true && trace.exitObserved === true
    && trace.unexpectedExit === false && trace.forcedStop === false && trace.dropped === 0 && trace.oversizedLines === 0
    && trace.unterminatedLines === 0 && trace.sequenceGaps === 0 && trace.error === null
    && (trace.exitCode === 0 || (trace.exitCode === null && trace.exitSignal === "SIGTERM"));
}

/** Own one read-only stream. Valid records are retained after a parse failure, but the receipt can no longer be complete. */
export function startDoneLog(device, path, { launch = spawn, now = Date.now, env = process.env, limit = recordLimit, byteLimit = retainedByteLimit, stopMs = 2000 } = {}) {
  assert(/^[A-Za-z0-9-]+$/.test(device));
  writeFileSync(path, "");
  const child = launch("xcrun", ["simctl", "spawn", device, "log", "stream", "--style", "ndjson", "--level", "debug",
    "--predicate", `subsystem == "com.facebook.react.log" AND category == "javascript" AND eventMessage CONTAINS "${marker}"`],
  { env, stdio: ["ignore", "pipe", "ignore"] });
  const decoder = new StringDecoder("utf8");
  let buffer = "", oversized = false, events = 0, retainedBytes = 0, dropped = 0, oversizedLines = 0, unterminatedLines = 0;
  // A segment is the collector's count of sequence restarts. It is not a native process identity.
  let segments = 0, lastSequence, sequenceGaps = 0;
  let closed = false, error = null, writable = true, stopRequested = false, unexpectedExit = false, forcedStop = false, exitObserved = false, exitCode = null, exitSignal = null;
  const fail = (code) => { error ??= code; };
  let finish;
  const done = new Promise((resolve) => { finish = resolve; });
  function retire(reason = "done-log-forced-stop") {
    if (closed) return;
    forcedStop = true; fail(reason);
    try { child.kill("SIGKILL"); } catch { fail("done-log-kill-failed"); }
  }
  const onExit = () => retire();
  process.once("exit", onExit);
  function observeExit(code, signal) {
    if (exitObserved) return;
    exitObserved = true; exitCode = code ?? null; exitSignal = signal ?? null;
    if (!stopRequested) { unexpectedExit = true; fail("done-log-exited-before-stop"); }
    else if (exitCode !== 0 && !(exitCode === null && exitSignal === "SIGTERM")) fail("done-log-exit-failed");
  }
  function retain(event) {
    if (lastSequence === undefined || event.sequence <= lastSequence) { segments++; if (event.sequence !== 0) sequenceGaps++; }
    else if (event.sequence !== lastSequence + 1) sequenceGaps++;
    lastSequence = event.sequence;
    const line = JSON.stringify({ ...event, segment: segments, receivedAtMs: now() }) + "\n";
    const bytes = Buffer.byteLength(line);
    if (!writable || events >= limit || retainedBytes + bytes > byteLimit) { dropped++; fail("done-log-limit-reached"); return; }
    try { appendFileSync(path, line); events++; retainedBytes += bytes; }
    catch { writable = false; dropped++; fail("done-log-write-failed"); }
  }
  function accept(line) {
    const event = doneEvent(line);
    if (event) retain(event);
    else if (line.trimStart().startsWith("{") && line.includes(marker)) { dropped++; fail("done-log-malformed-record"); }
  }
  function consume(text) {
    for (const part of text.split(/(\n)/)) {
      if (part === "\n") { if (!oversized) accept(buffer); buffer = ""; oversized = false; }
      else if (!oversized) {
        if (Buffer.byteLength(buffer) + Buffer.byteLength(part) > lineLimit) { buffer = ""; oversized = true; oversizedLines++; dropped++; fail("done-log-oversized-record"); }
        else buffer += part;
      }
    }
  }
  child.on("error", () => { fail("done-log-process-error"); });
  child.on("exit", observeExit);
  child.stdout.on("end", () => { if (!stopRequested) fail("done-log-stream-ended-before-stop"); });
  child.stdout.on("error", () => { fail("done-log-read-failed"); });
  child.stdout.on("data", (chunk) => { try { consume(decoder.write(chunk)); } catch { fail("done-log-read-failed"); } });
  child.on("close", (code, signal) => {
    observeExit(code, signal);
    closed = true;
    if (buffer.length || oversized) {
      unterminatedLines++; if (!oversized) dropped++;
      fail("done-log-unterminated-record"); buffer = ""; oversized = false;
    }
    process.removeListener("exit", onExit); finish();
  });
  const lifetime = setTimeout(() => retire("done-log-lifetime-expired"), 60 * 60 * 1000); lifetime.unref();
  const waitClosed = async (ms) => {
    if (closed) return;
    let timer;
    try { await Promise.race([done, new Promise((resolve) => { timer = setTimeout(resolve, ms); })]); }
    finally { clearTimeout(timer); }
  };
  let stopping;
  return () => stopping ??= (async () => {
    if (!exitObserved && (child.exitCode != null || child.signalCode != null)) observeExit(child.exitCode, child.signalCode);
    stopRequested = true;
    try {
      if (!closed) {
        if (!exitObserved) { try { child.kill("SIGTERM"); } catch { fail("done-log-stop-failed"); } }
        const grace = Math.max(1, Math.floor(stopMs * 0.8));
        await waitClosed(grace);
        if (!closed) { retire(); await waitClosed(Math.max(0, stopMs - grace)); }
      }
      return { schemaVersion: 1, events, retainedBytes, dropped, segments, sequenceGaps, error, closed, stopRequested, unexpectedExit, forcedStop,
        exitCode, exitSignal, exitObserved, oversizedLines, unterminatedLines };
    } finally {
      clearTimeout(lifetime);
      // An unconfirmed kill remains owned by the exit guard until the close event.
      if (closed) process.removeListener("exit", onExit);
    }
  })();
}
