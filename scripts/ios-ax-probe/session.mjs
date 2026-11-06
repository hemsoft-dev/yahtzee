import { createHash } from "node:crypto";
import { MaestroError } from "../ios-native/mcp.mjs";
import { BUDGET, PLAN, PROTOCOL_VERSIONS, TRANSPORT_CLASSES, boundaryOf, interpret, stageArguments } from "./protocol.mjs";

const sha256 = (text) => createHash("sha256").update(text).digest("hex");
const hostMonoSeconds = () => Number(process.hrtime.bigint()) / 1e9;

function failureCode(error) {
  if (error instanceof MaestroError) return error.code === "rpc-timeout" ? "rpc-timeout" : error.code === "deadline-exhausted" ? "deadline-exhausted" : "transport-closed";
  return /JSON-RPC error/.test(error?.message ?? "") ? "rpc-error" : "transport-closed";
}

function toolJson(response) {
  if (response?.isError === true || response?.content?.length !== 1 || response.content[0]?.type !== "text") return undefined;
  try { return JSON.parse(response.content[0].text); } catch { return undefined; }
}

/**
 * One MCP session, one pass over the fixed plan. Every stage is journaled before
 * its request is sent, so a request that never returns still leaves a start entry.
 * A stage is sent at most once. After a transport failure or a request without a
 * response, the remaining stages are recorded as not run; nothing reconnects.
 */
export async function runProbeSession({ openTransport, device, journal = () => {}, observe = async () => ({}), now = Date.now,
  hostMono = hostMonoSeconds, plan = PLAN, budget = BUDGET }) {
  const deadline = now() + budget.sessionMs;
  const result = { status: "running", session: { initialize: "not-run", listDevices: "not-run", shutdown: "not-run" }, stages: [] };
  const sent = new Set();
  let client, stoppedBy = null;
  const write = (entry) => { try { journal(entry); } catch { result.journalUnavailable = true; } };
  try {
    client = await openTransport({ deadline });
    const hello = await client.request("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "ios-ax-probe", version: "1" } });
    if (hello?.serverInfo?.name !== "maestro" || !PROTOCOL_VERSIONS.includes(hello?.protocolVersion)) {
      result.session.initialize = "unexpected-server"; result.status = "session-failed"; return result;
    }
    client.notify("notifications/initialized");
    result.session.initialize = "returned";
    // Host-side discovery only; it does not reach the XCTest runner.
    const devices = toolJson(await client.request("tools/call", { name: "list_devices", arguments: {} }));
    if (!devices?.devices?.some((item) => item?.device_id === device && item.platform === "ios" && item.connected === true)) {
      result.session.listDevices = "owned-device-missing"; result.status = "device-not-connected"; return result;
    }
    result.session.listDevices = "owned-device-connected";
    for (const stage of plan) {
      if (stoppedBy || now() >= deadline) {
        result.stages.push({ id: stage.id, tool: stage.tool, purpose: stage.purpose, layer: stage.layer, outcome: "not-run",
          notRunReason: stoppedBy ? `stopped-after-${stoppedBy}` : "deadline-exhausted", boundary: "not-run" });
        continue;
      }
      if (sent.has(stage.id)) throw new Error("A probe stage cannot be sent twice.");
      sent.add(stage.id);
      const args = stageArguments(stage, device);
      const record = { id: stage.id, tool: stage.tool, purpose: stage.purpose, layer: stage.layer, argumentsSha256: sha256(JSON.stringify(args)),
        startedAt: new Date(now()).toISOString(), wallStartMs: now(), hostMonoStart: hostMono() };
      if (stage.includesDriverStartup) record.includesDriverStartup = true;
      write({ event: "stage-start", id: stage.id, at: record.startedAt, hostMono: record.hostMonoStart });
      const started = performance.now();
      try {
        Object.assign(record, interpret(stage, await client.request("tools/call", { name: stage.tool, arguments: args })));
      } catch (error) {
        record.outcome = failureCode(error) === "rpc-timeout" ? "request-timeout" : failureCode(error) === "deadline-exhausted" ? "deadline-exhausted" : "transport-closed";
        stoppedBy = stage.id;
      }
      record.elapsedMs = Math.round(performance.now() - started);
      record.wallEndMs = now(); record.hostMonoEnd = hostMono();
      record.boundary = boundaryOf(record);
      if (TRANSPORT_CLASSES.includes(record.errorClass)) stoppedBy = stage.id;
      try { record.observation = await observe(stage, record); } catch { record.observation = { state: "unavailable" }; }
      write({ event: "stage-end", id: stage.id, outcome: record.outcome, boundary: record.boundary, elapsedMs: record.elapsedMs, hostMono: record.hostMonoEnd });
      result.stages.push(record);
    }
    result.status = stoppedBy ? "stopped" : result.stages.some((stage) => stage.notRunReason === "deadline-exhausted") ? "stopped" : "completed";
  } catch (error) {
    if (result.session.initialize === "not-run") result.session.initialize = failureCode(error);
    else if (result.session.listDevices === "not-run") result.session.listDevices = failureCode(error);
    result.status = "session-failed";
  } finally {
    if (client) {
      try { await client.close(); result.session.shutdown = "closed"; } catch { result.session.shutdown = "close-failed"; }
    }
  }
  return result;
}
