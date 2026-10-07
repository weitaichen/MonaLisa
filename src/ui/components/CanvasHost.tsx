// Re-parents the single shared display canvas (services.ts) into the current screen.
import { useLayoutEffect, useRef } from 'preact/hooks';
import { svc } from '../services';
import { useStore } from '../store';

export function CanvasHost({ fit }: { fit: 'cover' | 'contain' }) {
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
  return <div class="canvas-host" ref={ref} />;
}
