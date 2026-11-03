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

/** Own one read-only log stream. Retain only allowlisted payloads; never raw OS logs. */
export function startInputLog(device, path, { launch = spawn, now = Date.now, limit = 8192, stopMs = 5000 } = {}) {
  assert(/^[A-Za-z0-9-]+$/.test(device));
  writeFileSync(path, "");
  const child = launch("xcrun", ["simctl", "spawn", device, "log", "stream", "--style", "ndjson", "--level", "debug",
    "--predicate", 'subsystem == "com.facebook.react.log" AND category == "javascript" AND eventMessage CONTAINS "THIRD_ROLL_INPUT "'],
  { stdio: ["ignore", "pipe", "ignore"] });
  let buffer = "", events = 0, dropped = 0, heartbeat = false, closed = false, error = null, oversized = false;
  let finish;
  const done = new Promise((resolve) => { finish = resolve; });
  child.on("error", () => { error = "input-log-spawn-failed"; closed = true; finish(); });
  child.on("close", () => { closed = true; finish(); });
  child.stdout.on("error", () => { error = "input-log-read-failed"; });
  child.stdout.on("data", (chunk) => {
    for (const part of chunk.toString().split(/(\n)/)) {
      if (part === "\n") {
        const event = oversized ? null : inputEvent(buffer);
        if (event) {
          if (events < limit && !error) {
            try {
              appendFileSync(path, JSON.stringify({ ...event, receivedAtMs: now() }) + "\n");
              events++; heartbeat ||= event.phase === "heartbeat";
            } catch { error = "input-log-write-failed"; }
          } else dropped++;
        }
        buffer = ""; oversized = false;
      } else if (!oversized) {
        if (buffer.length + part.length > 16384) { buffer = ""; oversized = true; }
        else buffer += part;
      }
    }
  });
  const retire = () => { if (!closed) child.kill("SIGKILL"); };
  process.once("exit", retire);
  const lifetime = setTimeout(retire, 60 * 60 * 1000); lifetime.unref();
  let stopping;
  return () => stopping ??= (async () => {
    try {
      if (!closed) child.kill("SIGTERM");
      let timer;
      try { await Promise.race([done, new Promise((resolve) => { timer = setTimeout(() => { retire(); resolve(); }, stopMs); })]); }
      finally { clearTimeout(timer); }
      return { events, dropped, heartbeat, error, closed };
    } finally { clearTimeout(lifetime); process.removeListener("exit", retire); }
  })();
}
