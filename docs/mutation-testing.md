# Core-rule mutation testing

## Run it

```sh
bun install --frozen-lockfile --ignore-scripts
bun run test
bun run mutation:probe
bun run mutation
```

Qualification uses Node 24, Bun 1.4.2, Stryker 10.1.1, its TypeScript checker 10.1.1 and report metrics/schema 3.8.4. Versions and transitive resolutions are locked. No deployment, credentials or production database is needed.

[The configuration](../stryker.config.json) mutates scoring, totals, maximum-score calculation, AI selection, game-log statistics, in-memory rankings and the actual Convex leaderboard query/write helper. Its five source paths are explicit. Generated Convex code is available for compilation but is never mutated.

The command runner executes the six engine/backend rule-test files listed in the configuration for each valid mutant. Tooling and dependency-policy tests still run in `bun run test`; they do not run for every rule mutant. Add new rule-test files to the mutation command when introducing them. Stryker reports this command as one synthetic test group, not as an individual-test count.

Coverage optimization is off because the command runner cannot report per-test coverage. Every valid mutant runs the selected suite. Four workers divide checking and execution. The accurate TypeScript-checker mode rejects invalid programs before tests. Its config disables declaration emission because these backend functions are not a distributable declaration package; strict source checking remains enabled.

## Thresholds and results

The break threshold is **95%** and the target is **98%**. Keep the break threshold maintained with the tests; do not lower it to accept a failing change. CI runs on the candidate revision, not on a nightly substitute. The required `quality-gate` fails if either application qualification or the mutation job fails, is cancelled or is skipped.

The wrapper also rejects missing/incomplete scope, empty runs, pending mutants, runtime errors and undeclared suppressions. A zero-mutant run cannot pass. Compile errors and explicit exclusions are reported separately rather than counted as kills.

Calibration on Windows used unchanged production source from `78217346b458b837faf99c2646f2c14c4f58fb26`. The initial existing-test run took 193.0 seconds. Adding the assertion cases in this change took the measured score from 86.4780% to 98.1132%; that run took 184.9 seconds. These are development measurements. Each candidate report records its own Git revision, dirty state and duration.

| Result | Existing assertions | Strengthened assertions |
|---|---:|---:|
| Generated mutants | 546 | 546 |
| Killed | 272 | 309 |
| Timed out | 3 | 3 |
| Survived | 43 | 6 |
| No coverage | 0 | 0 |
| Compile errors | 138 | 138 |
| Runtime errors / pending | 0 / 0 | 0 / 0 |
| Explicitly ignored | 90 | 90 |
| Valid mutants | 318 | 318 |
| Score | 275 / 318 = 86.4780% | 312 / 318 = 98.1132% |

New assertions catch 37 previously surviving mutants. They check totals including the bonus, maxi-category ties against Chance, face-one matching, zero scores and real backend ranks, mixed-player/mode statistics, rounded durations, copied scorecards, stable tied winners, multi-player top-ten insertion and original/current ranks.

The report retains every survivor. The HTML/JSON results and a concise Markdown summary are written under `reports/mutation`. CI keeps these and the sensitivity proof in revision-named artifacts for three days. Missing reports or nonzero Stryker exits fail the command even if a numeric score could otherwise pass.

## Exclusions and remaining survivors

The only ignored mutation operator is `StringLiteral`. It substitutes empty strings for category display labels, error copy and typed category/index names. This numeric/ranking gate excludes that operator; it does not claim mutation coverage of wording. Numeric, logical, comparison, collection and function-body mutations remain enabled. Ordinary typechecks and client qualification remain required. Do not extend this exclusion to additional operators without reviewing the lost coverage.

No equivalent-mutant suppression is used. Six survivors remain in the denominator, even where the current domain makes their effects redundant:

| Calibration mutant | Location | Assessment |
|---|---|---|
| 171 | [AI initial best score](../packages/game-engine/src/game.ts) | Changing -1 to +1 preserves selection for legal dice. The only possible one-point category is Ones, which is first; all other positive scores are at least two. |
| 244 | [two-pair early return](../packages/game-engine/src/scoring.ts) | Without a first pair, the second search also returns zero. Removing the early return still scores zero. |
| 485, 489, 492, 524 | [in-memory score admission](../packages/game-engine/src/storage.ts) | Relaxing admission still reaches the final per-mode sort and top-ten trim. Stable sorting drops newly appended cutoff ties. These mutants remain visible rather than receiving hidden exceptions. |

IDs belong to this calibration and can change when source changes. Use file/location/operator data in the current report to review future survivors. A high mutation score is not proof that every possible defect is caught.

## Weakened-assertion control

`bun run mutation:probe` copies the real bonus calculation and its dependencies into a temporary directory. It narrows mutation scope to the bonus comparison and uses focused assertions below, at and above the boundary. It uses the same checker and unchanged 95% break threshold as the full gate.

The strong fixture kills all four mutants and exits 0 at 100%. The probe then weakens only the boundary assertion from an exact bonus to a nonnegative result. Unmutated tests still pass, but the `>=` to `>` mutant survives: three kills, one survivor, 75%, exit 1. The proof requires both those outcomes and the specific boundary mutant's status change, so an unrelated setup failure cannot count as success.

The script removes its temporary directory without following dependency links and verifies that production source is unchanged. Tracked tests are never weakened. This is a focused sensitivity control, not a claim that removing one assertion defeats the full suite's redundant tests. Proof logs, raw reports and summary remain under `reports/mutation-probe`.

## Tool dependency security

Stryker introduced a vulnerable transitive `qs` version through `typed-rest-client`. The root override pins fixed 6.16.0, with no advisory exceptions. [The dependency-policy tests](../packages/game-engine/tests/securityAudit.test.ts) verify the actual consumer's resolution and parser behavior, not only the lockfile. See [dependency security](security/README.md).
