# Third Roll product-page preparation

Prepared November 2, 2026 EST for [#50](https://github.com/hemsoft-dev/yahtzee/issues/50).
Editable English sources are in [metadata/en-US](metadata/en-US/listing.json).
This is offline copy review, not an App Store Connect preview or sync receipt.
No store account, upload or submission was accessed. All source-review statuses
stay draft. The merge hold remains until Franz says PR #98 has merged.

## Fields and limits

| Field | Prepared value or source | Current check |
| --- | --- | --- |
| Name | Third Roll | 10 / 30 characters |
| Subtitle | Offline dice, house rules | 25 / 30 characters |
| Promotional text | listing.json | 118 / 170 characters |
| Description | [description.txt](metadata/en-US/description.txt) | 1,308 / 4,000 characters of upload copy; plain text |
| Keywords | listing.json | 65 / 100 UTF-8 bytes; comma-separated; each term over two characters |
| Copyright | 2026 Franz Hemmer / HemSoft Developments | Matches the existing repository LICENSE; confirm final rights declaration before submission |
| Category | Games; proposed Dice and Board subcategories | Category selection is preparation, not a saved store value |
| Secondary category | Deferred | Optional; no second app category selected |
| Marketing | [Public overview](https://hemsoft-dev.github.io/yahtzee/) | Live HTTPS 200, unauthenticated |
| Support | [Rules and support](https://hemsoft-dev.github.io/yahtzee/support.html) | Live HTTPS 200; public contact requirement remains unresolved |
| Privacy | [Policy](https://hemsoft-dev.github.io/yahtzee/privacy.html) | Live HTTPS 200; signed-release privacy acceptance pending |
| Review notes | [review_notes.txt](metadata/en-US/review_notes.txt) | Candidate verification instructions; private contact fields excluded |
| Version and release text | 1.0.0/build 1 proposed; [release_notes.txt](metadata/en-US/release_notes.txt) | Versioned-note work is in [PR #104](https://github.com/hemsoft-dev/yahtzee/pull/104); initial What's New may be absent |

The editable text files retain an explicit draft banner. Remove that banner
only as part of intentional source approval; the counts above describe the
proposed upload copy. The candidate checker rejects unapproved sources.

Limits were checked against Apple's current
[app-information reference](https://developer.apple.com/help/app-store-connect/reference/app-information/app-information/)
and [platform-version reference](https://developer.apple.com/help/app-store-connect/reference/app-information/platform-version-information).
The platform reference specifies keyword bytes, not characters. The selected
keywords contain no competitor names, trademarked game variants, app/company
name duplication, pricing claims or unsupported features. The title is still
subject to actual store-name reservation.

English, `en-US`, is the only approved launch localization. Keep name, subtitle,
description, review notes, release text and screenshots consistent in that
locale. Do not invent translations or duplicate unreviewed locale folders.
Check actual locale fallback and supported storefront behavior in the later
store preview. Native support is iPhone and iPad, iOS 17 minimum; no Android,
Watch, widgets or provider integration is advertised.

## Claim-to-evidence review

| Listing claim | Repository evidence | Acceptance limit |
| --- | --- | --- |
| 5/6/8/10 dice; solo/up to three computer opponents | [Setup](../src/screens/Setup.tsx), [save options](../src/local/save.ts) | Recheck exact signed candidate on iPhone and iPad |
| Three rolls, holding, category selection | [Session rules](../../../packages/game-engine/src/session.ts), [game screen](../src/screens/NativeGameScreen.tsx) | No optimal-strategy or unbeatable-AI claim |
| House rules, pairs, Full Straight 50, Castle and whole-hand matching | [Scoring registry](../../../packages/game-engine/src/scoring.ts), [Help](../src/screens/Help.tsx) | No licensed affiliation or standard 13-category claim |
| Offline play with saved games and local history/scores | [Local provider](../src/local/LocalProvider.tsx), [SQLite storage](../src/local/sqliteStorage.ts), [store](../src/local/store.ts) | Acknowledged saves only; no global rankings, remote players or sync |
| System/Light/Dark; diagnostic preview | [Help](../src/screens/Help.tsx), [diagnostics](../src/local/diagnostics.ts) | No accessibility certification or automatic-diagnostic-upload claim |
| No accounts, ads, purchases or subscriptions | Current native source and [release brief](../../../docs/mobile-release-brief.md) | Full SDK/traffic audit remains open; no Data Not Collected claim |
| Backups and reset limits | [Storage contract](../../../docs/mobile-offline.md), public privacy policy | Physical restore acceptance remains pending |

## Screenshots and optional features

Use the [scene manifest](screenshots.json) for the proposed order: setup,
hold dice, score combination, bonus progress, results, history. Capture each
accepted device family and English locale against the exact signed candidate,
then reconcile descriptions and crop safety. These scenes remain not-captured;
website setup/Help images are development illustrations, not accepted store
screenshots. No screenshot receipt or app preview is invented.

App preview, promotional campaigns, in-app events, product-page variants and
accessibility URL are deferred. Accessibility Nutrition Labels are not claimed:
unsigned scalable-text/dark-theme observations do not qualify every required
workflow on both supported device classes. Follow
[Apple's evaluation guidance](https://developer.apple.com/help/app-store-connect/manage-app-accessibility/overview-of-accessibility-nutrition-labels)
when device evidence exists. Do not select support based only on system controls.

## Remaining store blockers

- Apple's platform reference requires actual support contact information,
  such as a legal address, email or phone as applicable. GitHub issue/security
  routes are currently the only contact routes. A live URL alone does not
  establish that requirement. No unapproved private contact is published.
- Signed-device QA, final screenshots, privacy/export and age-rating consistency
  remain open. The current game has dice and chance without stakes, prizes,
  real-money gambling or purchases. Do not infer a numeric store age rating;
  complete the current questionnaire against the accepted build later.
- Confirm the copyright owner, app-record identity/name reservation, price and
  territory setup, review contact and legal declarations in a separately
  authorized session. Keep private details out of the repository.
- Sync to the correct app/version and preview both iPhone and iPad in App Store
  Connect only in that later session. Retain sanitized receipts and final copy
  review then. This session explicitly prohibits those actions.

No submitted privacy answer, store screenshot approval, sync receipt or final
store preview is claimed by these prepared files. #50 stays open for that work.
