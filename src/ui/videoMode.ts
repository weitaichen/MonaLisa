// 錄影 in the camera (beauty video spec §4.1, §4.4): whether the browser can record, the clip's size, the badge's clock,
// the cap, what a stopped recording gives, and the toasts. Pure: the browser globals come in as a parameter, so a test
// needs no browser.
import { MAX_CLIP_MS, MIN_CLIP_MS, pickVideoMime } from '../media/recorder';
import { recordSize } from '../media/recordCanvas';
import { normalizedCropRect } from './imaging';

export const VIDEO_TOASTS = {
  /** the cap stopped the recording (MAX_CLIP_MS), then the clip screen opens */
  capped: '已錄滿 60 秒',
  /** a clip under MIN_CLIP_MS is discarded */
  short: '錄影時間太短',
  /** refused, missing or no answer in time: the clip has no sound (once per camera visit, spec §4.2) */
  silent: '無法使用麥克風，影片將沒有聲音',
  /** nothing to record with: 錄影 stays off, or a recording that could not start or gave nothing */
  unsupported: '這個瀏覽器無法錄影',
} as const;

/** what videoMime reads of the browser: globalThis, or a test's stand-in */
export interface VideoGlobals {
  MediaRecorder?: { isTypeSupported?(type: string): boolean };
  HTMLCanvasElement?: { prototype: { captureStream?: unknown } };
}

/**
 * The type 錄影 records in (pickVideoMime), or null when the browser cannot record: it needs MediaRecorder with one of
 * VIDEO_MIMES, and canvas captureStream for the recording canvas's track. Read through `g`, never a bare MediaRecorder,
 * which throws a ReferenceError where it is undeclared (task-6 ruling 9).
 */
export function videoMime(g: VideoGlobals = globalThis): string | null {
  if (typeof g.HTMLCanvasElement?.prototype.captureStream !== 'function') return null;
  return pickVideoMime((type) => {
    try {
      return g.MediaRecorder?.isTypeSupported?.(type) ?? false;
    } catch {
      return false;
    }
  });
}

/**
 * The clip's size for the 比例 crop of the display canvas: the ratio's centre crop of the video (source UV) in the
 * canvas's pixels, sized by recordSize. null when a side comes out 0 (a crop under 2 px): nothing can be recorded
 * (task-6 ruling 5).
 */
export function clipSize(videoW: number, videoH: number, ratio: number, canvasW: number, canvasH: number): { width: number; height: number } | null {
  const crop = normalizedCropRect(videoW, videoH, ratio);
  const size = recordSize(crop.w * canvasW, crop.h * canvasH);
  return size.width > 0 && size.height > 0 ? size : null;
}

/** The badge's 「mm:ss」 for `ms` recorded, whole seconds rounded down: 12_400 → 00:12, 61_000 → 01:01. */
export function clipClock(ms: number): string {
  const s = Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 1000) : 0;
  const two = (n: number) => String(n).padStart(2, '0');
  return `${two(Math.floor(s / 60))}:${two(s % 60)}`;
}

/** The longest clip: MAX_CLIP_MS, or the e2e's shorter cap (`__meiyanClipCapMs`), read when a recording starts. */
export function clipCapMs(g: object = globalThis): number {
  return (g as { __meiyanClipCapMs?: number }).__meiyanClipCapMs ?? MAX_CLIP_MS;
}

/**
 * What a stopped recording gives (spec §4.1): the clip screen; 'short' under MIN_CLIP_MS (discarded, 錄影時間太短); 'empty'
 * when no data arrived at all, a recorder that failed (there is nothing to play or save).
 */
export function clipOutcome(r: { durationMs: number; blob: { size: number } }): 'clip' | 'short' | 'empty' {
  if (r.durationMs < MIN_CLIP_MS) return 'short';
  return r.blob.size > 0 ? 'clip' : 'empty';
}
