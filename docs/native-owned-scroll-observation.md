# Qualification-only owned Help scroll observation

Refs [#41](https://github.com/hemsoft-dev/yahtzee/issues/41). This observes the
actual ordinary reset route. It is not a gesture, reset or input-loss repair.

## Source and ownership

The retained [PR129 run](https://github.com/hemsoft-dev/yahtzee/actions/runs/42345306902)
is terminal failure. The original modal and tablet-10 document searches exceed
their unchanged 60-second budgets. All recorded targets are absent in AX.
Native starts match the authored swipe points. An ancestor-pan/RN-cancel
signature also occurs in both successful separate diagnostic-copy reset routes,
so that signature cannot by itself explain failure. No later AX query or settled
scroll offset is supplied by those failed artifacts. Tablet-8's original Done
input/AX boundary is a separate unresolved occurrence.

Pinned React Native 0.86.3 creates an `RCTEnhancedScrollView` as a direct child
of `RCTScrollViewComponentView`. The component exposes its exact `scrollView`,
is its `overridingDelegate`, and owns the scroll/drag/deceleration callbacks.
The existing Help `testID` identifies its component. The build now pins the
component implementation/header, enhanced-scroll header, delegate-splitter
implementation/header and view-component test-ID implementation as well as the
previous native sources. None of these dependency files is edited. Published
source hashes are not attestation of the prebuilt RN image.

Adding a delegate through RN's splitter would invoke its delegate-update block
with nil and then a delegate and modify the delegate set. This observer instead
reuses the existing per-instance adoption mechanism. Original RN class methods,
the scroll view's delegate/splitter, responder and gesture policies stay intact.

Discovery runs only from existing delivered touch callbacks and the existing
`touchesShouldCancelInContentView:` hook. It walks at most 24 original touch-view
ancestors. Admission requires all of the following together:

- Exact runtime classes for the component and enhanced scroll view, not an
  unrecognized subclass or KVO wrapper.
- The exact `help-viewport` component identifier, direct child relationship,
  public `scrollView` identity and reverse `overridingDelegate` identity.
- Both object getters and all seven callback methods have the expected declared
  owner, argument count and ABI. Inherited methods are not replaced.
- A private subclass has no new ivars and exactly the base allocation size.
  Only the verified receiver instance adopts it; no UIKit class is hooked.

Unknown classes, markers, receivers, callback arguments, ABI, recycled pairings
or resource bounds leave observation unavailable. They never select a guessed
scroll view. Only eight receiver instances and sixteen window IDs are allocated
per process. A zero window ID means unidentified or detached; `attached` is a
separate observed flag. A gesture ID is allocated only by an actual begin-drag
callback. Earlier unmatched events keep gesture zero.

## Original callbacks and state

The wrappers call each original implementation once with the original receiver,
selector, scroll argument and BOOL, preserving void returns and thrown identity.
Observation errors are caught separately before and after it. C++ unwinding is
preserved but has no invented Objective-C throw/return record.

| Kind | Original method extent |
| --- | --- |
| 0 | Runtime preparation, not owned-instance adoption |
| 1 | Verified receiver adoption |
| 2–5 | Existing native touch begin/move/end/cancel entry |
| 6 | `scrollViewDidScroll:` |
| 7 | `scrollViewWillBeginDragging:` |
| 8 | `scrollViewDidEndDragging:willDecelerate:` |
| 9 | `scrollViewWillBeginDecelerating:` |
| 10 | `scrollViewDidEndDecelerating:` |
| 11 | `scrollViewDidEndScrollingAnimation:` |
| 12 | The component's existing `didMoveToWindow` |
| 13–14 | Unavailable and budget markers |

Callback phase 0 is entry, 1 return and 2 an Objective-C throw with unknown error
classification. Phase 3 is a standalone observed event. Touch records use the
existing native cancellation channel's process-local touch number when supplied;
callback records use zero and never borrow a last touch. Call IDs are distinct
from gesture, instance and window IDs. No native touch identifier is serialized.
A method entry does not distinguish a UIKit delegate message from an internal
RN call. In the pinned source, `scrollViewDidScroll:` is also called from zoom
and finished-scroll handling. The record identifies the method and actual state,
not a fabricated physical gesture or callback origin.

Each state sample reads current content offset, bounds origin/size, content
extent, content and adjusted insets, zoom, dragging/decelerating/tracking flags,
scroll-enabled/clipping/hidden/attached flags, window dimensions/scale/orientation and
axis-aligned window geometry. The viewport rectangle is intersected with
clipping ancestors up to the window. This is a geometric viewport intersection,
not a transformed-mask, paint, occlusion or AX visibility measurement. An
incomplete ancestry traversal leaves intersection values null.

Coordinates and sizes are integer millipoints, or null for nonfinite/out-of-bound
values. Original touch coordinates/timestamp are present only when that original
callback supplies a touch in the same window. Window and screen coordinates are
separate fields; orientation zero remains unknown. Native uptime brackets the wall
read. State properties are sequential reads, not an atomic snapshot.
Touch-to-wall intervals remain conditional on clock stability, bounded
sample span and touch age. There is no global/video clock calibration.

The parser derives a **nominal** vertical range from observed unzoomed extent,
bounds and adjusted insets. Elastic offsets outside it are allowed, not failures.
Invalid extent, zoom or receiver identity leaves the range unknown. Two actual
same-instance/window samples may show offset change; they do not prove input
causality, continuous movement, scroll success or cancellation ownership.
An end-drag/deceleration callback is that event. Its return cannot establish
paint, AX state or future stability. An unobserved callback remains unknown.

## Bounded retention and validation

One private exclusive `native-scroll-<pid>-<epoch>.jsonl` file is written
asynchronously. At most 2048 observations and one budget marker enter the private
queue. Original calls never wait for it or its drain. No timer, sampler, extra
input, wait, query, restart, timeout or altered assertion is added. Process exit
may lose a suffix. All records and summaries describe a partial retained prefix.

The existing owned-container lookup is reused after each ordinary scenario or
corruption route and before its cleanup. No additional simulator or AX command
is added. The collector inspects at most 64 fixed-prefix names and freezes the
newest eight regular no-follow files, up to 4 MiB each, with opened-file identity
and filename/process-epoch checks. Selection is not causal ordering. Prefixes
are immutable and never overwritten. Invalid/private lines, native names,
messages, labels, URLs, SQL, environment, addresses and error payloads are not
retained. Original files are not removed. Missing/unsafe data remains unavailable.

Local Node controls cover strict schemas, clock limits, process/instance/window
separation, duplicate/partial callback pairs, range ambiguity, bounded summaries,
privacy, file bounds, links, immutable prefixes and build admission. A real
Foundation Objective-C++ control exercises the shared receiver predicate,
per-instance ABI adoption, arguments/BOOLs/void/error forwarding, throwing
observers, unrelated instances and inherited C++ ivar teardown. It must compile
and pass in hosted macOS **before** generated app injection. Local mocked build
commands do not prove that control or UIKit behavior.

Actual Objective-C++ compilation, receiver admission, delivered UIKit callbacks,
correspondence to original swipes and hosted reset behavior are pending the new
source-bound run. The released-driver ordinary matrix, 60 seconds/30 inspections,
full containment, Cancel/Delete/removal/final-save assertions and required
aggregate remain unchanged. A separate diagnostic pass cannot waive them.
No original touch or unchanged run is replayed. Existing health 143 UNAVAILABLE,
partial/native/C++ callback, loaded-image, font, public-404 and history limits
remain. Issues [#102](https://github.com/hemsoft-dev/yahtzee/issues/102),
[#112](https://github.com/hemsoft-dev/yahtzee/issues/112),
[#115](https://github.com/hemsoft-dev/yahtzee/issues/115) and #41 stay open.

Primary contracts:

- [Apple scroll delegate callbacks](https://developer.apple.com/documentation/uikit/uiscrollviewdelegate)
- [Drag-end and deceleration argument](https://developer.apple.com/documentation/uikit/uiscrollviewdelegate/scrollviewdidenddragging(_:willdecelerate:))
- [Deceleration-end event](https://developer.apple.com/documentation/uikit/uiscrollviewdelegate/scrollviewdidenddecelerating(_:))
- [Objective-C per-object class assignment](https://developer.apple.com/documentation/objectivec/object_setclass(_:_:))
