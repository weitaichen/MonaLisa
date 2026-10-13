// The person strip (S §2.1): 「全部」 plus one 44 × 44 chip per person, a radiogroup between the stage and the slider
// row. Dimmed (and not selectable, still focusable) while the tab or its active item is photo-level (A11).
import { useLayoutEffect, useRef } from 'preact/hooks';
import type { PersonId, Rect, Selection } from '../../types';
import { haptic } from '../platform';

export interface StripPerson {
  id: PersonId;
  /** display number (cache order + 1) */
  n: number;
  /** aria-label: 人物 {n} / 人物 {n}（未偵測到臉部） / 人物 {n}（未偵測到身體） */
  label: string;
  /** 132² data URL, or null while it is drawn */
  thumb: string | null;
  /** ↶ ↷ touched this person: 600 ms highlight */
  changed: boolean;
  /** 長腿 is measured on this person (S §2.4) */
  ruler: boolean;
}

const THUMB = 132;

/** the thumbnail of `r` (UV) of the working bitmap, 132² (44 pt at 3×), as a JPEG data URL; null without a 2D context */
export function drawThumb(bitmap: ImageBitmap, r: Rect): string | null {
  const c = document.createElement('canvas');
  c.width = THUMB;
  c.height = THUMB;
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#222';
  ctx.fillRect(0, 0, THUMB, THUMB);
  ctx.drawImage(bitmap, r.x * bitmap.width, r.y * bitmap.height, r.w * bitmap.width, r.h * bitmap.height, 0, 0, THUMB, THUMB);
  const url = c.toDataURL('image/jpeg', 0.8);
  c.width = c.height = 0;
  return url;
}

export function PersonStrip({
  persons,
  selection,
  photoScope,
  onSelect,
  thumbTransform,
}: {
  persons: StripPerson[];
  selection: Selection;
  photoScope: boolean;
  onSelect(s: Selection): void;
  /** the O thumbnails shown upright after a 旋轉 / 翻轉 (geometry/view.ts chipTransform; S §2.2) */
  thumbTransform?: string;
}) {
  const rowRef = useRef<HTMLDivElement>(null);
  const selKey = selection.kind === 'all' ? 'all' : selection.id;
  useLayoutEffect(() => {
    rowRef.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
  }, [selKey]);
  const pick = (s: Selection) => {
    if (photoScope) return;
    if ((s.kind === 'all' ? 'all' : s.id) === selKey) return;
    haptic();
    onSelect(s);
  };
  return (
    <div class={`person-strip${photoScope ? ' dim' : ''}`} ref={rowRef} role="radiogroup" aria-label="選擇人物" aria-describedby={photoScope ? 'person-strip-scope' : undefined}>
      {photoScope && (
        <span class="strip-scope" id="person-strip-scope">
          整張照片
        </span>
      )}
      <button type="button" role="radio" class="person-chip all" aria-checked={selection.kind === 'all'} aria-disabled={photoScope ? 'true' : undefined} onClick={() => pick({ kind: 'all' })}>
        全部
      </button>
      {persons.map((p) => (
        <button
          key={p.id}
          type="button"
          role="radio"
          class={`person-chip${p.changed ? ' changed' : ''}`}
          aria-checked={selection.kind === 'person' && selection.id === p.id}
          aria-disabled={photoScope ? 'true' : undefined}
          aria-label={p.label}
          onClick={() => pick({ kind: 'person', id: p.id })}
        >
          {p.thumb ? <img src={p.thumb} alt="" style={thumbTransform ? { transform: thumbTransform } : undefined} /> : <span class="chip-blank" />}
          <span class="chip-num num" aria-hidden="true">
            {p.n}
          </span>
          {p.ruler && <i class="chip-ruler" aria-hidden="true" />}
        </button>
      ))}
    </div>
  );
}
