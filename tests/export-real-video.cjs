'use strict';

// Export the complete original video through the production upload UI/worker.
// node tests/export-real-video.cjs /absolute/path/source.mp4 [output.gif]
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

(async () => {
  assert.ok(process.argv[2], 'Pass the source video path.');
  const output = path.resolve(process.argv[3] || path.join(__dirname, '..', 'outputs', 'green-screen-transparent.gif'));
  const fps = Number(process.env.EXPORT_FPS || 30);
  const scale = Number(process.env.EXPORT_SCALE || 1);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://127.0.0.1:8000/', { waitUntil: 'networkidle' });
    await page.locator('#fileInput').setInputFiles(process.argv[2]);
    await page.waitForFunction(() => !state.loading && !!state.file);
    assert.equal(await page.locator('#backgroundInput').inputValue(), 'auto');
    assert.equal(await page.locator('#fps').inputValue(), '30');
    assert.equal(await page.locator('#quality').inputValue(), '1');
    assert.equal(await page.locator('#scale').inputValue(), '1');
    assert.equal(await page.locator('#thresholdInput').inputValue(), '30');
    assert.equal(await page.locator('#protectInput').isChecked(), false);
    await page.locator('#fps').fill(String(fps));
    await page.locator('#scale').fill(String(scale));
    await page.exposeFunction('reportExportProgress', (title, percent) => console.log(`${title}: ${Math.round(percent)}%`));
    console.log(await page.evaluate(() => {
      const original = updateProgress;
      let lastBucket = -1;
      updateProgress = (...args) => {
        original(...args);
        const bucket = Math.floor(args[1] / 5);
        if (bucket !== lastBucket) { lastBucket = bucket; window.reportExportProgress(args[0], args[1]); }
      };
      return { duration: state.duration, width: video.videoWidth, height: video.videoHeight, frames: Math.ceil(state.duration * Number($('fps').value)), scale: Number($('scale').value), key: state.detectedColor };
    }));
    await page.locator('#convertButton').click();
    await page.waitForFunction(() => !state.busy, null, { timeout: 600000 });
    assert.equal(await page.locator('#errorBox').isVisible(), false, await page.locator('#errorBox').textContent());
    assert.equal(await page.evaluate(() => !!state.result?.transparent), true);
    await page.locator('#saveButton').click();
    const download = page.waitForEvent('download');
    await page.locator('#downloadLink').click();
    await (await download).saveAs(output);
    assert.deepEqual(errors, []);
    console.log(`PASS: full original video converted at ${fps} fps, quality 1, ${scale * 100}% scale; saved ${output} (${fs.statSync(output).size} bytes).`);
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
