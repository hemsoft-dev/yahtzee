import Module, { createRequire } from "node:module";
import { closeSync, mkdirSync, mkdtempSync, openSync, readFileSync, realpathSync, writeFileSync, writeSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRecorder } from "./record.mjs";
import { digest, patch, ORIGINAL_SHA256 } from "./patch.mjs";

const require = createRequire(import.meta.url);
const playwrightRequire = createRequire(require.resolve("playwright"));
const core = playwrightRequire.resolve("playwright-core");
const bundle = join(dirname(core), "lib/coreBundle.js");
if (JSON.parse(readFileSync(join(dirname(core), "package.json"), "utf8")).version !== "1.63.0")
  throw new Error("Pinned Playwright version mismatch");
if (require.cache[bundle]) throw new Error("Playwright loaded before completion observer");
const source = readFileSync(bundle, "utf8"), observed = patch(source);
let fd, directory, used = false;
const recorder = createRecorder((row) => {
  if (fd === undefined) throw 0;
  const line = JSON.stringify(row) + "\n";
  if (writeSync(fd, line) !== Buffer.byteLength(line)) throw 0;
});
const generated = new Module(bundle);
generated.filename = bundle;
generated.paths = Module._nodeModulePaths(dirname(bundle));
generated.__hsClickObservation = recorder;
require(join(dirname(core), "lib/bootstrap.js"));
require.cache[bundle] = generated;
try { generated._compile(observed, bundle); generated.loaded = true; }
catch (error) { delete require.cache[bundle]; throw error; }
export const chromium = require("playwright").chromium;
const evidenceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..", "reports/lifecycle-click");
function receipt() {
  if (!directory) return;
  try { writeFileSync(join(directory, "coverage.json"), JSON.stringify({
    v: 1, version: "1.63.0", original: ORIGINAL_SHA256, observed: digest(observed),
    ...recorder.state(), loadedImage: "unattested", payloads: false,
  }) + "\n"); } catch { /* Partial data never changes the test. */ }
}
export const clickObservation = Object.freeze({
  begin() {
    if (used) return;
    used = true;
    try {
      mkdirSync(evidenceRoot, { recursive: true });
      const normalize = value => process.platform === "win32" ? value.toLowerCase() : value;
      if (normalize(realpathSync(evidenceRoot)) !== normalize(evidenceRoot)) throw 0;
      directory = mkdtempSync(join(evidenceRoot, "resume-"));
      fd = openSync(join(directory, "events.jsonl"), "wx", 0o600);
    } catch { /* Clock and retention failures cannot suppress the click. */ }
    recorder.begin(); receipt();
  },
  complete(failed) { recorder.complete(failed); receipt(); },
  close() { receipt(); try { if (fd !== undefined) closeSync(fd); } catch { /* Isolated. */ } fd = undefined; },
});
