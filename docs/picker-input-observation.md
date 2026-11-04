# AI picker boundary observation

The [70e tablet8 occurrence](https://github.com/hemsoft-dev/yahtzee/actions/runs/41860284404)
successfully recorded Help6, then failed the Current assertion after a single
AI-opponents touch at11:17:53.835746..11:18:09.192745EST November4.
The later image shows Setup, not a sheet. That does not establish whether a
sheet was ever presented. Cause remains UNKNOWN. Refs
[#102](https://github.com/hemsoft-dev/yahtzee/issues/102).

Only Setup's AI Choice opts in. The existing bounded press discipline records
activation/out and a numeric pickerId, without native event payload or timestamp.
The actual row handler creates the sheet observer before the existing helper.
An unmatched handler creates no press evidence. The iOS helper records native
API call, synchronous return or throw and callback entry as a finite option0..3,
cancel, unknown or late phase. None is UIKit presentation, focus, paint, AX or
navigation acknowledgment. A synchronous API throw may originate in a synchronous
callback; it does not identify a native crash or cause.

The original options/message/cancel/style, call order/count, permissive index
guard, selection arguments and thrown identity remain unchanged. Unknown callback
data stays unknown in the trace, while the original guard still decides whether
to call onSelect. No selection is suppressed by diagnostic retirement. Disabled,
unmounted or superseded windows are retired; old callbacks keep their original
ID and report late rather than borrowing a new request. A preference write from
an old callback cannot relabel its API completion either: a synchronous return
or throw remains attached to the original captured ID after row retirement.
A preference write from
an old callback may disable and retire the newer row; this is observed, not
treated as proof of the historical failure. The non-iOS helper still returns
false and expands inline. Dice/appearance are not opted in.

Observer, clock and sink errors remain advisory. The shared8192 cap and finite
collector schema remain; no title, option label, name, route, arbitrary error,
environment, callback payload or save bytes are retained. Shipping observation
is off. Existing Help/Start/Resume/score protocols, driver capture and143 health
semantics are unchanged. Missing phases with incomplete capture remain UNKNOWN.

The real Setup/Choice/LocalProvider/store harness replaces only host/storage and
the ActionSheetIOS boundary. It also executes the actual iOS helper. The old70e
Choice is a self-contained committed fixture, canonical LF SHA256
69cb2cd6ba5188d633446967dbe7a5f38df36b5b17e4be61e7fd27cc36e71f8f.
PICKER_BASELINE=1 reaches the original bridge, verifies options and persisted
selection, then fails specifically on absent picker phases. No Git objects are
needed; physical CRLF normalizes before hash verification. Controls exercise
selection/cancel/unknown/late callback, original invalid-index behavior, native
and callback throws, disabled pending persistence, detach/supersede/StrictMode,
clock/sink/shipping, nonopted/inline and synchronous callback order. Tests keep
the original5000ms per-case bound. Local browser controls are not native proof.

All old media and source-bound driver/Help proof remain historical70e or earlier.
New-head native picker observations and failed-loss localization remain pending
ordinary CI. Issues102/112/115/41 remain open. No timeout, keyboard action, anchor,
layout, retry, driver/version change or lost-input repair is introduced.
