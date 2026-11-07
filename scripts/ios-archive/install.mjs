import { spawn } from "node:child_process";
import { createWriteStream, lstatSync, mkdirSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { constants } from "node:os";
import { pathToFileURL } from "node:url";
import { installCollector } from "./installLog.mjs";

export const INSTALL_ARGS = Object.freeze(["install", "--frozen-lockfile", "--ignore-scripts", "--verbose"]);
const signals = ["SIGINT", "SIGTERM", "SIGHUP", "SIGKILL", "SIGABRT", "SIGSEGV", "SIGPIPE"];
const errors = ["ENOENT", "EACCES", "ENOMEM", "EIO", "ENOBUFS"];
const errorClass = (e) => { try { return errors.indexOf(e?.code) + 1; } catch { return 0; } };
const integer = (v) => Number.isSafeInteger(v) && v >= 0 && v <= 1_000_000_000;
const finiteId = (v, regex) => typeof v === "string" && regex.test(v) ? v : null;

// A bounded async queue never applies writer backpressure to Bun's output pipes.
export function installWriter(root) {
  let writer, failed = false, dropped = 0;
  try {
    if (!lstatSync(root).isDirectory() || realpathSync(root) !== resolve(root)) throw new Error();
    const reports = join(root, "reports");
    try { mkdirSync(reports, { mode: 0o700 }); } catch (e) { if (e.code !== "EEXIST") throw e; }
    if (!lstatSync(reports).isDirectory() || realpathSync(reports) !== resolve(reports)) throw new Error();
    const owned = join(reports, "archive-install-evidence"); mkdirSync(owned, { mode: 0o700 });
    writer = createWriteStream(join(owned, "synopsis.jsonl"), { flags: "wx", mode: 0o600, highWaterMark: 16384 });
    writer.on("error", () => { failed = true; });
  } catch { failed = true; }
  return {
    emit(row) {
      if (!writer || failed) { dropped++; return; }
      try {
        const text = JSON.stringify(row) + "\n";
        if (Buffer.byteLength(text) > 4096 || writer.writableLength + Buffer.byteLength(text) > 32768) { dropped++; return; }
        writer.write(text);
      } catch { failed = true; }
    },
    async finish() {
      if (writer && !failed && !writer.closed) await new Promise((done) => { writer.once("close", done); writer.once("error", done); writer.end(); });
      return { status: failed ? "unavailable" : dropped ? "partial" : "observed", dropped: Math.min(dropped, 1_000_000_000) };
    },
  };
}
export async function observeInstall({ spawnImpl = spawn, cwd = process.cwd(), env = process.env, writer = installWriter(cwd), host = process,
  collectorFactory = installCollector } = {}) {
  const safeEmit = (row) => { try { writer.emit(row); } catch { /* Advisory only. */ } };
  const identity = { workflowSha: finiteId(env.GITHUB_SHA, /^[a-f0-9]{40}$/), run: finiteId(env.GITHUB_RUN_ID, /^[1-9][0-9]{0,15}$/),
    attempt: finiteId(env.GITHUB_RUN_ATTEMPT, /^[1-9][0-9]{0,15}$/) };
  let collector;
  try { collector = collectorFactory({ emit: safeEmit }); } catch { /* Keep draining even without a classifier. */ }
  let child, failure = null, terminal = null; const handlers = new Map();
  const push = (stream, chunk) => { try { collector?.push(stream, chunk); } catch { /* Keep draining. */ } };
  safeEmit({ v: 1, kind: 0, identity, pid: null, supportedBunSource: "744846f844374847c902b5e7fd59b4342a51ef99" });
  try {
    child = spawnImpl("bun", INSTALL_ARGS, { cwd, env, stdio: ["inherit", "pipe", "pipe"] });
    safeEmit({ v: 1, kind: 2, pid: integer(child.pid) ? child.pid : null });
    child.stdout.on("data", (data) => push(1, data)); child.stderr.on("data", (data) => push(2, data));
    for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
      const handler = () => { safeEmit({ v: 1, kind: 3, signal: signals.indexOf(signal) + 1 }); try { child.kill(signal); } catch { /* Runner retains its outer deadline. */ } };
      host.on(signal, handler); handlers.set(signal, handler);
    }
    terminal = await new Promise((done) => {
      child.once("error", (error) => { failure = error; });
      child.once("close", (code, signal) => done({ code, signal }));
    });
  } catch (error) { failure = error; }
  finally { for (const [signal, handler] of handlers) host.removeListener(signal, handler); }
  let coverage = { partial: true, unavailable: true };
  try { if (collector) coverage = collector.finish(); } catch { /* Never copy arbitrary classifier errors. */ }
  const outcome = { v: 1, kind: 4, code: integer(terminal?.code) && terminal.code <= 255 ? terminal.code : null,
    signal: signals.indexOf(terminal?.signal) + 1, error: errorClass(failure), coverage };
  safeEmit(outcome);
  let retention = { status: "unavailable" };
  try { retention = await writer.finish(); } catch { /* Does not replace the original child outcome. */ }
  return { code: terminal?.code ?? null, signal: terminal?.signal ?? null, error: failure, synopsis: { ...outcome, retention } };
}
export function installExit(result, host = process) {
  if (result.signal) {
    const number = constants.signals[result.signal];
    host.exitCode = Number.isInteger(number) && number > 0 && number < 128 ? 128 + number : 1;
    // SIGPIPE is ignored by Node; SIGUSR1 starts an inspector. Preserve a
    // failing shell status without re-raising those special signals.
    if (result.signal !== "SIGPIPE" && result.signal !== "SIGUSR1") { try { host.kill(host.pid, result.signal); } catch { /* The failing fallback remains. */ } }
    return;
  }
  if (result.error) { host.exitCode = result.error.code === "ENOENT" ? 127 : result.error.code === "EACCES" ? 126 : 1; return; }
  host.exitCode = Number.isSafeInteger(result.code) && result.code >= 0 && result.code <= 255 ? result.code : 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = await observeInstall();
  // Only the finite synopsis crosses the public log boundary.
  console.log(JSON.stringify(result.synopsis)); installExit(result);
}
