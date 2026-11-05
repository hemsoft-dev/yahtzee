import { afterAll, beforeAll, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { createLocalStore } from "../../apps/mobile/src/local/store";
import { SAVE_KEY } from "../../apps/mobile/src/local/save";

// Actual Play, Action, LocalProvider and store, with controlled persistence.
// Host callback delivery isolates decisions. This is not native tap proof.
const root = resolve(import.meta.dir, "../..");
const BASELINE_SHA256 = "866b4e8c8674f9ea93adc520ee960017c679546021af8b1cde268f801106e778";
const baselinePath = resolve(import.meta.dir, "fixtures/reroll-baseline-f558.tsx.fixture");
const baselineSource = (text: string) => {
  const contents = text.replace(/\r\n/g, "\n");
  if (createHash("sha256").update(contents).digest("hex") !== BASELINE_SHA256) throw new Error("Pinned Re-roll baseline fixture changed");
  return contents;
};

type Mode = "current" | "old" | "shipping";
type TraceEvent = { phase: string; rerollId: number; sequence: number };
type Snapshot = { events: TraceEvent[]; records: Record<string, unknown>[]; attempts: string[]; saved: string | null;
  moves: { first: string; count: number; observer: string }[]; settled: boolean[]; returned: unknown[]; published: unknown[]; keys: string[] };

const entry = `
import React, { StrictMode, useEffect, useLayoutEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { Play } from './apps/mobile/src/screens/Play';
import { LocalProvider, useLocalGame } from './apps/mobile/src/local/LocalProvider';
const values = new Map(); const attempts = []; const moves = []; const settled = []; const returned = []; const published = [];
window.records = []; window.pressables = {};
console.info = (line) => { if (String(line).startsWith('THIRD_ROLL_INPUT ')) window.records.push(JSON.parse(String(line).slice(17))); };
const gate = window.gate = { mode: 'pass', readFails: false, release() {}, reject() {} };
window.controlledStorage = {
  async getItem(key) { if (gate.readFails) throw new Error('PRIVATE read failure'); return values.get(key) ?? null; },
  setItem(key, value) {
    attempts.push(value);
    if (gate.mode === 'fail') return Promise.reject(new Error('PRIVATE write failure'));
    if (gate.mode === 'hold') return new Promise((done, failed) => {
      gate.release = () => { values.set(key, value); done(); };
      gate.reject = () => failed(new Error('PRIVATE write failure'));
    });
    values.set(key, value); return Promise.resolve();
  },
  async removeItem(key) { values.delete(key); },
};
const summary = (view) => ({ busy: view.busy, canRetry: view.canRetry, retryReset: view.retryReset, error: view.error, generation: view.generation,
  revision: view.data?.active?.revision, rollsLeft: view.data?.active?.game.rollsLeft, held: view.data?.active?.game.held, dice: view.data?.active?.game.dice });
function Host() {
  const { store, view } = useLocalGame();
  const [shown, setShown] = useState(true);
  useLayoutEffect(() => {
    window.setShown = (next) => flushSync(() => setShown(next));
    window.store = store; window.view = view;
    if (store.wrapped) return;
    const move = store.move; store.wrapped = true;
    store.move = (...args) => {
      moves.push({ first: JSON.stringify(args[0]), count: args.length, observer: typeof args[1] });
      const result = move(...args); void result.then((value) => settled.push(value)); return result;
    };
  });
  useEffect(() => store.subscribe(() => published.push(summary(store.getSnapshot()))), [store]);
  return shown && view.data?.active ? <Play onPause={() => {}} /> : <div>No active game</div>;
}
let app;
const reroll = () => window.pressables['reroll-action'];
window.fixture = {
  mount(bytes) {
    values.set('${SAVE_KEY}', bytes);
    app = createRoot(document.getElementById('root'));
    flushSync(() => app.render(<StrictMode><LocalProvider><Host /></LocalProvider></StrictMode>));
  },
  seed(value) {
    let state = value >>> 0;
    Math.random = () => { state = (state + 0x6d2b79f5) >>> 0; let t = state; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  },
  in(time) { reroll().onPressIn?.({ nativeEvent: { timestamp: time, name: 'PRIVATE native' } }); },
  out(time) { reroll().onPressOut?.({ nativeEvent: { timestamp: time, name: 'PRIVATE native' } }); },
  press(...args) { returned.push(reroll().onPress(...args) ?? null); },
  unmount() { flushSync(() => app.unmount()); },
  failSink() { console.info = () => { throw new Error('PRIVATE sink failure'); }; },
  keys(name) { return Object.keys(window.pressables[name]).sort(); },
  absent(name, key) { return window.pressables[name][key] === undefined; },
  snapshot() {
    return { records: window.records, events: window.records.filter((record) => record.phase.startsWith('reroll-')), attempts, saved: values.get('${SAVE_KEY}') ?? null,
      moves, settled, returned, published, keys: Object.keys(window.pressables).sort() };
  },
};`;

let browser: Browser, seeds: { live: string; exhausted: string };
const scripts = {} as Record<Mode, string>;

async function seedBytes(rolls: number) {
  const values = new Map<string, string>();
  const store = createLocalStore({
    async getItem(key) { return values.get(key) ?? null; },
    async setItem(key, value) { values.set(key, value); },
    async removeItem(key) { values.delete(key); },
  }, () => "PRIVATE-GAME-ID");
  await store.load();
  await store.start({ name: "PRIVATE PLAYER", diceCount: 5, aiOpponents: 0 });
  await store.move({ kind: "hold", index: 0 });
  for (let roll = 0; roll < rolls; roll++) await store.move({ kind: "roll" });
  return values.get(SAVE_KEY)!;
}

beforeAll(async () => {
  seeds = { live: await seedBytes(0), exhausted: await seedBytes(2) };
  for (const mode of ["current", "old", "shipping"] as const) {
    const result = await Bun.build({ entrypoints: ["reroll-fixture"], target: "browser", format: "iife",
      define: { process: "{}", "process.env.NODE_ENV": '"development"', __DEV__: "true", "process.env.EXPO_PUBLIC_NATIVE_INPUT_TRACE": JSON.stringify(mode === "shipping" ? "0" : "1") },
      plugins: [{ name: "actual-reroll-lifecycle", setup(build) {
        build.onResolve({ filter: /^reroll-fixture$/ }, () => ({ path: "entry", namespace: "reroll" }));
        build.onLoad({ filter: /.*/, namespace: "reroll" }, () => ({ contents: entry, loader: "tsx", resolveDir: root }));
        build.onResolve({ filter: /^react-native$/ }, () => ({ path: "host", namespace: "host" }));
        build.onLoad({ filter: /.*/, namespace: "host" }, () => ({ loader: "tsx", resolveDir: root, contents: `
          import React, { forwardRef, useLayoutEffect } from 'react';
          import { Pressable as Host } from 'react-native-web';
          export * from 'react-native-web';
          export const Pressable = forwardRef((props, ref) => {
            useLayoutEffect(() => { window.pressables[props.testID ?? props.accessibilityLabel] = props; });
            return <Host {...props} ref={ref} />;
          });` }));
        build.onResolve({ filter: /^react-native-safe-area-context$/ }, () => ({ path: resolve(root, "tests/clients/native-safe-area.tsx") }));
        build.onLoad({ filter: /platformStorage\.ts$/ }, () => ({ loader: "ts", contents: "export function createPlatformStorage(){return window.controlledStorage;}" }));
        if (mode === "old") build.onLoad({ filter: /[\\/]screens[\\/]Play\.tsx$/ }, async () => ({
          // Keep the historical control available in CI's shallow checkout.
          contents: baselineSource(await Bun.file(baselinePath).text()), loader: "tsx", resolveDir: resolve(root, "apps/mobile/src/screens"),
        }));
      } }] });
    if (!result.success) throw new Error(result.logs.join("\n"));
    scripts[mode] = await result.outputs[0].text();
  }
  browser = await chromium.launch({ headless: true });
}, 30000);
afterAll(async () => { await browser?.close(); });

async function open<T>(mode: Mode, body: (page: Page) => Promise<T>, bytes = seeds.live, label = "Re-roll (2)") {
  const page = await browser.newPage();
  try {
    await page.setContent('<div id="root"></div>'); await page.addScriptTag({ content: scripts[mode] });
    await page.evaluate(`window.fixture.mount(${JSON.stringify(bytes)})`);
    await page.getByRole("button", { name: label, exact: true }).waitFor({ timeout: 3000 });
    return await body(page);
  } finally { await page.close(); }
}
const act = (page: Page, code: string) => page.evaluate(`(()=>{${code};})()`);
const snapshot = (page: Page) => page.evaluate<Snapshot>("fixture.snapshot()");
/** Every synchronous publication has committed and no store operation is running. */
const idle = (page: Page) => page.waitForFunction("window.view === window.store.getSnapshot() && !window.view.busy", undefined, { timeout: 3000, polling: 10 });
const phases = (state: Snapshot, id?: number) => state.events.filter((event) => id === undefined || event.rerollId === id).map((event) => event.phase);
const ids = (state: Snapshot) => [...new Set(state.events.map((event) => event.rerollId))];
const durable = (bytes: string | null) => JSON.parse(bytes!) as { active: { revision: number; game: { rollsLeft: number; held: number[]; dice: number[]; players: { scores: object }[] } }; history: { entries: unknown[] } };
const label = (page: Page, name: string) => page.getByRole("button", { name, exact: true }).waitFor({ timeout: 3000 });

function expectOneRoll(state: Snapshot, calls = 1) {
  const before = durable(seeds.live), after = durable(state.saved);
  expect(state.moves.filter((move) => move.first === '{"kind":"roll"}').length).toBe(calls);
  expect(state.attempts.length).toBe(1); expect(state.saved).toBe(state.attempts[0]);
  expect(after.active.revision).toBe(before.active.revision + 1);
  expect(after.active.game.rollsLeft).toBe(before.active.game.rollsLeft - 1);
  expect(after.active.game.held).toEqual(before.active.game.held);
  expect(after.active.game.dice[0]).toBe(before.active.game.dice[0]);
  expect(after.active.game.players).toEqual(before.active.game.players);
  expect(after.history).toEqual(before.history);
}
// An out delivered with the handler precedes the awaited write. Only durability is observed after that write.
const TAP = ["reroll-press-in", "reroll-handler", "reroll-decision-accepted", "reroll-write-begin", "reroll-press-out", "reroll-write-ack", "reroll-settled-success"];

test("actual Re-roll tap moves once and correlates press, handler, decision and durable write on one numeric ID", async () => {
  await open(process.env.REROLL_BASELINE === "1" ? "old" : "current", async (page) => {
    expect((await snapshot(page)).events).toEqual([]); // StrictMode effect replay adds no activation.
    await act(page, "fixture.seed(7);fixture.in(10);fixture.press();fixture.out(11)");
    await idle(page); await label(page, "Re-roll (1)");
    const state = await snapshot(page);
    expectOneRoll(state); expect(state.settled).toEqual([true]); expect(state.returned).toEqual([null]);
    // The business outcome above is reached first. Only the observation may be missing below.
    expect(phases(state)).toEqual(TAP);
    expect(ids(state)).toEqual([state.events[0].sequence]);
  });
});

const scenarios: Record<string, { bytes?: string; label?: string; run: (page: Page) => Promise<void> }> = {
  "one tap": { run: async (page) => { await act(page, "fixture.seed(7);fixture.in(10);fixture.press();fixture.out(11)"); await idle(page); } },
  "out before handler": { run: async (page) => { await act(page, "fixture.seed(7);fixture.in(10);fixture.out(11);fixture.press()"); await idle(page); } },
  "handler with host argument": { run: async (page) => { await act(page, "fixture.seed(7);fixture.press({nativeEvent:{name:'PRIVATE'}})"); await idle(page); } },
  "busy rejection of a repeated handler": { run: async (page) => {
    await act(page, "gate.mode='hold';fixture.seed(7);fixture.in(10);fixture.press();fixture.press();fixture.out(11);gate.release()"); await idle(page);
  } },
  "delayed acknowledgment": { run: async (page) => {
    await act(page, "gate.mode='hold';fixture.seed(7);fixture.press()");
    await page.waitForFunction("window.view.busy", undefined, { timeout: 3000, polling: 10 });
    await act(page, "gate.release()"); await idle(page);
  } },
  "storage failure, pending rejection and exact-byte retry": { run: async (page) => {
    await act(page, "gate.mode='fail';fixture.seed(7);fixture.press()"); await idle(page);
    await act(page, "fixture.press()"); await idle(page);
    await act(page, "gate.mode='pass';void store.retry()"); await idle(page);
  } },
  "no rolls left": { label: "Re-roll (0)", run: async (page) => { await act(page, "fixture.seed(7);fixture.press()"); await idle(page); } },
  "no data after a failed reload": { run: async (page) => {
    await act(page, "gate.readFails=true;void store.load()"); await idle(page);
    await act(page, "fixture.press()"); await idle(page);
  } },
  "a throwing diagnostic sink": { run: async (page) => { await act(page, "fixture.failSink();fixture.seed(7);fixture.in(10);fixture.press();fixture.out(11)"); await idle(page); } },
};
const business = ({ attempts, saved, moves, settled, returned, published }: Snapshot) =>
  ({ attempts, saved, moves: moves.map((move) => move.first), settled, returned, published });
for (const [name, scenario] of Object.entries(scenarios)) test(`${name}: pinned f558 Play, current and shipping keep identical bytes, publications and results`, async () => {
  const bytes = scenario.label ? seeds.exhausted : seeds.live;
  const results = {} as Record<Mode, Snapshot>;
  for (const mode of ["old", "current", "shipping"] as const) results[mode] = await open(mode, async (page) => { await scenario.run(page); return snapshot(page); }, bytes, scenario.label);
  expect(business(results.current)).toEqual(business(results.old));
  expect(business(results.shipping)).toEqual(business(results.old));
  expect(results.old.events).toEqual([]); expect(results.shipping.events).toEqual([]);
  expect(results.old.moves.every((move) => move.count === 1)).toBe(true);
  expect(results.shipping.moves.every((move) => move.observer === "undefined")).toBe(true);
});

test("a repeated handler keeps its own ID, is rejected busy, and the first request still reaches its own acknowledgment", async () => {
  await open("current", async (page) => {
    await act(page, "gate.mode='hold';fixture.seed(7);fixture.in(10);fixture.press();fixture.press();fixture.out(11)");
    const during = await snapshot(page), [first, second] = ids(during);
    expect(phases(during, first)).toEqual(["reroll-press-in", "reroll-handler", "reroll-decision-accepted", "reroll-write-begin", "reroll-press-out"]);
    expect(phases(during, second)).toEqual(["reroll-handler", "reroll-decision-busy"]);
    expect(during.attempts.length).toBe(1); expect(during.saved).toBe(seeds.live);
    await act(page, "gate.release()"); await idle(page);
    const after = await snapshot(page);
    expect(phases(after, second)).toEqual(["reroll-handler", "reroll-decision-busy"]);
    expect(phases(after, first).slice(-2)).toEqual(["reroll-write-ack", "reroll-settled-success"]);
    expectOneRoll(after, 2); expect(after.settled).toEqual([false, true]); // Two calls, one rejected, one durable move.
  });
});

test("a delayed acknowledgment preserves UI state and records durability without claiming a React commit", async () => {
  await open("current", async (page) => {
    await act(page, "gate.mode='hold';fixture.seed(7);fixture.in(10);fixture.press()");
    await page.waitForFunction("window.view.busy", undefined, { timeout: 3000, polling: 10 });
    await label(page, "Re-roll (2)");
    const during = await snapshot(page);
    expect(phases(during)).toEqual(["reroll-press-in", "reroll-handler", "reroll-decision-accepted", "reroll-write-begin"]);
    expect(during.saved).toBe(seeds.live);
    await act(page, "gate.release()"); await idle(page); await label(page, "Re-roll (1)");
    const after = await snapshot(page), commit = after.events.filter((event) => event.phase === "reroll-react-commit");
    expect(commit.length).toBe(0);
    expect(phases(after).filter((phase) => phase === "reroll-write-ack").length).toBe(1);
    // Later uncorrelated revisions never produce another record for this request.
    await act(page, "gate.mode='pass';void store.move({kind:'hold',index:2})"); await idle(page);
    expect(phases(await snapshot(page))).toEqual(phases(after));
    expect(durable((await snapshot(page)).saved).active.revision).toBe(durable(seeds.live).active.revision + 2);
  });
});

test("storage failure stays distinct from acknowledgment, and its retry adds neither ack nor commit to the request", async () => {
  await open("current", async (page) => {
    await act(page, "gate.mode='hold';fixture.seed(7);fixture.in(10);fixture.press();fixture.out(11);gate.reject()"); await idle(page);
    await label(page, "Re-roll (2)");
    const failed = await snapshot(page);
    expect(phases(failed)).toEqual(["reroll-press-in", "reroll-handler", "reroll-decision-accepted", "reroll-write-begin", "reroll-press-out", "reroll-write-failed", "reroll-operation-failed", "reroll-settled-failure"]);
    expect(failed.saved).toBe(seeds.live); expect(failed.settled).toEqual([false]);
    await act(page, "fixture.press()"); await idle(page);
    const rejected = await snapshot(page), second = ids(rejected)[1];
    expect(phases(rejected, second)).toEqual(["reroll-handler", "reroll-decision-accepted", "reroll-decision-can-retry", "reroll-decision-pending", "reroll-operation-failed", "reroll-settled-failure"]);
    expect(rejected.attempts.length).toBe(1);
    await act(page, "gate.mode='pass';void store.retry()"); await idle(page); await label(page, "Re-roll (1)");
    const retried = await snapshot(page);
    expect(retried.attempts).toEqual([failed.attempts[0], failed.attempts[0]]); expect(retried.saved).toBe(failed.attempts[0]);
    expect(retried.events).toEqual(rejected.events);
  });
});

test("no-rolls and no-data rejections report the decision reached, never a write", async () => {
  await open("current", async (page) => {
    await act(page, "fixture.press()"); await idle(page);
    const state = await snapshot(page);
    expect(phases(state)).toEqual(["reroll-handler", "reroll-decision-accepted", "reroll-operation-failed", "reroll-settled-failure"]);
    expect(state.attempts).toEqual([]); expect(state.saved).toBe(seeds.exhausted);
  }, seeds.exhausted, "Re-roll (0)");
  await open("current", async (page) => {
    await act(page, "gate.readFails=true;void store.load()"); await idle(page);
    await act(page, "fixture.press()"); await idle(page);
    const state = await snapshot(page);
    expect(phases(state)).toEqual(["reroll-handler", "reroll-decision-accepted", "reroll-decision-no-data", "reroll-operation-failed", "reroll-settled-failure"]);
    expect(state.attempts).toEqual([]); expect(state.saved).toBe(seeds.live);
  });
});

test("a cancelled press stays unhandled: no handler, decision or move is fabricated", async () => {
  await open("current", async (page) => {
    await act(page, "fixture.in(10);fixture.out(11)");
    const state = await snapshot(page);
    expect(phases(state)).toEqual(["reroll-press-in", "reroll-press-out"]);
    expect(state.moves).toEqual([]); expect(state.attempts).toEqual([]); expect(state.saved).toBe(seeds.live);
  });
});

test("disable closes an unhandled activation; a later handler and a re-enabled press never join it", async () => {
  await open("current", async (page) => {
    await act(page, "fixture.in(10);gate.mode='hold';void store.move({kind:'hold',index:1})");
    await page.waitForFunction("window.view.busy", undefined, { timeout: 3000, polling: 10 });
    await act(page, "fixture.out(11);fixture.in(12);fixture.press()"); // Delivered although the control is disabled.
    const state = await snapshot(page), [closed, unmatched] = ids(state);
    expect(phases(state, closed)).toEqual(["reroll-press-in", "reroll-observation-disabled"]);
    expect(phases(state, unmatched)).toEqual(["reroll-handler", "reroll-decision-busy"]);
    await act(page, "gate.release()"); await idle(page); await label(page, "Re-roll (2)");
    await act(page, "gate.mode='pass';fixture.seed(7);fixture.in(20);fixture.press();fixture.out(21)"); await idle(page);
    const after = await snapshot(page), fresh = ids(after)[2];
    expect(fresh).not.toBe(closed);
    expect(phases(after, fresh)).toEqual(TAP);
    expect(after.moves.filter((move) => move.first === '{"kind":"roll"}').length).toBe(2); // One rejected busy, one original.
    expect(durable(after.saved).active.game.rollsLeft).toBe(1);
  });
});

test("unmount closes an unhandled activation and leaves its late out unattributed", async () => {
  await open("current", async (page) => {
    await act(page, "fixture.in(10)");
    await act(page, "window.setShown(false)");
    await act(page, "fixture.out(11);fixture.press()");
    await idle(page);
    const state = await snapshot(page), [closed, unmatched] = ids(state);
    expect(phases(state, closed)).toEqual(["reroll-press-in", "reroll-observation-detached"]);
    expect(phases(state, unmatched)).toEqual(["reroll-handler", "reroll-decision-accepted", "reroll-write-begin", "reroll-write-ack", "reroll-settled-success"]);
    expectOneRoll(state);
  });
});

for (const how of ["Play unmount", "root unmount"]) test(`${how} during a delayed write keeps the durable result and its acknowledgment, and claims no commit`, async () => {
  await open("current", async (page) => {
    await act(page, `gate.mode='hold';fixture.seed(7);fixture.in(10);fixture.press();${how === "Play unmount" ? "window.setShown(false)" : "fixture.unmount()"}`);
    await act(page, "gate.release()");
    await page.waitForFunction("window.store.getSnapshot().busy === false", undefined, { timeout: 3000, polling: 10 });
    await act(page, "fixture.out(11)"); // Its own late out remains its own.
    if (how === "Play unmount") { await act(page, "window.setShown(true)"); await label(page, "Re-roll (1)"); }
    const state = await snapshot(page);
    expect(phases(state)).toEqual(["reroll-press-in", "reroll-handler", "reroll-decision-accepted", "reroll-write-begin", "reroll-write-ack", "reroll-settled-success", "reroll-press-out"]);
    expect(ids(state).length).toBe(1);
    expectOneRoll(state);
  });
});

test("supersession closes the older activation and rejects its delayed out", async () => {
  await open("current", async (page) => {
    await act(page, "fixture.seed(7);fixture.in(10);fixture.in(20);fixture.out(11);fixture.press();fixture.out(21)"); await idle(page);
    const state = await snapshot(page), [older, newer] = ids(state);
    expect(phases(state, older)).toEqual(["reroll-press-in", "reroll-observation-superseded"]);
    expect(phases(state, newer)).toEqual(TAP);
    expectOneRoll(state);
  });
});

test("an unmatched handler gets its own ID without press evidence; an absent or invalid event time establishes no out", async () => {
  await open("current", async (page) => {
    await act(page, "fixture.seed(7);fixture.press();fixture.out(11)"); await idle(page);
    const state = await snapshot(page);
    expect(phases(state)).toEqual(["reroll-handler", "reroll-decision-accepted", "reroll-write-begin", "reroll-write-ack", "reroll-settled-success"]);
  });
  await open("current", async (page) => {
    await act(page, "fixture.in(10);fixture.out();fixture.out(5);fixture.out(Number.NaN)");
    expect(phases(await snapshot(page))).toEqual(["reroll-press-in"]);
  });
});

test("at the shared 8192-record cap Re-roll stops recording but its original move still runs once", async () => {
  await open("current", async (page) => {
    await act(page, "for(let i=0;i<9000;i++)fixture.in(i)"); // Each superseding press adds two records.
    const before = await snapshot(page);
    expect(before.records.length).toBe(8192);
    await act(page, "fixture.seed(7);fixture.in(1e6);fixture.press();fixture.out(1e6+1)"); await idle(page); await label(page, "Re-roll (1)");
    const state = await snapshot(page);
    expect(state.records.length).toBe(8192);
    expectOneRoll(state); expect(state.settled).toEqual([true]);
  });
});

test("a real browser click reaches the same observation and one move", async () => {
  await open("current", async (page) => {
    await act(page, "fixture.seed(7)");
    await page.getByTestId("reroll-action").click({ timeout: 3000 });
    await idle(page); await label(page, "Re-roll (1)");
    const state = await snapshot(page);
    expectOneRoll(state);
    expect(ids(state).length).toBe(1);
    for (const phase of TAP) expect(phases(state)).toContain(phase); // RNW's own in/out/handler order is not asserted.
    expect(phases(state)[0]).toBe("reroll-press-in");
  });
});

test("only fixed fields leave the page: no name, game ID, dice, error text or event payload", async () => {
  await open("current", async (page) => {
    await act(page, "fixture.seed(7);fixture.in(10);fixture.press({nativeEvent:{name:'PRIVATE'}});fixture.out(11)"); await idle(page);
    await act(page, "gate.mode='fail';void store.move({kind:'hold',index:1})"); await idle(page);
    await act(page, "fixture.press()"); await idle(page);
    const state = await snapshot(page);
    expect(state.events.length).toBeGreaterThan(8);
    for (const event of state.events) expect(Object.keys(event).sort()).toEqual(["atMs", "monotonicMs", "phase", "rerollId", "sequence"]);
    expect(JSON.stringify(state.records)).not.toMatch(/PRIVATE|error|dice|held|revision|rollsLeft|label/i);
  });
});

test("qualification adds only the existing press props to Re-roll; shipping and other controls keep f558 capability", async () => {
  const props = async (mode: Mode) => open(mode, async (page) => page.evaluate<Record<string, unknown>>(`({ keys: fixture.keys('reroll-action'), pauseKeys: fixture.keys('Pause Game'),
    in: fixture.absent('reroll-action','onPressIn'), out: fixture.absent('reroll-action','onPressOut'),
    pauseIn: fixture.absent('Pause Game','onPressIn'), pauseOut: fixture.absent('Pause Game','onPressOut'),
    touch: ['onTouchStart','onTouchEnd','onTouchCancel'].some((key) => fixture.keys('reroll-action').includes(key)) })`));
  const [old, current, shipping] = [await props("old"), await props("current"), await props("shipping")];
  expect(shipping).toEqual(old); expect(old.in).toBe(true); expect(old.out).toBe(true);
  expect(current).toEqual({ ...old, in: false, out: false });
  expect(current.touch).toBe(false); expect(current.pauseIn).toBe(true); expect(current.pauseOut).toBe(true);
});

test("the historical control is the exact f558 Play, without history, on LF or CRLF checkouts", async () => {
  const text = await Bun.file(baselinePath).text(), lf = text.replace(/\r\n/g, "\n");
  expect(baselineSource(lf)).toBe(lf);
  expect(baselineSource(lf.replace(/\n/g, "\r\n"))).toBe(lf);
  expect(() => baselineSource(lf + "\n")).toThrow("Pinned Re-roll baseline fixture changed");
  expect(() => baselineSource(lf.replace('kind: "roll"', 'kind: "hold"'))).toThrow("Pinned Re-roll baseline fixture changed");
  expect(lf).toContain('onPress={() => { void store.move({ kind: "roll" }); }}');
});
