'use strict';

// No dependencies or running server required: node tests/wallpaper-catalog.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
for (const script of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) {
  if (script[1].trim()) new vm.Script(script[1]);
}
const definition = html.match(/const catalog = ([\s\S]+?);\nconst reducedMotion/);
assert.ok(definition, 'Static hosts need an embedded wallpaper catalog.');
const catalog = vm.runInNewContext(definition[1], {}, { timeout: 1000 });
assert.ok(catalog.length > 0);
assert.equal(new Set(catalog.map(item => item.file)).size, catalog.length);
for (const item of catalog) {
  assert.match(item.file, /^[^/\\]+\.gif$/i);
  const source = path.join(root, 'assets', 'view', item.file);
  const fd = fs.openSync(source, 'r');
  const header = Buffer.alloc(10);
  try { fs.readSync(fd, header, 0, header.length, 0); }
  finally { fs.closeSync(fd); }
  assert.match(header.subarray(0, 6).toString(), /^GIF8[79]a$/);
  assert.equal(item.width, header.readUInt16LE(6), item.file + ' width');
  assert.equal(item.height, header.readUInt16LE(8), item.file + ' height');
  assert.equal(item.bytes, fs.statSync(source).size, item.file + ' size');
  const poster = fs.readFileSync(path.join(root, item.poster));
  assert.equal(poster.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.ok(poster.length < 1024 * 1024, 'Posters should stay lightweight.');
}
assert.doesNotMatch(html, /<script[^>]+src=["'](?:https?:)?\/\//i);
assert.doesNotMatch(html, /<script[^>]+src=["'](?:app|gif)\.js/);
assert.doesNotMatch(html, /id=["'](?:deviceControl|previewStage|brightness|clockToggle|tweaksPanel)["']/);
assert.match(html, /download\.download = item\.file/);
assert.match(html, /new IntersectionObserver/);
console.log('PASS: JavaScript syntax, ' + catalog.length + ' GIF metadata records, PNG posters, lazy loading, original downloads, and simplified gallery.');
