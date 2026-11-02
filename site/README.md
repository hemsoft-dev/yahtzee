# Third Roll companion site

Publication authorized by Franz on November 2, 2026 for free hosting only.
GitHub Pages serves this public repository without a new subscription or domain.
HemSoft repository maintainers own content, deployment and rollback. No external
contact address, store account, signed artifact or private identity is published.

## Stable destinations

- [Marketing](https://hemsoft-dev.github.io/yahtzee/)
- [Rules and support](https://hemsoft-dev.github.io/yahtzee/support.html)
- [Privacy policy](https://hemsoft-dev.github.io/yahtzee/privacy.html)

These are deployment targets until the first successful main-branch deployment
and unauthenticated HTTPS verification. Record that receipt in
[issue #49](https://github.com/hemsoft-dev/yahtzee/issues/49) after merge. No App
Store link or badge is shown before a verified listing exists. The primary
prerelease action opens the rules; release tracking is linked alongside it.

## Build and verify

Use Node 24 and frozen Bun 1.4.2 dependencies for browser testing.

```sh
node --test site/*.test.mjs
node site/build.mjs reports/site-public-local --publish
node site/browser.mjs reports/site-review-local
```

The builder refuses existing output. Pages need no JavaScript, backend or
runtime secrets. Browser checks use a temporary loopback server, close it on
completion and cover desktop, phone light/dark and 320px/200% text. They retain
screenshots and verify overflow, target size, keyboard focus, disclosures,
contrast, links, storage and network isolation. They do not certify screen-reader
conformance. Run commands under a hard timeout on shared laptops.

## Deployment and rollback

[Publication workflow](../.github/workflows/site-pages.yml) publishes only main
pushes affecting the site, scoring source, font assets or deployment workflow. Maintainers can
also dispatch it on main. It builds only allowlisted static content into
`reports/site-public`, uploads that directory, and deploys with a short-lived
GitHub Pages OIDC token scoped to the `github-pages` environment. There are no
personal credentials. PRs run the separate preview workflow and never deploy.

Configure the repository Pages source as GitHub Actions and enforce HTTPS.
Deployment ownership follows repository maintainer permissions, not a local
checkout. Revert a faulty change through a normally reviewed PR, then let main
redeploy. For a broken deployment with correct source, rerun the main workflow.
Keep the same stable URLs. Never upload the repository root or engineering
reports as the public artifact.

## Evidence and content

Current rules come from [scoring.ts](../packages/game-engine/src/scoring.ts).
The [release brief](../docs/mobile-release-brief.md) controls launch claims.
Native source and unsigned simulator evidence establish development behavior;
signed-device, backup/restore and privacy acceptance remain release gates.

The two original PNGs are unaltered simulator captures of empty setup and Help,
with no player information or test records. [Provenance](assets/provenance.json)
records the exact source, CI artifact and hashes. They illustrate the current
development UI, not final App Store screenshots. No fictional fixture or played
score is represented as release evidence.

The site retains [DESIGN.md](../DESIGN.md), bundled Manrope with its
[OFL license](../packages/ui/src/assets/OFL.txt), mineral/evergreen surfaces,
clay actions and original pip geometry. Added screenshots follow the reading
layout. No redesign of app source is included.

The HTML privacy policy in [pages.mjs](pages.mjs) is the public policy source.
[Mobile privacy notes](../apps/mobile/PRIVACY.md) link to it and preserve audit
limits. GitHub Pages logs IP addresses for security under
[its documented practices](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages)
and [privacy statement](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement).
We do not promise a retention period for GitHub's logs. There is no analytics,
form, embed, cookie code, remote font or browser storage in these pages.

[Private vulnerability reporting](https://github.com/hemsoft-dev/yahtzee/security/advisories/new)
was enabled and API-verified on November 2. Reports require GitHub; general
private support without GitHub remains a release-support limitation. No personal
contact details are copied from other projects.
