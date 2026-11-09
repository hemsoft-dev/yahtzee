import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { stripVTControlCharacters } from "node:util";

const LINE_BYTES = 8192;
const PREFIX = "@yahtzee/mobile build: ";
const SIGNALS = { SIGTERM: 1, SIGKILL: 2, SIGINT: 3 };

/** Observe existing output only. No raw text, path or error enters a notice. */
export function exportProgress(notice, clock = () => performance.now()) {
  const streams = new Map([1, 2].map((id) => [id, { bytes: Buffer.alloc(LINE_BYTES), length: 0, overflow: false }]));
  const seen = new Set();
  let expected = 3;
  let origin;
  try { origin = clock(); } catch { origin = NaN; }
  function emit(stage, code = -1, signal = 0) {
    if (!Number.isInteger(stage) || stage < 1 || stage > 11) { emit(11); return; }
    if (!Number.isInteger(code) || code < -1 || code > 255 || !Number.isInteger(signal) || signal < 0 || signal > 3) { emit(11); return; }
    if (seen.has(stage)) return;
    // Reserve a final close record, and mark an exhausted observation budget.
    if (stage !== 9 && stage !== 11 && seen.size >= 8) { emit(11); return; }
    if (stage !== 9 && seen.size >= 9) return;
    seen.add(stage);
    let ms = -1;
    try {
      const elapsed = Math.floor(clock() - origin);
      if (Number.isSafeInteger(elapsed) && elapsed >= 0) ms = Math.min(elapsed, 2147483647);
    } catch { /* Observation cannot replace the child result. */ }
    const row = { v: 1, stage, seq: seen.size, ms, code, signal };
    try { notice(row); } catch { /* A failed diagnostic sink never reruns or repairs the command. */ }
  }
  function line(state) {
    if (state.overflow) { emit(11); return; }
    const text = stripVTControlCharacters(state.bytes.subarray(0, state.length).toString("utf8")).replace(/\r$/, "");
    if (!text.startsWith(PREFIX)) return;
    const value = text.slice(PREFIX.length);
    let stage;
    if (value === "Starting Metro Bundler") stage = expected === 3 ? 3 : expected === 6 ? 6 : 11;
    else if (/^Android Bundled \d+ms /.test(value)) stage = 4;
    else if (value === "Exported: ../../reports/mobile/android") stage = 5;
    else if (/^iOS Bundled \d+ms /.test(value)) stage = 7;
    else if (value === "Exported: ../../reports/mobile/ios") stage = 8;
    else return;
    if (stage !== expected) { emit(11); return; }
    emit(stage);
    expected++;
  }
  return {
    emit,
    push(id, chunk) {
      const state = streams.get(id);
      if (!state || !Buffer.isBuffer(chunk)) { emit(11); return; }
      for (const byte of chunk) {
        if (byte === 10) {
          line(state);
          state.length = 0;
          state.overflow = false;
        } else if (state.length < LINE_BYTES) state.bytes[state.length++] = byte;
        else state.overflow = true;
      }
    },
    end(id) {
      const state = streams.get(id);
      if (state?.length || state?.overflow) emit(11);
    },
  };
}

export function annotation(row) {
  if (!row || Object.keys(row).sort().join(",") !== "code,ms,seq,signal,stage,v"
    || Object.values(row).some((value) => !Number.isSafeInteger(value)) || row.v !== 1
    || row.stage < 1 || row.stage > 11 || row.seq < 1 || row.seq > 10 || row.ms < -1 || row.ms > 2147483647
    || row.code < -1 || row.code > 255 || row.signal < 0 || row.signal > 3) throw new TypeError("Invalid finite export observation");
  return `\n::notice title=Mobile export stage::v=${row.v} stage=${row.stage} seq=${row.seq} ms=${row.ms} code=${row.code} signal=${row.signal}\n`;
}

/** One original command, unchanged argv/env/deadline. Fixtures use the same process boundary. */
export function runExport({ command = "bun", args = ["run", "build:mobile"], cwd = process.cwd(), env = process.env,
  stdout = process.stdout, stderr = process.stderr, notice = (row) => process.stdout.write(annotation(row)) } = {}) {
  const progress = exportProgress(notice);
  progress.emit(1);
  return new Promise((done) => {
    const child = spawn(command, args, { cwd, env, stdio: ["inherit", "pipe", "pipe"], windowsHide: true });
    let error;
    child.once("spawn", () => progress.emit(2));
    for (const [id, source, target] of [[1, child.stdout, stdout], [2, child.stderr, stderr]]) {
      source.on("data", (chunk) => progress.push(id, chunk));
      source.once("end", () => progress.end(id));
      source.pipe(target, { end: false });
    }
    child.once("error", (value) => {
      error = value;
      progress.emit(10, value.code === "ENOENT" ? 1 : value.code === "EACCES" ? 2 : 0);
    });
    child.once("close", (code, signal) => {
      progress.emit(9, Number.isInteger(code) && code >= 0 && code <= 255 ? code : -1, SIGNALS[signal] ?? 0);
      done({ code, signal, error });
    });
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await runExport();
  if (result.signal) process.kill(process.pid, result.signal);
  process.exitCode = result.error ? 1 : result.code ?? 1;
}
