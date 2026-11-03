import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { sha256, readSource, copyBlockers, screenshotBlockers, artifactImageReader } from "./evidence.mjs";

export function draftErrors(record) {
  if (!record || typeof record !== "object" || Array.isArray(record)) return ["Record must be an object"];
  const errors = [];
  if (record.schemaVersion !== 1) errors.push("Unsupported record schema");
  if (!/^\d+\.\d+\.\d+$/.test(record.version ?? "")) errors.push("Invalid marketing version");
  if (typeof record.buildNumber !== "string" || !/^[1-9]\d*$/.test(record.buildNumber)) errors.push("Build number must be a positive integer string");
  if (record.tag !== `ios/v${record.version}`) errors.push("Tag does not match the iOS version");
  if (record.versionNotes !== `release/notes/${record.version}.md`) errors.push("Version notes path does not match the marketing version");
  if (record.appStoreVersion !== record.version) errors.push("App Store version mismatch");
  if (!["draft", "candidate"].includes(record.status)) errors.push("Unknown candidate status");
  return errors;
}

export function releaseBlockers(record, context) {
  const blockers = [...draftErrors(record)];
  if (blockers.length) return blockers;
  if (record.status !== "candidate") blockers.push("Candidate is still a draft");
  if (!/^[a-f0-9]{40}$/.test(record.sourceCommit ?? "") || record.sourceCommit !== context.commit) blockers.push("Source commit does not match HEAD");
  if (context.dirty) blockers.push("Tracked or untracked source changes remain");
  if (record.version !== context.expo.version) blockers.push("Native marketing version mismatch");
  if (record.buildNumber !== context.expo.ios?.buildNumber) blockers.push("Native build number mismatch");
  if (!record.bundleIdentifier || record.bundleIdentifier !== context.expo.ios?.bundleIdentifier) blockers.push("Approved bundle identifier missing or mismatched");
  if (!/^[1-9]\d*$/.test(record.appStoreId ?? "")) blockers.push("App Store app ID missing");
  if (!/^[a-f0-9]{64}$/.test(record.archiveSha256 ?? "") || record.archiveSha256 !== context.archiveSha256) blockers.push("Archive checksum missing or mismatched");
  for (const key of ["testFlightBuildId", "ownerApprovalEvidence", "nativeQualificationEvidence"]) {
    if (typeof record[key] !== "string" || !record[key].trim()) blockers.push(`${key} missing`);
  }
  return blockers;
}

function sourceFiles(record, mobile, committedBytes) {
  const metadata = record.metadataDirectory;
  const sources = { versionNotes: record.versionNotes, changelog: record.changelog, testNotes: record.testNotes, screenshots: record.screenshots,
    listing: `${metadata}/listing.json`, description: `${metadata}/description.txt`,
    reviewNotes: `${metadata}/review_notes.txt`, releaseNotes: `${metadata}/release_notes.txt` };
  return Object.entries(sources).map(([role, path]) => ({ ...readSource(mobile, path, committedBytes), role }));
}

export function listingRecord(files) {
  return JSON.parse(files.find((file) => file.role === "listing").text);
}

function run() {
  const mobile = resolve(dirname(fileURLToPath(import.meta.url)), "../../apps/mobile");
  const args = process.argv.slice(2);
  const release = args.includes("--release");
  const option = (key) => args.includes(key) ? args[args.indexOf(key) + 1] : undefined;
  const record = JSON.parse(readFileSync(resolve(option("--record") ?? resolve(mobile, "release/candidate.json")), "utf8"));
  const errors = draftErrors(record);
  if (errors.length) throw new Error(errors.join("; "));
  const root = resolve(mobile, "../..");
  const git = (...parts) => execFileSync("git", parts, { cwd: root, encoding: "utf8" }).trim();
  const committedBytes = (path) => execFileSync("git", ["show", `HEAD:${path}`], { cwd: root });
  const files = sourceFiles(record, mobile, release ? committedBytes : undefined);
  const archive = option("--archive");
  const context = {
    commit: git("rev-parse", "HEAD"), dirty: Boolean(git("status", "--porcelain")),
    expo: JSON.parse(readFileSync(resolve(mobile, "app.json"), "utf8")).expo,
    archiveSha256: archive ? sha256(readFileSync(resolve(archive))) : null,
  };
  const blockers = releaseBlockers(record, context);
  const listing = listingRecord(files);
  blockers.push(...copyBlockers(files, listing));
  const screenshotPath = option("--screenshots");
  if (screenshotPath) {
    const bytes = readFileSync(resolve(screenshotPath));
    if (sha256(bytes) !== record.screenshotManifestSha256) blockers.push("Screenshot manifest checksum mismatch");
    blockers.push(...screenshotBlockers(JSON.parse(bytes.toString("utf8")), record, artifactImageReader(dirname(resolve(screenshotPath)))));
  } else blockers.push("Accepted screenshot artifact manifest missing");
  console.log(JSON.stringify({ mode: release ? "release" : "draft", version: record.version, build: record.buildNumber, consistent: blockers.length === 0, blockers, note: "Consistency only. This command does not validate signing, grant approval, upload, submit or publish." }, null, 2));
  if (release && blockers.length) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) run();
