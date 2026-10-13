// Re-parents the single shared display canvas (services.ts) into the current screen.
import type { JSX } from 'preact';
import { useLayoutEffect, useRef } from 'preact/hooks';
import { svc } from '../services';
import { useStore } from '../store';

/** `style`: the host box (裁切 mode sizes it to the O aspect and turns it with CSS, S §2.1) */
export function CanvasHost({ fit, style }: { fit: 'cover' | 'contain'; style?: JSX.CSSProperties }) {
  const ref = useRef<HTMLDivElement>(null);
  const canvas = useStore(svc, (s) => s.canvas);
  useLayoutEffect(() => {
    const host = ref.current;
    if (!host) return;
    canvas.style.objectFit = fit;
    host.appendChild(canvas);
    return () => {
      if (canvas.parentNode === host) host.removeChild(canvas);
    };
  }, [canvas, fit]);
  // no vdom children: Preact never touches the appended canvas
  return <div class="canvas-host" ref={ref} style={style} />;
}
