// OWNER: app-glue agent. Performance-spike page (bench.html).
// Plain DOM (no Preact): 開始 → engine download → engine → tracker → front camera → live loop,
// with an fps / detect / render HUD, tier / params / delegate controls and a copyable 5 s sample log.
// 美體偵測 (body research report P0): PoseLandmarker lite/full × IMAGE/VIDEO × CPU/GPU on a picked photo — model
// load, graph creation, first and median detect time, mask size, visibility sanity — added to 複製結果. It needs
// no camera, so it can run from the start screen too.
// 輸出測試 (step-3 spec §6.4): decode, tiled render, encode, canvas-area and P2-with-geometry rows on synthetic frames
// (or a picked photo's decode, 輸出測試（選照片）), added to 複製結果. It needs the engine, so it sits in the live panel.
// 推臉筆 (push-brush spec §6.2): stamp, replay and field-upload rows (no camera, so on the start screen too) and the
// editor frame at 2048 with the strokes and every effect on (the 靜態圖片測試 photo's face, else sample_face.png from the
// dev server), on its own engine, GPU-complete without a readback, next to the strokes alone; added to 複製結果 with
// each row's budget (ok / OVER).
import { debugState, reportError } from '../app/debug';
import { type LiveLoop, type LiveStats, autoTierSession, resetAutoTierSession, startLiveLoop } from '../app/live';
import { type StillSession, createStillSession } from '../app/still';
import { legacyFrame } from '../edit/frame';
import { splitLegacy } from '../edit/legacy';
import { LiquifyModel } from '../edit/liquify';
import { patchPlan, readPatch } from '../edit/patch';
import { planSpot, spotRadius } from '../edit/spots';
import { defaultPhoto, neutralPerson } from '../edit/state';
import { strokesS30 } from '../edit/strokeFixtures';
import { ENGINE_PATHS, loadEngineAssets, loadPhotoDetector, loadPoseModel } from '../engine/assets';
import { createEngine, isWebGL2Supported } from '../engine/index';
import { applyPreset, resetGroup } from '../engine/params';
import { applyRatio, IDENTITY_GEOMETRY, rotateLeft } from '../geometry/view';
import { createCamera } from '../media/camera';
import { encodeJpeg } from '../media/exporter';
import { importPhoto } from '../media/importer';
import { adapt } from '../tracking/adapter111';
import { createBodyTracker } from '../tracking/bodyTracker';
import { createTracker } from '../tracking/tracker';
import type {
  BeautyParams,
  BodyDetection,
  CameraController,
  Delegate,
  Engine,
  EngineAssetsProgress,
  Geometry,
  ParamId,
  Prefs,
  RenderInput,
  Spot,
  Tracker,
} from '../types';
import { primaryBody } from '../detect/cache';
import { formatAdjustBench, runAdjustBench } from './adjustBench';
import { runExportBench } from './exportBench';
import { runFaceDetailRows } from './faceDetailBench';
import { benchReplay, benchStamps, formatLiquifyReport, liquifyFrameRows, uploadMs, type LiquifyBenchRow, type LiquifyFrameScene } from './liquifyBench';
import { mountMultiFace, noteFullRangeRun } from './multiFace';
import { formatToneBench, runToneBench, spotGrid, type ToneBenchCase } from './toneBench';
import {
  type BenchSample,
  type BodyBenchRow,
  type ExportBenchRow,
  formatElapsed,
  formatExportRows,
  formatMultiRows,
  formatReport,
  maskCoverage,
  median,
  summarize,
  visibilitySanity,
} from './report';

type Mode = 'skin' | 'skin+shape' | 'all';

const MODES: { id: Mode; label: string }[] = [
  { id: 'skin', label: '美膚' },
  { id: 'skin+shape', label: '美膚+美型' },
  { id: 'all', label: '全部' },
];
const TIERS: { id: Prefs['tier']; label: string }[] = [
  { id: 'H', label: 'H' },
  { id: 'M', label: 'M' },
  { id: 'L', label: 'L' },
  { id: 'auto', label: '自動' },
];
const SAMPLE_EVERY_MS = 5000;
const SHOWN_ROWS = 8;

interface BodyConfig {
  variant: 'full' | 'lite';
  mode: 'IMAGE' | 'VIDEO';
  requested: Delegate;
}
/**
 * Masks only for IMAGE on the GPU (the photo-editor configuration): CPU + masks aborts the wasm in 0.10.35, and
 * live (VIDEO) would run without masks (BR P2), so the VIDEO rows measure landmarks only.
 */
const BODY_CONFIGS: BodyConfig[] = (['lite', 'full'] as const).flatMap((variant) =>
  (['IMAGE', 'VIDEO'] as const).flatMap((mode) => (['CPU', 'GPU'] as const).map((requested) => ({ variant, mode, requested }))),
);
const BODY_RUNS: Record<BodyConfig['mode'], number> = { IMAGE: 5, VIDEO: 15 };

/** 自然 = skin + shape; "all" adds a LUT filter and both makeup parts (氣色 preset) to load every pass. */
function paramsFor(mode: Mode): BeautyParams {
  if (mode === 'skin') return resetGroup(applyPreset('natural'), 'shape');
  if (mode === 'all') return applyPreset('glow');
  return applyPreset('natural');
}

const prefs: Prefs = {
  mirrorOnSave: true,
  tier: 'auto',
  matchGpupixel: false,
  showLandmarks: false,
  delegate: 'auto',
  installHintDismissed: true,
  exportFormat: 'jpeg',
  exportSize: 'full',
};

let mode: Mode = 'skin+shape';
let params = paramsFor(mode);
let camera: CameraController | null = null;
let engine: Engine | null = null;
let tracker: Tracker | null = null;
let model: Uint8Array | null = null;
/** the full-range photo detector, as the app's tracker gets it (read at each photo); null until it downloads, or if it fails */
let photoDetector: Uint8Array | null = null;
let loop: LiveLoop | null = null;
let still: StillSession | null = null;
/** the still session's photo (the session closes it on dispose): 臉型細項＋美妝 renders it at 1080 / 2048 */
let stillBitmap: ImageBitmap | null = null;
/** the bench's still frame: the current params on the photo's first face (v0.3's one-face render) */
const stillFrame = (s: StillSession) => legacyFrame(params, s.faces[0]?.face ?? null, 1);
let stats: LiveStats | null = null;
/** first live-loop start; sample times and elapsed stay monotonic across loop restarts */
let startedAt = 0;
let busy = false;
const samples: BenchSample[] = [];
const bodyRows: BodyBenchRow[] = [];
let exportRows: ExportBenchRow[] = [];
/** step-5 rows (face-detail spec §6.2 rows 1–3), one text line per measurement */
const faceDetailRows: string[] = [];
/** step-6 rows (push-brush spec §6.2): 推臉筆 stamp, replay, upload and frame */
const liquifyRows: LiquifyBenchRow[] = [];

// ───────────────────────── DOM ─────────────────────────

const STYLE = `
:root { color-scheme: dark; }
html, body { margin: 0; height: 100%; background: #000; color: #fff; overflow: hidden;
  font: 13px/1.35 -apple-system, "PingFang TC", "Noto Sans TC", system-ui, sans-serif;
  -webkit-user-select: none; user-select: none; -webkit-text-size-adjust: 100%; }
#bench { position: fixed; inset: 0; }
canvas.view { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; background: #000; touch-action: none; }
.hud { position: absolute; left: max(env(safe-area-inset-left), 8px); top: max(env(safe-area-inset-top), 8px);
  right: max(env(safe-area-inset-right), 8px); pointer-events: none; }
.hud pre { margin: 0; display: inline-block; max-width: 100%; padding: 6px 8px; border-radius: 8px; background: rgba(0,0,0,.62);
  font: 12px/1.4 ui-monospace, Menlo, monospace; white-space: pre-wrap; word-break: break-all; }
.hud .err { color: #FF453A; }
.panel { position: absolute; left: 0; right: 0; bottom: 0; padding: 8px max(env(safe-area-inset-right), 8px)
  max(env(safe-area-inset-bottom), 8px) max(env(safe-area-inset-left), 8px); background: rgba(0,0,0,.72); }
.row { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-top: 6px; }
.row > span { color: #8E8E93; min-width: 2.5em; }
button { appearance: none; border: 1px solid #4A4A4C; background: #1C1C1E; color: #fff; border-radius: 8px;
  min-height: 36px; padding: 0 10px; font: inherit; touch-action: manipulation; }
button.on { border-color: #B8F02A; color: #B8F02A; }
button:disabled { opacity: .4; }
button.primary { background: #B8F02A; color: #000; border-color: #B8F02A; font-weight: 600; }
.gate { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 14px; padding: 24px; text-align: center; }
.gate h1 { margin: 0; font-size: 20px; font-weight: 600; }
.gate p { margin: 0; color: #8E8E93; max-width: 30em; }
.gate button.primary { min-width: 160px; min-height: 52px; font-size: 18px; border-radius: 26px; }
.note { color: #B8F02A; font: 12px/1.4 ui-monospace, Menlo, monospace; white-space: pre-wrap; }
.body-bench { max-width: 100%; max-height: 40vh; overflow: auto; text-align: left; -webkit-user-select: text; user-select: text; }
.body-bench td:nth-child(-n+3), .body-bench th:nth-child(-n+3) { text-align: left; }
/* 多臉 (bench/multiFace.ts): own classes so the harness locators .body-bench and .gate .note stay unique */
.multi-bench { max-width: 100%; max-height: 40vh; overflow: auto; text-align: left; -webkit-user-select: text; user-select: text; }
.multi-note { color: #B8F02A; font: 12px/1.4 ui-monospace, Menlo, monospace; white-space: pre-wrap; }
.adjust-note { color: #B8F02A; font: 12px/1.4 ui-monospace, Menlo, monospace; white-space: pre-wrap; text-align: left; }
.tone-note { color: #B8F02A; font: 12px/1.4 ui-monospace, Menlo, monospace; white-space: pre-wrap; text-align: left; }
.liquify-note { margin: 0; color: #B8F02A; font: 12px/1.4 ui-monospace, Menlo, monospace; white-space: pre-wrap; text-align: left; }
table { border-collapse: collapse; width: 100%; font: 11px/1.3 ui-monospace, Menlo, monospace; margin-top: 6px; }
td, th { padding: 1px 4px; text-align: right; color: #ddd; } th { color: #8E8E93; font-weight: 400; }
textarea { width: 100%; height: 30vh; background: #1C1C1E; color: #fff; border: 1px solid #4A4A4C; border-radius: 8px;
  font: 11px/1.3 ui-monospace, Menlo, monospace; -webkit-user-select: text; user-select: text; }
[hidden] { display: none !important; }
`;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...children);
  return e;
}

function button(label: string, onClick: (ev: MouseEvent) => void, cls = ''): HTMLButtonElement {
  const b = el('button', { type: 'button', textContent: label, className: cls });
  b.addEventListener('click', onClick);
  return b;
}

const root = document.getElementById('bench') ?? document.body.appendChild(el('div', { id: 'bench' }));
document.head.appendChild(el('style', { textContent: STYLE }));

const canvas = el('canvas', { className: 'view' });
const hudText = el('pre');
const hudErr = el('pre', { className: 'err', hidden: true });
const hud = el('div', { className: 'hud' }, hudText, el('br'), hudErr);
hud.hidden = true;

const startBtn = button('開始', () => void start(), 'primary');
const gateMsg = el('p', { textContent: '測量即時美顏在這台裝置上的效能：偵測、渲染時間與 fps。需要相機權限，所有處理都在裝置上完成。' });
const gateProgress = el('div', { className: 'note' });
const gateBodyBtn = button('美體偵測', () => bodyTest());
const gateAdjustBtn = button('調節效能', () => void runAdjust());
// in the live panel too: after 開始 the row also times the camera frame at tier H (step-2 spec §6.4)
const adjustBtn = button('調節效能', () => void runAdjust());
// own class, not .note: tests/harness/t8/run-bench.mjs and bench.spec.ts need '.gate .note' to be gateProgress alone
const adjustOut = el('div', { className: 'adjust-note', id: 'adjust-bench' });
const gateLiquifyBtn = button('推臉筆', () => void liquifyBench());
const liquifyBtn = button('推臉筆', () => void liquifyBench());
// own class, not .note: bench.spec.ts and tests/harness/t8/run-bench*.mjs need '.gate .note' and '.panel .note' to stay unique
const liquifyOut = el('pre', { className: 'liquify-note' });
const gate = el(
  'div',
  { className: 'gate' },
  el('h1', { textContent: 'Mona Misa Bench' }),
  gateMsg,
  startBtn,
  gateProgress,
  el('p', { textContent: '美體偵測：選一張全身照，量測姿態模型的載入、偵測時間與遮罩（不需相機）。' }),
  gateBodyBtn,
  gateLiquifyBtn,
  el('p', { textContent: '調節效能：在 1080×1920 量測調節與質感的 GPU 時間、調節程式的編譯時間，並檢查顆粒雜湊與 CPU 版本一致（不需相機；按「開始」後在面板再量一次，會加上相機畫面）。' }),
  gateAdjustBtn,
  adjustOut,
);

const tierBtns = TIERS.map((t) => {
  const b = button(t.label, () => setTier(t.id));
  b.dataset.tier = t.id;
  return b;
});
const modeBtns = MODES.map((m) => {
  const b = button(m.label, () => setMode(m.id));
  b.dataset.mode = m.id;
  return b;
});
const delegateBtn = button('改用 CPU 重啟', () => void restartTracker());
const landmarksBtn = button('特徵點', () => {
  prefs.showLandmarks = !prefs.showLandmarks;
  syncButtons();
  // the live loop re-syncs engine options from prefs; a still session needs them pushed + a redraw
  if (still && engine) {
    engine.setOptions({ showLandmarks: prefs.showLandmarks });
    still.render(stillFrame(still));
  }
});
const compareBtn = button('按住對比', () => {});
const captureBtn = button('擷取測試', () => void captureTest());
const stillBtn = button('靜態圖片測試', () => void stillTest());
const faceDetailBtn = button('臉型細項＋美妝', () => void runFaceDetail());
const copyBtn = button('複製結果', () => copyResults());
const bodyBtn = button('美體偵測', () => bodyTest());
const toneBtn = button('膚質量測', () => toneTest());
const bodyOut = el('div', { className: 'note' });
const exportBtn = button('輸出測試', () => void runExport());
// synchronous inside the tap (iOS user-activation rule, as bodyTest); exportInput is declared after bodyInput
const exportPhotoBtn = button('輸出測試（選照片）', () => {
  if (!busy && engine) exportInput.click();
});
const bodyTable = el('tbody');
const bodyCopyBtn = button('複製結果', () => copyResults());
bodyCopyBtn.hidden = true;
const bodySection = el(
  'div',
  { className: 'body-bench' },
  bodyOut,
  el(
    'table',
    {},
    el('thead', {}, el('tr', {}, ...['模型', '模式', '委派', '建立', '首次', '偵測', '遮罩', '可見'].map((h) => el('th', { textContent: h })))),
    bodyTable,
  ),
  bodyCopyBtn,
);
// 多臉 (v0.4 step 1 Phase 0): on the start screen, like 美體偵測 (no camera needed); results join 複製結果
const multi = mountMultiFace(gate);
const resumeBtn = button('恢復相機', () => void camera?.resume().catch((e: unknown) => showError('resume', e)), 'primary');
resumeBtn.hidden = true;
const note = el('div', { className: 'note' });
const tableBody = el('tbody');
const table = el(
  'table',
  {},
  el('thead', {}, el('tr', {}, ...['t', 'fps', 'det', 'ren', 'tier', 'face'].map((h) => el('th', { textContent: h })))),
  tableBody,
);
const copyArea = el('textarea', { readOnly: true, hidden: true });

const panel = el(
  'div',
  { className: 'panel' },
  el('div', { className: 'row' }, el('span', { textContent: '畫質' }), ...tierBtns),
  el('div', { className: 'row' }, el('span', { textContent: '參數' }), ...modeBtns),
  el('div', { className: 'row' }, delegateBtn, landmarksBtn, compareBtn, captureBtn, stillBtn, faceDetailBtn, bodyBtn, liquifyBtn, toneBtn, adjustBtn, exportBtn, exportPhotoBtn, resumeBtn),
  el('div', { className: 'row' }, copyBtn, note),
  table,
  copyArea,
);
panel.hidden = true;

root.append(canvas, hud, panel, gate);

compareBtn.addEventListener('pointerdown', () => setCompare(true));
for (const type of ['pointerup', 'pointercancel', 'pointerleave'] as const)
  compareBtn.addEventListener(type, () => setCompare(false));

const dbg = debugState();
if (dbg) dbg.screen = 'bench';

window.addEventListener('error', (e) => showError('error', e.error ?? e.message));
window.addEventListener('unhandledrejection', (e) => showError('unhandledrejection', e.reason));

// ───────────────────────── flow ─────────────────────────

async function start(): Promise<void> {
  if (busy) return;
  busy = true;
  startBtn.disabled = true;
  try {
    if (!isWebGL2Supported()) throw new Error('此裝置不支援 WebGL2');
    // getUserMedia first, synchronously inside the tap (iOS gesture rule); assets download in parallel.
    // A retry after a failure reuses the camera / engine instead of stacking new ones on the canvas.
    if (!camera) {
      camera = createCamera();
      camera.subscribe(onCamera);
    }
    const camStarted = camera.snapshot.state === 'live' ? Promise.resolve() : camera.start('user');
    camStarted.catch(() => {}); // surfaced below, after the downloads

    const assets = await loadEngineAssets(onProgress);
    model = assets.modelBuffer;
    // as services.ts: the camera does not wait for the photo detector
    void loadPhotoDetector().then(
      (d) => (photoDetector = d),
      () => undefined,
    );
    gateProgress.textContent = '建立 GPU 引擎…';
    engine ??= createEngine(canvas, { mirror: true, matchGpupixel: false, showLandmarks: false });
    await engine.ready;
    gateProgress.textContent = '建立臉部偵測器…';
    tracker ??= await makeTracker('auto');
    gateProgress.textContent = '開啟相機…';
    await camStarted;
    if (camera.snapshot.state === 'error') throw new Error(`相機錯誤：${camera.snapshot.error ?? 'unknown'}`);
    gate.hidden = true;
    hud.hidden = false;
    panel.hidden = false;
    startLoop();
    window.setInterval(takeSample, SAMPLE_EVERY_MS);
    window.setInterval(updateHud, 1000);
  } catch (err) {
    showError('start', err);
    gateProgress.textContent = `失敗：${errText(err)}`;
    startBtn.disabled = false;
  } finally {
    busy = false;
  }
}

function onProgress(p: EngineAssetsProgress): void {
  const mb = (n: number) => (n / 1048576).toFixed(1);
  gateProgress.textContent =
    p.phase === 'model'
      ? `下載模型 ${mb(p.loaded)}${p.total ? ` / ${mb(p.total)}` : ''} MB`
      : p.phase === 'wasm'
        ? '下載偵測器 wasm…'
        : '下載完成';
}

async function makeTracker(delegate: 'auto' | Delegate): Promise<Tracker | null> {
  if (!model) return null;
  try {
    // (MediaPipe copies the model buffer, so a delegate restart can pass the same one again)
    const t = await createTracker({ modelBuffer: model, fullRangeDetector: () => photoDetector, wasmBase: ENGINE_PATHS.wasmBase, delegate });
    if (dbg) dbg.delegate = t.delegate;
    return t;
  } catch (err) {
    showError('tracker (基本模式)', err);
    if (dbg) dbg.delegate = null;
    return null;
  }
}

function startLoop(): void {
  if (!camera || !engine) return;
  loop?.stop();
  stats = null;
  startedAt ||= performance.now();
  loop = startLiveLoop({
    camera,
    engine,
    tracker,
    getLook: () => splitLegacy(params),
    getAll: () => false,
    getPrefs: () => prefs,
    onStats: (s) => {
      stats = s;
      updateHud();
    },
  });
  syncButtons();
  updateHud();
}

function onCamera(): void {
  if (!camera) return;
  const s = camera.snapshot;
  if (dbg) dbg.cameraState = s.state;
  resumeBtn.hidden = s.state !== 'interrupted';
  if (s.state === 'error') showError('camera', new Error(s.error ?? 'unknown'));
  updateHud();
}

function setTier(t: Prefs['tier']): void {
  // re-selecting 自動 restarts the measurement from H (the app never steps back up by itself)
  if (t === 'auto') resetAutoTierSession();
  prefs.tier = t;
  syncButtons();
}

function setMode(m: Mode): void {
  mode = m;
  params = paramsFor(m);
  if (still) still.render(stillFrame(still));
  syncButtons();
}

function setCompare(on: boolean): void {
  loop?.setCompare(on);
  still?.setCompare(on);
}

async function restartTracker(): Promise<void> {
  if (busy || !engine) return;
  busy = true;
  delegateBtn.disabled = true;
  const next: 'auto' | Delegate = tracker?.delegate === 'CPU' ? 'auto' : 'CPU';
  try {
    loop?.stop();
    loop = null;
    tracker?.close();
    tracker = null;
    note.textContent = `重新建立偵測器（${next === 'CPU' ? 'CPU' : 'GPU'}）…`;
    tracker = await makeTracker(next);
    note.textContent = `delegate: ${tracker?.delegate ?? '無（基本模式）'}`;
    if (!still) startLoop();
  } finally {
    busy = false;
    delegateBtn.disabled = false;
    syncButtons();
  }
}

async function captureTest(): Promise<void> {
  if (!loop) return;
  try {
    const t0 = performance.now();
    const img = loop.capture()?.image ?? null;
    const t1 = performance.now();
    if (!img) {
      note.textContent = '尚無畫面';
      return;
    }
    const file = await encodeJpeg(img);
    const t2 = performance.now();
    note.textContent =
      `擷取 ${img.width}×${img.height}：render+readback ${(t1 - t0).toFixed(0)} ms，` +
      `JPEG ${(t2 - t1).toFixed(0)} ms，${(file.size / 1024).toFixed(0)} KB`;
  } catch (err) {
    showError('capture', err);
  }
}

// The still test runs on a photo picked from the device (camera roll on the iPhone). No fixed URL: a
// test photo in public/ would be deployed with the site, and it is usually someone's face.
const photoInput = (() => {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.tabIndex = -1;
  input.setAttribute('aria-hidden', 'true');
  // in the document (not display:none) so iOS opens the picker reliably
  input.style.cssText = 'position:fixed;left:-100px;top:0;width:1px;height:1px;opacity:0';
  input.addEventListener('change', () => {
    const f = input.files?.[0];
    input.value = '';
    if (f) void runStill(f);
  });
  root.appendChild(input);
  return input;
})();

function stillTest(): void {
  if (still) {
    if (busy) return;
    // second tap = back to the camera
    still.dispose();
    still = null;
    stillBitmap = null;
    stillBtn.textContent = '靜態圖片測試';
    startLoop();
    return;
  }
  if (!engine || busy) return;
  // synchronous inside the tap (iOS user-activation rule); busy is set only once a file arrives, since a
  // cancelled picker may fire no event at all
  photoInput.click();
}

async function runStill(file: File): Promise<void> {
  if (!engine || busy || still) return;
  busy = true;
  try {
    const bitmap = await importPhoto(file, 2048);
    loop?.stop();
    loop = null;
    const t0 = performance.now();
    still = createStillSession(engine, tracker, bitmap);
    // the full-range graph's GPU programs are compiled now: row D's app rows are no longer cold on this page
    if (tracker?.photoDetector === 'full-range') noteFullRangeRun();
    stillBitmap = bitmap;
    const detectMs = performance.now() - t0;
    still.render(stillFrame(still));
    const times: number[] = [];
    for (let i = 0; i < 5; i++) {
      const t = performance.now();
      still.exportImageData(stillFrame(still));
      times.push(performance.now() - t);
    }
    times.sort((a, b) => a - b);
    note.textContent =
      `靜態 ${still.width}×${still.height}：detect+adapt ${detectMs.toFixed(0)} ms，臉 ${still.faces.length ? '✓' : '✗'}，` +
      `全解析 render+readback 中位數 ${times[2].toFixed(0)} ms`;
    stillBtn.textContent = '返回相機';
  } catch (err) {
    showError('still', err);
  } finally {
    busy = false;
    syncButtons();
  }
}

// ───────────────────────── 臉型細項＋美妝 (face-detail spec §6.2 rows 1–3) ─────────────────────────

async function runFaceDetail(): Promise<void> {
  const face = still?.faces[0]?.face;
  if (!engine || !still || !stillBitmap || !face || busy) {
    note.textContent = '先用「靜態圖片測試」選一張有臉的照片';
    return;
  }
  busy = true;
  try {
    note.textContent = '臉型細項＋美妝：量測中…';
    const rows = await runFaceDetailRows(engine, stillBitmap, face);
    faceDetailRows.push(...rows);
    note.textContent = rows.join('\n');
  } catch (err) {
    showError('faceDetail', err);
  } finally {
    busy = false;
    // the bench frames left the canvas on a 10-face grid: show the still photo again
    if (still) still.render(stillFrame(still));
    syncButtons();
  }
}

// ───────────────────────── 美體偵測 ─────────────────────────

const bodyInput = (() => {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.tabIndex = -1;
  input.setAttribute('aria-hidden', 'true');
  input.style.cssText = 'position:fixed;left:-100px;top:0;width:1px;height:1px;opacity:0';
  input.addEventListener('change', () => {
    const f = input.files?.[0];
    input.value = '';
    if (f) void runBodyBench(f);
  });
  root.appendChild(input);
  return input;
})();

function bodyTest(): void {
  if (busy) return;
  bodyInput.click(); // synchronous inside the tap (iOS user-activation rule)
}

// ───────────────────────── 輸出測試 (step-3 spec §6.4) ─────────────────────────

// in the document and not display:none / hidden, like bodyInput: iOS then opens the picker reliably. Appended after
// bodyInput, so tests/harness/b3/bench.mjs's input[type=file] nth(1) stays the 美體偵測 input.
const exportInput = el('input', { type: 'file', accept: 'image/*', tabIndex: -1 });
exportInput.setAttribute('aria-hidden', 'true');
exportInput.style.cssText = 'position:fixed;left:-100px;top:0;width:1px;height:1px;opacity:0';
exportInput.addEventListener('change', () => {
  const f = exportInput.files?.[0];
  exportInput.value = '';
  if (f) void runExport(f);
});
root.appendChild(exportInput);

async function runExport(picked?: File): Promise<void> {
  if (busy || !engine) return;
  busy = true;
  exportBtn.disabled = exportPhotoBtn.disabled = true;
  // the export pauses the display (S §2.3): live frames between tiles would resize the FBOs and skew the tile times
  const wasLive = loop !== null;
  loop?.stop();
  loop = null;
  try {
    exportRows = [];
    await runExportBench(
      engine,
      (r) => {
        exportRows.push(r);
        note.textContent = `輸出：${r.name} ${r.ms === null ? '—' : `${r.ms.toFixed(0)} ms`}`;
      },
      picked,
    );
    const failed = exportRows.filter((r) => r.detail.startsWith('failed:')).length; // not the manual share row
    note.textContent = `輸出：完成 ${exportRows.length} 列${failed > 0 ? `，${failed} 項失敗` : ''}（複製結果）`;
  } catch (err) {
    showError('export bench', err);
  } finally {
    busy = false;
    exportBtn.disabled = exportPhotoBtn.disabled = false;
    if (wasLive && !still) startLoop();
  }
}

async function runAdjust(): Promise<void> {
  if (busy) return;
  busy = true;
  gateAdjustBtn.disabled = adjustBtn.disabled = true;
  (gate.hidden ? panel : gate).append(adjustOut);
  adjustOut.dataset.state = 'running';
  adjustOut.textContent = '量測中…';
  // the camera frame at tier H (S §6.4) needs the live camera; the live loop pauses meanwhile, as the export bench does
  const video = camera?.snapshot.state === 'live' ? camera.video : null;
  const wasLive = loop !== null;
  loop?.stop();
  loop = null;
  try {
    const r = await runAdjustBench(video);
    adjustOut.replaceChildren(el('pre', { textContent: formatAdjustBench(r) }));
    adjustOut.dataset.state = 'done';
  } catch (err) {
    showError('adjust', err);
    adjustOut.textContent = `失敗：${errText(err)}`;
    adjustOut.dataset.state = 'failed';
  } finally {
    busy = false;
    gateAdjustBtn.disabled = adjustBtn.disabled = false;
    if (wasLive && !still) startLoop();
  }
}

interface MemoryInfo {
  usedJSHeapSize: number;
}

function heapMb(): number {
  const m = (performance as Performance & { memory?: MemoryInfo }).memory;
  return m ? m.usedJSHeapSize / 1048576 : 0;
}

const nextPaint = () => new Promise<void>((r) => requestAnimationFrame(() => setTimeout(r, 0)));

async function runBodyBench(file: File): Promise<void> {
  if (busy) return;
  busy = true;
  gateBodyBtn.disabled = bodyBtn.disabled = true;
  (gate.hidden ? panel : gate).append(bodySection);
  bodyCopyBtn.hidden = true;
  try {
    const bitmap = await importPhoto(file, 2048);
    const size = `${bitmap.width}×${bitmap.height}`;
    // VIDEO mode is fed a canvas holding the photo: the same frame every time, so tracking from the previous
    // result kicks in as it would on a steady live subject
    const frame = el('canvas', { width: bitmap.width, height: bitmap.height });
    frame.getContext('2d')?.drawImage(bitmap, 0, 0);
    bodyRows.length = 0;
    const loaded = new Set<string>();
    renderBodyTable();
    for (const cfg of BODY_CONFIGS) {
      bodyOut.textContent = `${size}：量測 ${cfg.variant} ${cfg.mode} ${cfg.requested}…`;
      await nextPaint();
      bodyRows.push(await measureBody(cfg, bitmap, frame, loaded));
      renderBodyTable();
    }
    bitmap.close();
    const failed = bodyRows.filter((r) => r.error).length;
    bodyOut.textContent = `${size}：完成（ms；遮罩 off = 未要求）${failed ? `，${failed} 項失敗` : ''}`;
    bodyCopyBtn.hidden = false;
  } catch (err) {
    showError('body', err);
    bodyOut.textContent = `失敗：${errText(err)}`;
  } finally {
    busy = false;
    gateBodyBtn.disabled = bodyBtn.disabled = false;
  }
}

/**
 * The liquify.frame photo (PB §6.2, "Editor frame at 2048"): the 靜態圖片測試 photo and its first face when one is open
 * (importPhoto keeps it at ≤ 2048 on the long edge); else sample_face.png with its recorded landmarks, scaled to 2048
 * (the dev server serves /tests/fixtures); else a 1536 × 2048 gradient without a face.
 */
async function liquifyScene(): Promise<{ scene: LiquifyFrameScene; label: string }> {
  const face = still?.faces[0]?.face;
  if (stillBitmap && face) return { scene: { source: stillBitmap, width: stillBitmap.width, height: stillBitmap.height, face }, label: '靜態圖片' };
  try {
    const [img, lm] = await Promise.all([
      fetch('/tests/fixtures/sample_face.png').then((r) => (r.ok ? r.blob() : Promise.reject(new Error(`${r.status}`)))),
      fetch('/tests/fixtures/landmarks_sample_face.json').then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${r.status}`)))),
    ]);
    const bmp = await createImageBitmap(img as Blob);
    const k = 2048 / Math.max(bmp.width, bmp.height);
    const width = Math.round(bmp.width * k);
    const height = Math.round(bmp.height * k);
    const c = el('canvas', { width, height });
    c.getContext('2d')?.drawImage(bmp, 0, 0, width, height);
    bmp.close();
    const points = (lm as { points: number[] }).points;
    return { scene: { source: c, width, height, face: adapt({ points: new Float32Array(points) }, width, height) }, label: 'sample_face.png' };
  } catch {
    const c = el('canvas', { width: 1536, height: 2048 });
    const ctx = c.getContext('2d');
    if (ctx) {
      const grad = ctx.createLinearGradient(0, 0, 1536, 2048);
      grad.addColorStop(0, '#806050');
      grad.addColorStop(1, '#d0b0a0');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 1536, 2048);
    }
    return { scene: { source: c, width: 1536, height: 2048, face: null }, label: '無臉（先開靜態圖片測試）' };
  }
}

/** liquify.frame on its own engine (the live engine keeps its state and loop): every effect on, and the strokes alone */
async function liquifyFrame(): Promise<string> {
  const { scene, label } = await liquifyScene();
  const frame = { width: scene.width, height: scene.height };
  const m = new LiquifyModel(frame, { syncWork: Infinity });
  m.sync(strokesS30(frame));
  const canvas = el('canvas');
  const eng = createEngine(canvas, { mirror: false });
  try {
    await eng.ready;
    await eng.loadLut('look', 'film');
    const { rows, passes } = liquifyFrameRows(eng, scene, m, 'film');
    liquifyRows.push(...rows);
    return `${label}：${passes.filter((p) => !p.startsWith('mk.')).join(' ')}`;
  } finally {
    m.dispose();
    eng.dispose();
    canvas.getContext('webgl2')?.getExtension('WEBGL_lose_context')?.loseContext();
  }
}

async function liquifyBench(): Promise<void> {
  if (busy) return;
  busy = true;
  gateLiquifyBtn.disabled = liquifyBtn.disabled = true;
  (gate.hidden ? panel : gate).append(liquifyOut);
  try {
    liquifyRows.length = 0;
    const frame = { width: 1536, height: 2048 };
    liquifyOut.textContent = '推臉筆：量測筆刷…';
    await nextPaint();
    liquifyRows.push(...benchStamps(frame));
    liquifyOut.textContent = '推臉筆：量測重播…';
    await nextPaint();
    liquifyRows.push(...benchReplay(frame));
    const m = new LiquifyModel(frame, { syncWork: Infinity });
    m.sync(strokesS30(frame));
    const gl = el('canvas').getContext('webgl2');
    if (gl && m.field) liquifyRows.push({ name: 'liquify.upload', value: uploadMs(gl, m.field), unit: 'ms', budget: 2 });
    // free the throwaway context now: past the browser's context limit the oldest one (the engine's) would be lost
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    m.dispose();
    liquifyOut.textContent = '推臉筆：量測 2048 畫面…';
    await nextPaint();
    // the live loop pauses meanwhile: its frames would share the GPU with the timed ones
    const wasLive = loop !== null;
    loop?.stop();
    loop = null;
    let scene = '';
    try {
      scene = await liquifyFrame();
    } finally {
      if (wasLive && !still) startLoop();
    }
    liquifyOut.textContent = `${formatLiquifyReport(liquifyRows).trim()}\n${scene}`;
  } catch (err) {
    showError('liquify', err);
    liquifyOut.textContent = `失敗：${errText(err)}`;
  } finally {
    busy = false;
    gateLiquifyBtn.disabled = liquifyBtn.disabled = false;
  }
}

/** Compact on-screen table; the full TSV (load, mask coverage, heap, errors) goes to 複製結果. */
function renderBodyTable(): void {
  bodyTable.replaceChildren(
    ...bodyRows.map((r) =>
      el(
        'tr',
        {},
        ...[
          r.variant,
          r.mode,
          r.delegate === r.requested ? (r.delegate ?? '–') : `${r.requested}→${r.delegate ?? '✗'}`,
          r.createMs.toFixed(0),
          r.firstMs.toFixed(0),
          r.error ? '✗' : r.detectMs.toFixed(1),
          r.mask,
          r.error ? r.error.slice(0, 24) : `${r.visibility.ok}/33`,
        ].map((v) => el('td', { textContent: v })),
      ),
    ),
  );
}

async function measureBody(
  cfg: BodyConfig,
  bitmap: ImageBitmap,
  frame: HTMLCanvasElement,
  loaded: Set<string>,
): Promise<BodyBenchRow> {
  const row: BodyBenchRow = {
    ...cfg,
    delegate: null,
    loadMs: 0,
    createMs: 0,
    firstMs: 0,
    detectMs: 0,
    n: 0,
    people: 0,
    mask: '-',
    maskCoverage: 0,
    visibility: { present: false, min: 0, mean: 0, ok: 0, inFrame: 0 },
    error: null,
    heapMb: 0,
  };
  const outputMask = cfg.requested === 'GPU' && cfg.mode === 'IMAGE';
  let t = performance.now();
  try {
    const model = await loadPoseModel(cfg.variant, (p) => {
      if (p.phase === 'model') bodyOut.textContent = `下載 ${cfg.variant} 模型 ${(p.loaded / 1048576).toFixed(1)} MB`;
    });
    // first-load cost only for the first configuration of a variant; later ones hit the memo
    if (!loaded.has(cfg.variant)) row.loadMs = performance.now() - t;
    loaded.add(cfg.variant);
    t = performance.now();
    const tracker = await createBodyTracker({
      modelBuffer: model.slice(), // re-read on graph rebuilds: each tracker gets its own copy
      wasmBase: ENGINE_PATHS.wasmBase,
      variant: cfg.variant,
      delegate: cfg.requested,
      runningMode: cfg.mode,
      outputMask,
    });
    row.createMs = performance.now() - t;
    row.delegate = tracker.delegate;
    try {
      let ts = performance.now();
      const detect = (): BodyDetection | null =>
        primaryBody(cfg.mode === 'IMAGE' ? tracker.detect(bitmap) : tracker.detectVideo(frame as unknown as HTMLVideoElement, (ts += 33)));
      t = performance.now();
      let det = detect();
      row.firstMs = performance.now() - t;
      const times: number[] = [];
      for (let i = 0; i < BODY_RUNS[cfg.mode]; i++) {
        t = performance.now();
        det = detect() ?? det;
        times.push(performance.now() - t);
      }
      row.detectMs = median(times);
      row.n = times.length;
      row.heapMb = heapMb();
      if (det) {
        row.people = det.people;
        row.visibility = visibilitySanity(det.pose.points);
        row.maskCoverage = maskCoverage(det);
      }
      row.mask = !outputMask ? 'off' : det?.mask ? `${det.mask.width}x${det.mask.height}` : 'none';
    } finally {
      tracker.close();
    }
  } catch (err) {
    row.error = errText(err);
  }
  return row;
}

function takeSample(): void {
  if (!loop || !stats) return;
  samples.push({
    t: (performance.now() - startedAt) / 1000,
    fps: stats.fps,
    detectMs: stats.detectMs,
    renderMs: stats.renderMs,
    tier: stats.tier,
    face: stats.face,
    mode,
    delegate: tracker?.delegate ?? 'none',
  });
  renderTable();
}

function renderTable(): void {
  const rows = samples.slice(-SHOWN_ROWS).reverse();
  tableBody.replaceChildren(
    ...rows.map((s) =>
      el(
        'tr',
        {},
        ...[s.t.toFixed(0), s.fps.toFixed(1), s.detectMs.toFixed(1), s.renderMs.toFixed(1), s.tier, s.face ? '✓' : '✗'].map(
          (v) => el('td', { textContent: v }),
        ),
      ),
    ),
  );
}

// ───────────────────────── 膚質 (skin-cleanup spec §6) ─────────────────────────

// own class, not .note: tests/harness/t8/run-bench*.mjs and bench.spec.ts need '.panel .note' to be the 複製結果 note alone
const toneOut = el('pre', { className: 'tone-note', id: 'tone-bench' });
const toneInput = (() => {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.tabIndex = -1;
  input.setAttribute('aria-hidden', 'true');
  input.style.cssText = 'position:fixed;left:-100px;top:0;width:1px;height:1px;opacity:0';
  input.addEventListener('change', () => {
    const f = input.files?.[0];
    input.value = '';
    if (f) void runToneBenchUi(f);
  });
  root.appendChild(input);
  return input;
})();
let toneReport = '';
panel.append(toneOut);

function toneTest(): void {
  if (busy || !engine) return;
  toneInput.click(); // synchronous inside the tap (iOS user-activation rule), as bodyTest
}

async function runToneBenchUi(file: File): Promise<void> {
  if (busy || !engine) return;
  busy = true;
  try {
    const bitmap = await importPhoto(file, 2048);
    const lms = tracker ? tracker.detectImage(bitmap, { maxFaces: 1 }) : [];
    if (!lms.length) throw new Error('沒有偵測到臉部');
    const face = adapt(lms[0], bitmap.width, bitmap.height);
    const photo = { ...defaultPhoto(), spots: [] as Spot[] };
    const person = (v: Partial<Record<ParamId, number>>) => ({ ...neutralPerson(), values: { ...neutralPerson().values, ...v } });
    const input = (v: Partial<Record<ParamId, number>>, spots: Spot[] = [], geometry?: Geometry): RenderInput => ({
      source: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      faces: [{ face, weight: 1, person: person(v), protect: null }],
      obstacles: [],
      globalSkin: null,
      photo: { ...photo, spots, ...(geometry ? { geometry } : {}) },
      // the engine draws the view from RenderInput.geometry (as still.ts passes it), not from photo.geometry
      ...(geometry ? { geometry } : {}),
    });
    const all = { 'tone.even': 0.5, 'tone.warmth': 0.65, 'tone.darkCircle': 0.5, 'tone.nasolabial': 0.5, 'tone.teeth': 0.5, 'tone.eyeBright': 0.5 };
    const box = { x: 0.25, y: 0.3, w: 0.5, h: 0.4 };
    const s20 = spotGrid(20, box);
    const crop34 = rotateLeft(applyRatio(IDENTITY_GEOMETRY, '3:4', bitmap));
    const cases: ToneBenchCase[] = [
      { row: 'frame (no 膚質)', input: () => input({}) },
      { row: '+ every tone tool, field cached', input: () => input(all) },
      { row: '+ field rebuild every frame (勻膚 0.50 ↔ 0.51)', input: (i) => input({ ...all, 'tone.even': i % 2 ? 0.51 : 0.5 }) },
      { row: '+ P0d only (白牙 + 亮眼)', input: () => input({ 'tone.teeth': 0.5, 'tone.eyeBright': 0.5 }) },
      { row: '+ 20 spots', input: () => input({}, s20) },
      { row: '+ 100 spots', input: () => input({}, spotGrid(100, box)) },
      { row: 'tone + 20 spots, identity', input: () => input(all, s20) },
      { row: 'tone + 20 spots, 3:4 crop + 旋轉', input: () => input(all, s20, crop34) },
    ];
    toneOut.textContent = '量測中…';
    const rows = await runToneBench(engine, cases, 'frame (no 膚質)', nextPaint);
    const faces = [{ id: 'f0', face }];
    const work = { width: bitmap.width, height: bitmap.height };
    const plan: number[] = [];
    for (const s of s20) {
      const o: [number, number] = [s.x, s.y];
      const r = spotRadius(o, 'M', faces, work);
      const t = performance.now();
      planSpot(readPatch(bitmap, patchPlan(o, r, work)), o, r, { faces, aspect: work.width / work.height, existing: [] });
      plan.push(performance.now() - t);
    }
    rows.push({ row: 'planSpot CPU, median of 20 taps', ms: median(plan), delta: null });
    toneReport = formatToneBench(rows);
    toneOut.textContent = toneReport;
    bitmap.close();
  } catch (err) {
    showError('tone', err);
    toneOut.textContent = `失敗：${errText(err)}`;
  } finally {
    busy = false;
  }
}

function reportMeta(): Record<string, string> {
  const s = camera?.snapshot;
  return {
    date: new Date().toISOString(),
    ua: navigator.userAgent,
    screen: `${screen.width}×${screen.height} @${devicePixelRatio}x`,
    cores: String(navigator.hardwareConcurrency ?? '?'),
    video: s ? `${s.width}×${s.height} ${s.facing}` : '?',
    delegate: tracker?.delegate ?? 'none (基本模式)',
    tierPref: prefs.tier,
    autoTier: autoTierSession(),
    elapsed: formatElapsed(performance.now() - startedAt),
    lastError: dbg?.lastError ?? '',
  };
}

function copyResults(): void {
  const multiText = multi.rows().length ? `\n\n${formatMultiRows(multi.rows())}` : '';
  const exportText = exportRows.length > 0 ? `\n\n${formatExportRows(exportRows)}` : '';
  const text =
    formatReport(reportMeta(), samples, bodyRows) +
    multiText +
    exportText +
    (toneReport ? `\n\n膚質\n${toneReport}` : '') +
    (faceDetailRows.length ? `\n\n[step 5]\n${faceDetailRows.join('\n')}` : '') +
    formatLiquifyReport(liquifyRows);
  // the body section may be on the start screen, where the panel (and its textarea) is hidden
  if (panel.hidden) bodySection.append(copyArea);
  else if (copyArea.parentElement !== panel) panel.append(copyArea);
  const fallback = () => {
    copyArea.hidden = false;
    copyArea.value = text;
    copyArea.focus();
    copyArea.select();
    note.textContent = '無法自動複製，請手動全選複製';
  };
  if (!navigator.clipboard?.writeText) return fallback();
  navigator.clipboard.writeText(text).then(() => {
    copyArea.hidden = true;
    note.textContent = `已複製 ${samples.length} 筆`;
    if (bodyRows.length) bodyCopyBtn.textContent = `已複製（美體 ${bodyRows.length} 列）`;
  }, fallback);
}

function updateHud(): void {
  const s = stats;
  const snap = camera?.snapshot;
  const sum = summarize(samples);
  const n = (v: number | undefined, d = 1) => (v === undefined ? '–' : v.toFixed(d));
  hudText.textContent = [
    `fps ${n(s?.fps)}  detect ${n(s?.detectMs)} ms  render ${n(s?.renderMs)} ms`,
    `tier ${s?.tier ?? engine?.tier ?? '–'}${prefs.tier === 'auto' ? ' (自動)' : ''}  face ${s?.face ? '✓' : '✗'}  delegate ${tracker?.delegate ?? '無'}`,
    `video ${snap ? `${snap.width}×${snap.height}` : '–'}  camera ${snap?.state ?? '–'}  elapsed ${startedAt ? formatElapsed(performance.now() - startedAt) : '–'}`,
    sum.n ? `avg fps ${sum.fpsAvg.toFixed(1)} (min ${sum.fpsMin.toFixed(1)}) over ${sum.n} samples` : 'samples every 5 s',
    navigator.userAgent,
  ].join('\n');
}

function syncButtons(): void {
  for (const b of tierBtns) b.classList.toggle('on', b.dataset.tier === prefs.tier);
  for (const b of modeBtns) b.classList.toggle('on', b.dataset.mode === mode);
  landmarksBtn.classList.toggle('on', prefs.showLandmarks);
  delegateBtn.textContent = tracker?.delegate === 'CPU' ? '改用 GPU 重啟' : '改用 CPU 重啟';
  captureBtn.disabled = !loop;
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function showError(where: string, err: unknown): void {
  reportError(`bench ${where}`, err);
  hudErr.hidden = false;
  hudErr.textContent = `${where}: ${errText(err)}`;
}
