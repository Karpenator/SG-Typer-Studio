// What's new since the last start. Two sources:
// - whats-new.json: static release notes embedded with the application, newest first;
// - whats-new/highlights.json, written by hand: the highlights, each with its demo (a short muted
//   video, played on hover), and the notes of changes that no commit of theirs describes.
// The highlights come first; every note goes under "More details", folded, like a patch note.
// Shown: what is newer than the newest one shown here last time. The very first start shows
// none, the app is new as a whole; Help → What's New brings back the latest ones. "Don't show me
// this again" stops them at start, not in Help.

(function () {
  "use strict";

  const STORE = "typer.web.whatsNew";
  // "Don't show me this again": the notes no longer come at start, Help → What's New still works
  const MUTED = "typer.web.whatsNew.off";
  // Someone who used the app before the notes existed sees those of the last days. Not the
  // beta notice: SG Typer Studio marks it read on its very first start.
  const USED = ["typer.web.settings", "typer.web.layout", "typer.web.activeDocument", "typer.web.swatches", "typer.web.shortcuts", "typer.web.fontbarClosed"];
  const RECENT_DAYS = 7;
  // Help → What's New: the highlights of the last two weeks
  const HIGHLIGHT_DAYS = 14;
  const SHOWN = 40;
  const WAIT = 3000;
  // A highlight without a demo stays this long before the next one comes
  const STILL_MS = 6000;
  const MEDIA = "whats-new/";
  const App = () => window.TypeRApp;
  const T = (text) => (App() ? App().T(text) : text);
  const lang = () => (window.TYPER_I18N && window.TYPER_I18N.lang) || "en";
  const still = () => Boolean(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);

  const SVG = (paths) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
  const ICONS = {
    feat: SVG('<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9Z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8Z"/>'),
    fix: SVG('<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-.6-.6-2.4Z"/>'),
    // The highlights' own
    text: SVG('<path d="M4 7V5h16v2"/><path d="M12 5v14"/><path d="M9 19h6"/><path d="M3 3l18 18" opacity=".55"/>'),
    heal: SVG('<path d="M10.5 20.5 3.5 13.5a4.95 4.95 0 0 1 7-7l7 7a4.95 4.95 0 0 1-7 7Z"/><path d="m8.5 8.5 7 7"/><path d="M12 10h.01M10 12h.01M14 12h.01M12 14h.01"/>'),
    gradient: SVG('<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 15 15 3M3 21 21 3M9 21 21 9"/>'),
    sparkles: SVG('<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9Z"/><path d="M5 3v4M3 5h4M19 17v4M17 19h4"/>'),
    swap: SVG('<path d="M7 4 3 8l4 4"/><path d="M3 8h14"/><path d="m17 20 4-4-4-4"/><path d="M21 16H7"/>'),
    heart: SVG('<path d="M19 14c1.5-1.5 3-3.2 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.8 0-3 .5-4.5 2-1.5-1.5-2.7-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4 3 5.5l7 7Z"/>'),
    play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l11-6.5Z" fill="currentColor"/></svg>',
    chevron: SVG('<path d="m9 6 6 6-6 6"/>'),
  };

  const time = (item) => Date.parse(item.at) || 0;
  const byTime = (a, b) => time(b) - time(a);
  const valid = (note) => note && note.id && note.at && note.text;

  // Asked for as soon as the page loads: by boot, it's here
  const fetchJson = (url, timeout = 0) => {
    const controller = timeout ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeout) : 0;
    return fetch(url, { cache: "no-cache", signal: controller && controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .catch(() => null)
      .finally(() => clearTimeout(timer));
  };
  const loaded = Promise.all([fetchJson("whats-new.json"), fetchJson(`${MEDIA}highlights.json`)]).then(async ([data, extra]) => {
    let commits = data && Array.isArray(data.notes) ? data.notes.filter(valid) : [];
    // The release page follows the repository, while the embedded notes keep it useful offline.
    const latest = data && data.github ? await fetchJson(data.github, 6000) : null;
    const commit = Array.isArray(latest) && latest[0] && latest[0].sha && latest[0].commit ? {
      id: `github-${latest[0].sha}`,
      sha: latest[0].sha,
      url: latest[0].html_url,
      at: latest[0].commit.committer.date,
      kind: /^(fix|bugfix|repair)(\(|:)/i.test(latest[0].commit.message) ? "fix" : "feat",
      text: latest[0].commit.message.trim(),
    } : null;
    if (commit && !commits.some((note) => note.id === commit.id)) commits = [commit].concat(commits);
    const more = extra && Array.isArray(extra.notes) ? extra.notes.filter(valid) : [];
    const highlights = extra && Array.isArray(extra.highlights) ? extra.highlights.filter((item) => item && item.id && item.at && item.title).sort(byTime) : [];
    return { commits, notes: commits.concat(more).sort(byTime), highlights };
  });
  const EMPTY = { commits: [], notes: [], highlights: [] };
  const sources = () => Promise.race([loaded, new Promise((resolve) => setTimeout(() => resolve(EMPTY), WAIT))]);

  const read = (key) => {
    try {
      return window.localStorage.getItem(key);
    } catch (error) {
      return undefined;
    }
  };
  const lastSeen = () => {
    try {
      const value = JSON.parse(read(STORE) || "null");
      return value && value.at ? value : null;
    } catch (error) {
      return null;
    }
  };
  const remember = (id, at) => {
    try {
      window.localStorage.setItem(STORE, JSON.stringify({ id, at }));
    } catch (error) {
      // Private window: the same notes may come again, nothing else
    }
  };
  const muted = () => read(MUTED) === "1";
  const mute = (on) => {
    try {
      if (on) window.localStorage.setItem(MUTED, "1");
      else window.localStorage.removeItem(MUTED);
    } catch (error) {
      // Private window: asked again next time
    }
  };
  // A note's text, or a highlight's field, in the interface's language
  const textOf = (note) => (note.lang && note.lang[lang()]) || note.text;
  const words = (field) => (!field ? "" : typeof field === "string" ? field : field[lang()] || field.en || "");
  const dayOf = (note) => {
    try {
      return new Intl.DateTimeFormat(lang(), { day: "numeric", month: "short" }).format(new Date(time(note)));
    } catch (error) {
      return "";
    }
  };

  const el = (tag, className, parent, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    if (parent) parent.appendChild(node);
    return node;
  };

  /* ------------------------------ the highlights ------------------------------ */

  // A highlight without a demo: its icon, large, on the stage
  const illustration = (item) => {
    const box = el("div", "wn__art");
    const icon = el("span", "wn__art-icon", box);
    icon.innerHTML = ICONS[item.icon] || ICONS.feat;
    el("span", "wn__art-title", box, words(item.title));
    return box;
  };

  // The stage shows the demo of the highlight under the pointer; left alone, it goes through
  // them one after the other. Each demo is loaded when first shown, the next one just before.
  const highlightsBlock = (items, closed) => {
    const block = el("section", "wn__highlights");
    const stage = el("div", "wn__stage", block);
    const rows = el("div", "wn__rows", block);
    rows.setAttribute("role", "list");
    const slides = [];
    let current = -1;
    let hovering = false;
    let timer = 0;
    const calm = still();

    const loadSlide = (index) => {
      const slide = slides[index];
      if (!slide || slide.media) return slide;
      const item = items[index];
      const media = el("div", "wn__media", stage);
      if (item.demo) {
        if (item.poster) {
          const poster = el("img", "wn__poster", media);
          poster.src = MEDIA + item.poster;
          poster.alt = "";
          poster.decoding = "async";
        }
        const video = el("video", "wn__video", media);
        video.muted = true;
        video.defaultMuted = true;
        video.playsInline = true;
        video.setAttribute("playsinline", "");
        video.preload = "auto";
        video.disablePictureInPicture = true;
        video.setAttribute("aria-label", words(item.title));
        video.addEventListener("loadeddata", () => media.classList.add("is-ready"));
        video.addEventListener("error", () => {
          // Offline or missing: the illustration instead
          if (media.querySelector(".wn__art")) return;
          media.textContent = "";
          media.appendChild(illustration(item));
          slide.video = null;
          if (index === current) schedule();
        });
        video.addEventListener("timeupdate", () => {
          if (index === current && video.duration) slide.bar.style.transform = `scaleX(${Math.min(1, video.currentTime / video.duration)})`;
        });
        video.addEventListener("ended", () => {
          if (index !== current) return;
          if (hovering || items.length < 2) {
            video.currentTime = 0;
            video.play().catch(() => {});
          } else show((current + 1) % items.length);
        });
        video.src = MEDIA + item.demo;
        slide.video = video;
      } else media.appendChild(illustration(item));
      slide.media = media;
      return slide;
    };

    const schedule = () => {
      clearTimeout(timer);
      const slide = slides[current];
      if (calm || !slide || slide.video || items.length < 2) return;
      slide.bar.style.transition = "none";
      slide.bar.style.transform = "scaleX(0)";
      // Start the fill on the next frame, so it animates from empty
      requestAnimationFrame(() => {
        slide.bar.style.transition = `transform ${STILL_MS}ms linear`;
        slide.bar.style.transform = "scaleX(1)";
      });
      timer = setTimeout(() => {
        if (!hovering && !closed()) show((current + 1) % items.length);
        else schedule();
      }, STILL_MS);
    };

    const show = (index) => {
      if (closed()) return;
      if (index === current) return;
      const before = slides[current];
      if (before) {
        before.row.classList.remove("is-active");
        before.row.setAttribute("aria-current", "false");
        if (before.media) before.media.classList.remove("is-shown");
        if (before.video) before.video.pause();
        before.bar.style.transition = "none";
        before.bar.style.transform = "scaleX(0)";
      }
      current = index;
      const slide = loadSlide(index);
      slide.row.classList.add("is-active");
      slide.row.setAttribute("aria-current", "true");
      slide.media.classList.add("is-shown");
      stage.classList.toggle("is-paused", calm);
      if (slide.video) {
        slide.bar.style.transition = "transform 0.25s linear";
        slide.video.currentTime = 0;
        if (!calm) slide.video.play().catch(() => stage.classList.add("is-paused"));
      }
      schedule();
      // The next demo loads meanwhile, so it's there when its turn comes
      if (items.length > 1) loadSlide((index + 1) % items.length);
    };

    items.forEach((item, index) => {
      const row = el("button", "wn__row", rows);
      row.type = "button";
      row.setAttribute("role", "listitem");
      const icon = el("span", "wn__row-icon", row);
      icon.innerHTML = ICONS[item.icon] || ICONS.feat;
      const body = el("span", "wn__row-body", row);
      const head = el("span", "wn__row-head", body);
      el("span", "wn__row-title", head, words(item.title));
      if (item.where) el("span", "wn__row-where", head, words(item.where));
      el("span", "wn__row-text", body, words(item.text));
      if (item.credit) {
        const credit = el("span", "wn__row-credit", body);
        credit.innerHTML = ICONS.heart;
        el("span", "", credit, words(item.credit));
      }
      const track = el("span", "wn__row-track", row);
      const bar = el("span", "wn__row-bar", track);
      slides.push({ row, bar, media: null, video: null });
      // Hover or focus brings its demo; a tap too, where there is no hover
      row.addEventListener("pointerenter", (event) => { if (event.pointerType !== "touch") show(index); });
      row.addEventListener("focus", () => show(index));
      row.addEventListener("click", () => {
        show(index);
        const slide = slides[index];
        if (slide.video && slide.video.paused) {
          stage.classList.remove("is-paused");
          slide.video.play().catch(() => {});
        }
      });
    });
    block.addEventListener("pointerenter", () => { hovering = true; });
    block.addEventListener("pointerleave", () => { hovering = false; });
    // Paused (reduced motion, or a refused autoplay): a click on the stage plays it
    const play = el("button", "wn__play", stage);
    play.type = "button";
    play.innerHTML = ICONS.play;
    play.title = T("Play");
    play.setAttribute("aria-label", T("Play"));
    play.addEventListener("click", () => {
      const slide = slides[current];
      if (!slide || !slide.video) return;
      stage.classList.remove("is-paused");
      slide.video.play().catch(() => {});
    });

    show(0);
    const stop = () => {
      clearTimeout(timer);
      slides.forEach((slide) => {
        if (!slide.video) return;
        slide.video.pause();
        slide.video.removeAttribute("src");
        slide.video.load();
      });
    };
    return { block, stop };
  };

  /* ------------------------------ the notes ------------------------------ */

  const notesSections = (shown, parent) => {
    [["feat", "New features"], ["fix", "Bug fixes"]].forEach(([kind, title]) => {
      const items = shown.filter((note) => note.kind === kind);
      if (!items.length) return;
      const section = el("section", `wn__section wn__section--${kind}`, parent);
      const label = el("h3", "wn__label", section);
      label.innerHTML = ICONS[kind];
      el("span", "", label, T(title));
      const ul = el("ul", "wn__list", section);
      items.forEach((note) => {
        const li = el("li", "wn__item", ul);
        el("span", "wn__text", li, textOf(note));
        if (note.url && note.sha) {
          const link = el("a", "wn__commit", li, note.sha.slice(0, 7));
          link.href = note.url; link.target = "_blank"; link.rel = "noopener";
          link.title = T("View commit on GitHub");
        }
        el("time", "wn__date", li, dayOf(note)).dateTime = note.at;
      });
    });
  };

  const present = async ({ notes: all, highlights }, intro) => {
    if (!App() || (!all.length && !highlights.length)) return;
    // A note a highlight already says isn't said twice
    const covered = new Set();
    highlights.forEach((item) => (item.covers || []).forEach((id) => covered.add(id)));
    const list = all.filter((note) => !covered.has(note.id));
    const body = el("div", "wn");
    const hero = el("div", "wn__hero", body);
    const logo = el("img", "wn__logo", hero);
    logo.src = "../assets/brand/sg-logo.png";
    logo.alt = "";
    const heading = el("div", "wn__heading", hero);
    el("h2", "wn__title", heading, T("What's New"));
    el("p", "wn__intro", heading, intro);
    const counts = el("div", "wn__counts", hero);
    [["feat", "New features", highlights.length + list.filter((note) => note.kind === "feat").length], ["fix", "Bug fixes", list.filter((note) => note.kind === "fix").length]].forEach(([kind, title, count]) => {
      if (!count) return;
      const badge = el("span", `wn__count wn__count--${kind}`, counts);
      badge.innerHTML = ICONS[kind];
      el("b", "", badge, String(count));
      badge.title = T(title);
    });
    const scroll = el("div", "wn__scroll", body);
    let open = true;
    let stop = () => {};
    if (highlights.length) {
      const made = highlightsBlock(highlights, () => !open);
      scroll.appendChild(made.block);
      stop = made.stop;
    }
    const shown = list.slice(0, SHOWN);
    if (shown.length) {
      // With highlights, the rest folds away, like a patch note; alone, it's the whole content
      let holder = scroll;
      if (highlights.length) {
        const details = el("details", "wn__details", scroll);
        const summary = el("summary", "wn__summary", details);
        summary.innerHTML = ICONS.chevron;
        el("span", "", summary, T("More details"));
        el("span", "wn__summary-count", summary, String(list.length));
        holder = el("div", "wn__details-body", details);
      }
      notesSections(shown, holder);
      if (list.length > shown.length) el("p", "wn__more", holder, App().fill(T("And {count} more."), { count: list.length - shown.length }));
    }
    const pending = App().dialog({ title: T("What's New"), body, cancel: false, ok: T("Got it") });
    const modal = body.closest("dialog");
    if (modal) {
      modal.classList.add("modal--whatsnew");
      if (highlights.length) modal.classList.add("modal--whatsnew-wide");
      // Beside the button, kept at once: also unticked from Help → What's New
      const foot = modal.querySelector(".modal__foot");
      if (foot) {
        const label = App().checkbox(T("Don't show me this again"), muted(), mute);
        label.className = "wn__mute";
        foot.prepend(label);
      }
    }
    try {
      await pending;
    } finally {
      open = false;
      stop();
    }
  };

  const recent = (list) => (list.length ? list.filter((note) => time(note) > time(list[0]) - RECENT_DAYS * 86400000) : []);
  const recentHighlights = (highlights, newest) => highlights.filter((item) => time(item) > newest - HIGHLIGHT_DAYS * 86400000);
  const newestOf = ({ notes, highlights }) => Math.max(notes.length ? time(notes[0]) : 0, highlights.length ? time(highlights[0]) : 0);

  // Called by app.js's boot, before anything else is said
  const atStart = async () => {
    const data = await sources();
    const { commits, notes, highlights } = data;
    if ((!notes.length && !highlights.length) || read(STORE) === undefined) return;
    const seen = lastSeen();
    const newest = newestOf(data);
    let fresh;
    let freshHighlights;
    if (seen) {
      const since = Date.parse(seen.at);
      // The commits' notes by where the last one seen is: several share a second
      const index = commits.findIndex((note) => note.id === seen.id);
      const ids = new Set(index !== -1 ? commits.slice(0, index).map((note) => note.id) : []);
      // Not in the list: too old for it, or an app gone back to an older version
      fresh = notes.filter((note) => ids.has(note.id) || ((index === -1 || !commits.includes(note)) && time(note) > since));
      freshHighlights = highlights.filter((item) => time(item) > since);
    } else if (USED.some((key) => read(key) != null)) {
      fresh = recent(notes);
      freshHighlights = recentHighlights(highlights, newest);
    } else {
      fresh = [];
      freshHighlights = [];
    }
    // An older version doesn't take back what a newer one already showed
    if (!seen || newest >= Date.parse(seen.at)) remember(commits.length ? commits[0].id : null, new Date(newest).toISOString());
    if ((fresh.length || freshHighlights.length) && !muted()) await present({ notes: fresh, highlights: freshHighlights }, T("Since you last opened SG Typer Studio"));
  };

  const show = async () => {
    const data = await loaded;
    if (!data.notes.length && !data.highlights.length) {
      if (App()) App().toast(T("What's new can't be read right now."), true);
      return;
    }
    await present({ notes: recent(data.notes), highlights: recentHighlights(data.highlights, newestOf(data)) }, T("Lately in SG Typer Studio"));
  };

  window.TypeRWhatsNew = { atStart, show };
})();
