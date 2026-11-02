import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { repositoryRoot } from "./build.mjs";

test("preview workflow actions use exact immutable commit identifiers", () => {
  const workflow = readFileSync(join(repositoryRoot, ".github/workflows/site-preview.yml"), "utf8");
  const actions = [...workflow.matchAll(/\buses:\s+(\S+)/g)].map((match) => match[1]);
  assert(actions.length >= 4);
  for (const action of actions) assert.match(action, /^[\w.-]+\/[\w.-]+@[a-f0-9]{40}$/, action);
});

test("publication is main-only, uses a site artifact and scopes deployment permissions", () => {
  const workflow = readFileSync(join(repositoryRoot, ".github/workflows/site-pages.yml"), "utf8");
  assert.match(workflow, /if: github.ref == 'refs\/heads\/main'/);
  assert.doesNotMatch(workflow, /pull_request/);
  assert.match(workflow, /path: reports\/site-public/);
  assert.match(workflow, /paths:.*"packages\/game-engine\/src\/scoring\.ts"/);
  assert.match(workflow, /needs: build/);
  assert.match(workflow, /name: github-pages/);
  assert.match(workflow, /pages: write/);
  assert.match(workflow, /id-token: write/);
  for (const [, action] of workflow.matchAll(/\buses:\s+(\S+)/g)) {
    assert.match(action, /^[\w.-]+\/[\w.-]+@[a-f0-9]{40}$/);
  }
});
