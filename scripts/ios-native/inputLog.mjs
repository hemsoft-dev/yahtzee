import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { appendFileSync, writeFileSync } from "node:fs";

const marker = "THIRD_ROLL_INPUT ";
const phases = new Set(["boot", "heartbeat", "score-press-in", "score-press-out", "score-handler", "score-ack", "score-rejected"]);
export function inputEvent(line) {
  try {
    const message = JSON.parse(line).eventMessage;
    if (typeof message !== "string") return null;
    const offset = message.indexOf(marker); if (offset < 0) return null;
    const event = JSON.parse(message.slice(offset + marker.length));
    if (Object.keys(event).sort().join() !== "atMs,monotonicMs,phase,sequence" || !phases.has(event.phase)) return null;
    if (!Number.isSafeInteger(event.atMs) || event.atMs < 0 || !Number.isSafeInteger(event.sequence) || event.sequence < 0
      || !Number.isFinite(event.monotonicMs) || event.monotonicMs < 0) return null;
    return event;
  } catch { return null; }
}

export function inputTraceUsable(trace) {
  return trace?.schemaVersion === 2 && trace.events > 0 && trace.heartbeat === true && trace.closed === true
    && trace.stopRequested === true && trace.exitObserved === true && trace.unexpectedExit === false && trace.forcedStop === false
    && trace.dropped === 0 && trace.oversizedLines === 0 && trace.unterminatedLines === 0 && trace.error === null
    && (trace.exitCode === 0 || (trace.exitCode === null && trace.exitSignal === "SIGTERM"));
}

/** Own one read-only log stream. Only an intentional, complete shutdown can be usable. */
export function startInputLog(device, path, { launch = spawn, now = Date.now, env = process.env, limit = 8192, stopMs = 5000 } = {}) {
  assert(/^[A-Za-z0-9-]+$/.test(device));
  writeFileSync(path, "");
  const child = launch("xcrun", ["simctl", "spawn", device, "log", "stream", "--style", "ndjson", "--level", "debug",
    "--predicate", 'subsystem == "com.facebook.react.log" AND category == "javascript" AND eventMessage CONTAINS "THIRD_ROLL_INPUT "'],
  { env, stdio: ["ignore", "pipe", "ignore"] });
  let buffer = "", events = 0, dropped = 0, heartbeat = false, closed = false, error = null, oversized = false;
  let oversizedLines = 0, unterminatedLines = 0, stopRequested = false, unexpectedExit = false, forcedStop = false;
  let exitCode = null, exitSignal = null, stopRequestedAtMs = null, closedAtMs = null, lastReceivedAtMs = null;
  let exitObserved = false, exitedAtMs = null;
  const startedAtMs = now();
  const fail = (code) => { error ??= code; };
  let finish;
  const done = new Promise((resolve) => { finish = resolve; });
  function retire(reason = "input-log-forced-stop") {
    if (closed) return;
    forcedStop = true; fail(reason);
    try { child.kill("SIGKILL"); } catch { fail("input-log-kill-failed"); }
  }
  const onExit = () => retire();
  process.once("exit", onExit);
  child.on("error", () => { fail("input-log-process-error"); });
  function observeExit(code, signal) {
    if (exitObserved) return;
    exitObserved = true; exitedAtMs = now(); exitCode = code ?? null; exitSignal = signal ?? null;
    if (!stopRequested) { unexpectedExit = true; fail("input-log-exited-before-stop"); }
    else if (exitCode !== 0 && !(exitCode === null && exitSignal === "SIGTERM")) fail("input-log-exit-failed");
  }
  child.on("exit", observeExit);
  child.stdout.on("end", () => { if (!stopRequested) fail("input-log-stream-ended-before-stop"); });
  child.on("close", (code, signal) => {
    observeExit(code, signal);
    closed = true; closedAtMs = now();
    if (buffer.length || oversized) {
      unterminatedLines++; if (!oversized) dropped++;
      fail("input-log-unterminated-record"); buffer = ""; oversized = false;
    }
    process.removeListener("exit", onExit); finish();
  });
  child.stdout.on("error", () => { fail("input-log-read-failed"); });
  child.stdout.on("data", (chunk) => {
    for (const part of chunk.toString().split(/(\n)/)) {
      if (part === "\n") {
        if (!oversized) {
          const event = inputEvent(buffer);
          if (event) {
            if (events < limit && !error) {
              try {
                lastReceivedAtMs = now();
                appendFileSync(path, JSON.stringify({ ...event, receivedAtMs: lastReceivedAtMs }) + "\n");
                events++; heartbeat ||= event.phase === "heartbeat";
              } catch { fail("input-log-write-failed"); dropped++; }
            } else { dropped++; fail("input-log-event-limit-or-error"); }
          } else if (buffer.trimStart().startsWith("{") && buffer.includes(marker)) {
            dropped++; fail("input-log-malformed-record");
          }
        }
        buffer = ""; oversized = false;
      } else if (!oversized) {
        if (buffer.length + part.length > 16384) {
          buffer = ""; oversized = true; oversizedLines++; dropped++; fail("input-log-oversized-record");
        } else buffer += part;
      }
    }
  });
  const lifetime = setTimeout(() => retire("input-log-lifetime-expired"), 60 * 60 * 1000); lifetime.unref();
  const waitClosed = async (ms) => {
    if (closed) return;
    let timer;
    try { await Promise.race([done, new Promise((resolve) => { timer = setTimeout(resolve, ms); })]); }
    finally { clearTimeout(timer); }
  };
  let stopping;
  return () => stopping ??= (async () => {
    // Exit can precede close while stdout is still draining.
    if (!exitObserved && (child.exitCode != null || child.signalCode != null)) observeExit(child.exitCode, child.signalCode);
    stopRequested = true; stopRequestedAtMs = now();
    try {
      if (!closed) {
        if (!exitObserved) { try { child.kill("SIGTERM"); } catch { fail("input-log-stop-failed"); } }
        // Reserve part of the existing total stop budget to confirm a forced exit.
        const grace = Math.max(1, Math.floor(stopMs * 0.8));
        await waitClosed(grace);
        if (!closed) { retire(); await waitClosed(Math.max(0, stopMs - grace)); }
      }
      return { schemaVersion: 2, events, dropped, heartbeat, error, closed, stopRequested, unexpectedExit, forcedStop,
        exitCode, exitSignal, exitObserved, exitedAtMs, oversizedLines, unterminatedLines, startedAtMs, stopRequestedAtMs, closedAtMs, lastReceivedAtMs };
    } finally {
      clearTimeout(lifetime);
      // An unconfirmed kill remains owned by the exit guard until the close event.
      if (closed) process.removeListener("exit", onExit);
    }
  })();
}
