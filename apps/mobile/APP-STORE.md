# iOS release tracker

Status: preparation only. No approved public name, signed candidate, App Store record, TestFlight acceptance or public release is recorded here. The current native app still uses Convex. A JavaScript export does not prove an offline iOS release.

Parent: [#38](https://github.com/hemsoft-dev/yahtzee/issues/38). Release records: [#47](https://github.com/hemsoft-dev/yahtzee/issues/47).

## Ownership and authority

The repository maintainer owns implementation, repeatable checks and evidence collection. The owner must approve public identity and rights, contact publication, price/territories, legal declarations, spending, external tester invitations, App Review submission and publication. A green script does not supply those approvals. Keep credentials, private contact information, identity documents and signing keys out of GitHub.

## Proposed scope, not a legal approval

Use the existing Expo/React Native app and shared TypeScript engine. The reversible engineering baseline is one local human, zero to three AI opponents, mobile presets of five/six/eight/ten dice and English. Preserve the current Castle rule of two distinct triples and the all-dice-matching rule in larger games. Do not invent a dedicated six-of-a-kind category or treat these choices as an owner-approved public rules contract.

Proposed v1 excludes accounts, remote multiplayer, cloud scores/sync, analytics, ads, purchases, subscriptions, Game Center, widgets and Watch. Device/orientation/minimum-OS details require native qualification. Keep the current development identifier private to development; do not reserve or publish an App Store identity under it.

The release scope and rights decision remains [#39](https://github.com/hemsoft-dev/yahtzee/issues/39). Existing repository branding and its MIT license are not trademark clearance.

## Candidate mapping and checks

[release/candidate.json](release/candidate.json) is an explicitly incomplete 1.0.0, build 1 proposal, separate from Windows 0.1.0. It links the [iOS changelog](CHANGELOG.md), [TestFlight notes](release/testflight-notes.md), [listing sources](release/metadata/en-US/listing.json) and [screenshot manifest](release/screenshots.json).

From the repository root:

```sh
node --test scripts/ios-release/*.test.mjs
node scripts/ios-release/check.mjs
```

Draft mode validates the record and source-file structure, prints every remaining release blocker, and never uploads anything. `consistent: false` is expected now. It is not a release pass.

For a real candidate, configure the accepted native version/build first. Compare the proposed build number against the latest App Store Connect build and every prior local archive; increment it and never reuse an uploaded number. Commit the approved source and metadata. Copy the record to an ignored `reports/ios-candidate.json` and fill its exact source SHA and artifact/evidence references there. Do not try to embed a commit's own SHA inside itself.

```sh
node scripts/ios-release/check.mjs --release \
  --record reports/ios-candidate.json --archive reports/accepted.ipa \
  --screenshots reports/ios-captures/manifest.json
```

The release check fails on an incomplete record, dirty source, mismatched native identity/version/build, wrong source SHA or archive checksum, draft copy, absent listing fields or screenshot provenance mismatch. All referenced copy and planning files must be tracked and match HEAD after CRLF/LF normalization, so clean Windows checkouts remain valid. Ignored, absolute and untracked source paths are rejected.

The tracked screenshot JSON is a scene plan, not a capture receipt. Generate the accepted capture manifest beside the images after freezing the source commit, then store its SHA-256 in the external candidate record. Give it status `accepted`, matching sourceCommit/version/buildNumber, and a nonempty captures array. Each capture needs filename relative to that artifact folder, sourceCommit, deviceFamily `iphone` or `ipad`, locale, appearance `light` or `dark`, pixel width/height, and SHA-256. The checker verifies each file's PNG signature, dimensions and hash; capture paths and symlinks cannot escape that folder. This does not replace visual review or Apple's current device-size requirements. Set listing status to `approved` only after the owner approves the copy. Each `sourceReviews` role also needs `approved` and the SHA-256 of its accepted UTF-8 text with LF line endings. Any later text change invalidates that receipt. Remove draft instructions and placeholders from accepted test and store notes. These recorded statuses do not grant legal authority; the maintainer must verify the owner's evidence separately. This is a consistency guard, not a signing validator or proof that cited owner/device evidence is genuine. Review those receipts separately. If dynamic Expo configuration replaces app.json, update the checker to consume the resolved configuration before using it for release.

Retain the accepted JSON beside the archive and sanitized QA receipts. Its iOS tag must point to the source SHA. On public release, verify the matching GitHub tag/release, public App Store version and dated changelog entry. No automatic release/changelog workflow currently publishes these files; do not duplicate Unreleased entries in generated notes if one is introduced.

## Editable content

The local metadata layout is Fastlane-style, but no Fastlane/EAS upload is configured. [description.txt](release/metadata/en-US/description.txt), [review_notes.txt](release/metadata/en-US/review_notes.txt) and [release_notes.txt](release/metadata/en-US/release_notes.txt) are clearly marked drafts. Null listing fields are unresolved decisions, not accepted defaults. Never upload these templates unchanged. First-release What's New may be absent in App Store Connect; do not require an updates-only field for the initial version.

## Release checklist and evidence

Leave a checkbox open until its linked receipt proves the exact candidate.

| Gate | Owner | Evidence and prerequisite |
| --- | --- | --- |
| Public identity, rights, scope, commerce | Owner | [#39](https://github.com/hemsoft-dev/yahtzee/issues/39), not approved |
| Shared baseline and native configuration | Maintainer | [#40](https://github.com/hemsoft-dev/yahtzee/issues/40), baseline PR under review |
| Offline saves, recovery and resume | Maintainer | [#41](https://github.com/hemsoft-dev/yahtzee/issues/41), real-device evidence required |
| Native UI and accessibility | Maintainer and device tester | [#42](https://github.com/hemsoft-dev/yahtzee/issues/42) |
| Team/app record, price, territories, EULA, trader status, age rating | Owner | [#43](https://github.com/hemsoft-dev/yahtzee/issues/43), App Store state not verified |
| Rules, support, privacy, reset and review paths | Maintainer | [#44](https://github.com/hemsoft-dev/yahtzee/issues/44) |
| Original licensed icon/launch assets | Maintainer and owner | [#45](https://github.com/hemsoft-dev/yahtzee/issues/45) |
| Native CI, archive, signing, checksum | Maintainer and signing owner | [#46](https://github.com/hemsoft-dev/yahtzee/issues/46) |
| Data flows, native manifests, privacy/export declarations | Maintainer and owner | [#48](https://github.com/hemsoft-dev/yahtzee/issues/48) |
| Public marketing/support/privacy URLs | Maintainer and owner | [#49](https://github.com/hemsoft-dev/yahtzee/issues/49) |
| Listing fields, claims and previews | Maintainer and owner | [#50](https://github.com/hemsoft-dev/yahtzee/issues/50) |
| Ordered native screenshots | Maintainer | [#51](https://github.com/hemsoft-dev/yahtzee/issues/51) |
| Signed TestFlight acceptance | Device tester and owner | [#52](https://github.com/hemsoft-dev/yahtzee/issues/52) |
| Submission approval, review correspondence and Apple approval | Owner | [#53](https://github.com/hemsoft-dev/yahtzee/issues/53) |
| Publication, store-installed smoke, source tag and support check | Owner and maintainer | [#54](https://github.com/hemsoft-dev/yahtzee/issues/54) |

- [ ] Record accepted app ID, bundle ID, version/build, source commit, archive hash and private receipt locations.
- [ ] Confirm all implementation and native QA gates, including offline restart and save recovery on iPhone and iPad.
- [ ] Recheck [Apple upload requirements](https://developer.apple.com/news/upcoming-requirements/) and [submission requirements](https://developer.apple.com/app-store/submitting/).
- [ ] Review current privacy/export/age/content-rights answers and owner approvals against the actual archive.
- [ ] Verify public URLs, localized copy, screenshots and required App Store Connect fields without placeholders.
- [ ] Get explicit TestFlight upload/invitation and App Review submission approval. Record sanitized IDs/status separately.
- [ ] Default to manual first release; obtain explicit publication approval after Apple approval.
- [ ] Verify the live listing and store-installed app, publish the dated iOS changelog/tag, and assign post-release support.

No checkbox is complete merely because this document exists. Update this tracker when each gate changes; record dates in Eastern Time.
