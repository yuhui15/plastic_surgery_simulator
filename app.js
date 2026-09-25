const canvas = document.querySelector("#faceCanvas");
const ctx = canvas.getContext("2d", { willReadFrequently: true });
const stage = document.querySelector("#canvasStage");
const emptyState = document.querySelector("#emptyState");
const imageInput = document.querySelector("#imageInput");
const pointStatus = document.querySelector("#pointStatus");
const canvasHint = document.querySelector("#canvasHint");
const imageDimensions = document.querySelector("#imageDimensions");
const ratioControl = document.querySelector("#ratioControl");
const ratioValue = document.querySelector("#ratioValue");
const ratioOutput = document.querySelector("#ratioOutput");
const pupilRatioControl = document.querySelector("#pupilRatioControl");
const pupilRatioValue = document.querySelector("#pupilRatioValue");
const pupilRatioOutput = document.querySelector("#pupilRatioOutput");
const pointInstruction = document.querySelector("#pointInstruction");
const undoButton = document.querySelector("#undoButton");
const resetButton = document.querySelector("#resetButton");
const exportButton = document.querySelector("#exportButton");
const clearPointButton = document.querySelector("#clearPointButton");
const pointVisibility = document.querySelector("#pointVisibility");

let originalImageData = null;
let currentImageData = null;
let history = [];
let points = [];
let originalPoints = [];
let ratioSnapshotAdded = false;
let pupilRatioSnapshotAdded = false;
let showPoints = true;
const pointNames = ["发际线", "下巴端点", "左颧骨", "右颧骨", "左瞳仁", "右瞳仁"];

const cloneImageData = (data) => (
  new ImageData(new Uint8ClampedArray(data.data), data.width, data.height)
);

const updateButtons = () => {
  const ready = Boolean(currentImageData);
  undoButton.disabled = !ready || history.length === 0;
  resetButton.disabled = !ready;
  exportButton.disabled = !ready;
  clearPointButton.disabled = !ready || points.length === 0;
  ratioControl.disabled = points.length !== 6;
  pupilRatioControl.disabled = points.length !== 6;
};

const render = () => {
  if (!currentImageData) return;
  ctx.putImageData(currentImageData, 0, 0);
  if (points.length === 0 || !showPoints) return;
  const scale = canvas.width / canvas.getBoundingClientRect().width;
  ctx.save();
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = Math.max(2, 2 * scale);
  points.forEach((item, index) => {
    ctx.fillStyle = "#287865";
    ctx.beginPath();
    ctx.arc(item.x, item.y, 4.5 * scale, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#fff";
    ctx.stroke();
    ctx.fillStyle = "#fff";
    ctx.font = `700 ${7 * scale}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(pointNames[index], item.x, item.y);
  });
  ctx.restore();
};

const canvasPosition = (event) => {
  const bounds = canvas.getBoundingClientRect();
  return {
    x: (event.clientX - bounds.left) * (canvas.width / bounds.width),
    y: (event.clientY - bounds.top) * (canvas.height / bounds.height),
  };
};

const sampleBilinear = (source, x, y, channel) => {
  const left = Math.floor(Math.max(0, Math.min(source.width - 1, x)));
  const top = Math.floor(Math.max(0, Math.min(source.height - 1, y)));
  const right = Math.min(source.width - 1, left + 1);
  const bottom = Math.min(source.height - 1, top + 1);
  const xWeight = x - left;
  const yWeight = y - top;
  const topLeft = source.data[(top * source.width + left) * 4 + channel];
  const topRight = source.data[(top * source.width + right) * 4 + channel];
  const bottomLeft = source.data[(bottom * source.width + left) * 4 + channel];
  const bottomRight = source.data[(bottom * source.width + right) * 4 + channel];
  return (topLeft + (topRight - topLeft) * xWeight)
    + ((bottomLeft + (bottomRight - bottomLeft) * xWeight)
      - (topLeft + (topRight - topLeft) * xWeight)) * yWeight;
};

const applyTransforms = () => {
  if (!originalImageData || originalPoints.length !== 6) return;
  const source = originalImageData;
  const facePoints = originalPoints.slice(0, 4);
  const pupilPoints = originalPoints.slice(4, 6);
  const left = Math.max(0, Math.floor(Math.min(...facePoints.map((item) => item.x))));
  const right = Math.min(source.width - 1, Math.ceil(Math.max(...facePoints.map((item) => item.x))));
  const top = Math.max(0, Math.floor(Math.min(...facePoints.map((item) => item.y))));
  const bottom = Math.min(source.height - 1, Math.ceil(Math.max(...facePoints.map((item) => item.y))));
  const centerX = (left + right) / 2;
  const centerY = (top + bottom) / 2;
  const originalRatio = (bottom - top) / Math.max(1, right - left);
  const ratioScale = Number(ratioControl.value) / originalRatio;
  const horizontalScale = 1 / ratioScale;
  const originalFaceWidth = Math.max(1, right - left);
  const result = cloneImageData(source);
  const feather = Math.max(28, Math.min(source.width, source.height) * 0.16);
  const smoothStep = (value) => {
    const clamped = Math.max(0, Math.min(1, value));
    return clamped * clamped * (3 - 2 * clamped);
  };
  const outsideDistance = (x, y) => Math.max(
    left - x,
    x - right,
    top - y,
    y - bottom,
    0,
  );

  for (let y = 0; y < source.height; y += 1) {
    for (let x = 0; x < source.width; x += 1) {
      const pupilProtectionRadius = Math.max(10, originalFaceWidth * 0.035);
      const inPupilProtectionZone = pupilPoints.some((item) => (
        Math.hypot(x - item.x, y - item.y) <= pupilProtectionRadius
      ));
      if (inPupilProtectionZone) continue;
      const influence = smoothStep(1 - outsideDistance(x, y) / feather);
      if (influence <= 0) continue;
      const targetX = centerX + (x - centerX) / horizontalScale;
      const targetY = y;
      const sourceX = x + (targetX - x) * influence;
      const sourceY = y + (targetY - y) * influence;
      const targetIndex = (y * source.width + x) * 4;
      for (let channel = 0; channel < 4; channel += 1) {
        result.data[targetIndex + channel] = sampleBilinear(source, sourceX, sourceY, channel);
      }
    }
  }
  const originalPupilDistance = Math.abs(pupilPoints[1].x - pupilPoints[0].x);
  const pupilRatio = Number(pupilRatioControl.value);
  const pupilScale = (pupilRatio * originalFaceWidth) / Math.max(1, originalPupilDistance);
  const pupilCenter = (pupilPoints[0].x + pupilPoints[1].x) / 2;
  const pupilFeather = Math.max(18, originalFaceWidth * 0.12);
  const pupilInfluence = (x, y) => {
    const distance = Math.min(
      Math.hypot(x - pupilPoints[0].x, y - pupilPoints[0].y),
      Math.hypot(x - pupilPoints[1].x, y - pupilPoints[1].y),
    );
    const value = Math.max(0, Math.min(1, 1 - distance / pupilFeather));
    return value * value * (3 - 2 * value);
  };
  if (pupilPoints[0].x !== pupilPoints[1].x) {
    const pupilSource = cloneImageData(result);
    for (let y = 0; y < source.height; y += 1) {
      for (let x = 0; x < source.width; x += 1) {
        const influence = pupilInfluence(x, y);
        if (influence <= 0) continue;
        const pupilX = pupilCenter + (x - pupilCenter) / pupilScale;
        const sampleX = x + (pupilX - x) * influence;
        const targetIndex = (y * source.width + x) * 4;
        for (let channel = 0; channel < 4; channel += 1) {
          result.data[targetIndex + channel] = sampleBilinear(pupilSource, sampleX, y, channel);
        }
      }
    }
  }
  currentImageData = result;
  points = [
    ...facePoints.map((item) => ({
    x: centerX + (item.x - centerX) * horizontalScale,
    y: item.y,
    })),
    ...pupilPoints.map((item) => ({
      x: pupilCenter + (item.x - pupilCenter) * pupilScale,
      y: item.y,
    })),
  ];
  render();
  ratioValue.textContent = Number(ratioControl.value).toFixed(2);
  ratioOutput.textContent = Number(ratioControl.value).toFixed(2);
  pupilRatioValue.textContent = Number(pupilRatioControl.value).toFixed(2);
  pupilRatioOutput.textContent = Number(pupilRatioControl.value).toFixed(2);
};

const updatePointInstruction = () => {
  if (points.length < 6) {
    pointInstruction.textContent = `依次点击：${pointNames.join("、")}（${points.length}/6）。`;
    canvasHint.textContent = `请标记第 ${points.length + 1} 个点`;
    pointStatus.innerHTML = `<span class="status-dot${points.length ? "" : " muted"}"></span>已标记 ${points.length}/6 个点${points.length ? ` · 下一个：${pointNames[points.length]}` : ""}`;
  } else {
    pointInstruction.textContent = "六个点已确定，现在可以分别调整面部长宽比和瞳距面宽比。";
    canvasHint.textContent = "拖动下方滑杆改变面部比例";
    pointStatus.innerHTML = '<span class="status-dot"></span>六个点已锁定';
  }
  updateButtons();
};

const loadImage = (file) => {
  if (!file || !file.type.startsWith("image/")) return;
  const url = URL.createObjectURL(file);
  const nextImage = new Image();
  nextImage.onload = () => {
    const scale = Math.min(1, 1200 / Math.max(nextImage.naturalWidth, nextImage.naturalHeight));
    canvas.width = Math.round(nextImage.naturalWidth * scale);
    canvas.height = Math.round(nextImage.naturalHeight * scale);
    ctx.drawImage(nextImage, 0, 0, canvas.width, canvas.height);
    originalImageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    currentImageData = cloneImageData(originalImageData);
    history = [];
    points = [];
    originalPoints = [];
    ratioSnapshotAdded = false;
    pupilRatioSnapshotAdded = false;
    emptyState.hidden = true;
    imageDimensions.textContent = `${nextImage.naturalWidth} × ${nextImage.naturalHeight}`;
    updatePointInstruction();
    render();
    URL.revokeObjectURL(url);
  };
  nextImage.src = url;
};

imageInput.addEventListener("change", (event) => loadImage(event.target.files[0]));
ratioControl.addEventListener("input", () => {
  if (points.length !== 6) return;
  if (!ratioSnapshotAdded) {
    history.push(cloneImageData(currentImageData));
    ratioSnapshotAdded = true;
  }
  applyTransforms();
  undoButton.disabled = false;
});

pointVisibility.addEventListener("change", () => {
  showPoints = pointVisibility.checked;
  render();
});

pupilRatioControl.addEventListener("input", () => {
  if (points.length !== 6) return;
  if (!pupilRatioSnapshotAdded) {
    history.push(cloneImageData(currentImageData));
    pupilRatioSnapshotAdded = true;
  }
  applyTransforms();
  undoButton.disabled = false;
});

canvas.addEventListener("pointerdown", (event) => {
  if (!currentImageData || points.length >= 6) return;
  points.push(canvasPosition(event));
  if (points.length === 6) {
    originalPoints = points.map((item) => ({ ...item }));
    const facePoints = originalPoints.slice(0, 4);
    const left = Math.min(...facePoints.map((item) => item.x));
    const right = Math.max(...facePoints.map((item) => item.x));
    const top = Math.min(...facePoints.map((item) => item.y));
    const bottom = Math.max(...facePoints.map((item) => item.y));
    const originalRatio = (bottom - top) / Math.max(1, right - left);
    ratioControl.min = Math.max(0.1, originalRatio * 0.7).toFixed(2);
    ratioControl.max = Math.min(3, originalRatio * 1.35).toFixed(2);
    ratioControl.value = originalRatio.toFixed(2);
    ratioValue.textContent = originalRatio.toFixed(2);
    ratioOutput.textContent = originalRatio.toFixed(2);
    const pupilRatio = Math.abs(originalPoints[5].x - originalPoints[4].x) / Math.max(1, right - left);
    pupilRatioControl.min = Math.max(0.1, pupilRatio * 0.7).toFixed(2);
    pupilRatioControl.max = Math.min(1, pupilRatio * 1.35).toFixed(2);
    pupilRatioControl.value = pupilRatio.toFixed(2);
    pupilRatioValue.textContent = pupilRatio.toFixed(2);
    pupilRatioOutput.textContent = pupilRatio.toFixed(2);
  }
  document.querySelector(`.feature-chip[data-feature="${pointNames[points.length - 1]}"]`)?.classList.add("active");
  render();
  updatePointInstruction();
});

document.querySelectorAll(".feature-chip").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".feature-chip").forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
  });
});

undoButton.addEventListener("click", () => {
  const previous = history.pop();
  if (!previous) return;
  currentImageData = previous;
  if (originalPoints.length === 6) {
    const facePoints = originalPoints.slice(0, 4);
    const left = Math.min(...facePoints.map((item) => item.x));
    const right = Math.max(...facePoints.map((item) => item.x));
    const top = Math.min(...facePoints.map((item) => item.y));
    const bottom = Math.max(...facePoints.map((item) => item.y));
    const originalRatio = (bottom - top) / Math.max(1, right - left);
    ratioControl.value = originalRatio.toFixed(2);
    ratioValue.textContent = originalRatio.toFixed(2);
    ratioOutput.textContent = originalRatio.toFixed(2);
    points = originalPoints.map((item) => ({ ...item }));
  }
  pupilRatioSnapshotAdded = false;
  render();
  updateButtons();
});

resetButton.addEventListener("click", () => {
  if (!originalImageData) return;
  currentImageData = cloneImageData(originalImageData);
  history = [];
  ratioSnapshotAdded = false;
  points = [];
  originalPoints = [];
  ratioSnapshotAdded = false;
  pupilRatioSnapshotAdded = false;
  ratioControl.value = 1;
  ratioValue.textContent = "--";
  ratioOutput.textContent = "--";
  pupilRatioControl.value = 0.5;
  pupilRatioValue.textContent = "--";
  pupilRatioOutput.textContent = "--";
  updatePointInstruction();
  render();
});

clearPointButton.addEventListener("click", () => {
  points = [];
  originalPoints = [];
  currentImageData = cloneImageData(originalImageData);
  ratioSnapshotAdded = false;
  pupilRatioSnapshotAdded = false;
  ratioControl.value = 1;
  ratioValue.textContent = "--";
  ratioOutput.textContent = "--";
  pupilRatioControl.value = 0.5;
  pupilRatioValue.textContent = "--";
  pupilRatioOutput.textContent = "--";
  updatePointInstruction();
  render();
});

exportButton.addEventListener("click", () => {
  if (!currentImageData) return;
  const output = document.createElement("canvas");
  output.width = canvas.width;
  output.height = canvas.height;
  output.getContext("2d").putImageData(currentImageData, 0, 0);
  const link = document.createElement("a");
  link.download = "faceform-ratio-preview.png";
  link.href = output.toDataURL("image/png");
  link.click();
});

stage.addEventListener("dragover", (event) => { event.preventDefault(); stage.classList.add("dragging"); });
stage.addEventListener("dragleave", () => stage.classList.remove("dragging"));
stage.addEventListener("drop", (event) => {
  event.preventDefault();
  stage.classList.remove("dragging");
  loadImage(event.dataTransfer.files[0]);
});
