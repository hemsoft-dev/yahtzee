import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

/** Codes are assigned at the protocol boundary, never inferred by the retry loop. */
export class MaestroError extends Error {
  constructor(code, operation, failureClass = "transport-startup") {
    super(code === "rpc-timeout" ? `Local Maestro ${operation} timed out.` : `Local Maestro ${operation} failed (${code}); see the retained phase MCP log.`);
    this.code = code; this.operation = operation; this.failureClass = failureClass;
  }
}

function toolFailure(name, result) {
  // A run response can describe a failure after taps or launch. Always terminal.
  const text = result.content?.filter((item) => item.type === "text").map((item) => item.text).join("\n") ?? "";
  const transportClass = name === "run" ? "transport-uncertain" : "transport-startup";
  // Explicit app failures take precedence if a diagnostic contains both kinds.
  if (!/Assertion is false:|Element not found:/.test(text)) {
    if (/Device became unreachable during deviceInfo/.test(text)) return new MaestroError("device-unreachable", name, transportClass);
    if (/driver.*(?:install|connect).*(?:fail|error)|(?:Failed|Unable) to (?:install|connect).*driver/i.test(text)) return new MaestroError("driver-connect", name, transportClass);
  }
  return new MaestroError(name === "run" ? "flow-failed" : "tool-failed", name, name === "run" ? "application-flow" : "unknown");
}

/** Bounded local JSON-RPC transport. Never persist raw responses or injected environment values. */
export function rpcClient(child, { timeoutMs = 300000, maxBytes = 8 * 1024 * 1024, deadline = Infinity } = {}) {
  let nextId = 0, buffer = "", failure = null, closing = false;
  const pending = new Map();
  function fail(error) {
    failure ??= error;
    for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(failure); }
    pending.clear();
  }
  function send(message) { child.stdin.write(JSON.stringify(message) + "\n"); }
  function receive(line) {
    const message = JSON.parse(line);
    assert.equal(message.jsonrpc, "2.0", "Invalid local JSON-RPC version.");
    if (message.method) {
      if (message.id !== undefined) send({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "Server requests are not supported." } });
      return;
    }
    const entry = pending.get(message.id); assert(entry, "Unexpected local JSON-RPC response.");
    clearTimeout(entry.timer); pending.delete(message.id);
    if (message.error) entry.reject(new Error(`Local JSON-RPC error ${message.error.code ?? "unknown"}.`));
    else if (!Object.hasOwn(message, "result")) entry.reject(new Error("Local JSON-RPC response has no result."));
    else entry.resolve(message.result);
  }
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    if (failure) return;
    try {
      buffer += chunk; assert(Buffer.byteLength(buffer) <= maxBytes, "Local JSON-RPC output exceeded its bound.");
      let newline;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline).trim(); buffer = buffer.slice(newline + 1);
        if (line) receive(line);
      }
    } catch (error) { fail(error); }
  });
  child.on("error", fail); child.stdin.on("error", fail);
  const stopped = new Promise((resolve) => child.once("close", (code, signal) => {
    fail(new Error(`Local Maestro exited: ${code ?? signal}.`)); resolve();
  }));
  function request(method, params) {
    if (Date.now() >= deadline) return Promise.reject(new MaestroError("deadline-exhausted", method, "deadline"));
    if (failure || closing) return Promise.reject(failure ?? new Error("Local Maestro is closing."));
    return new Promise((resolve, reject) => {
      const id = ++nextId;
      const timer = setTimeout(() => fail(new MaestroError("rpc-timeout", params?.name ?? method, params?.name === "run" ? "transport-uncertain" : "transport-startup")), Math.max(1, Math.min(timeoutMs, deadline - Date.now())));
      pending.set(id, { resolve, reject, timer });
      try { send({ jsonrpc: "2.0", id, method, params }); } catch (error) { fail(error); }
    });
  }
  async function close() {
    if (closing) return stopped;
    closing = true; fail(new Error("Local Maestro session closed.")); child.stdin.end();
    const controller = new AbortController();
    let timedOut = false;
    try {
      await Promise.race([stopped, delay(Math.max(1, Math.min(60000, deadline - Date.now())), undefined, { signal: controller.signal }).then(() => {
        timedOut = true;
        child.kill("SIGKILL");
      })]);
      if (timedOut) throw new Error("Local Maestro did not close within its shutdown budget.");

    } finally { controller.abort(); }
  }
  return { request, notify: (method) => send({ jsonrpc: "2.0", method }), close };
}

const localTools = new Set(["list_devices", "inspect_screen", "run"]);
export async function localMaestro({ cwd, env, onStderr, deadline, start = spawn }) {
  const child = start("maestro", ["mcp", "--no-viewer", "--working-dir", cwd], { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
  // Collect sanitized diagnostics at the caller; do not mix stderr into the protocol channel.
  child.stderr.setEncoding("utf8"); child.stderr.on("data", onStderr);
  const client = rpcClient(child, { deadline });
  try {
    const hello = await client.request("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "native-qualification", version: "1" } });
    assert.equal(hello.serverInfo?.name, "maestro", "Unexpected local automation server.");
    assert(["2024-11-05", "2025-03-26", "2025-06-18"].includes(hello.protocolVersion), "Unsupported local protocol version.");
    client.notify("notifications/initialized");
  } catch (error) {
    try { await client.close(); } catch {
      error.recoverySafe = false;
      onStderr("\nLocal Maestro startup shutdown failed.\n");
    }
    throw error;
  }
  async function call(name, args = {}) {
    assert(localTools.has(name), "Only local native qualification tools are permitted.");
    const result = await client.request("tools/call", { name, arguments: args });
    if (result.isError) {
      onStderr(`\nLocal ${name} error: ${JSON.stringify(result.content).slice(0, 8192)}\n`);
      throw toolFailure(name, result);
    }
    assert.equal(result.content?.length, 1, "Unexpected local tool response.");
    assert.equal(result.content[0].type, "text", "Expected local JSON text.");
    return JSON.parse(result.content[0].text);
  }
  return { call, close: client.close };
}
