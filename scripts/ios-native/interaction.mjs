import assert from "node:assert/strict";
import { appendFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { localMaestro } from "./mcp.mjs";
import { redactDriverLog } from "./driverLogs.mjs";

/** One bounded local driver session for the owned simulator. */
export async function nativeInteraction({ device, bundleId, directory, prefix, env, capture, exercise, openSession = localMaestro }) {
  assert(["complete", "hold", "scenario"].includes(prefix), "Unknown native interaction phase.");
  let diagnostics = "", sequence = 0;
  const deadline = Date.now() + 600000;
  const childEnv = Object.fromEntries(Object.entries(env).filter(([key]) =>
    /^(PATH|HOME|USER|LOGNAME|SHELL|TMPDIR|TMP|TEMP|JAVA_HOME|DEVELOPER_DIR|LANG|LC_ALL|MAESTRO_CLI_NO_ANALYTICS|MAESTRO_DISABLE_UPDATE_CHECK|MAESTRO_CLI_ANALYSIS_NOTIFICATION_DISABLED|MAESTRO_DRIVER_STARTUP_TIMEOUT)$/.test(key)));
  let client;
  async function call(name, args) { assert(Date.now() < deadline, "Native interaction exceeded ten minutes."); return client.call(name, args); }
  function writeScreen(name, screen) {
    assert.equal(screen.ui_schema?.platform, "ios", "Expected an owned iOS screen.");
    assert(Array.isArray(screen.elements), "Expected a native screen hierarchy.");
    const projection = { ui_schema: screen.ui_schema, elements: screen.elements };
    writeFileSync(join(directory, `${name}.json`), redactDriverLog(JSON.stringify(projection, (key, value) => /token|password|secret|credential|private.*key/i.test(key) ? undefined : value, 2), env) + "\n");
  }
  async function inspect() {
    const screen = await call("inspect_screen", { device_id: device });
    writeScreen(`${prefix}-screen-latest`, screen);
    return screen;
  }
  async function runFlow(yaml) {
    assert(typeof yaml === "string" && yaml.length <= 262144 && yaml.startsWith(`appId: ${JSON.stringify(bundleId)}\n---\n`), "Flow must target the owned application.");
    writeFileSync(join(directory, `${prefix}-step-${String(++sequence).padStart(3, "0")}.yaml`), yaml);
    const result = await call("run", { device_id: device, yaml });
    assert.equal(result.success, true, "Native interaction command failed.");
  }
  async function run(commands) {
    const yaml = `appId: ${JSON.stringify(bundleId)}\n---\n` + commands.map((command) => {
      const [[name, value]] = Object.entries(command); return `- ${name}: ${JSON.stringify(value)}`;
    }).join("\n") + "\n";
    await runFlow(yaml);
  }
  try {
    client = await openSession({ cwd: directory, env: childEnv, deadline, onStderr: (text) => { diagnostics += text.slice(0, Math.max(0, 262144 - diagnostics.length)); } });
    const devices = await call("list_devices", {});
    assert(devices.devices?.some((item) => item.device_id === device && item.platform === "ios" && item.connected === true), "Owned simulator is not connected to Maestro.");
    await exercise({ inspect, run, runFlow, capture, record: (value) => appendFileSync(join(directory, `${prefix}-geometry.jsonl`), JSON.stringify(value) + "\n") });
  } catch (error) {
    // Preserve the earlier geometry and primary failure. This read does not replay an action.
    function unavailableScreen() {
      try { writeFileSync(join(directory, `${prefix}-screen-failure-unavailable.txt`), "Failure screen inspection unavailable; the original interaction failure is preserved.\n"); }
      catch { /* Diagnostic storage can also fail without changing the primary error. */ }
    }
    if (client && Date.now() < deadline) {
      let timer;
      try {
        const screen = await Promise.race([
          call("inspect_screen", { device_id: device }),
          new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Failure screen inspection timed out.")), Math.max(1, Math.min(10000, deadline - Date.now()))); }),
        ]);
        writeScreen(`${prefix}-screen-failure`, screen);
      } catch { unavailableScreen(); }
      finally { clearTimeout(timer); }
    } else { unavailableScreen(); }
    try { await capture(`${prefix}-failure`); } catch { /* Preserve the original error; the runner also reads the saved document. */ }
    throw error;
  } finally {
    try { await client?.close(); }
    finally { writeFileSync(join(directory, `${prefix}-mcp.log`), redactDriverLog(diagnostics, env)); }
  }
}
