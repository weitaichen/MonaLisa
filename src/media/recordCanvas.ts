// Beauty video recording canvas (beauty-video spec §4.3): one detached 2D canvas of a fixed size. The live loop copies
// each beautified frame into it, cropped to the 比例 and mirrored as a saved photo would be, and its captureStream is
// the clip's video track. A tier step or a loop restart changes the source, never this size, so the encoder sees one
// resolution. The DOM comes in through `doc`, so a test needs no browser.
import type { Rect as UvRect } from '../types';

/** The clip's short edge is at most this. */
const MAX_SHORT_EDGE = 1080;
/** The clip's long edge is at most this. */
const MAX_LONG_EDGE = 1920;
/** The capture rate; recorder.ts sizes the bitrate for the same 30. */
const FRAME_RATE = 30;
/**
 * A crop size is a UV fraction times a pixel size, then scaled by a division: it can come out as 1919.9999999999998
 * for 1920. Rounding down must not cost the clip a pixel for that.
 */
const SIZE_SLACK = 1e-6;

/**
 * The clip's size for a crop of cropW × cropH pixels: scaled down, keeping its shape, until the short edge is at most
 * 1080 and the long edge at most 1920; never scaled up. Both sides are whole and even (H.264), rounded down.
 */
export function recordSize(cropW: number, cropH: number): { width: number; height: number } {
  const scale = Math.min(1, MAX_SHORT_EDGE / Math.min(cropW, cropH), MAX_LONG_EDGE / Math.max(cropW, cropH));
  return { width: evenDown(cropW * scale), height: evenDown(cropH * scale) };
}

export interface RecordSink {
  /**
   * Copy `crop` (source UV) of `src` into the whole recording canvas, scaled, and mirrored when `flipX`. Call it right
   * after the draw, in the same task: a WebGL canvas without preserveDrawingBuffer is cleared once the browser has
   * presented it.
   */
  frame(src: CanvasImageSource & { width: number; height: number }, crop: UvRect, flipX: boolean): void;
}

export interface RecordCanvas {
  sink: RecordSink;
  /** the canvas's video track at 30 fps; the clip's stream is this track plus the microphone's */
  stream: MediaStream;
  /** the fixed size of every frame of the clip */
  width: number;
  height: number;
  /**
   * Stop the stream's tracks as they were made (not a microphone track added since) and free the canvas. Call it after
   * the recorder has stopped.
   */
  release(): void;
}

/** A recording canvas of width × height pixels (a size from recordSize). Throws when there is no 2D context. */
export function createRecordCanvas(width: number, height: number, doc: Document = document): RecordCanvas {
  const canvas = doc.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('recordCanvas: 2D canvas unavailable');
  const stream = canvas.captureStream(FRAME_RATE);
  // taken now: a track added to `stream` later (the microphone) stays with whoever owns it
  const tracks = stream.getTracks();
  return {
    sink: {
      frame(src, crop, flipX) {
        // the crop in the source's own pixels, into the whole canvas
        const sx = crop.x * src.width;
        const sy = crop.y * src.height;
        const sw = crop.w * src.width;
        const sh = crop.h * src.height;
        ctx.imageSmoothingEnabled = true;
        if (flipX) ctx.setTransform(-1, 0, 0, 1, width, 0);
        ctx.drawImage(src, sx, sy, sw, sh, 0, 0, width, height);
        if (flipX) ctx.setTransform(1, 0, 0, 1, 0, 0);
      },
    },
    stream,
    width,
    height,
    release() {
      tracks.forEach((track) => track.stop());
      // iOS caps total canvas memory and frees backing stores only on GC; release eagerly (as createSurface does).
      canvas.width = canvas.height = 0;
    },
  };
}

// ── internals ──

/** px as a whole, even number of pixels, rounded down. */
function evenDown(px: number): number {
  const whole = Math.floor(px + SIZE_SLACK);
  return whole - (whole % 2);
}
