# Native driver request limits

Native qualification keeps one local Maestro connection per scenario. The app still undergoes a real termination and cold relaunch. No scenario, saved-document assertion, hold/reroll effect, completion assertion or corruption/reset check is omitted.

Authored setup, resume and results-navigation YAML uses single-line JSON command values. `batchAuthoredFlow` validates the complete input first, then partitions it into at most eight commands per request. Each batch retains the same app header. Concatenating the batch commands reproduces the original commands byte for byte and in order. There is no new launch, clear-state operation or driver connection between batches.

`runAuthoredFlow` awaits each batch. A thrown or uncertain command stops the sequence. It never retries a batch, continues with later commands or restores a save. The existing five-minute RPC limit, ten-minute scenario deadline, output bound and environment allowlist remain unchanged. Geometry-sensitive holds, rerolls and score taps keep their existing individual actual-effect checks and no-retry behavior.

`scenario-tool-timing.jsonl` records the tool name, flow sequence, start timestamp, elapsed milliseconds and whether the call returned or threw. It does not record arguments, response bodies, environment values or error contents. A returned call is transport telemetry, not proof that an application action happened. The corresponding retained YAML and application/save assertions remain authoritative.

## What the controlled regression proves

[PR62 qualification](https://github.com/HemSoft/yahtzee/actions/runs/36821189887) hit `Local Maestro tools/call timed out.` in its initial phone-five setup. The original screenshot showed the name field and keyboard. The save read after driver shutdown contained a new revision-zero game. These are observations from different times, not proof that the whole setup succeeded before timeout. The original attempt remains retained; a fresh failed-group retry is independent of that simulator.

The production RPC transport can time out when one authored setup request contains enough individually short commands to exceed its request budget. `batches.test.mjs` reproduces that pattern at a scaled budget and passes after partitioning the unchanged commands. It also checks exact command preservation, rejection before execution, and stopping without replay after an uncertain batch.

This test does not establish why the native driver was slow. Cold startup alone or a stalled UI operation can still fail. Current-source macOS qualification is required, and the new timing receipts help distinguish those cases. Do not describe this change as a universal native-driver reliability fix or as physical-device acceptance.
