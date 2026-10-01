import assert from "node:assert/strict";

/** Inspect retained fixture bytes even when navigation failed. Never restore or replay. */
export async function unchangedSave({ expected, exercise, readSaved, record }) {
  let failure, result, failed = false;
  try { result = await exercise(); } catch (error) { failed = true; failure = error; }
  try {
    const saved = await readSaved();
    await record(saved); // Retain observed bytes before rejecting a mutation.
    assert.equal(saved, expected, "Display-only capture changed the preloaded save.");
  } catch (error) {
    if (failed) throw new AggregateError([failure, error], "Capture navigation failed and fixture integrity was not preserved.");
    throw error;
  }
  if (failed) throw failure;
  return result;
}
