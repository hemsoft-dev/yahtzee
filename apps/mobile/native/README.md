# Native dependency lock

`Podfile.lock` was refreshed by CocoaPods 1.17.0 from source commit `65ae823fe7eb5778c812aa1164c0e1ced5984480` in [dependency-only run 36360477119](https://github.com/hemsoft-dev/yahtzee/actions/runs/36360477119). The reviewed diff changes only Expo FileSystem's external source from a precompiled podspec to its source directory. No versions or spec checksums changed. That refresh intentionally stopped before compilation.

The retrieved lock's SHA-256 is `77627085e3c13dc603feac806a0288268a993c18278193b4c5ed02dcee98c500`, using LF bytes. Its external sources point to the locked workspace packages and generated codegen directories, not workstation paths. The inspected native modules include Expo 57.0.24, Expo SQLite 57.0.3, AsyncStorage 2.2.0 for legacy preference import, React Native 0.86.3 and its declared navigation/runtime dependencies. There are no Apple signing credentials in this directory.

The [native runner](../../../scripts/ios-native/run.mjs) copies this lock into a newly generated Expo project and uses `pod install --deployment`. It also checks the generated lock against source. Do not edit dependency versions or checksums by hand.

For an intentional dependency update, use a fresh macOS checkout with the documented toolchain and run `bun scripts/ios-native/run.mjs --refresh-pods`. Review the replacement in `reports/native/Podfile.lock`, commit it here, and repeat normal qualification. Refresh-only mode always stops before compilation. A missing or changed lock remains a non-passing result until reviewed source matches. See the [qualification guide](../../../docs/native-simulator.md) for tool versions and evidence limits.
