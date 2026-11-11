import { loadavg } from "node:os";
import { setTimeout as delay } from "node:timers/promises";

/**
 * #130: a freshly booted simulator starts dozens of background services (widgets, intelligence,
 * Fitness, sync agents). On hosted 3-CPU runners the 1-minute load average peaked at 490-670
 * three to seven minutes after boot and fell to about 200 by minutes eight to ten. Every XCTest
 * "Timed out while requesting screenshot" driver loss so far happened in the first scenario,
 * inside that peak. Wait at least `minMs` after boot, then until load falls below `threshold`,
 * never longer than `maxMs`. It only waits: it never fails, retries or changes a flow.
 */
export async function settleAfterBoot({ load = () => loadavg()[0], now = Date.now, sleep = (ms) => delay(ms),
  minMs = 300000, maxMs = 600000, threshold = 250, intervalMs = 15000 } = {}) {
  const started = now(), samples = [];
  for (;;) {
    const elapsedMs = now() - started, load1 = load();
    if (samples.length < 64) samples.push({ elapsedMs, load1: Number.isFinite(load1) ? Math.round(load1 * 10) / 10 : null });
    if (elapsedMs >= minMs && Number.isFinite(load1) && load1 < threshold) return { status: "settled", waitedMs: elapsedMs, load1, threshold, minMs, maxMs, samples };
    if (elapsedMs >= maxMs) return { status: "cap-reached", waitedMs: elapsedMs, load1, threshold, minMs, maxMs, samples };
    await sleep(intervalMs);
  }
}
