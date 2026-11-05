# Help input observation

This partial qualification-only observation advances [#102](https://github.com/hemsoft-dev/yahtzee/issues/102).
The c8 failure in [run41845762465](https://github.com/hemsoft-dev/yahtzee/actions/runs/41845762465)
retains one Help touch at09:43:18.969863..09:43:27.016608EST November4.
Device-info reads continue, but the later image still shows Setup/Help.
The matched successful phone5 touch at the same295,140 coordinates lasts0.463567s.
Neither establishes where the failed activation was lost. Cause remains UNKNOWN.

NativeGameScreen opts only Help into the existing Action press controller.
One numeric helpId correlates press-in, handler and JS callback returned/threw.
Press-out is independent and may precede the handler or arrive after its unmount.
Unknown/invalid event time cannot establish press-out. Superseded, disabled and
unmounted unhandled activations emit finite incomplete-observation phases.
An unmatched handler gets its own ID without fabricated press evidence.
Repeated handlers get separate IDs. StrictMode effect replay adds no activation.

The wrapper invokes the original callback synchronously once, forwarding the host's original arguments without recording them,
returns its unchanged value and rethrows the identical error. It never awaits
the result. Returned/threw describe only synchronous JS callback completion,
not route commit, focus, native delivery, paint, AX or navigation acknowledgment.
No route, error, label, event payload or timestamp payload is retained. The shared
8192-record cap, finite collector schema, qualification gate and sink/clock
isolation apply. Shipping collection stays disabled. Existing Start/Resume/score
protocols and driver capture/shutdown source remain unchanged.

The actual NativeGameScreen/Action lifecycle harness uses the real LocalProvider
and real store with in-memory platform storage. Only native host adaptation and
storage are substituted. Its pinned old c8 screen reaches the original onHelp
callback, then fails the same positive Help-phase assertion when run with
HELP_BASELINE=1. Normal tests cover out/handler order, thrown identity, repeated
handlers, supersession, cancellation, unmount/late out, StrictMode, shipping and
sink failure. Trace/parser controls cover disabled activation, privacy, clocks,
cap and malformed records. The existing lifecycle CI command also runs this
file at the unchanged5000ms test bound.

These are browser component controls, not native proof. c8 native identity,
continuous148055-byte failed XCTest log and matched-control media remain
historical. Loaded-image identity remains unattested; health143 is UNAVAILABLE.
Absent phases do not prove handler absence. New-head positive native Help
observations and failed-occurrence localization remain pending ordinary CI.
Issues102/112/115/41 stay open. No retry, timeout or input-loss fix is introduced.

## Historical control in shallow checkouts

The component harness builds the exact c8 NativeGameScreen snapshot from
scripts/ios-native/fixtures/help-baseline-c8.tsx.fixture, verified before bundling
with CRLF normalized to LF against SHA256 9ac442dddc4c9f28d1906d42ad640f41f65225147750029647044ceb7be6a48b.
It came from commit c8a31f7b5587c8e08a4086a744cad3ee04b878ba and retains the
original source imports resolved from the screen directory. Normal CI exercises
the historical callback/argument controls without requiring old Git objects.
The opt-in HELP_BASELINE=1 missing-observation negative control remains intact.
All current-source lifecycle assertions and timeout bounds are unchanged.
