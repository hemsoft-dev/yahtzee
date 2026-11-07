# Native reset navigation

The tablet-10 qualification on source
`37a229c16330c3c451cf114d6d5c643da5f38036` passed all three gameplay scenarios,
then failed the later corruption/reset search for **Delete all local data**.
[Run 41706424853](https://github.com/hemsoft-dev/yahtzee/actions/runs/41706424853)
retains the original failed execution. The failure image shows Help near its Reset
section, with the action below the viewport. Largest Dynamic Type remains enabled
after the preceding scenario. These observations establish the failing search,
not a storage defect or a general Maestro root cause.

The reset helper now identifies the actual `help-viewport` and intersects its
bounds with every ancestor to obtain the visible scroll area. Before opening the
confirmation, it requires one enabled action entirely inside that viewport and
every ancestor. An absent or offscreen action causes an interior swipe across
80% of the measured viewport height; an overshot action reverses direction.
This avoids the generic whole-screen search's center-to-edge gesture on long,
large-text content. See the official
[Maestro scroll behavior](https://docs.maestro.dev/reference/commands-available/scrolluntilvisible).

The search retains a single 60-second budget, including its animation waits,
inspections and swipes, with a secondary 30-inspection cap. A late snapshot,
ambiguous target, clipped control or failed gesture cannot authorize a tap.
Failures propagate without replay. Text size, content, the destructive warning,
cancellation check, dialog-position guard, database deletion and empty-save
assertions are preserved.

The helper records its geometry decisions and captures `reset-action-ready`
before the first confirmation-opening tap. The existing confirmation and final
reset captures remain. These artifacts must prove the actual native result;
synthetic protocol tests alone do not establish UIKit reachability.

Focused checks:

```sh
node --test scripts/ios-native/reset.test.mjs
node --test --test-concurrency=1 scripts/ios-native/*.test.mjs scripts/workflows/*.test.mjs scripts/ios-capture/*.test.mjs
```

Current-head hosted qualification must still pass at largest text, exercise
Cancel before confirmation, and verify both damaged-document and damaged-database
reset paths. No rerun, shorter content, reduced text size, longer deadline,
automatic deletion or weaker assertion substitutes for that evidence.

This is partial engineering work for
[#41](https://github.com/hemsoft-dev/yahtzee/issues/41). Signed physical-device,
backup and other release acceptance remain separate; the issue stays open.
