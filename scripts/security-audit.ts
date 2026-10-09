import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { verifyRemediations } from "./security-remediations";
import { checkAudit, type Exception } from "./security-policy";

const result = spawnSync(process.execPath, ["audit", "--json"], { encoding: "utf8" });
if (result.error || result.status === null || ![0, 1].includes(result.status)) {
  throw new Error(`Dependency scanner failed: ${result.error ?? result.stderr}`);
}
const report: unknown = JSON.parse(result.stdout);
const exceptions: Exception[] = JSON.parse(readFileSync(new URL("../security-exceptions.json", import.meta.url), "utf8"));
const repairs = verifyRemediations(fileURLToPath(new URL("..", import.meta.url)));
const regression = spawnSync("node", [fileURLToPath(new URL("./security-remediation-regressions.cjs", import.meta.url))], { encoding: "utf8", timeout: 30000 });
if (regression.error || regression.status !== 0) throw new Error(`Security repair regression failed: ${regression.error ?? regression.stderr}`);
const failures = checkAudit(report, exceptions, new Date().toISOString().slice(0, 10), repairs);
if (result.status !== 0 && Object.keys(report as object).length === 0) {
  throw new Error("Scanner failed without advisory evidence");
}
if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log(`Dependency audit passed; ${repairs.length} exact installed repairs verified; no unaccepted advisories.`);
