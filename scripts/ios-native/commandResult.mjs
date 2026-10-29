import assert from "node:assert/strict";

/** Process status is authoritative; printed simulator status values are not exit codes. */
export function checkedCommandOutput(result, executable, log) {
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `${executable} failed with ${result.status}; see ${log}`);
  return result.stdout?.trim() ?? "";
}
