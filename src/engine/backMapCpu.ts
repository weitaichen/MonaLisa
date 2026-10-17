// The one CPU copy of P2's backward map (S §4.6, C §4.2): a V point → the O position whose content P2 samples there.
// Order as in RESHAPE_FS: Geo⁻¹, then the O-space maps (liquify from step 6, the body field, the face chains with caps and
// protect), which `oMap` carries. Used by the tile-planner tests, step 4's spot taps (skin-cleanup spec §3.4 cpuSample)
// and the e2e GPU-vs-CPU checks. Test / tap only: never in a render path.
import { apply, vToO, type Vec2 } from '../geometry/view';
import type { Geometry, Size } from '../types';
import type { UvMap } from './passes/reshapeCpu';

export interface BackMapFrame {
  geometry: Geometry;
  /** any size with the O aspect (the working bitmap's): only the aspect enters the straighten rotation */
  oSize: Size;
  /** the O-space part of P2: reshapeMapCpu(face, u, aspect, body, protect) for one face, or reshapeMapMulti(faces, aspect, { body, protects }) for the photo's faces */
  oMap: UvMap;
}

export function backMapCpu(v: Vec2, frame: BackMapFrame): [number, number] {
  const o = apply(vToO(frame.geometry, frame.oSize), v);
  return frame.oMap(o[0], o[1]);
}

/** the same map for many points (the affine is built once) */
export function backMapperCpu(frame: BackMapFrame): (v: Vec2) => [number, number] {
  const m = vToO(frame.geometry, frame.oSize);
  return (v) => {
    const o = apply(m, v);
    return frame.oMap(o[0], o[1]);
  };
}
