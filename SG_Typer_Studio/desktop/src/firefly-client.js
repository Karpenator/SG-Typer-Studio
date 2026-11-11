// Firefly web's personal-account protocol. Credentials are supplied by the dedicated Adobe
// session in the main process, never by the editor. See docs/research/firefly-personal-account.md.
const { partnerModel, partnerBody } = require("./firefly-models");
const { createHash } = require("node:crypto");
const UPLOAD = "https://firefly-clio-imaging.adobe.io/v2/storage/image";
const FILL = "https://di-me.ff.adobe.io/v2/images/generate-fill";
const IMAGE5 = "https://image-v5.ff.adobe.io/v1/images/generate-async";
const IMAGE5_UPLOAD = "https://image-v5.ff.adobe.io/v2/storage/image";
const PARTNER = "https://firefly-3p.ff.adobe.io/v2/3p-images/generate-async";
const PARTNER_UPLOAD = "https://firefly-3p.ff.adobe.io/v2/storage/image";
const API_HOSTS = new Set(["firefly-clio-imaging.adobe.io", "di-me.ff.adobe.io", "firefly.adobe.io", "image-v5.ff.adobe.io", "firefly-3p.ff.adobe.io"]);
// Adobe routes jobs to numbered deployments (epo, epv, etc.). Match this family
// rather than individual deployment numbers; only job paths are allowed below.
const JOB_HOST = /^(?:bks|firefly)(?:-ep[a-z]*[0-9]+)?\.adobe\.io$/;
const MAX_IMAGE = 32 * 1024 * 1024;

class FireflyError extends Error {
  constructor(kind, message, rate = false, retry = 0) {
    super(message);
    Object.assign(this, { kind, rate, retry });
  }
}

const safeUrl = (value, image = false) => {
  let url;
  try { url = new URL(value); } catch { throw new FireflyError("other", "Invalid Adobe response URL."); }
  const host = url.hostname;
  const adobe = host.endsWith(".adobe.io") || host.endsWith(".adobe.com") || host.endsWith(".adobesensei.io");
  const s3 = /(?:^|\.)s3(?:[.-][a-z0-9-]+)?\.amazonaws\.com$/.test(host);
  const job = JOB_HOST.test(host) && /^\/(?:v\d+\/)?jobs\/(?:result|cancel)(?:\/|$)/.test(url.pathname);
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443") ||
      !(image ? adobe || s3 : API_HOSTS.has(host) || job)) throw new FireflyError("other", `Unexpected Adobe response URL (${host}).`);
  return url.href;
};

const pngSize = (bytes) => {
  if (!(bytes instanceof Uint8Array) || bytes.length < 33 || bytes.length > MAX_IMAGE) throw new FireflyError("other", "Invalid image size.");
  const data = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (!data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) || data.toString("ascii", 12, 16) !== "IHDR") throw new FireflyError("other", "A PNG image is required.");
  return [data.readUInt32BE(16), data.readUInt32BE(20)];
};

const validate = (request) => {
  const partner = request && partnerModel(request.model);
  if (!request || (!partner && ![undefined, "firefly-fill", "firefly-image-5"].includes(request.model))) throw new FireflyError("other", "Unknown Firefly model.");
  const image5 = request.model === "firefly-image-5";
  if (typeof request.prompt !== "string" || request.prompt.length > (partner ? 32000 : image5 ? 1500 : 1024) || ((image5 || partner) && !request.prompt.trim())) throw new FireflyError("other", "Invalid Firefly prompt.");
  const [w, h] = pngSize(request.image);
  if (image5 || partner) {
    if (w < 1 || h < 1 || w * h > 4e6 || (request.size !== undefined && !["1K", "2K"].includes(request.size))) throw new FireflyError("other", "Invalid Adobe reference dimensions.");
    if (partner?.modelId === "gemini-flash" && request.image.length > 20 * 1024 ** 2) throw new FireflyError("other", "The Adobe reference image is too large.");
    if (partner?.mask && request.mask !== undefined) {
      const [mw, mh] = pngSize(request.mask);
      if (mw !== w || mh !== h || ![4, 6].includes(request.mask[25])) throw new FireflyError("other", "An alpha mask matching the reference image is required.");
    }
    return;
  }
  const [mw, mh] = pngSize(request.mask);
  if (w !== mw || h !== mh || w < 64 || h < 64 || w % 16 || h % 16 || w * h > 4e6) throw new FireflyError("other", "Image and mask dimensions do not match Firefly's limits.");
};

const limitedBytes = async (response, max) => {
  if (Number(response.headers.get("content-length")) > max) throw new FireflyError("other", "Adobe's response is too large.");
  if (!response.body) throw new FireflyError("other", "Adobe returned an empty response.");
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > max) throw new FireflyError("other", "Adobe's response is too large.");
      chunks.push(Buffer.from(value));
    }
  } finally { await reader.cancel().catch(() => {}); }
  return Buffer.concat(chunks, length);
};

const json = async (response) => {
  const bytes = await limitedBytes(response, 1024 * 1024);
  try { return JSON.parse(bytes.toString("utf8")); } catch { throw new FireflyError("other", "Adobe returned an unreadable response."); }
};

const errorOf = async (response) => {
  const data = await json(response).catch(() => ({}));
  const code = String(response.headers.get("x-access-error") || data.error_code || data.error?.error_code || "");
  // No raw server messages: those may contain request URLs or account details.
  const detail = `Adobe HTTP ${response.status}${/^[a-z_0-9-]{1,80}$/i.test(code) ? ` (${code})` : ""}.`;
  if (response.status === 401 || /invalid_ims|invalid_token/.test(code)) return new FireflyError("adobeauth", detail);
  if (/quota|credits|taste_exhausted/.test(code) || response.status === 402) return new FireflyError("quota", detail);
  if (/unsafe|prompt_.*denied|prompt_not_supported/.test(code) || response.status === 451) return new FireflyError("blocked", detail);
  if (response.status === 403) return new FireflyError("adobeaccess", detail);
  if (response.status === 429) return new FireflyError("quota", detail, false, Math.min(300, Math.max(0, Number(response.headers.get("retry-after")) || 0)));
  return new FireflyError("other", detail);
};

const delay = (ms, signal) => new Promise((resolve, reject) => {
  signal.throwIfAborted();
  const done = () => { signal.removeEventListener("abort", abort); resolve(); };
  const timer = setTimeout(done, ms);
  const abort = () => { clearTimeout(timer); reject(signal.reason); };
  signal.addEventListener("abort", abort, { once: true });
});

const createClient = ({ fetch: requestFetch = fetch, credentials, wait = delay }) => ({
  async generate(request, signal, progress = () => {}) {
    validate(request);
    const image5 = request.model === "firefly-image-5";
    const partner = partnerModel(request.model);
    const instructionEdit = Boolean(image5 || partner);
    const endpoint = partner ? PARTNER : image5 ? IMAGE5 : FILL;
    signal?.throwIfAborted();
    const deadline = AbortSignal.timeout(5 * 60 * 1000);
    const active = signal ? AbortSignal.any([signal, deadline]) : deadline;
    const auth = await credentials();
    active.throwIfAborted();
    if (!auth?.token || /[\r\n]/.test(auth.token)) throw new FireflyError("adobeauth", "Sign in to Adobe Firefly.");
    const headers = { Authorization: `Bearer ${auth.token}`, "X-api-key": "clio-playground-web" };
    let cancelUrl = null;
    const send = async (url, options = {}, image = false, phase = "request") => {
      const started = Date.now();
      const response = await requestFetch(safeUrl(url, image), {
        ...options, redirect: "error", signal: active,
        headers: image ? {} : { ...headers, ...options.headers },
      });
      if (!response.ok) {
        const error = await errorOf(response);
        error.message += ` [${phase}, ${Math.round((Date.now() - started) / 1000)}s]`;
        throw error;
      }
      return response;
    };
    try {
      progress({ phase: "start" });
      const upload = async (bytes) => {
        const result = await json(await send(partner ? PARTNER_UPLOAD : image5 ? IMAGE5_UPLOAD : UPLOAD, { method: "POST", headers: { "Content-Type": "image/png" }, body: bytes }, false, "upload"));
        const id = result.images?.[0]?.id;
        if (typeof id !== "string" || !id || id.length > 512) throw new FireflyError("other", "Adobe did not accept the image.");
        return id;
      };
      const imageId = await upload(request.image);
      const seeds = [Math.floor(Math.random() * 0xffffffff)];
      // Image 5 is Adobe's instruction-based editor. Its reference is the source image;
      // it does not accept Fill & Expand's input/mask contract. No model fallback.
      const body = partner ? partnerBody(partner, request, imageId, partner.mask && request.mask ? await upload(request.mask) : null, ...pngSize(request.image), seeds) : image5 ? {
        modelVersion: "image5", n: 1, seeds, prompt: request.prompt,
        referenceBlobs: [{ id: imageId, usage: "general" }],
        resolutionLevel: request.size === "2K" ? "4MP" : "1MP",
        output: { storeInputs: false }, generationMetadata: { module: "text2image" },
      } : {
        embedContentCredentials: true,
        input: { image: { source: { id: imageId } }, mask: { source: { id: await upload(request.mask) } } },
        output: { format: "png" }, prompt: request.prompt,
        seeds,
      };
      // Same context as Adobe's generation client (modules 8930 and 45454).
      // These headers belong only to generation, never to result downloads.
      const generationHeaders = { "Content-Type": "application/json", Accept: "application/json" };
      if (typeof auth.arpToken === "string" && auth.arpToken.length <= 32768 && !/[\r\n]/.test(auth.arpToken) && auth.arpToken) generationHeaders["x-arp-session-id"] = auth.arpToken;
      if (typeof auth.userId === "string" && auth.userId && auth.userId.length <= 512 && !/[\r\n]/.test(auth.userId)) generationHeaders["x-nonce"] = createHash("sha256").update(`${auth.userId}-${request.prompt.slice(0, 256)}`).digest("hex");
      let response = await send(endpoint, { method: "POST", headers: generationHeaders, body: JSON.stringify(body) }, false, "generation");
      let result = await json(response);
      const jobUrl = (value) => safeUrl(new URL(value, new URL(endpoint).origin).href);
      const nextPoll = () => response.headers.get("x-override-status-link") || result.links?.result?.href;
      let pollUrl = nextPoll() ? jobUrl(nextPoll()) : null;
      if (result.links?.cancel?.href) cancelUrl = jobUrl(result.links.cancel.href);
      for (;;) {
        const status = String(response.headers.get("x-task-status") || response.headers.get("x-job-status") || result.status || "").toUpperCase();
        if (result.error || result.error_code || ["FAILED", "CANCELED", "CANCELLED"].includes(status)) throw new FireflyError("other", "Adobe could not finish the generation.");
        if (result.outputs?.length && (!instructionEdit || !status || status === "COMPLETED")) break;
        if (!pollUrl) throw new FireflyError("noimage", "Adobe returned no image or job.");
        await wait(Math.min(10000, Math.max(1000, (Number(response.headers.get("retry-after")) || 2) * 1000)), active);
        response = await send(pollUrl, {}, false, "status");
        result = await json(response);
        if (nextPoll()) pollUrl = jobUrl(nextPoll());
      }
      cancelUrl = null;
      const url = result.outputs[0]?.image?.presignedUrl;
      if (!url) throw new FireflyError("noimage", "Adobe returned no downloadable image.");
      const bytes = await limitedBytes(await send(url, {}, true, "download"), MAX_IMAGE);
      if (instructionEdit) {
        // Image 5 can change dimensions and return PNG, JPEG or WebP. Chromium decodes
        // the bounded image, then the editor aligns it and clips it to the selection.
        const png = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
        const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
        const webp = bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
        if (!png && !jpeg && !webp) throw new FireflyError("noimage", "Adobe returned an unsupported image.");
        return new Uint8Array(bytes);
      }
      const [w, h] = pngSize(bytes);
      const [expectedW, expectedH] = pngSize(request.image);
      if (w !== expectedW || h !== expectedH) throw new FireflyError("noimage", "Adobe changed the image dimensions.");
      return new Uint8Array(bytes);
    } catch (error) {
      if (active.aborted && cancelUrl) {
        await requestFetch(cancelUrl, { method: instructionEdit ? "PUT" : "POST", headers, redirect: "error", signal: AbortSignal.timeout(5000) }).catch(() => {});
      }
      if (signal?.aborted) throw new FireflyError("cancelled", "Cancelled.");
      if (deadline.aborted) throw new FireflyError("network", "Adobe took too long to respond.");
      if (error instanceof FireflyError) throw error;
      throw new FireflyError("network", "Adobe Firefly could not be reached.");
    }
  },
});

module.exports = { createClient, FireflyError, safeUrl, validate };
