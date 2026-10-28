'use strict';

// Run after generating the local sequence preview; requires Playwright.
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://127.0.0.1:8000/?preview=outputs/avatar-12fps-6s.json');
    await page.waitForFunction(() => state.result?.frames === 72, null, { timeout: 30000 });
    assert.equal(await page.locator('#fps').inputValue(), '12');
    assert.equal(await page.locator('#errorBox').isVisible(), false);
    assert.match(await page.locator('#resultDimensions').textContent(), /6\.00 秒 · 12 fps · 72 帧/);
    assert.equal(await page.locator('#gifPreview').evaluate(image => image.complete && image.naturalWidth === 848 && image.naturalHeight === 1120), true);
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 1100 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `Overflow at ${width}px`);
    }
    await page.locator('#originalTab').click();
    assert.equal(await page.locator('#videoPreview').isVisible(), true);
    await page.locator('#gifTab').click();
    await page.locator('#saveButton').click();
    const pending = page.waitForEvent('download');
    await page.locator('#downloadLink').click();
    const download = await pending;
    assert.equal(download.suggestedFilename(), 'avatar-12fps-6s-green.gif');
    const target = path.join(__dirname, '..', 'test-artifacts', 'avatar-preview-download.gif');
    await download.saveAs(target);
    assert.equal(fs.statSync(target).size, fs.statSync(path.join(__dirname, '..', 'outputs', 'avatar-12fps-6s-transparent.gif')).size);
    await page.locator('#saveDialog [data-close-dialog]').click();
    // Freeze only this test tab for deterministic screenshots of the large GIF.
    await page.locator('#gifPreview').evaluate(image => {
      const still = document.createElement('canvas');
      still.width = image.naturalWidth; still.height = image.naturalHeight;
      still.getContext('2d').drawImage(image, 0, 0);
      image.src = still.toDataURL('image/png');
      return image.decode();
    });
    await page.screenshot({ path: path.join(__dirname, '..', 'test-artifacts', 'avatar-preview-desktop.png'), fullPage: true, timeout: 60000 });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: path.join(__dirname, '..', 'test-artifacts', 'avatar-preview-mobile.png'), fullPage: true });
    await page.locator('#fps').fill('13');
    assert.equal(await page.evaluate(() => state.result === null), true);
    await page.goto('http://127.0.0.1:8000/');
    assert.equal(await page.locator('#fps').inputValue(), '30');
    assert.equal(await page.evaluate(() => state.result === null), true);
    let externalRequests = 0;
    await page.route('https://example.com/**', route => { externalRequests++; return route.abort(); });
    await page.goto('http://127.0.0.1:8000/?preview=https://example.com/preview.json');
    await page.waitForFunction(() => !document.getElementById('errorBox').hidden);
    assert.match(await page.locator('#errorBox').textContent(), /仅支持本项目/);
    assert.equal(externalRequests, 0);
    await page.route('**/outputs/invalid-preview.json', route => route.fulfill({
      contentType: 'application/json', body: JSON.stringify({ fps: 12, frames: 12, duration: 6 })
    }));
    await page.goto('http://127.0.0.1:8000/?preview=outputs/invalid-preview.json');
    await page.waitForFunction(() => !document.getElementById('errorBox').hidden);
    assert.match(await page.locator('#errorBox').textContent(), /帧率或时长信息无效/);
    assert.deepEqual(errors, []);
    console.log('PASS: local 72-frame preview loads at 12 fps / 6 seconds; original tab, GIF download, responsive widths, unchanged defaults and unsafe URL rejection.');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
