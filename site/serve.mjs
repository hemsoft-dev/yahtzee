import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { contentSecurityPolicy, repositoryRoot } from "./build.mjs";

const files = new Map([
  ["index.html", "text/html; charset=utf-8"], ["support.html", "text/html; charset=utf-8"],
  ["privacy.html", "text/html; charset=utf-8"], ["style.css", "text/css; charset=utf-8"],
  ["robots.txt", "text/plain; charset=utf-8"], ["assets/OFL.txt", "text/plain; charset=utf-8"],
  ["assets/manrope-variable.ttf", "font/ttf"],
  ["assets/iphone-setup.png", "image/png"], ["assets/iphone-help.png", "image/png"],
]);
export async function serveSite(root, prefix = "/") {
  assert(/^\/(?:[a-z0-9-]+\/)*$/.test(prefix), "Preview prefix must be a directory path.");
  const server = createServer(async (request, response) => {
    response.setHeader("Content-Security-Policy", contentSecurityPolicy);
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("Cache-Control", "no-store");
    if (!["GET", "HEAD"].includes(request.method)) { response.writeHead(405).end(); return; }
    let pathname;
    try { pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname); }
    catch { response.writeHead(400).end(); return; }
    const name = pathname.startsWith(prefix) ? pathname.slice(prefix.length) || "index.html" : "";
    if (!files.has(name)) { response.writeHead(404).end("Not found"); return; }
    try {
      const bytes = await readFile(join(root, name));
      response.writeHead(200, { "Content-Type": files.get(name), "Content-Length": bytes.length });
      response.end(request.method === "HEAD" ? undefined : bytes);
    } catch { response.writeHead(404).end("Not found"); }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, url: `http://127.0.0.1:${server.address().port}${prefix}`, close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())) };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const running = await serveSite(resolve(process.argv[2] ?? join(repositoryRoot, "reports/site-preview")));
  console.log(running.url);
}
