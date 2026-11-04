import { afterAll, beforeAll, expect, test } from "bun:test";
import { resolve } from "node:path";
import { chromium, type Browser, type Page } from "playwright";

// Actual Start/selection components and real store, with controlled persistence.
// Host callback delivery controls isolate decisions; they are not native tap proof.
const root = resolve(import.meta.dir, "../..");

let browser: Browser, script: string, shippingScript: string;
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
  suspend() { destination.mode = 'suspend'; },
  renderError() { destination.mode = 'error'; },
  invokeStart() { window.currentStart(); },
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
  await realStore.preferences({ name: 'PRIVATE PLAYER', diceCount: 8 });
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

beforeAll(async () => {
  async function bundle(enabled: string) {
    const result = await Bun.build({ entrypoints: ["resume-fixture"], target: "browser", format: "iife",
      define: { process: "{}", "process.env.NODE_ENV": '"development"', __DEV__: "true", "process.env.EXPO_PUBLIC_NATIVE_INPUT_TRACE": JSON.stringify(enabled) },
      plugins: [{ name: "resume-component-lifecycle", setup(build) {
        build.onResolve({ filter: /^resume-fixture$/ }, () => ({ path: "entry", namespace: "resume" }));
        build.onResolve({ filter: /^(resume-store|.*\/LocalProvider)$/ }, () => ({ path: "store", namespace: "resume" }));
        build.onResolve({ filter: /^\.\/(Play|Results)$/ }, ({ path, importer }) => importer.endsWith("NativeGameScreen.tsx")
          ? { path: path.slice(2), namespace: "resume" } : undefined);
        build.onResolve({ filter: /^react-native$/ }, () => ({ path: "host", namespace: "resume" }));
        build.onResolve({ filter: /^react-native-safe-area-context$/ }, () => ({ path: resolve(root, "tests/clients/native-safe-area.tsx") }));
        build.onLoad({ filter: /.*/, namespace: "resume" }, ({ path }) => ({ loader: "tsx", resolveDir: root, contents:
          path === "entry" ? entry : path === "store" ? store : path === "host" ? `
          import React, { forwardRef, useLayoutEffect } from 'react';
          import { Pressable as HostPressable } from 'react-native-web';
          export { ActivityIndicator, Keyboard, View, StyleSheet, Text, KeyboardAvoidingView, Platform, ScrollView, TextInput, Alert, Modal } from 'react-native-web';
          export const ActionSheetIOS = undefined; // Unavailable on this web host.
          export const Pressable = forwardRef((props, ref) => {
            useLayoutEffect(() => { if (props.accessibilityLabel === 'Start Game') window.currentStart = props.onPress; });
            return <HostPressable {...props} ref={ref} />;
          });` : `
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
  browser = await chromium.launch({ headless: true });
}, 30_000);
afterAll(async () => { await browser?.close(); });

type Event = { phase: string; resumeId?: number; startId?: number; preferenceId?: number; sequence: number };
async function fixture(mode = "store", locked = false, qualification = true) {
  const page = await browser.newPage(); const events: Event[] = [];
  page.on("console", (message) => {
    if (message.text().startsWith("THIRD_ROLL_INPUT ")) events.push(JSON.parse(message.text().slice(17)));
  });
  const bootErrors: string[] = []; page.on("pageerror", (error) => bootErrors.push(error.stack ?? error.message));
  await page.setContent('<div id="root"></div>');
  await page.addScriptTag({ content: qualification ? script : shippingScript });
  if (!(await page.evaluate(() => "fixture" in window))) throw new Error("fixture boot: " + bootErrors.join("; "));
  await page.evaluate(async ({ mode, locked }) => {
    await (window as unknown as { fixture: { mount(mode: string, locked: boolean): Promise<void> } }).fixture.mount(mode, locked);
  }, { mode, locked });
  return { page, events, resumeEvents: () => events.filter((event) => event.phase.startsWith("resume-")),
    transitions: () => events.filter((event) => event.phase === "resume-handler" || event.phase.startsWith("resume-react-commit-")) };
}
async function command(page: Page, action: "unmount" | "release" | "failSink" | "finish" | "holdDiscard" | "releaseDiscard" | "rejectDiscard" | "loadOnResume" | "releaseRead" | "lockResume" | "suspend" | "renderError" | "invokeStart") {
  await page.evaluate(async (action) => {
    await (window as unknown as { fixture: Record<string, () => void | Promise<void>> }).fixture[action]();
    if (action === "release") await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  }, action);
}

async function pressActivated(page: Page) {
  await page.waitForFunction(() => (window as unknown as { traceRecords: Event[] }).traceRecords.some((event) => event.phase === "start-press-in"));
}

const phases = (events: Event[]) => events.map((event) => event.phase);
const startEvents = (events: Event[]) => events.filter((event) => event.phase.startsWith("start-"));

test("Start original press, actual persistence and React commit share a single request", async () => {
  const f = await fixture();
  try {
    await f.page.getByRole("button", { name: "Start Game", exact: true }).click();
    await f.page.getByRole("button", { name: "Destination committed" }).waitFor();
    const events = startEvents(f.events);
    expect(phases(events)).toEqual(["start-press-in", "start-press-out", "start-handler", "start-decision-accepted",
      "start-write-begin", "start-write-ack", "start-settled-success", "start-react-commit-play"]);
    expect(new Set(events.map((event) => event.startId)).size).toBe(1);
    expect(events[0].startId).toBe(events[0].sequence);
    expect(JSON.stringify(f.events)).not.toMatch(/PRIVATE|private|paint|error text/);
    const before = [...events];
    await command(f.page, "finish");
    await f.page.getByRole("button", { name: "Play Again fixture" }).waitFor();
    expect(startEvents(f.events)).toEqual(before);
  } finally { await f.page.close(); }
});

test("accepted Start waits for actual write acknowledgment; late success has no abandoned React commit", async () => {
  const f = await fixture();
  try {
    await command(f.page, "holdDiscard");
    await f.page.getByRole("button", { name: "Start Game", exact: true }).click();
    await f.page.getByLabel("Saving on this device", { exact: true }).waitFor();
    expect(phases(f.events)).toContain("start-write-begin");
    expect(phases(f.events)).not.toContain("start-write-ack");
    expect(phases(f.events)).not.toContain("start-react-commit-play");
    await command(f.page, "unmount"); await command(f.page, "releaseDiscard");
    expect(phases(f.events)).toContain("start-write-ack");
    expect(phases(f.events)).not.toContain("start-react-commit-play");
  } finally { await f.page.close(); }
});

test("actual write failure preserves recovery and never claims a committed destination", async () => {
  const f = await fixture();
  try {
    await command(f.page, "holdDiscard");
    await f.page.getByRole("button", { name: "Start Game", exact: true }).click();
    await f.page.getByLabel("Saving on this device", { exact: true }).waitFor();
    await command(f.page, "rejectDiscard");
    await f.page.getByRole("button", { name: "Retry save", exact: true }).waitFor();
    expect(phases(f.events)).toContain("start-write-failed");
    expect(phases(f.events)).toContain("start-settled-failure");
    expect(phases(f.events)).not.toContain("start-write-ack");
    expect(phases(f.events)).not.toContain("start-react-commit-play");
  } finally { await f.page.close(); }
});

test("pending selection links intent, actual busy rejection, persistence acknowledgment and committed selected value", async () => {
  const f = await fixture();
  try {
    await command(f.page, "holdDiscard");
    await f.page.getByRole("button", { name: "Dice count", exact: true }).click();
    await f.page.getByRole("radio", { name: "10 dice", exact: true }).click();
    await f.page.getByLabel("Saving on this device", { exact: true }).waitFor();
    const intent = f.events.find((e) => e.phase === "preference-dice-10-intent")!;
    expect(intent).toBeDefined();
    expect(phases(f.events)).not.toContain("preference-dice-10-write-ack");
    // Inject delivery at the actual host callback boundary, bypassing disabled
    // host delivery to exercise the store guard. This is not a native replay.
    await command(f.page, "invokeStart");
    expect(phases(f.events)).toContain("start-decision-busy");
    const link = f.events.find((e) => e.phase === "start-preference-dice-intent")!;
    expect(link.preferenceId).toBe(intent.preferenceId);
    expect(phases(f.events)).not.toContain("start-react-commit-play");
    await command(f.page, "releaseDiscard");
    await f.page.waitForFunction(() => (window as unknown as { traceRecords: Event[] }).traceRecords.some((e) => e.phase === "preference-dice-10-react-commit"));
    const selection = f.events.filter((e) => e.phase.startsWith("preference-dice-10-"));
    expect(selection.every((e) => e.preferenceId === intent.preferenceId)).toBe(true);
    expect(phases(selection)).toEqual(["preference-dice-10-intent", "preference-dice-10-decision-accepted", "preference-dice-10-write-begin",
      "preference-dice-10-write-ack", "preference-dice-10-settled-success", "preference-dice-10-react-commit"]);
    await f.page.getByRole("button", { name: "Start Game", exact: true }).click();
    await f.page.getByRole("button", { name: "Destination committed" }).waitFor();
    const accepted = f.events.find((e) => e.phase === "start-react-commit-play")!;
    expect(accepted.startId).not.toBe(link.startId);
  } finally { await f.page.close(); }
});

test("suspended Start commits only after release; abandoned/error renders cannot claim commit", async () => {
  for (const mode of ["release", "unmount", "error"] as const) {
    const f = await fixture();
    try {
      await command(f.page, mode === "error" ? "renderError" : "suspend");
      await f.page.getByRole("button", { name: "Start Game", exact: true }).click();
      await f.page.getByText(mode === "error" ? "Render failed" : "Suspended", { exact: true }).waitFor();
      expect(phases(f.events)).toContain("start-write-ack");
      expect(phases(f.events)).not.toContain("start-react-commit-play");
      if (mode !== "error") {
        if (mode === "unmount") await command(f.page, "unmount");
        await command(f.page, "release");
        if (mode === "release") await f.page.getByRole("button", { name: "Destination committed" }).waitFor();
        expect(phases(f.events).includes("start-react-commit-play")).toBe(mode === "release");
      }
    } finally { await f.page.close(); }
  }
});

test("cancelled/unmounted Start activation never invents a handler; failing sink and shipping flag preserve Start", async () => {
  const f = await fixture();
  try {
    await f.page.getByRole("button", { name: "Start Game", exact: true }).hover();
    await f.page.mouse.down(); await pressActivated(f.page);
    await f.page.mouse.move(0, 0); await f.page.mouse.up();
    expect(phases(f.events)).not.toContain("start-handler");
    await command(f.page, "unmount");
    expect(phases(f.events)).toContain("start-observation-detached");
  } finally { await f.page.close(); }
  for (const qualification of [true, false]) {
    const x = await fixture("store", false, qualification);
    try {
      if (qualification) await command(x.page, "failSink");
      await x.page.getByRole("button", { name: "Start Game", exact: true }).click();
      await x.page.getByRole("button", { name: "Destination committed" }).waitFor();
      expect(x.events).toEqual([]);
    } finally { await x.page.close(); }
  }
});
