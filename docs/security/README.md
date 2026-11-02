# Dependency security

The September 18, 2026 baseline contained 24 affected package names and 116 distinct advisory URLs. That baseline was repaired to an empty `bun audit --json` report. The October 9 and November 1 additions below address newly published advisories. One exception is accepted, for minimatch; see [November 1 repairs](#november-1-repairs).

- [Original scanner report](audit-before.json)
- [Updated scanner report](audit-after.json)
- [Per-advisory inventory](advisory-inventory.json), including exact locked versions, representative dependency paths, reachability assessments and dispositions. Multiple affected versions can produce multiple rows for one URL.

Scanner severity is not evidence that an application endpoint is exploitable. Electron advisories differ by API; developer-server and build-tool advisories still matter when their inputs or network peers are untrusted. No production exploit was attempted.

## Updated toolchain

Direct toolchain versions are pinned. Expo 57.0.31 uses its published React 19.2.3, React Native 0.86.3 and native-module compatibility set, apart from three pins. `expo install --check` exits 1 on those: AsyncStorage 3.1.1 (expected 2.2.0), react-native-safe-area-context 5.9.1 (expected ~5.7.0) and @types/react 19.3.0 (expected ~19.2.4). TypeScript 6.0.3 matches that SDK. Explicit repository root directories in the web/desktop typechecks accommodate TypeScript 6's changed root-directory default and Convex's typed API imports.

On desktop, Electron 44.9.1, electron-vite 5.0.0, Vite 7.3.7 and plugin-react 5.2.0 have compatible peer ranges. Desktop stays on Vite 7 because electron-vite 5 supports Vite 5 through 7, and plugin-react 6 requires Vite 8. Web uses Vite 8.3.3 and plugin-react 6.1.2. Convex 1.46.0 and convex-test 0.0.59 are aligned. The lockfile was regenerated from the pinned manifests to refresh stale compatible transitive versions; subsequent frozen installs preserve it.

Node must satisfy the root `engines` field. Qualification uses Node 24 and Bun 1.4.2. Expo Android JavaScript/Hermes export passes; that is not a native device, signing or installation test.

## Compatibility patch

The original two transitive overrides removed the final advisories in that baseline. UUID 11.1.1 retains CommonJS and ESM entry points. Since Expo 57.0.31, `xcode` 4 no longer depends on uuid, so no locked package installs it and that override currently has no effect. decode-uri-component is ESM-only in 0.5.0, the fixed release this override first selected, and in 0.5.1, the installed version, while Expo Router's query-string 7 consumer expects a CommonJS function. [The one-line patch](../../patches/query-string@7.1.3.patch) selects its default export. Bun applies this checked-in patch during frozen installs; editing node_modules by hand is not the delivery mechanism.

The test suite resolves query-string through the actual Expo Router installation and checks parsing, encoding, repeated values, Unicode and malformed input. Remove the override/patch together when the upstream router consumes a compatible fixed query-string release. HemSoft owns this follow-up. Review it by October 18, 2026; it is a compatibility patch, not an advisory suppression.

## Mutation-tool dependency

Stryker 10 adds `typed-rest-client`, which selected vulnerable `qs` 6.15.1. The third root override first selected 6.16.0 to address [array-limit bypass](https://github.com/advisories/GHSA-x5fp-wj9c-mxmx), [attacker-controlled isBuffer](https://github.com/advisories/GHSA-4mjr-xmp4-gh2g) and [null/undefined comma-array serialization](https://github.com/advisories/GHSA-q8mj-m7cp-5q26), and it now pins 6.17.0. No exception is accepted for `qs`.

The regression suite resolves `qs` through the actual Stryker REST-client dependency, verifies its version against the override and checks normal encoding, null-array serialization and bounded comma parsing. This caught a stale local Bun dependency link even after the lockfile scanner was green. Reinstalling with `bun install --frozen-lockfile --ignore-scripts --force` repaired that link. Fresh CI installs and the consumer regression verify the delivered graph.

## Continuous checks

`bun run security` runs the native Bun scanner against the full lockfile and fails on every unaccepted advisory, including low severity. Invalid reports, scanner failures and expired exceptions fail closed. [Dependency security](../../.github/workflows/dependencies.yml) runs for all PRs, main pushes and daily, with isolated hosted runners and no deployment credentials. Require its exact `dependency-audit` status after installation, alongside `quality-gate`.

Dependabot alerts and security updates are enabled. [The updater configuration](../../.github/dependabot.yml) uses the supported **bun** ecosystem at the workspace root, plus GitHub Actions updates. Earlier automatic npm scanning of the nested desktop manifest failed because it lacked a recognized lockfile or exact Electron requirement. The Bun configuration uses the actual text lockfile. See [GitHub's supported ecosystems](https://docs.github.com/en/code-security/dependabot/ecosystems-supported-by-dependabot/supported-ecosystems-and-repositories).

Future exceptions require an exact package/advisory URL, owner, concrete rationale and expiry in [security-exceptions.json](../../security-exceptions.json), reviewed in a PR. A negative validation temporarily restored vulnerable UUID 8.3.2; the real security command exited 1 on GHSA-w5hq-g745-h8pq. Restoring the reviewed manifest/lockfile returned the check to green.

## October 9 repairs

Pinned overrides update http-cache-semantics to 4.3.0, shell-quote to 1.12.0 and source-map-js to 1.2.2. Three packages still lack published patched releases, so frozen installs apply checked-in Bun patches:

- braces 3.0.3: bound parser, recursive AST traversal and nested expansion-array depth for [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm).
- node-forge 1.4.0: reject additional RSA DigestInfo algorithm-sequence elements and nonempty or non-NULL parameters for [GHSA-86w9-cpqp-85rv](https://github.com/advisories/GHSA-86w9-cpqp-85rv). Replaced by upstream 1.4.2 on November 1.
- sprintf-js 1.1.3: bound numeric precision to the supported JavaScript range for [GHSA-hp3w-g68c-fv3c](https://github.com/advisories/GHSA-hp3w-g68c-fv3c).

The repairs still in use are braces 3.0.3, sprintf-js 1.1.3 and deepmerge 4.3.1. Of those, Bun's version scanner reported only deepmerge on November 1. The audit recognizes only their exact package/advisory identities after verifying the pinned override, patch registration, patch SHA-256, installed version and repaired source hashes for every matching Bun package-store copy. It also runs exploit regressions and ordinary-input checks. Missing or changed patches, vulnerable duplicate versions, failed regressions and every other advisory fail the command.

[security-remediations.json](../../security-remediations.json) records the delivered hashes. [Policy regressions](../../packages/game-engine/tests/securityRemediations.test.ts) prove tampering and unrelated advisories remain errors. Remove each patch, override and matching remediation record together when a compatible upstream release incorporates the fix; run the exploit regressions and full audit before merging that replacement.

## November 1 repairs

Advisories published on October 30 turned the daily audit red on `main`.

- node-forge: 1.4.2 fixes the eleven new advisories. It also rejects every GHSA-86w9-cpqp-85rv fixture in the exploit regressions without a local patch, so the patch, override and remediation record were removed together and the regressions stay in place.
- glob: 14.0.3 fixes [GHSA-3g3m-2fjr-6pw4](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4). Expo's packages ask for `^13.0.0`, while `@electron/asar` and `rimraf` need the unaffected glob 7 API, so the overrides are scoped to the five Expo consumers. Glob 14 keeps the exports Expo calls. Scoped overrides require `lockfileVersion` 3, which Bun 1.4.2 and Dependabot both read. Remove them when Expo depends on a fixed glob.
- minimatch: [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249) is accepted as an exception until February 1, 2027. HemSoft owns it. The scanner flags everything below 11.0.1, and 11 removes `makeRe` and changes the matcher, so it cannot replace the versions ESLint, electron-builder, Stryker and Expo require. The affected preprocessing runs only at `optimizationLevel` 2 or higher. minimatch 3.1.5 and 5.1.9 do not contain it, no installed direct caller of 9.0.9 or 10.2.6 sets that option, and glob, which does, now uses minimatch 11. These are developer and build tools that read repository-owned patterns, never player input. Before the expiry, recheck whether those consumers have moved to a fixed release.

The inventory's `current` values for electron, undici, vite, shell-quote and decode-uri-component were refreshed from `bun.lock` on November 1, and none of them is inside its record's vulnerable range. Its disposition text still describes the September 18 baseline. On November 1, `bun audit --json` reported only deepmerge, which is repaired, and minimatch, which is the exception above.
