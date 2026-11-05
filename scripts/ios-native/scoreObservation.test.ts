import { afterAll, beforeAll, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { createLocalStore } from "../../apps/mobile/src/local/store";
import { SAVE_KEY } from "../../apps/mobile/src/local/save";

// Actual NativeScorecard, ScoreRow, react-native-web Pressable, LocalProvider and
// store, with controlled persistence. Adapter touch events only supply React
// Native's documented payload shape. None of this is native or UIKit proof.
const root = resolve(import.meta.dir, "../..");
const BASELINE_SHA256 = "097aa991ee74f6be551fe86e04d0cfed9221e48c92dd674f2fae961e19cb639c";
const baselinePath = resolve(import.meta.dir, "fixtures/score-boundary-baseline-329.tsx.fixture");
const baselineSource = (text: string) => {
  const contents = text.replace(/\r\n/g, "\n");
  if (createHash("sha256").update(contents).digest("hex") !== BASELINE_SHA256) throw new Error("Pinned score boundary baseline fixture changed");
  return contents;
};

type Mode = "current" | "old" | "shipping";
type TraceRecord = { phase: string; sequence: number; scoreId?: number };
type Snapshot = { records: TraceRecord[]; attempts: string[]; saved: string | null;
  moves: { first: string; count: number; observer: string }[]; settled: boolean[]; returned: unknown[]; published: unknown[] };

const entry = `
import React, { StrictMode, useEffect, useLayoutEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { NativeScorecard } from './apps/mobile/src/screens/NativeScorecard';
import { LocalProvider, useLocalGame } from './apps/mobile/src/local/LocalProvider';
const values = new Map(); const attempts = []; const moves = []; const settled = []; const returned = []; const published = [];
window.records = []; window.pressables = {};
console.info = (line) => { if (String(line).startsWith('THIRD_ROLL_INPUT ')) window.records.push(JSON.parse(String(line).slice(17))); };
const gate = window.gate = { mode: 'pass', release() {}, reject() {} };
window.controlledStorage = {
  async getItem(key) { return values.get(key) ?? null; },
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
const summary = (view) => ({ busy: view.busy, canRetry: view.canRetry, error: view.error, generation: view.generation,
  revision: view.data?.active?.revision, rollsLeft: view.data?.active?.game.rollsLeft, held: view.data?.active?.game.held,
  dice: view.data?.active?.game.dice, scores: view.data?.active?.game.players[0].scores });
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
  return shown && view.data?.active ? <NativeScorecard /> : <div>No active game</div>;
}
let app;
const row = (id) => document.querySelector('[data-testid="' + id + '"]');
const hostile = () => new Proxy({}, { get() { throw new Error('PRIVATE payload'); } });
window.touchEndSeen = [];
document.addEventListener('touchend', (event) => { window.touchEndSeen.push(event.defaultPrevented); });
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
  // Adapter events carry RN's documented NativeTouchEvent shape. They are fixtures, never native evidence.
  dispatch(type, id, changed, active = []) {
    const target = row(id);
    const shape = (touch) => ({ force: 0, target, clientX: 8, clientY: 8, pageX: 8, pageY: 8, ...touch });
    const event = new Event(type, { bubbles: true, cancelable: true, composed: true });
    Object.defineProperties(event, {
      changedTouches: { value: changed.map(shape) }, touches: { value: active.map(shape) }, targetTouches: { value: active.map(shape) },
      timeStamp: { value: changed[0].timestamp }, timestamp: { value: changed[0].timestamp }, identifier: { value: changed[0].identifier },
    });
    target.dispatchEvent(event);
  },
  click(id) { row(id).click(); },
  // Direct host callback delivery, as a native host could still deliver it.
  press(id, ...args) { returned.push(window.pressables[id].onPress(...args) ?? null); },
  in(id, nativeEvent) { window.pressables[id].onPressIn({ nativeEvent }); },
  out(id) { window.pressables[id].onPressOut({ nativeEvent: {} }); },
  retained(hook, id, nativeEvent) {
    const callback = window.pressables[id][hook];
    if (!callback) return { absent: true };
    try { return { threw: false, returned: callback({ nativeEvent }) === undefined }; } catch { return { threw: true }; }
  },
  hostile(id) {
    const props = window.pressables[id];
    for (const hook of ['onPressIn', 'onTouchStart', 'onTouchEnd', 'onTouchCancel', 'onPressOut']) props[hook]?.(hostile());
    props.onPressIn?.({ nativeEvent: hostile() }); props.onTouchEnd?.({ nativeEvent: hostile() });
  },
  flood(id, count) { const props = window.pressables[id]; for (let i = 0; i < count; i++) { props.onPressIn({ nativeEvent: { timestamp: i } }); props.onPressOut({ nativeEvent: {} }); } },
  unmount() { flushSync(() => app.unmount()); },
  failSink() { console.info = () => { throw new Error('PRIVATE sink failure'); }; },
  catalog() {
    return Object.fromEntries(Object.entries(window.pressables).map(([id, props]) => [id, {
      keys: Object.keys(props).sort(),
      values: Object.fromEntries(Object.entries(props).filter(([, value]) => ['string', 'boolean', 'number'].includes(typeof value))),
    }]));
  },
  snapshot() {
    return { records: window.records, attempts, saved: values.get('${SAVE_KEY}') ?? null, moves, settled, returned, published };
  },
};`;

let browser: Browser, seed: string;
const scripts = {} as { [mode in Mode]: string };

async function seedBytes() {
  const values = new Map<string, string>();
  const store = createLocalStore({
    async getItem(key) { return values.get(key) ?? null; },
    async setItem(key, value) { values.set(key, value); },
    async removeItem(key) { values.delete(key); },
  }, () => "PRIVATE-GAME-ID");
  await store.load();
  await store.start({ name: "PRIVATE PLAYER", diceCount: 5, aiOpponents: 0 });
  return values.get(SAVE_KEY)!;
}

beforeAll(async () => {
  seed = await seedBytes();
  for (const mode of ["current", "old", "shipping"] as const) {
    const result = await Bun.build({ entrypoints: ["score-fixture"], target: "browser", format: "iife",
      define: { process: "{}", "process.env.NODE_ENV": '"development"', __DEV__: "true", "process.env.EXPO_PUBLIC_NATIVE_INPUT_TRACE": JSON.stringify(mode === "shipping" ? "0" : "1") },
      plugins: [{ name: "actual-score-lifecycle", setup(build) {
        build.onResolve({ filter: /^score-fixture$/ }, () => ({ path: "entry", namespace: "score" }));
        build.onLoad({ filter: /.*/, namespace: "score" }, () => ({ contents: entry, loader: "tsx", resolveDir: root }));
        build.onResolve({ filter: /^react-native$/ }, () => ({ path: "host", namespace: "host" }));
        // Records each Pressable's real props, then renders the real react-native-web one.
        // The host counts its own press callbacks and calls straight through, identically
        // in every mode, so waits never depend on the trace being enabled.
        build.onLoad({ filter: /.*/, namespace: "host" }, () => ({ loader: "tsx", resolveDir: root, contents: `
          import React, { forwardRef, useLayoutEffect } from 'react';
          import { Pressable as Host } from 'react-native-web';
          export * from 'react-native-web';
          window.hostCalls = { in: 0, out: 0 };
          export const Pressable = forwardRef((props, ref) => {
            useLayoutEffect(() => { window.pressables[props.testID ?? props.accessibilityLabel] = props; });
            const onPressIn = props.onPressIn && ((event) => { window.hostCalls.in++; return props.onPressIn(event); });
            const onPressOut = props.onPressOut && ((event) => { window.hostCalls.out++; return props.onPressOut(event); });
            return <Host {...props} onPressIn={onPressIn} onPressOut={onPressOut} ref={ref} />;
          });` }));
        build.onResolve({ filter: /^react-native-safe-area-context$/ }, () => ({ path: resolve(root, "tests/clients/native-safe-area.tsx") }));
        build.onLoad({ filter: /platformStorage\.ts$/ }, () => ({ loader: "ts", contents: "export function createPlatformStorage(){return window.controlledStorage;}" }));
        if (mode === "old") build.onLoad({ filter: /[\\/]screens[\\/]NativeScorecard\.tsx$/ }, async () => ({
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

const FULL = "score-full-house", ONES = "score-ones";
async function open<T>(mode: Mode, body: (page: Page) => Promise<T>) {
  const page = await browser.newPage();
  try {
    await page.setContent('<div id="root"></div>'); await page.addScriptTag({ content: scripts[mode] });
    await page.evaluate(`window.fixture.mount(${JSON.stringify(seed)})`);
    await page.locator(`[data-testid="${FULL}"]`).waitFor({ timeout: 3000 });
    return await body(page);
  } finally { await page.close(); }
}
const act = (page: Page, code: string) => page.evaluate(`(()=>{${code};})()`);
const snapshot = (page: Page) => page.evaluate<Snapshot>("fixture.snapshot()");
/** Every synchronous publication has committed and no store operation is running. */
const idle = (page: Page) => page.waitForFunction("window.view === window.store.getSnapshot() && !window.view.busy", undefined, { timeout: 3000, polling: 10 });
const busy = (page: Page) => page.waitForFunction("window.view.busy", undefined, { timeout: 3000, polling: 10 });
const recorded = (page: Page, id = FULL) => page.waitForFunction(`(document.querySelector('[data-testid="${id}"]')?.getAttribute('aria-label') ?? '').includes('points recorded')`, undefined, { timeout: 3000, polling: 10 });
type Touch = { identifier: number; timestamp: number };
const point = (identifier: number, timestamp: number): Touch => ({ identifier, timestamp });
const dispatch = (page: Page, type: string, id: string, changed: Touch[], active: Touch[] = []) =>
  act(page, `fixture.dispatch(${JSON.stringify(type)}, ${JSON.stringify(id)}, ${JSON.stringify(changed)}, ${JSON.stringify(active)})`);
const count = (page: Page, phase: string, n = 1) => page.waitForFunction(({ phase, n }) =>
  (window as unknown as { records: TraceRecord[] }).records.filter((record) => record.phase === phase).length >= n, { phase, n }, { timeout: 3000, polling: 10 });
const host = (page: Page, kind: "in" | "out", n = 1) => page.waitForFunction(({ kind, n }) =>
  (window as unknown as { hostCalls: { in: number; out: number } }).hostCalls[kind] >= n, { kind, n }, { timeout: 3000, polling: 10 });
async function touchDown(page: Page, id: string, touch: Touch, n = 1) { await dispatch(page, "touchstart", id, [touch], [touch]); await host(page, "in", n); }
async function touchUp(page: Page, type: "touchend" | "touchcancel", id: string, touch: Touch, n = 1) { await dispatch(page, type, id, [touch]); await host(page, "out", n); }
const retained = (page: Page, hook: string, id: string, nativeEvent: unknown) =>
  page.evaluate<{ threw?: boolean; returned?: boolean; absent?: boolean }>(`fixture.retained(${JSON.stringify(hook)}, ${JSON.stringify(id)}, ${JSON.stringify(nativeEvent)})`);
const payload = (...changed: Touch[]) => ({ changedTouches: changed, identifier: changed[0].identifier, timestamp: changed[0].timestamp });

const OLD = ["score-press-in", "score-press-out", "score-handler", "score-ack", "score-rejected"];
const score = (state: Snapshot) => state.records.filter((record) => record.phase.startsWith("score-"));
const phases = (state: Snapshot) => score(state).map((record) => record.phase);
const added = (state: Snapshot) => score(state).filter((record) => !OLD.includes(record.phase)).map((record) => [record.phase, record.scoreId]);
const pressIns = (state: Snapshot) => score(state).filter((record) => record.phase === "score-press-in").map((record) => record.sequence);
const durable = (bytes: string | null) => JSON.parse(bytes!) as { active: { revision: number; game: { rollsLeft: number; held: number[]; dice: number[]; currentRound: number; players: { scores: { [id: string]: number } }[] } }; history: { entries: unknown[] } };

function expectOneScore(state: Snapshot, calls = 1) {
  const before = durable(seed), after = durable(state.saved);
  expect(state.moves.filter((move) => move.first === '{"kind":"score","category":"full-house"}').length).toBe(calls);
  expect(state.moves.every((move) => move.count === 1 && move.observer === "undefined")).toBe(true);
  expect(state.attempts.length).toBe(1); expect(state.saved).toBe(state.attempts[0]);
  expect(after.active.revision).toBe(before.active.revision + 1);
  expect(Object.keys(after.active.game.players[0].scores)).toEqual(["full-house"]);
  expect(before.active.game.players[0].scores).toEqual({});
  expect(after.history).toEqual(before.history);
}

test("actual Full House touch tap scores once, and the delivered touch end names its unchanged press-in record", async () => {
  await open(process.env.SCORE_BOUNDARY_BASELINE === "1" ? "old" : "current", async (page) => {
    expect(phases(await snapshot(page))).toEqual([]); // StrictMode effect replay adds no activation or record.
    await act(page, "fixture.seed(7)");
    await touchDown(page, FULL, point(1, 1000));
    await touchUp(page, "touchend", FULL, point(1, 1100));
    await act(page, `fixture.click(${JSON.stringify(FULL)})`);
    await idle(page); await recorded(page);
    const state = await snapshot(page);
    expectOneScore(state); expect(state.settled).toEqual([true]);
    expect(score(state).filter((record) => OLD.includes(record.phase)).map((record) => record.phase))
      .toEqual(["score-press-in", "score-press-out", "score-handler", "score-ack"]);
    // The durable score above is reached first. Only the new observation may be missing below.
    expect(phases(state)).toEqual(["score-press-in", "score-touch-end", "score-press-out", "score-handler", "score-ack"]);
    expect(added(state)).toEqual([["score-touch-end", pressIns(state)[0]]]);
  });
});

const scenarios: { [name: string]: (page: Page) => Promise<void> } = {
  "one touch tap": async (page) => {
    await act(page, "fixture.seed(7)"); await touchDown(page, FULL, point(1, 1000));
    await touchUp(page, "touchend", FULL, point(1, 1100));
    await act(page, `fixture.click("${FULL}")`); await idle(page); await recorded(page);
  },
  "cancelled touch on one row, then a tap on another": async (page) => {
    await act(page, "fixture.seed(7)"); await touchDown(page, ONES, point(1, 1000));
    await touchUp(page, "touchcancel", ONES, point(1, 1100));
    await touchDown(page, FULL, point(1, 2000), 2); await touchUp(page, "touchend", FULL, point(1, 2100), 2);
    await act(page, `fixture.click("${FULL}")`); await idle(page); await recorded(page);
  },
  "direct handler with a host argument": async (page) => { await act(page, `fixture.seed(7);fixture.press("${FULL}",{nativeEvent:{name:'PRIVATE'}})`); await idle(page); await recorded(page); },
  "busy rejection of a repeated handler": async (page) => {
    await act(page, `gate.mode='hold';fixture.seed(7);fixture.in("${FULL}",{timestamp:10});fixture.press("${FULL}");fixture.press("${FULL}");fixture.out("${FULL}")`);
    await busy(page); await act(page, "gate.release()"); await idle(page); await recorded(page);
  },
  "a pending write disables rows while another row's handler is delivered": async (page) => {
    await act(page, `gate.mode='hold';fixture.seed(7)`); await touchDown(page, ONES, point(2, 900));
    await act(page, `fixture.press("${FULL}")`); await busy(page);
    await dispatch(page, "touchend", ONES, [point(2, 1000)]);
    await act(page, `fixture.press("${ONES}")`); await act(page, "gate.release()"); await idle(page); await recorded(page);
  },
  "storage failure, pending rejection and exact-byte retry": async (page) => {
    await act(page, `gate.mode='fail';fixture.seed(7);fixture.press("${FULL}")`); await idle(page);
    await act(page, `fixture.press("${FULL}")`); await idle(page);
    await act(page, "gate.mode='pass';void store.retry()"); await idle(page); await recorded(page);
  },
  "a throwing diagnostic sink": async (page) => {
    await act(page, "fixture.failSink();fixture.seed(7)"); await touchDown(page, FULL, point(1, 1000));
    await touchUp(page, "touchcancel", FULL, point(1, 1100)); await act(page, `fixture.click("${FULL}")`); await idle(page); await recorded(page);
  },
  "hostile payload getters": async (page) => { await act(page, `fixture.seed(7);fixture.hostile("${FULL}");fixture.press("${FULL}")`); await idle(page); await recorded(page); },
  "unmount and remount during a delayed write": async (page) => {
    await act(page, `gate.mode='hold';fixture.seed(7)`); await touchDown(page, FULL, point(1, 1000));
    await touchUp(page, "touchend", FULL, point(1, 1100));
    await act(page, `fixture.click("${FULL}")`); await busy(page); await act(page, "window.setShown(false)");
    await act(page, "gate.release()"); await idle(page); await act(page, "window.setShown(true)"); await recorded(page);
  },
  "the shared 8192-record cap": async (page) => { await act(page, `fixture.flood("${ONES}", 5000);fixture.seed(7);fixture.press("${FULL}")`); await idle(page); await recorded(page); },
};
const business = ({ attempts, saved, moves, settled, returned, published }: Snapshot) => ({ attempts, saved, moves, settled, returned, published });
const oldRecords = (state: Snapshot) => state.records.filter((record) => OLD.includes(record.phase)).map((record) => [record.phase, Object.keys(record).sort().join()]);
for (const [name, run] of Object.entries(scenarios)) test(`${name}: pinned 329 scorecard, current and shipping keep identical bytes, moves, publications and old score records`, async () => {
  const results = {} as { [mode in Mode]: Snapshot };
  for (const mode of ["old", "current", "shipping"] as const) results[mode] = await open(mode, async (page) => { await run(page); return snapshot(page); });
  expect(business(results.current)).toEqual(business(results.old));
  expect(business(results.shipping)).toEqual(business(results.old));
  // Added records take sequence numbers and share the lifetime cap. Below the cap,
  // the old score records keep their phases, order and schema; at the cap both stop at 8192.
  if (name === "the shared 8192-record cap") for (const mode of ["old", "current"] as const) expect(results[mode].records.length).toBe(8192);
  else expect(oldRecords(results.current)).toEqual(oldRecords(results.old));
  expect(added(results.old)).toEqual([]); expect(results.shipping.records).toEqual([]);
  expect(results.old.moves.every((move) => move.count === 1)).toBe(true);
});

test("a delivered touch cancel invents no handler, move or write; a reused identifier gets a new ID; a late old cancel is not borrowed", async () => {
  await open("current", async (page) => {
    await touchDown(page, FULL, point(1, 1000));
    await touchUp(page, "touchcancel", FULL, point(1, 1100));
    const cancelled = await snapshot(page);
    expect(phases(cancelled)).toEqual(["score-press-in", "score-touch-cancel", "score-press-out"]);
    expect(cancelled.moves).toEqual([]); expect(cancelled.attempts).toEqual([]); expect(cancelled.saved).toBe(seed);
    await act(page, "fixture.seed(7)"); await touchDown(page, FULL, point(1, 2000), 2);
    expect((await retained(page, "onTouchCancel", FULL, payload(point(1, 1100)))).threw).toBe(false);
    await touchUp(page, "touchend", FULL, point(1, 2100), 2);
    await act(page, `fixture.click("${FULL}")`); await idle(page); await recorded(page);
    const state = await snapshot(page), [first, second] = pressIns(state);
    expect(added(state)).toEqual([["score-touch-cancel", first], ["score-observation-superseded", first], ["score-touch-end", second]]);
    expectOneScore(state);
  });
});

test("a handled row keeps its own late boundary after the pending write disables it; another row's unhandled activation closes disabled", async () => {
  await open("current", async (page) => {
    await act(page, "gate.mode='hold';fixture.seed(7)");
    // A second finger's activation on another row, delivered directly as a host could.
    await act(page, `fixture.in("${ONES}", ${JSON.stringify(payload(point(2, 900)))})`);
    await touchDown(page, FULL, point(1, 1000)); // Direct delivery above bypasses the host's counter.
    await act(page, `fixture.press("${FULL}")`); await busy(page);
    await count(page, "score-observation-disabled");
    expect(await retained(page, "onTouchEnd", ONES, payload(point(2, 1050)))).toEqual({ threw: false, returned: true });
    expect(await retained(page, "onTouchEnd", FULL, payload(point(1, 1100)))).toEqual({ threw: false, returned: true });
    await count(page, "score-touch-end");
    await act(page, "gate.release()"); await idle(page); await recorded(page);
    const state = await snapshot(page), [ones, full] = pressIns(state);
    expect(added(state)).toEqual([["score-observation-disabled", ones], ["score-touch-end", full]]);
    expectOneScore(state); expect(phases(state).filter((phase) => phase === "score-ack")).toHaveLength(1);
  });
});

test("unmount closes an unhandled activation as detached; remount and StrictMode replay add no record, and a late boundary stays UNKNOWN", async () => {
  await open("current", async (page) => {
    await touchDown(page, FULL, point(1, 1000));
    await act(page, "window.setShown(false)");
    expect(await retained(page, "onTouchEnd", FULL, payload(point(1, 1100)))).toEqual({ threw: false, returned: true });
    await act(page, "window.setShown(true)"); await page.locator(`[data-testid="${FULL}"]`).waitFor({ timeout: 3000 });
    await dispatch(page, "touchend", FULL, [point(1, 1200)]);
    const state = await snapshot(page);
    expect(added(state)).toEqual([["score-observation-detached", pressIns(state)[0]]]);
    expect(state.moves).toEqual([]); expect(state.saved).toBe(seed);
  });
});

test("an unmatched handler gets no ID, press or native evidence; multitouch and malformed payloads stay UNKNOWN without throwing", async () => {
  await open("current", async (page) => {
    await act(page, `fixture.seed(7);fixture.press("${FULL}")`); await idle(page); await recorded(page);
    await dispatch(page, "touchend", FULL, [point(1, 1100)]);
    const unmatched = await snapshot(page);
    expect(phases(unmatched)).toEqual(["score-handler", "score-ack"]); expectOneScore(unmatched);
  });
  await open("current", async (page) => {
    const both = [point(1, 1000), point(2, 1000)];
    await dispatch(page, "touchstart", ONES, both, both); await count(page, "score-press-in");
    await dispatch(page, "touchend", ONES, [point(1, 1100), point(2, 1100)]); await count(page, "score-press-out");
    for (const event of [null, {}, { changedTouches: "PRIVATE" }, { changedTouches: [{ identifier: "1", timestamp: 1 }] }, { changedTouches: [{ identifier: 1, timestamp: 2000 }, { identifier: 1, timestamp: 2001 }] }]) {
      expect(await retained(page, "onTouchCancel", ONES, event)).toEqual({ threw: false, returned: true });
    }
    await act(page, `fixture.hostile("${ONES}")`); // Its press-ins still supersede; no boundary can bind.
    expect(phases(await snapshot(page)).filter((phase) => phase.startsWith("score-touch-"))).toEqual([]);
    expect((await snapshot(page)).moves).toEqual([]);
  });
});

test("only fixed fields leave the page: no name, game ID, category, points, native identifier or time", async () => {
  await open("current", async (page) => {
    // react-native-web reduces identifiers above 20 on its responder path only, so these stay small here.
    await touchDown(page, ONES, point(7, 123456)); await touchUp(page, "touchcancel", ONES, point(7, 123999));
    await act(page, "fixture.seed(7)"); await touchDown(page, FULL, point(7, 223456), 2);
    await touchUp(page, "touchend", FULL, point(7, 223999), 2); await act(page, `fixture.click("${FULL}")`); await idle(page); await recorded(page);
    const state = await snapshot(page);
    expect(added(state).length).toBeGreaterThanOrEqual(2);
    for (const record of score(state)) expect(Object.keys(record).sort()).toEqual(OLD.includes(record.phase) ? ["atMs", "monotonicMs", "phase", "sequence"] : ["atMs", "monotonicMs", "phase", "scoreId", "sequence"]);
    expect(JSON.stringify(state.records)).not.toMatch(/PRIVATE|123456|123999|223456|223999|full|ones|points|identifier|timestamp|label/i);
  });
});

test("a real browser click scores once with no touch payload, so no boundary is recorded", async () => {
  await open("current", async (page) => {
    await act(page, "fixture.seed(7)");
    await page.locator(`[data-testid="${FULL}"]`).click({ timeout: 3000 });
    await idle(page); await recorded(page);
    const state = await snapshot(page);
    expectOneScore(state);
    for (const phase of ["score-press-in", "score-handler", "score-ack"]) expect(phases(state)).toContain(phase); // RNW's own order is not asserted.
    expect(added(state)).toEqual([]);
  });
});

test("qualification adds only the three passive touch props to every score row; shipping keeps the pinned 329 props", async () => {
  const catalog = (mode: Mode) => open(mode, (page) => page.evaluate<{ [id: string]: { keys: string[]; values: unknown } }>("fixture.catalog()"));
  const [old, current, shipping] = [await catalog("old"), await catalog("current"), await catalog("shipping")];
  expect(Object.keys(old).length).toBeGreaterThan(10);
  expect(shipping).toEqual(old);
  expect(Object.keys(current)).toEqual(Object.keys(old));
  for (const [id, entry] of Object.entries(old)) {
    expect(current[id].keys).toEqual([...entry.keys, "onTouchCancel", "onTouchEnd", "onTouchStart"].sort());
    expect(current[id].values).toEqual(entry.values);
    expect(entry.keys).toContain("onPressIn"); expect(entry.keys).toContain("onPressOut"); expect(entry.keys).toContain("onPress");
    expect(current[id].keys.filter((key) => /^onResponder|^onStartShould|^onMoveShould|cancelable|pressRetentionOffset|unstable_pressDelay|hitSlop|delayLongPress/.test(key))).toEqual([]);
  }
});

test("the historical control is the exact 329 NativeScorecard, without history, on LF or CRLF checkouts", async () => {
  const text = await Bun.file(baselinePath).text(), lf = text.replace(/\r\n/g, "\n");
  expect(baselineSource(lf)).toBe(lf);
  expect(baselineSource(lf.replace(/\n/g, "\r\n"))).toBe(lf);
  expect(() => baselineSource(lf + "\n")).toThrow("Pinned score boundary baseline fixture changed");
  expect(() => baselineSource(lf.replace('"score-handler"', '"score-ack"'))).toThrow("Pinned score boundary baseline fixture changed");
  expect(lf).toContain('onPressIn={() => inputTrace.emit("score-press-in")}');
  expect(lf).not.toMatch(/onTouch|scorePressObservation/);
  const current = await Bun.file(resolve(root, "apps/mobile/src/screens/NativeScorecard.tsx")).text();
  expect(current).not.toMatch(/onResponder|onStartShould|onMoveShould|pressRetentionOffset|unstable_pressDelay|cancelable|preventDefault|stopPropagation/);
  // The original emits and store call are kept verbatim.
  for (const line of ['inputTrace.emit("score-handler");', 'void store.move({ kind: "score", category: category.id }).then((saved) => inputTrace.emit(saved ? "score-ack" : "score-rejected"));',
    'onPressOut={() => inputTrace.emit("score-press-out")}']) { expect(lf).toContain(line); expect(current).toContain(line); }
});
