# Unsigned iOS simulator qualification

The native jobs in [Application quality](../.github/workflows/quality.yml) use standard public GitHub-hosted macOS runners. They do not use Apple credentials, a paid device cloud, signing, upload, TestFlight or App Store submission. The result is a simulator app, not an installable iPhone archive.

## Inputs

- macOS 26 runner, with the actual runner image version recorded in the receipt.
- Xcode 26.6, build 17F113, selected explicitly at `/Applications/Xcode_26.6.app`.
- iOS Simulator SDK/runtime 26.5; iPhone 17 and iPad Pro 13-inch M5.
- Node 24.12.0, Bun 1.4.2, CocoaPods 1.17.0 and Java 17.
- Maestro CLI 2.10.0, downloaded from its [versioned release](https://github.com/mobile-dev-inc/Maestro/releases/tag/cli-2.10.0) and checked against SHA-256 `29b675e10cc12080e445e9bfb2e2b4e4dfb9c0f2e30d5884120d258b5e1cd991`.
- The committed Bun lock, Expo app configuration and reviewed CocoaPods lock.

The workflow checks actual tool versions rather than relying on the runner's default Xcode. Hosted images still change. A changed toolchain requires a reviewed pin update; these commands do not promise bit-identical Xcode output across hosts.

## Generated native project

Expo prebuild generates `apps/mobile/ios` from source configuration. This directory is ignored. The runner refuses an existing native directory rather than deleting local work. Run it in a fresh macOS checkout with the listed tools after `bun install --frozen-lockfile --ignore-scripts`:

```sh
bun scripts/ios-native/run.mjs
```

The initial bootstrap retains its generated Podfile.lock as an artifact and remains non-passing until that lock is reviewed and committed at `apps/mobile/native/Podfile.lock`. Subsequent builds copy it into the generated project and use `pod install --deployment`; dependency drift fails the job. For an intentional update, `--refresh-pods` generates a replacement in a fresh checkout. A missing or changed lock stops before compilation and remains non-passing until source matches. Refresh-only mode always stops before compilation, even if the lock did not change.

For hosted regeneration, apply the `native-pods-refresh` PR label before pushing the dependency change. Download its retained lock, inspect and commit the change, remove the label, then repeat normal qualification. Adding a label alone does not start this workflow, and reruns retain the original event's label snapshot. The refresh job intentionally fails and cannot satisfy the required quality gate. Do not bypass that check or call a bootstrap a qualified release.

Build configuration is Release, `CODE_SIGNING_ALLOWED=NO`, with an embedded Hermes/JavaScript bundle. The simulator app targets the current host architecture, recorded in the manifest, rather than compiling an unused second simulator slice. It is not a universal Mac distribution. No Metro server is started. The compiled bundle identifier, version, build and minimum iOS 17.0 must match source. The proposed 1.0.0/build 1 and existing development identifiers are not approved public identity or an App Store reservation.

## Packaged privacy resources

The runner inspects the actual app's privacy manifests, purpose strings, update configuration and encryption-declaration field. It requires Expo FileSystem's bundled manifest to match the locked SDK source and its API reasons to appear in the aggregate. Only Expo FileSystem opts into source compilation because the inspected SDK 57 precompiled package omitted that resource. See the [engineering inventory](mobile-privacy-audit.md) for the reproduced finding and evidence limits. This check does not approve privacy answers, SDK signatures or export classification.

## Native interaction matrix

CI compiles once with `--build-only`, then downloads that same run's artifact into four test jobs: `phone-5`, `phone-6`, `tablet-8` and `tablet-10`. Each runs `--test-group=<group>` after verifying the build's source, workflow run, architecture, Bun lock, app identity and every retained file hash. Archive extraction rejects traversal, links and special files. A stale or refresh-only build cannot feed qualification. Every group remains required by the quality gate.

Each group completes solo and three-AI games for its mode. Phone 6 and tablet 10 also cover largest text; tablet 10 covers corrupt-document/database recovery. Group tests prove the ten scenarios are assigned exactly once. This avoids repeating compilation and prevents the measured serial workload from exceeding a one-hour job.

Each job creates and later deletes only its own simulators. First boot has a bounded ten-minute allowance, and captured command output is retained even after timeout. It runs all four modes with solo and three AI opponents, plus a largest-Dynamic-Type start/resume case on both device families. Normal cases cover light/dark and portrait/landscape, complete scoring, native History/Help navigation, cold relaunch and Play Again.

Each scenario uses one bounded, pinned local stdio MCP driver session for setup, hold/reroll, cold app resume, scoring and results navigation. That combined session has a twenty-minute budget; individual driver calls remain capped at five minutes and shorter hold/completion sessions retain ten minutes. The viewer is disabled. Authored flow files and geometry-checked interactions share that connection; creating one driver does not replace terminating and relaunching the app. Each start holds a die and rerolls through that session. In expanded play, die gestures stay inside the left scroll pane; compact play uses the shared scroll pane. The die must fit fully inside that pane, and the fixed reroll action must fit inside the play area. Each action is tapped once, without retry. Holding must change only the held index and revision in the real SQLite document. Rerolling must preserve the held face and every other saved field except unheld dice, rolls remaining and revision. UI acknowledgments precede both saved-state comparisons. React Native's iOS checkbox exposes `checkbox, checked, Held` in its accessibility value; the pinned Maestro driver's generic `checked` boolean stays false for that element.

The landscape phone failure that prompted this guard placed the die at y320..400 behind a footer action. Maestro reported full screen visibility, then its tap at130,360 rerolled instead of holding. The new driver uses the actual pane bounds and checks the persisted effect before any next action. A contract regression and captured-geometry tests cover this failure. They do not substitute for the required native run.

The native accessibility hierarchy exposes the play View's test ID as a leaf beside its children. Ownership checks therefore accept real ancestry or this leaf-marker shape in the same immediate container, always with full geometric containment. They do not accept a marker from another container. The die must still descend from its actual scroll view. A retained native hierarchy excerpt tests this distinction; the earlier ancestry-only guard stopped all four groups before any hold tap.

The runner then terminates the process, resumes through the UI and compares the entire document byte-for-byte. Name entry submits the keyboard's Return key. It does not use Maestro's coordinate-swiping keyboard dismissal. Completion first waits for resumed gameplay and the actual score viewport. Its scoring phase retains the scenario's existing driver connection. `inspect_screen` supplies native row and scroll-view rectangles. A row must fit inside its own viewport, clear its top and bottom edges, and be enabled before a single tap at its inspected center. Short one-second swipes use coordinates calculated from the current viewport, never fixed device coordinates. Missing rows use the visible category order to choose a direction. Each category has at most 30 inspections; the entire scenario session has a twenty-minute deadline and bounded shutdown. Each inline flow must target the owned application and fit the existing message bound. Executed YAML, inspection snapshots and geometry decisions are retained under the `scenario` prefix.

This replaces `centerElement`, which accepted One Pair after a swipe moved it behind the toolbar and the tap opened Help. The pinned driver uses a one-sided screen threshold, not scroll-view containment. Its `above` and `below` selectors also compare top positions, not full rectangles. Slowing that gesture alone would leave the unsafe reachability assumption intact.

Dice, scoring and results phases explicitly foreground the existing app with `launchApp`, `stopApp: false` and `clearState: false`. They do not restart gameplay or reset saved data. All permissions remain denied. Foregrounding alone is not proof that a tap worked. Source `9373563` passed both phone groups in two runs, but its regenerated tablet-eight evidence showed a single tap on a fully reachable die with no UI or saved-state acknowledgment; tablet-ten also missed a setup choice-sheet transition. The previous runner repeatedly changed CLI/MCP drivers between phases. A persistent scenario connection removes those boundaries as a reversible diagnostic experiment, not a proven root-cause repair. It cannot establish acceptance until its own complete native matrix and effects pass; the tablet-ten failure happened within a CLI phase, so persistence might not resolve every missed transition. Diagnostic cancellation scrolls to its action and requires the cancel control and preview to disappear while the Help preview action remains visible.

Scoring never retries a tap. It requires the recorded-score label and disabled state before the next category, or Game Over after the last one. The generated command, native rectangles, chosen gesture, acknowledgment and ready-to-tap screenshot are retained. Only local device listing, inspection and command execution are allowed through this client. Child environment variables are allowlisted, protocol replies are size/time bounded, and raw replies containing injected environment fields are not logged. Transport and captured-geometry tests do not establish native-runtime acceptance. Completion must produce one history record. Further cases deliberately damage the saved JSON and then the database file, verify preservation after failed loading, cancel reset, and complete an explicit reset through the native alert.

Maestro taps use accessibility text and test IDs. Die and score gestures derive from the current native viewport geometry, not screenshot-coordinate guesses. Screenshots cover setup, held/rerolled play, resume, results, history, help, diagnostic preview, Play Again and recovery. A simulator recording covers the first scenario, including its completion phase. The status bar is standardized to 9:41 for captures. Test names are synthetic.

This is not airplane-mode, hardware durability, VoiceOver, Switch Control, iPad Stage Manager window-resize or signed-distribution acceptance. Browser-adapter results do not substitute for the native run. Review actual screenshots in one batch, apply one layout correction batch, then confirm. Functional failures still require diagnosis.

## Receipts and retention

`reports/native-evidence/manifest.json` records the exact checked-out source commit, toolchain, runner, device/runtime, scenarios, timestamps and SHA-256 hashes of retained artifacts. Pull requests check out their exact head for native captures. The runner freezes working files from `reports/native` into `reports/native-evidence` before hashing and upload. Size and hash come from the same copied bytes. Later writes from detached XCTest processes cannot change that snapshot. An always-run workflow step also freezes partial receipts when execution ends early. The required quality gate includes every native job. A screenshot file's existence alone is not visual review or release approval.

The build artifact includes the unsigned simulator app, native dependency lock, compiled Info.plist and privacy inspection. Each test-group artifact includes screenshots, a recording, test reports, synthetic database snapshots and the verified build reference. Raw hidden debug trees are excluded by the uploader and the published hash inventory. Known Maestro driver logs are copied into ordinary artifact files after credential-value/header redaction, including on failure. The interaction client also retains bounded, redacted stderr and the latest native hierarchy; it captures the screen on failure without repeating a hold, reroll or scoring action. DerivedData and installed Pods are not uploaded. Retention is one day to keep storage bounded. Download current-head evidence before it expires, inspect it, and attach the selected images and recording to the PR's Validation section.

These engineering PNGs can contain alpha channels even when every pixel is opaque. They are not ready for App Store upload merely because a native test passed. See [screenshot validation](ios-screenshot-validation.md) for the separate format checks and remaining capture requirements.

References: [GitHub macOS 26 runner inventory](https://github.com/actions/runner-images/blob/main/images/macos/macos-26-Readme.md), [Maestro local CLI](https://docs.maestro.dev/maestro-cli/maestro-cli-commands-and-options.md), [Expo SQLite](https://docs.expo.dev/versions/v57.0.0/sdk/sqlite/).
