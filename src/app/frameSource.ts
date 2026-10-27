// One-shot "next video frame" scheduling: requestVideoFrameCallback when available (Safari 15.4+,
// Chrome, Firefox 132+), else requestAnimationFrame polling for a currentTime change.

export interface FrameInfo {
  /** callback timestamp, same clock as performance.now() */
  now: number;
  /** rVFC metadata.presentedFrames (null in the rAF fallback) — lets the loop see dropped frames */
  presentedFrames: number | null;
  /**
   * rVFC metadata.mediaTime, s: the presented frame's own timestamp, which no main-thread work delays (null in the rAF
   * fallback) — with presentedFrames, the camera's own frame interval (camera per-person spec §6.4's T)
   */
  mediaTime: number | null;
  /**
   * rVFC metadata.presentationTime: when the frame was handed to the compositor, on performance.now()'s clock (null in
   * the rAF fallback) — the start of the span the frame's callback can keep the loop from seeing frames (§6.4,
   * framesBlocked)
   */
  presentationTime: number | null;
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
          cb({
            now,
            presentedFrames: typeof md?.presentedFrames === 'number' ? md.presentedFrames : null,
            mediaTime: typeof md?.mediaTime === 'number' ? md.mediaTime : null,
            presentationTime: typeof md?.presentationTime === 'number' ? md.presentationTime : null,
          });
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
          cb({ now, presentedFrames: null, mediaTime: null, presentationTime: null });
        } else {
          raf = requestAnimationFrame(tick);
        }
      };
      raf = requestAnimationFrame(tick);
    },
    cancel,
  };
}
