import assert from "node:assert/strict";
import { copyFileSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { inspectNativePrivacy } from "./privacy.mjs";
import { installNativeCancellation } from "./nativeCancelBuild.mjs";

export function buildSimulator({ root, output, run, hash, receipt, architecture, refreshPodLock }) {
  const appRoot = join(root, "apps/mobile");
  assert(!existsSync(join(appRoot, "ios")), "Use a fresh checkout. Existing native project files were not removed.");
  run("node", ["node_modules/expo/bin/cli", "prebuild", "--platform", "ios", "--no-install"], { cwd: appRoot, log: "prebuild.log" });
  const ios = join(appRoot, "ios"); const sourceLock = join(appRoot, "native/Podfile.lock");
  receipt.bootstrapPodLock = !existsSync(sourceLock);
  receipt.podInstallMode = refreshPodLock ? "refresh-only" : receipt.bootstrapPodLock ? "bootstrap" : "deployment";
  if (!receipt.bootstrapPodLock) copyFileSync(sourceLock, join(ios, "Podfile.lock"));
  run("pod", ["install", ...(receipt.bootstrapPodLock || refreshPodLock ? [] : ["--deployment"])], { cwd: ios, log: "pods.log" });
  copyFileSync(join(ios, "Podfile.lock"), join(output, "Podfile.lock"));
  receipt.podLockNeedsReview = receipt.bootstrapPodLock || !readFileSync(sourceLock).equals(readFileSync(join(ios, "Podfile.lock")));
  copyFileSync(join(ios, "Podfile.properties.json"), join(output, "Podfile.properties.json"));
  assert(!refreshPodLock && !receipt.podLockNeedsReview, "Dependency-only run: review reports/native/Podfile.lock, commit changes to apps/mobile/native, then run normal qualification.");
  receipt.nativeCancellation = installNativeCancellation({ root, ios, output, run });
  const workspaces = readdirSync(ios).filter((name) => name.endsWith(".xcworkspace")); assert.equal(workspaces.length, 1);
  const scheme = workspaces[0].slice(0, -".xcworkspace".length);
  const derived = join(tmpdir(), `dice-derived-${process.pid}`);
  run("xcodebuild", ["-workspace", join(ios, workspaces[0]), "-scheme", scheme, "-configuration", "Release", "-sdk", "iphonesimulator",
    "-destination", "generic/platform=iOS Simulator", "-derivedDataPath", derived, `ARCHS=${architecture}`, "ONLY_ACTIVE_ARCH=YES", "CODE_SIGNING_ALLOWED=NO", "build"], { log: "build.log", timeout: 2400000 });
  const products = join(derived, "Build/Products/Release-iphonesimulator");
  const apps = readdirSync(products).filter((name) => name.endsWith(".app")); assert.equal(apps.length, 1);
  const app = join(products, apps[0]); const info = join(app, "Info.plist");
  const config = JSON.parse(readFileSync(join(appRoot, "app.json"), "utf8")).expo;
  const plist = (key) => run("/usr/libexec/PlistBuddy", ["-c", `Print :${key}`, info], { capture: true });
  const bundleId = plist("CFBundleIdentifier"); assert.equal(bundleId, config.ios.bundleIdentifier);
  assert.equal(plist("CFBundleShortVersionString"), config.version); assert.equal(plist("CFBundleVersion"), config.ios.buildNumber);
  assert.equal(plist("MinimumOSVersion"), "17.0"); assert(existsSync(join(app, "main.jsbundle")), "Release app must contain its own JS bundle.");
  receipt.app = { directory: apps[0], bundleId, version: config.version, build: config.ios.buildNumber, minimumOS: "17.0", jsBundleSha256: hash(readFileSync(join(app, "main.jsbundle"))) };
  run("tar", ["-czf", join(output, "unsigned-simulator.app.tar.gz"), "-C", products, apps[0]], { log: "package.log" });
  copyFileSync(info, join(output, "built-Info.plist"));
  receipt.privacy = inspectNativePrivacy(app, appRoot, output);
  assert.deepEqual(receipt.privacy.errors, [], "Native SDK privacy resources or aggregate declarations are incomplete.");
  assert.equal(run("git", ["status", "--porcelain"], { capture: true }), "", "Prebuild changed tracked source. Review it before qualification.");
  return { app, bundleId };
}
