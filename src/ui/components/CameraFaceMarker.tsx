// The camera's face marker (S §2.5): an 800 ms accent ring after a selection and a 6 px dot above the beautified face
// while ≥ 2 tracks are shown and 全部套用 is off. DOM only, pointer-events: none; never part of the captured photo.
// It runs next to the 30 fps camera render, so its nodes live as long as the marker: one dot, and one ring per
// selection (a fresh node starts the CSS fade); each frame writes only the styles whose value changed.
import { useEffect, useRef } from 'preact/hooks';
import type { LiveLoop } from '../../app/live';
import { type TrackId, videoToFrame } from '../../app/faceTracks';

/** px, rounded to 0.1 so sub-pixel smoothing noise writes nothing */
const px = (v: number) => `${Math.round(v * 10) / 10}px`;

/** the marker's nodes; set() writes a style only when it changed */
class MarkerNodes {
  private dot: HTMLElement | null = null;
  private ring: HTMLElement | null = null;
  /** the selection (its `at`) the ring node was made for */
  private ringAt: number | null = null;
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

  showDot(pos: { left: number; top: number } | null): void {
    if (!pos) {
      if (this.dot) this.set(this.dot, { display: 'none' });
      return;
    }
    this.dot ??= this.make('cam-dot');
    this.set(this.dot, { display: '', left: px(pos.left), top: px(pos.top) });
  }

  /** `at` identifies the selection: a new one replaces the node, so its fade starts over; `age` resumes it where it is */
  showRing(box: { left: number; top: number; width: number; height: number } | null, at: number, age: number): void {
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
}: {
  loop: LiveLoop;
  canvas: HTMLCanvasElement;
  video: HTMLVideoElement;
  mirrored: boolean;
  ring: { id: TrackId; at: number } | null;
  all: boolean;
  count: number;
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
      const dotOn = views.length >= 2 && !all;
      let ringBox: { left: number; top: number; width: number; height: number } | null = null;
      let dot: { left: number; top: number } | null = null;
      if (ringOn || dotOn) {
        const rect = canvas.getBoundingClientRect();
        const vw = video.videoWidth;
        const vh = video.videoHeight;
        for (const v of views) {
          const showRing = ringOn && v.id === ring!.id;
          const showDot = dotOn && v.beautified;
          if (!showRing && !showDot) continue;
          const [ax, ay] = videoToFrame(v.box.x, v.box.y, rect, vw, vh, mirrored);
          const [bx, by] = videoToFrame(v.box.x + v.box.w, v.box.y + v.box.h, rect, vw, vh, mirrored);
          const left = Math.min(ax, bx);
          const width = Math.abs(bx - ax);
          if (showRing) ringBox = { left, top: ay, width, height: by - ay };
          if (showDot) dot = { left: left + width / 2 - 3, top: ay - 12 };
        }
      }
      n.showRing(ringBox, ring?.at ?? 0, ringAge);
      n.showDot(dot);
      if (!ringOn && !dotOn) return; // nothing to draw: the loop stops until a prop changes
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [loop, canvas, video, ring, all, mirrored, count]);
  return <div class="cam-marker" ref={ref} aria-hidden="true" />;
}
