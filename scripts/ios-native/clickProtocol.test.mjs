import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRecorder, LIMIT } from "./click-protocol/record.mjs";
import { digest, insertions, patch, prefix, ORIGINAL_SHA256 } from "./click-protocol/patch.mjs";

const require = createRequire(import.meta.url);
const pw = createRequire(require.resolve("playwright"));
const original = readFileSync(join(dirname(pw.resolve("playwright-core")), "lib/coreBundle.js"), "utf8");
const observed = patch(original);
function recording(clock = () => 12) {
  const rows = [], recorder = createRecorder(row => rows.push(row), clock);
  return { rows, recorder };
}
test("pin and inverse restoration cover every observation insertion", () => {
  assert.equal(digest(original), ORIGINAL_SHA256);
  let inverse = observed.slice(prefix.length);
  for (const [before, after] of [...insertions].reverse()) {
    assert.equal(inverse.split(after).length, 2); inverse = inverse.replace(after, before);
  }
  assert.equal(inverse, original);
  assert.throws(() => patch(original + " "));
  assert.throws(() => patch(observed));
});
test("only the active original click records finite payload-free protocol classifications", () => {
  const { rows, recorder: r } = recording();
  r.send(1, "Input.dispatchMouseEvent"); r.edge(2, 0); assert.equal(rows.length, 0);
  r.begin();
  for (const [id, method] of [[1,"Input.dispatchMouseEvent"],[2,"Runtime.callFunctionOn"],[3,"Runtime.evaluate"],[4,"Runtime.releaseObject"],[5,"PRIVATE URL SQL TOKEN"]]) r.send(id, method);
  r.receive(99, false); r.receive(2, true); r.receive(1, false); r.receive(1, false);
  r.complete(false); r.send(6, "Runtime.evaluate");
  assert.deepEqual(rows.at(-1), { v:1,sequence:rows.length-1,request:1,stage:1,edge:1,method:0,id:0,connection:0,monoUs:0 });
  assert.deepEqual(rows.filter(x => x.stage === 4 && x.edge === 0).map(x => x.method), [1,2,3,4,0]);
  assert.deepEqual(rows.filter(x => x.stage === 4 && x.edge !== 0).map(x => [x.id,x.edge]), [[2,2],[1,1]]);
  assert.equal(r.state().pending, 3);
  assert.equal(JSON.stringify(rows).includes("PRIVATE"), false);
  for (const [i,row] of rows.entries()) {
    assert.equal(row.sequence, i); assert.deepEqual(Object.keys(row), ["v","sequence","request","stage","edge","method","id","connection","monoUs"]);
    assert.equal(Object.values(row).every(Number.isSafeInteger), true);
  }
});
test("sink and clock exceptions, regressions and malformed IDs remain isolated and partial", () => {
  const r = createRecorder(() => { throw Error("PRIVATE"); }, () => { throw Error("PRIVATE CLOCK"); });
  assert.doesNotThrow(() => { r.begin(); r.send(1,"Runtime.evaluate"); r.receive(1,true); r.complete(true); });
  assert.equal(r.state().partial, true);
  const {recorder: completed,rows: endings}=recording();completed.begin();completed.complete(true);assert.equal(endings.at(-1).edge,2);
  const { recorder: q, rows } = recording((() => { let n = 6; return () => n--; })());
  q.begin(); q.edge(2, 0); q.edge(99, 0); q.send(-1,"Runtime.evaluate"); q.send(Infinity,"Runtime.evaluate"); q.complete(false);
  assert.equal(q.state().partial,true); assert.equal(rows.every(x => x.monoUs === 0), true);
});
test("budget is bounded, duplicate activation cannot reset IDs, missing completion stays active", () => {
  const { recorder: r, rows } = recording(); r.begin(); r.begin();
  for (let i=1;i<1000;i++) r.send(i,"Runtime.evaluate");
  assert.equal(rows.length,LIMIT); assert.equal(r.state().exhausted,true);
  assert.equal(r.state().partial,true); assert.equal(r.state().active,true);
  assert.ok(r.state().pending <= LIMIT); r.complete(true); assert.equal(rows.length,LIMIT);
});

// Execute the actual pinned pointer callback and CR connection methods, not a mirror.
const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
function pointer(source) {
  const start = source.indexOf('        const actionResult = await this._page.frameManager.waitForSignalsCreatedBy');
  const end = source.indexOf('        progress2.log("  navigations have finished");', start);
  assert.ok(start > 0 && end > start);
  return new AsyncFunction("__hsClick", "action", "progress2", "options", "point", "hitTargetInterceptionHandle", "actionName", source.slice(start,end) + '\nreturn "done";');
}
function setup(recorder, action, stop = () => "done") {
  const effects = [], point = { x: 11, y: 12 }, marker = {};
  const progress = { race: value => value, log: () => {} };
  const context = {
    _page: { frameManager: { waitForSignalsCreatedBy: (_p, wait, fn) => { effects.push(wait); return fn(progress); } } },
    _frame: { raceAgainstEvaluationStallingEvents: fn => fn() },
  };
  const handle = { evaluate: () => { effects.push("evaluate"); return Promise.resolve().then(stop); }, dispose: () => effects.push("dispose") };
  return { effects, point, marker, run: source => pointer(source).call(context, recorder, (...args) => { effects.push(args); return action(marker); }, progress, {waitAfter:true}, point, handle, "click") };
}
test("actual pointer block preserves forward-once arguments/results and thrown identity", async () => {
  for (const fails of [false,true]) {
    const runs = [];
    for (const source of [original,observed]) {
      const {recorder:r,rows} = recording(); r.begin(); const error = {};
      let calls=0;
      const control = setup(r, () => { calls++; if(fails)throw error; return Promise.resolve("original value"); });
      if(fails) await assert.rejects(control.run(source), e => e === error);
      else assert.equal(await control.run(source), "done");
      assert.equal(calls,1); assert.equal(control.effects[1][1],control.point);
      runs.push({ effects:control.effects.map(x => Array.isArray(x)?"action":x), rows });
    }
    assert.deepEqual(runs[0].effects,runs[1].effects);
    assert.equal(runs[0].rows.some(x=>x.stage===2),false);
    assert.equal(runs[1].rows.some(x=>x.stage===2 && x.edge===(fails?2:1)),true);
  }
});
test("pending mouse versus pending interceptor produce distinct positive prefixes without a timer", async () => {
  for (const boundary of [2,5]) {
    let release; const held = new Promise(r => { release=r; });
    const {recorder:r,rows} = recording(); r.begin();
    const control = setup(r, () => boundary===2?held:Promise.resolve(), () => boundary===5?held:"done");
    const pending = control.run(observed);
    for(let i=0;i<12;i++) await Promise.resolve();
    assert.equal(rows.some(x=>x.stage===boundary && x.edge===0),true);
    assert.equal(rows.some(x=>x.stage===boundary && x.edge===1),false);
    assert.equal(rows.some(x=>x.stage===6),false);
    release("done"); assert.equal(await pending,"done");
    assert.equal(rows.some(x=>x.stage===boundary && x.edge===1),true);
  }
});
test("original swallowed interceptor rejection and non-done result keep the same result", async () => {
  for (const stop of [() => {throw {};}, () => "blocked"]) {
    const values=[];
    for(const source of [original,observed]) {
      const {recorder:r}=recording();r.begin();values.push(await setup(r,()=>Promise.resolve(),stop).run(source));
    }
    assert.deepEqual(values,[values[0],values[0]]);
  }
});
test("actual CR raw send forwards the exact message once and rethrows transport identity", () => {
  for(const source of [original,observed]) {
    const start=source.indexOf('      _rawSend(sessionId, method, params2) {');
    const end=source.indexOf('      async _onMessage(message) {',start);
    const body=source.slice(start,end).replace('_rawSend(sessionId, method, params2)', 'function(sessionId, method, params2)');
    const {recorder:r,rows}=recording();r.begin();
    const rawSend=new Function('__hsClick','return ('+body.trim()+');')(r);
    const params={private:"SECRET"}, messages=[], failure={};
    const context={_lastId:0,_protocolLogger:()=>{},_transport:{send: message=>messages.push(message)}};
    assert.equal(rawSend.call(context,"SESSION","Input.dispatchMouseEvent",params),1);
    assert.equal(messages.length,1);assert.equal(messages[0].params,params);
    context._transport.send=()=>{throw failure;};
    assert.throws(()=>rawSend.call(context,"SESSION","Runtime.evaluate",params), e=>e===failure);
    assert.equal(JSON.stringify(rows).includes("SECRET"),false);
  }
});
test("actual Chromium response observer preserves exact message forwarding and close handling", async () => {
  for(const source of [original,observed]) {
    const start=source.indexOf('      async _onMessage(message) {',source.indexOf('_rawSend(sessionId, method, params2) {'));
    const end=source.indexOf('      _onClose(reason) {',start);
    const body=source.slice(start,end).replace('async _onMessage(message)', 'async function(message)');
    const {recorder:r,rows}=recording();r.begin();
    const receive=new Function('__hsClick','kBrowserCloseMessageId','return ('+body.trim()+');')(r,-9);
    const forwarded=[], message={id:9,result:{private:"SECRET"},sessionId:"PRIVATE"};
    const context={_protocolLogger:()=>{},_sessions:new Map([["PRIVATE",{_onMessage:m=>forwarded.push(m)}]])};
    r.send(9,"Runtime.callFunctionOn",context);
    await receive.call(context,message); await receive.call(context,{id:-9});
    assert.deepEqual(forwarded,[message]);assert.equal(forwarded[0],message);
    assert.equal(rows.some(x=>x.stage===4 && x.edge===1),source===observed);
    assert.equal(JSON.stringify(rows).includes("SECRET"),false);
  }
});
test("CDP IDs from different connections never cross-correlate and multiple owners stay partial", () => {
  const {recorder:r,rows}=recording();r.begin();const a={},b={};
  r.send(1,"Input.dispatchMouseEvent",a);r.send(1,"Runtime.callFunctionOn",b);
  r.receive(1,false,{});r.receive(1,true,b);r.receive(1,false,a);r.complete(false);
  assert.deepEqual(rows.filter(x=>x.stage===4).map(x=>[x.connection,x.method,x.edge]),[[1,1,0],[2,2,0],[2,2,2],[1,1,1]]);
  assert.equal(r.state().pending,0);assert.equal(r.state().partial,true);
});
test("actual client click response keeps validator, result and error identities and filters other calls", () => {
  for(const failed of [false,true]) for(const method of ["click","evaluateExpression"]) for(const source of [original,observed]) {
    const start=source.indexOf('        if (id) {\n          if (debugLogger.isEnabled("channel"))');
    const end=source.indexOf('        if (debugLogger.isEnabled("channel"))',start+40);
    const block=source.slice(start,end);
    const {recorder:r,rows}=recording();r.begin();
    const received=[], value={}, error={}, callback={type:"Frame",method,resolve:v=>received.push(v),reject:e=>received.push(e)};
    const dependencies=['__hsClick','debugLogger','parseError2','AbortError2','rewriteErrorMessage','formatCallLog','maybeFindValidator','findValidator'];
    const dispatch=new Function(...dependencies,'return function(id,result2,error,log2,errorDetails){'+block+'};')(
      r,{isEnabled:()=>false},e=>e,Error,()=>{},()=>"",()=>undefined,()=>v=>v);
    const context={_callbacks:new Map([[3,callback]]),_validatorFromWireContext:()=>({})};
    dispatch.call(context,3,failed?undefined:value,failed?error:undefined,[],undefined);
    assert.equal(received.length,1);assert.equal(received[0],failed?error:value);assert.equal(context._callbacks.size,0);
    assert.equal(rows.some(x=>x.stage===8&&x.edge===(failed?2:1)),source===observed&&method==="click");
  }
});
