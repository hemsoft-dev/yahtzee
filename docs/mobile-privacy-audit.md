# Mobile privacy engineering inventory

Prepared September 27, 2026 for [issue #48](https://github.com/hemsoft-dev/yahtzee/issues/48). This is an incomplete engineering record, not App Store answers or legal approval. The [policy source](../apps/mobile/PRIVACY.md) is a draft.

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
| Active game, dice, holds and opponents | One acknowledged SQLite document, retained for resume | iPhone simulator resume observed on `beff6ec`; physical interruption and airplane-mode checks remain |
| Completed results and local rankings | Last 500 games; top ten entries per mode | Physical retention, backup and restore checks |
| Appearance and game options | Local preferences | Device reset and restore checks |
| Legacy preferences | Import only the two documented old preference keys | Device upgrade fixture if an older native build is distributed |
| Diagnostics | Explicit allowlist; current source previews before sharing | Current native preview/cancel/share behavior and destination checks |
| Public technical feedback | User chooses an external GitHub issue page | Owner-approved private contact and public support copy |
| OS backup | SQLite lives under Documents/SQLite | Real-device backup eligibility, restore and older-data behavior |
| Expo updates | Disabled in the inspected compiled configuration | Recheck the signed candidate and measured traffic |
| SDK telemetry and crash behavior | No app-authored telemetry client; declared manifests inspected | Measure every release SDK, including OS-mediated diagnostics |
| Account, ads, purchases and cloud sync | Not implemented in the native app | Confirm final scope has not changed before declarations |

See [the persistence boundary](mobile-offline.md) for storage and recovery behavior. The Node, browser and Bun SQLite tests do not replace device evidence.

## Signed-candidate acceptance still required

1. Run the same package inspection against the actual signed archive and retain source, archive hash, toolchain, module versions and all manifests. Verify SDK signatures and entitlements separately; the simulator inspection does neither.
2. Measure launch, a complete game, resume, reset, Help, cancelled diagnostics, explicit sharing and external support navigation. Identify which process and destination made each request. Do not treat build-time telemetry settings as a runtime traffic audit.
3. Verify device backup, offload, deletion and restore. Use synthetic names and scores. Preserve existing user data and review captures before sharing.
4. Review the app and SDK encryption use. No application-level database encryption is configured. Platform TLS and SDK code still require classification. An owner must approve export-compliance answers and any supporting documents.
5. Reconcile measured behavior with the privacy policy and App Store declaration matrix. Select the public policy URL and private contact without copying another app's identity or contacts.
6. Recheck [Apple's privacy details](https://developer.apple.com/app-store/app-privacy-details/), [SDK requirements](https://developer.apple.com/support/third-party-SDK-requirements/) and [Expo's privacy guidance](https://docs.expo.dev/guides/apple-privacy/) immediately before submission and after dependency or data-flow changes.

No missing declaration, contact or legal approval is filled by a guessed value. A manifest comparison proves packaging consistency only.
