import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

/** Retain the actual synthetic database after a failed navigation, without replay. */
export async function preserveCorruptionFailure({ exercise, database, expected, evidencePath, report }) {
  try { return await exercise(); }
  catch (primary) {
    let evidence;
    try {
      const bytes = readFileSync(database);
      evidence = { present: true, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), preserved: bytes.equals(expected) };
      try { writeFileSync(evidencePath, bytes); }
      catch (error) { evidence.retentionError = String(error); }
    } catch (error) {
      evidence = error.code === "ENOENT" ? { present: false, preserved: false } : { error: String(error) };
    }
    try { report(evidence); }
    catch { console.error("Corruption integrity evidence unavailable."); }
    throw primary;
  }
}
