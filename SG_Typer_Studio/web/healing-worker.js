// Full-stroke Healing Brush jobs off the UI thread. The main thread supplies the original
// HTMLCanvas polyline coverage as a bitmap; all pixel readback and Poisson work happens here.
importScripts("healing.js");

const pixels = (bitmap, width, height) => {
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(bitmap, 0, 0);
  bitmap.close();
  return context.getImageData(0, 0, width, height).data;
};

self.onmessage = (event) => {
  const { id, box, left, top, width, height, sourceBitmap, destinationBitmap, coverageBitmap } = event.data;
  const source = pixels(sourceBitmap, width, height);
  const destination = pixels(destinationBitmap, width, height);
  const coverage = pixels(coverageBitmap, width, height);
  const count = width * height;
  const mask = new Uint8Array(count);
  const strength = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const alpha = coverage[i * 4 + 3];
    mask[i] = alpha ? 1 : 0;
    strength[i] = alpha / 255;
  }
  const output = self.TypeRHealing.seamlessClone(width, height, source, destination, mask, 4);
  const blended = new Uint8ClampedArray(count * 4);
  for (let i = 0; i < count; i++) {
    const at = i * 4;
    const amount = strength[i];
    blended[at] = destination[at] + (output[at] - destination[at]) * amount;
    blended[at + 1] = destination[at + 1] + (output[at + 1] - destination[at + 1]) * amount;
    blended[at + 2] = destination[at + 2] + (output[at + 2] - destination[at + 2]) * amount;
    blended[at + 3] = destination[at + 3] + (output[at + 3] - destination[at + 3]) * amount;
  }
  self.postMessage({ id, box, left, top, width, height, blended }, [blended.buffer]);
};
