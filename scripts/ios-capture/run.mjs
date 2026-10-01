import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { PROFILES, SCENES } from "./plan.ts";
import { captureFixture } from "./fixtures.ts";
import { getScorecardCategories } from "../../packages/game-engine/src/presentation.ts";

// Native helpers deliberately run under Bun, the same runtime as qualification.
const { loadBuiltSimulator } = await import("../ios-native/artifact.mjs");
const { nativeInteraction } = await import("../ios-native/interaction.mjs");
const { snapshotEvidence } = await import("../ios-native/snapshot.mjs");
const { rgbCapture } = await import("./image.mjs");
const { showScene } = await import("./scene.mjs");
const { unchangedSave } = await import("./saveGuard.mjs");

assert.equal(process.platform, "darwin", "Draft capture requires macOS, Xcode and owned iOS simulators.");
const args = process.argv.slice(2);
assert(args.length <= 3 && args.every((arg) => /^--(profile|scene|appearance)=[a-z0-9-]+$/.test(arg)), "Unknown capture argument.");
const selections = new Map(args.map((arg) => arg.slice(2).split("=")));
assert.equal(selections.size, args.length, "Duplicate capture selection.");
const profile = PROFILES.find((item) => item.id === selections.get("profile")); assert(profile, "Select one explicit capture profile.");
const sceneId = selections.get("scene") ?? "all", appearance = selections.get("appearance") ?? "scene";
assert(sceneId === "all" || SCENES.some((scene) => scene.id === sceneId), "Unknown capture scene.");
assert(["scene", "light", "dark"].includes(appearance), "Unknown capture appearance.");
const scenes = SCENES.filter((scene) => sceneId === "all" || scene.id === sceneId);
const root = resolve(import.meta.dirname, "../..");
const output = join(root, "reports/capture-drafts"), published = join(root, "reports/capture-drafts-evidence");
assert(!existsSync(output) && !existsSync(published), "Existing capture output was not overwritten.");
assert(["arm64", "x64"].includes(process.arch), "Unsupported simulator architecture.");
mkdirSync(output, { recursive: true });
const env = { ...process.env, DEVELOPER_DIR: "/Applications/Xcode_26.6.app/Contents/Developer", MAESTRO_CLI_NO_ANALYTICS: "true", MAESTRO_DISABLE_UPDATE_CHECK: "true", MAESTRO_CLI_ANALYSIS_NOTIFICATION_DISABLED: "true", MAESTRO_DRIVER_STARTUP_TIMEOUT: "300000" };
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
function run(executable, command, options = {}) {
  const fd = openSync(join(output, options.log ?? "commands.log"), "a");
  let result;
  try { result = spawnSync(executable, command, { cwd: root, env, encoding: "utf8", timeout: options.timeout ?? 180000, maxBuffer: 16 * 1024 * 1024, stdio: ["ignore", options.capture ? "pipe" : fd, fd] }); }
  finally { closeSync(fd); }
  if (result.stdout) appendFileSync(join(output, options.log ?? "commands.log"), result.stdout);
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `Capture command ${executable} failed. Inspect the retained log.`);
  return result.stdout?.trim() ?? "";
}
const sim = (...command) => run("xcrun", ["simctl", ...command], { capture: true, timeout: command[0] === "bootstatus" ? 600000 : 180000 });
assert.equal(run("git", ["status", "--porcelain"], { capture: true }), "", "Capture requires committed, clean source.");
const receipt = { schemaVersion: 1, kind: "unsigned-ios-draft-captures", status: "running", accepted: false,
  source: run("git", ["rev-parse", "HEAD"], { capture: true }), architecture: process.arch === "arm64" ? "arm64" : "x86_64",
  runId: process.env.GITHUB_RUN_ID ?? null, runAttempt: process.env.GITHUB_RUN_ATTEMPT ?? null,
  bunLockSha256: hash(readFileSync(join(root, "bun.lock"))), startedAt: new Date().toISOString(), profile, captures: [],
  locale: "en-US", sceneSelection: sceneId, appearanceSelection: appearance,
  limits: ["Fictional preloaded states, not played-game evidence", "Unsigned simulator app, not signed-binary correspondence", "Draft coverage, not a listing-specific required set", "No owner approval or App Store upload", "Full-size visual review remains required", "No resizing, compositing or marketing overlays"] };
const checkpoint = () => writeFileSync(join(output, "manifest.json"), JSON.stringify(receipt, null, 2) + "\n");
checkpoint();
let owned = null;
try {
  assert.match(run("maestro", ["--version"], { capture: true }), /2\.10\.0/);
  assert.equal(run("xcodebuild", ["-version"], { capture: true }).replace(/\s+/g, " "), "Xcode 26.6 Build version 17F113");
  const { app, bundleId } = loadBuiltSimulator({ root, run, hash, receipt, architecture: receipt.architecture });
  const runtime = "com.apple.CoreSimulator.SimRuntime.iOS-26-5";
  const types = JSON.parse(sim("list", "devicetypes", "--json")).devicetypes;
  const type = types.find((item) => item.name === profile.device); assert(type, "Selected simulator type is unavailable.");
  owned = sim("create", `Dice-Capture-${process.pid}-${profile.id}`, type.identifier, runtime);
  assert.match(owned, /^[A-F0-9-]{36}$/i); receipt.device = { udid: owned, runtime, type: type.identifier };
  sim("boot", owned); sim("bootstatus", owned, "-b");
  sim("spawn", owned, "defaults", "write", "NSGlobalDomain", "AppleLanguages", "-array", "en");
  sim("spawn", owned, "defaults", "write", "NSGlobalDomain", "AppleLocale", "-string", "en_US");
  for (const [index, scene] of scenes.entries()) {
    receipt.phase = scene.id; checkpoint();
    if (index > 0) sim("uninstall", owned, bundleId); // Only this newly created simulator.
    sim("install", owned, app);
    const selectedAppearance = appearance === "scene" ? scene.appearance : appearance;
    const fixture = captureFixture(scene.id, selectedAppearance), bytes = JSON.stringify(fixture);
    const container = sim("get_app_container", owned, bundleId, "data");
    assert(container.includes(`/Devices/${owned}/data/Containers/Data/Application/`), "Capture container is not on the owned simulator.");
    const database = join(container, "Documents/SQLite/hemsoft-local-dice.db");
    assert(!existsSync(database), "Clean capture scene unexpectedly has a database.");
    mkdirSync(join(container, "Documents/SQLite"), { recursive: true });
    const directory = join(output, `${String(scene.order).padStart(2, "0")}-${scene.id}-${selectedAppearance}`); mkdirSync(directory);
    writeFileSync(join(directory, "fixture.json"), bytes + "\n");
    run("sqlite3", [database, `BEGIN IMMEDIATE; CREATE TABLE local_save (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL); INSERT INTO local_save VALUES ('hemsoft-local-dice-v1', CAST(X'${Buffer.from(bytes).toString("hex")}' AS TEXT)); PRAGMA user_version=1; COMMIT;`]);
    sim("ui", owned, "appearance", selectedAppearance); sim("ui", owned, "content_size", "large");
    sim("status_bar", owned, "override", "--time", "9:41", "--batteryState", "charged", "--batteryLevel", "100");
    const source = join(directory, "source.png");
    await unchangedSave({ expected: bytes,
      exercise: () => nativeInteraction({ device: owned, bundleId, directory, prefix: "complete", env,
        capture: (name) => sim("io", owned, "screenshot", join(directory, `${name}.png`)),
        exercise: async (io) => {
          await showScene(scene, getScorecardCategories(scene.dice).map((category) => category.id), io);
          sim("io", owned, "screenshot", source);
        } }),
      readSaved: () => {
        const saved = JSON.parse(run("sqlite3", ["-readonly", "-json", database, "SELECT value FROM local_save WHERE key = 'hemsoft-local-dice-v1'"], { capture: true }));
        assert.equal(saved.length, 1); return saved[0].value;
      },
      record: (saved) => {
        writeFileSync(join(directory, "after-navigation-save.json"), saved);
        writeFileSync(join(directory, "save-integrity.json"), JSON.stringify({ unchanged: saved === bytes, expectedSha256: hash(Buffer.from(bytes)), observedSha256: hash(Buffer.from(saved)) }, null, 2) + "\n");
      } });
    const exported = rgbCapture(readFileSync(source), profile);
    const filename = `${String(scene.order).padStart(2, "0")}-${scene.id}-${selectedAppearance}.png`;
    writeFileSync(join(output, filename), exported.bytes);
    const imageRecord = { ...exported }; delete imageRecord.bytes;
    receipt.captures.push({ scene: scene.id, order: scene.order, appearance: selectedAppearance, filename, sourceFilename: `${directory.split("/").at(-1)}/source.png`, fixtureSha256: hash(Buffer.from(bytes)), ...imageRecord });
    checkpoint();
  }
  receipt.status = "passed";
} catch (error) {
  receipt.status = "failed"; receipt.error = error instanceof Error ? error.message : "Capture failed.";
  throw error;
} finally {
  if (owned) {
    try { sim("shutdown", owned); } catch { /* Delete only the newly allocated device. */ }
    try { sim("delete", owned); receipt.ownedSimulatorRemoved = true; }
    catch { receipt.ownedSimulatorRemoved = false; receipt.status = "failed"; receipt.cleanupError = "Owned capture simulator deletion was not confirmed."; }
  }
  receipt.completedAt = new Date().toISOString(); checkpoint();
  snapshotEvidence(output, published, receipt);
}
assert.equal(receipt.ownedSimulatorRemoved, true, "Owned capture simulator cleanup failed.");
