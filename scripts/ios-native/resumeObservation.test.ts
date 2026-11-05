import { afterAll, beforeAll, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { chromium, type Browser, type Page } from "playwright";

// Real React DOM commits of NativeGameScreen + Setup + Action. Only the store,
// native host adapter and destination screens are substituted. No device proof.
const root = resolve(import.meta.dir, "../..");
const require = createRequire(import.meta.url);
let browser: Browser, script: string, shippingScript: string;
let touchScript: string, touchShippingScript: string, baselineScript: string, baselineShippingScript: string;
const BASELINE_SHA256 = "58ca3dc7c4d1e494ab199e6142c102b5bcd17ceac229d359d056330523e7ca24";
// RESUME_BOUNDARY_BASELINE=1 runs the boundary regressions against the pinned 2453 Action.
const boundarySource = () => process.env.RESUME_BOUNDARY_BASELINE === "1" ? baselineScript : touchScript;
const entry = `
import React, { StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { NativeGameScreen } from './apps/mobile/src/screens/NativeGameScreen';
import { Provider, view, destination, initialize, finish, storageGate, discardState, reload, lockResume } from 'resume-store';
class Boundary extends React.Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <div>Render failed</div> : this.props.children; }
}
let app;
window.traceRecords = [];
const traceLog = console.info;
console.info = (line) => {
  if (line.startsWith('THIRD_ROLL_INPUT ')) window.traceRecords.push(JSON.parse(line.slice(17)));
  traceLog(line);
};
window.fixture = {
  async mount(mode = 'play', locked = false) {
    if (mode === 'store' || mode === 'finished-store') await initialize(mode === 'finished-store');
    view.busy = locked; destination.mode = mode.includes('store') ? 'play' : mode;
    app = createRoot(document.getElementById('root'));
    flushSync(() => app.render(<StrictMode><Boundary><Suspense fallback={<div>Suspended</div>}>
      <Provider><NativeGameScreen onHistory={() => {}} onHelp={() => {}} /></Provider>
    </Suspense></Boundary></StrictMode>));
  },
  unmount() { flushSync(() => app.unmount()); },
  failSink() { console.info = () => { throw new Error('private sink failure'); }; },
  release() { destination.mode = 'play'; destination.release(); },
  finish,
  holdDiscard() { storageGate.hold = true; },
  releaseDiscard() { storageGate.release(); },
  rejectDiscard() { storageGate.reject(new Error('private write failure')); },
  loadOnResume() {
    const log = console.info;
    console.info = (line) => {
      log(line);
      if (line.includes('"phase":"resume-handler"')) {
        console.info = log; storageGate.holdRead = true; void reload();
      }
    };
  },
  releaseRead() { storageGate.releaseRead(); },
  lockResume,
  discardState() { return discardState; }
};
`;
const store = `
import React, { createContext, useContext, useSyncExternalStore } from 'react';
import { flushSync } from 'react-dom';
import { createLocalStore } from './apps/mobile/src/local/store';
import { getCategories } from './packages/game-engine/src/scoring';
export const destination = { mode: 'play', release() {} };
export const pending = new Promise(resolve => { destination.release = resolve; });
export const view = { busy: false, canRetry: false, generation: 0, data: {
  preferences: { name: 'PRIVATE PLAYER', appearance: 'system', recentNames: [] },
  active: { game: { id: 'PRIVATE GAME', status: 'playing', diceCount: 8,
    currentRound: 1, totalRounds: 20, players: [{ name: 'PRIVATE PLAYER' }] } }
} };
export const storageGate = { hold: false, holdRead: false, release() {}, reject(_error) {}, releaseRead() {} };
export const discardState = { pending: false, result: null, publications: [] };
let realStore, bytes;
export const reload = () => realStore.load();
export function lockResume() { storageGate.hold = true; void realStore.preferences({ appearance: 'dark' }); }
export async function finish() {
  for (const category of getCategories(8)) await realStore.move({ kind: 'score', category: category.id });
}
export async function initialize(finished) {
  realStore = createLocalStore({
    async getItem() {
      if (storageGate.holdRead) await new Promise(resolve => {
        storageGate.releaseRead = () => { storageGate.holdRead = false; resolve(); };
      });
      return bytes ?? null;
    },
    async setItem(_key, value) {
      if (storageGate.hold) await new Promise((resolve, reject) => {
        storageGate.release = () => { storageGate.hold = false; resolve(); };
        storageGate.reject = reject;
      });
      bytes = value;
    },
    async removeItem() {}
  });
  await realStore.load();
  await realStore.start({ name: 'PRIVATE PLAYER', diceCount: 8, aiOpponents: 0 });
  if (finished) await finish();
}
const subscribe = (listener) => realStore ? realStore.subscribe(() => {
  // Exercise the real store's synchronous publications before discard's await
  // continuation. React is allowed to commit external-store updates here.
  flushSync(listener);
  if (discardState.pending) discardState.publications.push({
    active: !!realStore.getSnapshot().data?.active, busy: realStore.getSnapshot().busy
  });
}) : () => {};
const snapshot = () => realStore ? realStore.getSnapshot() : view;
const Context = createContext(null);
export function Provider({ children }) {
  const current = useSyncExternalStore(subscribe, snapshot, snapshot);
  const value = { view: current, store: realStore ? { ...realStore, async discard() {
    discardState.pending = true;
    try { return discardState.result = await realStore.discard(); }
    finally { discardState.pending = false; }
  } } : {}, colors: {
  text: '#111', muted: '#444', tint: '#123', line: '#aaa', surface: '#eee',
  page: '#fff', action: '#234', actionText: '#fff', error: '#c00'
} };
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useLocalGame() { return useContext(Context); }
`;
// Records each Pressable's real props, then renders the real react-native-web one.
const capture = `
import React, { forwardRef, useLayoutEffect } from 'react';
import { Pressable as Host } from 'rnw-host';
export * from 'rnw-host';
export const Pressable = forwardRef((props, ref) => {
  useLayoutEffect(() => { (window.pressableProps ??= {})[props.accessibilityLabel] = props; });
  return <Host {...props} ref={ref} />;
});
`;
// Adapter events carry RN's documented NativeTouchEvent shape. They are fixtures, never native evidence.
const touchEntry = `
import { Action } from './apps/mobile/src/ui/controls';
import { createInputTrace } from './apps/mobile/src/diagnostics/inputTrace';
import { createDoneTrace } from './apps/mobile/src/diagnostics/doneTrace';
const button = (label) => document.querySelector('[aria-label="' + label + '"]');
window.touchEndSeen = [];
document.addEventListener('touchend', (event) => { window.touchEndSeen.push(event.defaultPrevented); });
Object.assign(window.fixture, {
  dispatch(type, label, changed, active = []) {
    const target = button(label);
    const shape = (touch) => ({ force: 0, target, clientX: 8, clientY: 8, pageX: 8, pageY: 8, ...touch });
    const event = new Event(type, { bubbles: true, cancelable: true, composed: true });
    Object.defineProperties(event, {
      changedTouches: { value: changed.map(shape) }, touches: { value: active.map(shape) }, targetTouches: { value: active.map(shape) },
      timeStamp: { value: changed[0].timestamp }, timestamp: { value: changed[0].timestamp }, identifier: { value: changed[0].identifier },
    });
    target.dispatchEvent(event);
  },
  click(label) { button(label).click(); },
  retained(hook, label, nativeEvent) {
    try { return { threw: false, returned: window.pressableProps[label][hook]({ nativeEvent }) === undefined }; }
    catch { return { threw: true }; }
  },
  catalog() {
    return Object.fromEntries(Object.entries(window.pressableProps).map(([label, props]) => [label, {
      keys: Object.keys(props).sort(),
      values: Object.fromEntries(Object.entries(props).filter(([, value]) => ['string', 'boolean', 'number'].includes(typeof value))),
      originalOnPress: props.onPress === window.controlPress,
    }]));
  },
  mountControls() {
    const enabled = process.env.EXPO_PUBLIC_NATIVE_INPUT_TRACE === '1';
    const trace = createInputTrace(enabled, () => {});
    const done = createDoneTrace(enabled, () => {}).routeObservation();
    window.controlPress = (...args) => { window.controlArgs = args; if (window.controlThrow) throw window.controlThrow; return 'original result'; };
    app = createRoot(document.getElementById('root'));
    flushSync(() => app.render(<Provider>
      <Action label="Resume control" onPress={window.controlPress} pressObservation={trace.resumePressObservation()} />
      <Action label="Start control" onPress={window.controlPress} pressObservation={trace.startPressObservation()} />
      <Action label="Help control" onPress={window.controlPress} pressObservation={trace.helpPressObservation()} />
      <Action label="Picker control" onPress={window.controlPress} pressObservation={trace.pickerPressObservation()} />
      <Action label="Done control" onPress={window.controlPress} pressObservation={done?.press} />
      <Action label="Plain control" onPress={window.controlPress} />
    </Provider>));
  },
  invokeControl(args, thrown) {
    window.controlThrow = thrown ? new Error('PRIVATE callback') : undefined;
    try { return { result: window.pressableProps['Resume control'].onPress(...args), args: window.controlArgs }; }
    catch (error) { return { same: error === window.controlThrow, args: window.controlArgs }; }
  },
});
`;

beforeAll(async () => {
  async function bundle(enabled: string, variant: "plain" | "touch" | "baseline" = "plain") {
    const result = await Bun.build({ entrypoints: ["resume-fixture"], target: "browser", format: "iife",
      define: { process: "{}", "process.env.NODE_ENV": '"development"', __DEV__: "true", "process.env.EXPO_PUBLIC_NATIVE_INPUT_TRACE": JSON.stringify(enabled) },
      plugins: [{ name: "resume-component-lifecycle", setup(build) {
        build.onResolve({ filter: /^resume-fixture$/ }, () => ({ path: "entry", namespace: "resume" }));
        build.onResolve({ filter: /^(resume-store|.*\/LocalProvider)$/ }, () => ({ path: "store", namespace: "resume" }));
        build.onResolve({ filter: /^\.\/(Play|Results)$/ }, ({ path, importer }) => importer.endsWith("NativeGameScreen.tsx")
          ? { path: path.slice(2), namespace: "resume" } : undefined);
        build.onResolve({ filter: /^rnw-host$/ }, () => ({ path: require.resolve("react-native-web") }));
        build.onResolve({ filter: /^react-native$/ }, () => variant === "plain" ? { path: require.resolve("react-native-web") } : { path: "capture", namespace: "resume" });
        build.onResolve({ filter: /^react-native-safe-area-context$/ }, () => ({ path: resolve(root, "tests/clients/native-safe-area.tsx") }));
        // Exact pinned Action bytes, so normal CI needs no old Git objects.
        if (variant === "baseline") build.onLoad({ filter: /src[\\/]ui[\\/]controls\.tsx$/ }, async () => {
          const contents = (await Bun.file(resolve(import.meta.dir, "fixtures/resume-boundary-baseline-2453.tsx.fixture")).text()).replace(/\r\n/g, "\n");
          if (createHash("sha256").update(contents).digest("hex") !== BASELINE_SHA256) throw new Error("Pinned Resume boundary baseline changed");
          return { contents, loader: "tsx", resolveDir: resolve(root, "apps/mobile/src/ui") };
        });
        build.onLoad({ filter: /.*/, namespace: "resume" }, ({ path }) => ({ loader: "tsx", resolveDir: root, contents:
          path === "entry" ? (variant === "plain" ? entry : entry + touchEntry) : path === "store" ? store : path === "capture" ? capture : `
            import React from 'react';
            import { destination, pending } from 'resume-store';
            export function ${path}({ onPause, onAgain }) {
              if (destination.mode === 'suspend') throw pending;
              if (destination.mode === 'error') throw new Error('private render error');
              return ${path === "Results" ? '<button onClick={onAgain}>Play Again fixture</button>' : '<button onClick={onPause}>Destination committed</button>'};
            }` }));
      } }],
    });
    if (!result.success) throw new Error(result.logs.join("\n"));
    return result.outputs[0].text();
  }
  script = await bundle("1"); shippingScript = await bundle("0");
  touchScript = await bundle("1", "touch"); touchShippingScript = await bundle("0", "touch");
  baselineScript = await bundle("1", "baseline"); baselineShippingScript = await bundle("0", "baseline");
  browser = await chromium.launch({ headless: true });
}, 30_000);
afterAll(async () => { await browser?.close(); });

type Event = { phase: string; resumeId?: number; sequence: number };
async function fixture(mode = "play", locked = false, qualification = true, source?: string, context?: Parameters<Browser["newPage"]>[0]) {
  const page = await browser.newPage(context); const events: Event[] = [];
  page.on("console", (message) => {
    if (message.text().startsWith("THIRD_ROLL_INPUT ")) events.push(JSON.parse(message.text().slice(17)));
  });
  await page.setContent('<div id="root"></div>');
  await page.addScriptTag({ content: source ?? (qualification ? script : shippingScript) });
  await page.evaluate(async ({ mode, locked }) => {
    await (window as unknown as { fixture: { mount(mode: string, locked: boolean): Promise<void> } }).fixture.mount(mode, locked);
  }, { mode, locked });
  return { page, events, resumeEvents: () => events.filter((event) => event.phase.startsWith("resume-")),
    transitions: () => events.filter((event) => event.phase === "resume-handler" || event.phase.startsWith("resume-react-commit-")) };
}
async function command(page: Page, action: "unmount" | "release" | "failSink" | "finish" | "holdDiscard" | "releaseDiscard" | "rejectDiscard" | "loadOnResume" | "releaseRead" | "lockResume") {
  await page.evaluate(async (action) => {
    await (window as unknown as { fixture: Record<string, () => void | Promise<void>> }).fixture[action]();
    if (action === "release") await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  }, action);
}

async function pressActivated(page: Page) {
  await page.waitForFunction(() => (window as unknown as { traceRecords: Event[] }).traceRecords.some((event) => event.phase === "resume-press-in"));
}

test("actual Resume handler correlates only with a committed destination, not initial Setup or strict effect replay", async () => {
  const f = await fixture();
  try {
    expect(f.transitions()).toEqual([]);
    await f.page.getByRole("button", { name: "Resume Game", exact: true }).click();
    await f.page.getByRole("button", { name: "Destination committed" }).waitFor();
    expect(f.transitions().map((event) => event.phase)).toEqual(["resume-handler", "resume-react-commit-play"]);
    const [handler, commit] = f.transitions();
    expect(commit.resumeId).toBe(handler.resumeId); expect(commit.sequence).toBeGreaterThan(handler.sequence);
    expect(JSON.stringify(f.events)).not.toMatch(/PRIVATE|private|paint|ack/);
    await f.page.getByRole("button", { name: "Destination committed" }).click();
    await f.page.getByRole("button", { name: "Resume Game", exact: true }).waitFor();
    expect(f.transitions().length).toBe(2); // Pause must not inherit the Resume ID.
    await f.page.getByRole("button", { name: "Resume Game", exact: true }).click();
    await f.page.getByRole("button", { name: "Destination committed" }).waitFor();
    const next = f.transitions().slice(2);
    expect(next.map((event) => event.phase)).toEqual(["resume-handler", "resume-react-commit-play"]);
    expect(next[0].resumeId).not.toBe(handler.resumeId); expect(next[1].resumeId).toBe(next[0].resumeId);
  } finally { await f.page.close(); }
});

test("original Resume press phases and handler share one ID through the actual Action", async () => {
  const f = await fixture();
  try {
    const button = f.page.getByRole("button", { name: "Resume Game", exact: true });
    await button.click();
    await f.page.getByRole("button", { name: "Destination committed" }).waitFor();
    const events = f.resumeEvents();
    expect(events.map((event) => event.phase).sort()).toEqual([
      "resume-handler", "resume-press-in", "resume-press-out", "resume-react-commit-play",
    ]);
    expect(new Set(events.map((event) => event.resumeId)).size).toBe(1);
    expect(events[0].resumeId).toBe(events[0].sequence);
  } finally { await f.page.close(); }
});

test("cancelled pointer gesture does not invent a handler or commit and the next press gets a new ID", async () => {
  const f = await fixture();
  try {
    const button = f.page.getByRole("button", { name: "Resume Game", exact: true });
    await button.hover(); await f.page.mouse.down();
    await pressActivated(f.page);
    await f.page.mouse.move(0, 0); await f.page.mouse.up();
    expect(f.resumeEvents().map((event) => event.phase)).toEqual(["resume-press-in", "resume-press-out"]);
    const first = f.resumeEvents()[0].resumeId;
    await button.click();
    await f.page.getByRole("button", { name: "Destination committed" }).waitFor();
    const handler = f.resumeEvents().find((event) => event.phase === "resume-handler")!;
    expect(handler.resumeId).not.toBe(first);
    expect(f.resumeEvents().some((event) => event.phase === "resume-observation-superseded" && event.resumeId === first)).toBe(true);
    expect(f.resumeEvents().find((event) => event.phase === "resume-react-commit-play")?.resumeId).toBe(handler.resumeId);
  } finally { await f.page.close(); }
});

test("unmount during an original press marks incomplete observation and ignores late release", async () => {
  const f = await fixture();
  try {
    await f.page.getByRole("button", { name: "Resume Game", exact: true }).hover();
    await f.page.mouse.down();
    await pressActivated(f.page);
    await command(f.page, "unmount");
    const detached = [...f.resumeEvents()];
    await f.page.mouse.up();
    expect(f.resumeEvents()).toEqual(detached);
    expect(f.resumeEvents().map((event) => event.phase)).toEqual(["resume-press-in", "resume-observation-detached"]);
    expect(new Set(f.resumeEvents().map((event) => event.resumeId)).size).toBe(1);
  } finally { await f.page.close(); }
});

test("a real pending store write disables a held Resume without inventing a handler, then permits a fresh activation", async () => {
  const f = await fixture("store");
  try {
    const button = f.page.getByRole("button", { name: "Resume Game", exact: true });
    await button.hover(); await f.page.mouse.down(); await pressActivated(f.page);
    const first = f.resumeEvents()[0].resumeId;
    await command(f.page, "lockResume");
    expect(await button.getAttribute("aria-disabled")).toBe("true");
    await f.page.mouse.up();
    expect(f.transitions()).toEqual([]);
    expect(f.resumeEvents().some((event) => event.phase === "resume-observation-disabled" && event.resumeId === first)).toBe(true);
    await command(f.page, "releaseDiscard");
    await button.click();
    await f.page.getByRole("button", { name: "Destination committed" }).waitFor();
    expect(f.transitions()[0].resumeId).not.toBe(first);
    expect(f.transitions()[1].resumeId).toBe(f.transitions()[0].resumeId);
  } finally { await f.page.close(); }
});

test("shipping flag leaves actual Resume navigation unchanged with no observation records", async () => {
  const f = await fixture("play", false, false);
  try {
    await f.page.getByRole("button", { name: "Resume Game", exact: true }).click();
    await f.page.getByRole("button", { name: "Destination committed" }).waitFor();
    expect(f.events).toEqual([]);
  } finally { await f.page.close(); }
});

test("handler without a retained press-in remains an unmatched handler, not fabricated press evidence", async () => {
  const f = await fixture();
  try {
    await f.page.getByRole("button", { name: "Resume Game", exact: true }).dispatchEvent("click");
    await f.page.getByRole("button", { name: "Destination committed" }).waitFor();
    expect(f.resumeEvents().map((event) => event.phase)).toEqual(["resume-handler", "resume-react-commit-play"]);
    expect(f.transitions()[0].resumeId).toBe(f.transitions()[0].sequence);
    expect(f.transitions()[1].resumeId).toBe(f.transitions()[0].resumeId);
  } finally { await f.page.close(); }
});

test("suspended actual destination emits handler but no commit, then correlates the eventual commit", async () => {
  const f = await fixture("suspend");
  try {
    await f.page.getByRole("button", { name: "Resume Game", exact: true }).click();
    await f.page.getByText("Suspended", { exact: true }).waitFor();
    expect(f.transitions().map((event) => event.phase)).toEqual(["resume-handler"]);
    await command(f.page, "release");
    await f.page.getByRole("button", { name: "Destination committed" }).waitFor();
    expect(f.transitions().map((event) => event.phase)).toEqual(["resume-handler", "resume-react-commit-play"]);
    expect(f.transitions()[1].resumeId).toBe(f.transitions()[0].resumeId);
  } finally { await f.page.close(); }
});

test("abandoned suspended work cannot report a commit after unmount", async () => {
  const f = await fixture("suspend");
  try {
    await f.page.getByRole("button", { name: "Resume Game", exact: true }).click();
    await f.page.getByText("Suspended", { exact: true }).waitFor();
    await command(f.page, "unmount"); await command(f.page, "release");
    expect(f.transitions().map((event) => event.phase)).toEqual(["resume-handler"]);
  } finally { await f.page.close(); }
});

test("failed destination render cannot report a React commit", async () => {
  const f = await fixture("error");
  try {
    await f.page.getByRole("button", { name: "Resume Game", exact: true }).click();
    await f.page.getByText("Render failed", { exact: true }).waitFor();
    expect(f.transitions().map((event) => event.phase)).toEqual(["resume-handler"]);
  } finally { await f.page.close(); }
});

test("real Setup disabled control remains inert and a failing trace sink cannot prevent Resume", async () => {
  const disabled = await fixture("play", true);
  try {
    expect(await disabled.page.getByRole("button", { name: "Resume Game", exact: true }).getAttribute("aria-disabled")).toBe("true");
    await disabled.page.getByRole("button", { name: "Resume Game", exact: true }).dispatchEvent("click");
    expect(disabled.resumeEvents()).toEqual([]);
  } finally { await disabled.page.close(); }
  const broken = await fixture();
  try {
    await command(broken.page, "failSink");
    await broken.page.getByRole("button", { name: "Resume Game", exact: true }).click();
    await broken.page.getByRole("button", { name: "Destination committed" }).waitFor();
  } finally { await broken.page.close(); }
});

test("a later real-store game completion cannot inherit a committed Resume ID", async () => {
  const f = await fixture("store");
  try {
    await f.page.getByRole("button", { name: "Resume Game", exact: true }).click();
    await f.page.getByRole("button", { name: "Destination committed" }).waitFor();
    const initial = [...f.transitions()];
    expect(initial.map((event) => event.phase)).toEqual(["resume-handler", "resume-react-commit-play"]);
    await command(f.page, "finish");
    await f.page.getByRole("button", { name: "Play Again fixture" }).waitFor();
    expect(f.transitions()).toEqual(initial);
  } finally { await f.page.close(); }
});

test("Play Again's real discard publications and pending write cannot inherit a Resume ID", async () => {
  const f = await fixture("finished-store");
  try {
    await f.page.getByRole("button", { name: "Review saved result", exact: true }).click();
    await f.page.getByRole("button", { name: "Play Again fixture" }).waitFor();
    const initial = [...f.transitions()];
    expect(initial.map((event) => event.phase)).toEqual(["resume-handler", "resume-react-commit-results"]);
    await command(f.page, "holdDiscard");
    await f.page.getByRole("button", { name: "Play Again fixture" }).click();
    await f.page.getByLabel("Saving on this device", { exact: true }).waitFor();
    expect(await f.page.getByRole("button", { name: "Play Again fixture" }).isVisible()).toBe(true);
    await command(f.page, "releaseDiscard");
    await f.page.getByRole("button", { name: "Start Game", exact: true }).waitFor();
    const state = await f.page.evaluate(() => (window as unknown as { fixture: { discardState(): { result: boolean; publications: { active: boolean }[] } } }).fixture.discardState());
    expect(state.result).toBe(true);
    expect(state.publications.some((publication) => !publication.active)).toBe(true);
    expect(f.transitions()).toEqual(initial);
  } finally { await f.page.close(); }
});

test("a failed Play Again write preserves the existing result screen and invalidates old correlation", async () => {
  const f = await fixture("finished-store");
  try {
    await f.page.getByRole("button", { name: "Review saved result", exact: true }).click();
    await f.page.getByRole("button", { name: "Play Again fixture" }).waitFor();
    const initial = [...f.transitions()];
    await command(f.page, "holdDiscard");
    await f.page.getByRole("button", { name: "Play Again fixture" }).click();
    await f.page.getByLabel("Saving on this device", { exact: true }).waitFor();
    await command(f.page, "rejectDiscard");
    await f.page.getByRole("button", { name: "Retry save", exact: true }).waitFor();
    expect(await f.page.getByRole("button", { name: "Play Again fixture" }).isVisible()).toBe(true);
    const result = await f.page.evaluate(() => (window as unknown as { fixture: { discardState(): { result: boolean } } }).fixture.discardState().result);
    expect(result).toBe(false);
    expect(f.transitions()).toEqual(initial);
  } finally { await f.page.close(); }
});

test("a pending Resume can observe loading then its committed destination, but no later results", async () => {
  const f = await fixture("store");
  try {
    await command(f.page, "loadOnResume");
    await f.page.getByRole("button", { name: "Resume Game", exact: true }).click();
    await f.page.getByText("Loading local data...", { exact: true }).waitFor();
    expect(f.transitions().map((event) => event.phase)).toEqual(["resume-handler", "resume-react-commit-loading"]);
    await command(f.page, "releaseRead");
    await f.page.getByRole("button", { name: "Destination committed" }).waitFor();
    const initial = [...f.transitions()];
    expect(initial.map((event) => event.phase)).toEqual(["resume-handler", "resume-react-commit-loading", "resume-react-commit-play"]);
    expect(new Set(initial.map((event) => event.resumeId)).size).toBe(1);
    await command(f.page, "finish");
    await f.page.getByRole("button", { name: "Play Again fixture" }).waitFor();
    expect(f.transitions()).toEqual(initial);
  } finally { await f.page.close(); }
});

// Passive native touch boundary. The real Action, Setup, NativeGameScreen and
// react-native-web Pressable run here; adapter events only supply RN's documented
// payload shape. None of this proves UIKit delivery or reproduces a native failure.
type Touch = { identifier: number; timestamp: number };
const RESUME = "Resume Game";
const point = (identifier: number, timestamp: number): Touch => ({ identifier, timestamp });
const payload = (...changed: Touch[]) => ({ changedTouches: changed, identifier: changed[0].identifier, timestamp: changed[0].timestamp });
const records = (page: Page) => page.evaluate<Event[]>("window.traceRecords");
const phases = async (page: Page) => (await records(page)).filter((event) => event.phase.startsWith("resume-")).map((event) => event.phase);
const dispatch = (page: Page, type: string, changed: Touch[], active: Touch[] = []) =>
  page.evaluate(`window.fixture.dispatch(${JSON.stringify(type)}, ${JSON.stringify(RESUME)}, ${JSON.stringify(changed)}, ${JSON.stringify(active)})`);
const retained = (page: Page, hook: string, nativeEvent: unknown) =>
  page.evaluate<{ threw: boolean; returned?: boolean }>(`window.fixture.retained(${JSON.stringify(hook)}, ${JSON.stringify(RESUME)}, ${JSON.stringify(nativeEvent)})`);
const phaseCount = (page: Page, phase: string, count = 1) => page.waitForFunction(
  ({ phase, count }) => (window as unknown as { traceRecords: Event[] }).traceRecords.filter((event) => event.phase === phase).length >= count, { phase, count });
async function touchDown(page: Page, touch: Touch, count = 1) {
  await dispatch(page, "touchstart", [touch], [touch]);
  await phaseCount(page, "resume-press-in", count);
}
const click = async (page: Page) => {
  await page.evaluate(`window.fixture.click(${JSON.stringify(RESUME)})`);
  await page.getByRole("button", { name: "Destination committed" }).waitFor();
};

test("pinned 2453 Action reaches the original press and handler callbacks but retains no native boundary", async () => {
  const f = await fixture("play", false, true, baselineScript);
  try {
    await touchDown(f.page, point(1, 1000));
    await dispatch(f.page, "touchend", [point(1, 1100)]);
    await phaseCount(f.page, "resume-press-out");
    await click(f.page);
    expect(await phases(f.page)).toEqual(["resume-press-in", "resume-press-out", "resume-handler", "resume-react-commit-play"]);
    expect((await retained(f.page, "onTouchEnd", payload(point(1, 1200)))).threw).toBe(true);
    expect(await phases(f.page)).toHaveLength(4);
  } finally { await f.page.close(); }
});

test("a delivered touch end keeps its activation ID and stays distinct from press-out and handler", async () => {
  const f = await fixture("play", false, true, boundarySource());
  try {
    await touchDown(f.page, point(1, 1000));
    await dispatch(f.page, "touchend", [point(1, 1100)]);
    await phaseCount(f.page, "resume-press-out");
    expect(await phases(f.page)).toEqual(["resume-press-in", "resume-touch-end", "resume-press-out"]);
    expect((await records(f.page)).some((event) => event.phase === "resume-handler")).toBe(false);
    await click(f.page);
    const events = (await records(f.page)).filter((event) => event.phase.startsWith("resume-"));
    expect(events.map((event) => event.phase)).toEqual(["resume-press-in", "resume-touch-end", "resume-press-out", "resume-handler", "resume-react-commit-play"]);
    expect(new Set(events.map((event) => event.resumeId)).size).toBe(1);
    for (const event of events) expect(Object.keys(event).sort()).toEqual(["atMs", "monotonicMs", "phase", "resumeId", "sequence"]);
  } finally { await f.page.close(); }
});

for (const [hook, phase] of [["onTouchEnd", "resume-touch-end"], ["onTouchCancel", "resume-touch-cancel"]]) {
  test(`${phase} after the handler unmounts Setup keeps the old ID and adds no navigation record`, async () => {
    const f = await fixture("play", false, true, boundarySource());
    try {
      await touchDown(f.page, point(1, 1000));
      await click(f.page);
      const result = await retained(f.page, hook, payload(point(1, 1100)));
      const events = (await records(f.page)).filter((event) => event.phase.startsWith("resume-") && event.phase !== "resume-press-out");
      expect(events.map((event) => event.phase)).toEqual(["resume-press-in", "resume-handler", "resume-react-commit-play", phase]);
      expect(new Set(events.map((event) => event.resumeId)).size).toBe(1);
      expect(result).toEqual({ threw: false, returned: true });
    } finally { await f.page.close(); }
  });
}

test("a delivered touch cancel invents no handler, a reused identifier gets a new ID, and a late old cancel is not borrowed", async () => {
  const f = await fixture("play", false, true, boundarySource());
  try {
    await touchDown(f.page, point(1, 1000));
    await dispatch(f.page, "touchcancel", [point(1, 1100)]);
    await phaseCount(f.page, "resume-press-out");
    expect(await phases(f.page)).toEqual(["resume-press-in", "resume-touch-cancel", "resume-press-out"]);
    await touchDown(f.page, point(1, 2000), 2);
    await retained(f.page, "onTouchCancel", payload(point(1, 1100)));
    await dispatch(f.page, "touchend", [point(1, 2100)]);
    await phaseCount(f.page, "resume-press-out", 2);
    const events = await records(f.page);
    const [first, second] = events.filter((event) => event.phase === "resume-press-in").map((event) => event.resumeId);
    expect(second).not.toBe(first);
    expect(events.filter((event) => event.phase.startsWith("resume-touch-")).map((event) => [event.phase, event.resumeId]))
      .toEqual([["resume-touch-cancel", first], ["resume-touch-end", second]]);
    await click(f.page);
    expect((await records(f.page)).find((event) => event.phase === "resume-handler")?.resumeId).toBe(second);
  } finally { await f.page.close(); }
});

test("a committed disable or unmount closes the activation, so a late boundary stays UNKNOWN", async () => {
  const disabled = await fixture("store", false, true, touchScript);
  try {
    await touchDown(disabled.page, point(1, 1000));
    await command(disabled.page, "lockResume");
    await phaseCount(disabled.page, "resume-observation-disabled");
    await dispatch(disabled.page, "touchend", [point(1, 1100)]);
    expect((await phases(disabled.page)).filter((phase) => phase.startsWith("resume-touch-") || phase === "resume-handler")).toEqual([]);
    await command(disabled.page, "releaseDiscard");
  } finally { await disabled.page.close(); }
  const unmounted = await fixture("play", false, true, touchScript);
  try {
    await touchDown(unmounted.page, point(1, 1000));
    await command(unmounted.page, "unmount");
    expect(await retained(unmounted.page, "onTouchCancel", payload(point(1, 1100)))).toEqual({ threw: false, returned: true });
    expect(await phases(unmounted.page)).toEqual(["resume-press-in", "resume-observation-detached"]);
  } finally { await unmounted.page.close(); }
});

test("simultaneous touches at activation leave the boundary UNKNOWN without touching press records", async () => {
  const f = await fixture("play", false, true, touchScript);
  try {
    const both = [point(1, 1000), point(2, 1000)];
    await dispatch(f.page, "touchstart", both, both);
    await phaseCount(f.page, "resume-press-in");
    await dispatch(f.page, "touchend", [point(1, 1100), point(2, 1100)]);
    await phaseCount(f.page, "resume-press-out");
    expect(await phases(f.page)).toEqual(["resume-press-in", "resume-press-out"]);
  } finally { await f.page.close(); }
});

test("a browser's real DOM touch tap navigates unchanged and its non-native payload stays UNKNOWN", async () => {
  const f = await fixture("play", false, true, touchScript, { hasTouch: true });
  try {
    const box = await f.page.getByRole("button", { name: RESUME, exact: true }).boundingBox();
    await f.page.touchscreen.tap(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await f.page.getByRole("button", { name: "Destination committed" }).waitFor();
    const seen = await phases(f.page);
    expect(seen).toContain("resume-handler"); expect(seen).toContain("resume-react-commit-play");
    expect(seen.filter((phase) => phase.startsWith("resume-touch-"))).toEqual([]);
  } finally { await f.page.close(); }
});

test("a failing trace sink cannot change the touch path or navigation", async () => {
  const f = await fixture("play", false, true, touchScript);
  try {
    await command(f.page, "failSink");
    await dispatch(f.page, "touchstart", [point(1, 1000)], [point(1, 1000)]);
    await dispatch(f.page, "touchcancel", [point(1, 1100)]);
    await click(f.page);
  } finally { await f.page.close(); }
});

test("differential: the hooks add only boundary records and leave press order and event defaults unchanged", async () => {
  const observed = [];
  for (const source of [baselineScript, touchScript]) {
    const f = await fixture("play", false, true, source);
    try {
      await touchDown(f.page, point(1, 1000));
      await dispatch(f.page, "touchend", [point(1, 1100)]);
      await phaseCount(f.page, "resume-press-out");
      await touchDown(f.page, point(1, 2000), 2);
      await dispatch(f.page, "touchcancel", [point(1, 2100)]);
      await phaseCount(f.page, "resume-press-out", 2);
      await click(f.page);
      const seen = (await phases(f.page)).filter((phase) => !phase.startsWith("resume-touch-"));
      observed.push({ seen, defaults: await f.page.evaluate<unknown>("window.touchEndSeen") });
    } finally { await f.page.close(); }
  }
  expect(observed[1]).toEqual(observed[0]);
  expect(observed[0].defaults).toEqual([false]); // Delivered to document, not prevented or stopped.
});

async function controls(source: string) {
  const page = await browser.newPage();
  await page.setContent('<div id="root"></div>');
  await page.addScriptTag({ content: source });
  await page.evaluate("window.fixture.mountControls()");
  return { page, catalog: await page.evaluate<Record<string, { keys: string[]; values: unknown; originalOnPress: boolean }>>("window.fixture.catalog()") };
}

test("only an enabled Resume adds touch hooks; every other Action's props match the pinned 2453 Action", async () => {
  const hooks = ["onTouchCancel", "onTouchEnd", "onTouchStart"];
  const others = ["Start control", "Help control", "Picker control", "Done control", "Plain control"];
  const [current, base] = [await controls(touchScript), await controls(baselineScript)];
  const [shipping, baseShipping] = [await controls(touchShippingScript), await controls(baselineShippingScript)];
  try {
    expect(current.catalog["Resume control"].keys).toEqual([...base.catalog["Resume control"].keys, ...hooks].sort());
    expect(current.catalog["Resume control"].values).toEqual(base.catalog["Resume control"].values);
    expect(base.catalog["Resume control"].keys.filter((key) => key.startsWith("onTouch") || key.startsWith("onResponder"))).toEqual([]);
    for (const label of others) expect(current.catalog[label]).toEqual(base.catalog[label]);
    expect(shipping.catalog).toEqual(baseShipping.catalog);
    expect(shipping.catalog["Resume control"].keys).toEqual(shipping.catalog["Plain control"].keys);
    for (const entry of Object.values({ ...current.catalog, ...shipping.catalog })) {
      expect(entry.originalOnPress).toBe(true);
      expect(entry.keys.filter((key) => key.startsWith("onResponder"))).toEqual([]);
    }
    for (const { page } of [current, base]) {
      expect(await page.evaluate<unknown>("window.fixture.invokeControl(['first', 2], false)")).toEqual({ result: "original result", args: ["first", 2] });
      expect(await page.evaluate<unknown>("window.fixture.invokeControl([], true)")).toEqual({ same: true, args: [] });
    }
  } finally { await Promise.all([current, base, shipping, baseShipping].map(({ page }) => page.close())); }
});

test("baseline fixture is the exact LF-canonical 2453 Action, with no native boundary capability", async () => {
  const contents = (await Bun.file(resolve(import.meta.dir, "fixtures/resume-boundary-baseline-2453.tsx.fixture")).text()).replace(/\r\n/g, "\n");
  expect(createHash("sha256").update(contents).digest("hex")).toBe(BASELINE_SHA256);
  expect(contents).not.toContain("nativeTouch");
  expect(contents).toContain("export function Action");
});

// Static source facts only. They do not execute Pressability or show UIKit delivery.
test("pinned React Native forwards passive touch props beside Pressability's responder handlers, never replacing them", async () => {
  const native = dirname(createRequire(resolve(root, "apps/mobile/package.json")).resolve("react-native/package.json"));
  const read = (path: string) => Bun.file(resolve(native, path)).text();
  const pressable = await read("Libraries/Components/Pressable/Pressable.js");
  expect(pressable).toMatch(/\.\.\.restProps\r?\n\s*\} = props;/);
  expect(pressable).toMatch(/const restPropsWithDefaults[^=]*= \{\r?\n\s*\.\.\.restProps,/);
  expect(pressable).toMatch(/\{\.\.\.restPropsWithDefaults\}\r?\n\s*\{\.\.\.eventHandlers\}/);
  expect(pressable).toContain("collapsable={false}");
  const pressability = await read("Libraries/Pressability/Pressability.js");
  expect(pressability).not.toMatch(/onTouch(Start|End|Cancel)/);
  for (const handler of ["onStartShouldSetResponder", "onResponderGrant", "onResponderRelease", "onResponderTerminate"]) expect(pressability).toContain(`${handler}:`);
  const viewProps = await read("Libraries/Components/View/ViewPropTypes.js");
  for (const hook of ["onTouchStart", "onTouchEnd", "onTouchCancel"]) expect(viewProps).toContain(`${hook}?:`);
  const viewConfig = await read("Libraries/NativeComponent/BaseViewConfig.ios.js");
  for (const [top, bubbled] of [["topTouchEnd", "onTouchEnd"], ["topTouchCancel", "onTouchCancel"]]) {
    expect(viewConfig).toMatch(new RegExp(`${top}: \\{\\s*phasedRegistrationNames: \\{\\s*bubbled: '${bubbled}'`));
  }
  const renderer = await read("Libraries/Renderer/implementations/ReactFabric-prod.js");
  expect(renderer).toMatch(/"ResponderEventPlugin",\s*"ReactNativeBridgeEventPlugin"/);
  const emitter = await read("ReactCommon/react/renderer/components/view/BaseTouch.cpp");
  expect(emitter).toContain('"timestamp"'); expect(emitter).toContain('"identifier"');
  const action = await Bun.file(resolve(root, "apps/mobile/src/ui/controls.tsx")).text();
  expect(action).not.toMatch(/onResponder|onStartShould|onMoveShould|pressRetentionOffset|unstable_pressDelay|cancelable/);
});
