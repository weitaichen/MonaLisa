// Beauty video recorder (beauty-video spec §4.4): which MIME the browser records, the bitrate, the MediaRecorder
// lifecycle and the file name. Pure: the browser pieces come in through RecorderEnv, so a test needs no camera.
import { stampedName } from './exporter';

/**
 * Best first. Plain video/mp4 comes after the named H.264 forms: Chromium would record VP9 in it, which iPhone Photos
 * cannot play.
 */
export const VIDEO_MIMES: readonly string[] = [
  'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
  'video/mp4;codecs=avc1,mp4a.40.2',
  'video/mp4',
  'video/webm;codecs=vp8,opus',
  'video/webm',
];

/** The longest clip: whoever starts the recorder stops it here. */
export const MAX_CLIP_MS = 60_000;
/** A shorter clip is discarded by the caller instead of reviewed. */
export const MIN_CLIP_MS = 1_000;
/** stop() waits this long for onstop, then assembles what arrived: iOS 15 sometimes never fires it. */
export const STOP_WAIT_MS = 2_000;

/** One-second chunks, so an onstop that never comes still leaves what was recorded. */
const TIMESLICE_MS = 1_000;
const AUDIO_BPS = 128_000;
const FRAME_RATE = 30;
const BITS_PER_PIXEL = 0.1;
const MIN_VIDEO_BPS = 2_000_000;
const MAX_VIDEO_BPS = 6_000_000;
/** assumed for a stream whose video track does not report its size */
const DEFAULT_SIZE = { width: 1280, height: 720 };

/** The first of VIDEO_MIMES that `isSupported` accepts; null when the browser records none of them. */
export function pickVideoMime(isSupported: (type: string) => boolean): string | null {
  // wrapped: find() would also hand over the index and the list
  return VIDEO_MIMES.find((type) => isSupported(type)) ?? null;
}

/** About 0.1 bit per pixel per frame at 30 fps, kept between 2 and 6 Mbps. */
export function videoBitrate(width: number, height: number): number {
  const bps = Math.round(width * height * FRAME_RATE * BITS_PER_PIXEL);
  return Math.min(MAX_VIDEO_BPS, Math.max(MIN_VIDEO_BPS, bps));
}

export interface ClipResult {
  /** every chunk that arrived, typed `mime`; empty when none did */
  blob: Blob;
  /** the recorder's MIME without codecs: video/mp4 or video/webm */
  mime: string;
  /** from the start to the end of the recording, see ClipRecorder.stop */
  durationMs: number;
  /** the stream had an audio track when the recording started */
  hasAudio: boolean;
}

export interface ClipRecorder {
  /**
   * Resolves once, at the first end of the recording: the stop() call, an error, or the browser stopping it by itself
   * (an encoder failure, its tracks ending). Never rejects. When it resolves without the caller's own stop(), the
   * recording is over although nobody asked: stop() still hands out what was recorded.
   */
  readonly ended: Promise<void>;
  /**
   * Stop and resolve with what was recorded; a second call returns the same promise. The recording ends at the first
   * of this call, an error and the browser stopping it by itself, and `durationMs` runs to that moment, not to the
   * late onstop. Resolves on onstop, or STOP_WAIT_MS after the call, whichever comes first.
   */
  stop(): Promise<ClipResult>;
}

/** What the recorder touches outside itself: the browser passes the real ones, a test passes fakes. */
export interface RecorderEnv {
  MediaRecorder: { new (s: MediaStream, o: MediaRecorderOptions): MediaRecorder };
  now(): number;
  setTimeout: typeof setTimeout;
  clearTimeout: typeof clearTimeout;
}

/**
 * Record `stream` as `mime` (an entry of VIDEO_MIMES, from pickVideoMime). Throws what MediaRecorder throws, e.g.
 * NotSupportedError for a MIME it refuses. The chunks kept before an error are still handed out by stop().
 */
export function startClipRecorder(stream: MediaStream, mime: string, env: RecorderEnv): ClipRecorder {
  // called detached: the browser's setTimeout throws "Illegal invocation" as a method of another object
  const { now, setTimeout, clearTimeout } = env;
  const { width, height } = streamSize(stream);
  const hasAudio = stream.getAudioTracks().length > 0;
  const rec = new env.MediaRecorder(stream, {
    mimeType: mime,
    videoBitsPerSecond: videoBitrate(width, height),
    audioBitsPerSecond: AUDIO_BPS,
  });
  const chunks: Blob[] = [];
  const startedAt = now();
  let endedAt: number | undefined;
  /** set by the executor below, which runs at once */
  let resolveEnded!: () => void;
  const ended = new Promise<void>((resolve) => {
    resolveEnded = resolve;
  });
  /** the browser's stop event came (after stop(), or by itself) */
  let stopped = false;
  /** set while stop() waits for the stop event */
  let whenStopped: (() => void) | null = null;

  // the recording ends at the first of: the stop() call, an error, the browser stopping by itself (not the late
  // onstop); `ended` resolves there
  const markEnd = (): number => {
    if (endedAt === undefined) {
      endedAt = now();
      resolveEnded();
    }
    return endedAt;
  };
  // stop() throws on an inactive recorder; one that throws anyway is left to the STOP_WAIT_MS timer
  const halt = () => {
    if (rec.state === 'inactive') return;
    try {
      rec.stop();
    } catch {
      /* the timer settles stop() */
    }
  };

  rec.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };
  rec.onstop = () => {
    markEnd();
    stopped = true;
    whenStopped?.();
  };
  // an error ends the recording: stop the recorder and keep what arrived
  rec.onerror = () => {
    markEnd();
    halt();
  };
  rec.start(TIMESLICE_MS);

  let result: Promise<ClipResult> | null = null;
  return {
    ended,
    stop() {
      result ??= new Promise<ClipResult>((resolve) => {
        const durationMs = markEnd() - startedAt;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const settle = () => {
          clearTimeout(timer);
          whenStopped = null;
          const type = baseMime(rec.mimeType || mime);
          resolve({ blob: new Blob(chunks, { type }), mime: type, durationMs, hasAudio });
        };
        // already stopped (an error, the tracks ending): there is no stop event left to wait for
        if (stopped) return settle();
        whenStopped = settle;
        timer = setTimeout(settle, STOP_WAIT_MS);
        halt();
      });
      return result;
    },
  };
}

/** The File to save or share: meiyan-YYYYMMDD-HHMMSS.mp4 or .webm, typed like the recording. */
export function clipFile(r: ClipResult, d: Date = new Date()): File {
  const ext = r.mime === 'video/mp4' ? 'mp4' : 'webm';
  return new File([r.blob], stampedName(ext, d), { type: r.mime, lastModified: d.getTime() });
}

// ── internals ──

/** The size the encoder will get: the video track's settings, else DEFAULT_SIZE. */
function streamSize(stream: MediaStream): { width: number; height: number } {
  const s = stream.getVideoTracks()[0]?.getSettings();
  return s?.width && s.height ? { width: s.width, height: s.height } : DEFAULT_SIZE;
}

/** video/mp4;codecs=avc1.42E01E,mp4a.40.2 → video/mp4 */
function baseMime(type: string): string {
  return type.split(';')[0].trim().toLowerCase();
}
