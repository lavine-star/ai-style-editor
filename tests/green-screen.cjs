'use strict';

// Integration test: real H.264 video -> upload UI -> GIF worker -> download.
// Requires Playwright and ffmpeg (or FFMPEG_PATH pointing to the executable).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { chromium } = require('playwright');

(async () => {
  const directory = path.join(__dirname, '..', 'test-artifacts');
  fs.mkdirSync(directory, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(process.argv[2] || 'http://127.0.0.1:8000/', { waitUntil: 'networkidle' });
    const fixture = await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 320; canvas.height = 240;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#02f508'; ctx.fillRect(0, 0, 320, 240);
      ctx.fillStyle = '#edf1f3'; ctx.fillRect(135, 40, 50, 30);
      ctx.fillStyle = '#e5b091'; ctx.fillRect(135, 70, 50, 20);
      ctx.fillStyle = '#28bed2'; ctx.fillRect(110, 90, 100, 60);
      ctx.fillStyle = '#3764be'; ctx.fillRect(130, 150, 60, 30);
      ctx.fillStyle = '#1c2328'; ctx.fillRect(130, 180, 60, 45);
      ctx.fillStyle = '#02f508'; ctx.fillRect(115, 110, 10, 25);
      ctx.fillStyle = 'rgb(170,249,237)'; ctx.fillRect(190, 100, 15, 35);
      // Detached green-cyan effect, outside the narrow transparency key hue.
      ctx.fillStyle = 'rgb(138,201,186)'; ctx.beginPath(); ctx.arc(50, 80, 26, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#20e8a0'; ctx.beginPath(); ctx.arc(50, 80, 24, 0, Math.PI * 2); ctx.fill();
      // Pale green enclosed patch, outside threshold 200's RGB distance.
      ctx.fillStyle = 'rgb(175,250,145)'; ctx.fillRect(175, 115, 12, 15);
      return canvas.toDataURL('image/png').split(',')[1];
    });
    const input = path.join(directory, 'green-screen-input.png');
    const video = path.join(directory, 'green-screen-input.mp4');
    fs.writeFileSync(input, Buffer.from(fixture, 'base64'));
    const ffmpeg = spawnSync(process.env.FFMPEG_PATH || 'ffmpeg', [
      '-y', '-loglevel', 'error', '-loop', '1', '-i', input, '-t', '1',
      '-r', '30', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', video
    ], { encoding: 'utf8' });
    assert.equal(ffmpeg.status, 0, ffmpeg.error?.message || ffmpeg.stderr);
    await page.locator('#fileInput').setInputFiles(video);
    await page.waitForFunction(() => !state.loading && !!state.file);
    assert.equal(await page.locator('#backgroundInput').inputValue(), 'auto');
    assert.match(await page.locator('#modeHint').textContent(), /已自动识别：绿色背景/);
    assert.equal(await page.locator('#fps').inputValue(), '30');
    assert.equal(await page.locator('#quality').inputValue(), '1');
    assert.equal(await page.locator('#scale').inputValue(), '1');
    await page.locator('#thresholdInput').fill('200');
    await page.locator('#convertButton').click();
    await page.waitForFunction(() => !!state.result && !state.busy, null, { timeout: 30000 });
    assert.equal(await page.locator('#errorBox').isVisible(), false);
    const pixels = await page.evaluate(async () => {
      await $('gifPreview').decode();
      const canvas = document.createElement('canvas');
      canvas.width = 320; canvas.height = 240;
      const ctx = canvas.getContext('2d');
      ctx.drawImage($('gifPreview'), 0, 0);
      const at = (x, y) => [...ctx.getImageData(x, y, 1, 1).data];
      const rgba = ctx.getImageData(0, 0, 320, 240).data;
      let opaqueBackground = 0;
      for (let y = 0; y < 240; y++) {
        for (let x = 0; x < 320; x++) {
          const body = (x >= 135 && x < 185 && y >= 40 && y < 90) ||
            (x >= 110 && x < 210 && y >= 90 && y < 150) ||
            (x >= 130 && x < 190 && y >= 150 && y < 225);
          const hole = (x >= 115 && x < 125 && y >= 110 && y < 135) ||
            (x >= 175 && x < 187 && y >= 115 && y < 130);
          if ((!body || hole) && rgba[(y * 320 + x) * 4 + 3]) opaqueBackground++;
        }
      }
      return {
        opaqueBackground,
        background: at(10, 120), gap: at(120, 120),
        detachedEffect: at(50, 80), enclosedResidual: at(180, 120),
        effectFringe: at(75, 80),
        pastelShirt: at(197, 115),
        subject: [50, 80, 120, 165, 200].map(y => at(150, y))
      };
    });
    assert.equal(pixels.background[3], 0);
    assert.equal(pixels.opaqueBackground, 0, 'every known background pixel must be transparent, not just selected samples');
    assert.equal(pixels.gap[3], 0);
    assert.ok(pixels.subject.every(pixel => pixel[3] === 255), 'subject must stay opaque');
    for (const pixel of [pixels.detachedEffect, pixels.enclosedResidual, pixels.effectFringe]) {
      assert.equal(pixel[3], 0, 'residual green must be transparent, not gray');
    }
    assert.equal(pixels.pastelShirt[3], 255, 'pastel teal clothing must not be erased');
    assert.ok(pixels.pastelShirt[1] > pixels.pastelShirt[0] + 50, 'pastel teal must not become gray');
    assert.ok(pixels.subject[2][2] > pixels.subject[2][0] + 100, 'blue-cyan clothes must keep their color');
    await page.screenshot({ path: path.join(directory, 'green-screen-desktop.png'), fullPage: true });
    await page.locator('#saveButton').click();
    const downloadPromise = page.waitForEvent('download');
    await page.locator('#downloadLink').click();
    await (await downloadPromise).saveAs(path.join(directory, 'green-screen-result.gif'));
    await page.locator('#saveDialog [data-close-dialog]').click();
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `overflow at ${width}px`);
      if (width === 390) await page.screenshot({ path: path.join(directory, 'green-screen-mobile.png'), fullPage: true });
    }
    await page.locator('[data-mode="keep"]').click();
    assert.equal(await page.locator('#backgroundChoice').isVisible(), false);
    await page.locator('[data-mode="color"]').click();
    await page.locator('#backgroundInput').selectOption('custom');
    assert.equal(await page.locator('#advancedDetails').getAttribute('open'), '');
    assert.equal(await page.locator('#customColor').isVisible(), true);
    assert.deepEqual(errors, []);
    console.log('PASS: H.264 upload, automatic green key, threshold 200, character retained, enclosed gap/detached effect/pale-green patch transparent, pastel teal and blue-cyan clothes retained, GIF download, responsive widths 320/390/768/1440.');
    console.log(JSON.stringify(pixels));
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
