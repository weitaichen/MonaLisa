import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { isLookId, LOOK_IDS, lookDef, LOOKS, lookThumbUrl, photoLuts } from './looks';
import { paramDef } from './params';

describe('質感 looks (step-2 spec §3.2)', () => {
  it('5 looks with unique ids and labels in strip order, 程度 0.8 when picked', () => {
    expect(LOOKS.map((l) => l.id)).toEqual(['film', 'ccd', 'flash', 'blue', 'cinema']);
    expect(LOOK_IDS).toEqual(LOOKS.map((l) => l.id));
    expect(LOOKS.map((l) => l.label)).toEqual(['膠片', 'CCD', '直閃', '藍調', '電影感']);
    for (const l of LOOKS) expect(l.defaultAmount).toBe(0.8);
  });

  it('offsets use only 調節 ids and stay inside each item display range', () => {
    for (const l of LOOKS) {
      expect(Object.keys(l.offsets).length).toBeGreaterThan(0);
      for (const [id, o] of Object.entries(l.offsets)) {
        expect(id.startsWith('adjust.'), `${l.id} ${id}`).toBe(true);
        const d = paramDef(id as never);
        if (d.bidirectional) expect(Math.abs(o!)).toBeLessThanOrEqual(50);
        else {
          expect(o!).toBeGreaterThanOrEqual(0);
          expect(o!).toBeLessThanOrEqual(100);
        }
      }
    }
  });

  it('keeps the C §4.4 starting offsets (the tuning loop may change them only with §8.2 green)', () => {
    expect(lookDef('film')!.offsets).toEqual({
      'adjust.fade': 30, 'adjust.grain': 35, 'adjust.vignette': 20, 'adjust.contrast': -10, 'adjust.saturation': -10, 'adjust.temperature': 8,
    });
    expect(lookDef('flash')!.offsets['adjust.vignette']).toBe(35);
  });

  it('lookDef / isLookId reject unknown ids', () => {
    expect(lookDef('nope')).toBeNull();
    expect(isLookId('ccd')).toBe(true);
    expect(isLookId('film ')).toBe(false);
    expect(isLookId(3)).toBe(false);
  });

  it('photoLuts lists the 濾鏡 unless 無, then the 質感', () => {
    expect(photoLuts({ filterId: 'none', look: null })).toEqual([]);
    expect(photoLuts({ filterId: 'warm', look: null })).toEqual([{ kind: 'filter', id: 'warm' }]);
    expect(photoLuts({ filterId: 'film', look: { id: 'film' } })).toEqual([
      { kind: 'filter', id: 'film' },
      { kind: 'look', id: 'film' },
    ]);
    expect(lookThumbUrl('ccd')).toBe('/luts/looks/look_ccd_thumb.png');
  });

  it('has only type imports and no runtime re-exports (scripts/gen-luts.mjs loads it under Node)', () => {
    const src = readFileSync(new URL('./looks.ts', import.meta.url), 'utf8');
    for (const line of src.split(/\r?\n/).filter((l) => /^\s*import\s/.test(l))) expect(line).toMatch(/^\s*import type\s/);
    expect(src).not.toMatch(/^\s*export\s+(\*|\{[^}]*\})\s+from\s/m);
  });
});
