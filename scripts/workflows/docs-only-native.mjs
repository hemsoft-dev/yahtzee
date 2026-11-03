import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// Content used only by the standalone marketing site. Build/test tooling stays
// outside this list, as do machine-readable docs that tooling may consume.
const marketing = new Set([
  "site/pages.mjs", "site/style.css", "site/README.md",
  "site/assets/iphone-setup.png", "site/assets/iphone-help.png",
]);

function safePath(path) {
  if (path.includes("\\") || path.split("/").some((part) => !part || part === "." || part === "..")) return false;
  return path === "README.md" || /^docs\/(?:[\w-]+\/)*[\w.-]+\.md$/.test(path) || marketing.has(path);
}

export function nativeRequired(eventName, event, git = (args) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 })) {
  if (eventName !== "pull_request") return true;
  try {
    const pr = event.pull_request;
    if (!Number.isSafeInteger(pr?.changed_files) || pr.changed_files <= 0) return true;
    const base = pr.base?.sha;
    const head = pr.head?.sha;
    if (![base, head].every((sha) => /^[a-f0-9]{40}$/.test(sha))) return true;
    // Three-dot diff matches the PR, not unrelated changes added to its base.
    const raw = git(["diff", "--name-status", "-z", "--find-renames", `${base}...${head}`, "--"]);
    if (!raw.endsWith("\0")) return true;
    const fields = raw.slice(0, -1).split("\0");
    if (fields.length !== pr.changed_files * 2) return true;
    const paths = new Set();
    for (let i = 0; i < fields.length; i += 2) {
      if (!["A", "M"].includes(fields[i]) || !safePath(fields[i + 1]) || paths.has(fields[i + 1])) return true;
      paths.add(fields[i + 1]);
    }
    return false;
  } catch {
    return true;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  let required = true;
  try {
    required = nativeRequired(process.env.GITHUB_EVENT_NAME, JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8")));
  } catch {
    // A missing/malformed event must never authorize a native skip.
  }
  appendFileSync(process.env.GITHUB_OUTPUT, `native-required=${required}\n`);
  console.log(required ? "Full native qualification required." : "Only allowlisted documentation/marketing content changed; native qualification skipped.");
}
