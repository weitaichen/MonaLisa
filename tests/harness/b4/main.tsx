// B4 harness: the real BeautyPanel / SliderRow / HeightBandOverlay inside an Editor-like and a Camera-like
// shell, driven by fake 美體 contexts (no engine, no pose model). The photo is drawn on a 2D canvas with the
// 增高 band stretched exactly as types.ts describes it (rows inside the band × (1 + 0.15·amount), content below
// shifted down, frame size unchanged), so the overlay lines can be checked against what they frame.
// Scenario via ?s=<name>; window.__h exposes state for shoot.mjs.
import '../../../src/ui/theme.css';
import { render } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { defaultParams, setHeightBand, setParam } from '../../../src/engine/params';
import type { BeautyParams, HeightBand, ParamId, RegionStatus } from '../../../src/types';
import { BeautyPanel } from '../../../src/ui/components/BeautyPanel';
import { IconButton } from '../../../src/ui/components/Controls';
import { HeightBandOverlay, defaultStretch } from '../../../src/ui/components/HeightBandOverlay';
import { SliderRow } from '../../../src/ui/components/Slider';
import { Icon } from '../../../src/ui/icons';
import {
  bandOrSuggested,
  CAMERA_BODY,
  INITIAL_SELECTION,
  showsHeightBand,
  sliderFor,
  type BodyContext,
  type PanelSelection,
} from '../../../src/ui/panelModel';
import { app } from '../../../src/ui/state';
import { useStore } from '../../../src/ui/store';

const OK: RegionStatus = { ok: true, reason: null };
const LEGS: RegionStatus = { ok: false, reason: '拍攝全身照可使用長腿／瘦腿' };
const FACE: RegionStatus = { ok: false, reason: '需要偵測到臉部才能使用小頭／天鵝頸' };

/** full-body photo where the face is masked (no FaceLandmarker face → head / neck gated) */
const fullBody = (id: ParamId): RegionStatus => (id === 'body.head' || id === 'body.neck' ? FACE : OK);
/** a half-body portrait: no legs / feet in frame */
const halfBody = (id: ParamId): RegionStatus => (id === 'body.legs' || id === 'body.legSlim' ? LEGS : OK);

interface Scenario {
  screen: 'editor' | 'camera';
  body: BodyContext;
  sel?: Partial<PanelSelection>;
  params?: (p: BeautyParams) => BeautyParams;
}

const ctx = (over: Partial<BodyContext>): BodyContext => ({ status: 'ready', people: 1, availability: fullBody, ...over });

const SCENARIOS: Record<string, Scenario> = {
  idle: { screen: 'editor', body: ctx({ status: 'idle' }) },
  loading: { screen: 'editor', body: ctx({ status: 'loading', progress: 0.42 }) },
  detecting: { screen: 'editor', body: ctx({ status: 'loading', progress: 1 }) },
  ready: {
    screen: 'editor',
    body: ctx({ suggestedBand: { top: 0.5, bottom: 0.84 } }),
    sel: { body: 'body.waist' },
    params: (p) => setParam(setParam(p, 'body.waist', 0.45), 'body.slim', 0.3),
  },
  hip: { screen: 'editor', body: ctx({}), sel: { body: 'body.hip' }, params: (p) => setParam(p, 'body.hip', 0.62) },
  gated: { screen: 'editor', body: ctx({ availability: halfBody }), sel: { body: 'body.arms' } },
  people2: { screen: 'editor', body: ctx({ people: 2 }), sel: { body: 'body.slim' } },
  height: { screen: 'editor', body: ctx({ suggestedBand: { top: 0.5, bottom: 0.84 } }), sel: { body: 'height' } },
  heightOn: {
    screen: 'editor',
    body: ctx({ suggestedBand: { top: 0.5, bottom: 0.84 } }),
    sel: { body: 'height' },
    params: (p) => setHeightBand(p, { top: 0.5, bottom: 0.82, amount: 0.8 }),
  },
  protectOff: { screen: 'editor', body: ctx({}), sel: { body: 'body.slim' }, params: (p) => ({ ...p, bodyProtect: false }) },
  none: { screen: 'editor', body: ctx({ status: 'none', people: 0 }) },
  error: { screen: 'editor', body: ctx({ status: 'error', retry: () => harness.retries++ }) },
  camera: { screen: 'camera', body: { ...CAMERA_BODY, action: { label: '匯入照片', run: () => harness.imports++ } }, sel: { body: 'body.legs' } },
  cameraSkin: { screen: 'camera', body: CAMERA_BODY, sel: { tab: 'skin' } },
};

const q = new URLSearchParams(location.search);
const scenario = SCENARIOS[q.get('s') ?? 'ready'] ?? SCENARIOS.ready;

const harness = {
  params: defaultParams() as BeautyParams,
  sel: INITIAL_SELECTION as PanelSelection,
  commits: 0,
  retries: 0,
  imports: 0,
};
declare global {
  interface Window {
    __h: typeof harness;
    __harnessReady: boolean;
  }
}
window.__h = harness;

const img = new Image();
img.src = '/tests/fixtures/fullbody.jpg';

/** Photo with the 增高 band applied (nearest-row slices; the real field is a smooth C¹ band). */
function Photo({ band }: { band: HeightBand | null }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c || !img.complete) return;
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    c.width = w;
    c.height = h;
    const g = c.getContext('2d')!;
    g.clearRect(0, 0, w, h);
    if (!band || band.amount <= 0) {
      g.drawImage(img, 0, 0);
      return;
    }
    const t = band.top * h;
    const b = band.bottom * h;
    const s = defaultStretch(band);
    g.drawImage(img, 0, 0, w, t, 0, 0, w, t);
    g.drawImage(img, 0, t, w, b - t, 0, t, w, (b - t) * s);
    const shift = (b - t) * (s - 1);
    g.drawImage(img, 0, b, w, h - b, 0, b + shift, w, h - b);
  }, [band?.top, band?.bottom, band?.amount]);
  return <canvas class="display-canvas" ref={ref} style={{ objectFit: 'contain' }} />;
}

function Toast() {
  const toast = useStore(app, (s) => s.toast);
  if (!toast) return null;
  return (
    <div class="toast" key={toast.id} role="status" aria-live="polite">
      {toast.text}
    </div>
  );
}

function Harness() {
  const [params, setParamsState] = useState(() => (scenario.params ?? ((p) => p))(defaultParams()));
  const [sel, setSelState] = useState<PanelSelection>({ ...INITIAL_SELECTION, tab: 'body', ...scenario.sel });
  const paramsRef = useRef(params);
  paramsRef.current = params;
  harness.params = params;
  harness.sel = sel;
  const update = (p: BeautyParams, commit: boolean) => {
    paramsRef.current = p;
    setParamsState(p);
    if (commit) harness.commits++;
  };
  const body = scenario.body;
  const binding = sliderFor(params, sel, body);
  const ratio = img.naturalWidth / img.naturalHeight || 0.638;

  if (scenario.screen === 'camera') {
    return (
      <div class="screen camera">
        <div class="topbar">
          <IconButton icon="close" label="回首頁" />
          <div class="topbar-center">
            <button type="button" class="chip-btn">
              <span class="num">3:4</span>
            </button>
            <button type="button" class="chip-btn">
              <span>
                <Icon name="timer" size={16} stroke={2} />關
              </span>
            </button>
          </div>
          <IconButton icon="flip" label="切換鏡頭" />
        </div>
        <div class="stage cam-stage">
          <div class="frame" style={{ '--r': '0.75' }}>
            <div class="canvas-host">
              <img src={img.src} class="display-canvas" style={{ objectFit: 'cover' }} alt="" />
            </div>
          </div>
          <SliderRow float binding={binding} onChange={(v) => binding && update(binding.apply(paramsRef.current, v), false)} onCommit={() => undefined} />
        </div>
        <BeautyPanel params={params} sel={sel} onSel={setSelState} onParams={(p) => update(p, true)} body={body} />
        <div class="cam-controls">
          <button type="button" class="side-btn">
            <span class="side-icon">
              <Icon name="image" size={22} />
            </span>
            相簿
          </button>
          <button type="button" class="shutter" aria-label="拍照">
            <span />
          </button>
          <button type="button" class="side-btn">
            <span class="side-icon">
              <Icon name="compare" size={22} />
            </span>
            按住對比
          </button>
        </div>
        <Toast />
      </div>
    );
  }

  return (
    <div class="screen editor">
      <div class="topbar">
        <IconButton icon="close" label="關閉" />
        <div class="title-center">
          <IconButton icon="undo" label="復原" />
          <IconButton icon="redo" label="重做" disabled />
        </div>
        <button type="button" class="pill">
          <span>儲存</span>
        </button>
      </div>
      <div class="stage editor-stage">
        <div class="frame" style={{ '--r': String(ratio) }}>
          <div class="zoom-layer">
            <div class="canvas-host">
              <Photo band={params.heightBand} />
            </div>
            {showsHeightBand(sel, body) && (
              <HeightBandOverlay band={bandOrSuggested(params, body)} onChange={(b, commit) => update(setHeightBand(paramsRef.current, b), commit)} />
            )}
          </div>
          <div class="editor-tools">
            <button type="button" class="float-btn">
              <span>
                <Icon name="reset" size={16} stroke={2} />
                重置
              </span>
            </button>
            <button type="button" class="float-btn" aria-label="按住對比">
              <span>
                <Icon name="compare" size={16} stroke={2} />
                按住對比
              </span>
            </button>
          </div>
        </div>
      </div>
      <div class="editor-panel">
        <SliderRow
          binding={binding}
          onChange={(v) => binding && update(binding.apply(paramsRef.current, v), false)}
          onCommit={(v) => binding && update(binding.apply(paramsRef.current, v), true)}
        />
        <BeautyPanel params={params} sel={sel} onSel={setSelState} onParams={(p) => update(p, true)} body={body} />
      </div>
      <div class="editor-bottom-pad" />
      <Toast />
    </div>
  );
}

const start = () => {
  render(<Harness />, document.getElementById('app')!);
  requestAnimationFrame(() => (window.__harnessReady = true));
};
if (img.complete) start();
else {
  img.onload = start;
  img.onerror = start;
}
