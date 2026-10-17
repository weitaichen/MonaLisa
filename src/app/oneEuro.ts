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

/** One face's 478×3 landmarks: x·W, y·H, z·W filtered per coordinate, the derivative scaled by 1 / ((boxW + boxH) / 2) */
export class LandmarkSmoother {
  private readonly f: OneEuro[];

  constructor(private readonly n = 478) {
    this.f = Array.from({ length: n * 3 }, () => new OneEuro());
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
    for (let i = 0; i < this.n; i++) {
      out[i * 3] = this.f[i * 3].apply(points[i * 3] * w, tsMs, scale) / w;
      out[i * 3 + 1] = this.f[i * 3 + 1].apply(points[i * 3 + 1] * h, tsMs, scale) / h;
      out[i * 3 + 2] = this.f[i * 3 + 2].apply(points[i * 3 + 2] * w, tsMs, scale) / w;
    }
    return out;
  }
}
