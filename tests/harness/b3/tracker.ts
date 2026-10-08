// End-to-end checks of createBodyTracker with the real model (driven by tracker_e2e.mjs).
import { ENGINE_PATHS, POSE_MODELS, loadPoseModel } from '../../../src/engine/assets';
import { createBodyTracker } from '../../../src/tracking/bodyTracker';
import type { BodyDetection, BodyTracker } from '../../../src/types';

async function bitmapOf(url: string): Promise<ImageBitmap> {
  const img = new Image();
  img.src = url;
  await img.decode();
  return createImageBitmap(img);
}

function canvasOf(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  if (g) draw(g);
  return c;
}

const summary = (d: BodyDetection | null) =>
  d && {
    width: d.width,
    height: d.height,
    people: d.people,
    points: Array.from(d.pose.points),
    mask: d.mask && { width: d.mask.width, height: d.mask.height, data: Array.from(d.mask.data) },
  };

declare global {
  interface Window {
    e2e: () => Promise<unknown>;
    ready: boolean;
  }
}

window.e2e = async () => {
  const progress: number[] = [];
  const model = await loadPoseModel('full', (p) => progress.push(p.loaded));
  const t0 = performance.now();
  // the app's call (services.ts): CPU preferred, IMAGE, masks default on
  const tracker: BodyTracker = await createBodyTracker({
    modelBuffer: model,
    wasmBase: ENGINE_PATHS.wasmBase,
    variant: 'full',
    delegate: 'CPU',
    runningMode: 'IMAGE',
  });
  const createMs = performance.now() - t0;
  const body = await bitmapOf('/tests/fixtures/fullbody.jpg');
  const yoga = await bitmapOf('/tests/fixtures/fullbody_yoga.jpg');
  const base = tracker.detect(body);
  // 4x upscaled: inference input capped at 1280, coordinates still normalized, size = original
  const big = canvasOf(body.width * 4, body.height * 4, (g) => g.drawImage(body, 0, 0, body.width * 4, body.height * 4));
  const upscaled = tracker.detect(big);
  // two people (faces visible: BlazePose finds people through the face, so the masked subject is not reused;
  // recall of a second, smaller person is limited, see the report): the full yoga photo and a horizontally
  // squeezed copy of its centre to the right. The larger, more central left person must be selected.
  const pair = canvasOf(1400, 667, (g) => {
    g.drawImage(yoga, 0, 0);
    g.drawImage(yoga, 150, 0, 1000, 667, 700, 0, 700, 667);
  });
  const two = tracker.detect(pair);
  const empty = tracker.detect(
    canvasOf(800, 600, (g) => {
      g.fillStyle = '#7a8a99';
      g.fillRect(0, 0, 800, 600);
    }),
  );
  const y = tracker.detect(yoga);
  // VIDEO on the same instance, then back to IMAGE
  const vids: (BodyDetection | null)[] = [];
  for (let i = 0; i < 5; i++) vids.push(tracker.detectVideo(big as unknown as HTMLVideoElement, 1000 + i * 33));
  const back = tracker.detect(body);
  const delegate = tracker.delegate;
  tracker.close();
  return {
    poseModels: POSE_MODELS,
    progressEvents: progress.length,
    createMs,
    delegate,
    base: summary(base),
    upscaled: summary(upscaled),
    two: summary(two),
    empty: summary(empty),
    yoga: summary(y),
    video: vids.map((v) => v && { people: v.people, points: Array.from(v.pose.points), mask: !!v.mask }),
    back: summary(back),
    pairPng: pair.toDataURL('image/png'),
  };
};
window.ready = true;
