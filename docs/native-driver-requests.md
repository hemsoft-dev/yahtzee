# Native driver request limits

Native qualification keeps one local Maestro connection per scenario. The app still undergoes a real termination and cold relaunch. No scenario, saved-document assertion, hold/reroll effect, completion assertion or corruption/reset check is omitted.

Authored setup, resume and results-navigation YAML uses single-line JSON command values. `batchAuthoredFlow` validates the complete input first, then partitions it into at most eight commands per request. Each batch retains the same app header. Concatenating the batch commands reproduces the original commands byte for byte and in order. There is no new launch, clear-state operation or driver connection between batches.

`runAuthoredFlow` awaits each batch. A thrown or uncertain command stops the sequence. It never retries a batch, continues with later commands or restores a save. The existing five-minute RPC limit, ten-minute scenario deadline, output bound and environment allowlist remain unchanged. Geometry-sensitive holds, rerolls and score taps keep their existing individual actual-effect checks and no-retry behavior.

`scenario-tool-timing.jsonl` records the tool name, flow sequence, start timestamp, elapsed milliseconds and whether the call returned or threw. It does not record arguments, response bodies, environment values or error contents. A returned call is transport telemetry, not proof that an application action happened. The corresponding retained YAML and application/save assertions remain authoritative. Timing telemetry is best-effort. If its artifact cannot be appended, one fixed diagnostic notice is recorded without changing the tool result, replacing a transport exception or replaying a request. Error/argument text is never copied into timing entries, including failed calls.

## Required lifecycle, without phase-boundary restarts

The persistent scenario previously emitted seven app-launch commands for a full game. Four belonged to old phase-boundary setup: foreground before holding, restart and Resume Game after an already verified cold resume, foreground before scoring, and foreground before reading results. These are not four additional acceptance scenarios. They can interrupt the existing context and consume the unchanged interaction budget.

The persistent caller now declares an already-foreground context only after authored setup or verified resume. Helpers still wait for the reroll control, inspect target geometry, validate held/rerolled saved effects, inspect recorded scores and read persisted completion. Standalone helper defaults retain their foreground launch.

Three app launches remain for each full game: fresh setup, the resume after actual simulator termination, and the restart that verifies a persisted result from History. Largest-text cases retain fresh setup and actual cold resume. `completeReadyFlow` checks the resumed reroll state and score viewport, waits under the same animation bound and captures readiness without restarting the game again. Results, History, Help, diagnostic cancellation and Play Again remain required.

[Stacked PR62 qualification](https://github.com/HemSoft/yahtzee/actions/runs/36833073038) retained original and fresh failures. Phone-six and tablet-eight still exhausted the cumulative interaction deadline on the fresh attempt. The passing source's phone-six solo trace handled more framing swipes than the failing trace. A failing trace spent 91,413ms in required cold-resume navigation and 44,693ms in the redundant pre-score restart. These are measured whole-request durations, not guaranteed savings or proof of an underlying simulator defect.

The red-before-green lifecycle regression executes the production scenario and records emitted commands. It pins exactly three required launch commands and one Resume Game tap, actual termination, exact-byte save stages and unchanged hold/reroll/score effects. A matrix test covers all authored modes, AI counts and largest-text cases. This proves command/lifecycle preservation, not native performance. New source-bound hosted qualification is still required; startup/device-unreachable failures are not assumed fixed.

## What the controlled regression proves

[PR62 qualification](https://github.com/HemSoft/yahtzee/actions/runs/36821189887) hit `Local Maestro tools/call timed out.` in its initial phone-five setup. The original screenshot showed the name field and keyboard. The save read after driver shutdown contained a new revision-zero game. These are observations from different times, not proof that the whole setup succeeded before timeout. The original attempt remains retained; a fresh failed-group retry is independent of that simulator.

The production RPC transport can time out when one authored setup request contains enough individually short commands to exceed its request budget. `batches.test.mjs` reproduces that pattern at a scaled budget and passes after partitioning the unchanged commands. It also checks exact command preservation, rejection before execution, and stopping without replay after an uncertain batch.

The fresh PR62 retry failed during initial setup with `Local Maestro did not close within 60 seconds.` Its screenshot showed the simulator Home screen and its retained save was empty. A separate red-before-green test confirms that shutdown failure could overwrite an earlier phase exception. The interaction now retains the original phase failure and records a fixed shutdown-failure notice. If exercise succeeded but shutdown fails, qualification still fails. Required diagnostic-log write failures follow the same rule: preserve an earlier phase exception, but fail an otherwise successful phase if its required log could not be written. Real filesystem-failure tests pin both outcomes. This corrects error attribution; it does not make a timed-out operation successful.

This test does not establish why the native driver was slow. Cold startup alone or a stalled UI operation can still fail. Current-source macOS qualification is required, and the new timing receipts help distinguish those cases. Do not describe this change as a universal native-driver reliability fix or as physical-device acceptance.
