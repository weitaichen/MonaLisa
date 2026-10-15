// 推臉筆 points and radius (push-brush spec §3.1, §3.3): a client point → V through the transformed .zoom-layer rect
// (the HeightBandOverlay / onTap convention, so it is right at any zoom) → O through step 3's view transform.
// Strokes live in the output O frame, so they stay on what the user pushed when the geometry changes later.
import { BRUSH_PX } from '../config/limits';
import { brushRadius } from '../edit/liquify';
import { apply, vToO } from '../geometry/view';
import type { BrushSize, Geometry, LiquifyFrame } from '../types';

export interface ClientRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function clientToO(c: { x: number; y: number }, layer: ClientRect, g: Geometry, oSize: LiquifyFrame): { x: number; y: number } {
  const [x, y] = apply(vToO(g, oSize), [(c.x - layer.left) / layer.width, (c.y - layer.top) / layer.height]);
  return { x, y };
}

/**
 * The stroke start: its O point, the brush radius (S units; BRUSH_PX[size] CSS px measured at that point with the
 * current zoom and geometry, clamped to [rMin, R_MAX]) and the ring radius in CSS px (larger when clamped to rMin).
 */
export function brushAt(
  c: { x: number; y: number },
  size: BrushSize,
  layer: ClientRect,
  g: Geometry,
  oSize: LiquifyFrame,
): { o: { x: number; y: number }; radius: number; ringPx: number } {
  const o = clientToO(c, layer, g, oSize);
  const r = brushRadius(o, clientToO({ x: c.x + BRUSH_PX[size], y: c.y }, layer, g, oSize), oSize);
  return { o, radius: r.radius, ringPx: BRUSH_PX[size] * r.ringScale };
}
