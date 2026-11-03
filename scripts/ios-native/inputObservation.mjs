import { inputTraceUsable, startInputLog } from "./inputLog.mjs";

/** Diagnostics never decide the flow result. Preserve health without throwing into gameplay. */
export function startInputObservation(device, path, { start = startInputLog, ...options } = {}) {
  let stop;
  try { stop = start(device, path, options); }
  catch { return async () => ({ status: "unavailable", error: "input-log-start-failed" }); }
  let stopping;
  return () => stopping ??= (async () => {
    try {
      const receipt = await stop();
      return { ...receipt, status: inputTraceUsable(receipt) ? "available" : "unavailable" };
    } catch { return { status: "unavailable", error: "input-log-retention-failed" }; }
  })();
}
