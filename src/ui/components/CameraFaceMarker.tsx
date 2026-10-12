// The camera's face marker (S §2.5): an 800 ms accent ring after a selection and a 6 px dot above the beautified face
// while ≥ 2 tracks are shown and 全部套用 is off. DOM only, pointer-events: none; never part of the captured photo.
import { useEffect, useRef } from 'preact/hooks';
import type { LiveLoop } from '../../app/live';
import { type TrackId, videoToFrame } from '../../app/faceTracks';

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
  useEffect(() => {
    let raf = 0;
    const draw = () => {
      raf = 0;
      const el = ref.current;
      if (!el) return;
      const views = loop.tracks();
      const ringAge = ring === null ? Infinity : performance.now() - ring.at;
      const ringOn = ringAge < 800;
      const dotOn = views.length >= 2 && !all;
      el.replaceChildren();
      if (!ringOn && !dotOn) return; // nothing to draw: the loop stops until a prop changes
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
        if (showRing) {
          const r = document.createElement('i');
          r.className = 'cam-ring';
          // rebuilt every frame: the negative delay resumes the 800 ms fade where it is instead of restarting it
          Object.assign(r.style, { left: `${left}px`, top: `${ay}px`, width: `${width}px`, height: `${by - ay}px`, animationDelay: `${-ringAge}ms` });
          el.append(r);
        }
        if (showDot) {
          const d = document.createElement('i');
          d.className = 'cam-dot';
          Object.assign(d.style, { left: `${left + width / 2 - 3}px`, top: `${ay - 12}px` });
          el.append(d);
        }
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [loop, canvas, video, ring, all, mirrored, count]);
  return <div class="cam-marker" ref={ref} aria-hidden="true" />;
}
