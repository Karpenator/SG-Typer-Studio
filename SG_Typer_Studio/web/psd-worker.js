// Reads and writes PSD files away from the page, so that a chapter being opened or saved
// doesn't freeze it. psd.js does the same work itself when a worker isn't available.

"use strict";

self.importScripts("vendor/ag-psd.js");
const lib = self.agPsd;
lib.initializeCanvas((width, height) => new OffscreenCanvas(width, height), (width, height) => new ImageData(width, height));

// What leaves for the page: pixels are handed over, not copied. A small array read from the
// file is still a view on all of it, so it gets its own copy, or the whole file would follow.
const prepare = (root) => {
  const transfer = new Set();
  const seen = new Set();
  const visit = (holder, key) => {
    const value = holder[key];
    if (!value || typeof value !== "object" || seen.has(value)) return;
    if (ArrayBuffer.isView(value)) {
      const own = value.byteLength === value.buffer.byteLength ? value : value.slice();
      holder[key] = own;
      transfer.add(own.buffer);
      return;
    }
    seen.add(value);
    if (value instanceof ImageData) {
      transfer.add(value.data.buffer);
      return;
    }
    if (value instanceof OffscreenCanvas) {
      delete holder[key];
      return;
    }
    Object.keys(value).forEach((name) => visit(value, name));
  };
  const box = { root };
  visit(box, "root");
  return { result: box.root, transfer: Array.from(transfer) };
};

// A layer's channels are kept where they are in the file: if the layer doesn't change, saving
// takes them back from there, byte for byte, with no memory held until then.
const decodeLayers = (nodes, file) => {
  (nodes || []).forEach((node) => {
    if (node.children) decodeLayers(node.children, file);
    const raw = node.rawData;
    if (!raw) return;
    const channels = raw.channels.map(({ id, compression, data }) => ({ id, compression, start: data ? data.byteOffset : null, end: data ? data.byteOffset + data.byteLength : null, fromFile: !data || data.buffer === file }));
    const slices = channels.every((channel) => channel.fromFile) ? { colorMode: raw.colorMode, bitsPerChannel: raw.bitsPerChannel, large: Boolean(raw.large), channels } : null;
    try {
      lib.decodeLayerPixels(node, true);
      if (slices) node.typerSlices = slices;
    } catch (error) {
      delete node.rawData;
    }
  });
};

const read = ({ buffer }) => {
  const bytes = new Uint8Array(buffer);
  let psd = lib.readPsd(bytes, { useRawData: true, useImageData: true, skipCompositeImageData: true, skipThumbnail: true, logMissingFeatures: false });
  if (psd.children && psd.children.length) {
    decodeLayers(psd.children, buffer);
    delete psd.rawCompositeData;
    delete psd.rawCompositeDataInfo;
  } else psd = lib.readPsd(bytes, { useImageData: true, skipThumbnail: true, logMissingFeatures: false });
  return psd;
};

const write = ({ psd, options, thumbnail }) => {
  if (thumbnail) {
    const { width, height, url } = thumbnail;
    psd.imageResources = Object.assign({}, psd.imageResources, { thumbnail: { width, height, toDataURL: () => url } });
  }
  return lib.writePsdUint8Array(psd, options);
};

self.onmessage = ({ data: { id, type, payload } }) => {
  let answer;
  try {
    answer = prepare(type === "read" ? read(payload) : write(payload));
  } catch (error) {
    self.postMessage({ id, error: String((error && error.message) || error) });
    return;
  }
  try {
    self.postMessage({ id, result: answer.result }, answer.transfer);
  } catch (error) {
    self.postMessage({ id, error: String(error), unsent: true });
  }
};

self.postMessage({ ready: true });
