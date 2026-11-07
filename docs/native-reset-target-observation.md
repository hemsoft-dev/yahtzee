# Owned reset target geometry

Refs [release qualification #41](https://github.com/hemsoft-dev/yahtzee/issues/41).
This is qualification-only observation. It changes no app, reset, gesture,
store, driver, wait, action, assertion or deadline policy. The original released
driver matrix, modal and settle jobs and aggregate remain required.

At [f2a50bb's modal job](https://github.com/hemsoft-dev/yahtzee/actions/runs/42372266588/job/128406237165),
the last actual AX target was partially clipped. The final original wait
returned, then the 60-second guard prevented another inspection. Native scroll
records reached the nominal range limit and a returned deceleration-end
callback. Those facts leave the native target frame at that callback unknown.
No later AX query or retrospective target geometry is constructed.

## Pinned representation and scope

`Help.tsx` supplies the fixed reset label through `Action`. `Action` supplies
an explicit accessibility label and button role to `Pressable`. Pinned React
Native 0.86.3 `Pressable.js` renders an accessible, non-collapsible `View`.
`RCTViewComponentView` assigns that label to its own accessibility element,
which returns `self`. Its declared `accessibilityLabelForCoopting` getter
returns `super.accessibilityLabel`, without recursive descendant text
collection. Source hashes for the header, implementation and Pressable are
required before building the generated simulator observer.

The existing Help receiver/scroll pair ownership test runs unchanged. Target
discovery begins only at that verified scroll instance and follows its public
`subviews`, never parents or another app/window tree. Only exact
`RCTViewComponentView` objects with an accessible button role are candidates.
The declared getter's two-argument/object-return ABI is checked before use.
Only the fixed authored label is compared in memory; no label or other text
is serialized. A second match, missing match, invalid relationship, depth or
node cap, fault, unavailable getter or detached window yields unknown.
Missing native representation is not proof of virtualization or absence.

Discovery is bounded to 256 views, depth 16. Each child must name the visited
parent as its superview. Duplicate/cyclic relationships are rejected. Nothing
outside the owned Help subtree is visited. No accessibility enumeration,
snapshot, native input, timer, sampler or OS-wide hook is added.

## Delivered native callback records

The existing seven receiver methods, ABI preflight and forwarding wrappers are
unchanged. Version 2 scroll rows add nullable `reset` data. Samples are taken
only on the existing drag, deceleration, animation-end and window callbacks,
kinds 7 through 12, at their original entry/return/Objective-C-throw observations.
Per-frame didScroll and touch records do not trigger target discovery. No extra
record or callback is scheduled. Original C++ unwinding stays unchanged and
does not acquire an invented return/throw event.

Each sample contains finite status, visited/match/depth counts, monotonic
sampling bounds, process-local target ID, target rectangle in the verified
window, rectangle in the scroll view's local coordinate system, intersected
window rectangle and at most 24 ancestor rectangles with actual clipping flags.
Ancestor traversal must reach the same window through the exact scroll object.
Target IDs are weak-keyed and never reused, with at most 16 per process epoch.
Existing process/epoch/receiver/window/call IDs identify the record. No pointer,
native name, accessibility value, UI text or exception payload is exported.

Status codes are 0 observed, 1 unspecified unknown, 2 no match in the completed
bounded traversal, 3 ambiguous, 4 node/identity cap, 5 depth cap, 6 invalid tree,
7 unsupported getter representation, 8 observation fault, 9 invalid geometry
and 10 ownership/window/ancestry unavailable. Nonzero statuses carry no target
identity, frames or ancestor data. At an ineligible callback `reset` is null,
not a positive or negative target result.

Coordinates are integer millipoints. Rectangles are axis-aligned conversions,
not mask, opacity, occlusion, paint, AX visibility or hit-testing results.
An empty intersection is recorded as zero extent. `complete` means the
bounded ancestor path reached the verified window, not that the target is
visible or actionable. Hidden flags do not account for opacity or occlusion.
Scroll metrics and target geometry are sequential property reads, not an
atomic snapshot. Target sampling has its own native monotonic bracket after
the existing wall-clock bracket. Cross-process association remains conditional.

The parser still accepts historical version 1 rows. New rows must have the
exact finite schema. Unknown data cannot be promoted to known geometry. The
summary retains at most 64 target samples, with explicit truncation, separately
from its existing callback/movement summaries. Original 2048-record/8192-byte
writer and 4 MiB retention bounds remain. Prefixes may be incomplete; oversized
or unavailable output is not evidence that a callback or target was absent.

## Existing actual AX reads

`nativeInteraction` retains additional finite geometry only for its existing
`reset` inspections. It adds no request or input. A separate file,
`reset-ax-geometry.jsonl`, identifies the Node process, inspection number,
original flow sequence and post-read wall time. It retains the unique Help
viewport, target and ancestor rectangles already present in that actual result.
The ancestor intersection is derived from AX rectangles and does not invent
UIKit clipping flags. No label, resource ID, UI value or raw payload is copied.

The in-memory traversal is capped at 512 nodes/depth 24. Codes are 0 geometry
available, 1 Help absent, 2 Help ambiguous, 3 target absent, 4 target ambiguous,
5 unsupported/malformed data and 6 traversal bound. This is a classification
of that retained result, not a claim about an unmade later query. Up to 64
snapshots and one explicit cap marker are written, each at most 8192 bytes.
The file is exclusively created with mode 0600/no-follow where supported;
an existing file or write fault disables retention without changing the
returned screen or original error. The descriptor closes before original
driver cleanup. A partial write or process death can leave a partial prefix.

Native and AX frames are separate observations in their own coordinate/time
domains. A later callback, including one after the search budget, never
authorizes a new input/query or relabels an earlier failed AX inspection.
Added read-only work and file I/O can perturb timing. No zero-impact claim is
made, and no standalone/local success waives original qualification.

## Validation and limits

The new parser and actual interaction controls fail on the prior source at
missing geometry retention, after the original read path executes. Node tests
cover schema bounds/privacy, ambiguity, unrelated targets, invalid/cyclic
input, original error identity, exclusive retention, caps and pre-close output.
The existing hosted Foundation control now also executes the actual shared
bounded matcher, unrelated-root, cap/depth, relationship, getter ABI and
Objective-C/C++ observation-fault controls. Its original forwarding, Bool,
exception identity, C++ unwinding and adopted-object lifetime tests remain.
Foundation fixtures are unit controls, not UIKit/real-target evidence.

Compilation, real target availability and live UIKit geometry remain pending
normal source-bound hosted execution. No local browser/device/native workload
or Mac inference is used. If the runtime returns unknown, keep its exact
supported boundary rather than broadening discovery. No geometry/source
defect or functional fix has been established by this diagnostic.

All historical 143 unavailable, partial-prefix, conditional-clock, C++ callback,
loaded-image-unattested, requested-font, public-PNG404 and cause limits remain.
Issues 41, 102, 112 and 115 stay open. Council is not required for this bounded,
reversible read-only extension of the existing owned callback seam.

Sources: [RN Pressable](https://github.com/facebook/react-native/blob/v0.86.3/packages/react-native/Libraries/Components/Pressable/Pressable.js),
[view implementation](https://github.com/facebook/react-native/blob/v0.86.3/packages/react-native/React/Fabric/Mounting/ComponentViews/View/RCTViewComponentView.mm),
[declared getter](https://github.com/facebook/react-native/blob/v0.86.3/packages/react-native/React/Fabric/Mounting/ComponentViews/View/RCTViewComponentView.h),
[scroll ownership](https://github.com/facebook/react-native/blob/v0.86.3/packages/react-native/React/Fabric/Mounting/ComponentViews/ScrollView/RCTScrollViewComponentView.mm),
[Apple rectangle conversion](https://developer.apple.com/documentation/uikit/uiview/convert(_:to:)-2kf3d?language=objc).
Context7 tools were unavailable; pinned installed source and official Apple
documentation supplied the preflight evidence.
