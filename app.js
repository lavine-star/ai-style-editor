'use strict';

// The reference UI is adapted to the existing browser-only gif.js pipeline.
const $ = (id) => document.getElementById(id);
const state = {
  file: null, sourceUrl: null, result: null, duration: 0, busy: false,
  loading: false, mode: 'color', picking: false, revision: 0,
  controller: null, encoder: null, color: { r: 255, g: 255, b: 255 }, detectedColor: null
};
const video = $('videoPreview');
const canvas = $('canvas');
const ctx = canvas.getContext('2d', { willReadFrequently: true });
const pickCanvas = $('pickCanvas');
const pickCtx = pickCanvas.getContext('2d', { willReadFrequently: true });
const MB = 1024 * 1024;
const fileSize = (bytes) => bytes >= MB ? `${(bytes / MB).toFixed(2)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
const abortError = () => new DOMException('转换已取消', 'AbortError');

lucide.createIcons({ attrs: { 'stroke-width': 1.6, 'aria-hidden': 'true' } });

function setError(message = '') {
  $('errorBox').textContent = message;
  $('errorBox').hidden = !message;
}

function updateSteps(index) {
  [1, 2, 3].forEach((i) => {
    $('step' + i).classList.toggle('current', i === index);
    $('step' + i).classList.toggle('done', i < index);
    if (i === index) $('step' + i).setAttribute('aria-current', 'step');
    else $('step' + i).removeAttribute('aria-current');
  });
}

function setBusy(busy) {
  state.busy = busy;
  document.querySelectorAll('.editor input,.editor select,#modeControl button,#chooseButton,#replaceButton').forEach(el => { el.disabled = busy; });
  document.querySelectorAll('#backgroundInput,#thresholdInput,#protectInput,#colorPicker,#colorR,#colorG,#colorB').forEach(el => { el.disabled = busy || state.mode === 'keep'; });
  video.controls = !busy && !state.picking;
  $('convertButton').disabled = busy || state.loading || !state.file;
  $('pickColorButton').disabled = busy || state.loading || !state.file || state.mode === 'keep';
  $('regenerateButton').disabled = busy;
  $('demoButton').disabled = busy;
  $('saveButton').disabled = busy;
  $('progressBox').hidden = !busy;
  $('convertLabel').textContent = busy ? '正在制作 GIF…' : state.result && !state.result.demo ? '保存 GIF' : '开始制作 GIF';
  $('actionHint').textContent = busy ? '在浏览器本地处理，请保持页面打开' : '无需上传 · 无水印 · 原视频不变';
  $('dropzone').setAttribute('aria-disabled', String(busy));
}

function updateProgress(title, value, detail = '正在本地处理，请保持页面打开') {
  const percent = Math.max(0, Math.min(100, Math.round(value)));
  $('progressTitle').textContent = title;
  $('progressPercent').textContent = percent + '%';
  $('progressFill').style.width = percent + '%';
  $('progressBar').setAttribute('aria-valuenow', String(percent));
  $('progressDetail').textContent = detail;
}

function stopPicking() {
  state.picking = false;
  video.classList.remove('picking');
  $('stage').classList.remove('picking');
  video.controls = !state.busy;
  $('pickHint').textContent = '选择视频后，可直接点击画面采样背景色。';
  $('pickColorButton').setAttribute('aria-pressed', 'false');
}

function setPreview(tab) {
  stopPicking();
  const original = tab === 'original' && !!state.sourceUrl;
  if (!original) video.pause();
  video.hidden = !original;
  const resultAvailable = !!$('gifPreview').getAttribute('src');
  $('gifPreview').hidden = original || !resultAvailable;
  $('stagePlaceholder').hidden = original || resultAvailable;
  $('originalTab').setAttribute('aria-pressed', String(original));
  $('gifTab').setAttribute('aria-pressed', String(!original));
  $('stageTag').textContent = original ? '原始视频 · 未处理' :
    state.result ? state.result.demo ? '示例 GIF · 非你的视频' : state.result.transparent ? '透明 GIF · 制作完成' : 'GIF · 制作完成' :
    state.file ? '制作后在这里预览 GIF' : '透明背景效果示例';
}

function clearResult() {
  if (state.result?.url?.startsWith('blob:')) URL.revokeObjectURL(state.result.url);
  state.result = null;
  $('resultInfo').hidden = true;
  $('resultActions').hidden = true;
  $('gifPreview').removeAttribute('src');
  $('gifPreview').alt = '转换完成的 GIF 动图';
  $('saveImage').removeAttribute('src');
  $('downloadLink').removeAttribute('href');
  $('saveDialog').close();
  $('previewNote').textContent = '棋盘格仅用于展示透明区域，不会出现在导出的 GIF 中。';
}

function invalidateResult() {
  if (state.busy) return;
  if (state.result && !state.result.demo) {
    clearResult();
    setPreview('original');
    updateSteps(state.file ? 2 : 1);
  }
  setError();
  setBusy(false);
}

function waitForMedia(eventName, signal, timeout = 20000) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      video.removeEventListener(eventName, done);
      video.removeEventListener('error', failed);
      signal?.removeEventListener('abort', aborted);
    };
    const done = () => { cleanup(); resolve(); };
    const failed = () => { cleanup(); reject(new Error('浏览器无法解码此视频，请使用 H.264 编码的 MP4 或 WebM 重试。')); };
    const aborted = () => { cleanup(); reject(abortError()); };
    const timer = setTimeout(() => { cleanup(); reject(new Error('读取视频超时，请重新选择视频后重试。')); }, timeout);
    video.addEventListener(eventName, done, { once: true });
    video.addEventListener('error', failed, { once: true });
    signal?.addEventListener('abort', aborted, { once: true });
    if (signal?.aborted) aborted();
  });
}

function waitForFirstVideoFrame() {
  if (!video.requestVideoFrameCallback) {
    return waitForMedia('loadeddata').then(() => new Promise(resolve => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    }));
  }
  // Register BEFORE assigning the source. loadeddata alone can fire before
  // drawImage can read the first frame, yielding a transparent/black sample.
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      video.cancelVideoFrameCallback(callback);
      video.removeEventListener('error', failed);
    };
    const failed = () => { cleanup(); reject(new Error('浏览器无法解码此视频，请使用 H.264 编码的 MP4 或 WebM 重试。')); };
    const callback = video.requestVideoFrameCallback(() => { cleanup(); resolve(); });
    const timer = setTimeout(() => { cleanup(); reject(new Error('读取视频首帧超时，请重新选择视频。')); }, 20000);
    video.addEventListener('error', failed, { once: true });
  });
}

async function chooseFile(file) {
  if (!file || state.busy) return;
  if (!file.type.startsWith('video/') && !/\.(mp4|mov|m4v|webm|ogv)$/i.test(file.name)) return setError('请选择 MP4、MOV 或 WebM 视频文件。');
  if (!file.size) return setError('这个文件是空的，请重新选择视频。');
  if (file.size > 100 * MB) return setError('视频超过 100 MB，请先裁剪或压缩后重试。');
  setError();
  state.revision++;
  const revision = state.revision;
  clearResult();
  if (state.sourceUrl) URL.revokeObjectURL(state.sourceUrl);
  state.file = file;
  state.detectedColor = null;
  updateBackgroundHint();
  state.sourceUrl = URL.createObjectURL(file);
  state.loading = true;
  $('dropzone').hidden = true;
  $('selectedFile').hidden = false;
  $('filename').textContent = file.name;
  $('fileMeta').textContent = fileSize(file.size) + ' · 正在读取视频信息';
  $('originalTab').disabled = false;
  const firstFrame = waitForFirstVideoFrame();
  video.src = state.sourceUrl;
  video.load();
  setPreview('original');
  setBusy(false);
  updateSteps(2);
  try {
    await firstFrame;
    if (revision !== state.revision) return;
    if (!Number.isFinite(video.duration) || video.duration <= 0) throw new Error('无法获取视频时长，请换一个视频文件。');
    state.duration = video.duration;
    pickCanvas.width = Math.min(256, video.videoWidth);
    pickCanvas.height = Math.max(1, Math.round(video.videoHeight * pickCanvas.width / video.videoWidth));
    pickCtx.drawImage(video, 0, 0, pickCanvas.width, pickCanvas.height);
    state.detectedColor = detectBackground(pickCtx.getImageData(0, 0, pickCanvas.width, pickCanvas.height));
    updateBackgroundHint();
    $('fileMeta').textContent = `${fileSize(file.size)} · ${video.duration.toFixed(2)} 秒 · ${video.videoWidth}×${video.videoHeight}`;
  } catch (error) {
    if (revision !== state.revision) return;
    state.file = null;
    $('fileMeta').textContent = '无法读取此视频，请重新选择';
    setError(error.message);
  } finally {
    if (revision === state.revision) { state.loading = false; setBusy(false); }
  }
}

function openFilePicker(event) {
  event?.stopPropagation();
  if (!state.busy) $('fileInput').click();
}
$('chooseButton').onclick = openFilePicker;
$('replaceButton').onclick = openFilePicker;
$('dropzone').onclick = openFilePicker;
$('dropzone').onkeydown = (event) => {
  if (event.target !== $('dropzone')) return;
  if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openFilePicker(event); }
};
$('fileInput').onchange = (event) => {
  chooseFile(event.target.files[0]);
  event.target.value = '';
};
['dragenter', 'dragover'].forEach(name => $('dropzone').addEventListener(name, event => {
  event.preventDefault();
  if (!state.busy) $('dropzone').classList.add('dragging');
}));
['dragleave', 'drop'].forEach(name => $('dropzone').addEventListener(name, event => {
  event.preventDefault();
  $('dropzone').classList.remove('dragging');
  if (name === 'drop') chooseFile(event.dataTransfer.files[0]);
}));

$('modeControl').onclick = (event) => {
  const button = event.target.closest('[data-mode]');
  if (!button || state.busy) return;
  state.mode = button.dataset.mode;
  document.querySelectorAll('[data-mode]').forEach(el => el.setAttribute('aria-pressed', String(el === button)));
  updateBackgroundHint();
  document.querySelectorAll('#backgroundInput,#thresholdInput,#protectInput,#colorPicker,#colorR,#colorG,#colorB').forEach(el => { el.disabled = state.mode === 'keep'; });
  stopPicking();
  invalidateResult();
};
function updateRangeLabels() {
  $('fpsValue').textContent = $('fps').value + ' fps';
  $('qualityValue').textContent = $('quality').value;
  $('scaleValue').textContent = Math.round(Number($('scale').value) * 100) + '%';
  $('thresholdValue').textContent = $('thresholdInput').value;
}
['fps', 'quality', 'scale', 'thresholdInput'].forEach(id => $(id).oninput = () => {
  updateRangeLabels();
  invalidateResult();
});
$('protectInput').addEventListener('input', invalidateResult);
$('backgroundInput').onchange = () => {
  $('customColor').hidden = $('backgroundInput').value !== 'custom';
  if ($('backgroundInput').value === 'custom') $('advancedDetails').open = true;
  updateBackgroundHint();
  stopPicking();
  invalidateResult();
};
function updateColor(r, g, b) {
  state.color = { r, g, b };
  ['r', 'g', 'b'].forEach(key => { $('color' + key.toUpperCase()).value = state.color[key]; });
  const hex = '#' + [r, g, b].map(value => value.toString(16).padStart(2, '0')).join('');
  $('colorPicker').value = hex;
  $('colorValue').textContent = hex.toUpperCase();
  updateBackgroundHint();
  invalidateResult();
}
$('colorPicker').oninput = (event) => {
  const hex = event.target.value;
  updateColor(...[1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16)));
};
['colorR', 'colorG', 'colorB'].forEach(id => $(id).oninput = () => updateColor(
  ...['colorR', 'colorG', 'colorB'].map(key => Math.max(0, Math.min(255, parseInt($(key).value, 10) || 0)))
));
$('pickColorButton').onclick = () => {
  if (!state.file || state.busy || state.mode === 'keep') return;
  setPreview('original');
  video.pause();
  video.controls = false;
  state.picking = true;
  video.classList.add('picking');
  $('stage').classList.add('picking');
  $('pickColorButton').setAttribute('aria-pressed', 'true');
  $('pickHint').textContent = '请点击右侧视频中需要移除的背景，按 Esc 取消。';
};
video.addEventListener('click', (event) => {
  if (!state.picking) return;
  event.preventDefault();
  const rect = video.getBoundingClientRect();
  const ratio = Math.min(rect.width / video.videoWidth, rect.height / video.videoHeight);
  const offsetX = (rect.width - video.videoWidth * ratio) / 2;
  const offsetY = (rect.height - video.videoHeight * ratio) / 2;
  const x = (event.clientX - rect.left - offsetX) / ratio;
  const y = (event.clientY - rect.top - offsetY) / ratio;
  if (x < 0 || y < 0 || x >= video.videoWidth || y >= video.videoHeight) return;
  pickCanvas.width = video.videoWidth; pickCanvas.height = video.videoHeight;
  pickCtx.drawImage(video, 0, 0);
  const pixel = pickCtx.getImageData(Math.floor(x), Math.floor(y), 1, 1).data;
  updateColor(pixel[0], pixel[1], pixel[2]);
  stopPicking();
});
document.addEventListener('keydown', event => { if (event.key === 'Escape') stopPicking(); });

document.querySelectorAll('.swatch').forEach(button => button.onclick = () => {
  $('stage').dataset.background = button.dataset.background;
  document.querySelectorAll('.swatch').forEach(el => el.setAttribute('aria-pressed', String(el === button)));
});
$('originalTab').onclick = () => setPreview('original');
$('gifTab').onclick = () => setPreview('gif');

function screenChannel(color) {
  return color.g > color.r + 30 && color.g > color.b + 30 ? 1 :
    color.b > color.r + 30 && color.b > color.g + 30 ? 2 : -1;
}

function colorHue(r, g, b) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), span = max - min;
  if (!span) return 0;
  const sector = max === r ? (g - b) / span : max === g ? 2 + (b - r) / span : 4 + (r - g) / span;
  return (sector * 60 + 360) % 360;
}

function updateBackgroundHint() {
  $('backgroundChoice').hidden = state.mode === 'keep';
  if (state.mode === 'keep') {
    $('modeHint').textContent = '保留视频原始画面，适合风景、日常记录等复杂背景。';
    return;
  }
  const choice = $('backgroundInput').value;
  const selected = choice === 'auto' ? state.detectedColor : choice === 'black' ? { r: 0, g: 0, b: 0 } :
    choice === 'white' ? { r: 255, g: 255, b: 255 } : choice === '#00ff00' ? { r: 0, g: 255, b: 0 } : state.color;
  if (!selected) {
    $('modeHint').textContent = '上传后自动识别背景色；绿幕素材只去除绿色背景，不以人物的白发、皮肤或衣服为目标。';
    return;
  }
  const channel = screenChannel(selected);
  const name = channel === 1 ? '绿色背景' : channel === 2 ? '蓝色背景' :
    Math.max(selected.r, selected.g, selected.b) < 45 ? '黑色背景' :
    Math.min(selected.r, selected.g, selected.b) > 220 ? '白色背景' : '所选背景';
  const hex = '#' + [selected.r, selected.g, selected.b].map(value => value.toString(16).padStart(2, '0')).join('').toUpperCase();
  $('modeHint').textContent = `${choice === 'auto' ? '已自动识别' : '将移除'}：${name} ${hex}。${channel === 1 ? '整帧绿色、偏青绿光和封闭空隙直接转透明，不再涂灰；按饱和度区分浅色头发、肤色和青蓝服装。' : channel === 2 ? '按背景色相抠图，避免误删白发、皮肤和不同色相的衣服。' : '仅移除与背景相近的颜色。'}`;
}

function detectBackground(imageData) {
  const { data, width, height } = imageData;
  const colors = new Map();
  const add = (x, y, side) => {
    const i = (y * width + x) * 4;
    const key = [data[i] >> 4, data[i + 1] >> 4, data[i + 2] >> 4].join(',');
    const group = colors.get(key) || { count: 0, r: 0, g: 0, b: 0, sides: [0, 0, 0, 0] };
    group.count++; group.r += data[i]; group.g += data[i + 1]; group.b += data[i + 2];
    group.sides[side]++;
    colors.set(key, group);
  };
  for (let i = 0; i < 32; i++) {
    const x = Math.round(i / 31 * (width - 1)), y = Math.round(i / 31 * (height - 1));
    add(x, 0, 0); add(x, height - 1, 1); add(0, y, 2); add(width - 1, y, 3);
  }
  const ranked = [...colors.values()].sort((a, b) => b.count - a.count);
  // A green/blue screen visible on opposing edges is stronger evidence than
  // letterbox bars. Central blue clothing must not become the background key.
  const screen = ranked.find(group => {
    const color = { r: group.r / group.count, g: group.g / group.count, b: group.b / group.count };
    return group.count >= 16 && screenChannel(color) >= 0 &&
      ((group.sides[0] >= 4 && group.sides[1] >= 4) || (group.sides[2] >= 4 && group.sides[3] >= 4));
  });
  const best = screen || ranked[0];
  return { r: Math.round(best.r / best.count), g: Math.round(best.g / best.count), b: Math.round(best.b / best.count) };
}

function removeBackground(imageData, color, threshold, protect) {
  const { data, width, height } = imageData;
  const count = width * height, limit = threshold * threshold;
  const channel = screenChannel(color);
  const keyHue = colorHue(color.r, color.g, color.b);
  // A cyan-leaning green screen is still distinct from the character's
  // saturated turquoise trim. Do not classify all cyan as green in that case.
  const greenHueLimit = keyHue >= 135 ? 160 : 184;
  const matches = (pixel) => {
    const i = pixel * 4;
    const r = data[i], g = data[i + 1], b = data[i + 2];
    if (channel === 1 && threshold > 0) return colorHue(r, g, b) <= greenHueLimit && matchesGreenScreen(r, g, b, threshold, greenHueLimit === 160);
    if (channel >= 0) {
      // A large RGB tolerance is not permission to erase white hair, skin,
      // gray fabric or cyan/blue clothing. Require the actual screen hue.
      const dominant = channel === 1 ? g : b;
      const other = channel === 1 ? Math.max(r, b) : Math.max(r, g);
      if (dominant - other < Math.max(16, dominant * .08)) return false;
      const delta = Math.abs(colorHue(r, g, b) - keyHue);
      if (Math.min(delta, 360 - delta) > 24) return false;
    }
    return (r - color.r) ** 2 + (g - color.g) ** 2 + (b - color.b) ** 2 <= limit;
  };
  // Keep a real alpha mask. Never paint removed pixels green: that color
  // can leak through palette quantization or erase a genuinely green subject.
  const clear = (pixel) => { data[pixel * 4 + 3] = 0; };
  let removed = 0;
  if (!protect) {
    for (let pixel = 0; pixel < count; pixel++) if (matches(pixel)) { clear(pixel); removed++; }
    if (removed && channel === 1 && threshold > 0) removed += removeGreenFringe(imageData, greenHueLimit);
    if (removed) removeScreenSpill(imageData, color);
    return removed;
  }
  // Only remove matching pixels connected to an edge, protecting enclosed subject details.
  const visited = new Uint8Array(count), queue = new Int32Array(count);
  let head = 0, tail = 0;
  const visit = (pixel) => {
    if (visited[pixel]) return;
    visited[pixel] = 1;
    if (matches(pixel)) queue[tail++] = pixel;
  };
  for (let x = 0; x < width; x++) { visit(x); visit((height - 1) * width + x); }
  for (let y = 0; y < height; y++) { visit(y * width); visit(y * width + width - 1); }
  while (head < tail) {
    const pixel = queue[head++];
    clear(pixel); removed++;
    if (pixel % width) visit(pixel - 1);
    if (pixel % width < width - 1) visit(pixel + 1);
    if (pixel >= width) visit(pixel - width);
    if (pixel < count - width) visit(pixel + width);
  }
  if (removed) removeScreenSpill(imageData, color);
  return removed;
}

function matchesGreenScreen(r, g, b, threshold, cyanGreenScreen = false) {
  if (g <= r || g <= b) return false;
  const hue = colorHue(r, g, b);
  if (hue < 75 || hue >= 180) return false;
  const saturation = (g - Math.min(r, b)) / g;
  const tolerance = Math.min(1, threshold / 255);
  if (hue <= (cyanGreenScreen ? 160 : 150)) {
    // Chroma rather than distance from one RGB sample handles pale green,
    // shadows and uneven lighting without treating low-chroma hair as green.
    return saturation >= .30 - .18 * tolerance &&
      g - Math.max(r, b) >= Math.max(8, 24 - threshold * .06);
  }
  // Saturated green-cyan effects can lie beyond the old 24-degree key range.
  // Pastel teal clothing shares that hue but is much less saturated.
  return saturation >= .56 - .06 * tolerance && g - r >= 35 && g - b >= 2;
}

function removeGreenFringe(imageData, hueLimit = 184) {
  const { data, width, height } = imageData;
  const transparent = new Uint8Array(width * height);
  for (let pixel = 0; pixel < transparent.length; pixel++) transparent[pixel] = data[pixel * 4 + 3] < 128;
  let removed = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const pixel = y * width + x, offset = pixel * 4;
      if (transparent[pixel]) continue;
      const r = data[offset], g = data[offset + 1], b = data[offset + 2];
      if (g < r + 6 || g < b - 6) continue;
      const hue = colorHue(r, g, b), saturation = (Math.max(r, g, b) - Math.min(r, g, b)) / Math.max(r, g, b);
      if (hue < 75 || hue > hueLimit || saturation < (hue <= 150 ? .10 : .20)) continue;
      const weakCyan = hue > 150 && saturation < .40;
      let touchesBackground = false;
      for (let dy = -2; dy <= 2 && !touchesBackground; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          if (dx * dx + dy * dy > 4) continue;
          const nx = x + dx, ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < width && ny < height && transparent[ny * width + nx]) {
            if (weakCyan) {
              // A weak cyan rim is only background when it borders a removed
              // green-cyan effect, not a plain green screen next to teal fabric.
              const neighbor = (ny * width + nx) * 4;
              const nr = data[neighbor], ng = data[neighbor + 1], nb = data[neighbor + 2];
              const neighborHue = colorHue(nr, ng, nb);
              if (ng <= nr || ng < nb - 6 || neighborHue < 150 || neighborHue > 184) continue;
            }
            touchesBackground = true; break;
          }
        }
      }
      if (touchesBackground && weakCyan) {
        // A thin cyan compression rim has background on opposing sides. A
        // broad pastel shirt at the silhouette has background on one side
        // only and must not be erased just because its hue resembles the rim.
        touchesBackground = [[1, 0], [0, 1], [1, 1], [1, -1]].some(([dx, dy]) => {
          let positive = false, negative = false;
          for (let distance = 1; distance <= 2; distance++) {
            const px = x + dx * distance, py = y + dy * distance;
            const nx = x - dx * distance, ny = y - dy * distance;
            if (px >= 0 && py >= 0 && px < width && py < height && transparent[py * width + px]) positive = true;
            if (nx >= 0 && ny >= 0 && nx < width && ny < height && transparent[ny * width + nx]) negative = true;
          }
          return positive && negative;
        });
      }
      // Read the original mask so this pass cannot cascade into the subject.
      if (touchesBackground) { data[offset + 3] = 0; removed++; }
    }
  }
  return removed;
}

function removeScreenSpill(imageData, background) {
  // Only neutralize low-chroma spill on retained foreground edges. Background
  // and green effects have already been made transparent, never painted gray.
  const dominant = screenChannel(background);
  if (dominant === -1) return;
  const { data, width, height } = imageData;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;
      if (data[offset + 3] < 128) continue;
      let touchesBackground = false;
      for (let dy = -2; dy <= 2 && !touchesBackground; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          if (dx * dx + dy * dy > 4) continue;
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          if (data[(ny * width + nx) * 4 + 3] < 128) { touchesBackground = true; break; }
        }
      }
      if (!touchesBackground) continue;
      const neutral = dominant === 1 ? Math.max(data[offset], data[offset + 2]) : Math.max(data[offset], data[offset + 1]);
      if (data[offset + dominant] > neutral) data[offset + dominant] = neutral;
    }
  }
}

async function seekTo(time, signal) {
  if (signal.aborted) throw abortError();
  if (Math.abs(video.currentTime - time) < .0001 && video.readyState >= 2 && !video.seeking) return;
  const seeking = waitForMedia('seeked', signal);
  video.currentTime = time;
  await seeking;
}

function gifFrameDelay(frame, fps, duration) {
  // GIF stores centiseconds. Distribute rounding across the timeline rather
  // than rounding every 33.33ms frame to 30ms and speeding up the whole video.
  const start = Math.round(frame / fps * 100);
  const end = Math.round(Math.min((frame + 1) / fps, duration) * 100);
  return Math.max(1, end - start) * 10;
}

function renderGif(gif, signal) {
  return new Promise((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); signal.removeEventListener('abort', aborted); };
    const failed = () => { cleanup(); reject(new Error('GIF 编码失败，请降低画质或重新加载页面。')); };
    const aborted = () => { cleanup(); gif.abort(); reject(abortError()); };
    const timer = setTimeout(() => { gif.abort(); failed(); }, 180000);
    gif.on('finished', blob => { cleanup(); resolve(blob); });
    gif.on('progress', amount => updateProgress('正在生成 GIF', 50 + amount * 50, '正在编码动图，很快就好'));
    signal.addEventListener('abort', aborted, { once: true });
    if (signal.aborted) return aborted();
    try {
      gif.render();
      [...gif.activeWorkers, ...gif.freeWorkers].forEach(worker => worker.addEventListener('error', failed, { once: true }));
    } catch (error) { cleanup(); reject(error); }
  });
}

async function startConversion(force = false) {
  if (state.busy || state.loading) return;
  if (state.result && !state.result.demo && !force) return openSave();
  if (!state.file) return setError('请先选择视频。');
  const duration = state.duration;
  const fps = Number($('fps').value), scale = Number($('scale').value);
  const width = Math.max(1, Math.round(video.videoWidth * scale)), height = Math.max(1, Math.round(video.videoHeight * scale));
  const frames = Math.max(1, Math.ceil(duration * fps));
  clearResult(); setError(); stopPicking(); video.pause();
  const controller = new AbortController();
  state.controller = controller;
  setBusy(true); updateSteps(2); setPreview('original');
  updateProgress('正在读取视频帧', 0, `准备处理 ${frames} 帧`);
  canvas.width = width; canvas.height = height;
  let gif;
  try {
    gif = new GIF({
      workers: Math.min(4, navigator.hardwareConcurrency || 2), quality: Number($('quality').value),
      width, height, transparent: state.mode === 'color' ? 0 : null,
      workerScript: 'gif.worker.js?v=alpha-mask-1', dither: false, repeat: 0
    });
    state.encoder = gif;
    let background = state.color, removedPixels = 0;
    const choice = $('backgroundInput').value;
    if (choice === 'white') background = { r: 255, g: 255, b: 255 };
    if (choice === 'black') background = { r: 0, g: 0, b: 0 };
    if (choice === '#00ff00') background = { r: 0, g: 255, b: 0 };
    for (let frame = 0; frame < frames; frame++) {
      // Seek just inside the frame, not on its floating-point timestamp
      // boundary, where the decoder can return the preceding frame twice.
      const time = Math.min(frame / fps + .0001, state.duration - .0001);
      await seekTo(time, controller.signal);
      if (controller.signal.aborted) throw abortError();
      ctx.drawImage(video, 0, 0, width, height);
      if (state.mode === 'color') {
        const image = ctx.getImageData(0, 0, width, height);
        if (frame === 0 && choice === 'auto') {
          background = detectBackground(image);
          state.detectedColor = background;
          updateBackgroundHint();
        }
        removedPixels += removeBackground(image, background, Number($('thresholdInput').value), $('protectInput').checked);
        ctx.putImageData(image, 0, 0);
      }
      gif.addFrame(ctx, { copy: true, delay: gifFrameDelay(frame, fps, duration) });
      updateProgress('正在读取视频帧', (frame + 1) / frames * 50, `已处理 ${frame + 1} / ${frames} 帧`);
      // Let the UI repaint and remain cancellable even on short or single-frame clips.
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    const blob = await renderGif(gif, controller.signal);
    if (controller.signal.aborted) throw abortError();
    const url = URL.createObjectURL(blob);
    state.result = { blob, url, width, height, duration, transparent: state.mode === 'color' && removedPixels > 0, demo: false };
    showResult();
  } catch (error) {
    setError(error.name === 'AbortError' ? '制作已取消，可以调整参数后重新开始。' : '制作失败：' + error.message);
  } finally {
    [...(gif?.activeWorkers || []), ...(gif?.freeWorkers || [])].forEach(worker => worker.terminate());
    state.encoder = null; state.controller = null; setBusy(false);
    if (!state.result) updateSteps(2);
  }
}
$('convertButton').onclick = () => startConversion();
$('cancelButton').onclick = () => { state.controller?.abort(); };
$('regenerateButton').onclick = () => {
  if (state.result?.demo) { openFilePicker(); return; }
  startConversion(true);
};

function showResult() {
  const result = state.result;
  $('gifPreview').src = result.url;
  $('gifPreview').alt = result.demo ? '透明背景 GIF 示例动图' : '根据所选视频制作的 GIF 动图';
  $('resultBadge').textContent = result.demo ? '示例动图' : result.transparent ? '透明 GIF 已生成' : 'GIF 已生成';
  $('resultDimensions').textContent = `${result.width}×${result.height} · ${result.duration.toFixed(2)} 秒${result.fps ? ` · ${result.fps} fps · ${result.frames} 帧` : ''}`;
  $('resultSize').textContent = fileSize(result.blob.size);
  $('resultInfo').hidden = false; $('resultActions').hidden = false;
  $('previewNote').textContent = !result.demo && state.mode === 'color' && !result.transparent ?
    '未检测到可移除的背景，请调整背景颜色与容差后重新制作。' :
    '棋盘格仅用于展示透明区域，不会出现在导出的 GIF 中。';
  setPreview('gif');
  if (!result.demo) updateSteps(3);
}

function openSave() {
  if (!state.result) return;
  const result = state.result;
  $('saveImage').src = result.url;
  $('downloadLink').href = result.url;
  const base = result.demo ? 'framekit-example' : state.file.name.replace(/\.[^.]+$/, '');
  $('downloadLink').download = base + '.gif';
  $('saveGuide').textContent = /iPhone|iPad|iPod/.test(navigator.userAgent) ?
    '长按下方动图，尝试选择“存储到照片”。下载按钮通常会先保存到“文件”。' :
    '长按下方动图尝试保存图片，或点击“下载 GIF”保存到设备。';
  $('wechatNotice').hidden = !/MicroMessenger/i.test(navigator.userAgent);
  const shareFile = new File([result.blob], base + '.gif', { type: 'image/gif' });
  let canShare = false;
  try { canShare = !!(navigator.share && navigator.canShare?.({ files: [shareFile] })); } catch {}
  $('shareButton').disabled = !canShare;
  $('saveMessage').textContent = canShare ? '可以使用系统分享菜单选择保存位置。' : '此浏览器暂不支持文件分享，请使用长按图片或下载文件。';
  $('saveDialog').showModal();
}
$('saveButton').onclick = openSave;
$('downloadLink').onclick = () => { $('saveMessage').textContent = '已发起下载，请在浏览器下载列表或“文件”中确认。'; };
$('shareButton').onclick = async () => {
  if (!state.result) return;
  try {
    await navigator.share({ files: [new File([state.result.blob], 'framekit.gif', { type: 'image/gif' })], title: '我的 GIF' });
    $('saveMessage').textContent = '分享操作已结束，请在所选应用中确认保存结果。';
  } catch (error) {
    if (error.name !== 'AbortError') $('saveMessage').textContent = '分享未完成，请长按图片或下载 GIF。';
  }
};
$('helpButton').onclick = () => $('helpDialog').showModal();
document.querySelectorAll('[data-close-dialog]').forEach(button => button.onclick = () => button.closest('dialog').close());
document.querySelectorAll('dialog').forEach(dialog => dialog.addEventListener('click', event => {
  if (event.target !== dialog) return;
  const rect = dialog.getBoundingClientRect();
  if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
}));
$('demoButton').onclick = async () => {
  if (state.busy) return;
  $('demoButton').disabled = true;
  try {
    const response = await fetch('assets/demo.gif');
    if (!response.ok) throw new Error('示例暂不可用，请刷新页面重试。');
    const blob = await response.blob();
    clearResult();
    state.result = { blob, url: 'assets/demo.gif', width: 480, height: 480, duration: 10.47, transparent: true, demo: true };
    showResult(); setError(); setBusy(false);
  } catch (error) { setError(error.message); }
  finally { $('demoButton').disabled = false; }
};

// Local, generated previews can be opened in the normal editor without
// replacing the bundled example or changing the default conversion settings.
async function loadLocalPreview() {
  const path = new URLSearchParams(location.search).get('preview');
  if (!path) return;
  const revision = state.revision;
  const directory = new URL('outputs/', document.baseURI);
  const localUrl = (value, base, extension) => {
    if (typeof value !== 'string') throw new Error('预览文件路径无效。');
    const url = new URL(value, base);
    if (url.origin !== directory.origin || !url.pathname.startsWith(directory.pathname) || !url.pathname.endsWith(extension)) {
      throw new Error('仅支持本项目 outputs 目录内的预览文件。');
    }
    return url;
  };
  const read = async (url, json = false) => {
    const response = await fetch(url, { cache: 'no-cache' });
    if (!response.ok) throw new Error('预览文件暂不可用，请确认本地动画已生成。');
    return json ? response.json() : response.blob();
  };
  try {
    const manifestUrl = localUrl(path, document.baseURI, '.json');
    const preview = await read(manifestUrl, true);
    if (!Number.isInteger(preview.fps) || preview.fps < 5 || preview.fps > 30 ||
        !Number.isInteger(preview.frames) || preview.frames < 1 ||
        !Number.isFinite(preview.duration) || preview.duration <= 0 ||
        Math.abs(preview.frames / preview.fps - preview.duration) > .01) {
      throw new Error('动画预览的帧率或时长信息无效。');
    }
    const sourceUrl = localUrl(preview.video, manifestUrl, '.mp4');
    const gifUrl = localUrl(preview.gif, manifestUrl, '.gif');
    const [source, blob] = await Promise.all([read(sourceUrl), read(gifUrl)]);
    if (state.revision !== revision || state.file || state.busy) return;
    const file = new File([source], sourceUrl.pathname.split('/').pop(), { type: 'video/mp4' });
    await chooseFile(file);
    if (state.file !== file || state.loading || state.busy || state.revision !== revision + 1) return;
    if (Math.abs(state.duration - preview.duration) > .05) throw new Error('预览动画与原视频时长不一致。');
    $('fps').value = String(preview.fps);
    $('scale').value = '1';
    updateRangeLabels();
    state.result = {
      blob, url: URL.createObjectURL(blob), width: video.videoWidth, height: video.videoHeight,
      duration: preview.duration, fps: preview.fps, frames: preview.frames, transparent: true, demo: false
    };
    showResult(); setError(); setBusy(false);
  } catch (error) {
    if (state.revision === revision || state.revision === revision + 1) setError(error.message);
  }
}

// Optional design controls stay hidden in the finished interface.
window.addEventListener('message', event => {
  if (event.source !== window.parent) return;
  if (event.data?.type === '__activate_edit_mode') $('tweaksPanel').hidden = false;
  if (event.data?.type === '__deactivate_edit_mode') $('tweaksPanel').hidden = true;
});
window.parent.postMessage({ type: '__edit_mode_available' }, '*');
function applyTweaks(edits) {
  if (edits.primaryColor) {
    document.documentElement.style.setProperty('--c-accent', edits.primaryColor);
    document.documentElement.style.setProperty('--c-accent-soft', edits.primaryColor + '12');
    $('accentTweak').value = edits.primaryColor;
  }
  if (edits.fontSize) document.documentElement.style.fontSize = edits.fontSize + 'px';
  window.parent.postMessage({ type: '__edit_mode_set_keys', edits }, '*');
}
$('themeTweak').onchange = () => applyTweaks({ primaryColor: $('themeTweak').value, variant: $('themeTweak').value });
$('accentTweak').oninput = () => applyTweaks({ primaryColor: $('accentTweak').value });
$('sizeTweak').oninput = () => applyTweaks({ fontSize: Number($('sizeTweak').value) });
window.addEventListener('beforeunload', () => {
  state.controller?.abort();
  if (state.sourceUrl) URL.revokeObjectURL(state.sourceUrl);
  if (state.result?.url?.startsWith('blob:')) URL.revokeObjectURL(state.result.url);
});
updateRangeLabels();
updateBackgroundHint();
updateSteps(1);
setBusy(false);
loadLocalPreview();
