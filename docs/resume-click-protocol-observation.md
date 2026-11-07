# Resume browser click completion observation

This test-only diagnostic addresses the Windows lifecycle gate in
[PR122](https://github.com/hemsoft-dev/yahtzee/pull/122). The open and closed issue
inventory was checked before implementation. Existing [validation issue7](https://github.com/hemsoft-dev/yahtzee/issues/7)
is the infrastructure contract, while [native Resume issue112](https://github.com/hemsoft-dev/yahtzee/issues/112)
remains a distinct unresolved native observation. No duplicate issue or product fix
is claimed.

At `6f70380`, Windows' first Resume case reached the browser press handler and Play
React commit, but the original `Locator.click()` promise did not finish by Bun's
unchanged five-second test bound. Bun killed the shared Chromium child and later
cases cascaded. The last retained Playwright progress entry precedes both the
mouse action completion and the hit-target interceptor stop evaluation. It cannot
identify which was pending. This differs from the earlier browser creation and
bundle injection stalls. No common cause is established.

## Source and scope

[Public CDPSession](https://playwright.dev/docs/api/class-cdpsession) exposes the
commands sent through that session, not a supported subscription to responses for
Playwright's existing internal session. Public tracing stores request and page
payloads outside this allocation. The observer instead compiles an in-memory copy
of the installed Playwright-core **1.63.0** CJS bundle after checking SHA-256
`549070af3acabb3efcc4f55bfe6210f9f7c2fcf633cf7eaa59bfe60719969171` and nine unique
source locations. Every change can be removed to restore the exact original
bytes. Nothing in `node_modules`, dependency versions or locks is modified.
Version/hash/previous-load mismatches fail explicitly rather than silently using
an unobserved implementation. The CJS compilation/cache technique is private test
plumbing, qualified by the actual lifecycle command, not a public Playwright API.

The existing command preloads this copy before any lifecycle file imports
Playwright. This is necessary because Bun's file discovery order differs from
the command argument order. `resumeObservation.test.ts` imports its recorder. It is
active around the **original first Resume click only**. Its expression, arguments,
options, assertions, later clicks, setup, five-second test deadline, and cleanup
are unchanged. Other lifecycle files may share the instance, with recording
inactive. There is no extra click, protocol command, query, timer, wait, retry,
restart, split, skip, `trial`, `force`, `noWaitAfter` or changed passing oracle.
The original browser error is allowed to propagate. Production/app/native/modal/
driver/reset/gesture/store/scoring/JS trace policies and held PR114 files are
unchanged.

## Finite records

Each row has only `v`, `sequence`, `request`, `stage`, `edge`, `method`, `id`, `connection` and
`monoUs`, all bounded safe integers. Request 1 is the original click window. The
CDP message ID is numeric and is useful only with its process-local numeric
connection ID in that window. Different connections cannot borrow responses.
All protocol rows belong to the observation time window; they are not automatically
causally attributed to the click. Multiple connections mark coverage partial.
Method 0 is
other, 1 is `Input.dispatchMouseEvent`, 2 is `Runtime.callFunctionOn`, 3 is
`Runtime.evaluate`, and 4 is `Runtime.releaseObject`. Neither method payloads nor
results enter the recorder. Error edge 2 means only that the observed operation
threw or the protocol response had an error field. No error text or class is
copied. Edge 0 begins an operation and edge 1 marks its observed return.

| Stage | Actual observed boundary |
| --- | --- |
| 1 | Original test `Locator.click()` await entry/return/error |
| 2 | Pinned server pointer callback's original mouse action await |
| 4 | Chromium internal raw send and matching response, classified method only |
| 5 | Existing interceptor evaluation begins; existing `progress.race` returns, or original swallowed evaluation failure |
| 6 | Original pointer callback reaches its action-done progress point |
| 7 | Original wait-for-signals/finally expression returns |
| 8 | Original client connection receives the Frame.click response, before its original result/error handling |

Stage 5 error may still be followed by a stage 5 return because the original code
swallows that rejection as `done`. This policy is preserved. The existing final
cleanup also evaluates the stop handle without awaiting it; a still-pending CDP
ID at the end of a successful click is not by itself a defect. Stage 4 reports a
protocol response, not the later consumer's settlement. Its begin row precedes
the original protocol logger and transport send, so it does not prove bytes were
sent. Stage 7 does not prove the
test's click await returned; stage 1 return does. Stage 8 precedes the original
client validator/resolve/reject, so it does not alone prove API settlement.

Rows are written synchronously as they happen into a fresh private directory
under `reports/lifecycle-click/`, before the original page cleanup. At most 256
rows and 256 pending IDs are retained, less than 64 KiB of numeric JSON. The
coverage file reports active/partial/exhausted status, counts and original/observed
bundle hashes. Clock/sink failures cannot escape into the original operation.
Clock regression stays partial rather than inventing time. Active capture,
unanswered IDs, exhaustion or missing completion remain partial; missing rows
never prove the corresponding browser operation did not happen. A hard process
exit can leave only the already-written prefix and initial partial receipt.
No detached writer or new shutdown action exists. CI retains this directory in
the existing revision-bound qualification artifact.

Observation, synchronous writes and generated compilation affect timing. A local
or hosted pass proves recording capability and that occurrence's behavior only.
It does not resolve historical failures or exonerate Bun, Playwright, Chromium,
the host or the app. Monotonic samples are process-local and include overhead.
No browser/UI/AX payload, selector, URL, SQL, environment, credential, user content
or arbitrary error text is recorded by this collector. Original test logs retain
their existing policy.

## Controls and next event

`node --test scripts/ios-native/clickProtocol.test.mjs` executes the actual pinned
pointer callback and raw-send methods with controlled dependencies. It checks
forward-once arguments, result/error identity, the original swallowed failure,
distinct pending mouse/interceptor prefixes, privacy, caps and isolated failures.
It also checks the inverse source patch and rejects drift or double application.
These controls are not a reproduction of the historical stall.

Run the existing seven-file Bun lifecycle command at unchanged bounds. Inspect
the normal source-bound Windows job's `reports/lifecycle-click` artifact. A new
natural failure may show a pending method/stage, but an absent response or a
successful occurrence does not establish its cause. Native gates remain separate
and required. Existing review is preserved under the tests/CI/docs-only no-repeat
policy; no new-head review verdict is invented.
