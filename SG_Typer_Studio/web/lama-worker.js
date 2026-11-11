// Generative Fill on this device: LaMa Manga, a LaMa inpainting model trained again on manga and
// anime pages (mayocream/lama-manga, here in its ONNX form), run by ONNX Runtime Web, on the
// graphics card through WebGPU when there is one, on the processor otherwise. No key, no prompt:
// it redraws what is under the mask from what surrounds it.
//
// The model (207 MB) and the runtime (27 MB) are downloaded the first time, checked against their
// SHA-256, and kept in the browser's Cache Storage: from then on it works offline.
//
// Messages in: { id, image: ArrayBuffer (RGBA, SIZE × SIZE), mask: ArrayBuffer (one byte a pixel,
// 1 where to draw) }. Out: { id, progress: { phase, loaded, total } }, then { id, image } (RGBA)
// or { id, error: { kind, message } }.

"use strict";

const SIZE = 512;
const CACHE = "typer-models-1";
const ORT = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.30.0/dist/";
const FILES = {
  model: {
    url: "https://huggingface.co/mayocream/lama-manga-onnx/resolve/b55497aadbfcb9740e1ed16f008268d71b4f3f79/lama-manga.onnx",
    sha256: "4512adab295ee5a5e02ccd1bdf8d45dccbac88309d9cff1532ffd5de876f02a4",
    size: 207482644,
  },
  wasm: {
    url: `${ORT}ort-wasm-simd-threaded.asyncify.wasm`,
    sha256: "39f9f0894d478800487ed9f7dbe92618498db320cf55c8e3d89adff8dce658da",
    size: 26781914,
  },
  runtime: {
    url: `${ORT}ort.webgpu.bundle.min.mjs`,
    sha256: "0730816731ce2cdfb06f273da065d4a1c7091eb9d1756a83b2916c8a89d015e2",
    size: 117732,
  },
};

class LamaError extends Error {
  constructor(kind, message) {
    super(message || kind);
    this.kind = kind;
  }
}

const hex = (buffer) => Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, "0")).join("");
const openCache = async () => {
  try {
    return await caches.open(CACHE);
  } catch (error) {
    // A private window may refuse it: the files then come from the network each time
    return null;
  }
};

// A file, from the cache or else downloaded, checked, and kept. `onBytes(loaded)` follows it.
const fetchFile = async (file, onBytes) => {
  const cache = await openCache();
  if (cache) {
    const held = await cache.match(file.url);
    if (held) {
      const buffer = await held.arrayBuffer();
      if (buffer.byteLength === file.size) {
        onBytes(file.size);
        return buffer;
      }
      await cache.delete(file.url);
    }
  }
  let response;
  try {
    response = await fetch(file.url, { cache: "no-store" });
  } catch (error) {
    throw new LamaError("download", String((error && error.message) || error));
  }
  if (!response.ok || !response.body) throw new LamaError("download", `HTTP ${response.status}`);
  const bytes = new Uint8Array(file.size);
  const reader = response.body.getReader();
  let loaded = 0;
  for (;;) {
    let step;
    try {
      step = await reader.read();
    } catch (error) {
      throw new LamaError("download", String((error && error.message) || error));
    }
    if (step.done) break;
    if (loaded + step.value.length > file.size) throw new LamaError("download", "The file is bigger than expected.");
    bytes.set(step.value, loaded);
    loaded += step.value.length;
    onBytes(loaded);
  }
  if (loaded !== file.size) throw new LamaError("download", "The download stopped before the end.");
  if (hex(await crypto.subtle.digest("SHA-256", bytes)) !== file.sha256) throw new LamaError("download", "The file downloaded isn't the one expected.");
  if (cache) {
    try {
      await cache.put(file.url, new Response(bytes, { headers: { "Content-Type": "application/octet-stream", "Content-Length": String(file.size) } }));
    } catch (error) {
      // No room left: it works this time, and downloads again next time
    }
  }
  return bytes.buffer;
};

// Everything at once, its progress as one: { phase: "download", loaded, total }
let progressOf = () => {};
let loading = null;
const load = () => {
  if (loading) return loading;
  loading = (async () => {
    const total = FILES.model.size + FILES.wasm.size + FILES.runtime.size;
    const done = { model: 0, wasm: 0, runtime: 0 };
    let shown = 0;
    const tell = (name) => (loaded) => {
      done[name] = loaded;
      const sum = done.model + done.wasm + done.runtime;
      // Not on every chunk: a few hundred messages for the whole download
      if (sum === total || sum - shown > total / 400) {
        shown = sum;
        progressOf({ phase: "download", loaded: sum, total });
      }
    };
    const [model, wasm, runtime] = await Promise.all([fetchFile(FILES.model, tell("model")), fetchFile(FILES.wasm, tell("wasm")), fetchFile(FILES.runtime, tell("runtime"))]);
    progressOf({ phase: "start" });
    const script = URL.createObjectURL(new Blob([runtime], { type: "text/javascript" }));
    const ort = await import(script);
    ort.env.wasm.wasmBinary = wasm;
    ort.env.logLevel = "error";
    if (!self.crossOriginIsolated) ort.env.wasm.numThreads = 1;
    let session = null;
    let device = "wasm";
    const gpu = self.navigator && self.navigator.gpu;
    if (gpu) {
      try {
        if (await gpu.requestAdapter()) {
          session = await ort.InferenceSession.create(model, { executionProviders: ["webgpu"], graphOptimizationLevel: "all" });
          device = "webgpu";
        }
      } catch (error) {
        console.warn("SG Typer Studio: LaMa Manga can't use the graphics card, it runs on the processor", error);
        session = null;
      }
    }
    if (!session) session = await ort.InferenceSession.create(model, { executionProviders: ["wasm"], graphOptimizationLevel: "all" });
    return { ort, session, device };
  })();
  // A failed download is tried again on the next generation
  loading.catch(() => { loading = null; });
  return loading;
};

// One at a time: the graphics card has one model, and a second run would only wait for it
let queue = Promise.resolve();
const run = async ({ image, mask }) => {
  const { ort, session, device } = await load();
  const rgba = new Uint8ClampedArray(image);
  const hole = new Uint8Array(mask);
  const plane = SIZE * SIZE;
  const pixels = new Float32Array(plane * 3);
  const holes = new Float32Array(plane);
  for (let i = 0; i < plane; i++) {
    pixels[i] = rgba[i * 4] / 255;
    pixels[plane + i] = rgba[i * 4 + 1] / 255;
    pixels[plane * 2 + i] = rgba[i * 4 + 2] / 255;
    holes[i] = hole[i] ? 1 : 0;
  }
  const feeds = {
    image: new ort.Tensor("float32", pixels, [1, 3, SIZE, SIZE]),
    mask: new ort.Tensor("float32", holes, [1, 1, SIZE, SIZE]),
  };
  const started = Date.now();
  const results = await session.run(feeds);
  const output = results[session.outputNames[0]];
  const data = output.data instanceof Float32Array ? output.data : await output.getData();
  // Outside the mask, the page as it was, to the bit
  const out = new Uint8ClampedArray(plane * 4);
  for (let i = 0; i < plane; i++) {
    if (hole[i]) {
      out[i * 4] = Math.round(data[i] * 255);
      out[i * 4 + 1] = Math.round(data[plane + i] * 255);
      out[i * 4 + 2] = Math.round(data[plane * 2 + i] * 255);
    } else {
      out[i * 4] = rgba[i * 4];
      out[i * 4 + 1] = rgba[i * 4 + 1];
      out[i * 4 + 2] = rgba[i * 4 + 2];
    }
    out[i * 4 + 3] = 255;
  }
  if (output.dispose) output.dispose();
  return { image: out.buffer, device, ms: Date.now() - started };
};

self.onmessage = (event) => {
  const { id, image, mask } = event.data || {};
  if (!image || !mask) return;
  const job = queue.then(async () => {
    progressOf = (progress) => self.postMessage({ id, progress });
    try {
      const done = await run({ image, mask });
      self.postMessage({ id, image: done.image, device: done.device, ms: done.ms }, [done.image]);
    } catch (error) {
      console.warn("SG Typer Studio: LaMa Manga failed", error);
      self.postMessage({ id, error: { kind: (error && error.kind) || "other", message: String((error && error.message) || error) } });
    }
  });
  queue = job.catch(() => {});
};
