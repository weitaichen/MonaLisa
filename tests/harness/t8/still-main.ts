// T8 harness: createStillSession against the real engine + tracker on tests/fixtures/sample_face.png.
// Exposes the result on window.__t8 for tests/harness/t8/run-still.mjs.
import { createStillSession } from '../../../src/app/still';
import { ENGINE_PATHS, loadEngineAssets } from '../../../src/engine/assets';
import { createEngine } from '../../../src/engine/index';
import { applyPreset } from '../../../src/engine/params';
import { importPhoto } from '../../../src/media/importer';
import { createTracker } from '../../../src/tracking/tracker';

type Result = Record<string, unknown> & { done: boolean };
const out: Result = { done: false };
(window as unknown as { __t8: Result }).__t8 = out;

const frames = (n: number) =>
  new Promise<void>((res) => {
    const tick = () => (--n <= 0 ? res() : requestAnimationFrame(tick));
    requestAnimationFrame(tick);
  });

function meanAbsDiff(a: ImageData, b: ImageData): number {
  let s = 0;
  for (let i = 0; i < a.data.length; i += 4)
    s += Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) + Math.abs(a.data[i + 2] - b.data[i + 2]);
  return s / ((a.data.length / 4) * 3);
}

function put(id: string, img: ImageData): void {
  const c = document.getElementById(id) as HTMLCanvasElement;
  c.width = img.width;
  c.height = img.height;
  c.getContext('2d')!.putImageData(img, 0, 0);
}

async function main(): Promise<void> {
  const canvas = document.getElementById('display') as HTMLCanvasElement;
  // as left behind by the live loop (front camera): the still session must un-mirror the display
  const engine = createEngine(canvas, { mirror: true });
  await engine.ready;
  const { modelBuffer } = await loadEngineAssets();
  const tracker = await createTracker({ modelBuffer, wasmBase: ENGINE_PATHS.wasmBase, delegate: 'auto' });
  out.delegate = tracker.delegate;

  const blob = await (await fetch('/tests/fixtures/sample_face.png')).blob();
  const bitmap = await importPhoto(blob, 2048);
  // reference pixels of the source (the session owns the bitmap afterwards)
  const ref = new OffscreenCanvas(bitmap.width, bitmap.height).getContext('2d')!;
  ref.drawImage(bitmap, 0, 0);
  const src = ref.getImageData(0, 0, bitmap.width, bitmap.height);

  const t0 = performance.now();
  const session = createStillSession(engine, tracker, bitmap);
  out.createMs = performance.now() - t0;
  out.size = [session.width, session.height];
  out.face = session.face !== null;
  out.yaw = session.face?.yaw ?? null;

  const glow = applyPreset('glow');
  session.render(glow);
  session.render(glow); // coalesced
  await engine.loadFilter('warm');
  await frames(3);

  const t1 = performance.now();
  const edited = session.exportImageData(glow);
  out.exportMs = performance.now() - t1;
  const neutral = session.exportImageData(applyPreset('original'));
  out.exportSize = [edited.width, edited.height];
  out.diffNeutral = meanAbsDiff(neutral, src);
  out.diffGlow = meanAbsDiff(edited, src);
  put('export', edited);

  session.setCompare(true);
  await frames(2);
  out.compareShown = true;
  // the display keeps showing the original until released; grab it via an export-free path:
  // (the runner screenshots the page now)
  out.done = true;
  (document.getElementById('out') as HTMLElement).textContent = JSON.stringify(out, null, 1);
  await new Promise<void>((res) => window.addEventListener('t8-release', () => res(), { once: true }));
  session.setCompare(false);
  await frames(2);
  out.released = true;
  session.dispose();
  out.disposed = true;
  // rendering after dispose must be a no-op, not an error
  session.render(glow);
  await frames(2);
  out.afterDisposeOk = true;
  tracker.close();
}

main().catch((err: unknown) => {
  out.error = err instanceof Error ? `${err.message}\n${err.stack}` : String(err);
  out.done = true;
});
