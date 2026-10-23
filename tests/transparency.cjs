'use strict';

// Run with Playwright installed: node tests/transparency.cjs [local server URL]
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(process.argv[2] || 'http://127.0.0.1:8000/', { waitUntil: 'networkidle' });
    assert.equal(await page.locator('#protectInput').isChecked(), false);
    assert.equal(await page.locator('#backgroundInput').inputValue(), 'auto');
    const results = await page.evaluate(async () => {
      const width = 160, height = 160;
      const makeFrame = (empty = false) => {
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.fillStyle = '#000'; ctx.fillRect(0, 0, width, height);
        if (!empty) {
          for (let y = 30; y < 130; y++) {
            for (let x = 45; x < 115; x++) {
              ctx.fillStyle = `rgb(${(x * 7 + y * 5) % 120 + 120},${(x * 3 + y * 7) % 140 + 50},${(x + y * 3) % 90 + 60})`;
              ctx.fillRect(x, y, 1, 1);
            }
          }
          // Real green belongs to the subject, not to the transparency key.
          ctx.fillStyle = '#00ff00'; ctx.fillRect(55, 55, 20, 20);
          // Enclosed black background models the gap between an arm and torso.
          ctx.fillStyle = '#000'; ctx.fillRect(80, 80, 15, 25);
        }
        return { ctx, image: ctx.getImageData(0, 0, width, height) };
      };
      const encode = async (image, transparent, quality = 1) => {
        const gif = new GIF({ workers: 1, width, height, quality, transparent, workerScript: 'gif.worker.js?v=alpha-mask-1' });
        gif.addFrame(image, { copy: true, delay: 1000 });
        try {
          const blob = await new Promise((resolve, reject) => {
            gif.on('finished', resolve);
            gif.render();
            [...gif.freeWorkers, ...gif.activeWorkers].forEach(worker => worker.addEventListener('error', reject, { once: true }));
          });
          const url = URL.createObjectURL(blob);
          const output = new Image();
          output.src = url;
          await output.decode();
          const decoded = document.createElement('canvas');
          decoded.width = width; decoded.height = height;
          const decodedCtx = decoded.getContext('2d');
          decodedCtx.drawImage(output, 0, 0);
          const data = decodedCtx.getImageData(0, 0, width, height).data;
          URL.revokeObjectURL(url);
          return data;
        } finally {
          [...gif.freeWorkers, ...gif.activeWorkers].forEach(worker => worker.terminate());
        }
      };
      const at = (data, x, y) => [...data.slice((y * width + x) * 4, (y * width + x) * 4 + 4)];
      const frame = makeFrame();
      removeBackground(frame.image, { r: 0, g: 0, b: 0 }, 30, false);
      const qualities = [];
      for (const quality of [1, 10, 30]) {
        const decoded = await encode(frame.image, 0, quality);
        let mismatch = 0, fabricatedGreen = 0;
        for (let pixel = 0; pixel < width * height; pixel++) {
          const offset = pixel * 4;
          if (decoded[offset + 3] !== frame.image.data[offset + 3]) mismatch++;
          if (!frame.image.data[offset + 3] && decoded[offset + 3] && decoded[offset + 1] > 180) fabricatedGreen++;
        }
        qualities.push({ quality, mismatch, fabricatedGreen, genuineGreen: at(decoded, 60, 60), gap: at(decoded, 85, 90) });
      }

      const protectedFrame = makeFrame();
      removeBackground(protectedFrame.image, { r: 0, g: 0, b: 0 }, 30, true);
      const protectedGap = at(protectedFrame.image.data, 85, 90);

      const empty = makeFrame(true);
      removeBackground(empty.image, { r: 0, g: 0, b: 0 }, 30, false);
      const emptyDecoded = await encode(empty.image, 0);
      const emptyOpaque = emptyDecoded.filter((_, index) => index % 4 === 3).some(alpha => alpha !== 0);

      const keep = makeFrame();
      const keepDecoded = await encode(keep.image, null);

      // Green patches must become transparent, not merely desaturated.
      const spillFrame = makeFrame();
      spillFrame.ctx.fillStyle = '#00ff00'; spillFrame.ctx.fillRect(0, 0, 45, height);
      spillFrame.ctx.fillStyle = 'rgb(110,180,110)'; spillFrame.ctx.fillRect(45, 45, 2, 20);
      spillFrame.ctx.fillStyle = 'rgb(90,200,95)'; spillFrame.ctx.fillRect(55, 55, 20, 20);
      const spill = spillFrame.ctx.getImageData(0, 0, width, height);
      removeBackground(spill, { r: 0, g: 255, b: 0 }, 30, false);

      const matte = new ImageData(new Uint8ClampedArray([
        20, 240, 150, 255, // Detached green effect, H > old key's hue guard.
        30, 240, 220, 255, // Green-cyan effect, H ~174.
        175, 250, 145, 255, // Pale green in an enclosed gap.
        40, 190, 210, 255, // Blue-cyan clothing.
        229, 176, 145, 255, // Skin.
        237, 241, 243, 255, // White hair.
        20, 240, 150, 0, // Already transparent pixels must stay untouched.
        80, 190, 110, 127,
        170, 249, 237, 255, // Pastel teal, sampled from the user's shirt.
        249, 251, 249, 255 // Slightly tinted white hair, not green background.
      ]), 10, 1);
      const exactOnly = new ImageData(new Uint8ClampedArray(matte.data), matte.width, matte.height);
      removeBackground(exactOnly, { r: 0, g: 255, b: 0 }, 0, false);
      const zeroThresholdUnchanged = exactOnly.data.every((value, i) => value === matte.data[i]);
      removeBackground(matte, { r: 0, g: 255, b: 0 }, 200, false);
      const matteAlphas = Array.from({ length: 10 }, (_, i) => matte.data[i * 4 + 3]);
      const spillDecoded = await encode(spill, 0);

      // The reported regression: remove GREEN, not white hair/skin/clothing.
      const makeGreenScreen = () => {
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#02f508'; ctx.fillRect(0, 0, width, height);
        ctx.fillStyle = '#edf1f3'; ctx.fillRect(60, 20, 40, 20); // White hair.
        ctx.fillStyle = '#e5b091'; ctx.fillRect(60, 40, 40, 20); // Skin.
        ctx.fillStyle = '#28bed2'; ctx.fillRect(40, 60, 80, 40); // Cyan clothes.
        ctx.fillStyle = '#3764be'; ctx.fillRect(60, 100, 40, 20); // Blue clothes.
        ctx.fillStyle = '#1c2328'; ctx.fillRect(60, 120, 40, 30); // Dark trousers.
        ctx.fillStyle = '#02f508'; ctx.fillRect(45, 70, 10, 20); // Enclosed arm gap.
        ctx.fillStyle = 'rgb(170,249,237)'; ctx.fillRect(83, 65, 25, 30); // Actual pastel teal shirt hue.
        ctx.fillStyle = 'rgb(20,240,150)'; ctx.fillRect(10, 30, 25, 25); // Detached effect.
        ctx.fillStyle = 'rgb(175,250,145)'; ctx.fillRect(90, 105, 15, 13); // Pale enclosed remnant.
        return { canvas, ctx, image: ctx.getImageData(0, 0, width, height) };
      };
      const screen = makeGreenScreen();
      const autoKey = detectBackground(screen.image);
      const greenScreens = [];
      for (const threshold of [30, 80, 200, 255]) {
        const image = makeGreenScreen().image;
        removeBackground(image, autoKey, threshold, false);
        const decoded = await encode(image, 0);
        let mismatch = 0, expectedMaskMismatch = 0;
        for (let i = 3; i < decoded.length; i += 4) {
          if (decoded[i] !== image.data[i]) mismatch++;
          const pixel = (i - 3) / 4, x = pixel % width, y = Math.floor(pixel / width);
          const body = (x >= 60 && x < 100 && y >= 20 && y < 150) ||
            (x >= 40 && x < 120 && y >= 60 && y < 100);
          const gap = (x >= 45 && x < 55 && y >= 70 && y < 90) ||
            (x >= 90 && x < 105 && y >= 105 && y < 118);
          if (decoded[i] !== (body && !gap ? 255 : 0)) expectedMaskMismatch++;
        }
        greenScreens.push({
          threshold, mismatch, expectedMaskMismatch, background: at(decoded, 5, 5), gap: at(decoded, 50, 80),
          detachedEffect: at(decoded, 20, 40), paleRemnant: at(decoded, 95, 110), pastelShirt: at(decoded, 90, 80),
          subject: [[70, 30], [70, 50], [70, 80], [70, 110], [70, 135]].map(([x, y]) => at(decoded, x, y))
        });
      }
      screen.ctx.fillStyle = '#000';
      screen.ctx.fillRect(0, 0, width, 50);
      screen.ctx.fillRect(0, height - 50, width, 50);
      const letterboxKey = detectBackground(screen.ctx.getImageData(0, 0, width, height));
      const blackKey = detectBackground(makeFrame().image);
      const timing = [
        { fps: 30, duration: 24.983424 }, { fps: 60, duration: 1 }, { fps: 5, duration: .17 }
      ].map(({ fps, duration }) => ({
        fps, duration,
        encodedMilliseconds: Array.from({ length: Math.ceil(duration * fps) }, (_, frame) => gifFrameDelay(frame, fps, duration)).reduce((a, b) => a + b, 0)
      }));
      return {
        timing,
        qualities, protectedGap, emptyOpaque, autoKey, greenScreens, letterboxKey, blackKey, matteAlphas, zeroThresholdUnchanged,
        keepBlack: at(keepDecoded, 5, 5), keepGreen: at(keepDecoded, 60, 60),
        despilledEdge: at(spill.data, 45, 50), interiorGreen: at(spill.data, 60, 60),
        encodedGreenPatch: at(spillDecoded, 60, 60)
      };
    });
    for (const result of results.qualities) {
      assert.equal(result.mismatch, 0, `alpha-mask mismatch at quality ${result.quality}`);
      assert.equal(result.fabricatedGreen, 0);
      assert.equal(result.genuineGreen[3], 255);
      assert.ok(result.genuineGreen[1] > 200);
      assert.equal(result.gap[3], 0);
    }
    assert.equal(results.protectedGap[3], 255);
    assert.equal(results.emptyOpaque, false);
    assert.equal(results.keepBlack[3], 255);
    assert.equal(results.keepGreen[3], 255);
    assert.equal(results.despilledEdge[3], 0);
    assert.equal(results.interiorGreen[3], 0);
    assert.equal(results.encodedGreenPatch[3], 0);
    assert.equal(results.zeroThresholdUnchanged, true);
    for (const timing of results.timing) assert.equal(timing.encodedMilliseconds, Math.round(timing.duration * 100) * 10);
    assert.deepEqual(results.matteAlphas, [0, 0, 0, 255, 255, 255, 0, 0, 255, 255]);
    assert.deepEqual(results.autoKey, { r: 2, g: 245, b: 8 });
    assert.deepEqual(results.letterboxKey, results.autoKey, 'letterboxing must not hide the green screen');
    assert.deepEqual(results.blackKey, { r: 0, g: 0, b: 0 }, 'central clothing must not be selected as background');
    for (const result of results.greenScreens) {
      assert.equal(result.mismatch, 0, `green-screen alpha mismatch at threshold ${result.threshold}`);
      assert.equal(result.expectedMaskMismatch, 0, `semantic fixture mask mismatch at threshold ${result.threshold}`);
      assert.equal(result.background[3], 0);
      assert.equal(result.gap[3], 0);
      assert.equal(result.detachedEffect[3], 0);
      assert.equal(result.paleRemnant[3], 0);
      assert.equal(result.pastelShirt[3], 255);
      assert.ok(result.pastelShirt[1] > result.pastelShirt[0] + 50);
      assert.ok(result.subject.every(pixel => pixel[3] === 255), `character erased at threshold ${result.threshold}`);
    }
    assert.deepEqual(errors, []);
    console.log('PASS: exact transparency at quality 1/10/30; green preserved on black background; closed gaps removed; optional protection; empty frame; keep-background mode; detached green effects and pale remnants transparent, not gray; zero tolerance preserved; automatic green key; letterboxing; exact expected character/background masks at thresholds 30/80/200/255.');
    console.log(JSON.stringify(results, null, 2));
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
