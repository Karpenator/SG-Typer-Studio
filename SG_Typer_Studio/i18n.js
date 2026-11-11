// The interface is written in English; other languages come from web/strings/.
// Runs in the head, so the user never sees a language change. A link with ?lang=
// picks a language and keeps it; otherwise the browser's languages decide, in the
// user's order.
(function () {
  const strings = window.TYPER_STRINGS || {};
  const supported = window.TYPER_SUPPORTED || ["en", "fr", "es"];
  const query = new URLSearchParams(window.location.search).get("lang");
  let saved = null;
  try {
    saved = window.localStorage.getItem("typer-lang");
    if (query && supported.includes(query)) window.localStorage.setItem("typer-lang", query);
  } catch (error) {
    saved = null;
  }
  const browser = (navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || "en"]).map((code) => String(code).split("-")[0].toLowerCase());
  const lang = [query, saved].concat(browser).find((code) => code && supported.includes(code)) || "en";
  document.documentElement.lang = lang;

  const table = strings[lang] || {};
  const english = strings.en || {};
  const t = (key, fallback) => (table[key] != null ? table[key] : english[key] != null ? english[key] : fallback);

  const applySources = (root) => {
    root.querySelectorAll("[data-lang-poster]").forEach((video) => {
      video.poster = video.getAttribute("data-lang-poster").replace("{lang}", lang);
    });
    root.querySelectorAll("[data-lang-src]").forEach((media) => {
      const source = media.getAttribute("data-lang-src").replace("{lang}", lang);
      if (media.getAttribute("src") !== source) media.src = source;
    });
  };

  let applied = false;
  const apply = () => {
    if (applied) return;
    applied = true;
    if (lang !== "en") {
      if (table["meta.title"]) document.title = table["meta.title"];
      document.querySelectorAll("[data-i18n]").forEach((el) => {
        const text = table[el.getAttribute("data-i18n")];
        if (text != null) el.textContent = text;
      });
      [["data-i18n-alt", "alt"], ["data-i18n-title", "title"], ["data-i18n-aria", "aria-label"], ["data-i18n-iframe", "title"]].forEach(([attribute, target]) => {
        document.querySelectorAll(`[${attribute}]`).forEach((el) => {
          const text = table[el.getAttribute(attribute)];
          if (text != null) el.setAttribute(target, text);
        });
      });
    }
    applySources(document);
    document.querySelectorAll("[data-lang]").forEach((link) => {
      if (link.getAttribute("data-lang") === lang) link.setAttribute("aria-current", "true");
    });
  };

  window.TYPER_I18N = { lang, t, apply, applySources };
  document.addEventListener("DOMContentLoaded", apply);
})();
