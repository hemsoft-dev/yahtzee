# Mid-flow native driver loss

The intervention for [#91](https://github.com/hemsoft-dev/yahtzee/issues/91) removes continuous H.264 simulator recording from functional qualification. Screenshots, all ten scenarios and every app/save assertion remain required. No flow is replayed, no timeout is increased and no device/runtime/tool version changes. This is a testable source-level mitigation for recording contention, not an established cure.

## Evidence before the change

The verified retained failures below all occur in the first scenario, where the previous harness started `simctl io recordVideo --codec=h264` before Maestro initialization and left it active throughout the scenario. Subsequent scenarios did not record video. Cold boot and the first driver connection also coincide with that first scenario, so the historical data alone cannot separate recording load from those causes.

| Run | Group | Submitted flow | Transport response |
| --- | --- | --- | --- |
| [40879146736](https://github.com/hemsoft-dev/yahtzee/actions/runs/40879146736) | tablet-8 | 3 | deviceInfo unreachable |
| [40883466280](https://github.com/hemsoft-dev/yahtzee/actions/runs/40883466280) | tablet-10 | 1 | isScreenStatic unreachable |
| [40896228567 attempt 1](https://github.com/hemsoft-dev/yahtzee/actions/runs/40896228567/attempts/1) | phone-6 | 2 | eraseText unreachable |

The earlier [40874444527](https://github.com/hemsoft-dev/yahtzee/actions/runs/40874444527) tablet-10 error was a missing picker option, not a proven transport failure. It is not counted as device loss.

The phone-6 failed artifact and its passing rerun were verified against every manifest size and SHA-256. Both used ARM64 runner image `20261021.0445.8`. Failed first inspection took 131.7 seconds; the passing rerun took 166.4 seconds. Slow readiness therefore does not uniquely predict transport loss. The three other passing groups in that run had first inspections of 62.2, 102.6 and 89.7 seconds on image `20261013.0424.1`. Device loss crosses phone/tablet types and image versions.

The boot traces finish with `isTerminal=YES` and `Finished`. Their printed status 4294967295 is not a process exit error; the harness already rejects process timeouts and nonzero exits. This is not evidence for restarting an incompletely booted simulator. Each matrix group runs on its own hosted runner and creates one simulator for its scenarios; four matrix jobs do not mean four concurrent simulators on one machine.

Standard [GitHub ARM64 macOS runners](https://docs.github.com/en/actions/reference/runners/github-hosted-runners) have three CPUs and 7 GB RAM. That makes unnecessary full-resolution encoding a plausible contention source, but the old artifacts lack pressure or crash evidence and do not establish OOM. No claim of a measured pressure threshold is made.

## Driver lifecycle and new diagnostics

Pinned [Maestro 2.10.0's MCP session manager](https://github.com/mobile-dev-inc/Maestro/blob/cli-2.10.0/maestro-cli/src/main/java/maestro/cli/mcp/McpMaestroSessionManager.kt) caches a session by device ID and starts its XCTest driver using xcodebuild. Its [XCTest client](https://github.com/mobile-dev-inc/Maestro/blob/cli-2.10.0/maestro-ios-driver/src/main/kotlin/xcuitest/XCTestDriverClient.kt) latches transport death after an IOException. The reported operation alone does not distinguish a crashed runner, refused socket, EOF or read timeout.

Previously MCP stderr retained only the top-level error, while the xcodebuild/XCTest output went to Maestro's state directory outside the published artifact. Each phase now gets a hidden isolated XDG state directory. Only known XCTest log names are copied out, bounded to eight 512-KiB complete-line tails and sanitized using the existing credential redactor. Raw state directories remain excluded from the snapshot. Host telemetry records bounded CPU/load/RAM/VM-page and selected process samples, without arguments or environment values, then retires its timer before snapshot publication.

## Fixed-head measurement

The PR is the live record for at most ten consecutive full native qualification runs on one implementation head. The automatic PR run is trial 1; nine `workflow_dispatch` trials execute the same complete quality workflow and all four native groups. Dispatches have independent concurrency groups so they cannot cancel one another. Each run uses fresh hosted jobs and a source-bound build. No failed-job reruns are included in this campaign.

Every run and per-group outcome must be recorded in the PR, including app/assertion failures and setup failures. Pending, cancelled or missing groups are not passes. Count `transport-uncertain` failures from retained receipts, not from an aggregate red check. The acceptance target is at most one such failure across the ten full runs. If the target is missed, report the observed result and use the retained host/XCTest diagnostics to state the remaining hypothesis; do not add more trials or replay flows to obtain green evidence.

Until that measurement completes, continuous recording is a plausible correlate and the change is an unverified mitigation. If loss persists, distinguish driver crashes from live but stalled XCTest requests using the new logs and process samples before changing device types, architecture or lifecycle.
