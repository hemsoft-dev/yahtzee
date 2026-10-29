import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { test } from "node:test";
import { localMaestro, rpcClient, MaestroError } from "./mcp.mjs";

function processFixture(reply = () => {}) {
  const child = new EventEmitter();
  child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
  const messages = [];
  child.stdin.on("data", (bytes) => {
    for (const line of bytes.toString().trim().split("\n")) { const message = JSON.parse(line); messages.push(message); reply(message, child); }
  });
  child.stdin.on("finish", () => child.emit("close", 0, null));
  child.kill = () => child.emit("close", null, "SIGKILL");
  return { child, messages };
}
const respond = (child, id, result) => child.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n");

test("local RPC supports fragmented UTF-8 replies, notifications and rejects server actions", async () => {
  const { child, messages } = processFixture();
  const client = rpcClient(child, { timeoutMs: 1000 });
  const pending = client.request("test", { bounded: true });
  const bytes = Buffer.from(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { word: "café" } }) + "\n");
  for (const byte of bytes) child.stdout.write(Buffer.from([byte]));
  assert.deepEqual(await pending, { word: "café" });
  child.stdout.write(JSON.stringify({ jsonrpc: "2.0", method: "unexpected", id: "server-1" }) + "\n");
  assert.equal(messages.at(-1).error.code, -32601);
  client.notify("notifications/initialized"); assert.equal(messages.at(-1).method, "notifications/initialized");
  await client.close(); await assert.rejects(client.request("closed", {}));
});
test("local RPC fails closed on malformed, oversized, timed-out and exited sessions", async () => {
  for (const payload of ["not json\n", JSON.stringify({ jsonrpc: "1.0", id: 1, result: {} }) + "\n", "x".repeat(1025)]) {
    const { child } = processFixture(); const client = rpcClient(child, { timeoutMs: 1000, maxBytes: 1024 });
    const result = client.request("test", {}); child.stdout.write(payload);
    await assert.rejects(result); await assert.rejects(client.request("again", {})); await client.close();
  }
  const { child } = processFixture(); const client = rpcClient(child, { timeoutMs: 5 });
  await assert.rejects(client.request("test", {}), /timed out/); await client.close();
  const ended = processFixture(); const exited = rpcClient(ended.child);
  const pending = exited.request("test", {}); ended.child.emit("close", 7, null);
  await assert.rejects(pending, /exited: 7/); await exited.close();
});
test("local server handshake, selected JSON result and local-only tool allowlist", async () => {
  const fixture = processFixture((message, child) => {
    if (message.method === "initialize") respond(child, message.id, { serverInfo: { name: "maestro" }, protocolVersion: "2024-11-05" });
    if (message.method === "tools/call") respond(child, message.id, { content: [{ type: "text", text: JSON.stringify({ devices: [] }) }] });
  });
  const stderr = [];
  const client = await localMaestro({ cwd: "/owned", env: {}, onStderr: (text) => stderr.push(text), start: (exe, args, options) => {
    assert.equal(exe, "maestro"); assert.deepEqual(args, ["mcp", "--no-viewer", "--working-dir", "/owned"]);
    assert.equal(options.cwd, "/owned"); return fixture.child;
  } });
  fixture.child.stderr.write("diagnostic"); assert.deepEqual(stderr, ["diagnostic"]);
  assert.deepEqual(await client.call("list_devices"), { devices: [] });
  const count = fixture.messages.length;
  await assert.rejects(client.call("run_on_cloud", {}), /Only local/);
  assert.equal(fixture.messages.length, count); await client.close();
});
test("unknown server and error tool result cannot establish successful qualification", async () => {
  const wrong = processFixture((message, child) => {
    if (message.method === "initialize") respond(child, message.id, { serverInfo: { name: "unknown" }, protocolVersion: "2024-11-05" });
  });
  await assert.rejects(localMaestro({ cwd: "/owned", env: {}, onStderr: () => {}, start: () => wrong.child }), /Unexpected local/);
  const fixture = processFixture((message, child) => {
    if (message.method === "initialize") respond(child, message.id, { serverInfo: { name: "maestro" }, protocolVersion: "2024-11-05" });
    if (message.method === "tools/call") respond(child, message.id, { isError: true, content: [{ type: "text", text: "failure" }] });
  });
  const client = await localMaestro({ cwd: "/owned", env: {}, onStderr: () => {}, start: () => fixture.child });
  await assert.rejects(client.call("run", { yaml: "invalid" }), /run failed/); await client.close();
});

test("late RPC success cannot revive a timed-out session or send another command", async () => {
  const { child, messages } = processFixture();
  const client = rpcClient(child, { timeoutMs: 5 });
  await assert.rejects(client.request("tools/call", { name: "run" }), (error) => error instanceof MaestroError && error.code === "rpc-timeout");
  respond(child, 1, { success: true });
  await assert.rejects(client.request("tools/call", { name: "run" }));
  assert.equal(messages.length, 1); await client.close();
});
test("only read-only known startup responses receive transport classification", async () => {
  for (const name of ["inspect_screen", "run"]) {
    const fixture = processFixture((message, child) => {
      if (message.method === "initialize") respond(child, message.id, { serverInfo: { name: "maestro" }, protocolVersion: "2024-11-05" });
      if (message.method === "tools/call") respond(child, message.id, { isError: true, content: [{ type: "text", text: "Failed to run flow: Device became unreachable during deviceInfo" }] });
    });
    const client = await localMaestro({ cwd: "/owned", env: {}, onStderr: () => {}, start: () => fixture.child });
    await assert.rejects(client.call(name), (error) => error instanceof MaestroError && error.failureClass === (name === "run" ? "application-flow" : "transport-startup"));
    await client.close();
  }
});

test("an expired deadline sends no command", async () => {
  const { child, messages } = processFixture();
  const client = rpcClient(child, { deadline: Date.now() - 1 });
  await assert.rejects(client.request("tools/call", { name: "run" }), (error) => error.code === "deadline-exhausted");
  assert.equal(messages.length, 0); await client.close();
});
