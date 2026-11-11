#!/usr/bin/env node
// A local development relay for Detect Text (Temizle). It adds the key and Chromium CORS
// headers. The key comes from the environment, never from a repository file.
//
//   TEMIZLE_KEY=tc_… node scripts/text-mask-proxy.js
//
// Run this in SG Typer Studio's developer console, then reload the page:
//   localStorage.setItem("typer.web.textmask", JSON.stringify({ url: "http://127.0.0.1:8790" }))
// Without a relay (the service now takes each install's own token), { on: true } is enough,
// from the embedded app origin: the service refuses other addresses.
// Add "confidence" (0.05 to 0.95, 0.2 by default; lower catches more text) to that object to
// change it. localStorage.removeItem("typer.web.textmask") goes back to the service itself.

"use strict";

const http = require("http");
const { Readable } = require("stream");

const API = "https://temizle.saficizgi.com";
const PORT = Number(process.env.PORT) || 8790;
const KEY = (process.env.TEMIZLE_KEY || "").trim();
const ALLOWED = /^(typer:\/\/app|http:\/\/(localhost|127\.0\.0\.1)(:\d+)?)$/;
const PATHS = /^\/(health|v1\/(mask|inpaint|clean))$/;
const PASSED = ["x-detections", "x-seg-seconds", "retry-after"];

if (!KEY) {
  console.error("Set TEMIZLE_KEY first: TEMIZLE_KEY=tc_… node scripts/text-mask-proxy.js");
  process.exit(1);
}

const server = http.createServer(async (request, response) => {
  const origin = request.headers.origin || "";
  if (origin && !ALLOWED.test(origin)) {
    response.writeHead(403).end();
    return;
  }
  const cors = origin ? {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-API-Key, Authorization",
    "Access-Control-Expose-Headers": PASSED.join(", "),
    // Chromium asks before the embedded origin calls this local relay
    "Access-Control-Allow-Private-Network": "true",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  } : {};
  if (request.method === "OPTIONS") {
    response.writeHead(204, cors).end();
    return;
  }
  const url = new URL(request.url, API);
  if (!PATHS.test(url.pathname)) {
    response.writeHead(404, cors).end();
    return;
  }
  const started = Date.now();
  try {
    const headers = { "X-API-Key": KEY };
    if (request.headers["content-type"]) headers["Content-Type"] = request.headers["content-type"];
    const posting = request.method === "POST";
    const upstream = await fetch(API + url.pathname + url.search, { method: request.method, headers, body: posting ? Readable.toWeb(request) : undefined, duplex: posting ? "half" : undefined });
    const out = Object.assign({}, cors, { "Content-Type": upstream.headers.get("content-type") || "application/octet-stream" });
    PASSED.forEach((name) => {
      const value = upstream.headers.get(name);
      if (value !== null) out[name] = value;
    });
    const body = Buffer.from(await upstream.arrayBuffer());
    response.writeHead(upstream.status, out).end(body);
    console.log(`${request.method} ${url.pathname}${url.search} → ${upstream.status} in ${((Date.now() - started) / 1000).toFixed(1)} s (detections: ${upstream.headers.get("x-detections") ?? "?"})`);
  } catch (error) {
    console.warn("The text detection couldn't be reached:", error.message || error);
    response.writeHead(502, cors).end(String(error.message || error));
  }
});

server.listen(PORT, "127.0.0.1", () => console.log(`Text detection relay on http://127.0.0.1:${PORT}`));
