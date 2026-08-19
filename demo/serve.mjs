// Minimal static file server that sets the Cross-Origin-Opener-Policy and
// Cross-Origin-Embedder-Policy headers ffmpeg.wasm needs for
// SharedArrayBuffer. Plain `python -m http.server` or `file://` won't set
// these — that's the #1 reason a fresh ffmpeg.wasm setup silently fails
// with "SharedArrayBuffer is not defined".
//
// Usage: node demo/serve.mjs  (serves the project root on http://localhost:8080)

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = process.env.PORT ? Number(process.env.PORT) : 8080;

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".json": "application/json",
  ".wasm": "application/wasm",
  ".css": "text/css",
  ".map": "application/json",
  ".png": "image/png",
  ".wav": "audio/wav",
  ".mp4": "video/mp4",
};

const server = http.createServer((req, res) => {
  const parsedUrl = new URL(req.url ?? "/", `http://${req.headers.host || "127.0.0.1"}`);
  const requestPath = decodeURIComponent(parsedUrl.pathname);

  // Proxy route for images
  if (requestPath === "/api/proxy-image") {
    const targetUrl = parsedUrl.searchParams.get("url");
    if (!targetUrl) {
      res.writeHead(400, { "Content-Type": "text/plain" });
      res.end("Missing url param");
      return;
    }

    fetch(targetUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      }
    })
      .then(async (resp) => {
        const buffer = await resp.arrayBuffer();
        res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
        res.setHeader("Cross-Origin-Embedder-Policy", "credentialless");
        res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Content-Type", resp.headers.get("content-type") || "image/jpeg");
        res.writeHead(resp.status);
        res.end(Buffer.from(buffer));
      })
      .catch((err) => {
        res.writeHead(502, { "Content-Type": "text/plain" });
        res.end(`Proxy error: ${err.message}`);
      });
    return;
  }

  let filePath = path.join(root, requestPath);
  if (filePath.endsWith(path.sep)) filePath = path.join(filePath, "index.html");

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end(`Not found: ${req.url}`);
      return;
    }

    const ext = path.extname(filePath);
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    res.setHeader("Cross-Origin-Embedder-Policy", "credentialless");
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Content-Type", mimeTypes[ext] ?? "application/octet-stream");
    res.writeHead(200);
    res.end(data);
  });
});

server.listen(port, () => {
  console.log(`Serving ${root} at http://localhost:${port} (COOP/COEP enabled)`);
  console.log(`Open http://localhost:${port}/demo/index.html`);
});
