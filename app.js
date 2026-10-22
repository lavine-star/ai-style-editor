// 全局变量
let videoFile = null;
let videoElement = null;
let gifBlob = null;
let bgColor = { r: 255, g: 255, b: 255 }; // 默认白色背景

// DOM 元素
const uploadArea = document.getElementById('uploadArea');
const fileInput = document.getElementById('fileInput');
const controls = document.getElementById('controls');
const previewArea = document.getElementById('previewArea');
const videoPreview = document.getElementById('videoPreview');
const convertBtn = document.getElementById('convertBtn');
const resetBtn = document.getElementById('resetBtn');
const progress = document.getElementById('progress');
const progressFill = document.getElementById('progressFill');
const gifPreview = document.getElementById('gifPreview');
const gifImage = document.getElementById('gifImage');
const downloadBtn = document.getElementById('downloadBtn');
const errorDiv = document.getElementById('error');
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d', { willReadFrequently: true });
const pickCanvas = document.getElementById('pickCanvas');
const pickCtx = pickCanvas.getContext('2d', { willReadFrequently: true });
const colorPicker = document.getElementById('colorPicker');
const colorR = document.getElementById('colorR');
const colorG = document.getElementById('colorG');
const colorB = document.getElementById('colorB');
const colorPreview = document.getElementById('colorPreview');
const colorValue = document.getElementById('colorValue');
const presetHighQuality = document.getElementById('presetHighQuality');
const presetBalanced = document.getElementById('presetBalanced');
const presetSmallSize = document.getElementById('presetSmallSize');

// 范围滑块值更新
const fpsInput = document.getElementById('fps');
const fpsValue = document.getElementById('fpsValue');
const qualityInput = document.getElementById('quality');
const qualityValue = document.getElementById('qualityValue');
const scaleInput = document.getElementById('scale');
const scaleValue = document.getElementById('scaleValue');
const thresholdInput = document.getElementById('threshold');
const thresholdValue = document.getElementById('thresholdValue');

// 更新滑块显示值
fpsInput.addEventListener('input', (e) => {
    fpsValue.textContent = e.target.value;
});

qualityInput.addEventListener('input', (e) => {
    qualityValue.textContent = e.target.value;
});

scaleInput.addEventListener('input', (e) => {
    scaleValue.textContent = e.target.value;
});

thresholdInput.addEventListener('input', (e) => {
    thresholdValue.textContent = e.target.value;
});

// 预设模式
presetHighQuality.addEventListener('click', () => {
    fpsInput.value = 30;
    fpsValue.textContent = '30';
    qualityInput.value = 1;
    qualityValue.textContent = '1';
    scaleInput.value = 1.0;
    scaleValue.textContent = '1';
    thresholdInput.value = 30;
    thresholdValue.textContent = '30';
});

presetBalanced.addEventListener('click', () => {
    fpsInput.value = 15;
    fpsValue.textContent = '15';
    qualityInput.value = 10;
    qualityValue.textContent = '10';
    scaleInput.value = 0.7;
    scaleValue.textContent = '0.7';
    thresholdInput.value = 30;
    thresholdValue.textContent = '30';
});

presetSmallSize.addEventListener('click', () => {
    fpsInput.value = 10;
    fpsValue.textContent = '10';
    qualityInput.value = 20;
    qualityValue.textContent = '20';
    scaleInput.value = 0.4;
    scaleValue.textContent = '0.4';
    thresholdInput.value = 30;
    thresholdValue.textContent = '30';
});

// 颜色选择器功能
colorPicker.addEventListener('input', (e) => {
    const hex = e.target.value;
    const r = parseInt(hex.substr(1, 2), 16);
    const g = parseInt(hex.substr(3, 2), 16);
    const b = parseInt(hex.substr(5, 2), 16);

    updateColor(r, g, b);
});

// RGB 输入框
colorR.addEventListener('input', () => updateColorFromInputs());
colorG.addEventListener('input', () => updateColorFromInputs());
colorB.addEventListener('input', () => updateColorFromInputs());

function updateColorFromInputs() {
    const r = Math.max(0, Math.min(255, parseInt(colorR.value) || 0));
    const g = Math.max(0, Math.min(255, parseInt(colorG.value) || 0));
    const b = Math.max(0, Math.min(255, parseInt(colorB.value) || 0));

    updateColor(r, g, b);
}

function updateColor(r, g, b) {
    bgColor = { r, g, b };

    // 更新所有UI元素
    colorR.value = r;
    colorG.value = g;
    colorB.value = b;

    const hex = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
    colorPicker.value = hex;
    colorPreview.style.background = hex;
    colorValue.textContent = `RGB(${r}, ${g}, ${b})`;
}

// 文件上传处理
uploadArea.addEventListener('click', () => {
    fileInput.click();
});

uploadArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadArea.classList.add('dragover');
});

uploadArea.addEventListener('dragleave', () => {
    uploadArea.classList.remove('dragover');
});

uploadArea.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadArea.classList.remove('dragover');
    const files = e.dataTransfer.files;
    if (files.length > 0) {
        handleFile(files[0]);
    }
});

fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
        handleFile(e.target.files[0]);
    }
});

// 处理上传的文件
function handleFile(file) {
    if (!file.type.startsWith('video/')) {
        showError('请上传有效的视频文件！');
        return;
    }

    hideError();
    videoFile = file;

    // 显示视频预览
    const url = URL.createObjectURL(file);
    videoPreview.src = url;
    videoElement = videoPreview;

    controls.classList.add('active');
    previewArea.classList.add('active');
    gifPreview.classList.remove('active');
}

// 开始转换
convertBtn.addEventListener('click', async () => {
    if (!videoFile) {
        showError('请先上传视频文件！');
        return;
    }

    hideError();
    convertBtn.disabled = true;
    progress.classList.add('active');

    try {
        await convertVideoToGif();
        showSuccess();
    } catch (error) {
        showError('转换失败：' + error.message);
        console.error(error);
    } finally {
        convertBtn.disabled = false;
    }
});

// 视频转 GIF 核心函数
async function convertVideoToGif() {
    const fps = parseInt(fpsInput.value);
    const quality = parseInt(qualityInput.value);
    const scale = parseFloat(scaleInput.value);
    const threshold = parseInt(thresholdInput.value);

    return new Promise((resolve, reject) => {
        // 确保视频已加载
        videoElement.currentTime = 0;

        videoElement.addEventListener('loadeddata', async function processVideo() {
            try {
                const duration = videoElement.duration;
                const width = Math.floor(videoElement.videoWidth * scale);
                const height = Math.floor(videoElement.videoHeight * scale);

                canvas.width = width;
                canvas.height = height;

                // 初始化 GIF 编码器（无损高质量设置）
                const gif = new GIF({
                    workers: 8, // 增加 Worker 数量，加快处理速度
                    quality: quality, // 使用最高质量
                    width: width,
                    height: height,
                    transparent: 0x00FF00, // 使用绿色作为透明色键
                    workerScript: 'gif.worker.js',
                    dither: false // 关闭抖动，保持原始质量
                });

                // 计算帧间隔
                const frameDelay = 1000 / fps;
                const totalFrames = Math.floor(duration * fps);
                let currentFrame = 0;

                // 捕获帧
                async function captureFrame() {
                    if (currentFrame >= totalFrames) {
                        // 完成捕获，开始渲染
                        gif.render();
                        return;
                    }

                    const time = currentFrame / fps;
                    videoElement.currentTime = time;

                    await new Promise(resolve => {
                        videoElement.addEventListener('seeked', function onSeeked() {
                            videoElement.removeEventListener('seeked', onSeeked);

                            // 绘制视频帧到 canvas
                            ctx.drawImage(videoElement, 0, 0, width, height);

                            // 获取图像数据并处理透明度
                            const imageData = ctx.getImageData(0, 0, width, height);
                            removeBackground(imageData, threshold);
                            ctx.putImageData(imageData, 0, 0);

                            // 添加帧到 GIF
                            gif.addFrame(canvas, {
                                copy: true,
                                delay: frameDelay
                            });

                            currentFrame++;
                            const progressPercent = Math.round((currentFrame / totalFrames) * 50);
                            updateProgress(progressPercent, '正在捕获视频帧...');

                            resolve();
                        });
                    });

                    // 继续下一帧
                    setTimeout(captureFrame, 0);
                }

                // GIF 渲染完成事件
                gif.on('finished', (blob) => {
                    gifBlob = blob;
                    const url = URL.createObjectURL(blob);
                    gifImage.src = url;
                    gifPreview.classList.add('active');
                    progress.classList.remove('active');
                    resolve();
                });

                // GIF 渲染进度
                gif.on('progress', (p) => {
                    const progressPercent = Math.round(50 + p * 50);
                    updateProgress(progressPercent, '正在生成 GIF...');
                });

                // 开始捕获
                captureFrame();

            } catch (error) {
                reject(error);
            }
        }, { once: true });

        // 触发视频加载
        videoElement.load();
    });
}

// 背景移除算法（基于色度键控）
function removeBackground(imageData, threshold) {
    const data = imageData.data;

    // 使用用户选择的背景色
    const bgR = bgColor.r;
    const bgG = bgColor.g;
    const bgB = bgColor.b;

    // 透明色键：绿色 RGB(0, 255, 0)
    const transparentR = 0;
    const transparentG = 255;
    const transparentB = 0;

    for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];

        // 计算与背景色的差异
        const diff = Math.sqrt(
            Math.pow(r - bgR, 2) +
            Math.pow(g - bgG, 2) +
            Math.pow(b - bgB, 2)
        );

        // 如果差异小于阈值，替换为透明色键
        if (diff < threshold) {
            data[i] = transparentR;     // R
            data[i + 1] = transparentG; // G
            data[i + 2] = transparentB; // B
            data[i + 3] = 255;          // Alpha 保持不透明（GIF.js 会通过颜色识别）
        }
    }
}

// 更新进度条
function updateProgress(percent, text) {
    progressFill.style.width = percent + '%';
    progressFill.textContent = text + ' ' + percent + '%';
}

// 下载 GIF
downloadBtn.addEventListener('click', () => {
    if (!gifBlob) return;

    const url = URL.createObjectURL(gifBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'transparent-video-' + Date.now() + '.gif';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
});

// 重置
resetBtn.addEventListener('click', () => {
    videoFile = null;
    gifBlob = null;
    bgColor = { r: 255, g: 255, b: 255 };
    fileInput.value = '';
    videoPreview.src = '';
    gifImage.src = '';
    colorPreview.style.background = '#fff';
    colorValue.textContent = 'RGB(255, 255, 255)';
    colorPicker.value = '#ffffff';
    colorR.value = 255;
    colorG.value = 255;
    colorB.value = 255;
    controls.classList.remove('active');
    previewArea.classList.remove('active');
    gifPreview.classList.remove('active');
    progress.classList.remove('active');
    hideError();
});

// 错误提示
function showError(message) {
    errorDiv.textContent = message;
    errorDiv.classList.add('active');
}

function hideError() {
    errorDiv.classList.remove('active');
}

function showSuccess() {
    // 可以添加成功提示
    console.log('转换成功！');
}
