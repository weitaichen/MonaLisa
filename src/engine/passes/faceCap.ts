// Per-face geometry shared by the detection cache, the face table and the caps (S §4.1, §4.4).
import type { Face, Rect } from '../../types';

/** FACE_OVAL bbox clipped to [0,1] (the box maskCoversFace uses, faceProtectModel.ts:63-72) */
export function ovalBox(face: Face): Rect {
  const o = face.oval;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let i = 0; i + 1 < o.length; i += 2) {
    x0 = Math.min(x0, o[i]);
    x1 = Math.max(x1, o[i]);
    y0 = Math.min(y0, o[i + 1]);
    y1 = Math.max(y1, o[i + 1]);
  }
  const cx0 = Math.max(0, Math.min(1, x0));
  const cy0 = Math.max(0, Math.min(1, y0));
  const cx1 = Math.max(0, Math.min(1, x1));
  const cy1 = Math.max(0, Math.min(1, y1));
  return Number.isFinite(cx0 + cy0 + cx1 + cy1) ? { x: cx0, y: cy0, w: cx1 - cx0, h: cy1 - cy0 } : { x: 0, y: 0, w: 0, h: 0 };
}

export const boxCentre = (b: Rect): [number, number] => [b.x + b.w / 2, b.y + b.h / 2];
