import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { preserveCorruptionFailure } from "./corruptionEvidence.mjs";

test("failed navigation retains persisted bytes and the original failure without replay", async () => {
  for (const changed of [false, true]) {
    const folder = mkdtempSync(join(tmpdir(), "corrupt-evidence-")), database = join(folder, "database"), evidencePath = join(folder, "retained");
    const expected = Buffer.from("original corruption"), actual = changed ? Buffer.from("unexpected mutation") : expected;
    const primary = new Error("navigation failed"); let calls = 0, evidence;
    writeFileSync(database, expected);
    try {
      await assert.rejects(preserveCorruptionFailure({ database, expected, evidencePath, report: (value) => { evidence = value; },
        exercise: async () => { calls++; writeFileSync(database, actual); throw primary; } }), (error) => error === primary);
      assert.equal(calls, 1); assert.equal(evidence.preserved, !changed);
      assert.deepEqual(readFileSync(database), actual); assert.deepEqual(readFileSync(evidencePath), actual);
    } finally { rmSync(folder, { recursive: true }); }
  }
});

test("diagnostic write failure cannot replace navigation failure or restore deleted data", async () => {
  const folder = mkdtempSync(join(tmpdir(), "corrupt-write-")), database = join(folder, "database"), expected = Buffer.from("damaged");
  const primary = new Error("primary"); let evidence;
  try {
    writeFileSync(database, expected);
    await assert.rejects(preserveCorruptionFailure({ database, expected, evidencePath: folder,
      report: (value) => { evidence = value; }, exercise: async () => { throw primary; } }), (error) => error === primary);
    assert.equal(evidence.preserved, true); assert.match(evidence.retentionError, /EISDIR|EPERM|EACCES/);
    await assert.rejects(preserveCorruptionFailure({ database, expected, evidencePath: join(folder, "retained"),
      report: (value) => { evidence = value; }, exercise: async () => { rmSync(database); throw primary; } }), (error) => error === primary);
    assert.deepEqual(evidence, { present: false, preserved: false });
  } finally { rmSync(folder, { recursive: true }); }
});
