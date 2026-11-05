import { afterAll, beforeAll, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { chromium, type Browser } from "playwright";

const root = resolve(import.meta.dir, "../..");
let browser: Browser;
const scripts: Record<string, string> = {};
const entry = `
import React,{StrictMode} from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';
import {LocalProvider,useLocalGame} from './apps/mobile/src/local/LocalProvider';
import {Setup} from './apps/mobile/src/screens/Setup';
import {showChoice} from './apps/mobile/src/ui/showChoice.ios';
window.records=[];window.sheets=[];window.selects=[];window.original=new Error('PRIVATE original');
console.info=line=>{if(line.startsWith('THIRD_ROLL_INPUT '))window.records.push(JSON.parse(line.slice(17)));};
function Screen(){const {view,store}=useLocalGame();window.store=store;window.view=view;return view.data?<Setup onStart={()=>{}} onResume={()=>{}} confirm={()=>{}}/>:null;}
let app;window.fixture={mount(){app=createRoot(document.getElementById('root'));flushSync(()=>app.render(<StrictMode><LocalProvider><Screen/></LocalProvider></StrictMode>));},unmount(){flushSync(()=>app.unmount());},
 invoke(kind,time){const p=window.pickerProps;if(kind==='handler')p.onPress();else if(kind==='in')p.onPressIn?.({nativeEvent:{timestamp:time}});else p.onPressOut?.({nativeEvent:{timestamp:time}});},
 callback(sheet,index){window.sheets[sheet].callback(index);},
 direct(index,broken=false,throws=false){window.selects=[];try{window.directResult=showChoice('PRIVATE title',['a','b','c','d'],0,function(){window.selects.push(Array.from(arguments));if(throws)throw window.original;},true,broken?()=>{throw new Error('PRIVATE observer');}:undefined);window.sheets.at(-1).callback(index);}catch(e){window.sameError=e===window.original;}},
 failSink(){console.info=()=>{throw new Error('PRIVATE sink');};},
 nonopted(){window.choiceProps['Dice count'].onPress();},
 failClock(){Date.now=()=>{throw new Error('PRIVATE clock');};}
};`;
beforeAll(async () => {
  for (const mode of ["current", "old", "shipping", "inline"]) {
    const result = await Bun.build({ entrypoints: ["picker-fixture"], target: "browser", format: "iife",
      define: { process: "{}", "process.env.NODE_ENV": '"development"', __DEV__: "true", "process.env.EXPO_PUBLIC_NATIVE_INPUT_TRACE": JSON.stringify(mode === "shipping" ? "0" : "1") },
      plugins: [{ name: "actual-picker-boundary", setup(build) {
        build.onResolve({ filter: /^picker-fixture$/ }, () => ({ path: "entry", namespace: "picker" }));
        build.onLoad({ filter: /.*/, namespace: "picker" }, () => ({ contents: entry, loader: "tsx", resolveDir: root }));
        build.onResolve({ filter: /^\.\/showChoice$/ }, ({ importer }) => importer.endsWith("Choice.tsx") ? { path: resolve(root, `apps/mobile/src/ui/showChoice${mode === "inline" ? "" : ".ios"}.ts`) } : undefined);
        build.onResolve({ filter: /^react-native$/ }, () => ({ path: "host", namespace: "host" }));
        build.onLoad({ filter: /.*/, namespace: "host" }, () => ({ loader: "tsx", resolveDir: root, contents: `
          import React,{forwardRef,useLayoutEffect} from 'react';import {Pressable as Host} from 'react-native-web';export * from 'react-native-web';
          export const ActionSheetIOS={showActionSheetWithOptions(options,callback){window.sheets.push({options,callback});if(window.bridgeThrow)throw window.original;if(window.immediate!==undefined)callback(window.immediate);}};
          export const Pressable=forwardRef((props,ref)=>{useLayoutEffect(()=>{window.choiceProps??={};window.choiceProps[props.accessibilityLabel]=props;if(props.accessibilityLabel==='AI opponents')window.pickerProps=props;});return <Host {...props} ref={ref}/>;});` }));
        build.onLoad({ filter: /platformStorage\.ts$/ }, () => ({ loader: "ts", contents: "export function createPlatformStorage(){let value=null;return {async getItem(){return value;},async setItem(_key,next){if(window.holdWrite)await new Promise(r=>window.releaseWrite=r);value=next;},async removeItem(){value=null;}};}" }));
        if (mode === "old") build.onLoad({ filter: /[\\/]Choice\.tsx$/ }, async () => {
          const contents = (await Bun.file(resolve(import.meta.dir, "fixtures/picker-baseline-70e.tsx.fixture")).text()).replace(/\r\n/g, "\n");
          if (createHash("sha256").update(contents).digest("hex") !== "69cb2cd6ba5188d633446967dbe7a5f38df36b5b17e4be61e7fd27cc36e71f8f") throw new Error("Picker baseline changed");
          return { contents, loader: "tsx", resolveDir: resolve(root, "apps/mobile/src/ui") };
        });
      } }] });
    if (!result.success) throw new Error(result.logs.join("\n")); scripts[mode] = await result.outputs[0].text();
  }
  browser = await chromium.launch({ headless: true });
}, 30000);
afterAll(async () => { await browser?.close(); });
type Result = { events: { phase: string; pickerId: number }[]; options: { title: string; message: string; options: string[]; cancelButtonIndex: number; userInterfaceStyle: string }[]; ai: number; sameError: boolean; selects: unknown[][]; disabled: boolean; directResult: boolean };
async function run(mode: string, commands: string) {
  const page = await browser.newPage();
  try {
    await page.setContent('<div id="root"></div>'); await page.addScriptTag({ content: scripts[mode] }); await page.evaluate("fixture.mount()");
    await page.getByRole("button", { name: "AI opponents", exact: true }).waitFor();
    return await page.evaluate<Result>(`(async()=>{${commands};return {events:window.records.filter(e=>e.phase.startsWith('picker-')),options:window.sheets.map(s=>s.options),ai:window.store.getSnapshot().data.preferences.aiOpponents,sameError:window.sameError,selects:window.selects,disabled:window.pickerProps.disabled,directResult:window.directResult};})()`);
  } finally { await page.close(); }
}
const phases = (r: Result) => r.events.map((e) => e.phase);
test("original row reaches native boundary and correlates activation, call, return and selection", async () => {
  const r = await run(process.env.PICKER_BASELINE === "1" ? "old" : "current", "fixture.invoke('in',10);fixture.invoke('handler');fixture.invoke('out',11);fixture.callback(0,2);await new Promise(r=>setTimeout(r,0))");
  expect(r.options).toHaveLength(1); expect(r.options[0]).toEqual({ title: "AI opponents", message: "Current: Solo", options: ["Solo", "1 AI", "2 AI", "3 AI", "Cancel"], cancelButtonIndex: 4, userInterfaceStyle: "light" }); expect(r.ai).toBe(2);
  expect(phases(r)).toEqual(["picker-press-in", "picker-handler", "picker-native-call", "picker-native-returned", "picker-press-out", "picker-callback-option-2"]); expect(new Set(r.events.map(e=>e.pickerId)).size).toBe(1);
});
test("old committed source reaches bridge but lacks picker phases", async () => { const r = await run("old", "fixture.invoke('handler')"); expect(r.options).toHaveLength(1); expect(r.events).toEqual([]); });
test("late older callbacks retain original behavior without borrowing the newer request", async () => {
  const r = await run("current", "fixture.invoke('in',10);fixture.invoke('handler');fixture.invoke('in',20);fixture.invoke('handler');fixture.invoke('out',11);fixture.callback(0,1);await new Promise(r=>setTimeout(r,0));fixture.callback(1,4)");
  expect(r.ai).toBe(1); expect(phases(r)).toContain("picker-observation-disabled"); expect(phases(r)).not.toContain("picker-press-out");
  const late = r.events.filter(e=>e.phase==='picker-callback-late'); expect(late).toHaveLength(2); expect(late[0].pickerId).not.toBe(late[1].pickerId);
});
test("unmount/cancel/invalid callback keep JS semantics, unknown is not option evidence", async () => {
  const r = await run("current", "fixture.invoke('in',10);fixture.invoke('out',11);fixture.invoke('handler');fixture.callback(0,undefined);fixture.unmount();fixture.callback(0,4)");
  expect(phases(r)).toContain("picker-callback-unknown"); expect(phases(r)).toContain("picker-callback-late"); expect(r.ai).toBe(0);
});
test("unhandled detach and disabled state are observed without bridge calls", async () => {
  const r = await run("current", "fixture.invoke('in',10);fixture.unmount();fixture.invoke('out',11)"); expect(r.options).toEqual([]); expect(phases(r)).toEqual(["picker-press-in", "picker-observation-detached"]);
});
for (const index of [-1, 1.5, "1", null, 4, undefined]) test(`native helper preserves original index ${String(index)} and throwing observer/callback behavior`, async () => {
    const r = await run("current", `fixture.direct(${JSON.stringify(index) ?? "undefined"},true,true)`);
    expect(r.options).toHaveLength(1); expect(r.directResult).toBe(true);
    expect(r.options[0].userInterfaceStyle).toBe("dark");
    expect(r.selects.length).toBe(index !== undefined && Number(index) < 4 ? 1 : 0);
    if (r.selects.length) { expect(r.sameError).toBe(true); expect(r.selects[0]).toEqual([index]); }
});
test("active cancellation and unknown row callback data are distinct positive observations", async () => {
  const cancel = await run("current", "fixture.invoke('handler');fixture.callback(0,4)"); expect(phases(cancel)).toContain("picker-callback-cancel"); expect(cancel.ai).toBe(0);
  const unknown = await run("current", "fixture.invoke('handler');fixture.callback(0,undefined)"); expect(phases(unknown)).toContain("picker-callback-unknown"); expect(unknown.ai).toBe(0);
});
test("shipping, sink/clock failures and native thrown identity do not change calls", async () => {
  for (const mode of ["shipping", "current"]) {
    const r = await run(mode, "fixture.failSink();window.bridgeThrow=true;try{fixture.invoke('handler')}catch(e){window.sameError=e===window.original;}"); expect(r.options).toHaveLength(1); expect(r.sameError).toBe(true); expect(r.events).toEqual([]);
  }
  const r = await run("current", "fixture.failClock();fixture.invoke('handler')"); expect(r.options).toHaveLength(1); expect(r.events).toEqual([]);
});
test("non-iOS stays inline with no native call and nonopted choices stay unobserved", async () => {
  const r = await run("inline", "fixture.invoke('handler')"); expect(r.options).toEqual([]); expect(phases(r)).toEqual(["picker-handler", "picker-inline-fallback"]);
  const native = await run("current", "fixture.nonopted()"); expect(native.options[0].title).toBe("Dice count"); expect(native.events).toEqual([]);
});
test("synchronous bridge callbacks retain original callback-before-return ordering", async () => {
  const r = await run("current", "window.immediate=0;fixture.invoke('handler')"); expect(phases(r)).toEqual(["picker-handler", "picker-native-call", "picker-callback-option-0", "picker-native-returned"]);
});
test("real pending persistence disables the row and retires only its observation", async () => {
  const r = await run("current", "fixture.invoke('in',10);window.holdWrite=true;const pending=window.store.preferences({appearance:'dark'});await new Promise(r=>setTimeout(r,0));window.disabledObserved=window.pickerProps.disabled;window.releaseWrite();await pending");
  expect(r.options).toEqual([]); expect(phases(r)).toEqual(["picker-press-in", "picker-observation-disabled"]);
});
test("native-call synchronous throw preserves identity and never claims return/presentation", async () => {
  const r = await run("current", "window.bridgeThrow=true;try{fixture.invoke('handler')}catch(e){window.sameError=e===window.original;}");
  expect(r.sameError).toBe(true); expect(phases(r)).toEqual(["picker-handler", "picker-native-call", "picker-native-threw"]);
});
