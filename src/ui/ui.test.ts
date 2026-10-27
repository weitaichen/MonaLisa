import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cameraErrorCopy } from './cameraErrors';
import { dragValue, formatDisplay } from './components/Slider';
import { progressFraction, progressText } from './format';
import { centerCropRect, cropPixels, shotSeed } from './imaging';
import { clampView, pinchView, useZoomPan, type ZoomPanOptions } from './screens/zoomPan';

describe('slider maths', () => {
  it('relative drag maps px to value and clamps', () => {
    expect(dragValue(false, 0.5, 100, 200)).toEqual({ v: 1, snapped: false });
    expect(dragValue(false, 0.5, -50, 200)).toEqual({ v: 0.25, snapped: false });
    expect(dragValue(false, 0.1, -500, 200).v).toBe(0);
  });
  it('bidirectional snaps to centre within ±3', () => {
    expect(dragValue(true, 0.5, 6, 200)).toEqual({ v: 0.5, snapped: true });
    expect(dragValue(true, 0.5, -6, 200)).toEqual({ v: 0.5, snapped: true });
    expect(dragValue(true, 0.5, 8, 200)).toEqual({ v: 0.54, snapped: false });
  });
  it('display text', () => {
    expect(formatDisplay(false, 0.55)).toBe('55');
    expect(formatDisplay(true, 0.62)).toBe('+12');
    expect(formatDisplay(true, 0.3)).toBe('−20');
    expect(formatDisplay(true, 0.5)).toBe('0');
  });
});

describe('slider scale (拉直)', () => {
  const deg = { min: -45, max: 45, step: 0.1, snap: 0.5, suffix: '°' };
  it('display and text use the scale; no scale keeps today\'s output', () => {
    expect(formatDisplay(true, (3.5 + 45) / 90, deg)).toBe('+3.5°');
    expect(formatDisplay(true, (-12 + 45) / 90, deg)).toBe('−12.0°');
    expect(formatDisplay(true, 0.5, deg)).toBe('0°');
    expect(formatDisplay(true, 0.62)).toBe('+12');
  });
  it('drags quantize to the step and snap to 0 within ±0.5°', () => {
    expect(dragValue(true, 0.5, 1, 900, deg)).toEqual({ v: 0.5, snapped: true });
    const r = dragValue(true, 0.5, 10, 900, deg);
    expect(r.snapped).toBe(false);
    expect(Math.round((r.v * 90 - 45) * 10) / 10).toBe(1);
    expect(dragValue(false, 0.5, 100, 200)).toEqual({ v: 1, snapped: false });
  });
});

describe('capture crop', () => {
  it('centre crop to 3:4 / 1:1 / 9:16', () => {
    expect(centerCropRect(1920, 1080, 3 / 4)).toEqual({ x: 555, y: 0, width: 810, height: 1080 });
    expect(centerCropRect(1080, 1920, 3 / 4)).toEqual({ x: 0, y: 240, width: 1080, height: 1440 });
    expect(centerCropRect(1080, 1920, 1)).toEqual({ x: 0, y: 420, width: 1080, height: 1080 });
    expect(centerCropRect(1080, 1920, 9 / 16)).toEqual({ x: 0, y: 0, width: 1080, height: 1920 });
  });
  it('copies the right rows', () => {
    const w = 4;
    const src = new Uint8ClampedArray(w * 3 * 4);
    for (let i = 0; i < w * 3; i++) src[i * 4] = i;
    const out = cropPixels(src, w, { x: 1, y: 1, width: 2, height: 2 });
    expect([out[0], out[4], out[8], out[12]]).toEqual([5, 6, 9, 10]);
  });
});

describe('zoom maths', () => {
  it('clamps scale to [1,5] and keeps the layer covering its box', () => {
    expect(clampView({ s: 0.5, x: 30, y: 0 }, 100, 100)).toEqual({ s: 1, x: 0, y: 0 });
    expect(clampView({ s: 2, x: 80, y: -80 }, 100, 200)).toEqual({ s: 2, x: 50, y: -80 });
    expect(clampView({ s: 9, x: 0, y: 0 }, 100, 100).s).toBe(5);
  });
  it('pinch keeps the point under the fingers fixed', () => {
    const v = pinchView({ s: 1, x: 0, y: 0 }, { x: 20, y: 10 }, { x: 20, y: 10 }, 2);
    expect(v.x + v.s * 20).toBeCloseTo(20);
    expect(v.y + v.s * 10).toBeCloseTo(10);
    const moved = pinchView({ s: 2, x: 10, y: 0 }, { x: 0, y: 0 }, { x: 30, y: 0 }, 1);
    expect(moved).toEqual({ s: 2, x: 40, y: 0 });
  });
});

describe('zoomPan reset (裁切 opens, S §2.1)', () => {
  // Preact's render compares its parent with `document`; the harness renders no DOM, so an empty stand-in will do
  let saved: unknown;
  beforeAll(() => {
    saved = (globalThis as { document?: unknown }).document;
    (globalThis as { document?: unknown }).document = {};
  });
  afterAll(() => {
    (globalThis as { document?: unknown }).document = saved;
  });

  /** the stage and layer the hook writes to: listeners, capture, rects and the layer's style */
  function rig() {
    const listeners: Record<string, (e: unknown) => void> = {};
    const rect = { left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100 };
    const stage = {
      addEventListener: (t: string, fn: (e: unknown) => void) => (listeners[t] = fn),
      removeEventListener: (t: string) => delete listeners[t],
      setPointerCapture: () => undefined,
      getBoundingClientRect: () => rect,
    };
    const style: Record<string, string> & { setProperty(k: string, v: string): void } = {
      setProperty(k: string, v: string) {
        style[k] = v;
      },
    } as never;
    const layer = { style, offsetWidth: 100, offsetHeight: 100, getBoundingClientRect: () => rect };
    const stageRef = { current: stage as unknown as HTMLElement };
    const layerRef = { current: layer as unknown as HTMLElement };
    const root = { childNodes: [], firstChild: null } as unknown as Element;
    function Harness({ enabled, opts }: { enabled: boolean; opts: ZoomPanOptions }) {
      useZoomPan(stageRef, layerRef, enabled, opts);
      return null;
    }
    const show = (enabled: boolean, opts: ZoomPanOptions = {}) => act(() => render(h(Harness, { enabled, opts }), root));
    const target = { closest: () => null };
    const fire = (type: string, pointerId: number, x: number, y: number) =>
      act(() => listeners[type]({ type, pointerId, clientX: x, clientY: y, target }));
    return { style, show, fire };
  }

  it('opening 裁切 puts a zoomed layer back to identity (transform, --zs) and the next pan starts from scale 1', () => {
    const r = rig();
    r.show(true);
    r.fire('pointerdown', 1, 40, 50);
    r.fire('pointerdown', 2, 60, 50);
    r.fire('pointermove', 2, 80, 50); // pinch ×2
    r.fire('pointerup', 2, 80, 50);
    r.fire('pointerup', 1, 40, 50);
    expect(r.style.transform).toContain('scale(2)');
    expect(r.style['--zs']).toBe('2');
    r.show(false, { resetWhen: true });
    expect(r.style.transform).toBe('');
    expect(r.style.transition).toBe('none');
    expect(r.style['--zs']).toBe('1');
    // back in normal mode: one finger at scale 1 does not pan (the hook's own view was reset too)
    r.show(true, { resetWhen: false });
    r.fire('pointerdown', 1, 50, 50);
    r.fire('pointermove', 1, 80, 50);
    r.fire('pointerup', 1, 80, 50);
    expect(r.style.transform).toBe('');
  });

  it('resetWhen false leaves the zoom alone', () => {
    const r = rig();
    r.show(true);
    r.fire('pointerdown', 1, 40, 50);
    r.fire('pointerdown', 2, 60, 50);
    r.fire('pointermove', 2, 80, 50);
    r.fire('pointerup', 2, 80, 50);
    r.fire('pointerup', 1, 40, 50);
    r.show(true, { resetWhen: false });
    expect(r.style.transform).toContain('scale(2)');
  });

  describe('the hook taps (step 1 view taps; skin-cleanup spec §2.3 spotTap)', () => {
    /** a ×2 pinch about the centre, so a fit-to-view shows as an empty transform */
    const zoomIn = (r: ReturnType<typeof rig>) => {
      r.fire('pointerdown', 1, 40, 50);
      r.fire('pointerdown', 2, 60, 50);
      r.fire('pointermove', 2, 80, 50);
      r.fire('pointerup', 2, 80, 50);
      r.fire('pointerup', 1, 40, 50);
    };
    const tap = (r: ReturnType<typeof rig>, end = 'pointerup') => {
      r.fire('pointerdown', 1, 50, 50);
      r.fire(end, 1, 50, 50);
    };

    it('view: a quick double tap calls onTap twice and fits; a pinch is no tap', () => {
      const r = rig();
      const taps: [number, number][] = [];
      r.show(true, { onTap: (uv) => taps.push(uv) });
      zoomIn(r);
      expect(taps).toEqual([]);
      tap(r);
      tap(r);
      expect(taps).toEqual([[0.5, 0.5], [0.5, 0.5]]);
      expect(r.style.transform).toBe('');
    });

    it('view: a pointercancel calls no onTap but still counts toward the double tap', () => {
      const r = rig();
      const taps: [number, number][] = [];
      r.show(true, { onTap: (uv) => taps.push(uv) });
      zoomIn(r);
      tap(r, 'pointercancel');
      expect(taps).toEqual([]);
      tap(r);
      expect(taps).toEqual([[0.5, 0.5]]);
      expect(r.style.transform).toBe('');
    });

    it('spot: a quick double tap is two spotTaps with the layer rect, no onTap and no fit (Review Focus 2)', () => {
      const r = rig();
      const spots: [number, number][] = [];
      const views: number[] = [];
      r.show(true, { onTap: (uv) => views.push(uv[0]), spotTap: (uv, rect) => spots.push([uv[0], rect.width]) });
      zoomIn(r);
      tap(r);
      tap(r);
      expect(spots).toEqual([[0.5, 100], [0.5, 100]]);
      expect(views).toEqual([]);
      expect(r.style.transform).toContain('scale(2)');
    });

    it('spot: a pointercancel adds no spot', () => {
      const r = rig();
      const spots: [number, number][] = [];
      r.show(true, { spotTap: (uv) => spots.push(uv) });
      tap(r, 'pointercancel');
      expect(spots).toEqual([]);
    });
  });
});

describe('engine progress text', () => {
  it('percent, MB fallback and phases', () => {
    expect(progressText(null)).toBe('準備下載美顏引擎…');
    expect(progressText({ loaded: 50, total: 200, phase: 'model' })).toBe('下載美顏引擎 25%');
    expect(progressText({ loaded: 3 * 1048576, total: 0, phase: 'model' })).toBe('下載美顏引擎 3.0 MB');
    expect(progressFraction({ loaded: 3, total: 0, phase: 'model' })).toBeNull();
    expect(progressFraction({ loaded: 1, total: 1, phase: 'done' })).toBe(1);
  });
});

describe('camera error copy', () => {
  it('black stream in a Home Screen app: Safari steps plus the site URL in the selectable detail', () => {
    const m = cameraErrorCopy('black', true, 'https://monalisa.example');
    expect(m.detail).toContain('https://monalisa.example');
    expect(m.steps?.some((s) => s.includes('Safari'))).toBe(true);
  });
  it('black stream in a Safari tab: no Safari advice, a covered-lens hint instead', () => {
    const m = cameraErrorCopy('black', false, 'https://monalisa.example');
    expect(m.steps).toBeUndefined();
    expect(`${m.title}${m.body}`).not.toContain('Safari');
    expect(m.body).toContain('鏡頭');
    expect(m.detail).toBe('錯誤代碼：black');
  });
  it('other kinds keep their copy and error code', () => {
    expect(cameraErrorCopy('denied', true, 'x')).toMatchObject({ title: '無法使用相機', detail: '錯誤代碼：denied' });
  });
  it('no answer yet: the permission prompt first, then closing the app (both iPhone gestures), Safari last', () => {
    const m = cameraErrorCopy('noanswer', true, 'https://monalisa.example');
    expect(m.title).toBe('相機還沒有回應');
    expect(m.body).toContain('允許');
    expect(m.steps?.some((s) => s.includes('重試'))).toBe(false); // still waiting: nothing to retry
    expect(m.steps?.[0]).toContain('往上滑掉');
    expect(m.steps?.[0]).toContain('主畫面按鈕');
    expect(m.steps?.at(-1)).toContain('Safari');
    expect(m.detail).toBe('https://monalisa.example'); // the bare URL: copying all of it pastes as one
  });
  it('no frame in a Home Screen app: 重試, then closing the app, then Safari with the URL (WK 252465)', () => {
    const m = cameraErrorCopy('noframe', true, 'https://monalisa.example');
    expect(m.title).toBe('收不到相機畫面');
    expect(m.steps?.[0]).toContain('重試');
    expect(m.steps?.[1]).toContain('往上滑掉');
    expect(m.steps?.at(-1)).toContain('Safari');
    expect(m.detail).toBe('https://monalisa.example'); // the bare URL: copying all of it pastes as one
  });
  it('in a Safari tab: reopen the tab, no app switcher or Safari steps, the error code as detail', () => {
    for (const kind of ['noanswer', 'noframe'] as const) {
      const m = cameraErrorCopy(kind, false, 'https://monalisa.example');
      expect(m.steps?.some((s) => s.includes('分頁'))).toBe(true);
      expect(m.steps?.some((s) => s.includes('往上滑掉') || s.includes('Safari'))).toBe(false);
      expect(m.detail).toBe(`錯誤代碼：${kind}`);
    }
  });
});

describe('site security headers (vercel.json, mirrored into vite preview)', () => {
  it('CSP keeps egress closed and blocks framing, <base>, forms and plugins', async () => {
    const { readFileSync } = await import('node:fs');
    const cfg = JSON.parse(readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8')) as {
      headers: { source: string; headers: { key: string; value: string }[] }[];
    };
    const csp = cfg.headers.find((h) => h.source === '/(.*)')?.headers.find((h) => h.key === 'Content-Security-Policy')?.value ?? '';
    const directives = new Map(csp.split(';').map((d) => d.trim().split(/\s+/)).map(([k, ...v]) => [k, v.join(' ')]));
    expect(directives.get('connect-src')).toBe("'self'");
    for (const d of ['frame-ancestors', 'base-uri', 'form-action', 'object-src']) expect(directives.get(d), d).toBe("'none'");
  });
});

describe('camera → editor seed (S §3.4 C2)', () => {
  it('maps into the saved crop, mirrors with the saved image, never clamps', () => {
    const r = centerCropRect(1280, 720, 3 / 4); // 540 × 720 at x 370
    expect(shotSeed({ x: 0.5, y: 0.5 }, 1280, 720, 3 / 4, false)).toEqual({ x: (640 - r.x) / r.width, y: 0.5 });
    expect(shotSeed({ x: 0.5, y: 0.25 }, 1280, 720, 3 / 4, true)).toEqual({ x: 1 - (640 - r.x) / r.width, y: 0.25 });
    expect((shotSeed({ x: 0.1, y: 0.5 }, 1280, 720, 3 / 4, false) as { x: number }).x).toBeLessThan(0);
    expect(shotSeed('all', 1280, 720, 1, false)).toBe('all');
    expect(shotSeed(null, 1280, 720, 1, false)).toBeNull();
  });
});
