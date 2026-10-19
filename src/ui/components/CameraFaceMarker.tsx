// The camera's face marker (S §2.5): an 800 ms accent ring around the tapped person; while ≥ 2 tracks are shown and
// 全部套用 is off, faint corner brackets on every shown face and a 6 px dot above the target's face (the person the
// sliders edit, camera per-person spec §3.1, K12). While the active panel item is photo-level the layer dims to 30 %
// (S A11). DOM only, pointer-events: none; never part of the captured photo.
// It runs next to the 30 fps camera render, so its nodes live as long as the marker: one dot, one bracket per track,
// and one ring per selection (a fresh node starts the CSS fade); each frame writes only the styles whose value changed.
import { useEffect, useRef } from 'preact/hooks';
import type { LiveLoop } from '../../app/live';
import { videoToFrame, type TrackId } from '../../app/faceTracks';
import type { LivePersonId } from '../../app/livePersons';

/** px, rounded to 0.1 so sub-pixel smoothing noise writes nothing */
const px = (v: number) => `${Math.round(v * 10) / 10}px`;

/** a face's box on the marker layer, CSS px */
interface PxBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** the editor's bracket corners (.face-box .br, theme.css) */
const CORNERS = ['br tl', 'br tr', 'br bl', 'br br-r'];

/** the marker's nodes; set() writes a style only when it changed */
class MarkerNodes {
  private dot: HTMLElement | null = null;
  private ring: HTMLElement | null = null;
  /** the selection (its `at`) the ring node was made for */
  private ringAt: number | null = null;
  /** one bracket per track, made once with its four corners */
  private readonly brackets = new Map<TrackId, HTMLElement>();
  private readonly last = new WeakMap<HTMLElement, Record<string, string>>();

  constructor(private readonly root: HTMLElement) {}

  private set(el: HTMLElement, styles: Record<string, string>): void {
    let prev = this.last.get(el);
    if (!prev) this.last.set(el, (prev = {}));
    for (const [k, v] of Object.entries(styles)) {
      if (prev[k] === v) continue;
      prev[k] = v;
      (el.style as unknown as Record<string, string>)[k] = v;
    }
  }

  private make(cls: string): HTMLElement {
    const el = document.createElement('i');
    el.className = cls;
    this.root.appendChild(el);
    return el;
  }

  /** a box per shown track; null hides them all. A vanished track's node goes with it */
  showBrackets(boxes: Map<TrackId, PxBox> | null): void {
    if (!boxes) {
      for (const el of this.brackets.values()) this.set(el, { display: 'none' });
      return;
    }
    for (const [id, el] of this.brackets) {
      if (boxes.has(id)) continue;
      el.remove();
      this.brackets.delete(id);
    }
    for (const [id, b] of boxes) {
      let el = this.brackets.get(id);
      if (!el) {
        // stacking needs no care: the dot sits above the box and the ring is round, neither reaches a corner
        el = this.make('cam-bracket');
        for (const c of CORNERS) {
          const corner = document.createElement('i');
          corner.className = c;
          el.appendChild(corner);
        }
        this.brackets.set(id, el);
      }
      this.set(el, { display: '', left: px(b.left), top: px(b.top), width: px(b.width), height: px(b.height) });
    }
  }

  showDot(pos: { left: number; top: number } | null): void {
    if (!pos) {
      if (this.dot) this.set(this.dot, { display: 'none' });
      return;
    }
    this.dot ??= this.make('cam-dot');
    this.set(this.dot, { display: '', left: px(pos.left), top: px(pos.top) });
  }

  /** `at` identifies the selection: a new one replaces the node, so its fade starts over; `age` resumes it where it is */
  showRing(box: PxBox | null, at: number, age: number): void {
    if (!box) {
      if (this.ring) this.set(this.ring, { display: 'none' });
      return;
    }
    if (this.ring && this.ringAt !== at) {
      this.ring.remove();
      this.ring = null;
    }
    if (!this.ring) {
      this.ring = this.make('cam-ring');
      this.ringAt = at;
      // a node made a few frames after the tap (the loop was restarted) joins the 800 ms fade where it is
      this.set(this.ring, { animationDelay: `${-Math.round(age)}ms` });
    } else if (this.last.get(this.ring)?.display === 'none') {
      // display: none cancelled the fade; shown again, it restarts, so resume it where it is
      this.set(this.ring, { animationDelay: `${-Math.round(age)}ms` });
    }
    this.set(this.ring, { display: '', left: px(box.left), top: px(box.top), width: px(box.width), height: px(box.height) });
  }
}

export function CameraFaceMarker({
  loop,
  canvas,
  video,
  mirrored,
  ring,
  all,
  count,
  dim,
}: {
  loop: LiveLoop;
  canvas: HTMLCanvasElement;
  video: HTMLVideoElement;
  mirrored: boolean;
  /** the tapped person and the tap's time */
  ring: { person: LivePersonId; at: number } | null;
  all: boolean;
  count: number;
  /** the active panel item is photo-level (photoScoped): the layer dims to 30 % */
  dim: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const nodes = useRef<MarkerNodes | null>(null);
  useEffect(() => {
    let raf = 0;
    const draw = () => {
      raf = 0;
      const el = ref.current;
      if (!el) return;
      const n = (nodes.current ??= new MarkerNodes(el));
      const views = loop.tracks();
      const ringAge = ring === null ? Infinity : performance.now() - ring.at;
      const ringOn = ringAge < 800;
      // the brackets and the dot (K12): ≥ 2 shown faces, 全部套用 off
      const facesOn = views.length >= 2 && !all;
      let ringBox: PxBox | null = null;
      let dot: { left: number; top: number } | null = null;
      const brackets = facesOn ? new Map<TrackId, PxBox>() : null;
      if (ringOn || facesOn) {
        const rect = canvas.getBoundingClientRect();
        const vw = video.videoWidth;
        const vh = video.videoHeight;
        for (const v of views) {
          const showRing = ringOn && v.person === ring!.person;
          if (!showRing && !facesOn) continue;
          const [ax, ay] = videoToFrame(v.box.x, v.box.y, rect, vw, vh, mirrored);
          const [bx, by] = videoToFrame(v.box.x + v.box.w, v.box.y + v.box.h, rect, vw, vh, mirrored);
          const left = Math.min(ax, bx);
          const width = Math.abs(bx - ax);
          const box = { left, top: ay, width, height: by - ay };
          if (showRing) ringBox = box;
          if (brackets) {
            brackets.set(v.id, box);
            if (v.selected) dot = { left: left + width / 2 - 3, top: ay - 12 };
          }
        }
      }
      n.showBrackets(brackets);
      n.showRing(ringBox, ring?.at ?? 0, ringAge);
      n.showDot(dot);
      if (!ringOn && !facesOn) return; // nothing to draw: the loop stops until a prop changes
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [loop, canvas, video, ring, all, mirrored, count]);
  return <div class={`cam-marker${dim ? ' dim' : ''}`} ref={ref} aria-hidden="true" />;
}
