import { constants, closeSync, fstatSync, lstatSync, openSync, readSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { nativeCancelSummary, parseNativeCancel } from "./nativeCancelLog.mjs";

/** One owned regular file: no-follow, nonblocking open, opened-identity check, at most 4 MiB + 1 byte read. */
export function readOwnedNativeFile(path) {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4 * 1024 * 1024) return null;
  const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const opened = fstatSync(fd);
    if (!opened.isFile() || opened.ino !== stat.ino || opened.dev !== stat.dev) throw new Error("Native file identity changed.");
    const bytes = Buffer.alloc(4 * 1024 * 1024 + 1); const n = readSync(fd, bytes, 0, bytes.length, 0);
    return n > 4 * 1024 * 1024 ? null : bytes.subarray(0, n);
  } finally { closeSync(fd); }
}

/**
 * The newest owned native-cancel log's text for the evidence-gated system-gesture re-send (#130).
 * Same file rules as retention; anything unexpected yields "" and therefore no re-send.
 */
export function newestNativeCancelText(container) {
  const documents = join(container, "Documents"); const dir = lstatSync(documents);
  if (!dir.isDirectory() || dir.isSymbolicLink()) return "";
  const names = readdirSync(documents).filter((n) => /^native-cancel-[1-9][0-9]{0,8}\.jsonl$/.test(n));
  if (names.length > 8) return "";
  const newest = names.map((name) => ({ name, stat: lstatSync(join(documents, name)) }))
    .filter(({ stat }) => stat.isFile() && !stat.isSymbolicLink()).sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs)[0];
  const bytes = newest ? readOwnedNativeFile(join(documents, newest.name)) : null;
  return bytes ? bytes.toString("utf8") : "";
}

/** Advisory immutable prefix of fixed files in the owned app container only. Never changes flow outcome. */
export function retainNativeCancellation(container, directory, scenarioStartedAtMs) {
  try {
    const documents = join(container, "Documents"); const stat = lstatSync(documents);
    if (!stat.isDirectory() || stat.isSymbolicLink()) return { status: "unavailable", reason: "documents-not-owned-directory" };
    const names = readdirSync(documents).filter((n) => /^native-cancel-[1-9][0-9]{0,8}\.jsonl$/.test(n)).sort();
    if (names.length > 8) return { status: "unavailable", reason: "file-count-bound" };
    const files = [];
    for (const name of names) {
      const path = join(documents, name), stat = lstatSync(path);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4 * 1024 * 1024) { files.push({ status: "unavailable", reason: "unsafe-or-over-budget-file" }); continue; }
      const wallBeforeMs = Date.now(), monoBeforeMs = performance.now();
      const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
      let buffer;
      try {
        const opened = fstatSync(fd);
        if (!opened.isFile() || opened.ino !== stat.ino || opened.dev !== stat.dev) throw new Error("Native file identity changed.");
        const bytes = Buffer.alloc(4 * 1024 * 1024 + 1); const n = readSync(fd, bytes, 0, bytes.length, 0); buffer = bytes.subarray(0, n);
      }
      finally { closeSync(fd); }
      const monoAfterMs = performance.now(), wallAfterMs = Date.now();
      const parsed = parseNativeCancel(buffer.toString("utf8"));
      const output = `native-cancel-${files.length}.jsonl`;
      writeFileSync(join(directory, output), parsed.events.map((e) => JSON.stringify(e)).join("\n") + (parsed.events.length ? "\n" : ""), { flag: "wx" });
      const { events, ...health } = parsed;
      files.push({ status: "retained-prefix", path: output, health, summary: nativeCancelSummary(parsed),
        sourceClosed: false, wallBeforeMs, wallAfterMs, monoBeforeMs, monoAfterMs,
        scenarioWindowOverlapObserved: events.some((e) => Number.isFinite(e.w) && e.w * 1000 >= scenarioStartedAtMs && e.w * 1000 <= wallAfterMs + 50) });
    }
    return { schemaVersion: 1, status: files.length ? "partial" : "unavailable", files, absenceProvesNothing: true,
      limits: ["asynchronous-writer-not-closed", "wall-clock-stability-not-attested", "candidate-state-is-not-private-arbitration-reason", "not-video-or-paint-proof"] };
  } catch { return { schemaVersion: 1, status: "unavailable", reason: "native-retention-failed", absenceProvesNothing: true }; }
}
