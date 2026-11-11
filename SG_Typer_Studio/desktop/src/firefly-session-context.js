// Read Adobe's own, already initialized session. No token generation, setter or
// challenge manipulation. The internal module is optional and may change with
// Adobe's builds; IMS login continues to work when it is unavailable.
const readGenerationContext = async () => {
  if (location.origin !== "https://firefly.adobe.com") return {};
  let arpToken = null;
  let userId = null;
  try {
    let loader = globalThis.__webpack_require__;
    if (typeof loader !== "function" && Array.isArray(globalThis.webpackChunk)) {
      // Rspack does not expose its loader on every build. An empty runtime
      // callback reads it without replacing Adobe modules or loading a script.
      const entry = [[`typer-session-${crypto.randomUUID()}`], {}, runtime => { loader = runtime; }];
      globalThis.webpackChunk.push(entry);
      const index = globalThis.webpackChunk.indexOf(entry);
      if (index >= 0) globalThis.webpackChunk.splice(index, 1);
    }
    // Module 574827 in bundle.9cc6edc3b1340774.min.js owns the current ARP
    // observable. Its callback fires synchronously and returns an unsubscribe.
    const store = typeof loader === "function" ? loader(574827)?.C?.() : null;
    if (typeof store?.arpSessionToken === "function") {
      const release = store.arpSessionToken(value => { arpToken = value; });
      if (typeof release === "function") release();
    }
  } catch { /* Adobe may have changed the module. Never invent a session token. */ }
  let timer;
  try {
    const profile = await Promise.race([
      window.adobeIMS?.getProfile?.(),
      new Promise(resolve => { timer = setTimeout(() => resolve(null), 3000); }),
    ]);
    userId = profile?.userId;
  } catch { /* Profile retrieval must not invalidate an otherwise valid login. */ }
  finally { clearTimeout(timer); }
  const valid = (value, max) => typeof value === "string" && value.length > 0 && value.length <= max && !/[\r\n]/.test(value);
  return {
    ...(valid(arpToken, 32768) ? { arpToken } : {}),
    ...(valid(userId, 512) ? { userId } : {}),
  };
};

module.exports = { READ_GENERATION_CONTEXT: `(${readGenerationContext.toString()})()` };
