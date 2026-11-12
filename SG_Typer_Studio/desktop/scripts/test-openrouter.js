const assert = require("node:assert/strict");
const test = require("node:test");
const { createOpenRouter } = require("../src/openrouter");

const response = (body, status = 200, headers = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  statusText: String(status),
  headers: { get: (name) => headers[name.toLowerCase()] || null },
  text: async () => typeof body === "string" ? body : JSON.stringify(body),
});

test("desktop OpenRouter proxy uses fixed Image API routes and keeps credentials request-scoped", async () => {
  const calls = [];
  const api = createOpenRouter(async (url, options) => {
    calls.push({ url, options });
    return response({ data: [] });
  });
  const catalog = await api.request("one", { route: "models", key: " secret " });
  assert.equal(catalog.ok, true);
  assert.equal(calls[0].url, "https://openrouter.ai/api/v1/images/models");
  assert.equal(calls[0].options.method, "GET");
  assert.equal(calls[0].options.headers.Authorization, "Bearer secret");
  const generated = await api.request("two", { route: "images", key: "secret", body: { model: "vendor/image", prompt: "edit", n: 1 } });
  assert.equal(generated.ok, true);
  assert.equal(calls[1].url, "https://openrouter.ai/api/v1/images");
  assert.equal(calls[1].options.method, "POST");
  assert.equal(JSON.parse(calls[1].options.body).model, "vendor/image");
  const denied = await api.request("three", { route: " arbitrary ", key: "secret" });
  assert.equal(denied.ok, false);
  assert.equal(calls.length, 2);
});

test("desktop OpenRouter proxy preserves API error categories and invalid JSON", async () => {
  const denied = createOpenRouter(async () => response({ error: { message: "Bad key" } }, 401));
  assert.deepEqual(await denied.request("key", { route: "models" }), { ok: false, kind: "key", message: "Bad key", status: 401, retry: 0 });
  const limited = createOpenRouter(async () => response({ error: { message: "Slow down" } }, 429, { "retry-after": "3" }));
  const rate = await limited.request("rate", { route: "models" });
  assert.equal(rate.kind, "quota");
  assert.equal(rate.retry, 3);
  const invalid = createOpenRouter(async () => response("not json"));
  assert.equal((await invalid.request("bad", { route: "images", body: {} })).kind, "noimage");
});

test("desktop OpenRouter requests can be cancelled and network failures stay descriptive", async () => {
  const api = createOpenRouter((url, options) => new Promise((resolve, reject) => {
    options.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
  }));
  const pending = api.request("cancel-me", { route: "models" });
  assert.equal(api.cancel("cancel-me"), true);
  assert.deepEqual(await pending, { ok: false, kind: "cancelled" });
  assert.equal(api.cancel("cancel-me"), false);
  const offline = createOpenRouter(async () => { throw new Error("socket closed"); });
  assert.deepEqual(await offline.request("offline", { route: "models" }), { ok: false, kind: "network", message: "socket closed" });
});
