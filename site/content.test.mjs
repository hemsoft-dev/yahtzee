import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { getCategories, getUpperBonusThreshold, getUpperBonusValue } from "../packages/game-engine/src/scoring.ts";
import { pages, externalLinks } from "./pages.mjs";

test("screenshot copy discloses staged data and claims only development previews", () => {
  const { captures } = JSON.parse(readFileSync(new URL("./assets/provenance.json", import.meta.url), "utf8"));
  const section = pages["index.html"].match(/<section class="screenshots".*?<\/section>/s)[0];
  const description = section.match(/<\/h2><p>(.*?)<\/p>/s)[1];
  assert.match(description, /^Unaltered iPhone simulator captures from development builds/);
  assert.match(description, /Neither image shows a played game\./);
  assert.match(description, /Final store screenshots are still pending\./);
  assert.deepEqual(captures.filter((capture) => capture.fixture).map((capture) => capture.file), ["iphone-setup.png"]);
  for (const capture of captures) {
    assert(description.includes(`version ${capture.version}, build ${capture.build}`), capture.file);
    const alt = section.match(new RegExp(`src="assets/${capture.file}"[^>]*\\balt="([^"]*)"`))[1];
    if (capture.fixture) {
      const disclosure = `fictional player name ${capture.fixture.playerName}`;
      assert(alt.includes(disclosure) && description.includes(disclosure), capture.file);
    }
  }
  assert.doesNotMatch(section, /before entering any player information|empty name field|signed|approved/i);
});

test("visible native mode table agrees with the shared scoring rules", () => {
  for (const dice of [5, 6, 8, 10]) {
    const values = [getCategories(dice).length, getUpperBonusThreshold(dice), getUpperBonusValue(dice)];
    const row = `<tr><th scope="row">${dice}</th>${values.map((value) => `<td>${value}</td>`).join("")}</tr>`;
    assert(pages["index.html"].includes(row), `Incorrect visible mode facts for ${dice} dice`);
  }
});
test("every local page and fragment exists, including cross-page destinations", () => {
  const origin = "https://preview.invalid/yahtzee/";
  const external = new Set();
  for (const [file, html] of Object.entries(pages)) {
    for (const [, href] of html.matchAll(/<a\b[^>]*\bhref="([^"]+)"/g)) {
      const url = new URL(href, origin + file);
      if (url.origin !== "https://preview.invalid") { external.add(url.href); continue; }
      assert(url.pathname.startsWith("/yahtzee/"));
      const target = pages[url.pathname.slice("/yahtzee/".length)]; assert(target, href);
      if (url.hash) assert(target.includes(`id="${decodeURIComponent(url.hash.slice(1))}"`), href);
    }
  }
  assert.deepEqual([...external].sort(), [...externalLinks].sort());
});
