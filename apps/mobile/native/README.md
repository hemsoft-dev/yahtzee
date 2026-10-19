# Native dependency lock

`Podfile.lock` was refreshed by CocoaPods 1.17.0 from source commit `29b72df861f04ea3826de6e2436aae87def1a028` in [dependency-only run 39220659592](https://github.com/hemsoft-dev/yahtzee/actions/runs/39220659592). The reviewed diff replaces the AsyncStorage 2.2.0 pod with AsyncStorage 3.1.1 and its matching source/checksum. All other versions and spec checksums are unchanged. That refresh intentionally stopped before compilation.

The retrieved lock's SHA-256 is `2136a120327b48accb1cbb6ee164448f84f28f9b1e35eb601e255b4a1a3f2fb3`, using LF bytes. Its external sources point to the locked workspace packages and generated codegen directories, not workstation paths. The inspected native modules include Expo 57.0.24, Expo SQLite 57.0.3, AsyncStorage 3.1.1 for legacy preference import, React Native 0.86.3 and its declared navigation/runtime dependencies. There are no Apple signing credentials in this directory.

The [native runner](../../../scripts/ios-native/run.mjs) copies this lock into a newly generated Expo project and uses `pod install --deployment`. It also checks the generated lock against source. Do not edit dependency versions or checksums by hand.

For an intentional dependency update, use a fresh macOS checkout with the documented toolchain and run `bun scripts/ios-native/run.mjs --refresh-pods`. Review the replacement in `reports/native/Podfile.lock`, commit it here, and repeat normal qualification. Refresh-only mode always stops before compilation. A missing or changed lock remains a non-passing result until reviewed source matches. See the [qualification guide](../../../docs/native-simulator.md) for tool versions and evidence limits.
