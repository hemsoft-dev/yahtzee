# Isolated owned confirmation qualification

Refs [issue 41](https://github.com/hemsoft-dev/yahtzee/issues/41). The existing corrupted-storage and explicit-reset contract applies. Open and closed duplicate searches and the current issue/comments were checked before implementation; no new issue was created.

## Why this route exists

At source896322b6, [ordinary run42215192981](https://github.com/hemsoft-dev/yahtzee/actions/runs/42215192981) passed phone5, phone6 and tablet8 gameplay. Tablet10 failed in the initial Help/Done flow after positive Done handling and React root commit, followed by a driver screenshot timeout and transport loss. Only tablet10 ordinarily runs corruption/reset, so no group reached the new owned alert observer. This does not prove a reset, gameplay or observer defect. The old failure and its public attachment HTTP404 limitation remain unchanged.

## Minimal prerequisite and actual reuse

The actual app's `store.load()` reads storage, creates an empty migrated document when no save exists and awaits `writePending()` before publishing Setup. The existing corruption helper needs a readable saved document; it does not use a played game or completed history.

`bun scripts/ios-native/run.mjs --modal-only` therefore uses one newly owned iPad simulator and the same source/run/lock-bound built app. Its separate bootstrap only launches with fresh data, sets portrait orientation, asserts Setup and captures the prerequisite screen. A real `saved()` SQL read and decode must prove an unnamed empty document with no active game, history or high scores. Its exact bytes/hash are retained in the receipt. Failure stops the route before corruption. No Help/Done or game is played as a prerequisite.

It then calls the **existing `corruption()` helper exactly once**. That helper still injects the same damaged-save value and physical database fixture, runs `corruptFlow`, calls the real `confirmReset` helper and checks the same deletion/relaunch assertions. The original reset actions, Cancel/reopen sequence, enabled target geometry, wait bounds, no-replay rules and deadlines are unchanged. It reaches the real app's Help screen and RNAlertManager-owned confirmation, not a lookalike UIKit fixture.

Native/modal prefixes are retained by the existing finally boundaries after each interaction and before simulator cleanup. The direct route also retains its overall prefix, driver identity/logs, original error, input/Done channels and a recording. Its process/window records and synthetic marker retention use the unchanged observer and readers. Retention failures cannot turn the original interaction into success. As before, collectors ending143 remain unavailable, asynchronous native prefixes remain partial and absent records prove nothing.

## Hosted route and evidence separation

The added `Owned reset modal qualification` job depends only on the ordinary same-run native build and classification. It runs automatically for the source change on the same pinned macOS/toolchain/CLI, downloads the same head's build artifact and invokes `--modal-only`. It uploads `ios-native-owned-modal-<head>` independently, including failure evidence. There is no manual dispatch or unchanged rerun.

The original four-group matrix and its actions/assertions remain unchanged. During the [issue #130 incident policy](https://github.com/hemsoft-dev/yahtzee/issues/130), the modal job still runs automatically and retains failure evidence, but its result and the device-group/settle results are advisory to `quality-gate`. There is no per-flow skip. The aggregate reports their actual outcomes and retains all core required checks. A passing aggregate is not modal or ordinary native acceptance. Restore mandatory outcomes only under the tracked condition in issue #130. No branch-protection setting, assertion or interaction budget is changed.

Receipts use the distinct kind `unsigned-ios-owned-modal-tests` and scope `isolated-modal-diagnostic-not-ordinary-matrix-acceptance`, with `modalRoute` and `nativeCorruptionObservations`. Ordinary grouped invocation retains its existing kind and behavior. `--modal-only` cannot combine with build, refresh, group or other arguments.

## What a result can establish

A new source-bound run must compile the native controls, install the owned methods and retain actual eligible-window adoption, finite dispatch/target and show/hide records from this app. After both existing corruption sequences succeed, a separate diagnostic gate requires a valid retained single-process prefix containing owned-window adoption, a positively returned ended-touch dispatch at the known destructive Delete target and hide entry/return in that same window. Cancel-only, unknown-target, began-only or cancelled touches cannot satisfy it. It cannot combine boundaries across windows or files. Missing or malformed evidence records capability as unavailable and fails this isolated job; UI assertions alone cannot pass the diagnostic. Prefixes remain partial even when positive records satisfy this gate.

Runtime shapes may remain unsupported, target enums may stay unknown, or the driver may fail before the relevant boundary. The direct callback remains `unavailable-cxx-reference-abi`; no unsafe generated-argument hook is added. Dispatch/show/hide are not callback, durable reset, dismissal completion, paint or AX proof. Recognizers remain candidates; native owner/reason stays UNKNOWN without causal evidence. Conditional clock/coordinate samples do not calibrate video or JS. Package/source fingerprints are not loaded-image attestation.

Direct success proves only this diagnostic's actual modal capability and its authored synthetic corruption assertions on this run. It does not explain an old failed touch, clear historical failed ordinary qualification, establish physical-device/App Store acceptance or close issues41/102/112/115. Original evidence, held PR114 files and full ordinary qualification remain separate gates.

Local routing/error/prerequisite tests use controlled ports, not an iOS simulator. Native feasibility is source-supported, but bootstrap persistence, real confirmation routing, adoption, dispatch and retention are unvalidated until this new hosted execution.
