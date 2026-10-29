import { describe, expect, it, vi } from 'vitest';
import { MAX_CLIP_MS, VIDEO_MIMES } from '../media/recorder';
import { clipCapMs, clipClock, clipOutcome, clipSize, VIDEO_TOASTS, videoMime } from './videoMode';

/** a browser's globals as videoMime reads them: MediaRecorder accepting `types`, canvas captureStream or not */
function browser(o: { types?: readonly string[] | null; captureStream?: boolean }) {
  const recorder =
    o.types === null
      ? undefined
      : {
          accepted: new Set(o.types ?? VIDEO_MIMES),
          // a static method that reads `this`, as a native one may
          isTypeSupported(this: { accepted: Set<string> }, t: string) {
            return this.accepted.has(t);
          },
        };
  return { MediaRecorder: recorder, HTMLCanvasElement: { prototype: o.captureStream === false ? {} : { captureStream: () => null } } };
}

describe('錄影 in the camera (beauty video spec §4.1, §4.4)', () => {
  it('the copy', () => {
    expect(VIDEO_TOASTS).toEqual({
      capped: '已錄滿 60 秒',
      short: '錄影時間太短',
      silent: '無法使用麥克風，影片將沒有聲音',
      unsupported: '這個瀏覽器無法錄影',
    });
  });

  describe('videoMime: what 錄影 needs of the browser (task-6 ruling 9)', () => {
    it('the first of VIDEO_MIMES the browser records: H.264 MP4 first, WebM where MP4 is not', () => {
      expect(videoMime(browser({}))).toBe('video/mp4;codecs=avc1.42E01E,mp4a.40.2');
      expect(videoMime(browser({ types: ['video/webm', 'video/webm;codecs=vp8,opus'] }))).toBe('video/webm;codecs=vp8,opus');
    });

    it('null without MediaRecorder, without isTypeSupported, or with none of the types', () => {
      expect(videoMime(browser({ types: null }))).toBeNull();
      expect(videoMime({ MediaRecorder: {}, HTMLCanvasElement: { prototype: { captureStream: () => null } } })).toBeNull();
      expect(videoMime(browser({ types: ['video/x-matroska'] }))).toBeNull();
      expect(videoMime({})).toBeNull();
    });

    it('null without canvas captureStream (the recording canvas has no track to record), whatever MediaRecorder says', () => {
      const isTypeSupported = vi.fn(() => true);
      expect(videoMime({ MediaRecorder: { isTypeSupported }, HTMLCanvasElement: { prototype: {} } })).toBeNull();
      expect(videoMime({ MediaRecorder: { isTypeSupported } })).toBeNull();
    });

    it('an isTypeSupported that throws counts as a no', () => {
      const throwing = { isTypeSupported: () => { throw new Error('boom'); } };
      expect(videoMime({ MediaRecorder: throwing, HTMLCanvasElement: { prototype: { captureStream: () => null } } })).toBeNull();
    });

    it('reads globalThis by default, never a bare MediaRecorder (a ReferenceError where it is undeclared)', () => {
      // node has neither MediaRecorder nor HTMLCanvasElement
      expect(() => videoMime()).not.toThrow();
      expect(videoMime()).toBeNull();
    });
  });

  describe('clipSize: the 比例 crop of the display canvas, as recordSize sizes it (task-6 ruling 5)', () => {
    it('the ratio’s centre crop of the video, in the canvas’s pixels', () => {
      // 1280×720 at 3:4: 540×720 of the frame, on a canvas of the video's size
      expect(clipSize(1280, 720, 3 / 4, 1280, 720)).toEqual({ width: 540, height: 720 });
      // the same crop on a canvas a lower tier drew (960×540): 405×540, even
      expect(clipSize(1280, 720, 3 / 4, 960, 540)).toEqual({ width: 404, height: 540 });
      // an upright 1080×1920 stream at 9:16 is the whole frame
      expect(clipSize(1080, 1920, 9 / 16, 1080, 1920)).toEqual({ width: 1080, height: 1920 });
      // 1:1 of a 1920×1080 frame drawn at 1920×1080
      expect(clipSize(1920, 1080, 1, 1920, 1080)).toEqual({ width: 1080, height: 1080 });
    });

    it('scaled to the clip’s limits (short edge 1080, long edge 1920)', () => {
      expect(clipSize(2160, 3840, 9 / 16, 2160, 3840)).toEqual({ width: 1080, height: 1920 });
    });

    it('null when a side comes out 0: a crop under 2 px, an empty canvas, no size at all', () => {
      expect(clipSize(1280, 720, 3 / 4, 2, 1)).toBeNull();
      expect(clipSize(1280, 720, 3 / 4, 0, 0)).toBeNull();
      expect(clipSize(1280, 720, 3 / 4, Number.NaN, 720)).toBeNull();
    });
  });

  it('clipClock: the badge’s mm:ss, whole seconds rounded down', () => {
    expect([0, 999, 1000, 12_400, 59_999, 60_000, 61_000].map(clipClock)).toEqual(['00:00', '00:00', '00:01', '00:12', '00:59', '01:00', '01:01']);
    expect([-5, Number.NaN, Number.POSITIVE_INFINITY].map(clipClock)).toEqual(['00:00', '00:00', '00:00']);
  });

  it('clipCapMs: MAX_CLIP_MS, or the e2e’s shorter cap', () => {
    expect(MAX_CLIP_MS).toBe(60_000);
    expect(clipCapMs({})).toBe(MAX_CLIP_MS);
    expect(clipCapMs({ __meiyanClipCapMs: 2500 })).toBe(2500);
    expect(clipCapMs()).toBe(MAX_CLIP_MS);
  });

  it('clipOutcome: the clip screen from 1 s on; a shorter clip is discarded; a recording with no data at all failed', () => {
    const blob = (size: number) => ({ size });
    expect(clipOutcome({ durationMs: 999, blob: blob(10) })).toBe('short');
    expect(clipOutcome({ durationMs: 1000, blob: blob(10) })).toBe('clip');
    expect(clipOutcome({ durationMs: 30_000, blob: blob(0) })).toBe('empty');
    expect(clipOutcome({ durationMs: 400, blob: blob(0) })).toBe('short');
  });
});
