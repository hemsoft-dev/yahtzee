import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { bounds } from "../ios-native/geometry.mjs";
import { showScene, frameScoreSection } from "./scene.mjs";
import { SCENES } from "./plan.ts";

test("retained medium-phone scoring layout needs its profile-specific Combinations anchor", async () => {
  // Run41637167404, phone-63 scoring: Numbers aligned, but the target ends
  // 59pt beyond the viewport. Keep the native duplicate heading wrappers.
  const screen = { ui_schema: { platform: "ios", defaults: { enabled: true } }, elements: [
    { rid: "score-viewport", b: "[0,164][402,772]", c: [
      { b: "[20,181][382,205]", a11y: "Numbers", c: [{ b: "[20,181][382,205]", a11y: "Numbers" }] },
      { b: "[20,573][382,597]", a11y: "Combinations", c: [{ b: "[20,573][382,597]", a11y: "Combinations" }] },
      { b: "[20,775][382,831]", a11y: "Score Three of a Kind, 15 points", rid: "score-three-of-a-kind" },
    ] },
  ] };
  const scene = SCENES.find((item) => item.id === "scoring");
  const old = harness(structuredClone(screen));
  await assert.rejects(frameScoreSection(scene, ["three-of-a-kind"], old.io), /fully reachable/);
  const commands = [], records = [];
  await showScene(scene, ["three-of-a-kind"], {
    inspect: async () => screen, record: (item) => records.push(item),
    run: async (steps) => {
      commands.push(...steps);
      for (const { swipe } of steps) if (swipe) {
        const delta = Number(swipe.end.split(",")[1]) - Number(swipe.start.split(",")[1]);
        function move(nodes) {
          for (const node of nodes) {
            const rect = bounds(node.b); node.b = `[${rect.left},${rect.top + delta}][${rect.right},${rect.bottom + delta}]`;
            if (node.c) move(node.c);
          }
        }
        move(screen.elements[0].c);
      }
    },
  }, "phone-63");
  const final = records.at(-1);
  assert.equal(final.action, "framed");
  assert(Math.abs(final.anchor.top - 180) <= 8);
  assert(final.target.bottom <= 764);
  assert.deepEqual(commands.filter((step) => step.tapOn).map((step) => step.tapOn.text), ["Resume Game"]);
});

function harness(screen) {
  const commands = [], records = [];
  return { commands, records, io: { run: async (steps) => commands.push(...steps), inspect: async () => screen, record: (item) => records.push(item) } };
}
const native = (held = true, clipped = false) => ({ ui_schema: { platform: "ios", defaults: { enabled: true } }, elements: [
  { rid: "score-viewport", b: "[0,164][402,772]", c: [
    { rid: "die-0", b: clipped ? "[71,730][127,810]" : "[71,358][127,438]", val: held ? "checkbox, checked, Held" : "checkbox, unchecked, Not held" },
    { rid: "score-three-of-a-kind", b: "[20,500][382,556]", a11y: "Three of a Kind, 15 points" },
  ] },
] });
// Bounds retained from run 41619425999's phone setup hierarchy. The original
// Appearance button extended 20pt beyond the scroll viewport despite readiness.
const setupScreen = (bottom = 942) => ({ ui_schema: { platform: "ios", defaults: { enabled: true } }, elements: [
  { rid: "setup-viewport", b: "[0,164][440,922]", c: [{ b: "[0,164][440,970]", c: [
    { b: "[20,180][420,204]", a11y: "Players" },
    { b: `[20,800][420,${bottom}]`, a11y: "Appearance", txt: "Light", val: "Light" },
  ] }] },
] });
test("setup rejects the captured clipped appearance row even when semantic readiness passes", async () => {
  const scene = { view: "setup", focus: "A little time for dice." };
  const clipped = harness(setupScreen());
  await assert.rejects(showScene(scene, [], clipped.io), /clipped/);
  const visible = harness(setupScreen(878));
  await showScene(scene, [], visible.io);
  assert.equal(visible.records[0].action, "framed");
  assert(!visible.commands.some((step) => step.tapOn || step.swipe));
  const missingScreen = setupScreen(878); missingScreen.elements[0].c[0].c.pop();
  const missing = harness(missingScreen);
  await assert.rejects(showScene(scene, [], missing.io), /one explicit/);
});
test("medium phone setup scrolls within its real boundary and stops when the settings fit", async () => {
  const screen = setupScreen(878), pane = screen.elements[0], content = pane.c[0];
  pane.b = "[0,164][440,840]"; content.b = "[0,164][440,906]";
  content.c[0].b = "[20,289][420,313]";
  const commands = [], records = []; let scroll = 0;
  await showScene({ view: "setup", focus: "A little time for dice." }, [], {
    inspect: async () => screen, record: (item) => records.push(item),
    run: async (steps) => {
      commands.push(...steps);
      for (const { swipe } of steps) if (swipe) {
        const start = Number(swipe.start.split(",")[1]), end = Number(swipe.end.split(",")[1]);
        const heading = bounds(content.c[0].b);
        assert(start >= heading.top && start <= heading.bottom, "Gesture must start on Players, not a setting.");
        const movement = Math.min(66 - scroll, start - end - 20); scroll += movement;
        for (const node of content.c) {
          const rect = bounds(node.b); node.b = `[${rect.left},${rect.top - movement}][${rect.right},${rect.bottom - movement}]`;
        }
      }
    },
  });
  assert(scroll > 0 && scroll <= 66);
  assert.equal(records.at(-1).action, "framed");
  assert(records.at(-1).target.bottom <= 840);
  assert(!commands.some((step) => step.tapOn));
});
test("holding capture navigates to the preloaded game without toggling or rolling", async () => {
  const flow = harness(native());
  await showScene({ view: "play", focus: "die-0" }, [], flow.io);
  assert.deepEqual(flow.commands.filter((step) => step.tapOn).map((step) => step.tapOn.text), ["Resume Game"]);
  assert.deepEqual(flow.commands[0], { launchApp: { stopApp: false, clearState: false, permissions: { all: "deny" } } });
  assert.equal(flow.records[0].action, "ready");
});
test("holding capture rejects clipped or unheld dice rather than altering the fixture", async () => {
  for (const screen of [native(false), native(true, true)]) {
    const flow = harness(screen);
    await assert.rejects(showScene({ view: "play", focus: "die-0" }, [], flow.io), /clipped|held die/);
    assert.equal(flow.commands.filter((step) => step.tapOn).length, 1);
  }
});
test("combination capture verifies score reachability but never records the score", async () => {
  const flow = harness(native());
  await showScene({ view: "play", focus: "score-three-of-a-kind" }, ["three-of-a-kind"], flow.io);
  assert.equal(flow.records[0].action, "tap");
  assert.deepEqual(flow.commands.filter((step) => step.tapOn).map((step) => step.tapOn.text), ["Resume Game"]);
});
test("a permanently disabled score focus is bounded and never tapped", async () => {
  const screen = native(); screen.elements[0].c[1].enabled = false;
  const flow = harness(screen);
  await assert.rejects(showScene({ view: "play", focus: "score-three-of-a-kind" }, ["three-of-a-kind"], flow.io), /30 inspections/);
  assert.equal(flow.records.length, 30);
  assert.equal(flow.commands.filter((step) => step.tapOn).length, 1);
});
test("setup, results and history use semantic readiness instead of arbitrary sleeps", async () => {
  for (const scene of [{ view: "setup", focus: "A little time for dice." }, { view: "results", focus: "Game Over!" }, { view: "history", focus: "Recent games" }]) {
    const flow = harness(scene.view === "setup" ? setupScreen(878) : native()); await showScene(scene, [], flow.io);
    const taps = flow.commands.filter((step) => step.tapOn).map((step) => step.tapOn);
    assert.deepEqual(taps.map((tap) => tap.text), scene.view === "setup" ? [] : [scene.view === "results" ? "Review saved result" : "History"]);
    assert(taps.every((tap) => tap.retryTapIfNoChange === false));
    assert(flow.commands.some((step) => step.extendedWaitUntil));
    assert(!flow.commands.some((step) => step.repeat || step.sleep));
  }
});

test("section framing uses bounded viewport swipes and retains reachable score focus without tapping", async () => {
  for (const initialTop of [150, 600]) {
    let top = initialTop, targetTop = initialTop + 40;
    const commands = [], records = [];
    await frameScoreSection({ anchorLabel: "Combinations", focus: "score-three-of-a-kind" }, ["three-of-a-kind"], {
      inspect: async () => {
        const screen = native();
        screen.elements[0].c[1].b = `[20,${targetTop}][382,${targetTop + 56}]`;
        const heading = { a11y: "Combinations", b: `[20,${top}][382,${top + 24}]` };
        screen.elements[0].c.push({ ...heading, c: [heading] }); return screen;
      },
      run: async (steps) => {
        commands.push(...steps);
        if (steps[0].swipe) {
          const swipe = steps[0].swipe;
          assert.equal(swipe.duration, 1000); assert(swipe.start.startsWith("201,"));
          const movement = Number(swipe.end.split(",")[1]) - Number(swipe.start.split(",")[1]);
          assert(Math.abs(movement) <= 110); top += movement; targetTop += movement;
        }
      }, record: (item) => records.push(item),
    });
    assert(Math.abs(top - 180) <= 8); assert(targetTop >= 172 && targetTop + 56 <= 764);
    assert(!commands.some((step) => step.tapOn)); assert.equal(records.at(-1).action, "framed");
  }
});
test("framing cannot succeed with ambiguous headings or an unreachable final score", async () => {
  for (const ambiguous of [true, false]) {
    const screen = native();
    screen.elements[0].c.push({ a11y: "Numbers", b: "[20,180][382,204]" });
    if (ambiguous) screen.elements[0].c.push({ a11y: "Numbers", b: "[20,220][382,244]" });
    else screen.elements[0].c[1].b = "[20,750][382,806]";
    const flow = harness(screen);
    await assert.rejects(frameScoreSection({ anchorLabel: "Numbers", focus: "score-three-of-a-kind" }, ["three-of-a-kind"], flow.io), /Ambiguous|fully reachable/);
    assert(!flow.commands.some((step) => step.tapOn));
  }
});
test("retained phone hierarchy excerpts keep native duplicate heading wrappers and frame both score-focused scenes", async () => {
  const fixture = JSON.parse(readFileSync(new URL("./fixtures/phone-section-headings.json", import.meta.url), "utf8"));
  for (const { anchorLabel, focus, screen } of fixture.cases) {
    const records = [], pane = screen.elements[0];
    assert(Math.abs(bounds(pane.c[0].b).top - 180) > 8, "Historical capture already met the new frame contract.");
    await frameScoreSection({ anchorLabel, focus }, [focus.slice(6)], {
      inspect: async () => screen, record: (item) => records.push(item),
      run: async (steps) => {
        const swipe = steps[0].swipe; if (!swipe) return;
        const delta = Number(swipe.end.split(",")[1]) - Number(swipe.start.split(",")[1]);
        function move(nodes) {
          for (const node of nodes) {
            const rect = bounds(node.b); node.b = `[${rect.left},${rect.top + delta}][${rect.right},${rect.bottom + delta}]`;
            if (node.c) move(node.c);
          }
        }
        move(pane.c);
      },
    });
    assert.equal(records.at(-1).action, "framed");
    assert(Math.abs(bounds(pane.c[0].b).top - 180) <= 8);
  }
});
test("stuck or missing section headings fail after at most thirty inspections", async () => {
  const flow = harness(native());
  await assert.rejects(frameScoreSection({ anchorLabel: "Numbers", focus: "score-three-of-a-kind" }, ["three-of-a-kind"], flow.io), /30 inspections/);
  assert.equal(flow.records.length, 30); assert(!flow.commands.some((step) => step.tapOn));
});

test("captured phone correction converges through 11 to 20 point native touch slop without touching a score row", async () => {
  for (const touchSlop of [11, 20]) {
    const fixture = JSON.parse(readFileSync(new URL("./fixtures/phone-section-headings.json", import.meta.url), "utf8"));
    const { screen, anchorLabel, focus } = fixture.cases[0], pane = screen.elements[0];
    const records = []; let gestures = 0;
    await frameScoreSection({ anchorLabel, focus }, [focus.slice(6)], {
      inspect: async () => screen, record: (item) => records.push(item),
      run: async (steps) => {
        const swipe = steps[0].swipe; if (!swipe) return;
        gestures++;
        const start = Number(swipe.start.split(",")[1]), end = Number(swipe.end.split(",")[1]);
        const heading = bounds(pane.c[0].b), viewport = bounds(pane.b);
        assert(start >= Math.max(heading.top, viewport.top + 4) && start <= Math.min(heading.bottom, viewport.bottom - 4), "Correction must start on the noninteractive heading.");
        assert(Math.abs(end - start) >= 24, "Tiny native gestures can become score presses.");
        const delta = Math.sign(end - start) * Math.max(0, Math.abs(end - start) - touchSlop);
        function move(nodes) {
          for (const node of nodes) {
            const rect = bounds(node.b); node.b = `[${rect.left},${rect.top + delta}][${rect.right},${rect.bottom + delta}]`;
            if (node.c) move(node.c);
          }
        }
        move(pane.c);
      },
    });
    assert(gestures <= 3); assert.equal(records.at(-1).action, "framed");
    assert(Math.abs(bounds(pane.c[0].b).top - 180) <= 8);
  }
});
test("tall tablet uses Numbers context while an unreachable lower heading fails at the scroll boundary", async () => {
  const source = readFileSync(new URL("./plan.ts", import.meta.url), "utf8");
  assert.match(source, /focus: "score-three-of-a-kind", anchorLabel: "Numbers"/);
  for (const impossible of [false, true]) {
    let top = impossible ? 368 : 176;
    const screen = { ui_schema: { platform: "ios", defaults: { enabled: true } }, elements: [
      { rid: "score-viewport", b: "[340,134][1032,1356]", c: [
        { a11y: "Numbers", b: `[360,${top}][1012,${top + 24}]` },
        { rid: "score-three-of-a-kind", a11y: "Three of a Kind, 15 points", b: "[360,770][1012,826]" },
      ] },
    ] };
    let gestures = 0;
    const invoke = frameScoreSection({ anchorLabel: "Numbers", focus: "score-three-of-a-kind" }, ["three-of-a-kind"], {
      inspect: async () => screen, record: () => {}, run: async (steps) => {
        const swipe = steps[0].swipe; if (!swipe) return;
        gestures++;
        const requested = Number(swipe.end.split(",")[1]) - Number(swipe.start.split(",")[1]);
        const movement = impossible ? 0 : Math.sign(requested) * Math.max(0, Math.abs(requested) - 20);
        top += movement; screen.elements[0].c[0].b = `[360,${top}][1012,${top + 24}]`;
      },
    });
    if (impossible) { await assert.rejects(invoke, /scroll boundary|no progress/); assert(gestures <= 3); }
    else { await invoke; assert.equal(gestures, 1); assert(Math.abs(top - 150) <= 8); }
  }
});
