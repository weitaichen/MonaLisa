// The body-mask rule of the photo hit test (S §2.2, persons.ts hitPerson), shared with 祛痘's owner (skin-cleanup spec
// §3.3, spots.ts ownerAt) so that a spot belongs to the person a tap at the same point selects. Pure; normalized O (UV).
import type { PersonId, PersonMask } from '../types';

/** the nearest mask sample at UV (0..255); 0 outside the photo */
export function maskAtUv(m: PersonMask, u: number, v: number): number {
  if (u < 0 || v < 0 || u >= 1 || v >= 1) return 0;
  return m.data[Math.min(m.height - 1, Math.floor(v * m.height)) * m.width + Math.min(m.width - 1, Math.floor(u * m.width))];
}

/** the mask's area, normalized: the fraction of its samples ≥ 128 (masks of different sizes compare) */
export function maskArea(m: PersonMask): number {
  let n = 0;
  for (let i = 0; i < m.data.length; i++) if (m.data[i] >= 128) n++;
  return n / (m.width * m.height);
}

/** the person whose mask is highest at `uv` among values ≥ 128 (0.5); equal values → the smaller area; none → null */
export function maskHit(uv: readonly [number, number], bodies: readonly { person: PersonId; mask: PersonMask }[]): PersonId | null {
  let best: PersonId | null = null;
  let bestV = 127;
  let bestArea = Infinity;
  for (const b of bodies) {
    const v = maskAtUv(b.mask, uv[0], uv[1]);
    if (v < 128 || v < bestV) continue;
    const area = maskArea(b.mask);
    if (v > bestV || area < bestArea) {
      best = b.person;
      bestV = v;
      bestArea = area;
    }
  }
  return best;
}
