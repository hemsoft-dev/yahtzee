import assert from "node:assert/strict";

export function archiveArguments({ workspace, scheme, archive, derivedData }) {
  return ["-workspace", workspace, "-scheme", scheme, "-configuration", "Release",
    "-sdk", "iphoneos", "-destination", "generic/platform=iOS", "-archivePath", archive,
    "-derivedDataPath", derivedData, "CODE_SIGNING_ALLOWED=NO", "CODE_SIGNING_REQUIRED=NO", "CODE_SIGN_IDENTITY=", "archive"];
}

export function validateArchiveInfo(info, config) {
  assert.equal(info.CFBundleIdentifier, config.ios.bundleIdentifier);
  assert.equal(info.CFBundleDisplayName, config.name);
  assert.equal(info.CFBundleShortVersionString, config.version);
  assert.equal(info.CFBundleVersion, config.ios.buildNumber);
  assert.equal(info.MinimumOSVersion, "17.0");
  assert.equal(info.DTPlatformName, "iphoneos", "A simulator build is not a device archive.");
  assert.equal(info.DTSDKName, "iphoneos26.5");
  assert.deepEqual([...info.UIDeviceFamily].sort(), [1, 2]);
  assert.equal(info.CFBundleIcons?.CFBundlePrimaryIcon?.CFBundleIconName, "AppIcon");
  assert.equal(info["CFBundleIcons~ipad"]?.CFBundlePrimaryIcon?.CFBundleIconName, "AppIcon");
  for (const key of ["UISupportedInterfaceOrientations", "UISupportedInterfaceOrientations~ipad"]) {
    assert(info[key]?.includes("UIInterfaceOrientationPortrait"));
    assert(info[key]?.includes("UIInterfaceOrientationLandscapeLeft"));
    assert(info[key]?.includes("UIInterfaceOrientationLandscapeRight"));
  }
}

export function validateUpdates(updates) {
  assert.equal(updates.EXUpdatesEnabled, false, "Offline archive must explicitly disable Expo Updates.");
  assert(!updates.EXUpdatesURL, "Unexpected update endpoint in offline archive.");
}

export function validateIconInventory(inventory) {
  assert(Array.isArray(inventory));
  const icons = inventory.filter((entry) => entry.Name === "AppIcon" && entry.AssetType === "Icon Image");
  assert(icons.length > 0, "Compiled AppIcon image renditions are missing.");
  assert(icons.every((entry) => entry.PixelWidth > 0 && entry.PixelHeight > 0 && entry.SizeOnDisk > 0), "Compiled AppIcon has an empty rendition.");
  assert(icons.some((entry) => entry.PixelWidth === 1024 && entry.PixelHeight === 1024), "Compiled AppIcon master is missing.");
}
