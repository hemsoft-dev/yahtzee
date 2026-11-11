import assert from "node:assert/strict";
import { reissuableSuffix, systemGateCancelSince } from "./systemCancel.mjs";

/** Split only our bounded, single-line authored YAML. Preserve every command exactly once. */
export function batchAuthoredFlow(yaml) {
  assert.equal(typeof yaml, "string", "Authored flow must be text.");
  assert(yaml.length <= 262144 && yaml.endsWith("\n") && !yaml.includes("\r"), "Authored flow must be bounded LF text.");
  const [appId, separator, ...lines] = yaml.split("\n");
  assert(/^appId: "[A-Za-z0-9.-]+"$/.test(appId) && separator === "---", "Authored flow must have one app header.");
  lines.pop();
  assert(lines.length > 0 && lines.every((line) => /^- [A-Za-z][A-Za-z0-9]*(?:: .+)?$/.test(line)), "Only single-line authored commands can be batched.");
  const batches = [];
  for (let offset = 0; offset < lines.length; offset += 8) {
    batches.push(`${appId}\n---\n${lines.slice(offset, offset + 8).join("\n")}\n`);
  }
  return batches;
}

/**
 * Await each batch on the same session. Never replay or continue after an uncertain failure.
 * One exception (#130): when the app's own native record proves the system gesture gate
 * cancelled the batch's last tap before delivery, that tap and the commands after it are sent
 * once more. At most once per authored flow, and every occurrence is recorded.
 */
export async function runAuthoredFlow(io, yaml, now = Date.now) {
  let reissued = false;
  for (const batch of batchAuthoredFlow(yaml)) {
    const startedMs = now();
    try { await io.runFlow(batch); }
    catch (error) {
      if (reissued || typeof io.systemCancelProbe !== "function") throw error;
      const [header, separator, ...lines] = batch.split("\n"); lines.pop();
      const suffix = reissuableSuffix(lines, error?.assertion);
      if (!suffix) throw error;
      let cancel = null;
      try { cancel = systemGateCancelSince(await io.systemCancelProbe(), startedMs); } catch { cancel = null; }
      if (!cancel) throw error;
      reissued = true;
      const entry = { kind: "system-gesture-cancel-reissue", assertion: error.assertion, tap: suffix[0], touch: cancel };
      io.record?.(entry); io.reportReissue?.(entry);
      await io.runFlow(`${header}\n${separator}\n${suffix.join("\n")}\n`);
    }
  }
}
