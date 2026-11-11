// Adobe's public discovery catalogue, observed 2026-11-10. These are Adobe API
// versions, not provider API names. In particular 2.6 Flare is star-swirl.
const PARTNER_MODELS = Object.freeze({
  "gpt-image-2": { name: "GPT Image 2", modelId: "gpt-image", version: "2", mask: true },
  "gpt-image-2.5-flare": { name: "GPT Image 2.5 Flare", modelId: "gpt-image", version: "gpt-image-2.5-flare", mask: true },
  "gpt-image-2.5-sunburst": { name: "GPT Image 2.5 Sunburst", modelId: "gpt-image", version: "gpt-image-2.5-prism", mask: true },
  "gpt-image-2.6-flare": { name: "GPT Image 2.6 Flare", modelId: "gpt-image", version: "gpt-image-2.6-star-swirl", mask: true },
  "gpt-image-2.6-sunburst": { name: "GPT Image 2.6 Sunburst", modelId: "gpt-image", version: "gpt-image-2.6-aurora", mask: true },
  "gemini-nano-banana-2.1": { name: "Gemini Nano Banana 2.1", modelId: "gemini-flash", version: "nano-banana-2026-09" },
  "gemini-3.1-flash-image": { name: "Gemini 3.1 (Nano Banana 2)", modelId: "gemini-flash", version: "nano-banana-3" },
  "gemini-3-pro-image": { name: "Gemini 3.0 (Nano Banana Pro)", modelId: "gemini-flash", version: "nano-banana-2" },
});

const partnerModel = (id) => Object.hasOwn(PARTNER_MODELS, id) ? PARTNER_MODELS[id] : null;
const RATIOS = ["1:1", "3:2", "2:3", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"];

const partnerBody = (model, request, imageId, maskId, width, height, seeds) => {
  const body = {
    modelId: model.modelId, modelVersion: model.version, n: 1, prompt: request.prompt,
    referenceBlobs: [{ id: imageId, usage: model.mask ? "source" : "general" }],
    output: { storeInputs: false }, generationMetadata: { module: "image-editing" },
  };
  if (model.mask) {
    if (maskId) body.referenceBlobs.push({ id: maskId, usage: "mask" });
    // GPT accepts dimensions aligned to 16, 480..3840 per side, at most 3:1.
    const ratio = Math.min(3, Math.max(1 / 3, width / height));
    const pixels = request.size === "2K" ? 4 * 1024 ** 2 : 1024 ** 2;
    let w = Math.round(Math.sqrt(pixels * ratio) / 16) * 16;
    let h = Math.round(Math.sqrt(pixels / ratio) / 16) * 16;
    w = Math.min(w, h * 3); h = Math.min(h, w * 3);
    body.size = { width: w, height: h };
    body.generationSettings = { detailLevel: 3 };
  } else {
    const ratios = model.version === "nano-banana-2" ? RATIOS : RATIOS.concat(["1:8", "8:1", "1:4", "4:1"]);
    const distance = (ratio) => { const [w, h] = ratio.split(":").map(Number); return Math.abs(Math.log((w / h) / (width / height))); };
    body.generationSettings = { aspectRatio: ratios.reduce((best, ratio) => distance(ratio) < distance(best) ? ratio : best) };
    body.resolution = request.size === "2K" ? "2K" : "1K";
    body.seeds = seeds;
  }
  return body;
};

module.exports = { PARTNER_MODELS, partnerModel, partnerBody };
