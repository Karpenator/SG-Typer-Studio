// GitHub release notes arrive from electron-updater as HTML. Render their readable formatting,
// but treat them as remote content: only a small formatting allowlist reaches the dialog DOM.
(function () {
  "use strict";

  const ALLOWED = new Set(["H1", "H2", "H3", "H4", "P", "UL", "OL", "LI", "STRONG", "EM", "B", "I", "CODE", "PRE", "BLOCKQUOTE", "HR", "BR", "A", "DEL"]);
  const DROP = "script, style, iframe, object, embed, svg, math, link, meta, base, form, input, button, textarea, select, option, img, picture, video, audio, source, canvas, template";

  const render = (notes) => {
    const container = document.createElement("div");
    container.className = "update-notes";
    const source = String(notes || "").slice(0, 12000);
    if (!/<[a-z][^>]*>/i.test(source)) {
      container.classList.add("update-notes--plain");
      container.textContent = source;
      return container;
    }

    const template = document.createElement("template");
    template.innerHTML = source;
    template.content.querySelectorAll(DROP).forEach((element) => element.remove());
    template.content.querySelectorAll("*").forEach((element) => {
      if (!ALLOWED.has(element.tagName)) {
        // Keep readable text from harmless unknown wrappers, but never the wrapper itself.
        element.replaceWith(...element.childNodes);
        return;
      }
      const href = element.tagName === "A" ? element.getAttribute("href") || "" : "";
      Array.from(element.attributes).forEach((attribute) => element.removeAttribute(attribute.name));
      if (element.tagName === "A") {
        if (!/^https?:\/\//i.test(href.trim())) {
          element.replaceWith(...element.childNodes);
          return;
        }
        element.setAttribute("href", href.trim());
        element.setAttribute("target", "_blank");
        element.setAttribute("rel", "noopener noreferrer");
      }
    });
    container.appendChild(template.content.cloneNode(true));
    return container;
  };

  window.TypeRUpdateNotes = { render };
})();
