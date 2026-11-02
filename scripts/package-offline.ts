import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const root = resolve(import.meta.dirname, "..");
const desktop = resolve(root, "apps/desktop");
function run(command: string, args: string[], cwd = root) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit", env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: "false" } });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed with exit ${result.status}`);
}
run("bun", ["run", "build:offline"], desktop);
const source = JSON.parse(readFileSync(resolve(desktop, "package.json"), "utf8"));
const stage = resolve(desktop, "out/offline");
mkdirSync(resolve(stage, "licenses"), { recursive: true });
cpSync(resolve(root, "LICENSE"), resolve(stage, "licenses/LICENSE.txt"));
cpSync(resolve(root, "packages/ui/src/assets/OFL.txt"), resolve(stage, "licenses/Manrope-OFL.txt"));
writeFileSync(resolve(stage, "package.json"), JSON.stringify({
  name: "third-roll-offline", productName: "Third Roll Offline", version: source.version,
  description: "Offline Third Roll with local scores and AI opponents", author: "HemSoft", license: "MIT", main: "main/index.cjs",
}, null, 2));
run("bun", ["run", "electron-builder", "--config", "electron-builder.offline.json", "--win", "portable", "--x64", "--publish", "never"], desktop);
const artifact = `Third-Roll-Offline-${source.version}-win-x64`;
const release = resolve(desktop, "release");
const desktopRequire = createRequire(resolve(desktop, "package.json"));
const builderRequire = createRequire(desktopRequire.resolve("electron-builder"));
const libraryRequire = createRequire(builderRequire.resolve("app-builder-lib"));
const asar = libraryRequire("@electron/asar") as { listPackage(path: string): string[] };
const archived = asar.listPackage(resolve(release, "win-unpacked/resources/app.asar"));
for (const file of archived) {
  const top = file.replace(/^[\\/]+/, "").split(/[\\/]/)[0];
  if (!["main", "renderer", "licenses", "package.json"].includes(top)) throw new Error(`Unexpected packaged file: ${file}`);
}
console.log(`Verified isolated archive: ${archived.length} entries; no dependencies, environment files, or user data.`);
cpSync(resolve(root, "docs/offline-player.txt"), resolve(release, "Read me.txt"));
cpSync(resolve(root, "LICENSE"), resolve(release, "LICENSE.txt"));
// Archive only the executable and player notes, never the build tree or a profile.
const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
const files = [`${artifact}.exe`, "Read me.txt", "LICENSE.txt"].map((name) => quote(resolve(release, name))).join(",");
run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
  `Compress-Archive -LiteralPath ${files} -DestinationPath ${quote(resolve(release, `${artifact}.zip`))} -Force`]);
console.log(`Portable archive: ${resolve(release, `${artifact}.zip`)}`);
