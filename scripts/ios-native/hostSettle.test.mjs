import assert from "node:assert/strict";
import test from "node:test";
import { settleAfterBoot } from "./hostSettle.mjs";

function clock(loads) {
  let t = 0, i = 0;
  return { now: () => t, sleep: async (ms) => { t += ms; i++; }, load: () => loads[Math.min(i, loads.length - 1)] };
}

test("waits the minimum even when load is already low, then proceeds", async () => {
  const c = clock([10]);
  const result = await settleAfterBoot({ ...c });
  assert.equal(result.status, "settled"); assert.equal(result.waitedMs, 300000);
});

test("after the minimum, waits for the post-boot peak to fall below the threshold", async () => {
  // 15 s samples: rising to the peak, then falling (the hosted tablet-10 shape).
  const shape = [60, 97, 148, 287, 294, 367, 413, 336, 489, 479, 334, 422, 293, 277, 190, 180, ...Array(40).fill(400)];
  const c = clock(shape.flatMap((v) => Array(2).fill(v)));
  const result = await settleAfterBoot({ ...c });
  assert.equal(result.status, "settled"); assert(result.waitedMs >= 300000 && result.waitedMs < 600000); assert(result.load1 < 250);
});

test("never waits past the cap and never throws on unusable load readings", async () => {
  const high = await settleAfterBoot({ ...clock([700]) });
  assert.equal(high.status, "cap-reached"); assert.equal(high.waitedMs, 600000);
  const broken = await settleAfterBoot({ ...clock([Number.NaN]) });
  assert.equal(broken.status, "cap-reached"); assert.equal(broken.samples[0].load1, null);
  assert(high.samples.length <= 64);
});
