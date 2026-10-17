// Deterministic 推臉筆 strokes and their field for the export harness (push-brush spec §8.3 test 9, the release gate):
// built with the app's own LiquifyModel, so the harness renders exactly what the editor would.
import { LiquifyModel, liquifyGrid } from '../../../src/edit/liquify';
import { straightStroke } from '../../../src/edit/strokeFixtures';
import type { LiquifyField, LiquifyFrame, Stroke } from '../../../src/types';

/** two pushes and a half restore around the middle of the frame (O UV), at 中 and 大 */
export function buildStrokeCase(frame: LiquifyFrame): { strokes: Stroke[]; field: LiquifyField; model: LiquifyModel } {
  const g = liquifyGrid(frame);
  const M = 28.7 / g.F;
  const L = M * (44 / 28);
  const strokes = [
    ...straightStroke(frame, 'push', L, { x: 0.35, y: 0.45 }, { x: 0.35 + (2 * L) / g.ax, y: 0.45 }, 'tile-a'),
    ...straightStroke(frame, 'push', M, { x: 0.6, y: 0.3 }, { x: 0.6 - M / g.ax, y: 0.3 + (2 * M) / g.ay }, 'tile-b'),
    ...straightStroke(frame, 'restore', M, { x: 0.35, y: 0.42 }, { x: 0.35 + L / g.ax, y: 0.42 }, 'tile-c'),
  ];
  const model = new LiquifyModel(frame, { now: () => 0, syncWork: Infinity });
  model.sync(strokes);
  return { strokes, field: model.snapshot()!, model };
}
