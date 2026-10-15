import { describe, expect, it } from 'vitest';
import { rMin } from '../edit/liquify';
import { apply, IDENTITY_GEOMETRY, oToV, setStraighten } from '../geometry/view';
import type { Geometry } from '../types';
import { brushAt, clientToO, type ClientRect } from './brushMapping';

const OS = { width: 1536, height: 2048 };
/** the view on screen at a fixed density: 0.2 CSS px per O pixel at zoom 1 (unrounded V size: crop × E size) */
const layerFor = (g: Geometry, zoom = 1): ClientRect => {
  const eW = g.quarter % 2 ? OS.height : OS.width;
  const eH = g.quarter % 2 ? OS.width : OS.height;
  return { left: 40, top: 100, width: g.crop.w * eW * 0.2 * zoom, height: g.crop.h * eH * 0.2 * zoom };
};
const ALL: Geometry[] = [false, true].flatMap((flipH) =>
  ([0, 1, 2, 3] as const).map((quarter) => ({ ...IDENTITY_GEOMETRY, flipH, quarter })),
);
const centre = (r: ClientRect) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });

describe('client → V → O for brush points (push-brush spec §3.1, §8.1 view.test row)', () => {
  it('identity: the layer corners are the O corners', () => {
    const r = layerFor(IDENTITY_GEOMETRY);
    const o0 = clientToO({ x: r.left, y: r.top }, r, IDENTITY_GEOMETRY, OS);
    expect(o0.x).toBeCloseTo(0, 12);
    expect(o0.y).toBeCloseTo(0, 12);
    const o = clientToO({ x: r.left + r.width, y: r.top + r.height }, r, IDENTITY_GEOMETRY, OS);
    expect(o.x).toBeCloseTo(1, 12);
    expect(o.y).toBeCloseTo(1, 12);
  });

  it('every flip and quarter turn, and straighten 12° with its crop: inside the layer maps inside O, and back to the same client point', () => {
    const geos = [...ALL, setStraighten(IDENTITY_GEOMETRY, 12, OS), setStraighten({ ...IDENTITY_GEOMETRY, flipH: true, quarter: 1 }, -7.3, OS)];
    for (const g of geos) {
      const r = layerFor(g);
      for (const [fx, fy] of [[0.1, 0.1], [0.5, 0.5], [0.9, 0.3], [0.2, 0.95]]) {
        const c = { x: r.left + fx * r.width, y: r.top + fy * r.height };
        const o = clientToO(c, r, g, OS);
        expect(o.x).toBeGreaterThanOrEqual(-1e-9);
        expect(o.x).toBeLessThanOrEqual(1 + 1e-9);
        expect(o.y).toBeGreaterThanOrEqual(-1e-9);
        expect(o.y).toBeLessThanOrEqual(1 + 1e-9);
        const v = apply(oToV(g, OS), [o.x, o.y]);
        expect(v[0]).toBeCloseTo(fx, 9);
        expect(v[1]).toBeCloseTo(fy, 9);
      }
    }
  });

  it('the 中 radius is the same S length under every geometry (rigid view), and 1/5 of it at zoom 5', () => {
    const expected = (28 / 0.2) / Math.min(OS.width, OS.height); // 28 CSS px at 0.2 px per O px, in short edges
    for (const g of [...ALL, setStraighten(IDENTITY_GEOMETRY, 12, OS)]) {
      const r = layerFor(g);
      expect(brushAt(centre(r), 'm', r, g, OS).radius).toBeCloseTo(expected, 9);
      const r5 = layerFor(g, 5);
      expect(brushAt(centre(r5), 'm', r5, g, OS).radius).toBeCloseTo(expected / 5, 9);
      expect(brushAt(centre(r5), 'm', r5, g, OS).ringPx).toBeCloseTo(28, 9);
    }
  });

  it('at a very deep zoom the radius clamps to rMin and the ring grows on screen to show it', () => {
    const r = layerFor(IDENTITY_GEOMETRY, 400);
    const b = brushAt(centre(r), 's', r, IDENTITY_GEOMETRY, OS);
    expect(b.radius).toBe(rMin(OS));
    expect(b.ringPx).toBeGreaterThan(16);
  });
});
