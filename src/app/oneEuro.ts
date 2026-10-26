// MediaPipe's own landmark smoother, replicated for the multi-face camera (S §3.4 T4, RM §3.7): one One-Euro filter
// per landmark coordinate, on values in source pixels, with the derivative scaled by 1 / face size, exactly as
// mediapipe/util/filtering/one_euro_filter.cc and LandmarksSmoothingCalculator do with the face-landmarks graph's
// options (ONE_EURO). MediaPipe smooths only at numFaces 1; with more faces the app does it.
import { ONE_EURO } from '../config/limits';

class LowPass {
  private stored = 0;
  private raw = 0;
  private init = false;
  get hasRaw(): boolean {
    return this.init;
  }
  get lastRaw(): number {
    return this.raw;
  }
  apply(value: number, alpha: number): number {
    const out = this.init ? alpha * value + (1 - alpha) * this.stored : value;
    this.init = true;
    this.raw = value;
    this.stored = out;
    return out;
  }
}

export class OneEuro {
  private readonly x = new LowPass();
  private readonly dx = new LowPass();
  /** Hz; MediaPipe starts at 30 and re-derives it from every timestamp pair */
  private frequency = 30;
  private lastMs = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly minCutoff: number = ONE_EURO.minCutoff,
    private readonly beta: number = ONE_EURO.beta,
    private readonly dCutoff: number = ONE_EURO.dCutoff,
  ) {}

  private alpha(cutoff: number): number {
    const te = 1 / this.frequency;
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / te);
  }

  /** MediaPipe's Apply(timestamp, value_scale, value): an equal or older timestamp returns the value as is */
  apply(value: number, tsMs: number, valueScale: number): number {
    if (tsMs <= this.lastMs) return value;
    if (Number.isFinite(this.lastMs)) this.frequency = 1000 / (tsMs - this.lastMs);
    this.lastMs = tsMs;
    const dvalue = this.x.hasRaw ? (value - this.x.lastRaw) * valueScale * this.frequency : 0;
    const edvalue = this.dx.apply(dvalue, this.alpha(this.dCutoff));
    const cutoff = this.minCutoff + this.beta * Math.abs(edvalue);
    return this.x.apply(value, this.alpha(cutoff));
  }
}

/**
 * One face's 478×3 landmarks: x·W, y·H, z·W filtered per coordinate, the derivative scaled by 1 / ((boxW + boxH) / 2).
 * Each coordinate is a OneEuro filter with its state in typed arrays (round-2 review D11: a track's start built 1434
 * OneEuro objects and their 2868 LowPass, so the call that starts ten tracks at once, a group coming back, spent about
 * 0.7 ms on it alone, over PB's 1 ms with the rest of that call). Every coordinate is applied on every call with the same
 * timestamp, so OneEuro's timestamp and frequency and LowPass's first-sample flag are the face's; the arithmetic is
 * OneEuro.apply's, in its order, so the output is OneEuro's to the bit (oneEuro.test.ts)
 */
export class LandmarkSmoother {
  /** x's LowPass per coordinate: the last raw value and the last output */
  private readonly raw: Float64Array;
  private readonly stored: Float64Array;
  /** dx's LowPass per coordinate: the last output (its raw value is never read) */
  private readonly dStored: Float64Array;
  /** OneEuro's, the same for every coordinate: Hz (MediaPipe starts at 30), the last timestamp */
  private frequency = 30;
  private lastMs = Number.NEGATIVE_INFINITY;
  /** LowPass's init, the same for every coordinate: a sample went in */
  private primed = false;

  constructor(private readonly n = 478) {
    this.raw = new Float64Array(n * 3);
    this.stored = new Float64Array(n * 3);
    this.dStored = new Float64Array(n * 3);
  }

  /** OneEuro's alpha at `cutoff` for this face's frequency */
  private alpha(cutoff: number): number {
    const te = 1 / this.frequency;
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / te);
  }

  /** OneEuro.apply on coordinate `k`, the timestamp and frequency already taken; `aD` the derivative's alpha */
  private filter(k: number, value: number, valueScale: number, aD: number): number {
    const dvalue = this.primed ? (value - this.raw[k]) * valueScale * this.frequency : 0;
    const edvalue = this.primed ? aD * dvalue + (1 - aD) * this.dStored[k] : dvalue;
    this.dStored[k] = edvalue;
    const a = this.alpha(ONE_EURO.minCutoff + ONE_EURO.beta * Math.abs(edvalue));
    const out = this.primed ? a * value + (1 - a) * this.stored[k] : value;
    this.raw[k] = value;
    this.stored[k] = out;
    return out;
  }

  apply(points: Float32Array, w: number, h: number, tsMs: number): Float32Array<ArrayBuffer> {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (let i = 0; i < this.n; i++) {
      const x = points[i * 3] * w;
      const y = points[i * 3 + 1] * h;
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
    }
    const size = (x1 - x0 + (y1 - y0)) / 2;
    const scale = size > 0 && Number.isFinite(size) ? 1 / size : 1;
    const out = new Float32Array(points.length);
    if (tsMs <= this.lastMs) {
      // OneEuro.apply: an equal or older timestamp returns each value as is and changes nothing
      for (let i = 0; i < this.n; i++) {
        out[i * 3] = (points[i * 3] * w) / w;
        out[i * 3 + 1] = (points[i * 3 + 1] * h) / h;
        out[i * 3 + 2] = (points[i * 3 + 2] * w) / w;
      }
      return out;
    }
    if (Number.isFinite(this.lastMs)) this.frequency = 1000 / (tsMs - this.lastMs);
    this.lastMs = tsMs;
    const aD = this.alpha(ONE_EURO.dCutoff);
    for (let i = 0; i < this.n; i++) {
      out[i * 3] = this.filter(i * 3, points[i * 3] * w, scale, aD) / w;
      out[i * 3 + 1] = this.filter(i * 3 + 1, points[i * 3 + 1] * h, scale, aD) / h;
      out[i * 3 + 2] = this.filter(i * 3 + 2, points[i * 3 + 2] * w, scale, aD) / w;
    }
    this.primed = true;
    return out;
  }
}
