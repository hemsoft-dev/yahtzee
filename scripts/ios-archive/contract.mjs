import assert from "node:assert/strict";

export function archiveArguments({ workspace, scheme, archive, derivedData }) {
  return ["-workspace", workspace, "-scheme", scheme, "-configuration", "Release",
    "-sdk", "iphoneos", "-destination", "generic/platform=iOS", "-archivePath", archive,
    "-derivedDataPath", derivedData, "CODE_SIGNING_ALLOWED=NO", "archive"];
}

export function validateArchiveInfo(info, config) {
  assert.equal(info.CFBundleIdentifier, config.ios.bundleIdentifier);
  assert.equal(info.CFBundleDisplayName, config.name);
  assert.equal(info.CFBundleShortVersionString, config.version);
  assert.equal(info.CFBundleVersion, config.ios.buildNumber);
  assert.equal(info.MinimumOSVersion, "17.0");
  assert.equal(info.DTPlatformName, "iphoneos", "A simulator build is not a device archive.");
  assert.match(info.DTSDKName, /^iphoneos26\./);
  assert.deepEqual([...info.UIDeviceFamily].sort(), [1, 2]);
  assert.equal(info.CFBundleIcons?.CFBundlePrimaryIcon?.CFBundleIconName, "AppIcon");
  assert.equal(info["CFBundleIcons~ipad"]?.CFBundlePrimaryIcon?.CFBundleIconName, "AppIcon");
  for (const key of ["UISupportedInterfaceOrientations", "UISupportedInterfaceOrientations~ipad"]) {
    assert(info[key]?.includes("UIInterfaceOrientationPortrait"));
    assert(info[key]?.includes("UIInterfaceOrientationLandscapeLeft"));
    assert(info[key]?.includes("UIInterfaceOrientationLandscapeRight"));
  }
}
