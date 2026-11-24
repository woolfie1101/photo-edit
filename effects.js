// 사진관 효과 모음. 모든 효과는 픽셀 계산으로만 처리한다 (AI 재생성 없음).
// 크기 관련 값은 "긴 변 1000px 기준 단위"라서 미리보기와 저장본이 같은 느낌으로 나온다.
"use strict";

// 영상일 때 매 장면마다 바뀌는 값 (필름 입자·먼지·지직거림이 움직이게)
let FX_SEED = 0;

/* ================= 공통 도구 ================= */
function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const clamp = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const mix = (a, b, t) => a + (b - a) * t;
const smooth = (e0, e1, x) => { const t = clamp01((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t); };
const U = (c) => Math.max(c.width, c.height) / 1000;

function makeCanvas(w, h) {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h));
  return c;
}
function copyCanvas(src) { const c = makeCanvas(src.width, src.height); c.getContext("2d").drawImage(src, 0, 0); return c; }
function pixelsOf(c) {
  const ctx = c.getContext("2d", { willReadFrequently: true });
  const img = ctx.getImageData(0, 0, c.width, c.height);
  return { ctx, img, d: img.data, w: c.width, h: c.height };
}
function fitCanvas(src, maxSide) {
  const s = Math.min(1, maxSide / Math.max(src.width, src.height));
  if (s === 1) return copyCanvas(src);
  const c = makeCanvas(src.width * s, src.height * s);
  const x = c.getContext("2d"); x.imageSmoothingQuality = "high";
  x.drawImage(src, 0, 0, c.width, c.height);
  return c;
}
function resizeTo(c, w, h) {
  if (c.width === w && c.height === h) return c;
  const o = makeCanvas(w, h); const x = o.getContext("2d");
  x.imageSmoothingQuality = "high"; x.drawImage(c, 0, 0, w, h);
  return o;
}
function lumaOf(d) {
  const L = new Float32Array(d.length / 4);
  for (let i = 0, j = 0; i < d.length; i += 4, j++) L[j] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
  return L;
}
function channelsOf(d) {
  const n = d.length / 4, R = new Float32Array(n), G = new Float32Array(n), B = new Float32Array(n);
  for (let i = 0, j = 0; j < n; i += 4, j++) { R[j] = d[i]; G[j] = d[i + 1]; B[j] = d[i + 2]; }
  return [R, G, B];
}
function boxH(src, dst, w, h, r) {
  const k = 1 / (2 * r + 1);
  for (let y = 0; y < h; y++) {
    const o = y * w; let s = 0;
    for (let i = -r; i <= r; i++) s += src[o + Math.min(w - 1, Math.max(0, i))];
    for (let x = 0; x < w; x++) {
      dst[o + x] = s * k;
      s += src[o + Math.min(w - 1, x + r + 1)] - src[o + Math.max(0, x - r)];
    }
  }
}
function boxV(src, dst, w, h, r) {
  const k = 1 / (2 * r + 1);
  for (let x = 0; x < w; x++) {
    let s = 0;
    for (let i = -r; i <= r; i++) s += src[Math.min(h - 1, Math.max(0, i)) * w + x];
    for (let y = 0; y < h; y++) {
      dst[y * w + x] = s * k;
      s += src[Math.min(h - 1, y + r + 1) * w + x] - src[Math.max(0, y - r) * w + x];
    }
  }
}
// 3번 반복한 상자 흐림 ≈ 가우시안 흐림
function blur(arr, w, h, r, horizontalOnly) {
  r = Math.round(r);
  const a = Float32Array.from(arr);
  if (r < 1) return a;
  const b = new Float32Array(arr.length);
  for (let p = 0; p < 3; p++) {
    boxH(a, b, w, h, r);
    if (horizontalOnly) a.set(b); else boxV(b, a, w, h, r);
  }
  return a;
}
// 부드럽게 출렁이는 노이즈 (0~1)
function noiseField(w, h, cell, seed) {
  cell = Math.max(1, cell);
  const r = rng(seed);
  const gw = Math.ceil(w / cell) + 2, gh = Math.ceil(h / cell) + 2;
  const g = new Float32Array(gw * gh);
  for (let i = 0; i < g.length; i++) g[i] = r();
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const fy = y / cell, y0 = fy | 0; let ty = fy - y0; ty = ty * ty * (3 - 2 * ty);
    for (let x = 0; x < w; x++) {
      const fx = x / cell, x0 = fx | 0; let tx = fx - x0; tx = tx * tx * (3 - 2 * tx);
      const a = g[y0 * gw + x0], b = g[y0 * gw + x0 + 1], c = g[(y0 + 1) * gw + x0], e = g[(y0 + 1) * gw + x0 + 1];
      out[y * w + x] = a + (b - a) * tx + (c - a) * ty + (a - b - c + e) * tx * ty;
    }
  }
  return out;
}
// 칸 단위 무작위 값 (필름 입자 등)
function grainNoise(w, h, cell, seed) {
  cell = Math.max(1, cell);
  const r = rng(seed + FX_SEED * 7919);
  const gw = Math.ceil(w / cell) + 1, gh = Math.ceil(h / cell) + 1;
  const g = new Float32Array(gw * gh);
  for (let i = 0; i < g.length; i++) g[i] = r();
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = ((y / cell) | 0) * gw;
    for (let x = 0; x < w; x++) out[y * w + x] = g[row + ((x / cell) | 0)];
  }
  return out;
}
function sampleGrid(src, cols, rows) {
  const c = makeCanvas(cols, rows);
  const x = c.getContext("2d", { willReadFrequently: true });
  x.imageSmoothingEnabled = true; x.imageSmoothingQuality = "high";
  x.drawImage(src, 0, 0, c.width, c.height);
  return x.getImageData(0, 0, c.width, c.height).data;
}
function adjust(d, contrast = 1, brightness = 0, saturation = 1) {
  for (let i = 0; i < d.length; i += 4) {
    let r = (d[i] - 128) * contrast + 128 + brightness * 60;
    let g = (d[i + 1] - 128) * contrast + 128 + brightness * 60;
    let b = (d[i + 2] - 128) * contrast + 128 + brightness * 60;
    if (saturation !== 1) {
      const l = 0.299 * r + 0.587 * g + 0.114 * b;
      r = l + (r - l) * saturation; g = l + (g - l) * saturation; b = l + (b - l) * saturation;
    }
    d[i] = clamp(r); d[i + 1] = clamp(g); d[i + 2] = clamp(b);
  }
}
function rgbStr(c, f = 1) {
  const s = (v) => Math.round(clamp(f <= 1 ? v * f : v + (255 - v) * (f - 1)));
  return `rgb(${s(c[0])},${s(c[1])},${s(c[2])})`;
}
function hexToRgb(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function nearest(pal, r, g, b) {
  let best = 0, bd = Infinity;
  for (let i = 0; i < pal.length; i++) {
    const c = pal[i], dr = r - c[0], dg = g - c[1], db = b - c[2];
    const dd = 2 * dr * dr + 4 * dg * dg + 3 * db * db;
    if (dd < bd) { bd = dd; best = i; }
  }
  return best;
}
// 사진에서 대표색 k개 뽑기 (k-평균)
function extractPalette(d, k) {
  const rand = rng(7), samples = [];
  const step = Math.max(1, Math.floor(d.length / 4 / 5000));
  for (let i = 0; i < d.length; i += 4 * step) samples.push([d[i], d[i + 1], d[i + 2]]);
  let cents = [];
  for (let i = 0; i < k; i++) cents.push(samples[Math.floor(rand() * samples.length)].slice());
  for (let iter = 0; iter < 10; iter++) {
    const sum = cents.map(() => [0, 0, 0, 0]);
    for (const s of samples) {
      const c = nearest(cents, s[0], s[1], s[2]);
      sum[c][0] += s[0]; sum[c][1] += s[1]; sum[c][2] += s[2]; sum[c][3]++;
    }
    cents = cents.map((c, i) => (sum[i][3] ? [sum[i][0] / sum[i][3], sum[i][1] / sum[i][3], sum[i][2] / sum[i][3]] : samples[Math.floor(rand() * samples.length)].slice()));
  }
  return cents;
}
function drawDust(ctx, w, h, amount, seed) {
  if (amount <= 0) return;
  const r2 = rng(seed + FX_SEED * 31), unit = Math.max(w, h) / 1000;
  ctx.save();
  for (let k = 0, n = Math.round(amount * 120); k < n; k++) {
    const light = r2() < 0.6;
    ctx.fillStyle = light ? `rgba(255,250,235,${0.3 + r2() * 0.5})` : `rgba(20,15,10,${0.3 + r2() * 0.5})`;
    ctx.beginPath();
    ctx.arc(r2() * w, r2() * h, (0.5 + r2() * 2) * unit, 0, Math.PI * 2);
    ctx.fill();
  }
  for (let k = 0, n = Math.round(amount * 6); k < n; k++) {
    ctx.strokeStyle = `rgba(255,250,235,${0.15 + r2() * 0.3})`;
    ctx.lineWidth = (0.5 + r2()) * unit;
    const x0 = r2() * w;
    ctx.beginPath();
    ctx.moveTo(x0, r2() * h * 0.3);
    ctx.lineTo(x0 + (r2() - 0.5) * 30 * unit, h * (0.6 + r2() * 0.4));
    ctx.stroke();
  }
  ctx.restore();
}
function gradientColor(stops, t) {
  t = clamp01(t) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(t)), f = t - i;
  const a = stops[i], b = stops[i + 1];
  return [mix(a[0], b[0], f), mix(a[1], b[1], f), mix(a[2], b[2], f)];
}

/* ================= 1. 옛날 사진 ================= */
function fxVintage(src, p) {
  const c = copyCanvas(src);
  const { ctx, img, d, w, h } = pixelsOf(c);
  const cx = w / 2, cy = h / 2, maxD = Math.sqrt(cx * cx + cy * cy);
  const lift = p.fade * 70;
  const noise = grainNoise(w, h, Math.round(Math.max(w, h) / 1200), 1234);
  const grainAmt = p.grain * 60;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const j = y * w + x, i = j * 4;
      let r = (d[i] - 128) * p.contrast + 128;
      let g = (d[i + 1] - 128) * p.contrast + 128;
      let b = (d[i + 2] - 128) * p.contrast + 128;
      const l = 0.299 * r + 0.587 * g + 0.114 * b;
      r = l + (r - l) * p.saturation; g = l + (g - l) * p.saturation; b = l + (b - l) * p.saturation;
      if (p.sepia > 0) {
        const sr = 0.393 * r + 0.769 * g + 0.189 * b;
        const sg = 0.349 * r + 0.686 * g + 0.168 * b;
        const sb = 0.272 * r + 0.534 * g + 0.131 * b;
        r += (sr - r) * p.sepia; g += (sg - g) * p.sepia; b += (sb - b) * p.sepia;
      }
      r += p.warmth * 25; g += p.warmth * 8; b -= p.warmth * 25;
      r = lift + r * (1 - (lift + p.fade * 20) / 255);
      g = lift + g * (1 - (lift + p.fade * 20) / 255);
      b = lift * 0.9 + b * (1 - (lift + p.fade * 25) / 255);
      const n = (noise[j] - 0.5) * 2 * grainAmt;
      r += n; g += n; b += n;
      if (p.vignette > 0) {
        const dx = x - cx, dy = y - cy;
        const v = 1 - p.vignette * Math.pow(Math.sqrt(dx * dx + dy * dy) / maxD, 2.2);
        r *= v; g *= v; b *= v;
      }
      d[i] = clamp(r); d[i + 1] = clamp(g); d[i + 2] = clamp(b);
    }
  }
  ctx.putImageData(img, 0, 0);
  if (p.leak > 0) {
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    const grad = ctx.createRadialGradient(w * 0.95, h * 0.1, 0, w * 0.95, h * 0.1, Math.max(w, h) * 0.7);
    grad.addColorStop(0, `rgba(255,120,40,${0.75 * p.leak})`);
    grad.addColorStop(0.4, `rgba(255,70,30,${0.35 * p.leak})`);
    grad.addColorStop(1, "rgba(255,60,0,0)");
    ctx.fillStyle = grad; ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }
  drawDust(ctx, w, h, p.dust, 99);
  return c;
}

function fxPolaroid(src, p) {
  let img = src;
  if (p.crop === "square") {
    const s = Math.min(src.width, src.height);
    img = makeCanvas(s, s);
    img.getContext("2d").drawImage(src, (src.width - s) / 2, (src.height - s) / 2, s, s, 0, 0, s, s);
  }
  const v = fxVintage(img, p);
  const w = v.width, h = v.height;
  const b = Math.round(Math.min(w, h) * (0.02 + 0.08 * p.frame));
  const bottom = Math.round(b * 3.6);
  const out = makeCanvas(w + 2 * b, h + b + bottom);
  const ctx = out.getContext("2d");
  ctx.fillStyle = "#f5f2ea"; ctx.fillRect(0, 0, out.width, out.height);
  // 종이 질감
  const r = rng(3), u = U(out);
  for (let k = 0; k < 1500; k++) {
    ctx.fillStyle = r() < 0.5 ? "rgba(0,0,0,0.035)" : "rgba(255,255,255,0.5)";
    ctx.fillRect(r() * out.width, r() * out.height, 2 * u, 2 * u);
  }
  ctx.drawImage(v, b, b);
  ctx.strokeStyle = "rgba(0,0,0,0.18)"; ctx.lineWidth = Math.max(1, u);
  ctx.strokeRect(b, b, w, h);
  if (p.caption) {
    const size = Math.round(bottom * 0.38);
    ctx.fillStyle = "#2b2a33";
    ctx.font = `${size}px "Nanum Pen Script", "Nanum Pen", "Apple SD Gothic Neo", cursive`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(p.caption, out.width / 2, h + b + bottom / 2);
  }
  return out;
}

function fxDateStamp(src, p) {
  const c = fxVintage(src, p);
  const ctx = c.getContext("2d"), u = U(c);
  const size = Math.round((20 + 50 * p.size) * u);
  ctx.save();
  ctx.font = `bold ${size}px "Menlo", "Courier New", monospace`;
  ctx.textAlign = "right"; ctx.textBaseline = "bottom";
  ctx.shadowColor = "rgba(255,80,0,0.9)"; ctx.shadowBlur = size * 0.5;
  ctx.fillStyle = "rgba(255,150,60,0.95)";
  const x = c.width - 45 * u, y = c.height - 40 * u;
  ctx.fillText(p.date, x, y);
  ctx.shadowBlur = size * 0.15;
  ctx.fillText(p.date, x, y);
  ctx.restore();
  return c;
}

function fxCyanotype(src, p) {
  const c = copyCanvas(src);
  const { ctx, img, d, w, h } = pixelsOf(c);
  const L = lumaOf(d), u = U(c);
  const tex = noiseField(w, h, 40 * u, 5), tex2 = noiseField(w, h, 6 * u, 6), edge = noiseField(w, h, 18 * u, 8);
  const dark = [12, 38, 92], light = [228, 235, 236];
  const border = p.border * 70 * u;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const j = y * w + x, i = j * 4;
      let t = (L[j] / 255 - 0.5) * p.contrast + 0.5 + p.brightness * 0.3;
      t += ((tex[j] - 0.5) * 0.25 + (tex2[j] - 0.5) * 0.15) * p.texture;
      if (border > 0) {
        const dist = Math.min(x, y, w - 1 - x, h - 1 - y);
        const m = clamp01((dist - border * (0.3 + edge[j] * 1.4)) / (border * 0.25 + 1));
        t = mix(1, t, m);
      }
      t = Math.pow(clamp01(t), 1.1);
      d[i] = mix(dark[0], light[0], t); d[i + 1] = mix(dark[1], light[1], t); d[i + 2] = mix(dark[2], light[2], t);
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

function fxDaguerreotype(src, p) {
  const c = copyCanvas(src);
  const { ctx, img, d, w, h } = pixelsOf(c);
  const L = lumaOf(d), u = U(c);
  const tn = noiseField(w, h, 80 * u, 11);
  const shadow = [30, 27, 24], high = [225, 222, 212];
  const cx = w / 2, cy = h / 2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const j = y * w + x, i = j * 4;
      const t = clamp01((L[j] / 255 - 0.5) * p.contrast + 0.5);
      const nx = (x - cx) / (w * 0.48), ny = (y - cy) / (h * 0.48);
      const rr = Math.sqrt(nx * nx + ny * ny);
      const vig = 1 - p.vignette * smooth(0.55, 1.05, rr);
      let r = mix(shadow[0], high[0], t) * vig, g = mix(shadow[1], high[1], t) * vig, b = mix(shadow[2], high[2], t) * vig;
      const tt = p.tarnish * smooth(0.6, 1.1, rr + (tn[j] - 0.5) * 0.5);
      if (tt > 0) {
        const ang = Math.atan2(ny, nx) + tn[j] * 6;
        r = mix(r, r * 0.4 + (128 + 110 * Math.cos(ang)) * 0.5, tt);
        g = mix(g, g * 0.4 + (110 + 90 * Math.cos(ang + 2.1)) * 0.5, tt);
        b = mix(b, b * 0.4 + (128 + 110 * Math.cos(ang + 4.2)) * 0.5, tt);
      }
      d[i] = clamp(r); d[i + 1] = clamp(g); d[i + 2] = clamp(b);
    }
  }
  ctx.putImageData(img, 0, 0);
  drawDust(ctx, w, h, p.dust, 33);
  if (p.mat === "on") {
    ctx.save();
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, "#8a6a2e"); g.addColorStop(0.35, "#e3c987"); g.addColorStop(0.6, "#a8843f"); g.addColorStop(1, "#6f5322");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.rect(0, 0, w, h);
    ctx.ellipse(cx, cy, w * 0.44, h * 0.45, 0, 0, Math.PI * 2);
    ctx.fill("evenodd");
    ctx.strokeStyle = "rgba(60,40,10,0.6)"; ctx.lineWidth = 4 * u;
    ctx.beginPath(); ctx.ellipse(cx, cy, w * 0.44, h * 0.45, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }
  return c;
}

/* ================= 2. 도트·게임 ================= */
const PALETTES = {
  retro16: ["#000000", "#1d2b53", "#7e2553", "#008751", "#ab5236", "#5f574f", "#c2c3c7", "#fff1e8", "#ff004d", "#ffa300", "#ffec27", "#00e436", "#29adff", "#83769c", "#ff77a8", "#ffccaa"],
  green4: ["#0f380f", "#306230", "#8bac0f", "#9bbc0f"],
  gray4: ["#000000", "#555555", "#aaaaaa", "#ffffff"],
  mono: ["#000000", "#ffffff"],
  pastel: ["#2e2a3b", "#5a5a8c", "#8fb8de", "#e0c3fc", "#ffd6e0", "#fff1c1", "#c1f0c1", "#ffffff"],
  brick: ["#f4f4f4", "#a0a5a9", "#6c6e68", "#1b2a34", "#c91a09", "#720e0f", "#fe8a18", "#f2cd37", "#e4cd9e", "#958a73", "#583927", "#82422a", "#d09168", "#bbe90b", "#237841", "#184632", "#a0bcac", "#5a93db", "#0055bf", "#0a3463", "#fc97ac", "#923978", "#e1d5ed"],
};
const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

function quantize(d, w, h, pal, dither) {
  if (dither === "floyd") {
    const buf = new Float32Array(w * h * 3);
    for (let i = 0, j = 0; i < d.length; i += 4, j += 3) { buf[j] = d[i]; buf[j + 1] = d[i + 1]; buf[j + 2] = d[i + 2]; }
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const j = (y * w + x) * 3;
        const r = buf[j], g = buf[j + 1], b = buf[j + 2];
        const c = pal[nearest(pal, r, g, b)];
        const er = r - c[0], eg = g - c[1], eb = b - c[2];
        const spread = (dx, dy, f) => {
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || xx >= w || yy >= h) return;
          const k = (yy * w + xx) * 3;
          buf[k] += er * f; buf[k + 1] += eg * f; buf[k + 2] += eb * f;
        };
        spread(1, 0, 7 / 16); spread(-1, 1, 3 / 16); spread(0, 1, 5 / 16); spread(1, 1, 1 / 16);
        const i = (y * w + x) * 4;
        d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2];
      }
    }
  } else {
    const amt = dither === "bayer" ? 64 / Math.sqrt(pal.length) : 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const t = amt ? (BAYER4[(y & 3) * 4 + (x & 3)] / 16 - 0.5) * amt : 0;
        const c = pal[nearest(pal, d[i] + t, d[i + 1] + t, d[i + 2] + t)];
        d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2];
      }
    }
  }
}
function paletteFor(name, d, k) { return name === "auto" ? extractPalette(d, k) : PALETTES[name].map(hexToRgb); }

function fxPixel(src, p) {
  const block = Math.max(1, Math.round(p.block * U(src)));
  const sw = Math.max(1, Math.round(src.width / block)), sh = Math.max(1, Math.round(src.height / block));
  const small = makeCanvas(sw, sh);
  const ctx = small.getContext("2d", { willReadFrequently: true });
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, 0, 0, sw, sh);
  const img = ctx.getImageData(0, 0, sw, sh), d = img.data;
  adjust(d, p.contrast, p.brightness);
  quantize(d, sw, sh, paletteFor(p.palette, d, p.colors), p.dither);
  ctx.putImageData(img, 0, 0);
  const big = makeCanvas(sw * block, sh * block);
  const b = big.getContext("2d");
  b.imageSmoothingEnabled = false;
  b.drawImage(small, 0, 0, big.width, big.height);
  return big;
}

const ASCII_RAMPS = { short: " .:-=+*#%@", long: " .'`^,:;Il!i><~+_-?][}{1)(|/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$", blocks: " ░▒▓█", binary: " .01" };
function fxAscii(src, p) {
  const u = U(src);
  const cellH = Math.max(5, Math.round(p.size * u)), cellW = Math.max(3, Math.round(cellH * 0.6));
  const cols = Math.floor(src.width / cellW), rows = Math.floor(src.height / cellH);
  const d = sampleGrid(src, cols, rows);
  const out = makeCanvas(cols * cellW, rows * cellH);
  const ctx = out.getContext("2d");
  const theme = { dark: ["#0b0b0b", "#f2f2f2"], terminal: ["#03170a", "#39ff6e"], color: ["#0b0b0b", null], paper: ["#f6f3ea", "#1f1d1a"] }[p.theme];
  ctx.fillStyle = theme[0]; ctx.fillRect(0, 0, out.width, out.height);
  ctx.font = `${cellH}px Menlo, Monaco, "Courier New", monospace`;
  ctx.textBaseline = "top";
  const ramp = [...ASCII_RAMPS[p.ramp]];
  if (theme[1]) ctx.fillStyle = theme[1];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const i = (y * cols + x) * 4;
      let t = clamp01(((0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255 - 0.5) * p.contrast + 0.5);
      if (p.theme === "paper") t = 1 - t;
      const ch = ramp[Math.round(t * (ramp.length - 1))];
      if (ch === " ") continue;
      if (!theme[1]) {
        const m = Math.max(d[i], d[i + 1], d[i + 2], 1), k = Math.min(1.6, 255 / m);
        ctx.fillStyle = `rgb(${d[i] * k | 0},${d[i + 1] * k | 0},${d[i + 2] * k | 0})`;
      }
      ctx.fillText(ch, x * cellW, y * cellH);
    }
  }
  return out;
}

function gridSetup(src, size, contrast) {
  const cell = Math.max(4, Math.round(size * U(src)));
  const cols = Math.max(1, Math.round(src.width / cell)), rows = Math.max(1, Math.round(src.height / cell));
  const d = sampleGrid(src, cols, rows);
  adjust(d, contrast);
  return { cell, cols, rows, d };
}

function fxBricks(src, p) {
  const { cell, cols, rows, d } = gridSetup(src, p.size, p.contrast);
  const pal = paletteFor(p.palette, d, p.colors);
  const out = makeCanvas(cols * cell, rows * cell);
  const ctx = out.getContext("2d");
  const lw = Math.max(1, cell * 0.06);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const i = (y * cols + x) * 4;
      const c = pal[nearest(pal, d[i], d[i + 1], d[i + 2])];
      const px = x * cell, py = y * cell, cx = px + cell / 2, cy = py + cell / 2;
      ctx.fillStyle = rgbStr(c); ctx.fillRect(px, py, cell, cell);
      ctx.fillStyle = rgbStr(c, 1.18); ctx.fillRect(px, py, cell, lw); ctx.fillRect(px, py, lw, cell);
      ctx.fillStyle = rgbStr(c, 0.62); ctx.fillRect(px, py + cell - lw, cell, lw); ctx.fillRect(px + cell - lw, py, lw, cell);
      const r = cell * 0.31;
      ctx.fillStyle = rgbStr(c, 0.6);
      ctx.beginPath(); ctx.arc(cx + cell * 0.05, cy + cell * 0.06, r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = rgbStr(c, 1.0);
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = rgbStr(c, 1.35); ctx.lineWidth = Math.max(1, cell * 0.05);
      ctx.beginPath(); ctx.arc(cx, cy, r * 0.8, Math.PI * 1.05, Math.PI * 1.6); ctx.stroke();
    }
  }
  return out;
}

function fxStitch(src, p) {
  const { cell, cols, rows, d } = gridSetup(src, p.size, p.contrast);
  const pal = extractPalette(d, p.colors);
  const out = makeCanvas(cols * cell, rows * cell);
  const ctx = out.getContext("2d");
  ctx.fillStyle = "#efe8d8"; ctx.fillRect(0, 0, out.width, out.height);
  ctx.fillStyle = "rgba(90,70,40,0.18)";
  const hr = Math.max(0.8, cell * 0.07);
  for (let y = 0; y <= rows; y++) for (let x = 0; x <= cols; x++) {
    ctx.beginPath(); ctx.arc(x * cell, y * cell, hr, 0, Math.PI * 2); ctx.fill();
  }
  const m = cell * 0.17;
  ctx.lineCap = "round";
  const stroke = (x0, y0, x1, y1) => { ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke(); };
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const i = (y * cols + x) * 4;
      const c = pal[nearest(pal, d[i], d[i + 1], d[i + 2])];
      const px = x * cell, py = y * cell, s = cell * 0.04;
      ctx.lineWidth = cell * 0.3;
      ctx.strokeStyle = rgbStr(c, 0.6);
      stroke(px + m + s, py + cell - m + s, px + cell - m + s, py + m + s);
      stroke(px + m + s, py + m + s, px + cell - m + s, py + cell - m + s);
      ctx.strokeStyle = rgbStr(c);
      stroke(px + m, py + cell - m, px + cell - m, py + m);
      stroke(px + m, py + m, px + cell - m, py + cell - m);
      ctx.lineWidth = cell * 0.07; ctx.strokeStyle = rgbStr(c, 1.3);
      stroke(px + m * 1.4, py + m * 1.1, px + cell - m * 1.4, py + cell - m * 1.7);
    }
  }
  return out;
}

function fxBeads(src, p) {
  const { cell, cols, rows, d } = gridSetup(src, p.size, p.contrast);
  const pal = paletteFor(p.palette, d, p.colors);
  const out = makeCanvas(cols * cell, rows * cell);
  const ctx = out.getContext("2d");
  ctx.fillStyle = "#d9d9d6"; ctx.fillRect(0, 0, out.width, out.height);
  const r = cell * (0.42 + 0.09 * p.melt), hole = cell * (0.17 - 0.12 * p.melt);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const i = (y * cols + x) * 4;
      const c = pal[nearest(pal, d[i], d[i + 1], d[i + 2])];
      const cx = x * cell + cell / 2, cy = y * cell + cell / 2;
      ctx.fillStyle = rgbStr(c, 0.7);
      ctx.beginPath(); ctx.arc(cx + cell * 0.03, cy + cell * 0.04, r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = rgbStr(c);
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.4)"; ctx.lineWidth = Math.max(1, cell * 0.06);
      ctx.beginPath(); ctx.arc(cx, cy, r * 0.7, Math.PI * 1.1, Math.PI * 1.55); ctx.stroke();
      if (hole > 0.5) {
        ctx.fillStyle = rgbStr(c, 0.45);
        ctx.beginPath(); ctx.arc(cx, cy, hole, 0, Math.PI * 2); ctx.fill();
      }
    }
  }
  return out;
}

/* ================= 3. 인쇄물 ================= */
// 회전된 격자에 잉크 점을 찍는 망점 인쇄
function halftone(src, dotSize, inks, paper, blurAmt = 0.35) {
  const c = copyCanvas(src);
  const { ctx, img, d, w, h } = pixelsOf(c);
  const s = Math.max(3, dotSize * U(c));
  const [R, G, B] = channelsOf(d).map((ch) => blur(ch, w, h, s * blurAmt));
  const prepared = inks.map((ink) => ({ ...ink, ca: Math.cos(ink.angle * Math.PI / 180), sa: Math.sin(ink.angle * Math.PI / 180) }));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = paper[0], g = paper[1], b = paper[2];
      for (const ink of prepared) {
        const u1 = x * ink.ca + y * ink.sa, v1 = -x * ink.sa + y * ink.ca;
        const cu = (Math.floor(u1 / s) + 0.5) * s, cv = (Math.floor(v1 / s) + 0.5) * s;
        const dist = Math.hypot(u1 - cu, v1 - cv);
        const sx = Math.min(w - 1, Math.max(0, Math.round(cu * ink.ca - cv * ink.sa)));
        const sy = Math.min(h - 1, Math.max(0, Math.round(cu * ink.sa + cv * ink.ca)));
        const k = sy * w + sx;
        const amt = ink.amount(R[k], G[k], B[k]);
        const rad = s * 0.71 * Math.sqrt(amt);
        const cov = clamp01(rad - dist + 0.5);
        if (cov > 0) {
          r *= 1 - cov + cov * ink.color[0] / 255;
          g *= 1 - cov + cov * ink.color[1] / 255;
          b *= 1 - cov + cov * ink.color[2] / 255;
        }
      }
      const i = (y * w + x) * 4;
      d[i] = r; d[i + 1] = g; d[i + 2] = b;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

// 팝아트 만화: 단순한 색면 + 검은 외곽선 + 그림자에만 큼직한 망점
function fxComic(src, p) {
  const c = fxCartoon(src, { colors: p.colors, lines: p.lines, thick: 0.45, saturation: p.saturation });
  const { ctx, img, d, w, h } = pixelsOf(c);
  const s = Math.max(4, p.dot * U(c));
  const L = blur(lumaOf(pixelsOf(src).d), w, h, s * 0.5);
  const F = lumaOf(d); // 단순화된 색면의 밝기 (점 찍기 전)
  const ca = Math.SQRT1_2, sa = Math.SQRT1_2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const j = y * w + x, i = j * 4;
      const u1 = x * ca + y * sa, v1 = -x * sa + y * ca;
      const cu = (Math.floor(u1 / s) + 0.5) * s, cv = (Math.floor(v1 / s) + 0.5) * s;
      const sx = Math.min(w - 1, Math.max(0, Math.round(cu * ca - cv * sa)));
      const sy = Math.min(h - 1, Math.max(0, Math.round(cu * sa + cv * ca)));
      // 같은 색 면 안에서 원본이 더 어두운 곳(그림자)에만 점을 찍음
      const amt = smooth(4, 45, F[sy * w + sx] - L[sy * w + sx]) * p.dots;
      if (amt <= 0) continue;
      const rad = s * 0.5 * Math.sqrt(amt);
      const cov = clamp01(rad - Math.hypot(u1 - cu, v1 - cv) + 0.5);
      if (cov > 0) {
        const k = 1 - cov * 0.45;
        d[i] *= k; d[i + 1] *= k; d[i + 2] *= k;
      }
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

function fxNewspaper(src, p) {
  const paper = [mix(245, 228, p.age), mix(243, 215, p.age), mix(238, 185, p.age)];
  const c = halftone(src, p.dot, [{
    angle: 45, color: [28, 26, 24],
    amount: (r, g, b) => clamp01(((1 - (0.299 * r + 0.587 * g + 0.114 * b) / 255) - 0.5) * p.contrast + 0.5 - p.brightness * 0.3),
  }], paper);
  const { ctx, img, d, w, h } = pixelsOf(c);
  const tex = noiseField(w, h, 30 * U(c), 21), fine = grainNoise(w, h, 1.5 * U(c), 22);
  for (let j = 0, i = 0; j < w * h; j++, i += 4) {
    const f = 1 - p.age * 0.12 * tex[j] - 0.05 * fine[j];
    d[i] *= f; d[i + 1] *= f; d[i + 2] *= f;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

const SILK_INKS = {
  pop: { paper: [244, 239, 228], inks: [[246, 194, 28], [232, 70, 124], [29, 42, 91]] },
  redblack: { paper: [240, 236, 226], inks: [[215, 48, 42], [26, 26, 26]] },
  mint: { paper: [245, 240, 230], inks: [[120, 200, 180], [230, 120, 80], [55, 40, 35]] },
  blue: { paper: [242, 238, 228], inks: [[120, 175, 225], [20, 50, 120]] },
};
function fxSilkscreen(src, p) {
  const c = copyCanvas(src);
  const { ctx, img, d, w, h } = pixelsOf(c);
  const u = U(c), L = blur(lumaOf(d), w, h, 1.5 * u);
  const { paper, inks } = SILK_INKS[p.ink];
  const n = inks.length, r = rng(5);
  const offs = inks.map(() => [Math.round((r() - 0.5) * 2 * p.offset * 10 * u), Math.round((r() - 0.5) * 2 * p.offset * 10 * u)]);
  const speck = grainNoise(w, h, 2 * u, 9), coarse = noiseField(w, h, 25 * u, 10);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const j = y * w + x, i = j * 4;
      let cr = paper[0], cg = paper[1], cb = paper[2];
      for (let k = 0; k < n; k++) {
        const th = 255 * (1 - (k + 1) / (n + 1)) + p.brightness * 80;
        const sx = Math.min(w - 1, Math.max(0, x - offs[k][0])), sy = Math.min(h - 1, Math.max(0, y - offs[k][1]));
        const lk = L[sy * w + sx];
        let cov = clamp01((th - lk) / 6 + 0.5);
        if (cov > 0) {
          cov *= 1 - p.texture * (smooth(0.75, 0.95, speck[j]) * 0.8 + coarse[j] * 0.25);
          cr = mix(cr, inks[k][0], cov); cg = mix(cg, inks[k][1], cov); cb = mix(cb, inks[k][2], cov);
        }
      }
      d[i] = cr; d[i + 1] = cg; d[i + 2] = cb;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

const RISO_INKS = {
  pinkblue: [[255, 72, 176], [0, 120, 191]],
  redteal: [[255, 102, 94], [0, 131, 138]],
  yellowpurple: [[255, 232, 0], [118, 91, 167]],
  orangegreen: [[255, 108, 47], [0, 169, 92]],
};
function fxRiso(src, p) {
  const c = copyCanvas(src);
  const { ctx, img, d, w, h } = pixelsOf(c);
  const u = U(c);
  adjust(d, p.contrast);
  const [R, G, B] = channelsOf(d);
  const [inkB, inkA] = RISO_INKS[p.ink];
  const off = Math.round(p.offset * 8 * u);
  const nA = grainNoise(w, h, 1.5 * u, 31), nB = grainNoise(w, h, 1.5 * u, 32);
  const paper = [247, 243, 234];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const j = y * w + x, i = j * 4;
      const sj = Math.min(h - 1, y + off) * w + Math.min(w - 1, x + off);
      const lA = (0.299 * R[sj] + 0.587 * G[sj] + 0.114 * B[sj]) / 255;
      const aA = clamp01(1 - lA);
      const l = (0.299 * R[j] + 0.587 * G[j] + 0.114 * B[j]) / 255;
      const warm = (R[j] - (G[j] + B[j]) / 2) / 255;
      const aB = clamp01(warm * 1.6 + (1 - l) * 0.35);
      const cA = mix(aA, smooth(nA[j] - 0.12, nA[j] + 0.12, aA), p.grain);
      const cB = mix(aB, smooth(nB[j] - 0.12, nB[j] + 0.12, aB), p.grain);
      for (let ch = 0; ch < 3; ch++) {
        d[i + ch] = paper[ch] * (1 - cA * (1 - inkA[ch] / 255)) * (1 - cB * (1 - inkB[ch] / 255));
      }
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

function fxPhotocopy(src, p) {
  const c = copyCanvas(src);
  const { ctx, img, d, w, h } = pixelsOf(c);
  const u = U(c), L = blur(lumaOf(d), w, h, u);
  const fine = grainNoise(w, h, 1.5 * u, 41), coarse = noiseField(w, h, 12 * u, 42);
  const streak = new Float32Array(w);
  const sn = noiseField(w, 1, 6 * u, 44);
  for (let x = 0; x < w; x++) streak[x] = smooth(0.7, 0.9, sn[x]);
  const edgeW = 50 * u;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const j = y * w + x, i = j * 4;
      let t = clamp01((L[j] / 255 - p.threshold) * p.contrast * 3 + 0.5);
      t -= streak[x] * p.dirt * 0.25;
      if (fine[j] < p.dirt * 0.05 * coarse[j]) t = 0;
      const dist = Math.min(x, y, w - 1 - x, h - 1 - y);
      t *= 1 - p.dirt * 0.7 * (1 - smooth(0, edgeW, dist + (coarse[j] - 0.5) * edgeW));
      t = clamp01(t + (fine[j] - 0.5) * 0.08);
      const v = mix(28, 240, t);
      d[i] = v; d[i + 1] = v; d[i + 2] = v * 0.98;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/* ================= 4. 그림 ================= */
function fxPencil(src, p) {
  const c = copyCanvas(src);
  const { ctx, img, d, w, h } = pixelsOf(c);
  const u = U(c), L = lumaOf(d);
  const inv = new Float32Array(L.length);
  for (let j = 0; j < L.length; j++) inv[j] = 255 - L[j];
  const bl = blur(inv, w, h, 1 + p.width * 6 * u);
  const grain = grainNoise(w, h, 1.2 * u, 51), streak = noiseField(w, h, 3 * u, 52);
  const paper = [250, 248, 242];
  for (let j = 0, i = 0; j < L.length; j++, i += 4) {
    let s = Math.min(255, (L[j] * 255) / (256 - bl[j]));
    let dark = (255 - s) * (0.6 + p.darkness * 1.6);
    dark *= 0.85 + 0.3 * grain[j] * streak[j];
    s = clamp(255 - dark) / 255;
    const cr = 255 - (255 - d[i]) * 0.75, cg = 255 - (255 - d[i + 1]) * 0.75, cb = 255 - (255 - d[i + 2]) * 0.75;
    d[i] = s * mix(paper[0], cr, p.color);
    d[i + 1] = s * mix(paper[1], cg, p.color);
    d[i + 2] = s * mix(paper[2], cb, p.color);
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

function fxCartoon(src, p) {
  const c = copyCanvas(src);
  const { ctx, img, d, w, h } = pixelsOf(c);
  const u = U(c);
  adjust(d, 1.05, 0, p.saturation);
  const ch = channelsOf(d).map((a) => blur(a, w, h, 1.5 * u));
  const sm = new Uint8ClampedArray(d.length);
  for (let j = 0, i = 0; j < w * h; j++, i += 4) { sm[i] = ch[0][j]; sm[i + 1] = ch[1][j]; sm[i + 2] = ch[2][j]; }
  const pal = extractPalette(sm, p.colors);
  const L = blur(lumaOf(d), w, h, u);
  const edge = new Float32Array(w * h);
  const th = (1 - p.lines) * 60 + 8;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const j = y * w + x;
      const gx = -L[j - w - 1] - 2 * L[j - 1] - L[j + w - 1] + L[j - w + 1] + 2 * L[j + 1] + L[j + w + 1];
      const gy = -L[j - w - 1] - 2 * L[j - w] - L[j - w + 1] + L[j + w - 1] + 2 * L[j + w] + L[j + w + 1];
      edge[j] = smooth(th, th * 1.6, Math.hypot(gx, gy) / 4);
    }
  }
  const E = p.thick > 0 ? blur(edge, w, h, p.thick * 2 * u) : edge;
  const ek = p.thick > 0 ? 3 : 1;
  for (let j = 0, i = 0; j < w * h; j++, i += 4) {
    const col = pal[nearest(pal, sm[i], sm[i + 1], sm[i + 2])];
    const e = clamp01(E[j] * ek);
    d[i] = col[0] * (1 - e) + 20 * e; d[i + 1] = col[1] * (1 - e) + 18 * e; d[i + 2] = col[2] * (1 - e) + 22 * e;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

// 유화: 쿠와하라 필터 (주변 네 구역 중 가장 고른 구역의 색을 택함)
function fxOil(src, p) {
  const c = fitCanvas(src, 1200);
  const { ctx, img, d, w, h } = pixelsOf(c);
  adjust(d, 1.05, 0, p.saturation);
  const u = U(c), r = Math.max(2, Math.round(p.brush * u));
  const W = w + 1;
  const SR = new Float64Array(W * (h + 1)), SG = new Float64Array(W * (h + 1)), SB = new Float64Array(W * (h + 1)), SL = new Float64Array(W * (h + 1));
  for (let y = 0; y < h; y++) {
    let ar = 0, ag = 0, ab = 0, al = 0;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      ar += d[i]; ag += d[i + 1]; ab += d[i + 2]; al += l * l;
      const k = (y + 1) * W + x + 1, up = y * W + x + 1;
      SR[k] = SR[up] + ar; SG[k] = SG[up] + ag; SB[k] = SB[up] + ab; SL[k] = SL[up] + al;
    }
  }
  const sum = (S, x0, y0, x1, y1) => S[(y1 + 1) * W + x1 + 1] - S[y0 * W + x1 + 1] - S[(y1 + 1) * W + x0] + S[y0 * W + x0];
  const out = new Uint8ClampedArray(d.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let best = Infinity, br = 0, bg = 0, bb = 0;
      for (let q = 0; q < 4; q++) {
        const x0 = Math.max(0, q & 1 ? x : x - r), x1 = Math.min(w - 1, q & 1 ? x + r : x);
        const y0 = Math.max(0, q & 2 ? y : y - r), y1 = Math.min(h - 1, q & 2 ? y + r : y);
        const n = (x1 - x0 + 1) * (y1 - y0 + 1);
        const sr = sum(SR, x0, y0, x1, y1), sg = sum(SG, x0, y0, x1, y1), sb = sum(SB, x0, y0, x1, y1);
        const ml = (0.299 * sr + 0.587 * sg + 0.114 * sb) / n;
        const v = sum(SL, x0, y0, x1, y1) / n - ml * ml;
        if (v < best) { best = v; br = sr / n; bg = sg / n; bb = sb / n; }
      }
      const i = (y * w + x) * 4;
      out[i] = br; out[i + 1] = bg; out[i + 2] = bb;
    }
  }
  // 물감 두께감 (빛이 왼쪽 위에서 오는 양각)
  const L = lumaOf(out), weave = noiseField(w, h, 2 * u, 61);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const j = y * w + x, i = j * 4;
      const sh = (L[j - w - 1] - L[j + w + 1]) * p.texture * 0.6 + (weave[j] - 0.5) * 18 * p.texture;
      d[i] = clamp(out[i] + sh); d[i + 1] = clamp(out[i + 1] + sh); d[i + 2] = clamp(out[i + 2] + sh);
    }
  }
  ctx.putImageData(img, 0, 0);
  return resizeTo(c, src.width, src.height);
}

function fxWatercolor(src, p) {
  const c = fitCanvas(src, 1200);
  const { ctx, img, d, w, h } = pixelsOf(c);
  const u = U(c);
  adjust(d, 1, 0, 1.1);
  const [R0, G0, B0] = channelsOf(d);
  const nx = noiseField(w, h, 30 * u, 71), ny = noiseField(w, h, 30 * u, 72);
  const amt = p.bleed * 14 * u;
  const R = new Float32Array(w * h), G = new Float32Array(w * h), B = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const j = y * w + x;
      const sx = Math.min(w - 1, Math.max(0, Math.round(x + (nx[j] - 0.5) * 2 * amt)));
      const sy = Math.min(h - 1, Math.max(0, Math.round(y + (ny[j] - 0.5) * 2 * amt)));
      const k = sy * w + sx;
      R[j] = R0[k]; G[j] = G0[k]; B[j] = B0[k];
    }
  }
  const br = 1 + p.bleed * 3 * u;
  const Rb = blur(R, w, h, br), Gb = blur(G, w, h, br), Bb = blur(B, w, h, br);
  const L = new Float32Array(w * h);
  for (let j = 0; j < L.length; j++) L[j] = 0.299 * Rb[j] + 0.587 * Gb[j] + 0.114 * Bb[j];
  const L1 = blur(L, w, h, u), L2 = blur(L, w, h, 5 * u);
  const tex = noiseField(w, h, 4 * u, 73), tex2 = noiseField(w, h, 60 * u, 74), edgeN = noiseField(w, h, 20 * u, 75);
  const paper = [250, 247, 240], border = 30 * u;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const j = y * w + x, i = j * 4;
      const e = Math.abs(L1[j] - L2[j]) / 255;
      const darken = 1 - p.edges * Math.min(0.5, e * 3);
      const pap = 1 - p.paper * (0.1 * tex[j] + 0.06 * tex2[j]);
      const lift = 0.1 + p.light * 0.35;
      const dist = Math.min(x, y, w - 1 - x, h - 1 - y);
      const m = clamp01((dist - border * (0.3 + edgeN[j])) / (border * 0.5));
      const cs = [Rb[j], Gb[j], Bb[j]];
      for (let ch = 0; ch < 3; ch++) {
        let v = 255 - (255 - cs[ch]) * (1 - lift);
        v *= darken;
        v = mix(paper[ch], v, m) * pap;
        d[i + ch] = clamp(v);
      }
    }
  }
  ctx.putImageData(img, 0, 0);
  return resizeTo(c, src.width, src.height);
}

function fxPoster(src, p) {
  const c = fitCanvas(src, 1600);
  const { ctx, img, d, w, h } = pixelsOf(c);
  const u = U(c);
  adjust(d, 1.1, 0, p.saturation);
  if (p.smooth > 0) {
    const ch = channelsOf(d).map((a) => blur(a, w, h, p.smooth * 4 * u));
    for (let j = 0, i = 0; j < w * h; j++, i += 4) { d[i] = ch[0][j]; d[i + 1] = ch[1][j]; d[i + 2] = ch[2][j]; }
  }
  const pal = extractPalette(d, p.colors);
  for (let i = 0; i < d.length; i += 4) {
    const col = pal[nearest(pal, d[i], d[i + 1], d[i + 2])];
    d[i] = col[0]; d[i + 1] = col[1]; d[i + 2] = col[2];
  }
  ctx.putImageData(img, 0, 0);
  return resizeTo(c, src.width, src.height);
}

/* ================= 5. 디지털 ================= */
function fxCRT(src, p) {
  const s = pixelsOf(copyCanvas(src));
  const { w, h } = s, sd = s.d, u = U(src);
  const [R, G, B] = channelsOf(sd);
  const gr = 5 * u;
  const Rg = blur(R, w, h, gr), Gg = blur(G, w, h, gr), Bg = blur(B, w, h, gr);
  const out = makeCanvas(w, h);
  const o = pixelsOf(out);
  const period = Math.max(2, p.size * u), k = p.curve * 0.18;
  for (let y = 0; y < h; y++) {
    const phase = (y % period) / period;
    const line = 1 - p.lines * 0.7 * (1 - Math.sin(Math.PI * phase));
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const nx = (x / w) * 2 - 1, ny = (y / h) * 2 - 1, r2 = nx * nx + ny * ny;
      const fx = nx * (1 + k * r2), fy = ny * (1 + k * r2);
      if (Math.abs(fx) > 1 || Math.abs(fy) > 1) { o.d[i] = o.d[i + 1] = o.d[i + 2] = 8; o.d[i + 3] = 255; continue; }
      const sx = Math.min(w - 1, ((fx + 1) / 2 * w) | 0), sy = Math.min(h - 1, ((fy + 1) / 2 * h) | 0);
      const j = sy * w + sx;
      const tri = Math.floor(((x % period) / period) * 3);
      const mk = [tri === 0 ? 1 : 1 - p.mask * 0.6, tri === 1 ? 1 : 1 - p.mask * 0.6, tri === 2 ? 1 : 1 - p.mask * 0.6];
      const edge = Math.max(Math.abs(fx), Math.abs(fy));
      const vig = 1 - smooth(0.85, 1, edge) * 0.7;
      const boost = 1.15 + p.lines * 0.25;
      o.d[i] = clamp((R[j] + Rg[j] * p.glow * 0.6) * line * mk[0] * vig * boost);
      o.d[i + 1] = clamp((G[j] + Gg[j] * p.glow * 0.6) * line * mk[1] * vig * boost);
      o.d[i + 2] = clamp((B[j] + Bg[j] * p.glow * 0.6) * line * mk[2] * vig * boost);
      o.d[i + 3] = 255;
    }
  }
  o.ctx.putImageData(o.img, 0, 0);
  return out;
}

function fxVHS(src, p) {
  const c = copyCanvas(src);
  const { ctx, img, d, w, h } = pixelsOf(c);
  const u = U(c), n = w * h;
  const Y = new Float32Array(n), I = new Float32Array(n), Q = new Float32Array(n);
  for (let j = 0, i = 0; j < n; j++, i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    Y[j] = 0.299 * r + 0.587 * g + 0.114 * b;
    I[j] = 0.596 * r - 0.274 * g - 0.322 * b;
    Q[j] = 0.211 * r - 0.523 * g + 0.312 * b;
  }
  const Yb = blur(Y, w, h, u, true);
  const cr = 2 + p.bleed * 10 * u;
  const Ib = blur(I, w, h, cr, true), Qb = blur(Q, w, h, cr, true);
  const shift = Math.round(p.bleed * 6 * u);
  const r = rng(81 + FX_SEED), rowN = noiseField(1, h, 3 * u, 82 + FX_SEED), off = new Float32Array(h);
  const bandY = h * (0.82 + r() * 0.08), bandH = 25 * u;
  for (let y = 0; y < h; y++) {
    off[y] = (rowN[y] - 0.5) * p.jitter * 10 * u;
    if (Math.abs(y - bandY) < bandH) off[y] += (r() - 0.3) * p.jitter * 40 * u;
  }
  const grain = grainNoise(w, h, 1.2 * u, 83);
  for (let y = 0; y < h; y++) {
    const inBand = Math.abs(y - bandY) < bandH * 0.5 && p.jitter > 0;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const sx = Math.min(w - 1, Math.max(0, Math.round(x - off[y])));
      const cx = Math.min(w - 1, Math.max(0, sx - shift));
      const yy = Yb[y * w + sx], ii = Ib[y * w + cx] * 1.15, qq = Qb[y * w + cx] * 1.15;
      let rr = yy + 0.956 * ii + 0.621 * qq, gg = yy - 0.272 * ii - 0.647 * qq, bb = yy - 1.106 * ii + 1.703 * qq;
      const nz = (grain[y * w + x] - 0.5) * p.noise * 60;
      rr += nz; gg += nz; bb += nz;
      if (inBand && grain[y * w + x] > 0.75) { rr = gg = bb = 230; }
      d[i] = clamp(rr * 0.95 + 8); d[i + 1] = clamp(gg * 0.95 + 6); d[i + 2] = clamp(bb * 0.95 + 12);
    }
  }
  ctx.putImageData(img, 0, 0);
  if (p.osd === "on") {
    const size = Math.round(38 * u);
    ctx.save();
    ctx.font = `bold ${size}px "Menlo", "Courier New", monospace`;
    ctx.fillStyle = "#f4f4f4"; ctx.shadowColor = "rgba(0,0,0,0.8)"; ctx.shadowOffsetX = 2 * u; ctx.shadowOffsetY = 2 * u;
    ctx.textBaseline = "top"; ctx.fillText("PLAY ▶", 50 * u, 45 * u);
    const now = new Date();
    const mon = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"][now.getMonth()];
    ctx.textBaseline = "bottom";
    ctx.fillText("AM 12:00", 50 * u, h - 45 * u - size * 1.2);
    ctx.fillText(`${mon}. ${String(now.getDate()).padStart(2, "0")} 1994`, 50 * u, h - 45 * u);
    ctx.restore();
  }
  return c;
}

function fxGlitch(src, p) {
  const s = pixelsOf(copyCanvas(src));
  const { w, h } = s, u = U(src);
  const out = makeCanvas(w, h);
  const o = pixelsOf(out);
  const dx = Math.round(p.split * 18 * u);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      o.d[i] = s.d[(y * w + Math.min(w - 1, x + dx)) * 4];
      o.d[i + 1] = s.d[i + 1];
      o.d[i + 2] = s.d[(y * w + Math.max(0, x - dx)) * 4 + 2];
      o.d[i + 3] = 255;
    }
  }
  o.ctx.putImageData(o.img, 0, 0);
  const r = rng(p.seed * 7919 + 1 + FX_SEED * 13), ctx = o.ctx;
  const snap = copyCanvas(out);
  for (let k = 0, n = Math.round(p.amount * 30); k < n; k++) {
    const y0 = r() * h, hh = (r() * r() * 0.08 * h) + 2 * u;
    const shift = (r() - 0.5) * w * 0.25 * p.amount;
    ctx.drawImage(snap, 0, y0, w, hh, shift, y0, w, hh);
  }
  for (let k = 0, n = Math.round(p.amount * 10); k < n; k++) {
    const bw = (0.05 + r() * 0.25) * w, bh = (0.01 + r() * 0.05) * h;
    const x0 = r() * (w - bw), y0 = r() * (h - bh);
    ctx.save();
    ctx.globalCompositeOperation = r() < 0.5 ? "difference" : "source-over";
    ctx.drawImage(snap, r() * (w - bw), r() * (h - bh), bw, bh, x0, y0, bw, bh);
    ctx.restore();
    if (r() < 0.4) {
      ctx.fillStyle = ["rgba(255,0,80,0.35)", "rgba(0,255,200,0.35)", "rgba(80,80,255,0.35)"][Math.floor(r() * 3)];
      ctx.fillRect(x0, y0, bw, bh * 0.4);
    }
  }
  for (let k = 0, n = Math.round(p.amount * 40); k < n; k++) {
    ctx.fillStyle = `rgba(255,255,255,${0.1 + r() * 0.4})`;
    ctx.fillRect(0, r() * h, w, Math.max(1, u * r() * 2));
  }
  return out;
}

const THERMAL = {
  iron: [[0, 0, 10], [32, 0, 96], [110, 0, 150], [190, 30, 120], [235, 85, 30], [255, 165, 0], [255, 235, 110], [255, 255, 255]],
  rainbow: [[0, 0, 120], [0, 40, 255], [0, 200, 255], [0, 255, 110], [210, 255, 0], [255, 150, 0], [255, 0, 0], [255, 255, 255]],
  whitehot: [[0, 0, 0], [255, 255, 255]],
};
function fxThermal(src, p) {
  const c = copyCanvas(src);
  const { ctx, img, d, w, h } = pixelsOf(c);
  const u = U(c);
  const heat = new Float32Array(w * h);
  for (let j = 0, i = 0; j < heat.length; j++, i += 4) {
    const l = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255;
    const skin = clamp01((d[i] - d[i + 2]) / 255 * 2.2) * clamp01(d[i] / 120);
    heat[j] = mix(l, skin, p.people);
  }
  const H = blur(heat, w, h, 1 + p.smooth * 8 * u);
  const stops = THERMAL[p.palette];
  for (let j = 0, i = 0; j < H.length; j++, i += 4) {
    const col = gradientColor(stops, (H[j] - 0.5) * p.contrast + 0.5 + p.shift * 0.4);
    d[i] = col[0]; d[i + 1] = col[1]; d[i + 2] = col[2];
  }
  ctx.putImageData(img, 0, 0);
  if (p.hud === "on") {
    ctx.save();
    const cx = w / 2, cy = h / 2, s = 30 * u;
    ctx.strokeStyle = "#fff"; ctx.lineWidth = 3 * u;
    ctx.beginPath(); ctx.moveTo(cx - s, cy); ctx.lineTo(cx + s, cy); ctx.moveTo(cx, cy - s); ctx.lineTo(cx, cy + s); ctx.stroke();
    ctx.font = `bold ${Math.round(34 * u)}px Menlo, monospace`; ctx.fillStyle = "#fff";
    ctx.textBaseline = "bottom"; ctx.fillText(`${(30 + H[(cy | 0) * w + (cx | 0)] * 8).toFixed(1)}°C`, cx + s * 0.6, cy - s * 0.4);
    const bx = w - 60 * u, by = h * 0.2, bh = h * 0.6, bw = 18 * u;
    const g = ctx.createLinearGradient(0, by + bh, 0, by);
    stops.forEach((st, k) => g.addColorStop(k / (stops.length - 1), `rgb(${st[0]},${st[1]},${st[2]})`));
    ctx.fillStyle = g; ctx.fillRect(bx, by, bw, bh);
    ctx.strokeRect(bx, by, bw, bh);
    ctx.font = `${Math.round(24 * u)}px Menlo, monospace`; ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillText("38", bx - 8 * u, by); ctx.fillText("22", bx - 8 * u, by + bh);
    ctx.restore();
  }
  return c;
}

function fxNightVision(src, p) {
  const c = copyCanvas(src);
  const { ctx, img, d, w, h } = pixelsOf(c);
  const u = U(c);
  const L = lumaOf(d);
  const t = new Float32Array(L.length);
  for (let j = 0; j < L.length; j++) t[j] = clamp01(Math.pow(L[j] / 255, 0.8) * (0.6 + p.gain * 1.6));
  const glow = blur(t, w, h, 8 * u);
  const grain = grainNoise(w, h, 1.5 * u, 91);
  const cx = w / 2, cy = h / 2;
  const circles = p.mask === "binocular"
    ? [[cx - w * 0.2, cy, Math.min(h * 0.47, w * 0.27)], [cx + w * 0.2, cy, Math.min(h * 0.47, w * 0.27)]]
    : p.mask === "circle" ? [[cx, cy, Math.min(w, h) * 0.48]] : null;
  for (let y = 0; y < h; y++) {
    const scan = 1 - 0.12 * ((y / (3 * u)) & 1);
    for (let x = 0; x < w; x++) {
      const j = y * w + x, i = j * 4;
      let v = clamp01(t[j] + glow[j] * 0.35 + (grain[j] - 0.5) * p.noise * 0.6) * scan;
      let m = 1;
      if (circles) {
        m = 0;
        for (const [ox, oy, rr] of circles) {
          const dd = Math.hypot(x - ox, y - oy) / rr;
          m = Math.max(m, (1 - smooth(0.92, 1, dd)) * (1 - 0.45 * smooth(0.5, 1, dd)));
        }
      }
      v *= m;
      d[i] = 255 * Math.pow(v, 2.2) * 0.55;
      d[i + 1] = 255 * v;
      d[i + 2] = 255 * Math.pow(v, 3) * 0.35 + 6 * m;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/* ================= 효과 목록 ================= */
const R = (key, label, min, max, step = 0.01) => ({ key, label, min, max, step });
const SEL = (key, label, options) => ({ key, label, type: "select", options });
const TXT = (key, label, placeholder = "") => ({ key, label, type: "text", placeholder });

const today = new Date();
const DATE_STAMP = `'${String(today.getFullYear()).slice(2)} ${String(today.getMonth() + 1).padStart(2, " ")} ${String(today.getDate()).padStart(2, " ")}`;

const V = (sepia, fade, contrast, saturation, warmth, grain, vignette, dust, leak) => ({ sepia, fade, contrast, saturation, warmth, grain, vignette, dust, leak });
const VC = {
  sepia: R("sepia", "세피아", 0, 1), fade: R("fade", "바랜 정도", 0, 1), contrast: R("contrast", "대비", 0.5, 1.5),
  saturation: R("saturation", "채도", 0, 1.5), warmth: R("warmth", "따뜻함", -1, 1), grain: R("grain", "필름 입자", 0, 1),
  vignette: R("vignette", "가장자리 어둡게", 0, 1), dust: R("dust", "먼지·스크래치", 0, 1), leak: R("leak", "빛 번짐", 0, 1),
};
const VINTAGE_ALL = Object.values(VC);

const PIXEL_CTRL = [
  R("block", "픽셀 크기", 1, 20, 0.5), R("colors", "색 개수 (사진 색일 때)", 2, 32, 1),
  R("brightness", "밝기", -1, 1), R("contrast", "대비", 0.5, 1.8),
  SEL("palette", "색 팔레트", [["auto", "사진 색 그대로"], ["retro16", "레트로 게임 16색"], ["green4", "초록 4색 게임기"], ["gray4", "회색 4색"], ["mono", "흑백 2색"], ["pastel", "파스텔 8색"]]),
  SEL("dither", "점묘 처리", [["none", "없음 (깔끔)"], ["bayer", "격자 점묘"], ["floyd", "부드러운 점묘"]]),
];
const PX = (block, colors, brightness, contrast, palette, dither) => ({ block, colors, brightness, contrast, palette, dither });

const CATEGORIES = [
  { id: "old", name: "옛날 사진" },
  { id: "dot", name: "도트·게임" },
  { id: "print", name: "인쇄물" },
  { id: "paint", name: "그림" },
  { id: "digital", name: "디지털" },
];

const EFFECTS = [
  // 옛날 사진
  { id: "sepia", cat: "old", name: "세피아", run: fxVintage, controls: VINTAGE_ALL, defaults: V(0.9, 0.35, 0.95, 0.6, 0.2, 0.35, 0.5, 0.3, 0) },
  { id: "film70", cat: "old", name: "70년대 필름", run: fxVintage, controls: VINTAGE_ALL, defaults: V(0.15, 0.45, 0.9, 0.75, 0.6, 0.3, 0.35, 0.1, 0.4) },
  { id: "faded", cat: "old", name: "바랜 컬러", run: fxVintage, controls: VINTAGE_ALL, defaults: V(0.05, 0.65, 0.8, 0.55, 0.25, 0.2, 0.25, 0.05, 0) },
  { id: "bwfilm", cat: "old", name: "흑백 필름", run: fxVintage, controls: VINTAGE_ALL, defaults: V(0, 0.25, 1.2, 0, 0, 0.5, 0.45, 0.25, 0) },
  { id: "disposable", cat: "old", name: "일회용 카메라", run: fxVintage, controls: VINTAGE_ALL, defaults: V(0, 0.2, 1.15, 1.1, 0.35, 0.4, 0.55, 0, 0.25) },
  {
    id: "polaroid", cat: "old", name: "폴라로이드", run: fxPolaroid,
    controls: [SEL("crop", "모양", [["square", "정사각형"], ["original", "원본 비율"]]), R("frame", "테두리 두께", 0, 1), TXT("caption", "아래 글씨", "비워두면 글씨 없음"), VC.fade, VC.warmth, VC.saturation, VC.grain, VC.leak],
    defaults: { ...V(0, 0.35, 0.95, 0.85, 0.3, 0.25, 0.3, 0.05, 0.1), crop: "square", frame: 0.5, caption: "" },
  },
  {
    id: "datestamp", cat: "old", name: "날짜 도장", run: fxDateStamp,
    controls: [TXT("date", "날짜 글씨"), R("size", "글자 크기", 0, 1), VC.fade, VC.warmth, VC.grain, VC.vignette, VC.leak],
    defaults: { ...V(0, 0.2, 1.1, 1.05, 0.3, 0.35, 0.4, 0, 0.15), date: DATE_STAMP, size: 0.4 },
  },
  {
    id: "cyanotype", cat: "old", name: "청사진", run: fxCyanotype,
    controls: [R("contrast", "대비", 0.5, 2), R("brightness", "밝기", -1, 1), R("texture", "종이 얼룩", 0, 1), R("border", "붓 자국 테두리", 0, 1)],
    defaults: { contrast: 1.2, brightness: 0, texture: 0.5, border: 0.5 },
  },
  {
    id: "daguerre", cat: "old", name: "은판 사진", run: fxDaguerreotype,
    controls: [R("contrast", "대비", 0.5, 2), R("vignette", "가장자리 어둡게", 0, 1), R("tarnish", "녹슨 무지갯빛", 0, 1), R("dust", "먼지·스크래치", 0, 1), SEL("mat", "금색 액자", [["on", "있음"], ["off", "없음"]])],
    defaults: { contrast: 1.1, vignette: 0.7, tarnish: 0.5, dust: 0.3, mat: "on" },
  },
  // 도트·게임
  { id: "px-basic", cat: "dot", name: "기본 도트", run: fxPixel, controls: PIXEL_CTRL, defaults: PX(4, 16, 0, 1.1, "auto", "none"), png: true, pixelated: true },
  { id: "px-retro", cat: "dot", name: "레트로 게임", run: fxPixel, controls: PIXEL_CTRL, defaults: PX(3, 16, 0.05, 1.15, "retro16", "bayer"), png: true, pixelated: true },
  { id: "px-green", cat: "dot", name: "초록 화면", run: fxPixel, controls: PIXEL_CTRL, defaults: PX(2.5, 4, 0.1, 1.3, "green4", "bayer"), png: true, pixelated: true },
  { id: "px-big", cat: "dot", name: "큰 블록", run: fxPixel, controls: PIXEL_CTRL, defaults: PX(10, 12, 0, 1.1, "auto", "none"), png: true, pixelated: true },
  { id: "px-mono", cat: "dot", name: "흑백 점묘", run: fxPixel, controls: PIXEL_CTRL, defaults: PX(1.5, 2, 0, 1.2, "mono", "floyd"), png: true, pixelated: true },
  {
    id: "ascii", cat: "dot", name: "글자 그림", run: fxAscii, png: true,
    controls: [R("size", "글자 크기", 4, 24, 1), R("contrast", "대비", 0.5, 2.5), SEL("theme", "색", [["dark", "검은 바탕 흰 글자"], ["terminal", "초록 터미널"], ["color", "사진 색 그대로"], ["paper", "흰 바탕 검은 글자"]]), SEL("ramp", "글자 종류", [["short", "기본"], ["long", "세밀하게"], ["blocks", "네모 블록"], ["binary", "0과 1"]])],
    defaults: { size: 9, contrast: 1.3, theme: "dark", ramp: "short" },
  },
  {
    id: "bricks", cat: "dot", name: "블록 모자이크", run: fxBricks, png: true,
    controls: [R("size", "블록 크기", 6, 40, 1), SEL("palette", "색", [["brick", "장난감 블록 색"], ["auto", "사진 색 그대로"]]), R("colors", "색 개수 (사진 색일 때)", 2, 32, 1), R("contrast", "대비", 0.5, 1.8)],
    defaults: { size: 14, palette: "brick", colors: 12, contrast: 1.1 },
  },
  {
    id: "stitch", cat: "dot", name: "십자수", run: fxStitch, png: true,
    controls: [R("size", "땀 크기", 5, 30, 1), R("colors", "실 색 개수", 2, 24, 1), R("contrast", "대비", 0.5, 1.8)],
    defaults: { size: 10, colors: 10, contrast: 1.05 },
  },
  {
    id: "beads", cat: "dot", name: "비즈 공예", run: fxBeads, png: true,
    controls: [R("size", "비즈 크기", 6, 36, 1), SEL("palette", "색", [["auto", "사진 색 그대로"], ["retro16", "레트로 16색"], ["pastel", "파스텔 8색"]]), R("colors", "색 개수 (사진 색일 때)", 2, 32, 1), R("melt", "다리미로 녹인 정도", 0, 1), R("contrast", "대비", 0.5, 1.8)],
    defaults: { size: 12, palette: "auto", colors: 14, melt: 0, contrast: 1.1 },
  },
  // 인쇄물
  {
    id: "comic", heavy: true, cat: "print", name: "만화책 망점", run: fxComic,
    controls: [R("dot", "망점 크기", 4, 24, 0.5), R("dots", "망점 양", 0, 1), R("colors", "색 개수", 3, 16, 1), R("lines", "외곽선 양", 0, 1), R("saturation", "채도", 0, 2)],
    defaults: { dot: 14, dots: 0.8, colors: 6, lines: 0.55, saturation: 1.4 },
  },
  {
    id: "newspaper", heavy: true, cat: "print", name: "신문 인쇄", run: fxNewspaper,
    controls: [R("dot", "망점 크기", 2, 16, 0.5), R("contrast", "대비", 0.5, 2.5), R("brightness", "밝기", -1, 1), R("age", "누렇게 바랜 정도", 0, 1)],
    defaults: { dot: 5, contrast: 1.3, brightness: 0, age: 0.5 },
  },
  {
    id: "silkscreen", cat: "print", name: "실크스크린", run: fxSilkscreen,
    controls: [SEL("ink", "잉크 조합", [["pop", "팝아트 3색"], ["redblack", "빨강·검정"], ["mint", "민트·주황·갈색"], ["blue", "파랑 2색"]]), R("brightness", "밝기", -1, 1), R("offset", "판 어긋남", 0, 1), R("texture", "잉크 거친 정도", 0, 1)],
    defaults: { ink: "pop", brightness: 0, offset: 0.4, texture: 0.5 },
  },
  {
    id: "riso", cat: "print", name: "리소 인쇄", run: fxRiso,
    controls: [SEL("ink", "잉크 조합", [["pinkblue", "핑크·파랑"], ["redteal", "빨강·청록"], ["yellowpurple", "노랑·보라"], ["orangegreen", "주황·초록"]]), R("grain", "오돌토돌 입자", 0, 1), R("offset", "판 어긋남", 0, 1), R("contrast", "대비", 0.5, 1.8)],
    defaults: { ink: "pinkblue", grain: 0.6, offset: 0.4, contrast: 1.1 },
  },
  {
    id: "photocopy", cat: "print", name: "복사기", run: fxPhotocopy,
    controls: [R("threshold", "어두운 기준", 0.2, 0.8), R("contrast", "대비", 0.5, 3), R("dirt", "얼룩·토너 자국", 0, 1)],
    defaults: { threshold: 0.5, contrast: 1.5, dirt: 0.5 },
  },
  // 그림
  {
    id: "pencil", cat: "paint", name: "연필 스케치", run: fxPencil,
    controls: [R("width", "선 굵기", 0, 1), R("darkness", "진하기", 0, 1), R("color", "색 입히기", 0, 1)],
    defaults: { width: 0.4, darkness: 0.7, color: 0 },
  },
  {
    id: "colorpencil", cat: "paint", name: "색연필", run: fxPencil,
    controls: [R("width", "선 굵기", 0, 1), R("darkness", "진하기", 0, 1), R("color", "색 입히기", 0, 1)],
    defaults: { width: 0.5, darkness: 0.4, color: 0.8 },
  },
  {
    id: "cartoon", heavy: true, cat: "paint", name: "만화풍", run: fxCartoon,
    controls: [R("colors", "색 개수", 3, 20, 1), R("lines", "외곽선 양", 0, 1), R("thick", "외곽선 굵기", 0, 1), R("saturation", "채도", 0, 2)],
    defaults: { colors: 8, lines: 0.5, thick: 0.3, saturation: 1.3 },
  },
  {
    id: "oil", heavy: true, cat: "paint", name: "유화", run: fxOil,
    controls: [R("brush", "붓 크기", 2, 14, 0.5), R("texture", "물감 두께감", 0, 1), R("saturation", "채도", 0, 2)],
    defaults: { brush: 5, texture: 0.5, saturation: 1.15 },
  },
  {
    id: "watercolor", heavy: true, cat: "paint", name: "수채화", run: fxWatercolor,
    controls: [R("bleed", "번짐", 0, 1), R("edges", "물감 테두리", 0, 1), R("paper", "종이 질감", 0, 1), R("light", "연하게", 0, 1)],
    defaults: { bleed: 0.5, edges: 0.6, paper: 0.5, light: 0.3 },
  },
  {
    id: "poster", heavy: true, cat: "paint", name: "포스터", run: fxPoster,
    controls: [R("colors", "색 개수", 2, 16, 1), R("smooth", "단순하게", 0, 1), R("saturation", "채도", 0, 2)],
    defaults: { colors: 6, smooth: 0.4, saturation: 1.2 },
  },
  // 디지털
  {
    id: "crt", cat: "digital", name: "옛날 TV", run: fxCRT,
    controls: [R("size", "줄 간격", 2, 8, 0.5), R("lines", "가로줄 진하기", 0, 1), R("mask", "RGB 화소", 0, 1), R("glow", "빛 번짐", 0, 1), R("curve", "볼록한 화면", 0, 1)],
    defaults: { size: 3.5, lines: 0.6, mask: 0.4, glow: 0.4, curve: 0.4 },
  },
  {
    id: "vhs", cat: "digital", name: "VHS 비디오", run: fxVHS,
    controls: [R("bleed", "색 번짐", 0, 1), R("jitter", "화면 흔들림", 0, 1), R("noise", "지직거림", 0, 1), SEL("osd", "화면 글씨", [["on", "PLAY·날짜 표시"], ["off", "없음"]])],
    defaults: { bleed: 0.5, jitter: 0.4, noise: 0.4, osd: "on" },
  },
  {
    id: "glitch", cat: "digital", name: "글리치", run: fxGlitch,
    controls: [R("amount", "깨진 정도", 0, 1), R("split", "색 어긋남", 0, 1), R("seed", "랜덤 변형", 1, 30, 1)],
    defaults: { amount: 0.5, split: 0.4, seed: 1 },
  },
  {
    id: "thermal", cat: "digital", name: "열화상", run: fxThermal,
    controls: [SEL("palette", "색", [["iron", "적외선 기본"], ["rainbow", "무지개"], ["whitehot", "흑백"]]), R("people", "사람 강조", 0, 1), R("smooth", "뭉개기", 0, 1), R("contrast", "대비", 0.5, 2.5), R("shift", "온도 올리기", -1, 1), SEL("hud", "측정 표시", [["on", "있음"], ["off", "없음"]])],
    defaults: { palette: "iron", people: 0.4, smooth: 0.3, contrast: 1.2, shift: 0, hud: "on" },
  },
  {
    id: "night", cat: "digital", name: "야간투시경", run: fxNightVision,
    controls: [R("gain", "밝게", 0, 1), R("noise", "지직거림", 0, 1), SEL("mask", "렌즈 모양", [["binocular", "쌍안경"], ["circle", "원형"], ["none", "없음"]])],
    defaults: { gain: 0.5, noise: 0.5, mask: "binocular" },
  },
];
