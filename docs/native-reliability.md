# Mid-flow native driver loss

For [#91](https://github.com/hemsoft-dev/yahtzee/issues/91), qualification now retains XCTest runner logs and host telemetry, and selecting an already-current setup value no longer writes to storage. The continuous H.264 recording of the first scenario stays on. Screenshots, all ten scenarios and every app/save assertion remain required. No flow is replayed, no timeout is increased and no device/runtime/tool version changes. These changes make failures explainable. They are not a cure, and #91 stays open.

## Evidence from the #90 rounds

The verified retained failures below all occur in the first scenario, where the harness starts `simctl io recordVideo --codec=h264` before Maestro initialization and leaves it active throughout the scenario. Subsequent scenarios did not record video. Cold boot and the first driver connection also coincide with that first scenario, so the historical data alone cannot separate recording load from those causes.

| Run | Group | Submitted flow | Transport response |
| --- | --- | --- | --- |
| [40879146736](https://github.com/hemsoft-dev/yahtzee/actions/runs/40879146736) | tablet-8 | 3 | deviceInfo unreachable |
| [40883466280](https://github.com/hemsoft-dev/yahtzee/actions/runs/40883466280) | tablet-10 | 1 | isScreenStatic unreachable |
| [40896228567 attempt 1](https://github.com/hemsoft-dev/yahtzee/actions/runs/40896228567/attempts/1) | phone-6 | 2 | eraseText unreachable |

The earlier [40874444527](https://github.com/hemsoft-dev/yahtzee/actions/runs/40874444527) tablet-10 error was a missing picker option, not a proven transport failure. It is not counted as device loss.

The phone-6 failed artifact and its passing rerun were verified against every manifest size and SHA-256. Both used ARM64 runner image `20261021.0445.8`. Failed first inspection took 131.7 seconds; the passing rerun took 166.4 seconds. Slow readiness therefore does not uniquely predict transport loss. The three other passing groups in that run had first inspections of 62.2, 102.6 and 89.7 seconds on image `20261013.0424.1`. Device loss crosses phone/tablet types and image versions.

The boot traces finish with `isTerminal=YES` and `Finished`. Their printed status 4294967295 is not a process exit error; the harness already rejects process timeouts and nonzero exits. This is not evidence for restarting an incompletely booted simulator. Each matrix group runs on its own hosted runner and creates one simulator for its scenarios; four matrix jobs do not mean four concurrent simulators on one machine.

Standard [GitHub ARM64 macOS runners](https://docs.github.com/en/actions/reference/runners/github-hosted-runners) have three CPUs and 7 GB RAM. That makes full-resolution encoding a plausible contention source, but the old artifacts lack pressure or crash evidence and do not establish OOM. No claim of a measured pressure threshold is made.

## Driver lifecycle and diagnostics

Pinned [Maestro 2.10.0's MCP session manager](https://github.com/mobile-dev-inc/Maestro/blob/cli-2.10.0/maestro-cli/src/main/java/maestro/cli/mcp/McpMaestroSessionManager.kt) caches a session by device ID and starts its XCTest driver using xcodebuild. Its [XCTest client](https://github.com/mobile-dev-inc/Maestro/blob/cli-2.10.0/maestro-ios-driver/src/main/kotlin/xcuitest/XCTestDriverClient.kt) latches transport death after an IOException. The reported operation alone does not distinguish a crashed runner, refused socket, EOF or read timeout.

Previously MCP stderr retained only the top-level error, while the xcodebuild/XCTest output went to Maestro's state directory outside the published artifact. Each phase now gets a hidden isolated XDG state directory. Only known XCTest log names are copied out, bounded to eight 512-KiB complete-line tails and sanitized using the existing credential redactor. Raw state directories remain excluded from the snapshot. Host telemetry records bounded CPU/load/RAM/VM-page and selected process samples, without arguments or environment values, then retires its timer before snapshot publication.

## Recording-removal experiment

The head `c9ad2e4` removed recording as an experiment. That removal was not kept. Its planned ten-run campaign stopped after four complete runs. Chief cancelled trials 5–10 on October 29 around 5:30 PM EDT because 26 queued macOS jobs from the P4 experiment were starving P0–P2 CI on shared organization slots. Cancelled runs and their partial jobs are excluded, not counted as passes.

| Run | phone-5 | phone-6 | tablet-8 | tablet-10 | Failure class |
| --- | --- | --- | --- | --- | --- |
| [Main trial](https://github.com/hemsoft-dev/yahtzee/actions/runs/40914934977) | Failed | Passed | Passed | Passed | application-flow, Dice-count sheet missing, flow 4 |
| [Trial 2](https://github.com/hemsoft-dev/yahtzee/actions/runs/40914956333) | Passed | Passed | Passed | Passed | none |
| [Trial 3](https://github.com/hemsoft-dev/yahtzee/actions/runs/40915027847) | Failed | Passed | Passed | Passed | transport-uncertain/device-unreachable during deviceInfo, flow 1 |
| [Trial 4](https://github.com/hemsoft-dev/yahtzee/actions/runs/40915033038) | Passed | Passed | Passed | Passed | none |

There are 14 passing groups, one application-flow failure and one transport-uncertain failure in 16 group executions. Two fully observed #90 baseline rounds, [40883466280](https://github.com/hemsoft-dev/yahtzee/actions/runs/40883466280) and [40896228567 attempt 1](https://github.com/hemsoft-dev/yahtzee/actions/runs/40896228567/attempts/1), each lost one of four groups: two transport failures in eight groups. That is the observed 25% baseline versus 6.25% in this smaller-than-planned campaign. The other verified #90 loss, 40879146736, had three cancelled groups and is not included in the complete-run baseline denominator. The earlier picker error was application-flow, not transport loss.

This sample does not prove that removing recording caused improvement. Trial 3 still lost the driver: its retained XCTest log reports `testHttpServer` failing because a screenshot request timed out, followed by teardown. The transport error is a consequence of that driver-server failure, not an application assertion. Its host diagnostics show high load and VM pressure indicators; the remaining hypothesis is resource pressure disrupting XCTest screenshot/runner work. An OOM kill is not established.

Later results did not separate the two either. [The count on #91](https://github.com/hemsoft-dev/yahtzee/issues/91#issuecomment-6575823661), taken November 2, 2026, has 7 of 48 group executions failing with recording and 2 of 16 without it. Those samples are small, and no benefit could be measured.

Native reliability is now measured from ordinary PR and main runs, with no dedicated trial runs: the ten-run campaign would cost about 50 macOS jobs on shared runners. Repeating failed application flows is still prohibited.

## Why the recording stays

`native-resume.mp4` is a passive engineering recording; no scenario assertion, source-bound artifact verification, release acceptance check or screenshot validator consumes it. It stays because it answers something the logs cannot. XCTest logs show that a tap was sent, not when the app reacted. On [run 41347132185](https://github.com/hemsoft-dev/yahtzee/actions/runs/41347132185), the video showed a Dice-count sheet opening about 20 seconds into its flow in the first attempt, and no sheet at all in the second.

Recording may still add load. Host telemetry samples the `simctl` process alongside the driver, so runs now carry both, and removing recording can be decided on that evidence. Qualification also requires setup/held/rerolled/resume/results/history/help/reset screenshots, authored YAML, native geometry, before/after SQLite documents, exact-byte cold-resume comparison, completion effects and the manifest hash inventory. Tool timing and sanitized driver logs are retained when available, but a run can pass without them. The real termination and UI relaunch/resume remain in `exerciseScenario`. Every group and the aggregate quality gate remain required.

The video does not prove an app action; the independent UI and saved-state assertions still do that. Store-preview video is separate, optional/deferred work.

## Choice-sheet failure observed during the campaign

The automatic PR run on `c9ad2e4` failed phone-5 flow 4 at the Dice-count sheet presentation assertion. Flow 3 had already opened the AI sheet, matched `Current: .*`, selected Solo and verified dismissal. The retained XCTest log then records one Dice-count tap at (201,580), and the failure screenshot shows setup with no sheet. There is no evidence of changed message text or a late-open sheet; an unobserved brief presentation cannot be ruled out. This is an application-flow failure and is counted separately from transport loss. The same Solo-to-Dice-count path failed in #90 with video active and here without it, so recording is not established as its cause.

The store previously wrote preferences and disabled setup controls even when selecting the already-current Solo or dice value. A blocked-storage regression reproduces that unnecessary busy interval. The fix acknowledges validated identical preferences without publishing busy state or writing storage, while changed, pending, invalid and in-flight writes keep their existing behavior. This removes a concrete race opportunity after Solo selection; it is not proof of the exact UIKit event sequence in the artifact. It also does not explain every Dice-count failure: in the second attempt on run 41347132185, the video shows the busy state lasting about 60 ms and ending about 5 seconds before the Dice-count flow began. All sheet-presentation/dismissal assertions and single-tap rules remain required.

Host telemetry during the failed run records one-minute load above 500, free memory (`os.freemem()`) under 200 MiB, and growing compression/page-in counters. On macOS, free memory can exclude reclaimable cached memory, so a low value alone doesn't show memory pressure. This is stronger direct evidence of host contention than the earlier readiness timings, but is not proof of an OOM kill or of causation for this assertion. The first telemetry implementation could not sample while the main loop blocked in spawnSync. The observer uses a separate worker loop with bounded samples and atomic checkpoints, then awaits worker retirement before evidence publication. A real blocking-command regression passes under Node and Bun, and an initialized observer cannot keep an exiting parent alive.
