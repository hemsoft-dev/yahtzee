# Original reset inspection and compact formatting

Refs #41. This qualification-only CLI source patch observes the hierarchy returned
by each existing reset `inspect_screen` call and the branches of its original
compact formatter. It adds no hierarchy/device query, matcher pass, screenshot,
input, traversal, timer, worker or hosted job. It changes no formatter output or
reset acceptance rule. Historical causes and #41/#102/#112/#115 remain open.

The pinned Maestro source is
[`14a408335e17a090df1e26bdbeaf80d8122a8fd8`](https://github.com/mobile-dev-inc/Maestro/tree/14a408335e17a090df1e26bdbeaf80d8122a8fd8).
`InspectScreenTool` holds the result of its one original `viewHierarchy()` call.
`ViewHierarchy.from` has already applied the original `filterOutOfBounds` before
that return. An absent node here cannot distinguish XCTest/driver omission from
that earlier filtering. No historical pre-compaction tree was retained.

The observer piggybacks the formatter's existing recursive walk. `hasZeroSize`
passes its existing attributes map and bounds value to the observer; it adds no
TreeNode getter. Empty and zero-size wrappers still process and hoist children.
Conversion, defaults, filtering, child order and JSON serialization are unchanged.
The helper accepts no TreeNode. Build controls compare original getter call sites,
public descriptors, unrelated JAR entries, packaged behavior and source inversion.

Only fixed Help/reset matches produce node facts. `kind`/`post` use bits 1=the
authored Help resource ID, 2=exact authored accessibility label, 4=exact authored
text. `reason` is 0=retained,1=original zero-size discard,2=original empty discard,
-1=branch not reached. Parent and nearest Help identities describe the actual raw
walk and retained ancestry, including hoisting; they are not acceptance decisions.
`enabled` comes only from the already-converted map, or is -1 if unavailable.
Rectangles copy only bounded numeric original bounds. No labels or arbitrary UI
fields are exported. Counts can include non-leaf authored matches and are not a
uniqueness, ownership, enabled, containment, visibility or paint oracle.

Supported MCP `_meta` binds an explicit authored route/invocation/flow to the
same original outgoing JSON-RPC ID. The actual SDK 0.11.1 and packaged CLI launcher
have CPU controls. The optional `--launcher-control` omits `device_id`, preserving
its original error before the inspect query is entered. This control is refused
under GitHub Actions; normal hosted qualification adds no MCP command and uses
only the original reset inspections. Runtime enablement forwards the exact current
source/run/attempt and authored reset route. The PID is the CLI JVM, not an app or
XCTest target. Missing, reordered or unbound metadata stays unavailable.

The current runner prepares the copy after the existing phone5 assertion build
guard. The original CLI JAR is retained privately; only the InspectScreenTool,
ViewHierarchyFormatters and new observation class families are replaced. Other
libraries, including comparator/capture/client/native code, remain byte-identical.
This is a **source-patched qualification toolchain**, not an unmodified release.
Kotlin 2.2.0 and original source bytes are hash-pinned. Existing workflows and all
15 required jobs are unchanged. A preparation failure fails its existing job and
retains a finite build proof; it never waives an original native failure.

Limits: 36 invocations/process,512 nodes, depth 24,8 fixed authored facts/invocation,
12 rows/invocation,1024 bytes/row,128KiB/process. Observation caps stop observation,
never the original walk/output. The streaming consumer accepts at most432 rows and
160KiB/attempt and removes observation lines before ordinary log persistence.
Malformed, split, oversized, private-field and stale records are discarded. Missing
suffixes, sink faults and caps remain partial; no retained prefix proves absence.
Typed evidence is written once before the original process cleanup. Exit143 and
transport truncation can prevent completion or evidence delivery.

Query/formatter begin/end clocks share only the same JVM monotonic domain. Node
facts are copied during that formatter walk and emitted at handler completion;
their emission clocks are not node-query times, UIKit callbacks, pixels or a
later AX acceptance. I/O and instrumentation perturb timing, and kernel blocking
is unbounded. Loaded native images, font settings, C++ callbacks, public PNG access
and historical clock/cancellation gaps remain unattested.

CPU controls use the actual original RegisteredTool handler, formatter and driver
interface, with a fixture driver. Original-package missing-observation RED and
observed GREEN preserve one query, original outputs/errors, zero/empty hoisting,
ambiguous/unowned/disabled cases, caps, clock/sink faults and immutable retention.
An expanded retained cf compact result is an offline fixture only; it cannot
reconstruct its missing historical pre-compaction tree. CPU controls establish no
native result. Complete current-source native/modal/AX/settle/archive/aggregate
qualification remains mandatory, with 60s/30 inspections/600ms, every original wait,
fresh full-containment/enabled/ownership checks, Cancel/reopen/Delete, database
removal, relaunch and final saves unchanged.
