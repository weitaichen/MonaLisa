// Vendors runtime assets into public/ (idempotent; safe to run on every build).
//  - MediaPipe tasks-vision 0.10.35 SIMD wasm (copied from node_modules)
//  - face_landmarker.task (downloaded once, md5-verified)
//  - GPUPixel resource PNGs at a pinned commit, re-encoded without colour chunks
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pub = (...p) => join(root, 'public', ...p);
const ensureDir = (f) => mkdirSync(dirname(f), { recursive: true });

const MP_VERSION = '0.10.35';
const GP_COMMIT = 'ef552bf8ce2d0d41fa9b979bfb5c7cf79374ca88';
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
const MODEL_MD5_B64 = 'sOcnSQehZEQE/vZrKN1thQ==';

async function download(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

// 1. MediaPipe wasm (SIMD build only; every supported Safari has wasm SIMD).
const mpSrc = join(root, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm');
for (const f of ['vision_wasm_internal.js', 'vision_wasm_internal.wasm']) {
  const dst = pub('mediapipe', MP_VERSION, f);
  ensureDir(dst);
  copyFileSync(join(mpSrc, f), dst);
}
console.log(`mediapipe ${MP_VERSION} wasm copied`);

// 2. Face landmarker model.
const modelDst = pub('models', 'face_landmarker', 'float16-1', 'face_landmarker.task');
if (!existsSync(modelDst)) {
  ensureDir(modelDst);
  writeFileSync(modelDst, await download(MODEL_URL));
}
const md5 = createHash('md5').update(readFileSync(modelDst)).digest('base64');
if (md5 !== MODEL_MD5_B64) throw new Error(`face_landmarker.task md5 mismatch: ${md5}`);
console.log('face_landmarker.task ok');

// 3. GPUPixel PNGs (Apache-2.0). Re-encoding through pngjs drops sRGB/cHRM/iCCP/iDOT and the
//    ancillary chunks, so browsers cannot colour-manage LUT / makeup data (RB §2.1). pngjs does
//    carry a decoded gAMA through to the output (written whenever `gamma` is truthy), so it is
//    cleared explicitly. Existing outputs with anything besides IHDR/IDAT/IEND are re-encoded in
//    place (pixels unchanged), so an output written by an older version of this step heals itself.
function pngChunks(buf) {
  const out = [];
  for (let o = 8; o + 8 <= buf.length; ) {
    const len = buf.readUInt32BE(o);
    out.push(buf.toString('latin1', o + 4, o + 8));
    o += 12 + len;
  }
  return out;
}
const onlyImageChunks = (buf) => pngChunks(buf).every((c) => c === 'IHDR' || c === 'IDAT' || c === 'IEND');
function encodeClean(png) {
  png.gamma = 0;
  return PNG.sync.write(png, { colorType: 6 });
}
const GP = {
  'luts/gp/lookup_gray.png': 'src/res/lookup_gray.png',
  'luts/gp/lookup_origin.png': 'src/res/lookup_origin.png',
  'luts/gp/lookup_skin.png': 'src/res/lookup_skin.png',
  'luts/gp/lookup_light.png': 'src/res/lookup_light.png',
  'makeup/gp/lip.png': 'src/res/mouth.png',
  'makeup/gp/blush.png': 'src/res/blusher.png',
};
for (const [dst, src] of Object.entries(GP)) {
  const out = pub(...dst.split('/'));
  if (existsSync(out)) {
    const cur = readFileSync(out);
    if (!onlyImageChunks(cur)) {
      writeFileSync(out, encodeClean(PNG.sync.read(cur)));
      console.log(`public/${dst}: stripped ${pngChunks(cur).filter((c) => !['IHDR', 'IDAT', 'IEND'].includes(c)).join(', ')}`);
    }
    continue;
  }
  const png = PNG.sync.read(await download(`https://raw.githubusercontent.com/pixpark/gpupixel/${GP_COMMIT}/${src}`));
  ensureDir(out);
  writeFileSync(out, encodeClean(png));
  console.log(`gpupixel ${src} -> public/${dst} (${png.width}x${png.height})`);
}

// 4. Test fixture (GPUPixel demo face, Apache-2.0) — tests only, never shipped.
const fixture = join(root, 'tests', 'fixtures', 'sample_face.png');
if (!existsSync(fixture)) {
  ensureDir(fixture);
  writeFileSync(fixture, await download(`https://raw.githubusercontent.com/pixpark/gpupixel/${GP_COMMIT}/demo/ios/demo/sample_face.png`));
}

// 5. Licence texts.
const lic = join(root, 'LICENSES', 'GPUPixel-Apache-2.0.txt');
if (!existsSync(lic)) {
  ensureDir(lic);
  writeFileSync(lic, await download(`https://raw.githubusercontent.com/pixpark/gpupixel/${GP_COMMIT}/LICENSE`));
}
console.log('assets ready');
