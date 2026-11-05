import { doneTraceUsable, startDoneLog } from "./doneLog.mjs";

/** Advisory only: this never throws, never rejects and spends at most its own short budget at shutdown. */
export function startDoneObservation(device, path, { start = startDoneLog, budgetMs = 3000, ...options } = {}) {
  let stop;
  try { stop = start(device, path, options); }
  catch { return async () => ({ status: "unavailable", error: "done-log-start-failed" }); }
  let stopping;
  return () => stopping ??= (async () => {
    let timer;
    const stalled = new Promise((resolve) => { timer = setTimeout(() => resolve({ status: "unavailable", error: "done-log-stop-stalled" }), budgetMs); });
    const stopped = (async () => {
      const receipt = await stop();
      return { ...receipt, status: doneTraceUsable(receipt) ? "available" : "unavailable" };
    })().catch(() => ({ status: "unavailable", error: "done-log-retention-failed" }));
    try { return await Promise.race([stopped, stalled]); }
    finally { clearTimeout(timer); }
  })();
}
