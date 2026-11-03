# Draft simulator screenshots

This workflow prepares fictional display states for visual review. It does not produce approved App Store assets, upload anything or prove that a signed candidate matches these images.

## Ordered scene plan

The source [plan](../scripts/ios-capture/plan.ts) defines six scenes per device family.

| Order | Scene | Mode | Appearance | What it shows |
| --- | --- | --- | --- | --- |
| 01 | Setup | Five dice, solo | Light | Local name and game settings |
| 02 | Holding | Six dice, solo | Dark | Three held fives, one reroll left |
| 03 | Scoring | Eight dice, solo | Light | An available three-of-a-kind worth 15 |
| 04 | Bonus opportunity | Ten dice, solo | Dark | Five recorded upper scores total 75, with a 30-point Sixes score available to reach 105 |
| 05 | Results | Six dice, three AI | Light | A completed fictional game |
| 06 | History | Six dice, three AI | Dark | Local rankings from two fictional games |

Maya and the bot names are fictional. The [fixture generator](../scripts/ios-capture/fixtures.ts) scores chosen hands with the shared engine and validates the entire document through the same save decoder as the app. It does not patch random-number or Date globals, add a capture mode to the application, or inject hooks into its binary. Results are preloaded examples, not evidence that these games were played or that the AI achieved these scores.

Setup preloads Maya with an empty recent-name list. The extra `Use Maya` shortcut in the earlier fixture pushed Appearance below the initial scroll boundary. [PR #108](https://github.com/hemsoft-dev/yahtzee/pull/108) omitted that redundant shortcut, but its medium-phone framing still clipped the introduction. Retained native run [41651073579](https://github.com/hemsoft-dev/yahtzee/actions/runs/41651073579) placed the title at y101–135 and Appearance at y739–812 inside a y164–840 viewport. Their 711-point span cannot fit in 676 points by scrolling.

The real Setup screen now uses a four-point outer content gap instead of the shared sixteen-point gap. Section margins still separate groups; text sizes, Dynamic Type, control padding and touch targets remain unchanged. This removes sixty points of repeated spacing across the five outer gaps. The ScrollView still scrolls when smaller screens, larger text, recent names or saved-game content require it. This is normal application layout, with no capture-only condition. Capture readiness requires the whole title, subtitle, Players, name, AI choice, Game, dice choice, rules, Start Game and Appearance choice to fit inside every native ancestor. It fails on clipping instead of scrolling the introduction away. The native regression fixture retains the failed medium-phone bounds. Save bytes must remain unchanged.

Current-head native regeneration and full-size review are required before this correction can be called visually verified. Draft receipts remain unaccepted.

## Device profiles

Apple's [current screenshot specifications](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/) were checked on November 3, 2026, EST. The required-device section now explicitly names iPhone with Dynamic Island, medium display, and iPad 13-inch. Draft profiles cover iPhone 17 Pro at 1,206 by 2,622 pixels for that medium set, iPhone 17 Pro Max at 1,320 by 2,868 for an additional large set, and iPad Pro 13-inch M5 at 2,064 by 2,752. All are portrait, en-US, standard text size. The runner refuses a screenshot whose dimensions differ. It does not stretch smaller engineering captures to fit. The published iPhone Duo requirement begins in April 2027 for apps using the iOS 27.1 SDK or later; this candidate uses SDK 26.5.

These profiles are a proposed coverage set. There is no App Store Connect listing against which to verify required families, localization, additional display sets or uploaded order. The separate native qualification matrix still covers other modes, orientations and largest text; draft images do not replace those tests.

## Regeneration

Use a fresh macOS checkout, the [native qualification toolchain](native-simulator.md) and a verified unsigned build from the same commit and workflow run under `reports/native-build`. Then run one device profile with an explicit selection:

```sh
bun scripts/ios-capture/run.mjs --profile=phone-63 --scene=all --appearance=scene
bun scripts/ios-capture/run.mjs --profile=tablet-13 --scene=bonus --appearance=dark
```

Each command requires fresh output paths. The commands above are examples for separate clean checkouts, not consecutive runs that overwrite each other. Allowed scenes are `all`, `setup`, `holding`, `scoring`, `bonus`, `results` and `history`. Appearance is `scene`, `light` or `dark`. The [draft workflow](../.github/workflows/ios-capture-drafts.yml) builds once, then captures all three profiles on separate runners. Every push to the owned capture branch triggers fresh evidence, including an app-only rebase. Capture-only path filters would leave a new source head without its required matching build. After merge, the manual workflow can regenerate a selected ref. It is separate from the required gameplay matrix and has no signing or publication stage.

The runner creates its own simulator and reinstalls the app for each scene. It creates the dedicated SQLite document only while the fresh app is stopped. Navigation uses native labels and readiness assertions, with viewport containment before score-focused images. It never taps a score, toggles a die or rolls the synthetic game. Score-focused scenes normally align their native Numbers heading near the actual score viewport's top, then recheck that the intended score row is fully reachable. The medium phone's eight-dice scoring scene instead aligns Combinations: its captured Numbers-aligned layout put Three of a Kind at y775–831 outside the y164–772 viewport. That profile-specific composition keeps the intended score in view without changing app layout, cropping the image or recording a move. Numbers preserves useful upper-score context and avoids an unreachable lower-section alignment on tall tablets. Bounded, geometry-derived swipes move the UI itself. Corrections account for measured native touch slop and start on the noninteractive heading when it is visible. They never use tiny score-row drags that can become presses. A stalled scroll boundary fails instead of repeating gestures indefinitely. Observed save bytes and their equality receipt are retained even after failed navigation, before owned-simulator cleanup; an accidental mutation cannot hide behind a framing failure or be restored to manufacture passing evidence. They do not crop source images. The history scene opens on its local high-score heading rather than scrolling past a partly clipped ranking list to Recent games. The stored bytes must remain identical after capture. There are no arbitrary sleeps or assumptions about a personal simulator's saved state. Only the newly created simulator is deleted.

## Image export and evidence

`reports/capture-drafts` contains source PNGs, fictional fixture documents, native hierarchies and driver records. The ordered RGB exports and receipt are frozen into `reports/capture-drafts-evidence` before hashing and upload. Existing output is never overwritten. Failed captures retain a failed receipt where execution reached the capture phase. A process killed before its finalizer may lack a frozen receipt and cannot count as capture success.

The [RGB exporter](../scripts/ios-capture/image.mjs) creates a new file without resizing, cropping, overlays or compositing. It requires opaque pixels and compares every decoded sample after export. Color metadata and pixel-density metadata are preserved byte-for-byte. EXIF is omitted only after checking that the main orientation tag does not request a rotation. Rotated or partially transparent inputs fail instead of receiving a guessed correction. The original file remains untouched, with separate source, output and pixel hashes in the receipt. Apple forbids alpha channels even when all pixels are opaque; see [format validation](ios-screenshot-validation.md).

A passed receipt is still `accepted: false`. Before proposing store assets, inspect every image at full size for safe areas, clipping, color, actual theme, state and misleading content. Confirm device/locale coverage against the real listing. Record owner approvals, signed-binary correspondence and the final storefront order separately. App-preview video is optional and deferred; the gameplay qualification recording is engineering evidence, not a store preview.
