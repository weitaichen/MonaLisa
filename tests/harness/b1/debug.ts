// Ad-hoc probes for tuning (run through run.mjs-style SSR loading: node tests/harness/b1/dbg.mjs).
import type { BodyField, ParamId } from '../../../src/types';
import { defaultParams, setBodyProtect, setParam } from '../../../src/engine/params';
import { buildBodyField } from '../../../src/body/field';
import { measureBody } from '../../../src/body/measure';
import { syntheticFigure } from '../../../src/body/synthetic';

/** Location and value of the K smallest cell determinants. */
export function worstCells(f: BodyField, k = 5): { x: number; y: number; det: number }[] {
  const { width: w, height: h, data } = f;
  const mx = (x: number, y: number) => x + data[(y * w + x) * 2] * w;
  const my = (x: number, y: number) => y + data[(y * w + x) * 2 + 1] * h;
  const cells: { x: number; y: number; det: number }[] = [];
  for (let y = 0; y + 1 < h; y++)
    for (let x = 0; x + 1 < w; x++) {
      const ax = mx(x + 1, y) - mx(x, y);
      const ay = my(x + 1, y) - my(x, y);
      const bx = mx(x, y + 1) - mx(x, y);
      const by = my(x, y + 1) - my(x, y);
      cells.push({ x: (x + 1) / w, y: (y + 1) / h, det: ax * by - ay * bx });
    }
  return cells.sort((a, b) => a.det - b.det).slice(0, k);
}

export function probe(ids: ParamId[], protect = true, armsDown = false): unknown {
  const f = syntheticFigure({ armsDown });
  const m = measureBody(f.det, f.face);
  let p = setBodyProtect(defaultParams(), protect);
  for (const id of ids) p = setParam(p, id, 1);
  const field = buildBodyField(m, p, f.width / f.height);
  return {
    trunk: m.trunk && { waistT: m.trunk.waistT, waistW: m.trunk.waistW, hipT: m.trunk.hipT, hipW: m.trunk.hipW, torsoW: m.trunk.torsoW, len: m.trunk.len },
    limbs: m.limbs.map((l) => ({ kind: l.kind, w: +l.w.toFixed(4), side: l.side })),
    shoulders: m.shoulders && { drop: m.shoulders.drop, half: m.shoulders.half },
    worst: field ? worstCells(field) : null,
  };
}

import { readFileSync } from 'node:fs';
export function fixtureDet(file: string): import('../../../src/types').BodyDetection {
  const j = JSON.parse(readFileSync(new URL(`../../fixtures/${file}`, import.meta.url), 'utf8'));
  return {
    pose: { points: new Float32Array(j.points) },
    mask: j.mask ? { width: j.mask.width, height: j.mask.height, data: new Uint8Array(Buffer.from(j.mask.data, 'base64')) } : null,
    people: j.people, width: j.width, height: j.height,
  };
}
export function probeFixture(file: string, ids: ParamId[], hipVal?: number): unknown {
  const det = fixtureDet(file);
  const m = measureBody(det, null);
  let p = defaultParams();
  for (const id of ids) p = setParam(p, id, 1);
  if (hipVal !== undefined) p = setParam(p, 'body.hip', hipVal);
  const field = buildBodyField(m, p, det.width / det.height);
  return { facing: m.facing, regions: m.regions, trunk: m.trunk && { waistT: m.trunk.waistT, hipT: m.trunk.hipT, waistW: m.trunk.waistW, hipW: m.trunk.hipW, len: m.trunk.len, s: m.trunk.s, h: m.trunk.h },
    limbs: m.limbs.map((l) => `${l.kind}:${l.w.toFixed(4)}:${l.side}`), worst: field ? worstCells(field, 4) : null };
}
export function limbReach(file: string): unknown {
  const m = measureBody(fixtureDet(file), null);
  return m.limbs.map((l) => `${l.kind} w=${l.w.toFixed(4)} side=${l.side} a=${l.a.map((v) => v.toFixed(3))} P=${l.reachP.map((v) => v.toFixed(3)).join(',')} M=${l.reachM.map((v) => v.toFixed(3)).join(',')}`);
}
export function trunkProfile(file: string): unknown {
  const m = measureBody(fixtureDet(file), null);
  const t = m.trunk!;
  const rows: string[] = [];
  for (let i = 0; i < t.half.length; i += 2) rows.push(`t=${(-0.1 + i * 0.025).toFixed(3)} P=${t.halfP[i].toFixed(4)}/${t.reachP[i].toFixed(4)} M=${t.halfM[i].toFixed(4)}/${t.reachM[i].toFixed(4)}`);
  return { waistT: t.waistT, n: t.n, rows };
}
import { warpImage } from '../../../src/body/cpuWarp';
import { MaskSampler } from '../../../src/body/mask';
export function waistSides(file: string | null): unknown {
  const det = file ? fixtureDet(file) : syntheticFigure().det;
  const m = measureBody(det, file ? null : syntheticFigure().face);
  const f = buildBodyField(m, setParam(defaultParams(), 'body.waist', 1), det.width / det.height)!;
  const mk = det.mask!;
  const t = m.trunk!;
  const res: string[] = [];
  for (const tt of [t.waistT - 0.1, t.waistT, t.waistT + 0.1]) {
    const p: [number, number] = [t.s[0] + t.u[0] * tt * t.len, t.s[1] + t.u[1] * tt * t.len];
    const sides = (data: Uint8Array) => {
      const s = new MaskSampler({ width: mk.width, height: mk.height, data }, m.aspect);
      return [s.march(p, t.n, 0.4)!.dist, s.march(p, [-t.n[0], -t.n[1]], 0.4)!.dist];
    };
    const b = sides(mk.data);
    const a = sides(Uint8Array.from(warpImage(mk.data, mk.width, mk.height, 1, f)));
    const i = Math.round((tt + 0.1) / 0.025);
    res.push(`t=${tt.toFixed(3)} P ${b[0].toFixed(4)}→${a[0].toFixed(4)} (${(100 * (1 - a[0] / b[0])).toFixed(1)}%) M ${b[1].toFixed(4)}→${a[1].toFixed(4)} (${(100 * (1 - a[1] / b[1])).toFixed(1)}%) halfP=${t.halfP[i].toFixed(4)} reachP=${t.reachP[i].toFixed(4)} halfM=${t.halfM[i].toFixed(4)} reachM=${t.reachM[i].toFixed(4)}`);
  }
  return res;
}
