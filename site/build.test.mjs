import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildSite, siteRoot } from "./build.mjs";
import { pages } from "./pages.mjs";
import { serveSite } from "./serve.mjs";

function pngDimensions(bytes) {
  assert.equal(bytes.toString("latin1", 1, 4), "PNG");
  assert.equal(bytes.toString("latin1", 12, 16), "IHDR");
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

test("each published screenshot matches its own provenance and declared dimensions", () => {
  const temporary = mkdtempSync(join(tmpdir(), "dice-site-images-"));
  try {
    const receipt = buildSite(join(temporary, "site"), { publish: true });
    const provenance = JSON.parse(readFileSync(join(siteRoot, "assets/provenance.json"), "utf8"));
    const images = [...pages["index.html"].matchAll(/<img\b[^>]*>/g)].map(([tag]) => Object.fromEntries([...tag.matchAll(/(\w+)="([^"]*)"/g)].map(([, name, value]) => [name, value])));
    assert.deepEqual(images.map((image) => image.src).sort(), provenance.captures.map((capture) => `assets/${capture.file}`).sort());
    for (const shared of ["sourceCommit", "run", "artifactId", "sourcePath", "sha256"]) {
      assert.equal(shared in provenance, false, `Mixed captures must not share a top-level ${shared}`);
    }
    for (const capture of provenance.captures) {
      const image = images.find((candidate) => candidate.src === `assets/${capture.file}`);
      const bytes = readFileSync(join(temporary, "site", image.src));
      const size = { width: capture.width, height: capture.height };
      assert.equal(createHash("sha256").update(bytes).digest("hex"), capture.sha256, capture.file);
      assert.equal(bytes.length, capture.bytes, capture.file);
      assert.equal(receipt.artifacts.find((artifact) => artifact.path === image.src).sha256, capture.sha256, capture.file);
      assert.deepEqual(pngDimensions(bytes), size, capture.file);
      assert.deepEqual({ width: Number(image.width), height: Number(image.height) }, size, capture.file);
      assert.match(capture.sourceCommit, /^[a-f0-9]{40}$/);
      assert.match(capture.run, /^https:\/\/github\.com\/hemsoft-dev\/yahtzee\/actions\/runs\/\d+$/);
      assert(Number.isInteger(capture.artifactId) && capture.sourcePath, capture.file);
      assert.notEqual(capture.supersedes?.sha256, capture.sha256, `${capture.file} cannot supersede itself`);
    }
  } finally { rmSync(temporary, { recursive: true, force: true }); }
});

test("preview is deterministic and publication includes public discovery files", () => {
  const temporary = mkdtempSync(join(tmpdir(), "dice-site-"));
  try {
    const first = buildSite(join(temporary, "first"));
    assert.deepEqual(buildSite(join(temporary, "second")), first);
    assert.equal(first.publicationAuthorized, false);
    for (const artifact of first.artifacts) {
      const bytes = readFileSync(join(temporary, "first", artifact.path));
      assert.equal(bytes.length, artifact.bytes);
      assert.equal(createHash("sha256").update(bytes).digest("hex"), artifact.sha256);
    }
    assert.throws(() => buildSite(join(temporary, "first")), /not overwritten/);
    const published = buildSite(join(temporary, "public"), { publish: true });
    assert.equal(published.publicationAuthorized, true);
    assert.equal(readFileSync(join(temporary, "public/robots.txt"), "utf8"), "User-agent: *\nAllow: /\n");
    assert(published.artifacts.some((artifact) => artifact.path === ".nojekyll"));
  } finally { rmSync(temporary, { recursive: true, force: true }); }
});

test("public pages preserve prerelease status and avoid scripts, forms, embeds and invented downloads", () => {
  assert.deepEqual(Object.keys(pages), ["index.html", "support.html", "privacy.html"]);
  for (const html of Object.values(pages)) {
    assert.match(html, /name="robots" content="index,follow"/);
    assert.match(html, /Not available on the App Store/);
    assert.match(html, /<html lang="en">/);
    assert.equal((html.match(/<h1[ >]/g) ?? []).length, 1);
    assert.doesNotMatch(html, /<script|<form|<iframe|apps\.apple\.com|mailto:|tel:|Local tester|Bot Alpha/i);
    assert.match(html, /href="support\.html"/);
    assert.match(html, /href="privacy\.html"/);
  }
  assert.match(pages["privacy.html"], /Effective November 2, 2026/);
  assert.match(pages["privacy.html"], /GitHub logs visitors' IP addresses/);
  assert.match(pages["support.html"], /security\/advisories\/new/);
  assert.match(pages["support.html"], /Retry reset continues the confirmed deletion/);
});

test("unauthenticated preview serves only approved files under a repository subpath", async () => {
  const temporary = mkdtempSync(join(tmpdir(), "dice-site-http-"));
  const output = join(temporary, "site"); buildSite(output);
  const running = await serveSite(output, "/yahtzee/");
  try {
    for (const file of ["", ...Object.keys(pages), "style.css", "assets/manrope-variable.ttf", "assets/iphone-setup.png", "assets/iphone-help.png"]) {
      const response = await fetch(running.url + file);
      assert.equal(response.status, 200);
      assert.match(response.headers.get("content-security-policy"), /frame-ancestors 'none'/);
      assert.equal(response.headers.get("set-cookie"), null);
      await response.arrayBuffer();
    }
    for (const file of ["pages.mjs", "../package.json", "%2e%2e%2f.git/config", "assets/../../../package.json", "preview-manifest.json"]) {
      assert.equal((await fetch(running.url + file)).status, 404);
    }
    assert.equal((await fetch(running.url, { method: "POST" })).status, 405);
    assert.equal((await fetch(running.url + "index.html", { method: "HEAD" })).status, 200);
  } finally { await running.close(); rmSync(temporary, { recursive: true, force: true }); }
});
