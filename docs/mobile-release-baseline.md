# Third Roll native release baseline

The accepted starting revision for #40 is `0b01666a84152bfca16dfe3f9e5f80a9bbf32ffe`
(Third Roll rename, #96). It already contains the shared TypeScript rules,
SQLite offline mobile runtime, native interface and original icon exports.
There is no second rules implementation or uncommitted redesign to import.

## Native generation and dependencies

Use Expo Continuous Native Generation. Commit app configuration, config
plugins, Bun's lock and `apps/mobile/native/Podfile.lock`; regenerate the ignored
`apps/mobile/ios` directory. Put future native settings in configuration or a
local config plugin, because hand edits to the generated Xcode project do not
survive regeneration. See [Expo's CNG documentation](https://docs.expo.dev/workflow/continuous-native-generation/).

The selected dependency set is Expo 57.0.31, React Native 0.86.3 and React
19.2.3. [The mobile package](../apps/mobile/package.json) pins the native
dependencies. Expo FileSystem builds from source so its privacy resource is
packaged; the [privacy audit](mobile-privacy-audit.md) explains that exception.
The reviewed CocoaPods lock and `pod install --deployment` reject native
dependency drift. A JavaScript export alone does not qualify this combination.

Use Node 24.12.0, Bun 1.4.2, CocoaPods 1.17.0 and Xcode 26.6 (17F113), with
iOS SDK/runtime 26.5, as pinned in the [native qualification guide](native-simulator.md).
Do not substitute the workstation's default Xcode. Native proof runs on public
macOS CI; Windows can run workspace checks and exports.

## Identity and version policy

The source of truth is [app.json](../apps/mobile/app.json): Third Roll,
`com.hemsoft.thirdroll`, iOS 17.0 minimum, iPhone and iPad, automatic light/dark
appearance and portrait/landscape support. iPad does not require full screen.
The `thirdroll` scheme supports Expo Router's native linking; it does not imply
an external account or backend. No push, iCloud, Game Center or associated-domain
entitlement is requested. The identifier is a project choice, not evidence of
an App Store Connect reservation.

The mobile marketing version starts at 1.0.0 and the iOS build at 1. Increment
`expo.ios.buildNumber` for every later distribution candidate; never reuse an
uploaded build number. Change `expo.version` for a new mobile marketing version
and keep `apps/mobile/package.json` aligned. Do not bump the root or desktop
package versions as part of iOS release numbering. Android's version code is a
separate platform decision.

## Local Xcode build profiles

Choose local Xcode rather than EAS for this hobby project: the existing public
macOS CI already pins and verifies the native tools, and no hosted build account
or signing service is needed. These are Xcode equivalents of three build
profiles, not EAS configuration.

For development, start in a fresh macOS checkout at the candidate commit:

```sh
export DEVELOPER_DIR=/Applications/Xcode_26.6.app/Contents/Developer
export EXPO_NO_TELEMETRY=1
bun install --frozen-lockfile --ignore-scripts
cd apps/mobile
node node_modules/expo/bin/cli prebuild --platform ios --no-install
cp native/Podfile.lock ios/Podfile.lock
(cd ios && pod install --deployment)
xcodebuild -workspace ios/ThirdRoll.xcworkspace -scheme ThirdRoll \
  -configuration Debug -sdk iphonesimulator \
  -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath ../../reports/native-debug CODE_SIGNING_ALLOWED=NO build
```

This Debug profile is for a developer running Metro (`bun run dev:mobile` from
the root) and is not an offline release qualification. Install/run the Debug app
on a selected simulator through Xcode. Device development requires separate
signing setup and is outside this preparation.

For the simulator profile, use a separate clean macOS checkout from the root:

```sh
bun install --frozen-lockfile --ignore-scripts
bun scripts/ios-native/run.mjs --build-only
```

That bounded runner regenerates native files, installs the deployment lock,
builds Release without signing, verifies the compiled identity and embedded
JavaScript, and retains a source-bound simulator artifact. The Application
quality workflow tests the same artifact across four gameplay/lifecycle groups.
See [native-simulator.md](native-simulator.md) for test-only commands and receipts.

For production preparation, generate and install the same locked project as in
development, then use the Release device destination:

```sh
xcodebuild -workspace ios/ThirdRoll.xcworkspace -scheme ThirdRoll \
  -configuration Release -sdk iphoneos -destination 'generic/platform=iOS' \
  -archivePath ../../reports/ThirdRoll-unsigned.xcarchive \
  CODE_SIGNING_ALLOWED=NO archive
```

Run that command from `apps/mobile`. It prepares an **unsigned** device archive;
it cannot produce an installable distribution IPA. Archive automation and actual
artifact inspection belong to #46. No certificate, provisioning, export,
upload or submission command is authorized by this baseline.

## Initial evidence and remaining qualification

The accepted base's [Application quality run](https://github.com/hemsoft-dev/yahtzee/actions/runs/41523939067)
successfully built the unsigned simulator app and passed Linux/Windows
validation, mutation, phone-six and tablet-ten. Phone-five and tablet-eight
failed native interaction qualification; therefore the overall quality gate
failed. This is build/configuration evidence, not a qualified release, and no
failure may be bypassed to merge this work. The new Debug and device-archive
commands above still require their own macOS execution evidence.

The assets tracked by #45 already exist, including light/dark/tinted icons and
the launch mark with editable source and MIT provenance. Retain native visual
inspection as a release task. Runtime offline work is documented in
[mobile-offline.md](mobile-offline.md). Signing, App Store Connect, TestFlight,
physical-device acceptance and final submission remain outside this baseline.
