import { describe, expect, it } from 'vitest';
import { cameraErrorCopy } from './cameraErrors';
import { dragValue, formatDisplay } from './components/Slider';
import { progressFraction, progressText } from './format';
import { centerCropRect, cropPixels } from './imaging';
import { clampView, pinchView } from './screens/zoomPan';

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
