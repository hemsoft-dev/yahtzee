import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

const folder = fileURLToPath(new URL("../../apps/mobile/assets/", import.meta.url));
const source = readFileSync(join(folder, "icon-source.svg"), "utf8").replace(/\r\n/g, "\n");
const renderer = execFileSync("magick", ["-version"], { encoding: "utf8" }).split(/\r?\n/)[0];
const variants = [
  { file: "icon.png", role: "ios-light-and-app-store", colors: {} },
  { file: "icon-dark.png", role: "ios-dark", colors: { "#1e453a": "#10251e", "#f5f4e9": "#cee2af" } },
  { file: "icon-tinted.png", role: "ios-tinted", colors: { "#1e453a": "#0b0b0b", "#f5f4e9": "#e8e8e8", "#244033": "#161616", "#92431f": "#606060" } },
  { file: "launch-mark.png", role: "launch-and-android-foreground", colors: {}, transparent: true },
];
const temporary = mkdtempSync(join(tmpdir(), "dice-assets-"));
try {
  for (const variant of variants) {
    let svg = source.replace(/#[0-9a-f]{6}/g, (color) => variant.colors[color] ?? color);
    if (variant.transparent) svg = svg.replace(/ {2}<rect id="background"[^\n]+\n/, "");
    const input = join(temporary, "mark.svg"); writeFileSync(input, svg);
    execFileSync("magick", ["-background", "none", "-density", "192", input, "-resize", "1024x1024", "-colorspace", "sRGB", "-strip",
      `${variant.transparent ? "PNG32" : "PNG24"}:${join(folder, variant.file)}`], { stdio: "inherit" });
  }
  const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
  writeFileSync(join(folder, "provenance.json"), JSON.stringify({
    schemaVersion: 1, origin: "Repository-authored SVG geometry, adapted from the game's pip controls",
    source: "icon-source.svg", sourceSha256: hash(source), sourceNormalization: "LF",
    renderer, generator: "scripts/ios-assets/generate.mjs", publicIdentityApproved: true,
    externalArtwork: [], fonts: [], sound: [],
    exports: variants.map(({ file, role, transparent }) => ({ file, role, width: 1024, height: 1024, transparencyAllowed: !!transparent, sha256: hash(readFileSync(join(folder, file))) })),
  }, null, 2) + "\n");
} finally { rmSync(temporary, { recursive: true, force: true }); }
