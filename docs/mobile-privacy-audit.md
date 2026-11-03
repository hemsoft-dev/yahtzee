# Mobile privacy engineering inventory

Updated November 2, 2026 EST for [issue #48](https://github.com/hemsoft-dev/yahtzee/issues/48). This engineering audit remains incomplete for signed release acceptance. The [public development policy](https://hemsoft-dev.github.io/yahtzee/privacy.html) is live; [source and release limits](../apps/mobile/PRIVACY.md) remain versioned. No App Store Connect access or legal attestation occurred.

## Observed native package

The first [native build](https://github.com/hemsoft-dev/yahtzee/actions/runs/36355495021), source `53bbfd32e17481f698db75ec2117440ea9d1d089`, produced an unsigned Release simulator app with Xcode 26.6 and SDK 26.5. Its packaged-app SHA-256 is `90d67f5d24e5135d7057d3a402962145e6e2891a09689d5ee1538d65ff364eda`. The build's [artifact](https://github.com/hemsoft-dev/yahtzee/actions/runs/36355495021/artifacts/10944680287) has limited retention. It is not a signed device archive.

Reading the actual packaged property lists found:

- `CFBundleSupportedPlatforms` is `iPhoneSimulator`, with iPhone and iPad device families, minimum iOS 17.0, version 1.0.0 and build 1.
- There are no permission-purpose strings in the app's compiled Info.plist.
- App Transport Security disallows arbitrary loads and permits local networking. This configuration is not a firewall or evidence that the app made no requests.
- `EXUpdatesEnabled` is false. `EXUpdatesCheckOnLaunch` is `ALWAYS`, but that setting does not enable the disabled update mechanism. The app contains its own `main.jsbundle`.
- `ITSAppUsesNonExemptEncryption` is absent. No classification has been asserted.
- Ten privacy manifests are present. Their declared collected-data arrays are empty; none declares tracking. Those declarations alone do not prove actual data flows.

## Verified packaging finding

The first app's `ExpoFileSystem_privacy.bundle` contains only its bundle Info.plist. Its `PrivacyInfo.xcprivacy` is absent. The aggregate app manifest also lacks the locked SDK's disk-space reasons and two file-timestamp reasons.

The installed `expo-file-system` 57.0.7 source does contain the manifest. Its podspec declares that resource bundle. The CocoaPods log identifies Expo FileSystem as precompiled, and the app embeds its precompiled framework. Listing all archive entries ruled out a skipped hardlink or a misplaced file.

The source manifest declares file-timestamp reasons `0A2A.1` and `3B52.1`, and disk-space reasons `E174.1` and `85F4.1`. These are recorded as upstream SDK declarations, not independently approved reasons for this app.

The repair opts only `expo-file-system` into source compilation through the SDK 57 Apple autolinker's `buildFromSource` option. [Native build 36361758690](https://github.com/hemsoft-dev/yahtzee/actions/runs/36361758690), source `bc040c05b0a36ca6e4d214bba7dee14ce939dc86`, passed deployment-mode installation and package inspection. Eleven manifests are present. The SDK resource matches upstream, and all four previously missing reasons appear in the aggregate. The retained build's ten artifact hashes verified after download.

[The inspection tool](../scripts/ios-native/privacy.mjs) compares each new built resource with the locked SDK source and checks those aggregate reasons. It retains observed manifests and purpose strings without supplying legal answers. This passing simulator inspection does not establish signed-archive contents, SDK signatures or network behavior.

## Data-flow inventory

| Data or behavior | Source behavior | Remaining evidence |
| --- | --- | --- |
| Player name and five recent names | Local preferences only | Device traffic measurement and reset/uninstall check |
| Active game, dice, holds and opponents | One acknowledged SQLite document, retained for resume | Current reviewed source `86011d8` passed unsigned iPhone/iPad cold-resume qualification, with one disclosed phone-six fresh retry; physical interruption and airplane-mode checks remain |
| Completed results and local rankings | Last 500 games; top ten entries per mode | Physical retention, backup and restore checks |
| Appearance and game options | Local preferences | Device reset and restore checks |
| Legacy preferences | Import only the two documented old preference keys | Device upgrade fixture if an older native build is distributed |
| Diagnostics | Explicit allowlist; source previews before sharing; native preview/cancel observed | Physical-device OS sharing and destination/traffic checks remain |
| Public technical feedback | User chooses an external GitHub issue page | Live public support and GitHub private security reporting; general private support without GitHub remains unavailable |
| OS backup | SQLite lives under Documents/SQLite | Real-device backup eligibility, restore and older-data behavior |
| Expo updates | Disabled in the inspected compiled configuration | Recheck the signed candidate and measured traffic |
| SDK telemetry and crash behavior | No app-authored telemetry client; declared manifests inspected | Measure every release SDK, including OS-mediated diagnostics |
| Account, ads, purchases and cloud sync | Not implemented in the native app | Confirm final scope has not changed before declarations |

See [the persistence boundary](mobile-offline.md) for storage and recovery behavior. The Node, browser and Bun SQLite tests do not replace device evidence. The [reviewed native qualification](https://github.com/hemsoft-dev/yahtzee/actions/runs/36795531946) and [merged foundation](https://github.com/hemsoft-dev/yahtzee/pull/57) add unsigned simulator observations, not signed-candidate acceptance. The historical package hashes above remain historical and must not be presented as a new candidate's hashes.

## Signed-candidate acceptance still required

1. Run the same package inspection against the actual signed archive and retain source, archive hash, toolchain, module versions and all manifests. Verify SDK signatures and entitlements separately; the simulator inspection does neither.
2. Measure launch, a complete game, resume, reset, Help, cancelled diagnostics, explicit sharing and external support navigation. Identify which process and destination made each request. Do not treat build-time telemetry settings as a runtime traffic audit.
3. Verify device backup, offload, deletion and restore. Use synthetic names and scores. Preserve existing user data and review captures before sharing.
4. Review the app and SDK encryption use. No application-level database encryption is configured. Platform TLS and SDK code still require classification. An owner must approve export-compliance answers and any supporting documents.
5. Reconcile measured behavior with the privacy policy and App Store declaration matrix. Use the verified public policy URL and existing repository identity. Recheck the enabled private security route; do not copy another app's contacts.
6. Recheck [Apple's privacy details](https://developer.apple.com/app-store/app-privacy-details/), [SDK requirements](https://developer.apple.com/support/third-party-SDK-requirements/) and [Expo's privacy guidance](https://docs.expo.dev/guides/apple-privacy/) immediately before submission and after dependency or data-flow changes.

No missing declaration, contact or legal approval is filled by a guessed value. A manifest comparison proves packaging consistency only.

## November 2 packaged reinspection

Source `dee3455df2f4cb2670008edae66c3e485adbfcba`,
[build run](https://github.com/hemsoft-dev/yahtzee/actions/runs/41558133101),
[artifact 13196389920](https://github.com/hemsoft-dev/yahtzee/actions/runs/41558133101/artifacts/13196389920).
The [retained inventory](privacy/2026-11-02-native.json) records exact hashes,
all eleven manifest paths and fields, direct mobile dependencies and every
resolved Pod name/version from the retained lock. It excludes raw logs and
personal or device identifiers. Artifact retention is limited; the committed
inventory preserves observations, not the original binary or its signature.

Independent Python tar/plist inspection verified all ten artifact files against
the manifest's size/SHA-256 inventory, compared every packaged privacy manifest
with its retained JSON and SHA-256, and matched the built Pod lock to the
repository lock after newline normalization. The archive hash is
`cbcf39134dbd69e4f2f94bd7ab4fb1a6afb51be426b990ce8a466019f01e6500`.
This proves correspondence between retained files, not artifact authenticity or
release-signing validity.

The package identifies `com.hemsoft.thirdroll`, version 1.0.0/build 1, iOS 17,
iPhone/iPad families and iPhoneSimulator platform. No permission-purpose strings
are present. Arbitrary transport loads are disabled; local networking is
allowed. Expo updates remain disabled with an embedded bundle. The non-exempt
encryption declaration is absent, not false. All collected-data arrays observed
are empty; missing tracking fields are left absent in the inventory rather than
converted to explicit false. None of these facts establishes measured traffic.

The previously missing FileSystem bundle is present. Required-reason declarations
include FileTimestamp `0A2A.1`, `3B52.1` and `C617.1`; DiskSpace `E174.1` and
`85F4.1`; UserDefaults `CA92.1`; and SystemBootTime declarations recorded per
manifest. SDK resource declarations agree with the retained report. Review
actual API usage and reason suitability against the final archive; copying
upstream reasons is not independent justification for the app.

## Declaration review matrix

These are proposed interpretations of source and package evidence, not submitted
answers. A second pre-submission reviewer must reconcile each row with measured
signed-device behavior. The static cross-check above is independent of the
macOS inspection tool; it is not a second legal attestation.

| Item | Evidence and current interpretation | Release blocker |
| --- | --- | --- |
| Name, recent names, active games, dice and holds | SQLite source, local resume and inventory; intended on-device use only | Measure launch, play, resume, failed save and reset with synthetic data |
| Scores and preferences | Latest 500 games and top ten per mode; no native cloud ranking | Verify retention limits, device reset, offload, uninstall and restore |
| Diagnostics | Explicit allowlist preview; sharing only through an explicit OS sheet | Observe cancel and each chosen destination; classify off-device support data under Apple's rules |
| GitHub support and security reports | User leaves app for external GitHub destinations; public reports and private security reports follow GitHub processing | Do not equate external support retention with local-game deletion; general private support remains unavailable |
| SDK traffic and crash/OS diagnostics | Eleven package manifests; no app-authored telemetry client configured | Measure every bundled SDK and distinguish app traffic from OS/system services |
| Permissions and tracking | No compiled purpose strings; no approved ad/tracking feature | Inspect signed Info.plist, entitlements, SDK signatures and tracking behavior; no ATT or permission declaration is invented |
| Account deletion | No native account creation, login or remote account store | Re-evaluate if any account feature is added; local reset is data deletion, not an account-deletion flow |
| App privacy label | Local-only intent is documented; off-device behavior is not fully measured | Keep Data Not Collected unselected until all app/SDK flows support it |
| Export compliance | No app-level database encryption configured; platform networking and bundled native code remain relevant | Inventory encryption in final dependencies and classify exemptions; leave ITSAppUsesNonExemptEncryption unset until supported |
| Rights, rating prompts and future commerce | Original asset/license basis in release brief; no ads/purchases/subscriptions or enabled store-rating destination in this baseline | New SDKs, store destinations, prompts, diagnostics or commerce require a fresh review |

[Apple's app privacy guidance](https://developer.apple.com/app-store/app-privacy-details/)
requires evaluating third-party partners as well as the app. Local storage alone
cannot settle the declaration. The
[SDK requirements](https://developer.apple.com/support/third-party-SDK-requirements/)
cover manifests and, for listed binary SDKs, signatures. A simulator package
comparison cannot establish that the final binary meets them.

[Expo's manifest guide](https://docs.expo.dev/guides/apple-privacy/) describes
required-reason API declarations; this audit retains the aggregate and SDK
resources so they can be reviewed against actual use.
[Apple's export workflow](https://developer.apple.com/help/app-store-connect/manage-app-information/overview-of-export-compliance/)
requires determining the app's encryption use and any documentation before
submission. No exemption, country-specific document or business attestation is
inferred from offline gameplay. The export flag and store answers remain unset.

These sources were rechecked November 2, 2026 EST. Recheck them again immediately
before submission and after material dependency or data-flow changes. The
signed archive, physical-device traffic/backup evidence, SDK-signature inspection
and legal export/declaration acceptance remain unavailable in this Windows-only,
no-App-Store-Connect session. They keep #48 open and block submission.
