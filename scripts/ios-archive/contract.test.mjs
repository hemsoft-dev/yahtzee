import assert from "node:assert/strict";
import test from "node:test";
import { archiveArguments, validateArchiveInfo, validateUpdates, validateIconInventory } from "./contract.mjs";

const config = { name: "Third Roll", version: "1.0.0", ios: { bundleIdentifier: "com.hemsoft.thirdroll", buildNumber: "1" } };
const orientations = ["UIInterfaceOrientationPortrait", "UIInterfaceOrientationLandscapeLeft", "UIInterfaceOrientationLandscapeRight"];
const icon = { CFBundlePrimaryIcon: { CFBundleIconName: "AppIcon" } };
const valid = { CFBundleIdentifier: config.ios.bundleIdentifier, CFBundleDisplayName: config.name,
  CFBundleShortVersionString: "1.0.0", CFBundleVersion: "1", MinimumOSVersion: "17.0",
  DTPlatformName: "iphoneos", DTSDKName: "iphoneos26.5", UIDeviceFamily: [1, 2],
  CFBundleIcons: icon, "CFBundleIcons~ipad": icon, UISupportedInterfaceOrientations: orientations,
  "UISupportedInterfaceOrientations~ipad": orientations };

test("device inspection rejects simulator, stale identity, missing family, icons and orientations", () => {
  validateArchiveInfo(valid, config);
  for (const [key, value] of Object.entries({ DTPlatformName: "iphonesimulator", DTSDKName: "iphoneos18.0",
    CFBundleIdentifier: "com.example.stale", CFBundleDisplayName: "Old name", CFBundleVersion: "2",
    CFBundleShortVersionString: "0.1.0", MinimumOSVersion: "16.0", UIDeviceFamily: [1],
    CFBundleIcons: {}, "CFBundleIcons~ipad": {}, UISupportedInterfaceOrientations: [],
    "UISupportedInterfaceOrientations~ipad": [] })) {
    assert.throws(() => validateArchiveInfo({ ...valid, [key]: value }, config), key);
  }
  assert.throws(() => validateArchiveInfo({ ...valid, DTSDKName: "iphoneos26.4" }, config));
});

test("archive command builds Release for devices and never requests signing or upload", () => {
  const args = archiveArguments({ workspace: "/a path/App.xcworkspace", scheme: "App", archive: "/out/App.xcarchive", derivedData: "/out/derived" });
  assert.equal(args[args.indexOf("-workspace") + 1], "/a path/App.xcworkspace");
  assert.equal(args[args.indexOf("-configuration") + 1], "Release");
  assert.equal(args[args.indexOf("-sdk") + 1], "iphoneos");
  assert.equal(args[args.indexOf("-destination") + 1], "generic/platform=iOS");
  assert(args.includes("CODE_SIGNING_ALLOWED=NO"));
  assert(args.includes("CODE_SIGNING_REQUIRED=NO"));
  assert(args.includes("CODE_SIGN_IDENTITY="));
  assert.equal(args.at(-1), "archive");
  assert(!args.some((arg) => /exportArchive|allowProvisioning|DEVELOPMENT_TEAM/.test(arg)));
});

test("missing, malformed and enabled update declarations fail closed", () => {
  validateUpdates({ EXUpdatesEnabled: false });
  for (const value of [undefined, null, true, "false", 0]) assert.throws(() => validateUpdates({ EXUpdatesEnabled: value }));
  assert.throws(() => validateUpdates({ EXUpdatesEnabled: false, EXUpdatesURL: "https://updates.example.test" }));
});

test("compiled icon inspection rejects absent, empty and undersized icon catalogs", () => {
  const master = { Name: "AppIcon", AssetType: "Icon Image", PixelWidth: 1024, PixelHeight: 1024, SizeOnDisk: 20000 };
  validateIconInventory([{ KeyFormat: 12 }, master]);
  for (const inventory of [[], [{ ...master, Name: "Other" }], [{ ...master, SizeOnDisk: 0 }],
    [{ ...master, PixelWidth: 0 }], [{ ...master, PixelWidth: 120, PixelHeight: 120 }]]) {
    assert.throws(() => validateIconInventory(inventory));
  }
});
