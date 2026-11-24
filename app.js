const FULL_SIDE = 2400;   // 저장용 해상도 (긴 변)
const PREVIEW_SIDE = 1200; // 화면 미리보기 해상도
const VIDEO_SIDE = 720;    // 영상 처리 해상도 (실시간이라 작게)

const state = {
  cat: CATEGORIES[0].id,
  effectByCat: Object.fromEntries(CATEGORIES.map((c) => [c.id, EFFECTS.find((e) => e.cat === c.id).id])),
  params: Object.fromEntries(EFFECTS.map((e) => [e.id, { ...e.defaults }])),
  full: null,
  preview: null,
  result: null,
  fileName: "photo",
  showOriginal: false,
  video: null,      // 영상일 때 <video>
  frame: null,      // 영상의 현재 장면을 담는 캔버스
  frameNo: 0,
  recording: false,
  audio: null,
};

const $ = (id) => document.getElementById(id);
const view = $("view");
const currentEffect = () => EFFECTS.find((e) => e.id === state.effectByCat[state.cat]);

/* ---------- 컨트롤 ---------- */
function buildCats() {
  const el = $("cats");
  el.innerHTML = "";
  for (const c of CATEGORIES) {
    const b = document.createElement("button");
    b.className = "tab" + (c.id === state.cat ? " active" : "");
    b.textContent = c.name;
    b.onclick = () => { state.cat = c.id; buildCats(); buildEffects(); buildControls(); render(); };
    el.appendChild(b);
  }
}

function buildEffects() {
  const el = $("effects");
  el.innerHTML = "";
  for (const e of EFFECTS.filter((x) => x.cat === state.cat)) {
    const b = document.createElement("button");
    b.className = "preset" + (e.id === state.effectByCat[state.cat] ? " active" : "");
    b.textContent = e.name;
    if (state.video && e.heavy) { b.disabled = true; b.title = "무거워서 영상에서는 쓸 수 없어요"; }
    b.onclick = () => { state.effectByCat[state.cat] = e.id; buildEffects(); buildControls(); render(); };
    el.appendChild(b);
  }
}

function fmt(def, v) { return def.step >= 1 ? v : Math.round(v * 100); }

function buildControls() {
  const fx = currentEffect();
  const p = state.params[fx.id];
  const el = $("sliders");
  el.innerHTML = "";
  for (const def of fx.controls) {
    const row = document.createElement("div");
    row.className = "row";
    const label = document.createElement("label");
    label.textContent = def.label;
    const val = document.createElement("span");
    label.appendChild(val);
    row.appendChild(label);
    let input;
    if (def.type === "select") {
      input = document.createElement("select");
      for (const [v, t] of def.options) input.add(new Option(t, v));
      input.value = p[def.key];
    } else if (def.type === "text") {
      input = document.createElement("input");
      input.type = "text";
      input.placeholder = def.placeholder || "";
      input.value = p[def.key];
    } else {
      input = document.createElement("input");
      input.type = "range";
      input.min = def.min; input.max = def.max; input.step = def.step;
      input.value = p[def.key];
      val.textContent = fmt(def, p[def.key]);
    }
    input.addEventListener("input", () => {
      const v = def.type === "select" || def.type === "text" ? input.value : parseFloat(input.value);
      p[def.key] = v;
      if (!def.type) val.textContent = fmt(def, v);
      render();
    });
    row.appendChild(input);
    el.appendChild(row);
  }
}

/* ---------- 사진 불러오기 ---------- */
function scaled(img, maxSide) {
  const s = Math.min(1, maxSide / Math.max(img.width, img.height));
  const c = document.createElement("canvas");
  c.width = Math.round(img.width * s);
  c.height = Math.round(img.height * s);
  const ctx = c.getContext("2d");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, c.width, c.height);
  return c;
}

function loadFile(file) {
  if (!file || state.recording) return;
  if (file.type.startsWith("video/")) return loadVideo(file);
  if (!file.type.startsWith("image/")) return;
  stopVideo();
  state.fileName = file.name ? file.name.replace(/\.[^.]+$/, "") : "photo";
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    state.full = scaled(img, FULL_SIDE);
    state.preview = scaled(state.full, PREVIEW_SIDE);
    URL.revokeObjectURL(url);
    $("drop").hidden = true;
    view.hidden = false;
    $("compare").hidden = false;
    $("download").disabled = false;
    $("download").textContent = "저장하기";
    buildEffects();
    render();
  };
  img.onerror = () => { $("status").textContent = "이 사진은 열 수 없어요. JPG나 PNG로 다시 시도해 주세요."; };
  img.src = url;
}

/* ---------- 변환 & 표시 ---------- */
let pending = false;
function render() {
  if (state.video) return; // 영상은 재생 루프에서 그림
  if (!state.preview || pending) return;
  pending = true;
  requestAnimationFrame(() => {
    pending = false;
    const fx = currentEffect();
    try {
      state.result = fx.run(state.preview, state.params[fx.id]);
      $("status").textContent = "";
    } catch (err) {
      console.error(err);
      $("status").textContent = "변환 중 문제가 생겼어요: " + err.message;
    }
    draw();
  });
}

function draw() {
  const img = state.showOriginal ? state.preview : state.result;
  if (!img) return;
  view.width = img.width;
  view.height = img.height;
  view.classList.toggle("pixelated", !!currentEffect().pixelated && !state.showOriginal);
  view.getContext("2d").drawImage(img, 0, 0);
}

function download() {
  if (state.video) return recordVideo();
  if (!state.full) return;
  const fx = currentEffect();
  const btn = $("download");
  btn.disabled = true;
  btn.textContent = "만드는 중…";
  setTimeout(() => {
    try {
      const out = fx.run(state.full, state.params[fx.id]);
      const type = fx.png ? "image/png" : "image/jpeg";
      out.toBlob((blob) => {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `${state.fileName}_${fx.name.replace(/\s+/g, "")}.${fx.png ? "png" : "jpg"}`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
        btn.disabled = false;
        btn.textContent = "저장하기";
      }, type, 0.92);
    } catch (err) {
      console.error(err);
      $("status").textContent = "저장 중 문제가 생겼어요: " + err.message;
      btn.disabled = false;
      btn.textContent = "저장하기";
    }
  }, 30);
}


/* ---------- 영상 ---------- */
function stopVideo() {
  if (!state.video) return;
  state.video.pause();
  URL.revokeObjectURL(state.video.src);
  state.video = null;
  state.audio = null;
}

function loadVideo(file) {
  stopVideo();
  state.fileName = file.name ? file.name.replace(/\.[^.]+$/, "") : "video";
  const v = document.createElement("video");
  v.src = URL.createObjectURL(file);
  v.muted = true;
  v.loop = true;
  v.playsInline = true;
  v.onloadeddata = () => {
    const s = Math.min(1, VIDEO_SIDE / Math.max(v.videoWidth, v.videoHeight));
    state.frame = document.createElement("canvas");
    // 영상 코덱은 짝수 크기를 좋아함
    state.frame.width = Math.round(v.videoWidth * s / 2) * 2;
    state.frame.height = Math.round(v.videoHeight * s / 2) * 2;
    state.video = v;
    state.preview = state.frame;
    state.full = null;
    // 지금 고른 효과가 무거우면 같은 종류의 가벼운 효과로 바꿈
    for (const c of CATEGORIES) {
      const cur = EFFECTS.find((e) => e.id === state.effectByCat[c.id]);
      if (cur.heavy) state.effectByCat[c.id] = EFFECTS.find((e) => e.cat === c.id && !e.heavy).id;
    }
    buildEffects();
    buildControls();
    $("drop").hidden = true;
    view.hidden = false;
    $("compare").hidden = false;
    $("download").disabled = false;
    $("download").textContent = "영상 저장";
    v.play();
    videoLoop(v);
  };
  v.onerror = () => { $("status").textContent = "이 영상은 열 수 없어요. MP4나 MOV로 다시 시도해 주세요."; };
}

function videoLoop(v) {
  if (state.video !== v) return;
  const next = () => (v.requestVideoFrameCallback ? v.requestVideoFrameCallback(() => videoLoop(v)) : requestAnimationFrame(() => videoLoop(v)));
  const ctx = state.frame.getContext("2d");
  ctx.drawImage(v, 0, 0, state.frame.width, state.frame.height);
  const fx = currentEffect();
  FX_SEED = state.frameNo++;
  try {
    state.result = fx.run(state.frame, state.params[fx.id]);
  } catch (err) {
    console.error(err);
  }
  FX_SEED = 0;
  draw();
  if (state.recording) {
    const pct = v.duration ? Math.min(100, Math.round((v.currentTime / v.duration) * 100)) : 0;
    $("download").textContent = `녹화 중 ${pct}%`;
  }
  next();
}

async function recordVideo() {
  const v = state.video;
  if (!v || state.recording) return;
  if (!window.MediaRecorder || !view.captureStream) {
    $("status").textContent = "이 브라우저는 영상 저장을 지원하지 않아요. 크롬에서 열어 주세요.";
    return;
  }
  state.recording = true;
  document.querySelectorAll("button, input, select").forEach((el) => { el.dataset.wasDisabled = el.disabled; el.disabled = true; });

  // 소리: 영상 소리를 녹화 쪽으로 연결 (스피커로는 안 나감)
  if (!state.audio) {
    try {
      const ac = new AudioContext();
      const src = ac.createMediaElementSource(v);
      const dest = ac.createMediaStreamDestination();
      src.connect(dest);
      state.audio = { ac, dest };
    } catch (err) {
      console.warn("소리 연결 실패", err);
    }
  }
  if (state.audio) await state.audio.ac.resume();

  v.pause();
  v.loop = false;
  v.currentTime = 0;
  await new Promise((res) => v.addEventListener("seeked", res, { once: true }));
  v.muted = false;

  const stream = view.captureStream(30);
  if (state.audio) state.audio.dest.stream.getAudioTracks().forEach((t) => stream.addTrack(t));
  const mime = ["video/mp4;codecs=avc1,mp4a.40.2", "video/mp4", "video/webm;codecs=vp9,opus", "video/webm"].find((m) => MediaRecorder.isTypeSupported(m)) || "";
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8_000_000 });
  const chunks = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  rec.onstop = () => {
    const type = rec.mimeType || "video/webm";
    const blob = new Blob(chunks, { type });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${state.fileName}_${currentEffect().name.replace(/\s+/g, "")}.${type.includes("mp4") ? "mp4" : "webm"}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    state.recording = false;
    document.querySelectorAll("button, input, select").forEach((el) => { el.disabled = el.dataset.wasDisabled === "true"; });
    $("download").textContent = "영상 저장";
    v.muted = true;
    v.loop = true;
    v.play();
  };
  v.onended = () => { if (rec.state === "recording") rec.stop(); v.onended = null; };
  rec.start(500);
  await v.play();
}

/* ---------- 이벤트 ---------- */
$("file").onchange = (e) => loadFile(e.target.files[0]);
$("file2").onchange = (e) => loadFile(e.target.files[0]);
$("download").onclick = download;
$("reset").onclick = () => {
  const fx = currentEffect();
  state.params[fx.id] = { ...fx.defaults };
  buildControls();
  render();
};

const stage = $("stage");
stage.addEventListener("dragover", (e) => { e.preventDefault(); stage.classList.add("dragover"); });
stage.addEventListener("dragleave", () => stage.classList.remove("dragover"));
stage.addEventListener("drop", (e) => {
  e.preventDefault();
  stage.classList.remove("dragover");
  loadFile(e.dataTransfer.files[0]);
});
document.addEventListener("paste", (e) => {
  const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith("image/"));
  if (item) loadFile(item.getAsFile());
});

const cmp = $("compare");
const showOrig = (v) => { state.showOriginal = v; draw(); };
cmp.addEventListener("pointerdown", () => showOrig(true));
["pointerup", "pointerleave", "pointercancel"].forEach((ev) => cmp.addEventListener(ev, () => showOrig(false)));

buildCats();
buildEffects();
buildControls();
