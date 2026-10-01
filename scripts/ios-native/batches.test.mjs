import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import test from "node:test";
import { startFlow, resumeFlow, completeStartFlow, completeEndFlow } from "./flows.mjs";
import { rpcClient } from "./mcp.mjs";
import { batchAuthoredFlow, runAuthoredFlow } from "./batches.mjs";

// Exercise the production transport and authored setup at a scaled request budget.
// This catches aggregate-request exhaustion, not the native driver's unknown delay.
test("authored setup can finish within each request budget without raising the budget", async () => {
  const child = new EventEmitter();
  child.stdin = new PassThrough(); child.stdout = new PassThrough();
  let timer;
  child.stdin.on("data", (bytes) => {
    const request = JSON.parse(bytes.toString());
    const commands = request.params.yaml.split("\n").filter((line) => line.startsWith("- ")).length;
    timer = setTimeout(() => child.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { success: true } }) + "\n"), commands * 20);
  });
  child.stdin.on("finish", () => { clearTimeout(timer); child.emit("close", 0, null); });
  child.kill = () => child.emit("close", null, "SIGKILL");
  const client = rpcClient(child, { timeoutMs: 300 });
  try {
    await runAuthoredFlow({ runFlow: async (yaml) => {
      const result = await client.request("tools/call", { yaml });
      assert.equal(result.success, true);
    } }, startFlow("fixture.app", { dice: 5, ai: 0, orientation: "PORTRAIT" }));
  } finally { await client.close(); }
});

test("all navigation commands retain exact order, values and single launch semantics", () => {
  const commands = (yaml) => yaml.trimEnd().split("\n").slice(2);
  for (const dice of [5, 6, 8, 10]) for (const ai of [0, 3]) {
    for (const yaml of [startFlow("fixture.app", { dice, ai, orientation: "PORTRAIT" }), resumeFlow("fixture.app"), completeStartFlow("fixture.app"), completeEndFlow("fixture.app", false), completeEndFlow("fixture.app", true)]) {
      const batches = batchAuthoredFlow(yaml);
      assert.deepEqual(batches.flatMap(commands), commands(yaml));
      assert(batches.every((batch) => commands(batch).length <= 8 && batch.startsWith('appId: "fixture.app"\n---\n')));
    }
  }
});

test("an uncertain batch stops the sequence without replay or later actions", async () => {
  const calls = [];
  await assert.rejects(runAuthoredFlow({ runFlow: async (yaml) => {
    calls.push(yaml); if (calls.length === 2) throw new Error("uncertain transport failure");
  } }, startFlow("fixture.app", { dice: 5, ai: 0, orientation: "PORTRAIT" })), /uncertain transport failure/);
  assert.equal(calls.length, 2); assert(!calls.some((yaml) => yaml.includes('"Start Game"')));
  assert.equal(calls.filter((yaml) => yaml.includes("clearState")).length, 1);
});

test("malformed, multiline and oversized input is rejected before any batch executes", async () => {
  for (const yaml of ['appId: "fixture.app"\n---\n', 'appId: "fixture.app"\n---\n- runScript:\n    file: unrelated.js\n', 'appId: "fixture.app"\r\n---\r\n- launchApp\r\n', 'appId: "fixture.app"\n---\n- inputText: ' + 'x'.repeat(262144) + '\n', 'appId: "fixture.app"\n---\n- launchApp\nappId: "other.app"\n']) {
    let count = 0;
    await assert.rejects(runAuthoredFlow({ runFlow: async () => { count++; } }, yaml));
    assert.equal(count, 0);
  }
});
