import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { join } from "node:path";

export interface VerifiedRemediation { package: string; advisory: string }
interface Remediation extends VerifiedRemediation {
  version: string;
  patch: string;
  patchSha256: string;
  files: Record<string, string>;
}
const digest = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");

/** Version-based scanners cannot see local fixes; accept only the exact installed repair. */
export function verifyRemediations(root: string): VerifiedRemediation[] {
  const entries: Remediation[] = JSON.parse(readFileSync(join(root, "security-remediations.json"), "utf8"));
  if (!Array.isArray(entries)) throw new Error("Invalid security remediations");
  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  return entries.map((entry) => {
    if (!/^[a-z][a-z0-9-]*$/.test(entry.package) || !/^\d+\.\d+\.\d+$/.test(entry.version)
      || !/^https:\/\/github.com\/advisories\/GHSA-[\w-]+$/.test(entry.advisory)
      || entry.patch !== `patches/${entry.package}@${entry.version}.patch`
      || !/^[a-f0-9]{64}$/.test(entry.patchSha256)
      || manifest.overrides?.[entry.package] !== entry.version
      || manifest.patchedDependencies?.[`${entry.package}@${entry.version}`] !== entry.patch
      || digest(join(root, entry.patch)) !== entry.patchSha256
      || !entry.files || Object.keys(entry.files).length === 0) {
      throw new Error(`Invalid security repair: ${entry.package}`);
    }
    const locations = new Set([realpathSync(join(root, "node_modules", entry.package))]);
    const store = join(root, "node_modules", ".bun");
    if (existsSync(store)) {
      for (const directory of readdirSync(store).filter((name) => name.startsWith(`${entry.package}@`))) {
        locations.add(realpathSync(join(store, directory, "node_modules", entry.package)));
      }
    }
    for (const location of locations) {
      if (JSON.parse(readFileSync(join(location, "package.json"), "utf8")).version !== entry.version) {
        throw new Error(`Unpatched installed version: ${entry.package}`);
      }
      for (const [file, expected] of Object.entries(entry.files)) {
        if (!/^[\w-]+(?:\/[\w.-]+)+$/.test(file) || file.split("/").some((part) => part === "." || part === "..")
          || !/^[a-f0-9]{64}$/.test(expected) || digest(join(location, file)) !== expected) {
          throw new Error(`Installed repair differs: ${entry.package}/${file}`);
        }
      }
    }
    return { package: entry.package, advisory: entry.advisory };
  });
}
