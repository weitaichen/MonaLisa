// One-shot "next video frame" scheduling: requestVideoFrameCallback when available (Safari 15.4+,
// Chrome, Firefox 132+), else requestAnimationFrame polling for a currentTime change.

export interface FrameInfo {
  /** callback timestamp, same clock as performance.now() */
  now: number;
  /** rVFC metadata.presentedFrames (null in the rAF fallback) — lets the loop see dropped frames */
  presentedFrames: number | null;
}

export interface FrameSource {
  readonly kind: 'rvfc' | 'raf';
  /** Schedule `cb` for the next new frame. Replaces any pending request (at most one outstanding). */
  request(cb: (info: FrameInfo) => void): void;
  cancel(): void;
}

const HAVE_CURRENT_DATA = 2;

/** `rvfc: false` forces the rAF fallback (used by the live loop's watchdog). */
export function createVideoFrameSource(video: HTMLVideoElement, opts: { rvfc?: boolean } = {}): FrameSource {
  if (opts.rvfc !== false && typeof video.requestVideoFrameCallback === 'function') {
    let handle = 0;
    const cancel = () => {
      if (handle) video.cancelVideoFrameCallback(handle);
      handle = 0;
    };
    return {
      kind: 'rvfc',
      request(cb) {
        cancel();
        handle = video.requestVideoFrameCallback((now, md) => {
          handle = 0;
          cb({ now, presentedFrames: typeof md?.presentedFrames === 'number' ? md.presentedFrames : null });
        });
      },
      cancel,
    };
  }

  let raf = 0;
  let lastTime = -1;
  const cancel = () => {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  };
  return {
    kind: 'raf',
    request(cb) {
      cancel();
      const tick = (now: number) => {
        raf = 0;
        const t = video.currentTime;
        if (video.readyState >= HAVE_CURRENT_DATA && t !== lastTime) {
          lastTime = t;
          cb({ now, presentedFrames: null });
        } else {
          raf = requestAnimationFrame(tick);
        }
      };
      raf = requestAnimationFrame(tick);
    },
    cancel,
  };
}
