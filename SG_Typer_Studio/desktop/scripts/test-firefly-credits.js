const { test } = require("node:test");
const assert = require("node:assert/strict");
const { fetchCredits, parseCredits } = require("../src/firefly-credits");
const fixture = available => ({ total: { quota: { total: 250, available, used: 62 }, availableUntil: "2026-11-24T00:00:00Z" }, account: { token: "not-for-the-renderer" } });

test("Adobe credit totals and reset date are returned without account data", () => {
  assert.deepEqual(parseCredits(fixture(188)), { total: 250, remaining: 188, resetAt: "2026-11-24T00:00:00.000Z" });
  assert.equal(parseCredits(fixture(0)).remaining, 0);
  assert.deepEqual(parseCredits({ total: { quota: { total: 0, available: 0 } } }), { total: 0, remaining: 0, resetAt: null });
  const unknownDate = fixture(188); unknownDate.total.availableUntil = "not-a-date";
  assert.equal(parseCredits(unknownDate).resetAt, null);
});

test("unknown balances cannot turn into zero or unlimited credits", () => {
  for (const data of [null, {}, { total: {} }, { total: { quota: { total: 250 } } }, ...[null, false, -1, NaN, Infinity, ""].map(available => fixture(available))]) {
    assert.throws(() => parseCredits(data));
  }
});

test("credit lookup is a bounded read on the fixed Adobe endpoint", async () => {
  const controller = new AbortController();
  const result = await fetchCredits(async (url, options) => {
    assert.equal(url, "https://firefly.adobe.io/v1/credits/balance");
    assert.equal(options.method, "GET");
    assert.equal(options.headers.Authorization, "Bearer test-token");
    assert.equal(options.redirect, "error");
    assert.equal(options.cache, "no-store");
    assert.equal(options.signal, controller.signal);
    return Response.json(fixture(188));
  }, "test-token", controller.signal);
  assert.equal(result.remaining, 188);
  for (const response of [new Response("private error", { status: 401 }), new Response("invalid-json"), new Response("x", { headers: { "content-length": 2e6 } }), new Response("x".repeat(1024 * 1024 + 1))]) {
    await assert.rejects(fetchCredits(async () => response, "test-token"));
  }
  await assert.rejects(fetchCredits(async () => assert.fail("must not send"), "bad\r\ntoken"));
});
