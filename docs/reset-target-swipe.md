# Reset search: bounded motion toward an observed target

Refs [#41](https://github.com/hemsoft-dev/yahtzee/issues/41). This is a
qualification search optimization candidate. It does not establish a defect in
the previous helper or driver, repair historical timeouts or cancellation, or
change the application reset policy.

When an original AX inspection identifies the unique enabled reset action
inside the unique Help viewport, the helper can shorten that iteration's
swipe. Existing checks still require the full action rectangle to fit the
effective Help viewport, which is intersected with its ancestor rectangles.
The target must actually intersect and extend beyond a vertical viewport edge,
already satisfy the viewport's horizontal eight-point margin, and have
supported ancestor geometry. Each target ancestor must contain either the
current complete target or the effective viewport. An additional ancestor
that clips both remains unsupported and keeps the previous search motion.

The displacement is the measured vertical clipping distance plus the existing
eight-point containment margin, rounded upward and capped at the original
90%-to-10% interior span. The starting point and direction are unchanged; only
the ending coordinate moves closer. Both endpoints stay within the same
viewport. Duration remains 600ms. A wholly offscreen, absent, horizontally
unsupported or margin-only target keeps the original full swipe. Ambiguous,
unowned, oversized and malformed targets retain their original rejection;
disabled targets retain the original wait behavior.

The calculation uses only that original AX result. Native callbacks, later
screenshots and constructed positions never supply input coordinates. One
swipe remains one swipe. Every original explicit and implicit wait, the
60-second and 30-inspection bounds, and the fresh AX enabled/ownership/full
target/ancestor containment checks before tapping remain in place. The helper
does not infer that the requested displacement moved the view. Cancel, reopen,
Delete, removal and final-save controls are unchanged.

## Retained fixture

`scripts/ios-native/fixtures/reset-partial-target-f88.json` is the target's
actual 23-node ancestry from the last existing AX inspection in the
[f88 tablet-10 failure](https://github.com/hemsoft-dev/yahtzee/actions/runs/42380220024/job/128429088326).
It preserves every rectangle on that path. Unrelated branches and attributes
are removed; the only identifiers retained are the fixed authored Help ID and
reset label. Source is `f88e4f18870310cfc0ba8be540c7ce4ed8933214`, run
`42380220024`, attempt 1, artifact `13578544207`. The artifact SHA-256 is
`4237e4af06e9b64d01ed90c8bb26b5cde4900f7cdb61f55d3e1c98b6784f119f`;
the original `corrupt-save/reset-database/reset-screen-latest.json` member
SHA-256 is
`93110010c2bd04ee08fd9d1b92804d1fadf407f765b499e4a3538656ae5e9e50`.

That AX rectangle is x176..856, y1308..1389 in viewport x0..1032,
y106..1356. Its 33-point bottom clipping gives a 41-point candidate stroke,
from `516,1231` to `516,1190`, instead of `516,231`. This is a coordinate
calculation, not a prediction of UIKit displacement or latency. The old run
subsequently recorded native containment but made no further AX read. The
fixture does not substitute for that missing read or turn the old run green.

## Pinned driver and validation boundary

Context7 was unavailable. The [official swipe reference](https://docs.maestro.dev/reference/commands-available/swipe.md)
documents explicit coordinates and millisecond duration. Retained Maestro
2.10.0 source at `14a408335e17a090df1e26bdbeaf80d8122a8fd8` forwards explicit
points and duration through
[Orchestra](https://github.com/mobile-dev-inc/Maestro/blob/14a408335e17a090df1e26bdbeaf80d8122a8fd8/maestro-orchestra/src/main/java/maestro/orchestra/Orchestra.kt),
[Maestro](https://github.com/mobile-dev-inc/Maestro/blob/14a408335e17a090df1e26bdbeaf80d8122a8fd8/maestro-client/src/main/java/maestro/Maestro.kt)
and [IOSDriver](https://github.com/mobile-dev-inc/Maestro/blob/14a408335e17a090df1e26bdbeaf80d8122a8fd8/maestro-client/src/main/java/maestro/drivers/IOSDriver.kt).
IOSDriver clamps points to the device grid and converts the duration to
seconds. Its waits remain untouched. This static mapping is not loaded-image
attestation or proof that a shorter stroke improves settling.

The retained-data regression, edge/ancestor/ownership controls and bounded
search tests exercise the actual helper. They prove neither native motion nor
performance. New-source hosted ordinary, modal, settle, AX and aggregate
qualification remains mandatory, including the separate phone-5 Start/AX
failure. No extra request, input, retry, wait option or deadline is added.
Partial retention, exit143 UNAVAILABLE, conditional clock/coordinate
correspondence, C++ callback and loaded-image limits, unverified requested
font and historical/public404 limits remain. Issues
[#41](https://github.com/hemsoft-dev/yahtzee/issues/41),
[#102](https://github.com/hemsoft-dev/yahtzee/issues/102),
[#112](https://github.com/hemsoft-dev/yahtzee/issues/112) and
[#115](https://github.com/hemsoft-dev/yahtzee/issues/115) remain open and
historical causes remain UNKNOWN.
