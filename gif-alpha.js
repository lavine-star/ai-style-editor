/* Alpha-mask extension for the bundled gif.js 0.2.0 worker.
 * Palette index 0 is reserved for transparency; opaque pixels never use it.
 * Unlike a chroma-key sentinel, this cannot introduce green into the image
 * or accidentally make a genuinely green subject transparent.
 */
'use strict';

self.encodeAlphaPixels = function (NeuQuant) {
  const image = this.image;
  const count = this.width * this.height;
  const indexed = new Uint8Array(count);
  let opaqueCount = 0;
  for (let pixel = 0; pixel < count; pixel++) {
    if (image[pixel * 4 + 3] >= 128) opaqueCount++;
  }

  this.transIndex = 0;
  this.colorDepth = 8;
  this.palSize = 7;
  this.usedEntry = new Array(256).fill(false);
  this.usedEntry[0] = true;
  this.indexedPixels = indexed;
  this.pixels = null;

  if (!opaqueCount) {
    this.colorTab = new Array(768).fill(0);
    return;
  }

  // Train on foreground colors only, not on the removed background.
  const colors = new Uint8Array(opaqueCount * 3);
  let cursor = 0;
  for (let pixel = 0; pixel < count; pixel++) {
    const offset = pixel * 4;
    if (image[offset + 3] < 128) continue;
    colors[cursor++] = image[offset];
    colors[cursor++] = image[offset + 1];
    colors[cursor++] = image[offset + 2];
  }
  const quantizer = new NeuQuant(colors, this.sample);
  quantizer.buildColormap();
  const palette = Array.from(quantizer.getColormap());
  const usage = new Uint32Array(256);
  for (let pixel = 0; pixel < count; pixel++) {
    const offset = pixel * 4;
    if (image[offset + 3] < 128) continue;
    const index = quantizer.lookupRGB(image[offset], image[offset + 1], image[offset + 2]);
    indexed[pixel] = index;
    usage[index]++;
  }

  // Sacrifice the least-used entry, swapping it into the reserved index.
  // Most images leave an unused palette entry, so no foreground remap is needed.
  let reserved = 0;
  for (let index = 1; index < 256; index++) {
    if (usage[index] < usage[reserved]) reserved = index;
  }
  for (let channel = 0; channel < 3; channel++) {
    palette[reserved * 3 + channel] = palette[channel];
    palette[channel] = 0;
  }
  const remapped = new Map();
  for (let pixel = 0; pixel < count; pixel++) {
    const offset = pixel * 4;
    if (image[offset + 3] < 128) {
      indexed[pixel] = 0;
      continue;
    }
    const original = indexed[pixel];
    let index = original === 0 ? reserved : original === reserved ? 0 : original;
    if (index === 0) {
      const r = image[offset], g = image[offset + 1], b = image[offset + 2];
      const color = (r << 16) | (g << 8) | b;
      index = remapped.get(color);
      if (index === undefined) {
        let closest = Infinity;
        for (let entry = 1; entry < 256; entry++) {
          const at = entry * 3;
          const distance = (r - palette[at]) ** 2 + (g - palette[at + 1]) ** 2 + (b - palette[at + 2]) ** 2;
          if (distance < closest) { closest = distance; index = entry; }
        }
        remapped.set(color, index);
      }
    }
    indexed[pixel] = index;
    this.usedEntry[index] = true;
  }
  this.colorTab = palette;
};
