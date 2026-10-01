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

## Device profiles

Apple's [current screenshot specifications](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/) were retrieved on September 28, 2026, EDT. Draft profiles use the iPhone 17 Pro Max at 1,320 by 2,868 pixels for the 6.9-inch set, and iPad Pro 13-inch M5 at 2,064 by 2,752 for the 13-inch set. Both are portrait, en-US, standard text size. The runner refuses a screenshot whose dimensions differ. It does not stretch smaller engineering captures to fit.

These profiles are a proposed coverage set. There is no App Store Connect listing against which to verify required families, localization, additional display sets or uploaded order. The separate native qualification matrix still covers other modes, orientations and largest text; draft images do not replace those tests.

## Regeneration

Use a fresh macOS checkout, the [native qualification toolchain](native-simulator.md) and a verified unsigned build from the same commit and workflow run under `reports/native-build`. Then run one device profile with an explicit selection:

```sh
bun scripts/ios-capture/run.mjs --profile=phone-69 --scene=all --appearance=scene
bun scripts/ios-capture/run.mjs --profile=tablet-13 --scene=bonus --appearance=dark
```

Each command requires fresh output paths. The commands above are examples for separate clean checkouts, not consecutive runs that overwrite each other. Allowed scenes are `all`, `setup`, `holding`, `scoring`, `bonus`, `results` and `history`. Appearance is `scene`, `light` or `dark`. The [draft workflow](../.github/workflows/ios-capture-drafts.yml) builds once, then captures both profiles on separate runners. Every push to the owned capture branch triggers fresh evidence, including an app-only rebase. Capture-only path filters would leave a new source head without its required matching build. After merge, the manual workflow can regenerate a selected ref. It is separate from the required gameplay matrix and has no signing or publication stage.

The runner creates its own simulator and reinstalls the app for each scene. It creates the dedicated SQLite document only while the fresh app is stopped. Navigation uses native labels and readiness assertions, with viewport containment before score-focused images. It never taps a score, toggles a die or rolls the synthetic game. Scoring and bonus scenes align their native Combinations or Numbers heading near the actual score viewport's top, then recheck that the intended score row is fully reachable. Bounded, geometry-derived swipes move the UI itself. They do not crop source images. The history scene opens on its local high-score heading rather than scrolling past a partly clipped ranking list to Recent games. The stored bytes must remain identical after capture. There are no arbitrary sleeps or assumptions about a personal simulator's saved state. Only the newly created simulator is deleted.

## Image export and evidence

`reports/capture-drafts` contains source PNGs, fictional fixture documents, native hierarchies and driver records. The ordered RGB exports and receipt are frozen into `reports/capture-drafts-evidence` before hashing and upload. Existing output is never overwritten. Failed captures retain a failed receipt where execution reached the capture phase. A process killed before its finalizer may lack a frozen receipt and cannot count as capture success.

The [RGB exporter](../scripts/ios-capture/image.mjs) creates a new file without resizing, cropping, overlays or compositing. It requires opaque pixels and compares every decoded sample after export. Color metadata and pixel-density metadata are preserved byte-for-byte. EXIF is omitted only after checking that the main orientation tag does not request a rotation. Rotated or partially transparent inputs fail instead of receiving a guessed correction. The original file remains untouched, with separate source, output and pixel hashes in the receipt. Apple forbids alpha channels even when all pixels are opaque; see [format validation](ios-screenshot-validation.md).

A passed receipt is still `accepted: false`. Before proposing store assets, inspect every image at full size for safe areas, clipping, color, actual theme, state and misleading content. Confirm device/locale coverage against the real listing. Record owner approvals, signed-binary correspondence and the final storefront order separately. App-preview video is optional and deferred; the gameplay qualification recording is engineering evidence, not a store preview.
