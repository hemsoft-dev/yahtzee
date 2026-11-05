import { readFileSync, realpathSync } from "node:fs";
import { isAbsolute, resolve, relative, sep } from "node:path";
import { createHash } from "node:crypto";
import { metadataBlockers } from "./metadata.mjs";
import { readCapturePng } from "./png.mjs";

export const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

export function relativeSource(path) {
  if (typeof path !== "string" || isAbsolute(path) || !/^[A-Za-z0-9][A-Za-z0-9_./-]*$/.test(path) || path.split("/").includes("..")) throw new Error("Source paths must be repository-relative");
  return path;
}

export function readSource(mobile, path, committedBytes) {
  relativeSource(path);
  const bytes = readFileSync(resolve(mobile, path));
  // git show fails for ignored/untracked files, and bytes must match that commit.
  const text = bytes.toString("utf8").replaceAll("\r\n", "\n");
  if (committedBytes && text !== committedBytes(`apps/mobile/${path}`).toString("utf8").replaceAll("\r\n", "\n")) throw new Error(`Source differs from committed text: ${path}`);
  if (!text.trim()) throw new Error(`Empty release source: ${path}`);
  return { path, text };
}

export function copyBlockers(files, listing) {
  const blockers = [];
  for (const file of files) {
    if (/DRAFT, NOT APPROVED|\bDraft only\b|\bNOT APPROVED FOR (?:UPLOAD|SUBMISSION)\b|Do not publish this placeholder|pending implementation|After native qualification, describe|replacing this draft with tester-facing copy/i.test(file.text)) blockers.push(`Unapproved copy: ${file.path}`);
  }
  if (listing.status !== "approved") blockers.push("Listing status is not approved");
  for (const role of ["description", "reviewNotes", "releaseNotes", "testNotes"]) {
    const source = files.find((file) => file.role === role);
    const review = listing.sourceReviews?.[role];
    if (!source || review?.status !== "approved" || review.sha256 !== sha256(Buffer.from(source.text.replaceAll("\r\n", "\n")))) blockers.push(`Source review missing or stale: ${role}`);
  }
  blockers.push(...metadataBlockers({ ...listing, description: files.find((file) => file.role === "description")?.text }));
  for (const key of ["primaryCategory", "copyright", "supportUrl", "marketingUrl", "privacyUrl"]) {
    if (typeof listing[key] !== "string" || !listing[key].trim()) blockers.push(`Listing field missing: ${key}`);
  }
  return blockers;
}

export function captureBlockers(capture, record, readImage) {
  const blockers = [];
  if (!capture || typeof capture !== "object") return ["Invalid screenshot capture"];
  if (capture.sourceCommit !== record.sourceCommit) blockers.push("Capture source commit mismatch");
  if (!["iphone", "ipad"].includes(capture.deviceFamily)) blockers.push("Capture device family missing");
  if (!/^[a-z]{2}(?:-[A-Z]{2})?$/.test(capture.locale ?? "")) blockers.push("Capture locale missing");
  if (!["light", "dark"].includes(capture.appearance)) blockers.push("Capture appearance missing");
  if (!Number.isSafeInteger(capture.width) || !Number.isSafeInteger(capture.height) || capture.width <= 0 || capture.height <= 0) blockers.push("Capture dimensions invalid");
  try {
    const bytes = readImage(relativeSource(capture.filename));
    const { image } = readCapturePng(bytes);
    if (image.alpha) blockers.push("Capture PNG has an alpha channel or transparency");
    if (image.width !== capture.width || image.height !== capture.height) blockers.push("Capture dimensions do not match PNG");
    if (sha256(bytes) !== capture.sha256) blockers.push("Capture checksum mismatch");
  } catch { blockers.push("Capture file missing, invalid PNG, or outside artifact directory"); }
  return blockers;
}

export function screenshotBlockers(manifest, record, readImage) {
  if (!manifest || manifest.status !== "accepted") return ["Screenshot manifest is not accepted"];
  const blockers = [];
  if (manifest.sourceCommit !== record.sourceCommit || manifest.version !== record.version || manifest.buildNumber !== record.buildNumber) blockers.push("Screenshot provenance mismatch");
  if (!Array.isArray(manifest.captures) || manifest.captures.length === 0) return [...blockers, "No native screenshot captures recorded"];
  for (const capture of manifest.captures) blockers.push(...captureBlockers(capture, record, readImage));
  return blockers;
}

export function artifactImageReader(directory) {
  const root = realpathSync(directory);
  return (filename) => {
    const file = realpathSync(resolve(root, relativeSource(filename)));
    const inside = relative(root, file);
    if (inside.startsWith(`..${sep}`) || isAbsolute(inside)) throw new Error("Capture escapes artifact directory");
    return readFileSync(file);
  };
}
