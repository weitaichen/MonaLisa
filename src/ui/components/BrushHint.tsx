// 推臉筆 hint pill (push-brush spec §2.3): top centre of .frame, outside the zoom layer; shown 2.5 s on entering the
// mode and on each 推／恢復 switch, then fades over 300 ms (CSS). The editor unmounts it after BRUSH_HINT_MS.
import type { BrushKind } from '../../types';

export const BRUSH_HINT_MS = 2800;

export function hintText(kind: BrushKind): string {
  return kind === 'push' ? '單指推動，雙指縮放' : '單指塗抹恢復，雙指縮放';
}

export function BrushHint({ kind }: { kind: BrushKind }) {
  return (
    <div class="brush-hint" role="status">
      {hintText(kind)}
    </div>
  );
}
