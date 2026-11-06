// Runs with `if: always()`. Closes out the stage journal even when run.mjs was killed
// mid-request: a started stage without an end is "no-response-before-termination".
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { publishableErrors, summarizeJournal, STATUSES } from "./protocol.mjs";

const output = resolve(import.meta.dirname, "../../reports/ios-ax-probe");
const closeout = join(output, "closeout.json");
if (!existsSync(output)) {
  console.log("AX probe produced no evidence folder.");
} else if (existsSync(closeout)) {
  throw new Error("Existing probe closeout was not overwritten.");
} else {
  const read = (name) => { try { return readFileSync(join(output, name), "utf8"); } catch { return null; } };
  let receiptStatus = "unavailable";
  try { const status = JSON.parse(read("receipt.json")).status; if (STATUSES.includes(status)) receiptStatus = status; } catch { /* stays unavailable */ }
  const journal = read("stage-events.jsonl");
  const value = { schemaVersion: 1, receiptStatus, journal: journal === null ? { state: "unavailable" } : { state: "read", ...summarizeJournal(journal) } };
  if (publishableErrors(value).length) throw new Error("Probe closeout failed the privacy gate.");
  writeFileSync(closeout, JSON.stringify(value, null, 2) + "\n");
  console.log(`AX probe closeout: receipt ${receiptStatus}, ${value.journal.startedWithoutEnd?.length ?? 0} stage(s) without a response.`);
}
