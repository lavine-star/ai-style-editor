'use strict';

// Inspect actual footage through the same Canvas + matte code as the app.
// node tests/real-video.cjs /absolute/path/source.mp4 [server URL]
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

(async () => {
  assert.ok(process.argv[2], 'Pass the source video path as the first argument.');
  const directory = path.join(__dirname, '..', 'test-artifacts', 'real-video');
  fs.mkdirSync(directory, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(process.argv[3] || 'http://127.0.0.1:8000/', { waitUntil: 'networkidle' });
    await page.locator('#fileInput').setInputFiles(process.argv[2]);
    await page.waitForFunction(() => !state.loading && !!state.file);
    console.log(await page.evaluate(() => ({ duration: state.duration, width: video.videoWidth, height: video.videoHeight, key: state.detectedColor })));
    for (const time of [0, 1, 3, 5, 7, 9, 12, 15, 18, 21, 24]) {
      const result = await page.evaluate(async time => {
        await seekTo(Math.min(time, state.duration - .001), new AbortController().signal);
        canvas.width = video.videoWidth; canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0);
        const original = canvas.toDataURL('image/png').split(',')[1];
        const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const removed = removeBackground(image, state.detectedColor, 30, false);
        ctx.putImageData(image, 0, 0);
        const alpha = canvas.toDataURL('image/png').split(',')[1];
        const checker = document.createElement('canvas');
        checker.width = canvas.width; checker.height = canvas.height;
        const c = checker.getContext('2d');
        for (let y = 0; y < checker.height; y += 16) for (let x = 0; x < checker.width; x += 16) {
          c.fillStyle = (Math.floor(x / 16) + Math.floor(y / 16)) % 2 ? '#e6e8ed' : '#fff';
          c.fillRect(x, y, 16, 16);
        }
        c.drawImage(canvas, 0, 0);
        return { original, alpha, checker: checker.toDataURL('image/png').split(',')[1], removed };
      }, time);
      for (const kind of ['original', 'alpha', 'checker']) fs.writeFileSync(path.join(directory, `${time}-${kind}.png`), Buffer.from(result[kind], 'base64'));
      console.log(`frame ${time}s: ${result.removed} pixels removed`);
    }
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
