import { createHash } from "node:crypto";
export const ORIGINAL_SHA256 = "549070af3acabb3efcc4f55bfe6210f9f7c2fcf633cf7eaa59bfe60719969171";
export const digest = (source) => createHash("sha256").update(source).digest("hex");
// Exact Playwright-core 1.63.0 CJS bundle. No dependency bytes are written.
export const insertions = [
  ['          await action(progress3, point);', '          __hsClick.edge(2, 0);\n          try { await action(progress3, point); } catch (e) { __hsClick.edge(2, 2); throw e; }\n          __hsClick.edge(2, 1);'],
  ['              return hitTargetInterceptionHandle.evaluate((h) => h.stop());', '              __hsClick.edge(5, 0);\n              return hitTargetInterceptionHandle.evaluate((h) => h.stop());'],
  ['            }).catch((e) => "done").finally(() => {', '            }).catch((e) => { __hsClick.edge(5, 2); return "done"; }).finally(() => {'],
  ['              const hitTargetResult = await progress3.race(stopHitTargetInterception);', '              const hitTargetResult = await progress3.race(stopHitTargetInterception);\n              __hsClick.edge(5, 1);'],
  ['          progress3.log(`  ${options.trial ? "trial " : ""}${actionName} action done`);', '          __hsClick.edge(6, 1);\n          progress3.log(`  ${options.trial ? "trial " : ""}${actionName} action done`);'],
  ['        if (actionResult !== "done")\n          return actionResult;', '        __hsClick.edge(7, 1);\n        if (actionResult !== "done")\n          return actionResult;'],
  ['        if (sessionId)\n          message.sessionId = sessionId;\n        this._protocolLogger("send", message);\n        this._transport.send(message);', '        if (sessionId)\n          message.sessionId = sessionId;\n        __hsClick.send(id, method, this);\n        this._protocolLogger("send", message);\n        this._transport.send(message);'],
  ['      async _onMessage(message) {\n        this._protocolLogger("receive", message);\n        if (message.id === kBrowserCloseMessageId)', '      async _onMessage(message) {\n        __hsClick.receive(message.id, !!message.error, this);\n        this._protocolLogger("receive", message);\n        if (message.id === kBrowserCloseMessageId)'],
  ['          this._callbacks.delete(id);\n          if (error && !result2) {', '          this._callbacks.delete(id);\n          if (callback.type === "Frame" && callback.method === "click") __hsClick.edge(8, error && !result2 ? 2 : 1);\n          if (error && !result2) {'],
];
export const prefix = 'const __hsClick = module.__hsClickObservation;\n';
export function patch(source) {
  if (digest(source) !== ORIGINAL_SHA256) throw new Error("Pinned Playwright bundle mismatch");
  let result = source;
  for (const [before, after] of insertions) {
    if (result.split(before).length !== 2) throw new Error("Pinned Playwright boundary mismatch");
    result = result.replace(before, after);
  }
  return prefix + result;
}
