import assert from "node:assert/strict";
import { test } from "node:test";
import { checkedCommandOutput } from "./commandResult.mjs";

// Final transitions retained by tablet-10 on head 0a5e5c0. The elapsed clock
// covers the whole boot, not time spent exclusively waiting on System App.
const completedBoot = `[2026-10-29 14:41:31 +0000] Status=4, isTerminal=NO, Elapsed=01:48.
\tWaiting on System App
[2026-10-29 14:41:43 +0000] Status=4294967295, isTerminal=YES, Elapsed=02:00.
\tFinished
`;

test("bootstatus Finished sentinel is accepted only with process exit zero", () => {
  assert.equal(checkedCommandOutput({ status: 0, stdout: completedBoot }, "xcrun", "commands.log"), completedBoot.trim());
  for (const status of [1, -1, null]) {
    assert.throws(() => checkedCommandOutput({ status, stdout: completedBoot }, "xcrun", "commands.log"), /xcrun failed/);
  }
});

test("an incomplete timed-out or failed boot cannot reach subsequent setup", () => {
  const timeout = Object.assign(new Error("spawnSync xcrun ETIMEDOUT"), { code: "ETIMEDOUT" });
  const incompleteBoot = completedBoot.slice(0, completedBoot.indexOf("[2026-10-29 14:41:43"));
  for (const result of [
    { status: null, error: timeout, stdout: incompleteBoot },
    { status: 1, stdout: incompleteBoot },
    { status: null, signal: "SIGKILL", stdout: incompleteBoot },
  ]) {
    let setup = false;
    assert.throws(() => {
      checkedCommandOutput(result, "xcrun", "commands.log");
      setup = true;
    }, result.error ? (error) => error === timeout : /xcrun failed/);
    assert.equal(setup, false);
  }
});
