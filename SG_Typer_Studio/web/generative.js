// Generative Fill: the selection, with what surrounds it, goes to an image model and comes back
// drawn again, by default without its text. Google's own API serves Gemini's image models (Nano
// Banana); fal.ai serves the same and others. Each person uses their own key: it stays in this
// browser (or the app) and goes only to the service it belongs to.
(function () {
  "use strict";

  const STORE = "typer.web.generative";
  const adobe = window.TypeRDesktop && window.TypeRDesktop.firefly;
  let adobeState = { connected: false, connecting: false };
  let adobeBalance = { status: "signedout" };
  let balanceRequest = 0;
  let balancePending = null;
  const showAdobeBalance = value => {
    adobeBalance = value;
    window.dispatchEvent(new CustomEvent("typer-firefly-credits", { detail: value }));
    return value;
  };
  const adobeCredits = (force = false) => {
    if (!adobeState.connected || !adobe?.credits) return Promise.resolve(adobeBalance);
    if (!force && balancePending) return balancePending;
    if (!force && adobeBalance.status === "ready" && Date.now() - adobeBalance.updatedAt < 60000) return Promise.resolve(adobeBalance);
    const request = ++balanceRequest;
    showAdobeBalance({ status: "loading" });
    const pending = Promise.resolve().then(() => adobe.credits()).catch(() => ({ status: "unavailable" })).then(value => {
      if (request !== balanceRequest || !adobeState.connected) return adobeBalance;
      return showAdobeBalance(value || { status: "unavailable" });
    }).finally(() => { if (balancePending === pending) balancePending = null; });
    balancePending = pending;
    return pending;
  };
  const setAdobeState = (state) => {
    const wasConnected = adobeState.connected;
    adobeState = state || { connected: false, connecting: false };
    if (!adobeState.connected) {
      balanceRequest++;
      balancePending = null;
      showAdobeBalance({ status: "signedout" });
    }
    window.dispatchEvent(new CustomEvent("typer-firefly-state", { detail: adobeState }));
    if (!wasConnected && adobeState.connected) void adobeCredits();
    return adobeState;
  };
  const adobeStatus = async () => setAdobeState(adobe ? await adobe.status() : null);
  const adobeConnect = async () => {
    const result = adobe && await adobe.connect();
    await adobeStatus();
    return result;
  };
  const adobeDisconnect = async () => setAdobeState(adobe ? await adobe.disconnect() : null);
  if (adobe) {
    adobe.onState(setAdobeState);
    adobeStatus().catch(() => {});
  }

  // What an empty prompt asks: a page cleaned for lettering, the art behind the letters redrawn
  const DEFAULT_PROMPT = "Erase only the lettering in this comic image: the words inside speech balloons and captions, and the sound effects drawn over the art. Keep every speech balloon, its outline and tail, and every panel border exactly where they are, just empty. Where a letter covered artwork, screentone or a background, redraw what was behind it so it continues what is around it. Change nothing else: same framing, scale, line art, screentone, tones and paper white.";
  // FLUX on this computer redraws only the selection: it has to hear that the characters drawn
  // over the art are text too, or it keeps a big katakana sound effect as part of the drawing
  const FLUX_PROMPT = "Remove all the text from this manga image: every word, letter and sound effect, including Japanese, Korean and Chinese characters and the large hand-drawn katakana sound effects. Redraw the artwork that was behind them so the line art, screentone and background continue naturally. Keep everything else exactly the same.";
  const KEEP_FRAMING = "Keep the framing, the scale and everything not mentioned exactly as it is.";

  const SERVICES = {
    google: {
      name: "Google Gemini",
      keyUrl: "https://aistudio.google.com/apikey",
      models: [
        ["gemini-3.1-flash-image", "Nano Banana 2"],
        ["gemini-nano-banana-2.1", "Nano Banana 2.1"],
        ["gemini-3-pro-image", "Nano Banana Pro"],
        ["gemini-3.1-flash-lite-image", "Nano Banana 2 Lite"],
        ["gemini-2.5-flash-image", "Nano Banana"],
      ],
    },
    fal: {
      name: "fal.ai",
      keyUrl: "https://fal.ai/dashboard/keys",
      models: [
        ["fal-ai/nano-banana-2/edit", "Nano Banana 2"],
        ["google/nano-banana-2.1/edit", "Nano Banana 2.1"],
        ["fal-ai/nano-banana-pro/edit", "Nano Banana Pro"],
        ["fal-ai/flux-pro/kontext", "FLUX.1 Kontext [pro]"],
        ["ideogram/v4.5/edit", "Ideogram 4.5 Edit"],
      ],
    },
    openrouter: {
      name: "OpenRouter",
      keyUrl: "https://openrouter.ai/settings/keys",
      models: [
        ["openai/gpt-image-1", "GPT Image 1"],
        ["google/gemini-2.5-flash-image", "Gemini 2.5 Flash Image"],
        ["google/gemini-3-pro-image-preview", "Gemini 3 Pro Image"],
      ],
    },
    custom: {
      name: "OpenAI-compatible / local",
      keyOptional: true,
      endpoint: true,
      models: [["local-image-model", "Local image model"]],
    },
    // No key and no bill: the model runs in this browser (lama-worker.js)
    // In the desktop app, FLUX too: the app runs it outside the browser (desktop/src/local-ai.js)
    local: {
      name: "On this device",
      local: true,
      models: [["lama-manga", "LaMa Manga"]].concat(window.TypeRDesktop && window.TypeRDesktop.localAI ? [["flux2-klein-4b", "FLUX.2 Klein 4B"], ["flux3-klein", "FLUX 3 Klein"]] : []),
    },
  };
  // What the local models draw: a square of this many pixels, nothing else
  if (adobe) SERVICES.adobe = { name: "Adobe Firefly", account: true, models: [
    ["firefly-image-5", "Firefly Image 5"],
    ["firefly-fill", "Firefly Fill & Expand"],
    ["gpt-image-2", "GPT Image 2"],
    ["gpt-image-2.5-flare", "GPT Image 2.5 Flare"],
    ["gpt-image-2.5-sunburst", "GPT Image 2.5 Sunburst"],
    ["gpt-image-2.6-flare", "GPT Image 2.6 Flare"],
    ["gpt-image-2.6-sunburst", "GPT Image 2.6 Sunburst"],
    ["gemini-nano-banana-2.1", "Gemini Nano Banana 2.1"],
    ["gemini-3.1-flash-image", "Gemini 3.1 (Nano Banana 2)"],
    ["gemini-3-pro-image", "Gemini 3.0 (Nano Banana Pro)"],
  ] };
  const LOCAL_SIZE = 512;
  // LaMa Manga's download, in bytes: its three files, as lama-worker.js fetches them
  const LAMA_SIZE = 234e6;
  const isLocal = (service) => Boolean(SERVICES[service] && SERVICES[service].local);
  const desktopAI = (window.TypeRDesktop && window.TypeRDesktop.localAI) || null;
  const isFlux = (model) => /^flux/.test(model);

  // What a picture costs, in US dollars, as the services listed it on 2026-11-05. Google bills
  // tokens: its rates per million (in, text and thinking out, image out) give the cost of each
  // answer from the tokens it counts; `sizes` is the picture's usual cost. fal.ai bills a flat
  // price per picture, read live from its pricing API when the key allows (`scale` multiplies it
  // by resolution); Nano Banana 2.1 is billed there by tokens too, so `sizes` stays an estimate.
  const PRICES = {
    "google:gemini-3.1-flash-image": { tokens: [0.5, 3, 60], sizes: { "0.5K": 0.045, "1K": 0.067, "2K": 0.101, "4K": 0.151 } },
    "google:gemini-nano-banana-2.1": { tokens: [1.5, 7.5, 30], sizes: { "1K": 0.0336, "2K": 0.0504, "4K": 0.113 } },
    "google:gemini-3-pro-image": { tokens: [2, 12, 120], sizes: { "1K": 0.134, "2K": 0.134, "4K": 0.24 } },
    "google:gemini-3.1-flash-lite-image": { tokens: [0.25, 1.5, 30], image: 0.0336 },
    "google:gemini-2.5-flash-image": { tokens: [0.3, 2.5, 30], image: 0.039 },
    "fal:fal-ai/nano-banana-2/edit": { image: 0.08, scale: { "0.5K": 0.75, "2K": 1.5, "4K": 2 } },
    "fal:google/nano-banana-2.1/edit": { sizes: { "1K": 0.044, "2K": 0.063, "4K": 0.138 } },
    "fal:fal-ai/nano-banana-pro/edit": { image: 0.15, scale: { "4K": 2 } },
    "fal:fal-ai/flux-pro/kontext": { image: 0.04 },
    // Ideogram's price follows the quality asked, not the size
    "fal:ideogram/v4.5/edit": { qualities: [["very_low", 0.008], ["low", 0.03], ["medium", 0.06], ["high", 0.22]], quality: "medium" },
  };
  const STORE_PRICES = "typer.web.generative.prices";
  const STORE_SPENT = "typer.web.generative.spent";
  // fal.ai's live prices: { [endpoint]: { price, unit, at } }
  const livePrices = (() => {
    try {
      return JSON.parse(window.localStorage.getItem(STORE_PRICES)) || {};
    } catch (error) {
      return {};
    }
  })();

  const load = () => {
    const out = { service: "google", keys: {}, models: {}, custom: {}, quality: {}, endpoints: { custom: "http://localhost:1234/v1" }, matchTones: true };
    try {
      const saved = JSON.parse(window.localStorage.getItem(STORE)) || {};
      if (SERVICES[saved.service]) out.service = saved.service;
      // The inside brought to the page's brightness: on unless turned off
      if (saved.matchTones === false) out.matchTones = false;
      if (saved.endpoints && typeof saved.endpoints.custom === "string") out.endpoints.custom = saved.endpoints.custom;
      Object.keys(SERVICES).forEach((name) => {
        if (saved.keys && typeof saved.keys[name] === "string") out.keys[name] = saved.keys[name];
        if (saved.models && typeof saved.models[name] === "string" && saved.models[name]) out.models[name] = saved.models[name];
        if (saved.quality && typeof saved.quality === "object") Object.keys(saved.quality).forEach((model) => { if (typeof saved.quality[model] === "string") out.quality[model] = saved.quality[model]; });
        out.custom[name] = saved.custom && Array.isArray(saved.custom[name]) ? saved.custom[name].filter((slug) => typeof slug === "string" && slugOf(name, slug) === slug) : [];
      });
    } catch (error) {
      console.warn("SG Typer Studio: could not read the Generative Fill settings", error);
    }
    return out;
  };
  const save = (value) => {
    try {
      window.localStorage.setItem(STORE, JSON.stringify(value));
      return true;
    } catch (error) {
      console.warn("SG Typer Studio: could not keep the Generative Fill settings", error);
      return false;
    }
  };
  // The service's models, then those added by their slug
  const modelsOf = (settings, service = settings.service) => {
    const models = SERVICES[service].models.concat(((settings.custom && settings.custom[service]) || []).map((slug) => [slug, slug]));
    const current = settings.models && settings.models[service];
    if (service === "custom" && current && !models.some(([id]) => id === current)) models.unshift([current, current]);
    return models;
  };
  const modelOf = (settings, service = settings.service) => {
    const wanted = settings.models?.[service];
    return wanted && modelsOf(settings, service).some(([id]) => id === wanted) ? wanted : SERVICES[service].models[0][0];
  };
  // A model as people find it: fal.ai's page address or its slug ("fal-ai/flux-pro/kontext"),
  // Google's id ("gemini-3-pro-image", or "models/…"). Null when it can't be one.
  const slugOf = (service, text) => {
    if (isLocal(service) || service === "adobe") return null;
    let slug = String(text || "").trim();
    if (service === "custom") return /^[a-z0-9][\w.:/-]*$/i.test(slug) ? slug : null;
    if (service === "openrouter") return /^[\w.-]+\/[\w.:/-]+$/.test(slug) ? slug : null;
    if (service === "fal") {
      slug = slug.replace(/^https?:\/\/(www\.)?fal\.ai\/models\//, "").replace(/^https?:\/\/(queue\.)?fal\.run\//, "").replace(/[?#].*$/, "").replace(/\/(api|playground|llms\.txt)\/?$/, "").replace(/^\/+|\/+$/g, "");
      return /^[\w.-]+(\/[\w.-]+)+$/.test(slug) ? slug : null;
    }
    slug = slug.replace(/^models\//, "").replace(/:generateContent$/, "");
    return /^[a-z0-9][\w.-]*$/i.test(slug) ? slug : null;
  };
  // The qualities a model offers, each with its price, or null
  const qualitiesOf = (service, model) => {
    const price = PRICES[`${service}:${model}`];
    return price && price.qualities ? price.qualities.slice() : null;
  };
  const qualityOf = (settings, service, model) => {
    const list = qualitiesOf(service, model);
    if (!list) return null;
    const wanted = settings.quality && settings.quality[model];
    return list.some(([value]) => value === wanted) ? wanted : PRICES[`${service}:${model}`].quality;
  };
  // What one picture costs, as the settings show it: { usd, large, unit, live } where `usd` is at
  // the usual size (1K) and `large` for a big selection (sent at 2K). Null when no price is known.
  const priceOf = (settings, service, model) => {
    if (isLocal(service)) return { usd: 0, large: 0, unit: "image", free: true };
    const price = PRICES[`${service}:${model}`];
    const live = service === "fal" ? livePrices[model] : null;
    if (price && price.qualities) {
      const quality = qualityOf(settings, service, model);
      const usd = price.qualities.find(([value]) => value === quality)[1];
      return { usd, large: usd, unit: "image" };
    }
    if (price && price.sizes) return { usd: price.sizes["1K"], large: price.sizes["2K"] || price.sizes["1K"], unit: "image" };
    if (price && price.image) {
      const base = live && live.unit === "image" ? live.price : price.image;
      return { usd: base, large: base * ((price.scale && price.scale["2K"]) || 1), unit: "image", live: Boolean(live && live.unit === "image") };
    }
    if (live) return { usd: live.price, large: live.price, unit: live.unit, live: true };
    return null;
  };
  // What a picture just made cost: Google's from the tokens it counted, fal.ai's from its price.
  // `megapixels`: the picture's size, for the models billed by it.
  const costOf = (settings, service, model, { size, usage, megapixels } = {}) => {
    if (isLocal(service)) return null;
    const price = PRICES[`${service}:${model}`];
    if (service === "google" && price && usage && price.tokens) {
      const [input, text, image] = price.tokens;
      const pictures = (usage.candidatesTokensDetails || []).filter((one) => one.modality === "IMAGE").reduce((sum, one) => sum + (one.tokenCount || 0), 0);
      const words = Math.max(0, (usage.candidatesTokenCount || 0) - pictures) + (usage.thoughtsTokenCount || 0);
      if (pictures) return { usd: ((usage.promptTokenCount || 0) * input + words * text + pictures * image) / 1e6, counted: true };
    }
    const shown = priceOf(settings, service, model);
    if (!shown) return null;
    if (shown.unit === "image") {
      if (price && price.sizes) return { usd: price.sizes[size] || price.sizes["1K"], estimate: true };
      if (price && price.scale) return { usd: shown.usd * (price.scale[size] || 1) };
      return { usd: shown.usd };
    }
    if (/megapixel/.test(shown.unit) && megapixels) return { usd: shown.usd * megapixels };
    return null;
  };
  // fal.ai's prices change: they're asked again once a day, for the models in the list, and only
  // once while the app is open (a key that may not read them isn't asked again and again)
  const asked = new Set();
  const refreshPrices = async (settings) => {
    const key = (settings.keys.fal || "").trim();
    if (!key) return false;
    const wanted = modelsOf(settings, "fal").map(([id]) => id).filter((id) => !asked.has(id) && (!livePrices[id] || Date.now() - livePrices[id].at > 864e5));
    if (!wanted.length) return false;
    wanted.forEach((id) => asked.add(id));
    try {
      const response = await fetch(`https://api.fal.ai/v1/models/pricing?endpoint_id=${wanted.map(encodeURIComponent).join(",")}`, { headers: { Authorization: `Key ${key}` } });
      if (!response.ok) return false;
      const answer = await response.json();
      (answer.prices || []).forEach((one) => {
        if (one && typeof one.endpoint_id === "string" && Number.isFinite(one.unit_price) && (!one.currency || one.currency === "USD")) {
          livePrices[one.endpoint_id] = { price: one.unit_price, unit: String(one.unit || "").toLowerCase().replace(/s$/, ""), at: Date.now() };
        }
      });
      window.localStorage.setItem(STORE_PRICES, JSON.stringify(livePrices));
      return true;
    } catch (error) {
      console.warn("SG Typer Studio: fal.ai's prices could not be read", error);
      return false;
    }
  };
  // What Generative Fill has cost on this device, by the costs above
  const spent = () => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(STORE_SPENT));
      if (saved && Number.isFinite(saved.usd)) return { usd: saved.usd, count: saved.count || 0, since: saved.since || Date.now() };
    } catch (error) {
      // Counted again from nothing
    }
    return { usd: 0, count: 0, since: Date.now() };
  };
  const addSpent = (usd) => {
    const total = spent();
    total.usd += usd;
    total.count += 1;
    try {
      window.localStorage.setItem(STORE_SPENT, JSON.stringify(total));
    } catch (error) {
      // Only a tally
    }
    return total;
  };
  const resetSpent = () => {
    try {
      window.localStorage.removeItem(STORE_SPENT);
    } catch (error) {
      // Nothing kept anyway
    }
  };
  const ready = (settings) => settings.service === "adobe" ? adobeState.connected : settings.service === "custom" ? Boolean((settings.endpoints?.custom || "").trim() && modelOf(settings)) : isLocal(settings.service) || Boolean((settings.keys[settings.service] || "").trim());
  // A local model takes no prompt: it redraws the selection from what surrounds it
  const takesPrompt = (settings) => !isLocal(settings.service) || isFlux(modelOf(settings));
  // The size a model draws at, when it's a fixed square: the area sent is chosen for it
  const fixedSize = (settings) => (isLocal(settings.service) && !isFlux(modelOf(settings)) ? LOCAL_SIZE : 0);
  // The local models draw in place, pixel for pixel: their picture needs no aligning
  const drawsInPlace = (settings) => isLocal(settings.service) || (settings.service === "adobe" && modelOf(settings) === "firefly-fill");
  // FLUX on this computer: its time grows faster than the area, so the area goes no bigger than
  // this (a 600 × 900 area took 166 s on an M4, 560 × 560 about 55 s)
  const longestFor = (settings) => (isLocal(settings.service) && isFlux(modelOf(settings)) ? 768 : 0);

  // The shapes the models draw: the area sent grows to the nearest one, so nothing is squeezed
  const RATIOS = ["1:1", "4:5", "5:4", "3:4", "4:3", "2:3", "3:2", "9:16", "16:9", "21:9"];
  const LONG_RATIOS = ["1:4", "4:1", "1:8", "8:1"];
  const knowsLongRatios = (model) => /3\.1-flash|nano-banana-2/.test(model);
  // Models that draw at 1K, 2K or 4K; the others at about one megapixel
  const knowsSizes = (model) => /gemini-3|nano-banana-2|nano-banana-pro/.test(model) && !/lite/.test(model);
  const ratiosFor = (model) => (model === "lama-manga" ? ["1:1"] : isFlux(model) ? RATIOS.concat(LONG_RATIOS) : /kontext/.test(model) ? RATIOS.filter((r) => r !== "4:5" && r !== "5:4") : knowsLongRatios(model) ? RATIOS.concat(LONG_RATIOS) : RATIOS)
    .map((label) => {
      const [w, h] = label.split(":").map(Number);
      return { label, value: w / h };
    });

  // `rate`: only too many requests at once, which passes on its own (`retry`: the seconds the
  // service asked to wait, 0 when it didn't say), not a quota or a balance used up
  class GenerativeError extends Error {
    constructor(kind, detail, rate, retry) {
      super(detail || kind);
      this.kind = kind;
      this.detail = detail || "";
      this.rate = Boolean(rate);
      this.retry = retry || 0;
    }
  }

  const base64Of = (blob) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
  // PNG keeps line art and tone intact; a very big area goes as JPEG, which the services take faster
  const encode = async (canvas) => {
    let blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob || blob.size > 7e6) blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.95));
    if (!blob) throw new GenerativeError("other", "The picture could not be encoded.");
    return { mime: blob.type, data: await base64Of(blob) };
  };

  const kindOfStatus = (status) => (status === 401 || status === 403 ? "key" : status === 429 ? "quota" : status === 402 ? "quota" : "other");
  const readError = async (response) => {
    let detail = "";
    let raw = "";
    try {
      const text = await response.text();
      raw = text;
      try {
        const json = JSON.parse(text);
        const error = json.error || json;
        detail = (typeof error === "string" ? error : error.message || json.detail || "") || text;
        if (Array.isArray(detail)) detail = detail.map((one) => one.msg || JSON.stringify(one)).join("; ");
      } catch (error) {
        detail = text;
      }
    } catch (error) {
      detail = "";
    }
    detail = String(detail || response.statusText || response.status).slice(0, 300);
    let kind = kindOfStatus(response.status);
    if (/api key|API_KEY|unauthori[sz]ed|invalid key|credentials/i.test(detail)) kind = "key";
    else if (/quota|exhausted|balance|billing|rate limit|locked/i.test(detail)) kind = "quota";
    // Google says how long in its answer ("retryDelay": "34s"), others in Retry-After
    const said = /"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/.exec(raw);
    const retry = Math.ceil(Number(response.headers.get("retry-after")) || (said ? Number(said[1]) : 0));
    const rate = response.status === 429 && !/balance|billing|locked|per day|daily/i.test(detail);
    throw new GenerativeError(kind, detail, rate, retry);
  };
  const post = async (url, headers, body, signal) => {
    let response;
    try {
      response = await fetch(url, { method: "POST", headers: Object.assign({ "Content-Type": "application/json" }, headers), body: JSON.stringify(body), signal });
    } catch (error) {
      if (error && error.name === "AbortError") throw error;
      throw new GenerativeError("network", String((error && error.message) || error));
    }
    if (!response.ok) await readError(response);
    return response.json();
  };

  const postForm = async (url, headers, body, signal) => {
    let response;
    try { response = await fetch(url, { method: "POST", headers, body, signal }); }
    catch (error) {
      if (error && error.name === "AbortError") throw error;
      throw new GenerativeError("network", String((error && error.message) || error));
    }
    if (!response.ok) await readError(response);
    return response.json();
  };

  // The last picture of an answer, whatever its shape: Gemini's parts (inlineData or inline_data),
  // the Interactions API's blocks ({ type: "image", data }), skipping the model's thought pictures
  const pictureIn = (answer) => {
    let found = null;
    const walk = (node) => {
      if (!node || typeof node !== "object") return;
      if (Array.isArray(node)) {
        node.forEach(walk);
        return;
      }
      const inline = node.inlineData || node.inline_data;
      if (inline && typeof inline.data === "string" && !node.thought) found = { mime: inline.mimeType || inline.mime_type || "image/png", data: inline.data };
      else if (node.type === "image" && typeof node.data === "string" && !node.thought) found = { mime: node.mime_type || node.mimeType || "image/png", data: node.data };
      Object.keys(node).forEach((key) => {
        if (key !== "inlineData" && key !== "inline_data" && key !== "data") walk(node[key]);
      });
    };
    walk(answer);
    return found;
  };
  // Why no picture came back: what the model said instead, or why it stopped
  const refusalOf = (answer) => {
    const feedback = answer && answer.promptFeedback;
    if (feedback && feedback.blockReason) return new GenerativeError("blocked", feedback.blockReason);
    const candidate = answer && answer.candidates && answer.candidates[0];
    const words = [];
    const walk = (node) => {
      if (!node || typeof node !== "object") return;
      if (Array.isArray(node)) return node.forEach(walk);
      if (typeof node.text === "string" && !node.thought) words.push(node.text);
      Object.keys(node).forEach((key) => key !== "text" && walk(node[key]));
    };
    walk(candidate ? candidate.content : answer && (answer.steps || answer.outputs));
    const reason = candidate && candidate.finishReason;
    if (reason && /SAFETY|PROHIBITED|BLOCK|RECITATION/i.test(reason)) return new GenerativeError("blocked", words.join(" ").trim() || reason);
    return new GenerativeError("noimage", words.join(" ").trim().slice(0, 300) || reason || "");
  };

  const toBitmap = async (blob) => {
    try {
      return await createImageBitmap(blob);
    } catch (error) {
      throw new GenerativeError("other", "The picture that came back could not be read.");
    }
  };
  const bytesOf = (data) => {
    const raw = atob(data);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    return bytes;
  };

  const viaGoogle = async ({ key, model, prompt, image, ratio, size, signal }) => {
    const headers = { "x-goog-api-key": key };
    const root = "https://generativelanguage.googleapis.com/v1beta";
    const imageConfig = { aspectRatio: ratio };
    if (size && knowsSizes(model)) imageConfig.imageSize = size;
    const classic = () => post(`${root}/models/${encodeURIComponent(model)}:generateContent`, headers, {
      contents: [{ role: "user", parts: [{ text: prompt }, { inline_data: { mime_type: image.mime, data: image.data } }] }],
      generationConfig: { responseModalities: ["TEXT", "IMAGE"], imageConfig },
    }, signal);
    // The newest models may only answer Google's Interactions API
    const interactions = () => {
      const format = { type: "image", mime_type: "image/png", aspect_ratio: ratio };
      if (size && knowsSizes(model)) format.image_size = size;
      return post(`${root}/interactions`, headers, {
        model,
        input: [{ type: "text", text: prompt }, { type: "image", mime_type: image.mime, data: image.data }],
        response_format: format,
      }, signal);
    };
    let answer;
    try {
      answer = await classic();
    } catch (error) {
      if (!(error instanceof GenerativeError) || error.kind !== "other" || !/not found|not supported|unsupported|interactions/i.test(error.detail)) throw error;
      answer = await interactions();
    }
    const picture = pictureIn(answer);
    if (!picture) throw refusalOf(answer);
    return { picture: await toBitmap(new Blob([bytesOf(picture.data)], { type: picture.mime })), usage: answer.usageMetadata || null };
  };

  const viaFal = async ({ key, model, prompt, image, mask, quality, ratio, size, signal }) => {
    const url = `data:${image.mime};base64,${image.data}`;
    const body = { prompt, num_images: 1, output_format: "png", sync_mode: true };
    if (/^ideogram\//.test(model)) {
      // Ideogram edits only where its mask is black, and keeps the rest pixel for pixel
      body.image_url = url;
      if (mask) body.mask_url = `data:${mask.mime};base64,${mask.data}`;
      if (quality) body.quality = quality;
      delete body.output_format;
    } else if (/kontext/.test(model)) body.image_url = url;
    else if (/nano-banana|gemini/.test(model)) body.image_urls = [url];
    else {
      body.image_url = url;
      body.image_urls = [url];
    }
    if (/nano-banana|gemini|kontext/.test(model)) body.aspect_ratio = ratio;
    if (size && knowsSizes(model)) body.resolution = size;
    const endpoint = String(model).replace(/^https?:\/\/(queue\.)?fal\.run\//, "").replace(/^\/+/, "");
    const answer = await post(`https://fal.run/${endpoint}`, { Authorization: `Key ${key}` }, body, signal);
    const first = (answer.images && answer.images[0]) || answer.image;
    if (!first || !first.url) throw new GenerativeError(answer.has_nsfw_concepts && answer.has_nsfw_concepts[0] ? "blocked" : "noimage", answer.description || "");
    let blob;
    try {
      const response = await fetch(first.url, { signal });
      if (!response.ok) throw new Error(response.status);
      blob = await response.blob();
    } catch (error) {
      if (error && error.name === "AbortError") throw error;
      throw new GenerativeError("network", String((error && error.message) || error));
    }
    return { picture: await toBitmap(blob) };
  };

  const imageUrlIn = (answer) => {
    let found = null;
    const walk = (node) => {
      if (found || !node || typeof node !== "object") return;
      if (Array.isArray(node)) { node.forEach(walk); return; }
      if (typeof node.b64_json === "string") { found = { data: node.b64_json, mime: "image/png" }; return; }
      const container = node.image_url || node.imageUrl;
      const url = typeof container === "string" ? container : container && container.url;
      if (typeof url === "string") { found = { url }; return; }
      Object.keys(node).forEach((key) => walk(node[key]));
    };
    walk(answer);
    return found;
  };
  const pictureFromUrl = async (found, signal, base) => {
    if (found.data) return toBitmap(new Blob([bytesOf(found.data)], { type: found.mime || "image/png" }));
    const inline = typeof found.url === "string" && /^data:(image\/[\w.+-]+);base64,(.+)$/s.exec(found.url);
    if (inline) return toBitmap(new Blob([bytesOf(inline[2])], { type: inline[1] }));
    let url;
    try { url = new URL(found.url, base); }
    catch (error) { throw new GenerativeError("noimage", "The service returned an invalid image address."); }
    if (!/^https?:$/.test(url.protocol)) throw new GenerativeError("noimage", "The service returned an unsupported image address.");
    let response;
    try { response = await fetch(url, { signal }); }
    catch (error) {
      if (error && error.name === "AbortError") throw error;
      throw new GenerativeError("network", String((error && error.message) || error));
    }
    if (!response.ok) throw new GenerativeError("network", `Image download: ${response.status}`);
    const type = response.headers.get("content-type") || "";
    if (type && !type.startsWith("image/")) throw new GenerativeError("noimage", "The image address did not return an image.");
    return toBitmap(await response.blob());
  };
  const viaOpenRouter = async ({ key, model, prompt, image, signal }) => {
    const answer = await post("https://openrouter.ai/api/v1/chat/completions", {
      Authorization: `Bearer ${key}`,
      "X-Title": "SG Typer Studio",
    }, {
      model,
      modalities: ["image", "text"],
      messages: [{ role: "user", content: [
        { type: "text", text: prompt },
        { type: "image_url", image_url: { url: `data:${image.mime};base64,${image.data}` } },
      ] }],
    }, signal);
    const found = imageUrlIn(answer);
    if (!found) throw refusalOf(answer);
    return { picture: await pictureFromUrl(found, signal), usage: answer.usage || null };
  };
  const endpointOf = (settings) => {
    const raw = String(settings.endpoints?.custom || "").trim();
    let url;
    try { url = new URL(raw); } catch (error) { throw new GenerativeError("endpoint", "Enter a valid API base URL."); }
    if (!/^https?:$/.test(url.protocol)) throw new GenerativeError("endpoint", "Only HTTP(S) API endpoints are supported.");
    url.username = ""; url.password = ""; url.search = ""; url.hash = "";
    return url.toString().replace(/\/$/, "");
  };
  const viaCompatible = async ({ key, model, prompt, image, settings, signal }) => {
    const base = endpointOf(settings);
    const url = /\/images\/edits$/i.test(base) ? base : `${base}/images/edits`;
    const body = new FormData();
    body.append("model", model);
    body.append("prompt", prompt);
    body.append("image", new Blob([bytesOf(image.data)], { type: image.mime }), `selection.${image.mime === "image/png" ? "png" : "jpg"}`);
    const headers = key ? { Authorization: `Bearer ${key}` } : {};
    const answer = await postForm(url, headers, body, signal);
    const found = imageUrlIn(answer);
    if (!found) throw refusalOf(answer);
    return { picture: await pictureFromUrl(found, signal, base) };
  };

  // Models that take the selection as a mask, black where they draw
  const takesMask = (service, model) => service === "fal" && /^ideogram\//.test(model);

  // `canvas`: what is sent; resolves with the model's picture, as an ImageBitmap
  // `canvas`: what is sent; `mask`: the selection on it, black on white (for the models that take
  // one). Resolves with the model's picture, as an ImageBitmap; `onCost` hears what it cost.
  const generate = async ({ settings, prompt, canvas, mask, ratio, size, signal, onCost, onProgress }) => {
    const service = settings.service;
    if (service === "adobe") {
      const model = modelOf(settings);
      const words = String(prompt || "").trim();
      const asked = model !== "firefly-fill" ? (words ? `${words}\n\n${KEEP_FRAMING}` : DEFAULT_PROMPT) : words;
      return viaAdobe({ model, canvas, mask, prompt: asked, size, signal });
    }
    if (isLocal(service)) {
      const model = modelOf(settings);
      if (!isFlux(model)) return viaLocal({ canvas, mask, signal, onProgress });
      const words = (prompt || "").trim();
      return viaFlux({ model, canvas, mask, prompt: words ? `${words}\n\n${KEEP_FRAMING}` : FLUX_PROMPT, signal, onProgress });
    }
    const key = (settings.keys[service] || "").trim();
    if (!key && service !== "custom") throw new GenerativeError("nokey");
    const model = modelOf(settings);
    const words = (prompt || "").trim();
    const asked = words ? `${words}\n\n${KEEP_FRAMING}` : DEFAULT_PROMPT;
    const image = await encode(canvas);
    const masked = mask && takesMask(service, model) ? await encodeMask(mask) : null;
    const run = service === "fal" ? viaFal : service === "openrouter" ? viaOpenRouter : service === "custom" ? viaCompatible : viaGoogle;
    const quality = qualityOf(settings, service, model);
    const { picture, usage } = await run({ key, model, prompt: asked, image, mask: masked, quality, ratio, size, settings, signal });
    const cost = costOf(settings, service, model, { size, usage, megapixels: (picture.width * picture.height) / 1e6 });
    if (cost) {
      addSpent(cost.usd);
      if (onCost) onCost(cost);
    }
    return picture;
  };
  // A mask needs both a part to draw and a part to keep, or Ideogram refuses it: without one
  // (a selection over the whole area), the model gets no mask and redraws everything
  const encodeMask = async (mask) => {
    const data = mask.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, mask.width, mask.height).data;
    let black = false;
    let white = false;
    for (let i = 0; i < data.length && !(black && white); i += 4) {
      if (data[i] < 128) black = true;
      else white = true;
    }
    if (!black || !white) return null;
    const blob = await new Promise((resolve) => mask.toBlob(resolve, "image/png"));
    return blob ? { mime: "image/png", data: await base64Of(blob) } : null;
  };

  /* ------------------------- on this device: LaMa Manga ------------------------- */

  // One worker for the app, kept while it's used, let go after a while without (its model holds
  // about a gigabyte of memory, on the graphics card or not)
  const LOCAL_IDLE = 5 * 60 * 1000;
  const MODEL_URL = "https://huggingface.co/mayocream/lama-manga-onnx/resolve/b55497aadbfcb9740e1ed16f008268d71b4f3f79/lama-manga.onnx";
  let worker = null;
  let workerJobs = 0;
  let idleTimer = 0;
  let nextId = 0;
  const pending = new Map();
  const startWorker = () => {
    clearTimeout(idleTimer);
    if (worker) return worker;
    try {
      worker = new Worker("lama-worker.js");
    } catch (error) {
      throw new GenerativeError("local", "This browser can't run the model in the background.");
    }
    worker.onmessage = (event) => {
      const answer = event.data || {};
      const job = pending.get(answer.id);
      if (!job) return;
      if (answer.progress) {
        job.onProgress(answer.progress);
        return;
      }
      pending.delete(answer.id);
      if (answer.error) job.reject(new GenerativeError(answer.error.kind === "download" ? "download" : "local", answer.error.message));
      else job.resolve(answer);
    };
    worker.onerror = (event) => {
      console.warn("SG Typer Studio: LaMa Manga's worker stopped", event.message || event);
      pending.forEach((job) => job.reject(new GenerativeError("local", event.message || "")));
      pending.clear();
      worker = null;
    };
    return worker;
  };
  const releaseWorker = () => {
    workerJobs -= 1;
    if (workerJobs > 0) return;
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      if (workerJobs > 0 || !worker) return;
      worker.terminate();
      worker = null;
    }, LOCAL_IDLE);
  };
  const viaLocal = async ({ canvas, mask, signal, onProgress }) => {
    // The area, square, at the model's size: what is under the black of the mask gets drawn
    const square = document.createElement("canvas");
    square.width = LOCAL_SIZE;
    square.height = LOCAL_SIZE;
    const sctx = square.getContext("2d", { willReadFrequently: true });
    sctx.imageSmoothingQuality = "high";
    sctx.fillStyle = "#fff";
    sctx.fillRect(0, 0, LOCAL_SIZE, LOCAL_SIZE);
    sctx.drawImage(canvas, 0, 0, LOCAL_SIZE, LOCAL_SIZE);
    const image = sctx.getImageData(0, 0, LOCAL_SIZE, LOCAL_SIZE).data;
    const hole = new Uint8Array(LOCAL_SIZE * LOCAL_SIZE);
    if (mask) {
      sctx.drawImage(mask, 0, 0, LOCAL_SIZE, LOCAL_SIZE);
      const m = sctx.getImageData(0, 0, LOCAL_SIZE, LOCAL_SIZE).data;
      // Any grey at the edge of the mask counts, so no stroke of a letter stays half there
      for (let i = 0; i < hole.length; i++) hole[i] = m[i * 4] < 250 ? 1 : 0;
    } else hole.fill(1);
    if (signal && signal.aborted) throw new DOMException("Aborted", "AbortError");
    const id = ++nextId;
    const thread = startWorker();
    workerJobs += 1;
    try {
      const answer = await new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject, onProgress: onProgress || (() => {}) });
        // A stopped job's answer is let go: the run itself can't be stopped halfway
        if (signal) signal.addEventListener("abort", () => {
          if (pending.delete(id)) reject(new DOMException("Aborted", "AbortError"));
        }, { once: true });
        thread.postMessage({ id, image: image.buffer, mask: hole.buffer }, [image.buffer, hole.buffer]);
      });
      console.info(`SG Typer Studio: LaMa Manga drew in ${answer.ms} ms on ${answer.device === "webgpu" ? "the graphics card" : "the processor"}`);
      return await createImageBitmap(new ImageData(new Uint8ClampedArray(answer.image), LOCAL_SIZE, LOCAL_SIZE));
    } finally {
      releaseWorker();
    }
  };
  // Whether the model is already on this device (its download done)
  const localReady = async () => {
    try {
      return Boolean(await (await caches.open("typer-models-1")).match(MODEL_URL));
    } catch (error) {
      return false;
    }
  };

  /* -------------------- on this computer: FLUX, in the desktop app -------------------- */

  const fluxJobs = new Map();
  let fluxCount = 0;
  if (desktopAI) desktopAI.onProgress((progress) => {
    const listener = fluxJobs.get(progress.id);
    if (listener) listener(progress);
  });
  const pngOf = async (canvas) => {
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) throw new GenerativeError("other", "The picture could not be encoded.");
    return new Uint8Array(await blob.arrayBuffer());
  };
  // A call to the app, stopped by `signal`: what it answers, or the error it says
  const askApp = async (call, signal, onProgress) => {
    const id = `flux-${++fluxCount}`;
    fluxJobs.set(id, onProgress || (() => {}));
    const stop = () => desktopAI.cancel(id);
    if (signal) signal.addEventListener("abort", stop, { once: true });
    try {
      const answer = await call(id);
      if (answer && answer.ok) return answer.value;
      const kind = answer && answer.kind;
      if (kind === "cancelled" || (signal && signal.aborted)) throw new DOMException("Aborted", "AbortError");
      throw new GenerativeError(kind === "download" ? "download" : "local", (answer && answer.message) || "");
    } finally {
      fluxJobs.delete(id);
      if (signal) signal.removeEventListener("abort", stop);
    }
  };
  // What is still to download for the model in use, in bytes: 0 when it is here, or not a FLUX
  const localDownload = async (settings) => {
    const model = modelOf(settings);
    if (!desktopAI || !isLocal(settings.service) || !isFlux(model)) return 0;
    const now = await desktopAI.status();
    return now && now.models[model] && !now.models[model].installed ? now.models[model].download : 0;
  };
  const localStatus = () => (desktopAI ? desktopAI.status() : Promise.resolve(null));
  const localRemove = (model) => (desktopAI ? desktopAI.remove(model) : Promise.resolve(null));
  const viaFlux = async ({ model, canvas, mask, prompt, signal, onProgress }) => {
    if (!desktopAI) throw new GenerativeError("local", "FLUX runs only in the desktop app.");
    // At the model's sizes, in steps of 16 pixels; the mask white where it draws
    const width = Math.max(64, Math.round(canvas.width / 16) * 16);
    const height = Math.max(64, Math.round(canvas.height / 16) * 16);
    const picture = document.createElement("canvas");
    picture.width = width;
    picture.height = height;
    const pctx = picture.getContext("2d");
    pctx.imageSmoothingQuality = "high";
    pctx.fillStyle = "#fff";
    pctx.fillRect(0, 0, width, height);
    pctx.drawImage(canvas, 0, 0, width, height);
    const holes = document.createElement("canvas");
    holes.width = width;
    holes.height = height;
    const hctx = holes.getContext("2d", { willReadFrequently: true });
    hctx.fillStyle = "#fff";
    hctx.fillRect(0, 0, width, height);
    if (mask) hctx.drawImage(mask, 0, 0, width, height);
    else {
      hctx.fillStyle = "#000";
      hctx.fillRect(0, 0, width, height);
    }
    const shades = hctx.getImageData(0, 0, width, height);
    for (let i = 0; i < shades.data.length; i += 4) {
      const v = shades.data[i] < 250 ? 255 : 0;
      shades.data[i] = v;
      shades.data[i + 1] = v;
      shades.data[i + 2] = v;
      shades.data[i + 3] = 255;
    }
    hctx.putImageData(shades, 0, 0);
    const [image, holeBytes] = await Promise.all([pngOf(picture), pngOf(holes)]);
    const tell = onProgress || (() => {});
    if (await localDownload({ service: "local", models: { local: model }, custom: {} })) {
      await askApp((id) => desktopAI.install(id, model), signal, tell);
    }
    const bytes = await askApp((id) => desktopAI.generate(id, { model, image, mask: holeBytes, prompt, width, height }), signal, tell);
    return toBitmap(new Blob([bytes], { type: "image/png" }));
  };

  let adobeJob = 0;
  const viaAdobe = async ({ model, canvas, mask, prompt, size, signal }) => {
    if (!adobe) throw new GenerativeError("adobeauth");
    if (signal) signal.throwIfAborted();
    // Image 5 edits a reference image by instruction and may move its contents. Fill &
    // Expand instead takes an aligned mask and returns pixels in the original positions.
    const scale = Math.min(1, 1984 / Math.max(canvas.width, canvas.height));
    const instructionEdit = model !== "firefly-fill";
    const alphaMask = model.startsWith("gpt-image-");
    const width = instructionEdit ? Math.max(1, Math.round(canvas.width * scale)) : Math.max(64, Math.ceil(canvas.width * scale / 16) * 16);
    const height = instructionEdit ? Math.max(1, Math.round(canvas.height * scale)) : Math.max(64, Math.ceil(canvas.height * scale / 16) * 16);
    const picture = document.createElement("canvas");
    picture.width = width;
    picture.height = height;
    const ctx = picture.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(canvas, 0, 0, width, height);
    const image = await pngOf(picture);
    let hole;
    if (!instructionEdit || (alphaMask && mask)) {
      const holes = document.createElement("canvas");
      holes.width = width;
      holes.height = height;
      const hctx = holes.getContext("2d", { willReadFrequently: true });
      hctx.fillStyle = mask ? "#fff" : "#000";
      hctx.fillRect(0, 0, width, height);
      hctx.imageSmoothingEnabled = false;
      if (mask) hctx.drawImage(mask, 0, 0, width, height);
      const shades = hctx.getImageData(0, 0, width, height);
      for (let i = 0; i < shades.data.length; i += 4) {
        // GPT regenerates transparent areas; Fill & Expand uses opaque white there.
        const alpha = alphaMask ? shades.data[i] : 255;
        const value = alphaMask ? 255 : 255 - shades.data[i];
        shades.data[i] = shades.data[i + 1] = shades.data[i + 2] = value;
        shades.data[i + 3] = alpha;
      }
      hctx.putImageData(shades, 0, 0);
      hole = await pngOf(holes);
    }
    if (signal) signal.throwIfAborted();
    const id = `firefly-${++adobeJob}`;
    const stop = () => adobe.cancel(id);
    signal?.addEventListener("abort", stop, { once: true });
    try {
      const answer = await adobe.generate(id, { model, image, ...(instructionEdit ? { size: size === "2K" ? "2K" : "1K" } : {}), ...(hole ? { mask: hole } : {}), prompt });
      if (signal?.aborted || answer?.kind === "cancelled") throw new DOMException("Aborted", "AbortError");
      if (!answer?.ok) {
        if (answer?.kind === "adobeauth") setAdobeState(null);
        throw new GenerativeError(answer?.kind || "other", answer?.message || "");
      }
      const result = await toBitmap(new Blob([answer.value]));
      if (instructionEdit) return result;
      if (result.width === canvas.width && result.height === canvas.height) return result;
      picture.width = canvas.width;
      picture.height = canvas.height;
      ctx.drawImage(result, 0, 0, picture.width, picture.height);
      result.close();
      return createImageBitmap(picture);
    } finally {
      signal?.removeEventListener("abort", stop);
      // Read Adobe's balance even after a failure: refunds can be delayed.
      void adobeCredits(true);
    }
  };

  window.TypeRGenerative = { SERVICES, DEFAULT_PROMPT, LOCAL_SIZE, LAMA_SIZE, load, save, modelOf, modelsOf, slugOf, ready, isLocal, isFlux, takesPrompt, fixedSize, drawsInPlace, longestFor, localReady, localDownload, localStatus, localRemove, ratiosFor, generate, endpointOf, GenerativeError, qualitiesOf, qualityOf, priceOf, costOf, refreshPrices, spent, resetSpent, adobeStatus, adobeConnect, adobeDisconnect, adobeCredits };
})();
