// OpenRouter for the sandboxed desktop renderer. Chromium's typer:// origin may be refused by
// API CORS rules, so discovery and generation use Node's fetch in the main process. Only these
// two fixed HTTPS routes are exposed; the page cannot turn this into a general network proxy.

const createOpenRouter = (fetchImpl = fetch) => {
  const jobs = new Map();
  const cancel = (id) => {
    const job = jobs.get(String(id));
    if (!job) return false;
    job.abort();
    return true;
  };
  const request = async (id, given) => {
    const key = String(id);
    if (jobs.has(key)) return { ok: false, kind: "other", message: "This request is already running." };
    const route = given && given.route;
    if (route !== "models" && route !== "images") return { ok: false, kind: "other", message: "Unsupported OpenRouter route." };
    const token = String(given.key || "").trim();
    if (token.length > 4096) return { ok: false, kind: "key", message: "The API key is too long." };
    let body = "";
    if (route === "images") {
      try { body = JSON.stringify(given.body || {}); }
      catch (error) { return { ok: false, kind: "other", message: "The request could not be encoded." }; }
      if (body.length > 64e6) return { ok: false, kind: "other", message: "The image request is too large." };
    }
    const controller = new AbortController();
    jobs.set(key, controller);
    try {
      const headers = { Accept: "application/json", "X-Title": "SG Typer Studio" };
      if (token) headers.Authorization = `Bearer ${token}`;
      if (body) headers["Content-Type"] = "application/json";
      const response = await fetchImpl(`https://openrouter.ai/api/v1/images${route === "models" ? "/models" : ""}`, {
        method: body ? "POST" : "GET", headers, ...(body ? { body } : {}), signal: controller.signal,
      });
      const raw = await response.text();
      if (raw.length > (route === "models" ? 10e6 : 128e6)) return { ok: false, kind: "other", message: "OpenRouter's response is too large." };
      let answer;
      try { answer = JSON.parse(raw); }
      catch (error) { return { ok: false, kind: response.ok ? "noimage" : "other", message: raw.slice(0, 300) || "OpenRouter returned invalid JSON." }; }
      if (!response.ok) {
        const error = answer.error || answer;
        const detail = (typeof error === "string" ? error : error.message || answer.detail || response.statusText) || `HTTP ${response.status}`;
        const kind = response.status === 401 || response.status === 403 ? "key" : response.status === 402 || response.status === 429 ? "quota" : "other";
        return { ok: false, kind, message: String(detail).slice(0, 300), status: response.status, retry: Number(response.headers.get("retry-after")) || 0 };
      }
      return { ok: true, value: answer };
    } catch (error) {
      if (controller.signal.aborted || (error && error.name === "AbortError")) return { ok: false, kind: "cancelled" };
      return { ok: false, kind: "network", message: String((error && error.message) || error).slice(0, 300) };
    } finally {
      jobs.delete(key);
    }
  };
  return { request, cancel };
};

module.exports = { createOpenRouter };
