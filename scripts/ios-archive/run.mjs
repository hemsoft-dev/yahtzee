import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, closeSync, copyFileSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { inspectNativePrivacy } from "../ios-native/privacy.mjs";
import { archiveArguments, validateArchiveInfo } from "./contract.mjs";
import { snapshotEvidence } from "../ios-native/snapshot.mjs";

assert.equal(process.platform, "darwin", "Device archives require macOS and Xcode.");
assert.equal(process.argv.length, 2, "No signing, export or other arguments are supported.");
const root = resolve(import.meta.dirname, "../..");
const appRoot = join(root, "apps/mobile");
const output = join(root, "reports/device-archive");
const work = join(root, "reports/device-archive-work");
const published = join(root, "reports/device-archive-evidence");
const ios = join(appRoot, "ios");
assert(!existsSync(output) && !existsSync(work) && !existsSync(published) && !existsSync(ios), "Use a fresh checkout; existing native projects and evidence are never removed.");
mkdirSync(output, { recursive: true }); mkdirSync(work);
const env = { ...process.env, DEVELOPER_DIR: "/Applications/Xcode_26.6.app/Contents/Developer", EXPO_NO_TELEMETRY: "1", CI: "1" };
const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
const json = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + "\n");
function run(executable, args, { cwd = root, timeout = 180000, log = "commands.log", capture = false } = {}) {
  console.log(`$ ${executable} ${args.join(" ")}`);
  const fd = openSync(join(output, log), "a");
  let result;
  try { result = spawnSync(executable, args, { cwd, env, encoding: "utf8", timeout, killSignal: "SIGKILL", maxBuffer: 16 * 1024 * 1024, stdio: ["ignore", capture ? "pipe" : fd, fd] }); }
  finally { closeSync(fd); }
  if (capture && result.stdout) appendFileSync(join(output, log), result.stdout);
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `${executable} failed; see ${log}.`);
  return result.stdout?.trim();
}
const receipt = { kind: "unsigned-ios-device-archive", schemaVersion: 1, status: "running", startedAt: new Date().toISOString(),
  runId: process.env.GITHUB_RUN_ID ?? null, runAttempt: process.env.GITHUB_RUN_ATTEMPT ?? null,
  runnerImage: process.env.ImageVersion ?? null, signing: "disabled", installable: false,
  limits: ["Not a signed distribution archive or IPA", "Not hardware, TestFlight, storefront or submission acceptance", "No certificate, provisioning or upload access is used"] };
try {
  assert.equal(run("git", ["status", "--porcelain"], { capture: true }), "", "Archive source must be clean.");
  receipt.source = run("git", ["rev-parse", "HEAD"], { capture: true });
  receipt.toolchain = Object.fromEntries([
    ["xcode", "xcodebuild", ["-version"], "Xcode 26.6\nBuild version 17F113"],
    ["sdk", "xcrun", ["--sdk", "iphoneos", "--show-sdk-version"], "26.5"],
    ["node", "node", ["--version"], "v24.12.0"], ["bun", "bun", ["--version"], "1.4.2"],
    ["cocoapods", "pod", ["--version"], "1.17.0"],
  ].map(([name, executable, args, expected]) => {
    const actual = run(executable, args, { capture: true }); assert.equal(actual, expected, `Unexpected ${name}.`); return [name, actual];
  }));
  receipt.bunLockSha256 = sha256(join(root, "bun.lock"));
  const config = JSON.parse(readFileSync(join(appRoot, "app.json"), "utf8")).expo;
  run("node", ["node_modules/expo/bin/cli", "prebuild", "--platform", "ios", "--no-install"], { cwd: appRoot, timeout: 600000, log: "prebuild.log" });
  const sourceLock = join(appRoot, "native/Podfile.lock");
  copyFileSync(sourceLock, join(ios, "Podfile.lock"));
  run("pod", ["install", "--deployment"], { cwd: ios, timeout: 1200000, log: "pods.log" });
  assert(readFileSync(sourceLock).equals(readFileSync(join(ios, "Podfile.lock"))), "Native lock drifted.");
  copyFileSync(sourceLock, join(output, "Podfile.lock"));
  copyFileSync(join(root, "bun.lock"), join(output, "bun.lock"));
  copyFileSync(join(appRoot, "app.json"), join(output, "app.json"));
  const workspaces = readdirSync(ios).filter((name) => name.endsWith(".xcworkspace")); assert.equal(workspaces.length, 1);
  const scheme = workspaces[0].slice(0, -".xcworkspace".length);
  const entitlementFiles = readdirSync(join(ios, scheme)).filter((name) => name.endsWith(".entitlements"));
  receipt.generatedEntitlements = entitlementFiles.map((name) => {
    const fields = JSON.parse(run("/usr/bin/plutil", ["-convert", "json", "-o", "-", join(ios, scheme, name)], { capture: true }));
    assert.deepEqual(fields, {}, "Review new entitlements before archive preparation.");
    return { file: name, fields };
  });
  env.SOURCEMAP_FILE = join(output, "main.jsbundle.map");
  const archive = join(work, "ThirdRoll.xcarchive");
  run("xcodebuild", archiveArguments({ workspace: join(ios, workspaces[0]), scheme, archive, derivedData: join(work, "derived") }), { timeout: 2400000, log: "archive.log" });
  const products = join(archive, "Products/Applications");
  const apps = readdirSync(products).filter((name) => name.endsWith(".app")); assert.equal(apps.length, 1);
  const app = join(products, apps[0]);
  const info = JSON.parse(run("/usr/bin/plutil", ["-convert", "json", "-o", "-", join(app, "Info.plist")], { capture: true }));
  validateArchiveInfo(info, config); json(join(output, "built-info.json"), info);
  assert(existsSync(join(app, "main.jsbundle")), "Release archive must embed JavaScript.");
  assert(existsSync(join(app, "Assets.car")), "Compiled icon assets are missing.");
  assert(!existsSync(join(app, "_CodeSignature")), "This job must not sign the archive.");
  const sourceMap = JSON.parse(readFileSync(env.SOURCEMAP_FILE, "utf8"));
  assert.equal(sourceMap.version, 3); assert(sourceMap.sources.length > 0, "Release source map is empty.");
  receipt.app = { bundleId: info.CFBundleIdentifier, version: info.CFBundleShortVersionString, build: info.CFBundleVersion,
    minimumOS: info.MinimumOSVersion, jsBundleSha256: sha256(join(app, "main.jsbundle")), assetsSha256: sha256(join(app, "Assets.car")) };
  receipt.privacy = inspectNativePrivacy(app, appRoot, output); assert.deepEqual(receipt.privacy.errors, []);
  assert.notEqual(receipt.privacy.expoUpdates.EXUpdatesEnabled, true, "Offline archive must not enable Expo Updates.");
  assert(!receipt.privacy.expoUpdates.EXUpdatesURL, "Unexpected update endpoint in offline archive.");
  run("xcrun", ["dwarfdump", "--uuid", join(app, info.CFBundleExecutable)], { log: "binary-uuids.log" });
  const symbols = join(archive, "dSYMs");
  assert(existsSync(symbols) && readdirSync(symbols).some((name) => name.endsWith(".dSYM")), "Release symbols are missing.");
  run("tar", ["-czf", join(output, "ThirdRoll-unsigned.xcarchive.tar.gz"), "-C", work, "ThirdRoll.xcarchive"], { timeout: 180000, log: "package.log" });
  assert.equal(run("git", ["status", "--porcelain"], { capture: true }), "", "Native generation changed source.");
  assert.equal(run("git", ["rev-parse", "HEAD"], { capture: true }), receipt.source);
  receipt.status = "passed";
} catch (error) {
  receipt.status = "failed"; receipt.error = error instanceof Error ? error.message : String(error);
  process.exitCode = 1; console.error(receipt.error);
} finally {
  receipt.finishedAt = new Date().toISOString();
  json(join(output, "manifest.json"), receipt);
  snapshotEvidence(output, published, receipt);
}
