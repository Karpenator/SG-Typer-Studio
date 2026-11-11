// Generative Fill on this computer with FLUX (FLUX.2 Klein 4B, FLUX 3 Klein): what a browser can't
// run. stable-diffusion.cpp's server draws the selection again, its weights in RAM or on the
// graphics card, and nothing leaves the computer.
//
// Nothing is here until someone picks one of these models: the engine (30 to 40 MB) and the
// model's files (about 6 GB) are downloaded then, from fixed addresses, and checked against their
// SHA-256. The page only names a model: it can't choose what is downloaded nor what is run, so an
// embedded renderer can do no more here than in Chromium. Removing a model frees its files.

const crypto = require("crypto");
const fs = require("fs");
const net = require("net");
const os = require("os");
const path = require("path");
const { spawn, execFile, execFileSync } = require("child_process");
const { Readable } = require("stream");
const { app } = require("electron");

const RELEASE = "https://github.com/leejet/stable-diffusion.cpp/releases/download/master-1056-9234ad8/";
const ENGINES = {
  // Vulkan: NVIDIA, AMD and Intel graphics cards alike, the processor otherwise
  win32: { url: `${RELEASE}sd-master-9234ad8-bin-win-vulkan-x64.zip`, sha256: "8474cadaaa16d3ab30503ac0e7c93a77b62aa531e47fc1c190de58e2099c7a48", size: 29940527, server: "sd-server.exe" },
};
const HF = "https://huggingface.co/";
const FILES = {
  vae: { name: "flux2-vae.safetensors", url: `${HF}unsloth/FLUX.2-VAE/resolve/bda21a63a9d498e7e718221c75f0a7fed443369f/split_files/vae/flux2-vae.safetensors`, sha256: "d64f3a68e1cc4f9f4e29b6e0da38a0204fe9a49f2d4053f0ec1fa1ca02f9c4b5", size: 336213556 },
  klein2: { name: "flux-2-klein-4b-Q5_K_M.gguf", url: `${HF}unsloth/FLUX.2-klein-4B-GGUF/resolve/a09d5bb51ac4000ccd9643d10e9db3ed14200508/flux-2-klein-4b-Q5_K_M.gguf`, sha256: "58c01c75fee2272eadb127f53e26dd05a5a8e7f812e37c36fa44603301f91e54", size: 3073368640 },
  qwen3: { name: "Qwen3-4B-Q4_K_M.gguf", url: `${HF}unsloth/Qwen3-4B-GGUF/resolve/22c9fc8a8c7700b76a1789366280a6a5a1ad1120/Qwen3-4B-Q4_K_M.gguf`, sha256: "f6f851777709861056efcdad3af01da38b31223a3ba26e61a4f8bf3a2195813a", size: 2497281312 },
  klein3: { name: "flux3-image-klein-Q4_K.gguf", url: `${HF}leejet/flux-3-image-klein-GGUF/resolve/1c2ad2f9b9247ccca6506a23bdb033fdb0873321/flux3-image-klein-Q4_K.gguf`, sha256: "19ddbfbed61da4bb16ebf169aaf48e9e5db43aba557be1ee537e9f00f586092e", size: 3514023104 },
  qwen3vl: { name: "Qwen3VL-4B-Instruct-Q4_K_M.gguf", url: `${HF}Qwen/Qwen3-VL-4B-Instruct-GGUF/resolve/1cd86afb9a95c410a6038ab3b40d8b578c892266/Qwen3VL-4B-Instruct-Q4_K_M.gguf`, sha256: "66358cb18bb6b3b1b6675aa412c7a88ef01d228f481184d13668e5201c730a0a", size: 2497281664 },
};
// Each model: its diffusion model, its text encoder, the VAE they share, and its steps (FLUX 3
// Klein is made for 16; 8 erase as well, in half the time)
const MODELS = {
  "flux2-klein-4b": { diffusion: "klein2", llm: "qwen3", vae: "vae", steps: 4 },
  "flux3-klein": { diffusion: "klein3", llm: "qwen3vl", vae: "vae", steps: 8 },
};
// The server keeps its model in memory (about 5 GB) this long after the last fill
const IDLE = 5 * 60 * 1000;
const START_LIMIT = 3 * 60 * 1000;
// The model and the engine take 5 to 6 GB of memory: with less than this, the computer would
// only crawl, or stop (measured on an M4 with 24 GB: three servers left behind froze it)
const MEMORY = 15 * 1024 ** 3;
const enoughMemory = os.totalmem() >= MEMORY;

const engine = ENGINES[process.platform] || null;
const root = () => process.env.TYPER_LOCAL_AI_DIR || path.join(app.getPath("userData"), "local-ai");
const engineDir = () => path.join(root(), "engine");
const filePath = (key) => path.join(root(), "models", FILES[key].name);
// A file is kept once checked: its mark says so, so it isn't hashed again at every start
const markPath = (target) => `${target}.ok`;
const isChecked = (target, size) => {
  try {
    return fs.statSync(target).size === size && fs.existsSync(markPath(target));
  } catch (error) {
    return false;
  }
};
const filesOf = (model) => {
  const one = MODELS[model];
  return one ? [one.diffusion, one.llm, one.vae] : [];
};
const engineReady = () => Boolean(engine) && isChecked(path.join(engineDir(), "engine.zip"), engine.size) && fs.existsSync(path.join(engineDir(), engine.server));
const installed = (model) => engineReady() && filesOf(model).every((key) => isChecked(filePath(key), FILES[key].size));
// What is still to download for a model, in bytes
const missing = (model) => {
  let bytes = engine && !engineReady() ? engine.size : 0;
  filesOf(model).forEach((key) => { if (!isChecked(filePath(key), FILES[key].size)) bytes += FILES[key].size; });
  return bytes;
};
const status = () => ({
  available: Boolean(engine) && enoughMemory,
  memory: enoughMemory,
  models: Object.fromEntries(Object.keys(MODELS).map((model) => [model, { installed: installed(model), download: missing(model), size: filesOf(model).reduce((sum, key) => sum + FILES[key].size, 0) + (engine ? engine.size : 0) }])),
});

class LocalError extends Error {
  constructor(kind, message) {
    super(message || kind);
    this.kind = kind;
  }
}

/* ------------------------------------ downloading ----------------------------------- */

const hashFile = (target, hash) => new Promise((resolve, reject) => {
  const stream = fs.createReadStream(target);
  stream.on("data", (chunk) => hash.update(chunk));
  stream.on("end", resolve);
  stream.on("error", reject);
});

// Downloads one file, going on from where a stopped download left it, and checks it
const download = async ({ url, sha256, size }, target, signal, onBytes) => {
  if (isChecked(target, size)) {
    onBytes(size);
    return;
  }
  await fs.promises.mkdir(path.dirname(target), { recursive: true });
  const part = `${target}.part`;
  const hash = crypto.createHash("sha256");
  // A file already whole (put there by hand, or a mark lost) only needs checking
  let start = 0;
  for (const candidate of [target, part]) {
    try {
      const { size: had } = await fs.promises.stat(candidate);
      if (had > 0 && had <= size) {
        if (candidate === target) await fs.promises.rename(target, part);
        start = had;
        break;
      }
    } catch (error) {}
  }
  if (start) await hashFile(part, hash);
  onBytes(start);
  if (start < size) {
    let response;
    try {
      response = await fetch(url, { signal, headers: start ? { Range: `bytes=${start}-` } : {} });
    } catch (error) {
      if (signal && signal.aborted) throw new LocalError("cancelled");
      throw new LocalError("download", String((error && error.message) || error));
    }
    // A server that ignores the range sends it all again
    if (start && response.status === 200) {
      await fs.promises.rm(part, { force: true });
      return download({ url, sha256, size }, target, signal, onBytes);
    }
    if (!response.ok || !response.body) throw new LocalError("download", `HTTP ${response.status}`);
    const out = fs.createWriteStream(part, { flags: start ? "a" : "w" });
    let loaded = start;
    try {
      for await (const chunk of Readable.fromWeb(response.body)) {
        hash.update(chunk);
        loaded += chunk.length;
        if (loaded > size) throw new LocalError("download", "The file is bigger than expected.");
        if (!out.write(chunk)) await new Promise((resolve) => out.once("drain", resolve));
        onBytes(loaded);
      }
    } catch (error) {
      if (signal && signal.aborted) throw new LocalError("cancelled");
      throw error instanceof LocalError ? error : new LocalError("download", String((error && error.message) || error));
    } finally {
      await new Promise((resolve) => out.end(resolve));
    }
    if (loaded !== size) throw new LocalError("download", "The download stopped before the end.");
  }
  if (hash.digest("hex") !== sha256) {
    await fs.promises.rm(part, { force: true });
    throw new LocalError("download", "The file downloaded isn't the one expected.");
  }
  await fs.promises.rename(part, target);
  await fs.promises.writeFile(markPath(target), sha256);
};

const unzip = (archive, folder) => new Promise((resolve, reject) => {
  // Windows 10 and later include bsdtar.
  const tar = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe");
  execFile(tar, ["-xf", archive, "-C", folder], { windowsHide: true }, (error) => (error ? reject(new LocalError("download", `The engine could not be unpacked: ${error.message}`)) : resolve()));
});

// One install at a time: two models share the engine and the VAE
let installing = Promise.resolve();
const install = (model, signal, onProgress) => {
  const run = installing.then(async () => {
    if (!engine || !enoughMemory) throw new LocalError("unsupported");
    if (!MODELS[model]) throw new LocalError("other", "Unknown model.");
    const parts = [];
    if (!engineReady()) parts.push({ file: engine, target: path.join(engineDir(), "engine.zip"), engine: true });
    filesOf(model).forEach((key) => parts.push({ file: FILES[key], target: filePath(key) }));
    const total = parts.reduce((sum, one) => sum + one.file.size, 0);
    const done = parts.map(() => 0);
    let told = 0;
    const tell = () => {
      const loaded = done.reduce((sum, one) => sum + one, 0);
      if (loaded === total || loaded - told > total / 500) {
        told = loaded;
        onProgress({ phase: "download", loaded, total });
      }
    };
    // Two at a time: as fast as one big download, and a slow file doesn't hold the rest. One
    // failing stops the other, and the install ends only once both have stopped writing.
    const queue = parts.map((one, index) => ({ one, index }));
    const stop = new AbortController();
    const cancelled = () => stop.abort();
    if (signal) {
      if (signal.aborted) stop.abort();
      else signal.addEventListener("abort", cancelled, { once: true });
    }
    const worker = async () => {
      try {
        for (let next = queue.shift(); next; next = queue.shift()) {
          const { one, index } = next;
          await download(one.file, one.target, stop.signal, (bytes) => {
            done[index] = bytes;
            tell();
          });
          if (one.engine) await unzip(one.target, engineDir());
        }
      } catch (error) {
        stop.abort();
        throw error;
      }
    };
    const ends = await Promise.allSettled([worker(), worker()]);
    if (signal) signal.removeEventListener("abort", cancelled);
    const failures = ends.filter((end) => end.status === "rejected").map((end) => end.reason);
    // The worker stopped by the other says "cancelled": the other's reason is the one to tell
    if (failures.length) throw failures.find((error) => !(error instanceof LocalError && error.kind === "cancelled")) || failures[0];
    return status();
  });
  installing = run.catch(() => {});
  return run;
};

// A model's own files go; the VAE and the engine stay while another model needs them. After any
// install under way: its files are being written.
const remove = (model) => {
  const run = installing.then(() => removeNow(model));
  installing = run.catch(() => {});
  return run;
};
const removeNow = async (model) => {
  if (!MODELS[model]) return status();
  if (server && server.model === model) stopServer();
  const kept = new Set(Object.keys(MODELS).filter((other) => other !== model && installed(other)).flatMap(filesOf));
  for (const key of filesOf(model)) {
    if (kept.has(key)) continue;
    for (const one of [filePath(key), markPath(filePath(key)), `${filePath(key)}.part`]) await fs.promises.rm(one, { force: true });
  }
  if (!kept.size) {
    stopServer();
    await fs.promises.rm(engineDir(), { recursive: true, force: true });
  }
  return status();
};

/* -------------------------------------- the server ---------------------------------- */

let server = null;
let idleTimer = 0;
// The server's pid, kept while it runs: a server left by an app that didn't close normally (a
// crash, a forced quit) would hold its 5 GB until the computer restarts
const pidPath = () => path.join(root(), "server.pid");
const isOurServer = (pid) => {
  try {
    return /sd-server\.exe/i.test(execFileSync("tasklist", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"], { encoding: "utf8", windowsHide: true }));
  } catch (error) {
    return false;
  }
};
const killLeftover = () => {
  try {
    const pid = Number(fs.readFileSync(pidPath(), "utf8"));
    if (pid > 0 && isOurServer(pid)) process.kill(pid);
  } catch (error) {}
  fs.rmSync(pidPath(), { force: true });
};
// A watchman, apart from the app: if the app goes without stopping the server, the server goes too
const WATCH = "const [app, server] = process.argv.slice(-2).map(Number); const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (error) { return false; } }; setInterval(() => { if (!alive(server)) process.exit(0); if (!alive(app)) { try { process.kill(server); } catch (error) {} process.exit(0); } }, 2000);";
const watch = (pid) => {
  try {
    const watcher = spawn(process.execPath, ["-e", WATCH, String(process.pid), String(pid)], { env: { ELECTRON_RUN_AS_NODE: "1" }, detached: true, stdio: "ignore", windowsHide: true });
    watcher.on("error", () => {});
    watcher.unref();
  } catch (error) {
    console.warn("Local Generative Fill: no watchman for the engine", error.message);
  }
};
const freePort = () => new Promise((resolve, reject) => {
  const probe = net.createServer();
  probe.unref();
  probe.on("error", reject);
  probe.listen(0, "127.0.0.1", () => {
    const { port } = probe.address();
    probe.close(() => resolve(port));
  });
});
const stopServer = () => {
  clearTimeout(idleTimer);
  if (server && server.proc && server.proc.exitCode === null) server.proc.kill();
  server = null;
  try {
    fs.rmSync(pidPath(), { force: true });
  } catch (error) {}
};
const ask = async (port, route, body, signal) => {
  const response = await fetch(`http://127.0.0.1:${port}${route}`, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal } : { signal });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch (error) {}
  if (!response.ok) throw new LocalError("local", (json && json.error && (json.error.message || json.error)) || text.slice(0, 300) || `HTTP ${response.status}`);
  return json;
};
const startServer = async (model) => {
  if (server && server.model === model && server.proc.exitCode === null) return server.ready;
  stopServer();
  killLeftover();
  const one = MODELS[model];
  const port = await freePort();
  const args = ["--diffusion-model", filePath(one.diffusion), "--llm", filePath(one.llm), "--vae", filePath(one.vae), "--listen-ip", "127.0.0.1", "--listen-port", String(port)];
  const proc = spawn(path.join(engineDir(), engine.server), args, { cwd: engineDir(), windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
  // An engine that can't start at all (missing, blocked by an antivirus) says so at once
  let failed = null;
  proc.on("error", (error) => { failed = error; });
  const lines = [];
  proc.stderr.on("data", (chunk) => {
    lines.push(...String(chunk).split(/[\r\n]+/).filter(Boolean));
    lines.splice(0, Math.max(0, lines.length - 20));
  });
  const current = { model, proc, port, lines };
  server = current;
  if (proc.pid) {
    fs.writeFileSync(pidPath(), String(proc.pid));
    watch(proc.pid);
  }
  current.ready = (async () => {
    const started = Date.now();
    for (;;) {
      if (failed) throw new LocalError("local", `The engine could not start: ${failed.message}`);
      if (proc.exitCode !== null || proc.signalCode) throw new LocalError("local", `The engine stopped: ${lines.slice(-3).join(" / ")}`);
      try {
        await ask(port, "/sdcpp/v1/capabilities");
        return current;
      } catch (error) {
        if (Date.now() - started > START_LIMIT) throw new LocalError("local", "The engine didn't start.");
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
    }
  })();
  current.ready.catch(() => { if (server === current) stopServer(); });
  proc.on("exit", () => { if (server === current) server = null; });
  return current.ready;
};

// One fill at a time: the model takes the whole graphics card
let drawing = Promise.resolve();
const generate = ({ model, image, mask, prompt, width, height }, signal, onProgress) => {
  const run = drawing.then(async () => {
    clearTimeout(idleTimer);
    if (!installed(model)) throw new LocalError("notinstalled");
    if (signal && signal.aborted) throw new LocalError("cancelled");
    onProgress({ phase: "start" });
    const { port } = await startServer(model);
    // Cancelled while the model was loading
    if (signal && signal.aborted) throw new LocalError("cancelled");
    const picture = Buffer.from(image).toString("base64");
    const body = {
      prompt: String(prompt || "").slice(0, 4000),
      width: Math.max(64, Math.round(width / 16) * 16),
      height: Math.max(64, Math.round(height / 16) * 16),
      strength: 1,
      seed: -1,
      init_image: picture,
      mask_image: Buffer.from(mask).toString("base64"),
      ref_images: [picture],
      sample_params: { sample_method: "euler", sample_steps: MODELS[model].steps, guidance: { txt_cfg: 1, img_cfg: 1 } },
      // The cheapest preview: it only says which step the drawing is at
      preview: "proj",
      preview_interval: 1,
      output_format: "png",
    };
    const job = await ask(port, "/sdcpp/v1/img_gen", body);
    const cancel = () => ask(port, `/sdcpp/v1/jobs/${job.id}/cancel`, {}).catch(() => {});
    if (signal) signal.addEventListener("abort", cancel, { once: true });
    if (signal && signal.aborted) cancel();
    try {
      for (;;) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        const now = await ask(port, `/sdcpp/v1/jobs/${job.id}`);
        if (now.preview && now.preview.total_steps) onProgress({ phase: "step", step: now.preview.step, total: now.preview.total_steps });
        if (now.status === "completed") return Buffer.from(now.result.images[0].b64_json, "base64");
        if (now.status === "cancelled") throw new LocalError("cancelled");
        if (now.status === "failed") throw new LocalError("local", (now.error && now.error.message) || "The engine failed.");
      }
    } finally {
      if (signal) signal.removeEventListener("abort", cancel);
    }
  });
  drawing = run.catch(() => {}).then(() => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(stopServer, IDLE);
  });
  return run;
};

app.on("will-quit", stopServer);
// app.exit() skips will-quit: the server goes all the same
process.on("exit", () => {
  if (server && server.proc && server.proc.exitCode === null) server.proc.kill();
});
// Left by the last session, if it ended badly
if (engine) app.whenReady().then(killLeftover).catch(() => {});

module.exports = { status, install, remove, generate, stopServer, LocalError };
