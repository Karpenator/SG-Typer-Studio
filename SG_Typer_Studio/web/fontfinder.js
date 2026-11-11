// Font FindeR, the font library the TypeR panel browses: finds the fonts a document asks
// for and installs them. The matching is the panel's (TypeR's app_src/fontFinderMatch.js):
// the name Photoshop keeps rarely equals the Font FindeR family ("ImaginaryFriendBBW00-Bold"
// is "Imaginary Friend"), so several searches run, from the exact name to a cleaned-up one,
// and every result is scored against the name asked for before it is proposed.
(() => {
  const API = "https://tools.carbonscans.com/fonts/api";
  // The panel's: its Font FindeR shows these fonts as installed
  const INSTALLED_KEY = "typer.fontViewer.installed.v1";

  // Tokens that tag a vendor or a web/licensing build, not the design itself
  const NOISE_TOKENS = new Set(["bb", "std", "pro", "lt", "mt", "ot", "tt", "otf", "ttf", "regular"]);
  const NOISE_PATTERN = /^w\d\d$/;
  // Comicraft prefixes its PostScript names with "CC" (CCWildWords → Wild Words)
  const LEADING_NOISE_TOKENS = new Set(["cc"]);
  const STYLE_SUFFIX = /^(regular|reg|bold|bd|italic|ital|it|oblique|obl|light|lt|medium|med|semi|demi|extra|ultra|black|blk|heavy|thin|book|roman|condensed|cond|narrow|wide|expanded|plain|normal|mt|ps)+$/;

  const MAX_QUERIES = 5;
  const MIN_QUERY_LENGTH = 4;
  // 100 same PostScript name, 95 same name without the style (both install what the page asks
  // for), 90 same cleaned-up family (another build of the font), below 90 an approximate match
  const SAME_FAMILY_SCORE = 90;
  const EXACT_SCORE = 95;
  const MIN_SCORE = 70;

  const compact = (value) => String(value || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/(\.(otf|ttf|ttc|woff2?))+$/i, "")
    .replace(/[^a-z0-9]/g, "");

  // "ImaginaryFriendBBW00-Bold" → "ImaginaryFriendBBW00"
  const stripStyleSuffix = (name) => {
    const value = String(name || "").trim();
    const dash = value.lastIndexOf("-");
    if (dash <= 0) return value;
    return STYLE_SUFFIX.test(compact(value.slice(dash + 1))) ? value.slice(0, dash) : value;
  };

  // "ImaginaryFriendBBW00" → ["Imaginary", "Friend", "BB", "W00"]
  const splitWords = (name) => String(name || "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/([A-Za-z]{2,}?)(W\d\d)\b/g, "$1 $2")
    .split(/[\s_\-.]+/)
    .filter(Boolean);

  const dropNoise = (words) => {
    const kept = words.filter((word) => {
      const lower = word.toLowerCase();
      return !NOISE_TOKENS.has(lower) && !NOISE_PATTERN.test(lower);
    });
    if (kept.length > 1 && LEADING_NOISE_TOKENS.has(kept[0].toLowerCase())) kept.shift();
    // Trailing style words left by a family name ("Wild Words Bold")
    while (kept.length > 1 && STYLE_SUFFIX.test(compact(kept[kept.length - 1]))) kept.pop();
    return kept;
  };

  const coreName = (name) => compact(dropNoise(splitWords(stripStyleSuffix(name))).join(""));

  const describeTarget = (target) => {
    const postScriptName = String(target.postScriptName || "").trim();
    const fontName = String(target.fontName || "").trim();
    const base = stripStyleSuffix(postScriptName || fontName);
    return {
      postScriptName: compact(postScriptName),
      base: compact(base),
      cores: Array.from(new Set([base, fontName].map(coreName).filter(Boolean))),
    };
  };

  // The searches to run, most precise first
  const queriesFor = (target) => {
    const postScriptName = String(target.postScriptName || "").trim();
    const fontName = String(target.fontName || "").trim();
    const queries = [];
    const seen = new Set();
    const add = (query) => {
      const value = String(query || "").trim();
      const key = compact(value);
      if (key.length < MIN_QUERY_LENGTH || seen.has(key) || queries.length >= MAX_QUERIES) return;
      seen.add(key);
      queries.push(value);
    };
    const base = stripStyleSuffix(postScriptName || fontName);
    add(base);
    add(stripStyleSuffix(fontName));
    const coreWords = [base, fontName].map((name) => dropNoise(splitWords(stripStyleSuffix(name))));
    coreWords.forEach((words) => add(words.join(" ")));
    // Then shorter and shorter starts ("Fight to the Finish Fixed" → "Fight to the Finish"):
    // the scoring rejects what only shares a word
    coreWords.forEach((words) => {
      for (let count = words.length - 1; count >= 1; count--) add(words.slice(0, count).join(" "));
    });
    return queries;
  };

  // Sørensen–Dice coefficient over letter pairs, 0..1
  const similarity = (a, b) => {
    if (!a || !b) return 0;
    if (a === b) return 1;
    if (a.length < 2 || b.length < 2) return 0;
    const pairs = new Map();
    for (let i = 0; i < a.length - 1; i++) {
      const pair = a.slice(i, i + 2);
      pairs.set(pair, (pairs.get(pair) || 0) + 1);
    }
    let common = 0;
    for (let i = 0; i < b.length - 1; i++) {
      const pair = b.slice(i, i + 2);
      const count = pairs.get(pair) || 0;
      if (count > 0) {
        pairs.set(pair, count - 1);
        common++;
      }
    }
    return (2 * common) / (a.length + b.length - 2);
  };

  const approximateScore = (core, candidate) => {
    if (!core || !candidate) return 0;
    const shorter = core.length <= candidate.length ? core : candidate;
    const longer = shorter === core ? candidate : core;
    const ratio = shorter.length / longer.length;
    let score = 0;
    // A shared start weighs more: "Collect Em All" for "Collect Em All Fixed"
    if (longer.indexOf(shorter) === 0 && ratio >= 0.65) score = 80;
    else if (longer.indexOf(shorter) !== -1 && ratio >= 0.75) score = 80;
    const dice = similarity(core, candidate);
    if (dice >= 0.85) score = Math.max(score, Math.round(dice * 85));
    return score;
  };

  const scoreFamily = (described, family) => {
    const fonts = family.fonts || [];
    const familyCore = coreName(family.family);
    let best = 0;
    const consider = (score) => { if (score > best) best = score; };
    fonts.forEach((font) => {
      if (described.postScriptName && compact(font.name) === described.postScriptName) consider(100);
      if (described.base && compact(stripStyleSuffix(font.name)) === described.base) consider(95);
      const fontCore = coreName(font.name);
      described.cores.forEach((core) => consider(core === fontCore ? SAME_FAMILY_SCORE : approximateScore(core, fontCore)));
    });
    described.cores.forEach((core) => consider(core === familyCore ? SAME_FAMILY_SCORE : approximateScore(core, familyCore)));
    return best;
  };

  const pickBest = (target, families) => {
    const described = describeTarget(target);
    let best = null;
    (families || []).forEach((family) => {
      if (!family || !family.fonts || !family.fonts.length) return;
      const score = scoreFamily(described, family);
      if (score < MIN_SCORE) return;
      // Ties go to the shorter family name: "Victory Speech" over "Victory Speech Lower"
      if (!best || score > best.score || (score === best.score && String(family.family).length < String(best.family.family).length)) {
        best = { family, score, exact: score >= EXACT_SCORE };
      }
    });
    return best;
  };

  /* ------------------------------- the service ------------------------------- */

  const getJson = async (url, timeout = 20000) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetch(url, { headers: { Accept: "application/json" }, signal: controller.signal });
      if (!response.ok) throw new Error(`Font FindeR: ${response.status}`);
      const data = await response.json();
      if (!data || data.success === false) throw new Error("Font FindeR: invalid response");
      return data;
    } finally {
      clearTimeout(timer);
    }
  };

  let status = null;
  // Resolves to true when Font FindeR answers and is open
  const available = () => {
    if (!status) {
      status = getJson(`${API}/status`, 8000).then((data) => data.enabled === true, () => false);
      // Asked again next time when it didn't answer
      status.then((open) => { if (!open) setTimeout(() => { status = null; }, 60000); });
    }
    return status;
  };

  const searches = new Map();
  const search = (q, perPage = 20) => {
    const url = `${API}/fonts?page=1&per_page=${perPage}&q=${encodeURIComponent(String(q).trim())}`;
    if (!searches.has(url)) {
      const asked = getJson(url).then((data) => data.families || []);
      searches.set(url, asked);
      asked.catch(() => searches.delete(url));
    }
    return searches.get(url);
  };

  // The family to install for a font, or null when Font FindeR has nothing close enough. The
  // first exact match wins; otherwise the best of the first search that found one, after one
  // more search, which may still find the exact build.
  const matches = new Map();
  const find = (target) => {
    const key = `${compact(target.postScriptName)}|${compact(target.fontName)}`;
    if (!matches.has(key)) {
      const found = (async () => {
        const queries = queriesFor(target);
        let best = null;
        let bestQuery = -1;
        for (let i = 0; i < queries.length && (bestQuery < 0 || i <= bestQuery + 1); i++) {
          const match = pickBest(target, await search(queries[i]));
          if (match && match.exact) return match;
          if (match && (!best || match.score > best.score)) {
            if (!best) bestQuery = i;
            best = match;
          }
        }
        return best;
      })();
      matches.set(key, found);
      found.catch(() => matches.delete(key));
    }
    return matches.get(key);
  };

  const installedIds = () => {
    try {
      const ids = JSON.parse(localStorage.getItem(INSTALLED_KEY) || "[]");
      return new Set(Array.isArray(ids) ? ids.map(String) : []);
    } catch (error) {
      return new Set();
    }
  };
  const rememberInstalled = (ids) => {
    try {
      localStorage.setItem(INSTALLED_KEY, JSON.stringify(Array.from(new Set([...installedIds(), ...ids.map(String)]))));
    } catch (error) {
      // Only the panel's "installed" badges depend on it
    }
  };

  const safeName = (name, fallback) => String(name || fallback).replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").trim() || fallback;

  // Downloads every font of the family and adds them like loaded font files; the desktop app
  // also installs them on the computer, as the panel's Font FindeR does. Resolves to the fonts
  // added (TypeRFonts entries).
  const install = async (family) => {
    const used = new Set();
    const files = [];
    const queue = (family.fonts || []).slice();
    const download = async () => {
      while (queue.length) {
        const font = queue.shift();
        const response = await fetch(`${API}/fonts/${Number(font.id)}/file?original=1`, { headers: { Accept: "application/octet-stream" } });
        if (!response.ok) throw new Error(`Font FindeR: ${response.status}`);
        let name = safeName(font.file_name, `${font.name || font.id}.otf`);
        const dot = name.lastIndexOf(".");
        for (let n = 2; used.has(name.toLowerCase()); n++) name = `${dot > 0 ? name.slice(0, dot) : name}-${n}${dot > 0 ? name.slice(dot) : ""}`;
        used.add(name.toLowerCase());
        files.push({ id: font.id, name, displayName: font.name || family.family, bytes: new Uint8Array(await response.arrayBuffer()) });
      }
    };
    await Promise.all([download(), download(), download()]);
    const { added } = await window.TypeRFonts.addFiles(files.map((file) => ({ name: file.name, buffer: file.bytes.slice().buffer })));
    if (!added.length) throw new Error("Font FindeR: no font could be read");
    const desktop = window.TypeRDesktop;
    if (desktop && desktop.installFonts) {
      // The fonts are already usable here: the computer's copy is for the other apps
      await desktop.installFonts(files.map(({ name, displayName, bytes }) => ({ name, displayName, bytes }))).catch(() => null);
    }
    rememberInstalled(files.map((file) => file.id));
    return added;
  };

  // The installed face to use for a missing font: the same style when the family has it
  // ("LEMONMILK-Bold" → Bold), otherwise its regular face
  const faceFor = (name, faces) => {
    const dash = String(name).lastIndexOf("-");
    const style = dash > 0 ? compact(name.slice(dash + 1)) : "";
    const exact = faces.find((face) => compact(face.postScriptName) === compact(name));
    if (exact) return exact;
    const sameStyle = style && faces.find((face) => compact(face.style) === style || compact(face.postScriptName).endsWith(style));
    return sameStyle
      || faces.find((face) => /^(regular|normal|roman|book)$/i.test(face.style))
      || faces.find((face) => !face.italic && !/bold|italic|oblique/i.test(face.style))
      || faces[0];
  };

  // What a search box starts with: "CCWildWords-Bold" → "Wild Words"
  const searchText = (name) => dropNoise(splitWords(stripStyleSuffix(name))).join(" ") || String(name);

  window.TypeRFontFinder = { available, search, find, install, faceFor, searchText, queriesFor, pickBest };
})();
