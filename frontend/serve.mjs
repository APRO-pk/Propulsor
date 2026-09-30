// Minimal static host for the built Propulsor frontend (browser mode).
//
// Serves `dist/` and returns 404 for `/api/*`, so the frontend falls back to its
// built-in mock data. If the Rust `apro-engine-server` is running, point the
// browser at that instead for real computation.
//
// Usage: node serve.mjs [port]

import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "dist");
const port = Number(process.argv[2] ?? process.env.PORT ?? 8787);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json",
  ".woff2": "font/woff2",
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  let p = decodeURIComponent(url.pathname);

  if (p.startsWith("/api/")) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "no backend; using mock data" }));
    return;
  }

  if (p === "/") p = "/index.html";
  const file = path.join(root, p);
  try {
    const data = await readFile(file);
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] ?? "application/octet-stream" });
    res.end(data);
  } catch {
    // SPA fallback.
    try {
      const data = await readFile(path.join(root, "index.html"));
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end("404");
    }
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Propulsor web host (browser mode) on http://localhost:${port}`);
});
