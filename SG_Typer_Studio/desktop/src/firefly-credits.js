const CREDITS_URL = "https://firefly.adobe.io/v1/credits/balance";

// Use Adobe's aggregate quota, including an explicit zero balance. Unknown
// responses must not look like an exhausted account or an unlimited plan.
const parseCredits = (data) => {
  const quota = data?.total?.quota;
  const number = value => typeof value === "number" && Number.isFinite(value) && value >= 0;
  if (!number(quota?.total) || !number(quota?.available)) throw Error("Unknown Adobe credit balance.");
  const until = data.total.availableUntil;
  const date = typeof until === "string" && /^\d{4}-\d{2}-\d{2}(?:T|$)/.test(until) ? Date.parse(until) : NaN;
  return { total: quota.total, remaining: quota.available, resetAt: Number.isFinite(date) ? new Date(date).toISOString() : null };
};

const fetchCredits = async (requestFetch, token, signal) => {
  if (!token || typeof token !== "string" || /[\r\n]/.test(token)) throw Error("Adobe session unavailable.");
  const response = await requestFetch(CREDITS_URL, {
    method: "GET", headers: { Authorization: `Bearer ${token}`, "X-api-key": "clio-playground-web", Accept: "application/json" },
    redirect: "error", cache: "no-store", signal,
  });
  if (!response.ok || !response.body || Number(response.headers.get("content-length")) > 1024 * 1024) throw Error("Adobe credits unavailable.");
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 1024 * 1024) throw Error("Adobe credits unavailable.");
      chunks.push(Buffer.from(value));
    }
  } finally { await reader.cancel().catch(() => {}); }
  return parseCredits(JSON.parse(Buffer.concat(chunks, size).toString("utf8")));
};

module.exports = { fetchCredits, parseCredits };
