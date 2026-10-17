// Test-only (Node): rasterizes toneGeometry draw lists the way toneMask.ts draws them on the GPU — pixel-centre coverage,
// the interpolated value through smoothstep, off + str · m per channel, MAX / MIN blending, 8-bit storage. Vitest has no
// GPU (the calibration test), and tone-engine.spec.ts checks the GPU targets against it.
import { smoothstep, type Rgba, type ToneDraw, type Win } from './passes/toneGeometry';

export function rasterizeTone(draws: readonly ToneDraw[], w: number, h: number, win: Win, clear: Rgba): Float32Array {
  const out = new Float32Array(w * h * 4);
  for (let i = 0; i < w * h; i++) out.set(clear, i * 4);
  const order = draws.map((d, i) => ({ d, i })).sort((a, b) => a.d.phase - b.d.phase || a.i - b.i);
  for (const { d } of order) {
    const v = d.verts;
    for (let t = 0; t + 8 < v.length; t += 9) {
      const P = [0, 3, 6].map((k) => [((v[t + k] - win[0]) / win[2]) * w, ((v[t + k + 1] - win[1]) / win[3]) * h, v[t + k + 2]]);
      const [a, b, c] = P;
      const area = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      if (Math.abs(area) < 1e-12) continue;
      const x0 = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0])));
      const x1 = Math.min(w - 1, Math.ceil(Math.max(a[0], b[0], c[0])));
      const y0 = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1])));
      const y1 = Math.min(h - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const px = x + 0.5;
          const py = y + 0.5;
          const wa = ((b[0] - px) * (c[1] - py) - (b[1] - py) * (c[0] - px)) / area;
          const wb = ((c[0] - px) * (a[1] - py) - (c[1] - py) * (a[0] - px)) / area;
          const wc = 1 - wa - wb;
          if (wa < 0 || wb < 0 || wc < 0) continue;
          const m = smoothstep(0, 1, wa * a[2] + wb * b[2] + wc * c[2]);
          for (let ch = 0; ch < 4; ch++) {
            if (!d.mask[ch]) continue;
            const s = d.off[ch] + d.str[ch] * m;
            const o = (y * w + x) * 4 + ch;
            out[o] = d.blend === 'max' ? Math.max(out[o], s) : Math.min(out[o], s);
          }
        }
      }
    }
  }
  for (let i = 0; i < out.length; i++) out[i] = Math.round(Math.min(1, Math.max(0, out[i])) * 255) / 255;
  return out;
}
