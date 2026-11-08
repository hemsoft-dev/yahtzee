import assert from "node:assert/strict";
import { localMaestro, MaestroError } from "../mcp.mjs";
import { compactCollector } from "./retention.mjs";

// Actual packaged CLI/SDK transport, with no device_id and therefore no device query.
const source = process.argv[2];
assert.notEqual(process.env.GITHUB_ACTIONS, "true", "CPU-only launcher control is not a hosted route.");
assert(/^[a-f0-9]{40}$/.test(source));
const identity = { THIRDROLL_COMPACT_SOURCE: source, THIRDROLL_COMPACT_RUN: "1", THIRDROLL_COMPACT_ATTEMPT: "1", THIRDROLL_COMPACT_ROUTE: "1" };
const collector = compactCollector(identity);
let client, saved;
try {
  client = await localMaestro({ cwd: process.cwd(), env: { ...process.env, ...identity }, deadline: Date.now() + 30000,
    onStderr: text => collector.feed(text) });
  await assert.rejects(client.call("inspect_screen", {}, { v: 1, invoke: 1, flow: 0, route: 1 }),
    error => error instanceof MaestroError && error.operation === "inspect_screen" && error.code === "tool-failed");
} finally {
  collector.retain(process.cwd(), (_path, text) => { saved = JSON.parse(text); });
  await client?.close();
}
assert.equal(saved.records.length, 2);
const [entry, summary] = saved.records;
assert.equal(entry.stage, 0); assert.equal(summary.stage, 2);
assert.equal(entry.rpc, 2); assert.equal(summary.rpc, 2); // initialize is the original first request.
assert.equal(summary.query, 0); assert.equal(summary.formatter, 0); assert.equal(summary.handler, 2);
assert.equal(summary.visited, 0);
console.log("ACTUAL_COMPACT_LAUNCHER_CONTROL_PASS metadata=true originalMissingDeviceResult=true inspectQueryNotEntered=true");
