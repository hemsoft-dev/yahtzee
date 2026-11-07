import { constants, closeSync, fstatSync, lstatSync, openSync, readSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { nativeModalSummary, parseNativeModal } from "./nativeModalLog.mjs";

/** Preserve the original interaction outcome even if advisory retention fails. */
export async function withModalRetention(exercise, retain) {
  try { return await exercise(); }
  finally { try { await retain(); } catch { /* Evidence remains unavailable; never replace the original error. */ } }
}

/** Only the exact authored synthetic marker may be retained, never arbitrary damaged data. */
export function retainCorruptionMarker(readMatch, directory) {
  try {
    if (readMatch() !== "1") return { status: "unavailable", reason: "synthetic-marker-not-confirmed" };
    const bytes = Buffer.from("damaged-save"), path = "synthetic-corrupt-value.bin";
    writeFileSync(join(directory, path), bytes, { flag: "wx" });
    return { status: "retained", path, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"),
      scope: "exact-sql-value-match", databaseSnapshot: false };
  } catch { return { status: "unavailable", reason: "synthetic-marker-retention-failed" }; }
}

/** Own modal files only. Per-file errors preserve prior summaries and immutable prefixes. */
export function retainNativeModal(container, directory, scopeStartedAtMs) {
  const files = [];
  try {
    const documents = join(container, "Documents"), stat = lstatSync(documents);
    if (!stat.isDirectory() || stat.isSymbolicLink()) return { status: "unavailable", reason: "documents-not-owned-directory", files };
    const names = readdirSync(documents).filter((n) => /^native-modal-[1-9][0-9]{0,8}-[1-9][0-9]{0,15}\.jsonl$/.test(n));
    if (names.length > 64) return { status: "unavailable", reason: "file-count-bound", files };
    // Relaunches leave installation-only files. Keep the newest eight prefixes without deleting earlier files.
    const selected = names.map((name) => { try { return { name, time: lstatSync(join(documents, name)).mtimeMs }; } catch { return { name, time: -1 }; } })
      .sort((a, b) => b.time - a.time || a.name.localeCompare(b.name)).slice(0, 8);
    for (const { name } of selected) {
      try {
        const path = join(documents, name), before = lstatSync(path);
        if (!before.isFile() || before.isSymbolicLink() || before.size > 4 * 1024 * 1024) throw new Error("Unsafe modal file.");
        const wallBeforeMs = Date.now(), monoBeforeMs = performance.now();
        const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
        let buffer;
        try {
          const opened = fstatSync(fd); if (!opened.isFile() || opened.ino !== before.ino || opened.dev !== before.dev) throw new Error("Modal file identity changed.");
          const bytes = Buffer.alloc(4 * 1024 * 1024 + 1), n = readSync(fd, bytes, 0, bytes.length, 0); buffer = bytes.subarray(0, n);
        } finally { closeSync(fd); }
        const monoAfterMs = performance.now(), wallAfterMs = Date.now(), parsed = parseNativeModal(buffer.toString("utf8"));
        const [, pid, epoch] = /^native-modal-([0-9]+)-([0-9]+)\.jsonl$/.exec(name);
        if (parsed.events.some((e) => e.pid !== Number(pid) || e.epoch !== Number(epoch))) throw new Error("Modal process epoch mismatch.");
        const output = `native-modal-${files.length}.jsonl`;
        writeFileSync(join(directory, output), parsed.events.map((e) => JSON.stringify(e)).join("\n") + (parsed.events.length ? "\n" : ""), { flag: "wx" });
        const { events, ...health } = parsed;
        files.push({ status: "retained-prefix", path: output, health, summary: nativeModalSummary(parsed), sourceClosed: false,
          wallBeforeMs, wallAfterMs, monoBeforeMs, monoAfterMs,
          scopeWindowOverlapObserved: events.some((e) => Number.isFinite(e.w) && e.w * 1000 >= scopeStartedAtMs && e.w * 1000 <= wallAfterMs + 50) });
      } catch { files.push({ status: "unavailable", reason: "modal-file-unavailable" }); }
    }
    return { schemaVersion: 1, status: files.some((f) => f.status === "retained-prefix") ? "partial" : "unavailable", files,
      enumeratedFiles: names.length, omittedFiles: Math.max(0, names.length - selected.length), selection: "newest-mtime-prefixes-not-causal-order",
      absenceProvesNothing: true, limits: ["asynchronous-writer-not-closed", "conditional-wall-clock-only", "direct-callback-unavailable", "candidate-state-not-cause", "not-paint-proof"] };
  } catch { return { schemaVersion: 1, status: "unavailable", reason: "modal-retention-failed", files, absenceProvesNothing: true }; }
}
