// Tile-equivalence harness (S §8.2): one synthetic frame with sample_face.png composited, rendered once as a single tile
// covering V and once with the planner's TILE = 256 tiles, at three geometries; the PNG-free comparison happens here.
// Steps 4, 5 and 6 add their cases to `CASES` (spots and tone, every makeup part, strokes).
import landmarks from '../../fixtures/landmarks_sample_face.json';
import { defaultPhoto, neutralPerson } from '../../../src/edit/state';
import { createEngine } from '../../../src/engine/index';
import { IDENTITY_GEOMETRY, setStraighten, snapCrop, viewSize } from '../../../src/geometry/view';
import { faceBoundsFor, planTiles, type TileGrid } from '../../../src/media/exportPlan';
import { adapt } from '../../../src/tracking/adapter111';
import type { BodyField, Geometry, PersonParams, PhotoParams, RenderFace, RenderInput } from '../../../src/types';

export interface TileCheck {
  name: string;
  w: number;
  h: number;
  tiles: number;
  /** max |tiled − untiled| over every channel, 0..255 */
  maxDiff: number;
  glError: number;
}

declare global {
  interface Window {
    runExportTiles?: () => Promise<TileCheck[]>;
  }
}

/** the frame: a gradient with sample_face.png scaled to its height, centred */
async function makeFrame(w: number, h: number, face: ImageBitmap): Promise<{ bitmap: ImageBitmap; place: { x: number; s: number } }> {
  const c = new OffscreenCanvas(w, h);
  const ctx = c.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, '#c9a48a');
  g.addColorStop(1, '#3d5770');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  const s = h / face.height;
  const x = (w - face.width * s) / 2;
  ctx.drawImage(face, x, 0, face.width * s, h);
  return { bitmap: await createImageBitmap(c), place: { x, s } };
}

function bodyField(): BodyField {
  const bw = 24;
  const bh = 18;
  const data = new Float32Array(bw * bh * 2);
  for (let y = 0; y < bh; y++)
    for (let x = 0; x < bw; x++) {
      data[(y * bw + x) * 2] = 0.01 * Math.sin((x / bw) * 6) * Math.cos((y / bh) * 4);
      data[(y * bw + x) * 2 + 1] = 0.008 * Math.cos((x / bw) * 5);
    }
  return { width: bw, height: bh, data, version: 1 };
}

window.runExportTiles = async () => {
  const canvas = document.getElementById('gl') as HTMLCanvasElement;
  const engine = createEngine(canvas, { mirror: false });
  await engine.ready;
  await engine.loadLut('look', 'film');
  const gl = canvas.getContext('webgl2') as WebGL2RenderingContext;
  const sample = await createImageBitmap(await (await fetch('/tests/fixtures/sample_face.png')).blob());
  const person: PersonParams = {
    ...neutralPerson(),
    values: { ...neutralPerson().values, 'shape.eyeEnlarge': 1, 'shape.faceSlim': 1, 'skin.smooth': 0.8, 'makeup.lip': 0.8 },
  };
  const out: TileCheck[] = [];
  const cases: { name: string; w: number; h: number; geometry: (size: { width: number; height: number }) => Geometry }[] = [
    { name: 'identity', w: 800, h: 600, geometry: () => IDENTITY_GEOMETRY },
    { name: 'quarter 1 + flip', w: 800, h: 600, geometry: () => ({ ...IDENTITY_GEOMETRY, flipH: true, quarter: 1 }) },
    { name: 'θ 12° + crop', w: 800, h: 600, geometry: (size) => setStraighten(IDENTITY_GEOMETRY, 12, size) },
    { name: '601×799 identity', w: 601, h: 799, geometry: () => IDENTITY_GEOMETRY },
  ];
  for (const c of cases) {
    const decode = { width: c.w, height: c.h };
    const { bitmap, place } = await makeFrame(c.w, c.h, sample);
    // the fixture's landmarks, moved into the frame (z in width units)
    const pts = new Float32Array(landmarks.points.length);
    for (let i = 0; i < pts.length; i += 3) {
      pts[i] = (place.x + landmarks.points[i] * landmarks.width * place.s) / c.w;
      pts[i + 1] = landmarks.points[i + 1];
      pts[i + 2] = (landmarks.points[i + 2] * landmarks.width * place.s) / c.w;
    }
    const face = adapt({ points: pts }, c.w, c.h);
    const faces: RenderFace[] = [{ face, weight: 1, person, protect: null }];
    const g = snapCrop(c.geometry(decode), decode);
    // 銳化 and 美白 at 0 (S §8.2 lists neither): a warped P2 resample differs from the untiled one by fp32 coordinate
    // rounding (≤ 1/255 in B at scattered interior pixels, not at tile edges), and 自然's sharpen gain and the whiten
    // curve's shadow slope each lift such a 1-LSB flip to 2/255 (measured on SwiftShader). The 自然 filter stays on.
    const photo: PhotoParams = {
      ...defaultPhoto(),
      values: { ...defaultPhoto().values, 'skin.sharpen': 0, 'skin.whiten': 0, 'adjust.grain': 0.5, 'adjust.vignette': 0.5 },
      look: { id: 'film', amount: 0.8 },
      geometry: g,
    };
    const V = viewSize(g, decode);
    const fullShortEdge = Math.min(c.w, c.h);
    const oAspect = c.w / c.h;
    const base: Omit<RenderInput, 'source' | 'width' | 'height'> = { faces, obstacles: [], globalSkin: null, photo, body: bodyField(), geometry: g, oAspect };
    const grid: TileGrid = { V, decode, geometry: g, oAspect, fullShortEdge };
    const bounds = { body: base.body ?? null, faces: faceBoundsFor(faces, oAspect) };
    const render = async (T: number): Promise<{ data: Uint8ClampedArray; tiles: number }> => {
      const tiles = planTiles(grid, bounds, T);
      const data = new Uint8ClampedArray(V.width * V.height * 4);
      for (const t of tiles) {
        const bmp = await createImageBitmap(bitmap, t.win.x, t.win.y, t.win.w, t.win.h);
        const img = engine.renderTile(
          {
            ...base,
            source: bmp,
            width: t.win.w,
            height: t.win.h,
            sourceWindow: { x: t.win.x / c.w, y: t.win.y / c.h, w: t.win.w / c.w, h: t.win.h / c.h },
            output: { tile: { x: t.buf.x / V.width, y: t.buf.y / V.height, w: t.buf.w / V.width, h: t.buf.h / V.height }, pixelSize: { width: t.buf.w, height: t.buf.h }, fullShortEdge },
          },
          { x: t.out.x - t.buf.x, y: t.out.y - t.buf.y, w: t.out.w, h: t.out.h },
        );
        bmp.close();
        for (let y = 0; y < t.out.h; y++) data.set(img.data.subarray(y * t.out.w * 4, (y + 1) * t.out.w * 4), ((t.out.y + y) * V.width + t.out.x) * 4);
      }
      return { data, tiles: tiles.length };
    };
    const whole = await render(8192);
    const tiled = await render(256);
    let maxDiff = 0;
    for (let i = 0; i < whole.data.length; i++) if ((i & 3) !== 3) maxDiff = Math.max(maxDiff, Math.abs(whole.data[i] - tiled.data[i]));
    out.push({ name: c.name, w: V.width, h: V.height, tiles: tiled.tiles, maxDiff, glError: gl.getError() });
    bitmap.close();
  }
  sample.close();
  engine.dispose();
  return out;
};
