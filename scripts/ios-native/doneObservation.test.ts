import { afterAll, beforeAll, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { chromium, type Browser, type Page } from "playwright";

const root = resolve(import.meta.dir, "../..");
const mobile = resolve(root, "apps/mobile");
let browser: Browser;
const scripts: Record<string, string> = {};

// The route and layout are the real app files on the real vendored navigation core, router and event emitter.
// Only the native stack view, the native press host and storage are browser fixtures. This proves JS and React
// seams only, never native delivery, paint or accessibility.
const entry = `
import React,{StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {Root} from 'done-router';
window.records=[];window.backCalls=[];window.backMode='queue';window.original=new Error('PRIVATE callback error');window.hookReads={navigation:0,segments:0};
console.info=line=>{if(line.startsWith('THIRD_ROLL_DONE '))window.records.push(line);};
let app;window.fixture={
 mount(strict){app=createRoot(document.getElementById('root'));flushSync(()=>app.render(strict?<StrictMode><Root/></StrictMode>:<Root/>));},
 unmount(){flushSync(()=>app.unmount());},
 press(kind,time){const p=window.doneProps;if(kind==='handler'||kind==='argument'){try{window.returned=kind==='argument'?p.onPress(window.original):p.onPress();}catch(e){window.sameError=e===window.original;}}else if(kind==='in')p.onPressIn?.({nativeEvent:{timestamp:time}});else p.onPressOut?.({nativeEvent:{timestamp:time}});},
 failSink(){console.info=()=>{throw new Error('PRIVATE sink');};},
 tick(){return new Promise(done=>setTimeout(()=>setTimeout(done,0),0));}
};`;
const router = `
import React,{useEffect,useLayoutEffect,useMemo,useRef,useSyncExternalStore,Children,Suspense} from 'react';
import {BaseNavigationContainer,ThemeProvider as CoreThemeProvider,createNavigationContainerRef,useNavigation as coreUseNavigation,useNavigationBuilder} from 'expo-router/build/react-navigation/core';
import {Screen as CoreScreen} from 'expo-router/build/react-navigation/core/Screen';
import {StackRouter} from 'expo-router/build/react-navigation/routers';
import {routingQueue} from 'expo-router/build/global-state/routingQueue';
import HelpRoute from 'done-help-route';
import Layout from 'done-layout';
const ref=createNavigationContainerRef();window.navigationRef=ref;
const routerObject={back(...args){window.backCalls.push({args,receiver:this===routerObject});if(window.backMode==='throw')throw window.original;if(window.backMode==='queue')routingQueue.add({type:'GO_BACK'});return window.original;}};
export const useRouter=()=>routerObject;
export const useNavigation=()=>{window.hookReads.navigation++;return coreUseNavigation();};
const segmentsByRoute={};const noSegments=[];
const currentSegments=()=>{if(!ref.isReady())return noSegments;const name=ref.getCurrentRoute()?.name;return segmentsByRoute[name]??=[name];};
export function useSegments(){window.hookReads.segments++;return useSyncExternalStore(listener=>ref.addListener('state',listener),currentSegments,currentSegments);}
export const DarkTheme={dark:true,colors:{},fonts:{}};export const DefaultTheme={dark:false,colors:{},fonts:{}};
export const ThemeProvider=CoreThemeProvider;
function ScreenConfig({options}){const navigation=coreUseNavigation();useLayoutEffect(()=>{window.routeOptions=options;navigation.setOptions(options);},[navigation,options]);return null;}
const IndexRoute=()=><div>Setup fixture</div>;const HistoryRoute=()=><div>History fixture</div>;
const SuspendingHelp=()=><Suspense fallback={<div>Suspense fixture</div>}><HelpRoute/></Suspense>;
const components={index:IndexRoute,history:HistoryRoute,help:SuspendingHelp};
export function Stack({children,screenOptions}){
 window.stackProps={screenOptions,screens:Children.toArray(children).map(c=>({name:c.props.name,options:c.props.options}))};
 const screens=Children.toArray(children).map(c=><CoreScreen key={c.props.name} name={c.props.name} component={components[c.props.name]}/>);
 const {state,descriptors,navigation,NavigationContent}=useNavigationBuilder(StackRouter,{children:screens,initialRouteName:'index'});
 window.stackNavigation=navigation;window.stackState=state;
 return <NavigationContent>{state.routes.map(route=>{const options=descriptors[route.key].options;return <section key={route.key}><header>{options.headerRight?.()}</header>{descriptors[route.key].render()}</section>;})}</NavigationContent>;
}
Stack.Screen=ScreenConfig;
function Emitter(){const events=useSyncExternalStore(routingQueue.subscribe,routingQueue.snapshot,routingQueue.snapshot);useEffect(()=>{routingQueue.run(ref);},[events]);return null;}
export function Root(){return <BaseNavigationContainer ref={ref}><Emitter/><Layout/></BaseNavigationContainer>;}
`;

beforeAll(async () => {
  for (const mode of ["current", "old", "shipping"]) {
    const result = await Bun.build({ entrypoints: ["done-fixture"], target: "browser", format: "iife",
      define: { process: "{}", "process.env.NODE_ENV": '"development"', __DEV__: "true", "process.env.EXPO_PUBLIC_NATIVE_INPUT_TRACE": JSON.stringify(mode === "shipping" ? "0" : "1") },
      plugins: [{ name: "actual-done-lifecycle", setup(build) {
        build.onResolve({ filter: /^done-fixture$/ }, () => ({ path: "entry", namespace: "done" }));
        build.onResolve({ filter: /^(done-router|expo-router)$/ }, () => ({ path: "router", namespace: "done" }));
        build.onResolve({ filter: /^done-help-route$/ }, () => ({ path: resolve(mobile, "app/help.tsx") }));
        build.onResolve({ filter: /^done-layout$/ }, () => ({ path: resolve(mobile, "app/_layout.tsx") }));
        // Generated modules have no directory of their own, so these must not depend on the current directory.
        build.onResolve({ filter: /^(react|react-dom|react-native-web)(\/|$)/ }, ({ path, namespace }) => namespace === "done" ? { path: Bun.resolveSync(path, root) } : undefined);
        build.onResolve({ filter: /^expo-status-bar$/ }, () => ({ path: "status", namespace: "done" }));
        build.onResolve({ filter: /^react-native$/ }, () => ({ path: "host", namespace: "done" }));
        build.onResolve({ filter: /^expo-router\/build\// }, ({ path }) => ({ path: Bun.resolveSync(path, mobile) }));
        build.onLoad({ filter: /.*/, namespace: "done" }, ({ path }) => ({ loader: "tsx", resolveDir: root, contents:
          path === "entry" ? entry : path === "router" ? router : path === "status" ? "export const StatusBar=()=>null;" : `
          import React,{forwardRef,useLayoutEffect} from 'react';
          import {Pressable as Host,ScrollView as HostScroll} from 'react-native-web';
          export * from 'react-native-web';
          export const ScrollView=forwardRef((props,ref)=>{if(window.helpGate)throw window.helpGate;return <HostScroll {...props} ref={ref}/>;});
          export const Pressable=forwardRef((props,ref)=>{useLayoutEffect(()=>{if(props.accessibilityLabel==='Done')window.doneProps=props;});return <Host {...props} ref={ref}/>;});` }));
        build.onResolve({ filter: /^react-native-safe-area-context$/ }, () => ({ path: resolve(root, "tests/clients/native-safe-area.tsx") }));
        // The queue is real; only its link-resolution helper is unreachable from a GO_BACK.
        build.onLoad({ filter: /global-state[\\/]getNavigationAction\.js$/ }, () => ({ loader: "js", contents: "exports.getNavigateAction=()=>undefined;" }));
        build.onLoad({ filter: /platformStorage\.ts$/ }, () => ({ loader: "ts", contents: "export function createPlatformStorage(){let value=null;return {async getItem(){return value;},async setItem(_key,next){value=next;},async removeItem(){value=null;}};}" }));
        if (mode === "old") build.onLoad({ filter: /app[\\/]help\.tsx$/ }, async () => {
          // Exact pinned route bytes, so normal CI needs no old Git objects.
          const contents = (await Bun.file(resolve(import.meta.dir, "fixtures/done-baseline-136.tsx.fixture")).text()).replace(/\r\n/g, "\n");
          if (createHash("sha256").update(contents).digest("hex") !== "d07dfaa5e3da7298b824f04ffc2c5166875e256a7ebc5011392c81f25d43064e") throw new Error("Pinned Done baseline fixture changed");
          return { contents, loader: "tsx", resolveDir: resolve(mobile, "app") };
        });
      } }] });
    if (!result.success) throw new Error(result.logs.join("\n"));
    scripts[mode] = await result.outputs[0].text();
  }
  browser = await chromium.launch({ headless: true });
}, 30000);
afterAll(async () => { await browser?.close(); });

type Observed = {
  phases: string[]; doneIds: (number | undefined)[]; routeIds: (number | undefined)[]; lines: string[]; calls: { args: unknown[]; receiver: boolean }[];
  sameError: boolean; returned: boolean; focused: string | undefined; routes: string[]; hookReads: { navigation: number; segments: number };
};
const read = `(()=>{const records=window.records.map(line=>JSON.parse(line.slice(16)));return {phases:records.map(r=>r.phase),doneIds:records.map(r=>r.doneId),routeIds:records.map(r=>r.routeId),lines:window.records,calls:window.backCalls,sameError:window.sameError,returned:window.returned===window.original,focused:window.navigationRef.getCurrentRoute()?.name,routes:window.stackState.routes.map(r=>r.name),hookReads:window.hookReads};})()`;
async function open(mode: string, { strict = false, gated = false } = {}): Promise<Page> {
  const page = await browser.newPage();
  await page.setContent('<div id="root"></div>'); await page.addScriptTag({ content: scripts[mode] });
  if (gated) await page.evaluate("(()=>{window.helpGate=new Promise(done=>{window.openGate=()=>{window.helpGate=null;done();};});})()");
  await page.evaluate(`window.fixture.mount(${strict})`);
  await page.waitForFunction("window.navigationRef.isReady()");
  await page.evaluate("window.navigationRef.navigate('help')");
  if (!gated) await page.waitForFunction("window.doneProps&&window.navigationRef.getCurrentRoute()?.name==='help'");
  await page.evaluate("window.fixture.tick()");
  return page;
}
async function observe(mode: string, commands: string, options: { strict?: boolean } = {}) {
  const page = await open(mode, options);
  try {
    await page.evaluate(`(async()=>{${commands};await window.fixture.tick();})()`);
    return await page.evaluate<Observed>(read);
  } finally { await page.close(); }
}
const activation = (phases: string[]) => phases.filter((phase) => /^done-(press|handler|router|observation)/.test(phase));
// The route commits and focuses first. The root store update that follows it is a separate, later commit.
const openHelp = ["done-process-start", "done-route-branch-root", "done-route-attach", "done-route-focus", "done-route-branch-help"];
const fromOpen = (result: Observed) => { expect(result.phases.slice(0, openHelp.length)).toEqual(openHelp); return result.phases.slice(openHelp.length); };

test("actual Done reaches router.back and separates press, handler, call, navigator removal and committed branch", async () => {
  const result = await observe(process.env.DONE_BASELINE === "1" ? "old" : "current", "fixture.press('in',10);fixture.press('handler');fixture.press('out',11)");
  expect(result.calls).toEqual([{ args: [], receiver: true }]); expect(result.returned).toBe(true);
  expect(result.routes).toEqual(["index"]); expect(result.focused).toBe("index");
  expect(activation(result.phases)).toEqual(["done-press-in", "done-handler", "done-router-back-call", "done-router-back-returned", "done-press-out"]);
  const { phases, doneIds, routeIds } = result;
  // The real order: router.back only queues. The drain, removal and commit come after it returns.
  expect(fromOpen(result)).toEqual(["done-press-in", "done-handler", "done-router-back-call", "done-router-back-returned", "done-press-out", "done-route-before-remove-go-back", "done-route-effect-cleanup", "done-route-branch-root"]);
  const id = doneIds[phases.indexOf("done-press-in")];
  for (const phase of ["done-press-in", "done-handler", "done-router-back-call", "done-router-back-returned", "done-press-out", "done-route-before-remove-go-back", "done-route-effect-cleanup"]) expect(doneIds[phases.indexOf(phase)]).toBe(id);
  expect(routeIds[phases.indexOf("done-route-before-remove-go-back")]).toBe(routeIds[phases.indexOf("done-route-attach")]);
  expect(doneIds[phases.lastIndexOf("done-route-branch-root")]).toBeUndefined();
  expect(result.lines.join()).not.toMatch(/PRIVATE|help-|index-|GO_BACK|"key"|"name"/);
});

test("pinned 136 route reaches the original router.back with its return value and emits no Done activation or route record", async () => {
  const result = await observe("old", "fixture.press('in',10);fixture.press('handler');fixture.press('out',11)");
  expect(result.calls).toEqual([{ args: [], receiver: true }]); expect(result.returned).toBe(true); expect(result.routes).toEqual(["index"]);
  expect(activation(result.phases)).toEqual([]); expect(result.phases.filter((phase) => phase.startsWith("done-route-") && !phase.startsWith("done-route-branch-"))).toEqual([]);
  const failed = await observe("old", "window.backMode='throw';fixture.press('handler')");
  expect(failed.calls).toEqual([{ args: [], receiver: true }]); expect(failed.sameError).toBe(true); expect(failed.routes).toEqual(["index", "help"]);
});

for (const mode of ["old", "current", "shipping"]) {
  test(`${mode}: host arguments, call count, return and thrown identity match the original callback`, async () => {
    const passed = await observe(mode, "fixture.press('argument')");
    expect(passed.calls).toEqual([{ args: [], receiver: true }]); expect(passed.returned).toBe(true);
    expect(passed.lines.join()).not.toContain("PRIVATE");
    const failed = await observe(mode, "window.backMode='throw';fixture.press('handler');window.backMode='queue';fixture.press('handler')");
    expect(failed.calls.length).toBe(2); expect(failed.sameError).toBe(true); expect(failed.routes).toEqual(["index"]);
  });
}

test("boundary 1: a press with no handler never records a handler or router call", async () => {
  const result = await observe("current", "fixture.press('in',10);fixture.press('out',11);fixture.press('in',20);fixture.press('out',11);window.navigationRef.goBack()");
  expect(result.calls).toEqual([]);
  expect(activation(result.phases)).toEqual(["done-press-in", "done-press-out", "done-observation-superseded", "done-press-in", "done-observation-detached"]);
  // The route left through a path with no Done activation, so no record names one.
  for (const phase of ["done-route-before-remove-go-back", "done-route-effect-cleanup"]) expect(result.doneIds[result.phases.indexOf(phase)]).toBeUndefined();
});

test("boundary 2: a returned router.back with no navigation progress stays on Help with no removal record", async () => {
  const result = await observe("current", "window.backMode='drop';fixture.press('in',10);fixture.press('handler');fixture.press('out',11)");
  expect(result.calls.length).toBe(1); expect(result.routes).toEqual(["index", "help"]);
  expect(fromOpen(result)).toEqual(["done-press-in", "done-handler", "done-router-back-call", "done-router-back-returned", "done-press-out"]);
    const thrown = await observe("current", "window.backMode='throw';fixture.press('in',10);fixture.press('handler')");
  expect(thrown.sameError).toBe(true); expect(fromOpen(thrown).slice(-1)).toEqual(["done-router-back-threw"]);
});

test("boundary 3: the committed root branch is independent of any later native or driver visibility", async () => {
  const page = await open("current");
  try {
    await page.evaluate("fixture.press('in',10);fixture.press('handler')");
    await page.waitForFunction("window.records.some(line=>line.includes('done-route-branch-root')&&window.stackState.routes.length===1)");
    // The header and Help content are gone from this React tree. That says nothing about native paint or AX.
    expect(await page.getByRole("button", { name: "Done", exact: true }).count()).toBe(0);
    const result = await page.evaluate<Observed>(read);
    expect(result.phases.filter((phase) => /paint|native|acknowledg|visible|gesture/.test(phase))).toEqual([]);
  } finally { await page.close(); }
});

test("the real emitter delivers native-stack events to this route instance only, and a native pop is not attributed to Done", async () => {
  const result = await observe("current", `const key=window.navigationRef.getCurrentRoute().key;const emit=(type,data)=>window.stackNavigation.emit({type,data,target:key});
    window.stackNavigation.emit({type:'transitionStart',data:{closing:false},target:window.stackState.routes[0].key});
    emit('transitionStart',{closing:false});emit('transitionEnd',{closing:false});emit('gestureCancel');emit('transitionStart',{closing:true});
    window.backMode='drop';fixture.press('handler');await fixture.tick();
    window.stackNavigation.dispatch({type:'POP',payload:{count:1},source:key,target:window.stackState.key});`);
  const phases = fromOpen(result);
  expect(phases).toEqual(["done-route-transition-start-opening", "done-route-transition-end-opening", "done-route-gesture-cancel", "done-route-transition-start-closing",
    "done-handler", "done-router-back-call", "done-router-back-returned", "done-route-before-remove-pop", "done-route-effect-cleanup", "done-route-branch-root"]);
  expect(result.doneIds[result.phases.indexOf("done-route-before-remove-pop")]).toBeUndefined();
  expect(result.doneIds[result.phases.indexOf("done-route-effect-cleanup")]).toBeUndefined();
});

test("two queued calls never borrow one removal, and disposed listeners ignore later events", async () => {
  const result = await observe("current", `const key=window.navigationRef.getCurrentRoute().key;fixture.press('handler');fixture.press('handler');await fixture.tick();
    window.stackNavigation.emit({type:'transitionEnd',data:{closing:true},target:key});window.stackNavigation.emit({type:'blur',target:key});`);
  expect(result.calls.length).toBe(2); expect(result.routes).toEqual(["index"]);
  expect(result.doneIds[result.phases.indexOf("done-route-before-remove-go-back")]).toBeUndefined();
  expect(result.phases.filter((phase) => phase === "done-route-before-remove-go-back").length).toBe(1);
  expect(result.phases.filter((phase) => phase === "done-route-transition-end-closing" || phase === "done-route-blur")).toEqual([]);
});

test("a late out still belongs to its handled activation after real unmount; a missing time fabricates nothing", async () => {
  const result = await observe("current", "fixture.press('in',10);fixture.press('handler');await fixture.tick();fixture.press('out');fixture.press('out',9);fixture.press('out',11);fixture.press('out',12);");
  expect(result.routes).toEqual(["index"]);
  expect(activation(result.phases)).toEqual(["done-press-in", "done-handler", "done-router-back-call", "done-router-back-returned", "done-press-out"]);
  expect(result.phases.indexOf("done-press-out")).toBeGreaterThan(result.phases.indexOf("done-route-effect-cleanup"));
});

test("StrictMode effect replay adds no activation, process start or branch and is labelled as a replay", async () => {
  const result = await observe("current", "fixture.press('in',10);fixture.press('handler');fixture.press('out',11)", { strict: true });
  expect(result.calls.length).toBe(1); expect(result.routes).toEqual(["index"]);
  const opened = result.phases.slice(result.phases.indexOf("done-route-attach"));
  expect(opened.slice(0, 4)).toEqual(["done-route-attach", "done-route-focus", "done-route-effect-cleanup", "done-route-effect-reattach"]);
  expect(result.phases.filter((phase) => phase === "done-process-start").length).toBe(1);
  expect(result.phases.filter((phase) => phase === "done-route-attach").length).toBe(1);
  expect(activation(result.phases)).toEqual(["done-press-in", "done-handler", "done-router-back-call", "done-router-back-returned", "done-press-out"]);
  const consecutive = result.phases.filter((phase) => phase.startsWith("done-route-branch-"));
  expect(consecutive.every((phase, index) => phase !== consecutive[index - 1])).toBe(true);
  expect(result.doneIds[result.phases.lastIndexOf("done-route-effect-cleanup")]).toBe(result.doneIds[result.phases.indexOf("done-press-in")]);
});

test("a suspended Help render records no route until it commits, then one instance attaches", async () => {
  const page = await open("current", { gated: true });
  try {
    await page.getByText("Suspense fixture").waitFor();
    expect((await page.evaluate<Observed>(read)).phases.filter((phase) => phase.startsWith("done-route-") && !phase.startsWith("done-route-branch-"))).toEqual([]);
    await page.evaluate("window.openGate()");
    await page.waitForFunction("window.doneProps&&window.records.some(line=>line.includes('done-route-attach'))");
    expect((await page.evaluate<Observed>(read)).phases.filter((phase) => phase === "done-route-attach").length).toBe(1);
    await page.evaluate("fixture.press('handler')");
    await page.waitForFunction("window.stackState.routes.length===1");
    expect((await page.evaluate<Observed>(read)).phases).toContain("done-route-before-remove-go-back");
  } finally { await page.close(); }
});

test("root unmount disposes the route without inventing a removal", async () => {
  const page = await open("current");
  try {
    await page.evaluate("fixture.press('in',10);fixture.unmount()");
    const lines = await page.evaluate<string[]>("window.records");
    const phases = lines.map((line) => JSON.parse(line.slice(16)).phase);
    expect(phases).toContain("done-observation-detached"); expect(phases).not.toContain("done-route-before-remove-go-back");
    expect(phases).toContain("done-route-effect-cleanup");
  } finally { await page.close(); }
});

test("shipping reads no extra navigation state, adds no press props and keeps original navigation", async () => {
  const result = await observe("shipping", "fixture.press('in',10);fixture.press('handler');fixture.press('out',11)");
  expect(result.calls.length).toBe(1); expect(result.routes).toEqual(["index"]);
  expect(result.lines).toEqual([]); expect(result.hookReads).toEqual({ navigation: 0, segments: 0 });
  const page = await open("shipping");
  try { expect(await page.evaluate<string[]>("[typeof window.doneProps.onPressIn,typeof window.doneProps.onPressOut]")).toEqual(["undefined", "undefined"]); } finally { await page.close(); }
});

test("a throwing sink keeps call count, return, thrown identity and real navigation", async () => {
  for (const mode of ["current", "shipping"]) {
    const result = await observe(mode, "fixture.failSink();window.backMode='throw';fixture.press('in',10);fixture.press('handler');window.backMode='queue';fixture.press('handler');fixture.press('out',11)");
    expect(result.calls.length).toBe(2); expect(result.sameError).toBe(true); expect(result.returned).toBe(true); expect(result.routes).toEqual(["index"]);
  }
});

test("route options, freezeOnBlur, the Done control and Help content match the pinned route", async () => {
  const snapshots = [];
  for (const mode of ["old", "current", "shipping"]) {
    const page = await open(mode);
    try {
      snapshots.push(await page.evaluate(`({keys:Object.keys(window.routeOptions),stack:JSON.stringify(window.stackProps),label:window.doneProps.accessibilityLabel,disabled:window.doneProps.disabled,text:document.body.innerText,help:document.querySelector('section:last-of-type').innerHTML})`));
      await page.getByRole("button", { name: "Done", exact: true }).waitFor();
    } finally { await page.close(); }
  }
  expect(snapshots[0]).toMatchObject({ keys: ["headerRight"], label: "Done", disabled: false });
  expect((snapshots[0] as { stack: string }).stack).toContain('"freezeOnBlur":true');
  expect((snapshots[0] as { stack: string }).stack).toContain('"presentation":"modal"');
  expect(snapshots[1]).toEqual(snapshots[0]); expect(snapshots[2]).toEqual(snapshots[0]);
});
