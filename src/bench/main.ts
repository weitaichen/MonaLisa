// OWNER: app-glue agent. Performance-spike page (bench.html).
// Plain DOM (no Preact): 開始 → engine download → engine → tracker → front camera → live loop,
// with an fps / detect / render HUD, tier / params / delegate controls and a copyable 5 s sample log.
import { debugState, reportError } from '../app/debug';
import { type LiveLoop, type LiveStats, autoTierSession, resetAutoTierSession, startLiveLoop } from '../app/live';
import { type StillSession, createStillSession } from '../app/still';
import { ENGINE_PATHS, loadEngineAssets } from '../engine/assets';
import { createEngine, isWebGL2Supported } from '../engine/index';
import { applyPreset, resetGroup } from '../engine/params';
import { createCamera } from '../media/camera';
import { encodeJpeg } from '../media/exporter';
import { importPhoto } from '../media/importer';
import { createTracker } from '../tracking/tracker';
import type { BeautyParams, CameraController, Delegate, Engine, EngineAssetsProgress, Prefs, Tracker } from '../types';
import { type BenchSample, formatElapsed, formatReport, summarize } from './report';

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
};

let mode: Mode = 'skin+shape';
let params = paramsFor(mode);
let camera: CameraController | null = null;
let engine: Engine | null = null;
let tracker: Tracker | null = null;
let model: Uint8Array | null = null;
let loop: LiveLoop | null = null;
let still: StillSession | null = null;
let stats: LiveStats | null = null;
/** first live-loop start; sample times and elapsed stay monotonic across loop restarts */
let startedAt = 0;
let busy = false;
const samples: BenchSample[] = [];

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
const gate = el('div', { className: 'gate' }, el('h1', { textContent: 'MonaLisa Bench' }), gateMsg, startBtn, gateProgress);

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
    still.render(params);
  }
});
const compareBtn = button('按住對比', () => {});
const captureBtn = button('擷取測試', () => void captureTest());
const stillBtn = button('靜態圖片測試', () => void stillTest());
const copyBtn = button('複製結果', () => copyResults());
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
  el('div', { className: 'row' }, delegateBtn, landmarksBtn, compareBtn, captureBtn, stillBtn, resumeBtn),
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
    // copy: the buffer may be transferred into the wasm heap, and a delegate restart needs it again
    const t = await createTracker({ modelBuffer: model.slice(), wasmBase: ENGINE_PATHS.wasmBase, delegate });
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
    getParams: () => params,
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
  still?.render(params);
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
    const img = loop.capture();
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
    const detectMs = performance.now() - t0;
    still.render(params);
    const times: number[] = [];
    for (let i = 0; i < 5; i++) {
      const t = performance.now();
      still.exportImageData(params);
      times.push(performance.now() - t);
    }
    times.sort((a, b) => a - b);
    note.textContent =
      `靜態 ${still.width}×${still.height}：detect+adapt ${detectMs.toFixed(0)} ms，臉 ${still.face ? '✓' : '✗'}，` +
      `全解析 render+readback 中位數 ${times[2].toFixed(0)} ms`;
    stillBtn.textContent = '返回相機';
  } catch (err) {
    showError('still', err);
  } finally {
    busy = false;
    syncButtons();
  }
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
  const text = formatReport(reportMeta(), samples);
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
