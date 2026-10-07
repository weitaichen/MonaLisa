// T5 harness: per-LUT smoothness / tone stats (largest step between adjacent 64³ grid entries,
// grey-axis monotonicity, black / mid / white points). Usage: node tests/harness/t5/lut-stats.mjs
import { pathToFileURL } from 'node:url';
import { FILTER_IDS, LOOKS, buildLut } from '../../../scripts/gen-luts.mjs';

export function lutStats(lut) {
  const at = (r, g, b) => {
    const i = ((Math.floor(b / 8) * 64 + g) * 512 + (b % 8) * 64 + r) * 4;
    return [lut[i], lut[i + 1], lut[i + 2]];
  };
  let maxStep = 0;
  let where = '';
  for (let b = 0; b < 64; b++)
    for (let g = 0; g < 64; g++)
      for (let r = 0; r < 64; r++) {
        const c = at(r, g, b);
        for (const [dr, dg, db] of [
          [1, 0, 0],
          [0, 1, 0],
          [0, 0, 1],
        ]) {
          if (r + dr > 63 || g + dg > 63 || b + db > 63) continue;
          const n = at(r + dr, g + dg, b + db);
          for (let k = 0; k < 3; k++) {
            const st = Math.abs(n[k] - c[k]);
            if (st > maxStep) {
              maxStep = st;
              where = `(${r},${g},${b})+(${dr},${dg},${db}) ch${k}`;
            }
          }
        }
      }
  let greyMonotone = true;
  let prev = -1;
  for (let v = 0; v < 64; v++) {
    const c = at(v, v, v);
    const y = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    if (y < prev - 1e-9) greyMonotone = false;
    prev = y;
  }
  return { maxStep, where, greyMonotone, black: at(0, 0, 0), mid: at(32, 32, 32), white: at(63, 63, 63) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  for (const id of FILTER_IDS) {
    const s = lutStats(buildLut(LOOKS[id]));
    console.log(
      `${id.padEnd(9)} maxStep ${String(s.maxStep).padStart(3)} @ ${s.where.padEnd(24)} grey↑ ${s.greyMonotone} black ${s.black} mid ${s.mid} white ${s.white}`,
    );
  }
}
