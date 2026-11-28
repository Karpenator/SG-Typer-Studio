/* Photoshop's global Txt2 EngineData resource. EngineData's AutoKerning is only a boolean;
 * the exact Metrics / Optical / 0 mode lives here, in style key /11. This codec preserves
 * unknown dictionaries and objects, and touches only the text models and their style runs. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.TypeRTxt2 = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const WS = new Set([0, 9, 10, 12, 13, 32]);
  const DELIM = new Set([40, 41, 47, 60, 62, 91, 93, 37]);
  const isDigit = (b) => b >= 48 && b <= 57;

  function bytesFromBase64(value) {
    if (!value) return null;
    if (value instanceof Uint8Array) return value;
    if (typeof Buffer !== "undefined") return new Uint8Array(Buffer.from(value, "base64"));
    const binary = atob(value);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  }

  function base64FromBytes(bytes) {
    if (typeof Buffer !== "undefined") return Buffer.from(bytes).toString("base64");
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(binary);
  }

  function decodeString(raw) {
    if (raw.length >= 2 && raw[0] === 0xfe && raw[1] === 0xff) {
      let out = "";
      for (let i = 2; i + 1 < raw.length; i += 2) out += String.fromCharCode((raw[i] << 8) | raw[i + 1]);
      return out;
    }
    // EngineData also permits one-byte strings. Latin-1 preserves every byte losslessly enough
    // for the ASCII keys and the legacy files that use this form.
    let out = "";
    for (const b of raw) out += String.fromCharCode(b);
    return out;
  }

  function parse(data) {
    const bytes = bytesFromBase64(data);
    if (!bytes || !bytes.length) return null;
    let at = 0;
    const skip = () => {
      for (;;) {
        while (at < bytes.length && WS.has(bytes[at])) at++;
        if (bytes[at] === 37) while (at < bytes.length && bytes[at] !== 10 && bytes[at] !== 13) at++;
        else break;
      }
    };
    const name = () => {
      at++; // slash
      const start = at;
      while (at < bytes.length && !WS.has(bytes[at]) && !DELIM.has(bytes[at])) at++;
      let out = "";
      for (let i = start; i < at; i++) out += String.fromCharCode(bytes[i]);
      return out;
    };
    const string = () => {
      at++; // (
      const raw = [];
      let depth = 1;
      while (at < bytes.length && depth) {
        let b = bytes[at++];
        if (b === 92) {
          const escaped = bytes[at++];
          const simple = { 110: 10, 114: 13, 116: 9, 98: 8, 102: 12 };
          if (simple[escaped] !== undefined) raw.push(simple[escaped]);
          else if (escaped >= 48 && escaped <= 55) {
            let value = escaped - 48;
            for (let n = 0; n < 2 && bytes[at] >= 48 && bytes[at] <= 55; n++) value = value * 8 + bytes[at++] - 48;
            raw.push(value & 255);
          } else if (escaped === 13) { if (bytes[at] === 10) at++; }
          else if (escaped !== 10) raw.push(escaped);
        } else if (b === 40) { depth++; raw.push(b); }
        else if (b === 41) { depth--; if (depth) raw.push(b); }
        else raw.push(b);
      }
      return { type: "string", value: decodeString(raw) };
    };
    const value = () => {
      skip();
      if (at >= bytes.length) throw new Error("Unexpected end of Txt2");
      if (bytes[at] === 47) return { type: "name", value: name() };
      if (bytes[at] === 40) return string();
      if (bytes[at] === 91) {
        at++;
        const out = [];
        for (;;) { skip(); if (bytes[at] === 93) { at++; return out; } out.push(value()); }
      }
      if (bytes[at] === 60 && bytes[at + 1] !== 60) {
        at++;
        let hex = "";
        while (at < bytes.length && bytes[at] !== 62) {
          const b = bytes[at++];
          if (!WS.has(b)) hex += String.fromCharCode(b);
        }
        at++;
        if (!/^(?:[0-9a-fA-F]{2})*$/.test(hex)) throw new Error("Invalid Txt2 hex string");
        const raw = [];
        for (let i = 0; i < hex.length; i += 2) raw.push(parseInt(hex.slice(i, i + 2), 16));
        return { type: "string", value: decodeString(raw) };
      }
      if (bytes[at] === 60 && bytes[at + 1] === 60) {
        at += 2;
        const out = {};
        for (;;) {
          skip();
          if (bytes[at] === 62 && bytes[at + 1] === 62) { at += 2; return out; }
          if (bytes[at] !== 47) throw new Error("Expected a Txt2 dictionary key");
          const key = name();
          out[key] = value();
        }
      }
      const start = at;
      while (at < bytes.length && !WS.has(bytes[at]) && !DELIM.has(bytes[at])) at++;
      const token = bytes.slice(start, at).reduce((s, b) => s + String.fromCharCode(b), "");
      if (token === "true") return true;
      if (token === "false") return false;
      if (token === "null") return null;
      const number = Number(token);
      if (token && Number.isFinite(number)) return number;
      throw new Error("Unsupported Txt2 token: " + token);
    };
    // A Txt2 payload is a bare dictionary, without the enclosing << >>.
    const root = {};
    for (;;) {
      skip();
      if (at >= bytes.length) break;
      if (bytes[at] !== 47) throw new Error("Expected a bare Txt2 key");
      const key = name();
      root[key] = value();
    }
    return root;
  }

  function encodeString(text) {
    const raw = [0xfe, 0xff];
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      raw.push(code >> 8, code & 255);
    }
    let out = "(";
    for (const b of raw) {
      if (b === 40 || b === 41 || b === 92) out += "\\" + String.fromCharCode(b);
      else if (b === 10) out += "\\n";
      else if (b === 13) out += "\\r";
      else if (b < 32 || b > 126) out += "\\" + b.toString(8).padStart(3, "0");
      else out += String.fromCharCode(b);
    }
    return out + ")";
  }

  function serialize(root) {
    const chunks = [];
    const write = (value) => {
      if (Array.isArray(value)) {
        chunks.push("[");
        value.forEach((entry) => { write(entry); chunks.push(" "); });
        chunks.push("]");
      } else if (value && value.type === "string") chunks.push(encodeString(value.value));
      else if (value && value.type === "name") chunks.push("/" + value.value);
      else if (value && typeof value === "object") {
        chunks.push("<< ");
        Object.keys(value).forEach((key) => { chunks.push("/" + key + " "); write(value[key]); chunks.push(" "); });
        chunks.push(">>");
      } else if (typeof value === "number") chunks.push(Number.isInteger(value) ? String(value) : value.toFixed(6).replace(/0+$/, "").replace(/\.$/, ""));
      else if (typeof value === "boolean") chunks.push(value ? "true" : "false");
      else chunks.push("null");
    };
    Object.keys(root || {}).forEach((key) => { chunks.push("/" + key + " "); write(root[key]); chunks.push("\n"); });
    return new TextEncoder().encode(chunks.join(""));
  }

  const modelOf = (root, index) => {
    const objects = root && root["1"] && root["1"]["1"];
    const object = Array.isArray(objects) && objects[index];
    const model = object && object["0"];
    const text = model && model["0"];
    return text && text.type === "string" ? model : null;
  };
  const sameText = (model, text) => model && model["0"].value.replace(/\r$/, "").replace(/\r/g, "\n") === String(text || "").replace(/\r\n?/g, "\n");
  const modeName = (mode) => mode === 0 ? "manual" : mode === 2 ? "opticalKern" : "metricsKern";

  function apply(text, data, params) {
    let root;
    try { root = parse(data); } catch (_) { return params; }
    const index = text && text.index;
    const model = Number.isInteger(index) && modelOf(root, index);
    if (!sameText(model, text && text.text)) return params;
    const runs = model["6"] && model["6"]["0"];
    if (!Array.isArray(runs)) return params;
    const modes = [];
    runs.forEach((run) => {
      const length = Number(run["1"]) || 0;
      const style = run["0"] && run["0"]["0"] && run["0"]["0"]["6"];
      const mode = style && style["11"];
      for (let i = 0; i < length; i++) modes.push(Number.isInteger(mode) ? mode : 1);
    });
    const lt = params.layerText;
    const value = lt.textKey || "";
    if (!modes.length || !lt.textStyleRange) return params;
    if (!value.length && lt.textStyleRange[0]) {
      lt.textStyleRange[0].textStyle.autoKern = modeName(modes[0]);
      return params;
    }
    const styles = [];
    for (let i = 0; i < value.length; i++) {
      const range = lt.textStyleRange.find((entry) => i >= entry.from && i < entry.to) || lt.textStyleRange[lt.textStyleRange.length - 1];
      const style = Object.assign({}, range.textStyle, { autoKern: modeName(modes[i] === undefined ? 1 : modes[i]) });
      const previous = styles[i - 1];
      styles.push(previous && JSON.stringify(previous) === JSON.stringify(style) ? previous : style);
    }
    const ranges = [];
    styles.forEach((style, i) => {
      const last = ranges[ranges.length - 1];
      if (last && last.textStyle === style) last.to = i + 1;
      else ranges.push({ from: i, to: i + 1, textStyle: style });
    });
    if (ranges.length) lt.textStyleRange = ranges;
    return params;
  }

  const clone = (value) => {
    if (Array.isArray(value)) return value.map(clone);
    if (value && typeof value === "object") {
      const out = {};
      Object.keys(value).forEach((key) => { out[key] = clone(value[key]); });
      return out;
    }
    return value;
  };
  const string = (value) => ({ type: "string", value });
  const styleMode = (style) => style && (style.kerningMode === "opticalKern" || style.autoKern === "opticalKern") ? 2 : style && (style.kerningMode === "manual" || style.autoKern === "manual" || style.autoKerning === false) ? 0 : 1;

  function modeRuns(text) {
    const value = String(text.text || "") + "\r";
    const runs = text.styleRuns && text.styleRuns.length ? text.styleRuns : [{ style: text.style || {}, length: value.length }];
    const out = [];
    let at = 0;
    runs.forEach((run) => {
      const length = Math.max(0, Math.min(value.length - at, Number(run.length) || 0));
      const mode = styleMode(run.style);
      const last = out[out.length - 1];
      if (last && last.mode === mode) last.length += length;
      else if (length) out.push({ mode, length });
      at += length;
    });
    if (at < value.length) {
      // Photoshop's trailing paragraph mark takes the last character run's mode.
      const mode = runs.length ? styleMode(runs[runs.length - 1].style) : styleMode(text.style);
      const last = out[out.length - 1];
      if (last && last.mode === mode) last.length += value.length - at;
      else out.push({ mode, length: value.length - at });
    }
    return out;
  }

  function freshRun(mode, length, base) {
    const run = base ? clone(base) : { "0": { "0": { "0": string(""), "6": { "0": 0, "53": { "99": { type: "name", value: "SimplePaint" }, "0": {} } } } } };
    run["1"] = length;
    let holder = run["0"] && run["0"]["0"];
    if (!holder) holder = run["0"] = { "0": {} };
    if (!holder["0"]) holder["0"] = string("");
    if (!holder["6"]) holder["6"] = {};
    holder["6"]["11"] = mode;
    return run;
  }

  // Photoshop's own style sheet has 96 keys; the run written for a text with no sheet of its own
  // must be shaped like it, not like a stub: a text object built on a bare `<< /0 0 /11 mode >>`
  // made Photoshop refuse the file, and a style sheet short of Photoshop's keys came back with
  // the text set in its defaults. The numbers here are Photoshop 2026's own Normal RGB sheet,
  // key for key (see photocraft's `psd/build.rs`, which was read off files it saved).
  const FULL_SHEET = {
    "0": 1, "1": 12, "2": false, "3": false, "4": true, "5": 0, "6": 1, "7": 1, "8": 0,
    "9": 0, "10": 0, "11": 1, "12": 0, "13": 0, "14": 0, "15": 0, "16": 0, "17": 0, "18": true,
    "19": false, "20": false, "21": false, "22": false, "23": false, "24": false, "25": false,
    "26": false, "27": false, "28": false, "29": false, "30": 0, "31": false, "32": false,
    "33": false, "34": false, "35": 2, "36": 0, "37": 2, "38": 0, "39": 0, "40": false, "41": 2,
    "42": 0, "43": { "0": 0.5 }, "44": 2, "45": 2, "46": 7, "47": 0, "48": 0, "49": -1, "50": -1,
    "51": 0, "52": false,
    "53": { "99": { type: "name", value: "SimplePaint" }, "0": { "0": 1, "1": [1, 0, 0, 0] } },
    "54": { "99": { type: "name", value: "SimplePaint" }, "0": { "0": 1, "1": [1, 0, 0, 0] } },
    "55": { "99": { type: "name", value: "SimpleBlender" } },
    "56": true, "57": false, "58": true, "59": false, "60": false, "61": 0, "62": 0, "63": 1,
    "64": 4, "65": 0, "66": [], "67": [], "68": 0, "69": 0, "70": 0, "71": 4, "72": 0, "73": 0,
    "74": false, "75": false, "76": false, "77": true, "78": true,
    "79": { "99": { type: "name", value: "SimplePaint" }, "0": { "0": 1, "1": [1, 1, 1, 0] } },
    "80": false, "81": 0, "82": 3, "83": 3, "84": false, "85": 0,
    "86": { "99": { type: "name", value: "SimpleCustomFeature" } },
    "87": 100, "88": true, "91": 8, "92": 0, "95": { "0": 0, "1": 0 }, "96": true,
  };
  // A frame a point text is drawn in, as Photoshop 2026 writes it since the block's version 14:
  // `<< /0 << /2 << /6 [ -1.0 -1.0 ] /11 << /4 -1 /18 -1.0 /22 .025 >> >> >> >>`. A stub frame
  // (`<< /0 << >> >>`) was what made Photoshop and Photopea refuse a file whose text object named it.
  const pointFrame = () => ({ "0": { "2": { "6": [-1, -1], "11": { "4": -1, "18": -1, "22": 0.025 } } } });
  // A box text's frame: its rectangle as four straight sides from the top left, clockwise.
  const boxFrame = (box) => {
    const [left, top, right, bottom] = (box || [0, 0, 0, 0]).map((value) => (Number.isFinite(value) ? value : 0));
    const corners = [[left, top], [right, top], [right, bottom], [left, bottom], [left, top]];
    const path = [];
    for (let k = 0; k < 4; k++) path.push(...corners[k], ...corners[k], ...corners[k + 1], ...corners[k + 1]);
    return { "0": { "1": { "0": path }, "2": { "0": 1, "6": [-2, -2], "10": { "0": 2, "1": 0 }, "11": { "4": -2, "18": -2, "22": 0.025 } } } };
  };
  // A model with no style runs of its own: Photoshop's own sheet, its kerning at `mode`
  const fullRun = (mode, length) => {
    const sheet = clone(FULL_SHEET);
    sheet["11"] = mode;
    return { "0": { "0": { "0": string(""), "6": sheet } }, "1": length };
  };

  function build(previous, nodes) {
    let root = null;
    try { root = parse(previous); } catch (_) { root = null; }
    const native = !root;
    if (!root) root = { "98": { "0": 14 }, "0": { "8": { "0": [] }, "1": { "0": [] } } };
    if (!root["1"]) root["1"] = {};
    if (!Array.isArray(root["1"]["1"])) root["1"]["1"] = [];
    const slots = root["1"]["1"];
    const texts = [];
    const visit = (list) => (list || []).forEach((node) => {
      if (node.children) visit(node.children);
      else if (node.text) texts.push(node);
    });
    visit(nodes);
    const used = new Set(texts.map((node) => node.text.index).filter(Number.isInteger));
    let next = Math.max(slots.length, 0);
    const assigned = new Set();
    texts.forEach((node) => {
      const text = node.text;
      if (assigned.has(text.index)) text.index = undefined;
      if (!Number.isInteger(text.index)) {
        while (used.has(next)) next++;
        text.index = next++;
        used.add(text.index);
      }
      const index = text.index;
      assigned.add(index);
      const engineText = String(text.text || "").replace(/\r\n?|\n/g, "\r") + "\r";
      let object = slots[index] ? clone(slots[index]) : null;
      let model = object && object["0"];
      // A model is only usable when it is shaped as Photoshop writes one: a text, paragraph runs
      // and a style run container. A stub (a bare `<< /0 text /6 runs >>`) made Photoshop quit on
      // the file, so it is built afresh instead of extended.
      if (!model || typeof model !== "object" || !model["0"] || !model["0"].type || !model["5"] || !model["5"]["0"] || !model["6"]) {
        const paragraphs = [];
        engineText.split(/(?<=\r)/).filter(Boolean).forEach((part) => paragraphs.push({ "0": {}, "1": part.length }));
        model = { "0": string(engineText), "5": { "0": paragraphs }, "6": { "0": [] } };
        object = null;
      }
      if (!object) object = { "0": model, "1": { "0": [{ "0": index }] } };
      const oldRuns = model["6"] && model["6"]["0"];
      const modes = modeRuns(text);
      const rebuilt = [];
      let oldIndex = 0;
      let oldOffset = 0;
      modes.forEach(({ mode, length }) => {
        let left = length;
        while (left > 0) {
          const base = Array.isArray(oldRuns) && oldRuns[oldIndex];
          const baseLength = base ? Number(base["1"]) || 0 : 0;
          if (base && oldOffset >= baseLength) { oldIndex++; oldOffset = 0; continue; }
          const take = base ? Math.min(left, baseLength - oldOffset) : left;
          // A stub run (no style sheet of its own) gets Photoshop's full sheet; one the file wrote
          // keeps every key it had, only its kerning replaced.
          rebuilt.push(base ? freshRun(mode, take, base) : fullRun(mode, take));
          left -= take;
          if (base) oldOffset += take;
        }
      });
      model["0"] = string(engineText);
      model["6"] = model["6"] || {};
      model["6"]["0"] = rebuilt;
      object["0"] = model;
      slots[index] = object;
    });
    if (!texts.length) return previous;
    if (!previous && !texts.some((node) => modeRuns(node.text).some((run) => run.mode === 2))) return previous;
    if (native && root["0"] && root["0"]["8"] && Array.isArray(root["0"]["8"]["0"])) {
      // Every text object names a frame, and Photoshop indexes them by object number: a frame
      // that is a stub made it refuse the file. The ones written here are point frames, and the
      // box of a text it is a box for.
      const boxes = new Map(texts.map((node) => [node.text.index, node.text]));
      const frames = root["0"]["8"]["0"];
      while (frames.length < slots.length) frames.push(pointFrame());
      frames.forEach((frame, at) => {
        if (frame && frame["0"] && Object.keys(frame["0"]).length) return;
        const text = boxes.get(at);
        frames[at] = text && text.shapeType === "box" && text.boxBounds ? boxFrame(text.boxBounds) : pointFrame();
      });
    }
    return base64FromBytes(serialize(root));
  }

  return { parse, serialize, apply, build, bytesFromBase64, base64FromBytes, _modeRuns: modeRuns };
});
