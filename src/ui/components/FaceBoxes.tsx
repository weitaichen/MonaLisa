// Face boxes (S §2.1): drawn corner brackets inside .zoom-layer, never buttons (pointer-events: none). Every photo tap
// reaches zoomPan, which hit-tests (S §2.3). Strokes stay 2 px at any zoom through --zs (zoomPan apply).
import type { PersonId, Rect } from '../../types';

export interface FaceBoxItem {
  person: PersonId;
  n: number;
  /** source UV (the face box, or the pose box of a body-only person) */
  box: Rect;
  selected: boolean;
  changed: boolean;
  /** a body-only person in 美體: dashed brackets around its pose box */
  dashed: boolean;
  /**
   * the box's width on screen at zoom 1, pt. The badge hides below 24 pt on screen (S §2.1): theme.css decides it from this
   * and the zoom (--zs, written by zoomPan without a render), so a pinch shows or hides it at once
   */
  width: number;
}

const PAD = 0.15;
const same = (y: number) => y;

export function FaceBoxes({ items, dim, idle, mapY }: { items: FaceBoxItem[]; dim: boolean; idle: boolean; mapY?: (y: number) => number }) {
  if (!items.length) return null;
  // rows stretched by 增高 / 長腿 move the box with them (forwardY of the current field's bands)
  const y = mapY ?? same;
  return (
    <div class={`face-boxes${dim ? ' dim' : ''}${idle ? ' idle' : ''}`} aria-hidden="true">
      {items.map((it) => {
        const b = it.box;
        const x0 = b.x - b.w * PAD;
        const x1 = b.x + b.w * (1 + PAD);
        const y0 = y(b.y - b.h * PAD);
        const y1 = y(b.y + b.h * (1 + PAD));
        return (
          <div
            key={it.person}
            class={`face-box${it.selected ? ' selected' : ''}${it.changed ? ' changed' : ''}${it.dashed ? ' dashed' : ''}`}
            style={{ left: `${x0 * 100}%`, top: `${y0 * 100}%`, width: `${(x1 - x0) * 100}%`, height: `${(y1 - y0) * 100}%` }}
          >
            <i class="br tl" />
            <i class="br tr" />
            <i class="br bl" />
            <i class="br br-r" />
            <span class="face-num num" style={{ '--bw': String(it.width) }}>
              {it.n}
            </span>
          </div>
        );
      })}
    </div>
  );
}
