import { afterAll, beforeAll, expect, test } from "bun:test";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { chromium, type Browser } from "playwright";

const root = resolve(import.meta.dir, "../..");
let browser: Browser;
const scripts: Record<string, string> = {};
const entry = `
import React, {StrictMode,useLayoutEffect} from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {NativeGameScreen} from './apps/mobile/src/screens/NativeGameScreen';
import {LocalProvider} from './apps/mobile/src/local/LocalProvider';
window.records=[];window.calls=[];window.original=new Error('PRIVATE callback error');
console.info=line=>{if(line.startsWith('THIRD_ROLL_INPUT '))window.records.push(JSON.parse(line.slice(17)));};
let app;window.fixture={
 mount(){app=createRoot(document.getElementById('root'));flushSync(()=>app.render(<StrictMode><LocalProvider><NativeGameScreen onHistory={()=>{}} onHelp={function(){window.calls.push(Array.from(arguments));if(window.shouldThrow)throw window.original;return window.original;}}/></LocalProvider></StrictMode>));},
 unmount(){flushSync(()=>app.unmount());},
 invoke(kind,time){const p=window.helpProps;if(kind==='handler'||kind==='argument'){try{window.returned=kind==='argument'?p.onPress(window.original):p.onPress();}catch(e){window.sameError=e===window.original;}}else if(kind==='in')p.onPressIn?.({nativeEvent:{timestamp:time}});else p.onPressOut?.({nativeEvent:{timestamp:time}});},
 failSink(){console.info=()=>{throw new Error('PRIVATE sink');};}
};`;

beforeAll(async () => {
  for (const mode of ["current", "old", "shipping"]) {
    const result = await Bun.build({ entrypoints: ["help-fixture"], target: "browser", format: "iife",
      define: { process: "{}", "process.env.NODE_ENV": '"development"', __DEV__: "true", "process.env.EXPO_PUBLIC_NATIVE_INPUT_TRACE": JSON.stringify(mode === "shipping" ? "0" : "1") },
      plugins: [{ name: "actual-help-lifecycle", setup(build) {
        build.onResolve({ filter: /^help-fixture$/ }, () => ({ path: "entry", namespace: "help" }));
        build.onLoad({ filter: /.*/, namespace: "help" }, () => ({ contents: entry, loader: "tsx", resolveDir: root }));
        build.onResolve({ filter: /^react-native$/ }, () => ({ path: "host", namespace: "host" }));
        build.onLoad({ filter: /.*/, namespace: "host" }, () => ({ loader: "tsx", resolveDir: root, contents: `
          import React,{forwardRef,useLayoutEffect} from 'react';
          import {Pressable as Host} from 'react-native-web';
          export * from 'react-native-web';
          export const Pressable=forwardRef((props,ref)=>{useLayoutEffect(()=>{if(props.accessibilityLabel==='Help')window.helpProps=props;});return <Host {...props} ref={ref}/>;});` }));
        build.onResolve({ filter: /^react-native-safe-area-context$/ }, () => ({ path: resolve(root, "tests/clients/native-safe-area.tsx") }));
        build.onLoad({ filter: /platformStorage\.ts$/ }, () => ({ loader: "ts", contents: "export function createPlatformStorage(){let value=null;return {async getItem(){return value;},async setItem(_key,next){value=next;},async removeItem(){value=null;}};}" }));
        if (mode === "old") build.onLoad({ filter: /NativeGameScreen\.tsx$/ }, async () => {
          // Keep the historical control available in CI's shallow checkout.
          const contents = (await Bun.file(resolve(import.meta.dir, "fixtures/help-baseline-c8.tsx.fixture")).text()).replace(/\r\n/g, "\n");
          if (createHash("sha256").update(contents).digest("hex") !== "9ac442dddc4c9f28d1906d42ad640f41f65225147750029647044ceb7be6a48b") throw new Error("Pinned Help baseline fixture changed");
          return { contents, loader: "tsx", resolveDir: resolve(root, "apps/mobile/src/screens") };
        });
      } }] });
    if (!result.success) throw new Error(result.logs.join("\n"));
    scripts[mode] = await result.outputs[0].text();
  }
  browser = await chromium.launch({ headless: true });
}, 30000);
afterAll(async () => { await browser?.close(); });

async function run(mode: string, commands: string) {
  const page = await browser.newPage();
  try {
    await page.setContent('<div id="root"></div>'); await page.addScriptTag({ content: scripts[mode] });
    await page.evaluate("window.fixture.mount()");
    await page.getByRole("button", { name: "Help", exact: true }).waitFor();
    return await page.evaluate<{ events: { phase: string; helpId: number }[]; calls: unknown[][]; sameError: boolean; returned: boolean; argumentForwarded: boolean }>(`(()=>{${commands};return {events:window.records.filter(e=>e.phase.startsWith('help-')),calls:window.calls,sameError:window.sameError,returned:window.returned===window.original,argumentForwarded:window.calls[0]?.[0]===window.original};})()`);
  } finally { await page.close(); }
}

test("actual Help activation reaches original callback and correlates only JS observations", async () => {
  const result = await run(process.env.HELP_BASELINE === "1" ? "old" : "current", "fixture.invoke('in',10);fixture.invoke('handler');fixture.invoke('out',11)");
  expect(result.calls).toEqual([[]]); expect(result.returned).toBe(true);
  expect(result.events.map((e: { phase: string }) => e.phase)).toEqual(["help-press-in", "help-handler", "help-callback-returned", "help-press-out"]);
  expect(new Set(result.events.map((e: { helpId: number }) => e.helpId)).size).toBe(1);
});
test("pinned old c8 reaches callback without producing Help observations", async () => {
  const result = await run("old", "fixture.invoke('handler')"); expect(result.calls).toEqual([[]]); expect(result.events).toEqual([]);
});
test("original host callback arguments retain identity without entering trace records", async () => {
  for (const mode of ["old", "current"]) {
    const result = await run(mode, "fixture.invoke('argument')");
    expect(result.argumentForwarded).toBe(true); expect(result.returned).toBe(true);
    expect(JSON.stringify(result.events)).not.toContain("PRIVATE");
  }
});
test("out-before-handler, repeated handlers and thrown identity preserve original semantics", async () => {
  const result = await run("current", "fixture.invoke('in',10);fixture.invoke('out',11);fixture.invoke('handler');window.shouldThrow=true;fixture.invoke('handler')");
  expect(result.calls).toEqual([[], []]); expect(result.sameError).toBe(true);
  expect(result.events.map((e: { phase: string }) => e.phase)).toEqual(["help-press-in", "help-press-out", "help-handler", "help-callback-returned", "help-handler", "help-callback-threw"]);
  expect(result.events[4].helpId).not.toBe(result.events[0].helpId);
});
test("supersession, cancellation, late out and StrictMode detach remain conservative", async () => {
  const result = await run("current", "fixture.invoke('in',10);fixture.invoke('in',20);fixture.invoke('out',11);fixture.unmount();fixture.invoke('out',21)");
  expect(result.calls).toEqual([]);
  expect(result.events.map((e: { phase: string }) => e.phase)).toEqual(["help-press-in", "help-observation-superseded", "help-press-in", "help-observation-detached"]);
});
test("unmount after handler permits its own late out; absent event time fabricates no out", async () => {
  const result = await run("current", "fixture.invoke('in',10);fixture.invoke('handler');fixture.unmount();fixture.invoke('out');fixture.invoke('out',11)");
  expect(result.events.map((e: { phase: string }) => e.phase)).toEqual(["help-press-in", "help-handler", "help-callback-returned", "help-press-out"]);
});
test("shipping and throwing sinks preserve callback count/arguments and thrown identity", async () => {
  for (const mode of ["shipping", "current"]) {
    const result = await run(mode, "fixture.failSink();window.shouldThrow=true;fixture.invoke('in',10);fixture.invoke('handler');fixture.invoke('out',11)");
    expect(result.calls).toEqual([[]]); expect(result.sameError).toBe(true); expect(result.events).toEqual([]);
  }
});
