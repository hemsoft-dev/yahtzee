# Unsigned device archive preparation

Issue #46 already has pinned simulator builds and four native gameplay/lifecycle
test groups in Application quality. The separate **Unsigned iOS device archive**
workflow prepares the Release device binary without credentials, signing,
provisioning, export or upload. It runs on affected pull requests and supports
manual regeneration of a selected ref. Its passing result is required by the
review process for changes that trigger it, alongside every Application quality
job. It is not a signed distribution qualification.

Use a fresh, clean macOS checkout at the candidate revision:

```sh
bun install --frozen-lockfile --ignore-scripts
node scripts/ios-archive/run.mjs
```

The runner selects Xcode 26.6 (17F113), device SDK 26.5, Node 24.12.0, Bun 1.4.2
and CocoaPods 1.17.0. It rejects any other version. Apple's
[upload requirements](https://developer.apple.com/news/upcoming-requirements/),
checked November 2, 2026, require Xcode 26 or later and the iOS/iPadOS 26 SDK.
Recheck the live requirement before each release. The minimum runtime remains
iOS 17.0. Generated native files remain ignored; settings come from Expo config
and plugins. The runner uses the reviewed Podfile.lock with deployment mode.

The archive command has a 40-minute timeout inside a 60-minute hosted job.
Other commands have shorter timeouts. Existing native projects and report paths
are never overwritten. Untrusted PR code runs on an ephemeral public macOS
runner with a read-only token, no retained checkout credentials and no secrets.
There is no credentialed release job or persistent self-hosted execution.

## Retained evidence

Download the artifact within its one-day retention period. Its immutable
`reports/device-archive-evidence/manifest.json` records the source commit, job
run/attempt, runner image, actual tools, bundle identity, mobile version/build,
embedded JavaScript hash, compiled assets hash and artifact byte sizes/hashes.
It reports failure when any command or inspection fails. Missing or partial
evidence is not a pass.

The artifact includes the unsigned `.xcarchive` compressed with its dSYMs,
Hermes source map, Bun and CocoaPods locks, Expo configuration, compiled
Info.plist fields, native privacy inventory and command logs. DerivedData and
Pods stay out of the upload. No IPA is produced. Archive tarballs retain Xcode's
normal bundle structure; inspect them as build artifacts, not arbitrary
untrusted archives to extract over a working checkout.

Inspection checks the device platform and SDK, exact identity/version/build,
deployment floor, both device families, portrait/landscape declarations,
phone/tablet AppIcon references, compiled asset catalog, embedded JS, symbols,
source map and Expo FileSystem/aggregate privacy resources. Generated entitlement
files must be empty; the archive must have no app code signature. This is a check
of proposed entitlements, not verification of distribution signing. Original
icon-source/export hashes, dimensions, opacity and tinted grayscale run before
compilation. These checks cannot prove installed icon appearance, launch
animation, network behavior, store approval or hardware gameplay.

## Release boundary

The [mobile baseline](mobile-release-baseline.md) owns version/build numbering.
Archive preparation does not reserve or consume an App Store build number;
increment it before another distribution candidate and never reuse an uploaded
number. Xcode output is source- and dependency-bound, not promised bit-identical
across runner-image changes.

Signing remains unconfigured by design. A later authorized release workflow must
use approved secret storage, a protected approval boundary and least privilege,
verify distribution entitlements/provisioning/signatures and retain the IPA and
checksums. Certificate renewal/recovery, App Store Connect access, export and
TestFlight/upload require that later scope. Do not add secrets to this PR job or
reuse another app's signing material. #46 stays open for signed-distribution
acceptance. Store screenshots and storefront verification remain in #51.
