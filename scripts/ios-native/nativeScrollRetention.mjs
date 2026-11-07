import { constants, closeSync, fstatSync, lstatSync, openSync, readSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseNativeScroll, nativeScrollSummary } from "./nativeScrollLog.mjs";

/** Only fixed-prefix files in the already-resolved owned app container. No app/AX command is added. */
export function retainNativeScroll(container, directory, scopeStartedAtMs) {
  const files = [];
  try {
    if (!Number.isFinite(scopeStartedAtMs) || scopeStartedAtMs < 0) throw new Error();
    const documents = join(container, "Documents"), stat = lstatSync(documents);
    if (!stat.isDirectory() || stat.isSymbolicLink()) return { status: "unavailable", reason: "documents-not-owned-directory", files, absenceProvesNothing: true };
    const names = readdirSync(documents).filter((n) => /^native-scroll-[1-9][0-9]{0,8}-[1-9][0-9]{0,15}\.jsonl$/.test(n));
    if (names.length > 64) return { status: "unavailable", reason: "file-count-bound", files, absenceProvesNothing: true };
    const selected = names.map((name) => { try { return { name, time: lstatSync(join(documents, name)).mtimeMs }; } catch { return { name, time: -1 }; } })
      .sort((a, b) => b.time - a.time || a.name.localeCompare(b.name)).slice(0, 8);
    for (const { name } of selected) {
      try {
        const path = join(documents, name), before = lstatSync(path);
        if (!before.isFile() || before.isSymbolicLink() || before.size > 4 * 1024 * 1024) throw new Error();
        const wallBeforeMs = Date.now(), monoBeforeMs = performance.now();
        const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
        let buffer;
        try {
          const opened = fstatSync(fd);
          if (!opened.isFile() || opened.ino !== before.ino || opened.dev !== before.dev) throw new Error();
          const bytes = Buffer.alloc(4 * 1024 * 1024 + 1), count = readSync(fd, bytes, 0, bytes.length, 0); buffer = bytes.subarray(0, count);
        } finally { closeSync(fd); }
        const monoAfterMs = performance.now(), wallAfterMs = Date.now(), parsed = parseNativeScroll(buffer.toString("utf8"));
        const [, pid, epoch] = /^native-scroll-([0-9]+)-([0-9]+)\.jsonl$/.exec(name);
        if (parsed.events.some((e) => e.pid !== Number(pid) || e.epoch !== Number(epoch))) throw new Error();
        const pathOut = `native-scroll-${files.length}.jsonl`;
        writeFileSync(join(directory, pathOut), parsed.events.map((e) => JSON.stringify(e)).join("\n") + (parsed.events.length ? "\n" : ""), { flag: "wx" });
        const { events, ...health } = parsed;
        files.push({ status: "retained-prefix", path: pathOut, health, summary: nativeScrollSummary(parsed), sourceClosed: false,
          wallBeforeMs, wallAfterMs, monoBeforeMs, monoAfterMs,
          scopeWindowOverlapObserved: events.some((e) => e.w * 1000 >= scopeStartedAtMs && e.w * 1000 <= wallAfterMs + 50) });
      } catch { files.push({ status: "unavailable", reason: "scroll-file-unavailable" }); }
    }
    return { schemaVersion: 1, status: files.some((f) => f.status === "retained-prefix") ? "partial" : "unavailable", files,
      enumeratedFiles: names.length, omittedFiles: Math.max(0, names.length - selected.length), absenceProvesNothing: true,
      limits: ["asynchronous-writer-not-closed", "newest-mtime-selection-not-causal-order", "conditional-wall-scope-only", "unknown-native-owner-and-cancellation-cause", "not-paint-or-AX-proof"] };
  } catch { return { schemaVersion: 1, status: "unavailable", reason: "scroll-retention-failed", files, absenceProvesNothing: true }; }
}
