// Protocol tests with a controlled transport. These do not claim Adobe account access.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createClient, safeUrl, validate } = require("../src/firefly-client");
const { PARTNER_MODELS } = require("../src/firefly-models");
const catalogue = require("../../docs/research/firefly-partner-catalogue.json");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const { READ_GENERATION_CONTEXT } = require("../src/firefly-session-context");
const { createHash, randomUUID } = require("node:crypto");

test("generation context reads the current Adobe session and releases its observer", async () => {
  let current = "adobe-session-one";
  let released = 0;
  const loader = id => {
    assert.equal(id, 574827);
    return { C: () => ({ arpSessionToken: callback => { callback(current); return () => released++; } }) };
  };
  const sandbox = {
    location: { origin: "https://firefly.adobe.com" },
    window: { adobeIMS: { getProfile: async () => ({ userId: "test-user", email: "not-returned@example.com" }) } },
    __webpack_require__: loader, setTimeout, clearTimeout,
  };
  const run = async () => JSON.parse(JSON.stringify(await vm.runInNewContext(READ_GENERATION_CONTEXT, sandbox)));
  assert.deepEqual(await run(), { arpToken: current, userId: "test-user" });
  current = "adobe-session-two";
  assert.deepEqual(await run(), { arpToken: current, userId: "test-user" });
  assert.equal(released, 2);
  delete sandbox.__webpack_require__;
  sandbox.crypto = { randomUUID };
  sandbox.webpackChunk = [];
  sandbox.webpackChunk.push = entry => { entry[2](loader); return Array.prototype.push.call(sandbox.webpackChunk, entry); };
  assert.deepEqual(await run(), { arpToken: current, userId: "test-user" });
  assert.equal(sandbox.webpackChunk.length, 0);
  assert.equal(released, 3);
  sandbox.location.origin = "https://foreign.test";
  assert.deepEqual(await run(), {});
  assert.equal(released, 3);
});

test("missing or invalid Adobe session context never invents credentials", async () => {
  const sandbox = { location: { origin: "https://firefly.adobe.com" }, window: {}, setTimeout, clearTimeout };
  assert.equal(JSON.stringify(await vm.runInNewContext(READ_GENERATION_CONTEXT, sandbox)), "{}");
  sandbox.__webpack_require__ = () => ({ C: () => ({ arpSessionToken: cb => { cb("bad\r\nheader"); return () => {}; } }) });
  sandbox.window.adobeIMS = { getProfile: async () => { throw Error("Unavailable"); } };
  assert.equal(JSON.stringify(await vm.runInNewContext(READ_GENERATION_CONTEXT, sandbox)), "{}");
});

// A header is enough for the transport's dimension checks; actual PNG decoding and masks
// are covered by test-firefly-e2e.js with Chromium's canvas encoder/decoder.
const png = (w = 64, h = 64) => {
  const data = Buffer.alloc(33);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(data);
  data.writeUInt32BE(13, 8);
  data.write("IHDR", 12);
  data.writeUInt32BE(w, 16);
  data.writeUInt32BE(h, 20);
  data[24] = 8; data[25] = 6; // RGBA, including masks with transparent selected areas.
  return data;
};
const input = () => ({ image: png(), mask: png(), prompt: "" });
const reply = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
const output = { outputs: [{ image: { presignedUrl: "https://result.s3.us-west-2.amazonaws.com/image.png" } }] };
const credentials = async () => ({ token: "test-only-secret" });
const clientFor = (fetch, extra = {}) => createClient({ fetch, credentials, wait: async (_ms, signal) => signal.throwIfAborted(), ...extra });

test("image and mask uploaded separately; output download carries no account secret", async () => {
  const calls = [];
  const client = clientFor(async (url, options) => {
    calls.push({ url, options });
    if (url.includes("storage/image")) return reply({ images: [{ id: `upload-${calls.length}` }] });
    if (url.includes("generate-fill")) return reply(output);
    return new Response(png());
  });
  assert.deepEqual(await client.generate(input()), new Uint8Array(png()));
  assert.equal(calls.length, 4);
  const body = JSON.parse(calls[2].options.body);
  assert.equal(body.input.image.source.id, "upload-1");
  assert.equal(body.input.mask.source.id, "upload-2");
  assert.equal(body.prompt, "");
  assert.equal(body.embedContentCredentials, true);
  assert.equal(body.seeds.length, 1);
  assert.equal(calls[0].options.headers.Authorization, "Bearer test-only-secret");
  assert.deepEqual(calls[3].options.headers, {});
  assert.ok(calls.every(({ options }) => options.redirect === "error"));
});

test("asynchronous result uses the returned job URL without repeating generation", async () => {
  const calls = [];
  let checks = 0;
  const client = clientFor(async (url) => {
    calls.push(url);
    if (url.includes("storage/image")) return reply({ images: [{ id: "uploaded" }] });
    if (url.includes("generate-fill")) return reply({ links: { result: { href: "https://di-me.ff.adobe.io/jobs/one" } } }, 202);
    if (url.includes("jobs/one")) return ++checks === 1 ? reply({ progress: 50 }) : reply(output);
    return new Response(png());
  });
  await client.generate(input());
  assert.equal(checks, 2);
  assert.equal(calls.filter((url) => url.includes("generate-fill")).length, 1);
});

test("untrusted job and image URLs cannot receive requests", async () => {
  for (const image of [false, true]) {
    for (const url of ["http://di-me.ff.adobe.io/x", "https://di-me.ff.adobe.io.evil.test/x", "https://127.0.0.1/x", "https://user:pass@di-me.ff.adobe.io/x", "https://di-me.ff.adobe.io:8443/x", "file:///tmp/image.png"]) assert.throws(() => safeUrl(url, image));
  }
  assert.throws(() => safeUrl("https://bucket.s3.amazonaws.com/x"));
  let count = 0;
  const client = clientFor(async (url) => {
    count++;
    return url.includes("storage/image") ? reply({ images: [{ id: "id" }] }) : reply({ links: { result: { href: "https://attacker.test/steal" } } });
  });
  await assert.rejects(client.generate(input()), { kind: "other" });
  assert.equal(count, 3);
});

test("invalid dimensions, mismatched mask and excessive prompts fail before network access", async () => {
  const client = clientFor(async () => assert.fail("Unexpected network call"));
  for (const request of [{ ...input(), mask: png(80, 64) }, { ...input(), image: png(2048, 2048), mask: png(2048, 2048) }, { ...input(), image: png(65, 64) }, { ...input(), prompt: "x".repeat(1025) }, { ...input(), image: new Uint8Array(12) }]) await assert.rejects(client.generate(request));
  assert.doesNotThrow(() => validate({ ...input(), image: png(1984, 1984), mask: png(1984, 1984) }));
});

test("missing session never sends pixels", async () => {
  await assert.rejects(clientFor(async () => assert.fail("Unexpected request"), { credentials: async () => null }).generate(input()), { kind: "adobeauth" });
});

test("Adobe failures are classified without echoing secrets or retrying generation", async () => {
  for (const [status, code, kind] of [[401, "invalid_token", "adobeauth"], [403, "user_not_entitled", "adobeaccess"], [403, "quota_exhausted", "quota"], [429, "rate_limited", "quota"], [451, "prompt_unsafe", "blocked"], [408, "bot_risk_detected", "other"]]) {
    let count = 0;
    const client = clientFor(async () => { count++; return reply({ error_code: code, message: "test-only-secret" }, status); });
    await assert.rejects(client.generate(input()), (error) => error.kind === kind && !error.message.includes("test-only-secret") && !error.rate);
    assert.equal(count, 1);
  }
});

test("partner generation sends Adobe's current context only on the generation request", async () => {
  for (const model of ["gpt-image-2.5-flare", "gemini-3.1-flash-image"]) {
    let generation = null;
    const prompt = "É".repeat(300);
    const client = clientFor(async (url, options) => {
      if (url.includes("generate-async")) {
        generation = options;
        return reply({ links: { result: { href: "https://bks-epo42.adobe.io/jobs/result/test" } } }, 202);
      }
      assert.equal(options.headers["x-arp-session-id"], undefined);
      assert.equal(options.headers["x-nonce"], undefined);
      if (url.includes("storage/image")) return reply({ images: [{ id: "ref" }] });
      if (url.includes("jobs/result")) return reply(output);
      assert.deepEqual(options.headers, {});
      return new Response(png());
    }, { credentials: async () => ({ token: "test-only-secret", arpToken: "adobe-session-test", userId: "test-user" }) });
    await client.generate({ model, image: png(), prompt });
    assert.equal(generation.headers["x-arp-session-id"], "adobe-session-test");
    assert.equal(generation.headers["x-nonce"], createHash("sha256").update(`test-user-${prompt.slice(0, 256)}`).digest("hex"));
    assert.ok(!JSON.stringify(generation.headers).includes("test-user"));
  }
});

test("partner HTTP 408 identifies the failing stage without retrying or revealing server data", async () => {
  for (const phase of ["upload", "generation", "status", "download"]) {
    let submits = 0;
    let failed = 0;
    const client = clientFor(async url => {
      const stage = url.includes("storage/image") ? "upload" : url.includes("generate-async") ? "generation" : url.includes("jobs/result") ? "status" : "download";
      if (stage === "generation") submits++;
      if (stage === phase) { failed++; return reply({ error_code: "timeout_error", message: "do-not-log-token-or-URL" }, 408); }
      if (stage === "upload") return reply({ images: [{ id: "ref" }] });
      if (stage === "generation") return reply({ links: { result: { href: "https://bks-epo42.adobe.io/jobs/result/test" } } }, 202);
      return reply(output);
    });
    await assert.rejects(client.generate({ model: "gpt-image-2.5-flare", image: png(), prompt: "A square." }), error => {
      assert.match(error.message, /Adobe HTTP 408 \(timeout_error\)/);
      assert.ok(error.message.includes(`[${phase}, `));
      assert.ok(!error.message.includes("do-not-log"));
      assert.equal(error.rate, false);
      return true;
    });
    assert.equal(failed, 1);
    assert.equal(submits, phase === "upload" ? 0 : 1);
  }
});

test("cancelling a pending Adobe job invokes its cancel URL", async () => {
  const controller = new AbortController();
  let cancelled = false;
  const client = clientFor(async (url, options) => {
    if (url.endsWith("/cancel")) { cancelled = true; assert.equal(options.method, "POST"); return reply({}); }
    if (url.includes("storage/image")) return reply({ images: [{ id: "id" }] });
    return reply({ links: { result: { href: "https://di-me.ff.adobe.io/jobs/one" }, cancel: { href: "https://di-me.ff.adobe.io/jobs/one/cancel" } } }, 202);
  }, { wait: async (_ms, signal) => { controller.abort(); signal.throwIfAborted(); } });
  await assert.rejects(client.generate(input(), controller.signal), { kind: "cancelled" });
  assert.equal(cancelled, true);
});

test("abort before generation sends nothing", async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(clientFor(async () => assert.fail("Unexpected request")).generate(input(), controller.signal), { name: "AbortError" });
});

test("wrong output dimensions and oversized responses are rejected", async () => {
  for (const response of [() => new Response(png(80, 64)), () => new Response(png(), { headers: { "content-length": String(40e6) } })]) {
    const client = clientFor(async (url) => url.includes("storage/image") ? reply({ images: [{ id: "id" }] }) : url.includes("generate-fill") ? reply(output) : response());
    await assert.rejects(client.generate(input()));
  }
});

test("plain web keeps its providers and never offers an unusable Adobe account", () => {
  const window = { localStorage: { getItem: () => null }, dispatchEvent() {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../../web/generative.js"), "utf8"), { window });
  const gen = window.TypeRGenerative;
  assert.equal(gen.SERVICES.adobe, undefined);
  assert.equal(gen.load().service, "google");
  assert.equal(gen.ready({ service: "google", keys: { google: "test-key" } }), true);
  assert.equal(gen.ready({ service: "fal", keys: {} }), false);
  assert.equal(gen.ready({ service: "local" }), true);
});

test("Image 5 uploads one reference to its own endpoint and explicitly selects image5", async () => {
  const calls = [];
  const client = clientFor(async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith("/v2/storage/image")) return reply({ images: [{ id: "reference" }] });
    if (url.endsWith("/v1/images/generate-async")) return reply(output);
    return new Response(png(1024, 1024));
  });
  await client.generate({ model: "firefly-image-5", image: png(301, 197), prompt: "Remove the lettering.", size: "2K" });
  assert.equal(calls.length, 3);
  assert.equal(calls[0].url, "https://image-v5.ff.adobe.io/v2/storage/image");
  assert.equal(calls[1].url, "https://image-v5.ff.adobe.io/v1/images/generate-async");
  const body = JSON.parse(calls[1].options.body);
  assert.equal(body.modelVersion, "image5");
  assert.equal(body.resolutionLevel, "4MP");
  assert.equal(body.n, 1);
  assert.equal(body.seeds.length, 1);
  assert.deepEqual(body.referenceBlobs, [{ id: "reference", usage: "general" }]);
  assert.equal(body.output.storeInputs, false);
  assert.equal(body.input, undefined);
  assert.equal(body.mask, undefined);
  assert.equal(body.size, undefined); // The reference sets the aspect ratio.
  assert.deepEqual(calls[2].options.headers, {});
});

test("Image 5 follows relative and override status links and waits for final outputs", async () => {
  const calls = [];
  let checks = 0;
  const client = clientFor(async (url, options) => {
    calls.push(url);
    if (url.includes("storage/image")) return reply({ images: [{ id: "ref" }] });
    if (url.includes("generate-async")) {
      assert.equal(JSON.parse(options.body).resolutionLevel, "1MP");
      return reply({ links: { result: { href: "/jobs/result/old" } } }, 202, { "x-override-status-link": "/jobs/result/current" });
    }
    if (url.includes("jobs/result")) {
      assert.equal(url, "https://image-v5.ff.adobe.io/jobs/result/current");
      return reply(output, 200, { "x-task-status": ++checks === 1 ? "RUNNING" : "COMPLETED" });
    }
    return new Response(png(1024, 1024));
  });
  await client.generate({ model: "firefly-image-5", image: png(), prompt: "A flower." });
  assert.equal(checks, 2);
  assert.equal(calls.filter(url => url.includes("generate-async")).length, 1);
});

test("Image 5 cancellation uses PUT on its own job endpoint", async () => {
  const controller = new AbortController();
  let cancelled = false;
  const client = clientFor(async (url, options) => {
    if (url.endsWith("/cancel/one")) { cancelled = true; assert.equal(options.method, "PUT"); return reply({}); }
    if (url.includes("storage/image")) return reply({ images: [{ id: "ref" }] });
    return reply({ links: { result: { href: "/jobs/result/one" }, cancel: { href: "/jobs/cancel/one" } } }, 202);
  }, { wait: async (_ms, signal) => { controller.abort(); signal.throwIfAborted(); } });
  await assert.rejects(client.generate({ model: "firefly-image-5", image: png(), prompt: "A flower." }, controller.signal), { kind: "cancelled" });
  assert.equal(cancelled, true);
});

test("Image 5 rejects invalid input and never falls back to another model on access failure", async () => {
  const request = { model: "firefly-image-5", image: png(), prompt: "A flower." };
  const untouched = clientFor(async () => assert.fail("Invalid input reached Adobe"));
  for (const change of [{ model: "invented" }, { prompt: "" }, { prompt: "x".repeat(1501) }, { image: png(4096, 4096) }, { size: "4K" }]) await assert.rejects(untouched.generate({ ...request, ...change }));
  let count = 0;
  const client = clientFor(async url => {
    count++;
    assert.ok(url.startsWith("https://image-v5.ff.adobe.io/"));
    return url.includes("storage/image") ? reply({ images: [{ id: "ref" }] }) : reply({ error_code: "user_not_entitled" }, 403);
  });
  await assert.rejects(client.generate(request), { kind: "adobeaccess" });
  assert.equal(count, 2);
});

test("Image 5 rejects foreign job links and non-image downloads", async () => {
  const request = { model: "firefly-image-5", image: png(), prompt: "A flower." };
  let count = 0;
  const client = clientFor(async url => {
    count++;
    return url.includes("storage/image") ? reply({ images: [{ id: "ref" }] }) : reply({ links: { result: { href: "//foreign.test/job" } } });
  });
  await assert.rejects(client.generate(request));
  assert.equal(count, 2);
  await assert.rejects(clientFor(async url => url.includes("storage/image") ? reply({ images: [{ id: "ref" }] }) : url.includes("generate-async") ? reply(output) : new Response("<html>error</html>")).generate(request), { kind: "noimage" });
});

test("Adobe BKS job endpoints work without granting arbitrary URLs the account token", async () => {
  for (const host of ["bks.adobe.io", "bks-epo8552.adobe.io", "bks-epo8512.adobe.io", "bks-epv8516.adobe.io"]) {
    assert.equal(safeUrl(`https://${host}/v2/jobs/result?job_id=test`), `https://${host}/v2/jobs/result?job_id=test`);
    assert.equal(safeUrl(`https://${host}/jobs/cancel/test`), `https://${host}/jobs/cancel/test`);
  }
  for (const url of ["http://bks-epo8552.adobe.io/v2/jobs/result", "https://bks-epo8552.adobe.io.evil.test/v2/jobs/result", "https://bks-epo8552.adobe.io/anything", "https://bks-epo8552.adobe.io:8443/v2/jobs/result", "https://user:password@bks-epo8552.adobe.io/v2/jobs/result", "https://bks-epo8552.adobe.io/v2/jobs/result/../../anything"]) assert.throws(() => safeUrl(url));
  assert.throws(() => safeUrl("https://foreign.test/job?token=do-not-log#secret"), e => !e.message.includes("do-not-log") && !e.message.includes("secret") && e.message.includes("foreign.test"));
  let checked = false;
  const client = clientFor(async (url, options) => {
    if (url.includes("storage/image")) return reply({ images: [{ id: "ref" }] });
    if (url.includes("generate-async")) return reply({ links: { result: { href: "/jobs/result/one" } } }, 202, { "x-override-status-link": "https://bks-epo8552.adobe.io/v2/jobs/result?job_id=one" });
    if (url.startsWith("https://bks-epo8552.adobe.io/")) { checked = true; assert.equal(options.headers.Authorization, "Bearer test-only-secret"); return reply(output, 200, { "x-task-status": "COMPLETED" }); }
    assert.deepEqual(options.headers, {});
    return new Response(png());
  });
  await client.generate({ model: "firefly-image-5", image: png(), prompt: "Remove the letters." });
  assert.equal(checked, true);
});

test("numbered Adobe job deployments are accepted without trusting lookalike domains or other paths", () => {
  for (const host of ["firefly-epo1.adobe.io", "firefly-epv999999999.adobe.io", "bks-epo12345678.adobe.io", "bks-epn42.adobe.io"]) {
    for (const path of ["/jobs/result/one", "/v2/jobs/result?job_id=one", "/jobs/cancel/one", "/v3/jobs/cancel/one"]) {
      assert.equal(safeUrl(`https://${host}${path}`), `https://${host}${path}`);
    }
    for (const path of ["/anything", "/v2/storage/image", "/jobs/results/one", "/jobs/result/../../private", "/jobs/result/%2e%2e/%2e%2e/private"]) {
      assert.throws(() => safeUrl(`https://${host}${path}`));
    }
  }
  for (const host of ["firefly-epo1.adobe.io.evil.test", "firefly-epo1.evil-adobe.io", "other-epo1.adobe.io", "firefly-epo1.sub.adobe.io", "firefly-epo.adobe.io", "firefly-epo1-attacker.adobe.io", "bks-epv42.adobe.com"]) {
    assert.throws(() => safeUrl(`https://${host}/jobs/result/one`));
  }
});

for (const host of ["firefly-epo855254.adobe.io", "firefly-epv987654321.adobe.io", "bks-epo123456789.adobe.io"]) test(`Image 5 follows job links on ${host}`, async () => {
  const origin = `https://${host}`;
  for (const link of ["body", "header"]) {
    const calls = [];
    const client = clientFor(async (url, options) => {
      calls.push(url);
      if (url.includes("storage/image")) return reply({ images: [{ id: "ref" }] });
      if (url.includes("generate-async")) return reply({ links: {
        result: { href: link === "body" ? `${origin}/jobs/result/one` : "/jobs/result/old" },
        cancel: { href: `${origin}/jobs/cancel/one` },
      } }, 202, link === "header" ? { "x-override-status-link": `${origin}/jobs/result/one` } : {});
      if (url === `${origin}/jobs/result/one`) {
        assert.equal(options.headers.Authorization, "Bearer test-only-secret");
        assert.equal(options.redirect, "error");
        return reply(output, 200, { "x-task-status": "COMPLETED" });
      }
      assert.deepEqual(options.headers, {});
      return new Response(png());
    });
    await client.generate({ model: "firefly-image-5", image: png(), prompt: "Remove the letters." });
    assert.equal(calls.filter(url => url === `${origin}/jobs/result/one`).length, 1);
  }
  for (const url of [
    "http://firefly-epo855254.adobe.io/jobs/result/one",
    "https://firefly-epo855254.adobe.io.evil.test/jobs/result/one",
    "https://firefly-epo855254.adobe.io:8443/jobs/result/one",
    "https://user:password@firefly-epo855254.adobe.io/jobs/result/one",
    `${origin}/anything`, `${origin}/jobs/result/../../anything`,
  ]) assert.throws(() => safeUrl(url));
});

for (const [id, model] of Object.entries(PARTNER_MODELS)) test(`Adobe partner ${model.name}: verified version, reference and output contract`, async () => {
  const reference = catalogue.models.find(m => m.modelId === model.modelId && m.modelVersion === model.version);
  assert.ok(reference, "Version missing from the captured Adobe catalogue");
  assert.ok(reference.inputMediaUseCase.includes("editing"));
  const calls = [];
  const client = clientFor(async (url, options) => {
    calls.push({ url, options });
    if (url.includes("storage/image")) return reply({ images: [{ id: `asset-${calls.length}` }] });
    if (url.includes("generate-async")) return reply({ links: { result: { href: "https://bks-epo8552.adobe.io/v2/jobs/result?job_id=one" } } }, 202);
    if (url.includes("jobs/result")) return reply(output, 200, { "x-task-status": "COMPLETED" });
    return new Response(png(1024, 1024));
  });
  await client.generate({ model: id, image: png(301, 197), ...(model.mask ? { mask: png(301, 197) } : {}), prompt: "Remove the letters.", size: "2K" });
  const generation = calls.find(call => call.url.includes("generate-async"));
  assert.equal(generation.url, "https://firefly-3p.ff.adobe.io/v2/3p-images/generate-async");
  const body = JSON.parse(generation.options.body);
  assert.equal(body.modelId, reference.modelId);
  assert.equal(body.modelVersion, reference.modelVersion);
  assert.equal(body.n, 1);
  assert.equal(body.output.storeInputs, false);
  assert.equal(body.referenceBlobs[0].id, "asset-1");
  for (const ref of body.referenceBlobs) assert.ok(reference.references[0].usageTypes.includes(ref.usage));
  assert.ok(calls.filter(call => call.url.includes("storage/image")).every(call => call.url === "https://firefly-3p.ff.adobe.io/v2/storage/image"));
  if (model.mask) {
    assert.deepEqual(body.referenceBlobs[1], { id: "asset-2", usage: "mask" });
    assert.equal(body.seeds, undefined);
    assert.equal(body.generationSettings.detailLevel, 3);
    assert.equal(body.size.width % 16, 0);
    assert.equal(body.size.height % 16, 0);
    assert.ok(body.size.width * body.size.height >= 655360 && body.size.width * body.size.height <= 8294400);
  } else {
    assert.equal(body.referenceBlobs.length, 1);
    assert.equal(body.referenceBlobs[0].usage, "general");
    assert.equal(body.resolution, "2K");
    assert.equal(body.generationSettings.aspectRatio, "3:2");
  }
  assert.deepEqual(calls.at(-1).options.headers, {});
});

test("partner access failure never changes models or retries; invalid masks send nothing", async () => {
  const request = { model: "gpt-image-2.6-sunburst", image: png(), prompt: "Remove text." };
  const client = clientFor(async () => assert.fail("Invalid input reached Adobe"));
  const opaque = png(); opaque[25] = 2;
  for (const mask of [png(80, 64), opaque]) await assert.rejects(client.generate({ ...request, mask }));
  for (const model of ["firefly-image-4", "humain-image-1", "__proto__", "constructor"]) await assert.rejects(client.generate({ ...request, model }));
  let count = 0;
  await assert.rejects(clientFor(async url => {
    count++;
    return url.includes("storage/image") ? reply({ images: [{ id: "source" }] }) : reply({ error_code: "user_not_entitled" }, 403);
  }).generate(request), { kind: "adobeaccess" });
  assert.equal(count, 2);
});
