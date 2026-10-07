// T3 harness: adapter overlay vs GPUPixel template, and tracker end-to-end checks.
// Served by vite (port 5183) and driven by tests/harness/t3/run.mjs.
import { adapt } from '../../../src/tracking/adapter111';
import { createTracker } from '../../../src/tracking/tracker';
import type { Delegate, Landmarks478 } from '../../../src/types';
import fixture from '../../fixtures/landmarks_sample_face.json';
import { GPUPIXEL_TEMPLATE } from './gpupixelTemplate';

const N = 111;

function loadImage(url: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.src = url;
  return img.decode().then(() => img);
}

/** Least-squares similarity (scale+rotation+translation) mapping src → dst, complex-number form. */
function fitSimilarity(src: number[][], dst: number[][]) {
  const n = src.length;
  let msx = 0, msy = 0, mdx = 0, mdy = 0;
  for (let i = 0; i < n; i++) {
    msx += src[i][0] / n; msy += src[i][1] / n; mdx += dst[i][0] / n; mdy += dst[i][1] / n;
  }
  let re = 0, im = 0, ss = 0;
  for (let i = 0; i < n; i++) {
    const sx = src[i][0] - msx, sy = src[i][1] - msy, dx = dst[i][0] - mdx, dy = dst[i][1] - mdy;
    re += sx * dx + sy * dy; // conj(s)·d
    im += sx * dy - sy * dx;
    ss += sx * sx + sy * sy;
  }
  const a = re / ss, b = im / ss;
  return (p: number[]) => [
    a * (p[0] - msx) - b * (p[1] - msy) + mdx,
    b * (p[0] - msx) + a * (p[1] - msy) + mdy,
  ];
}

function drawPoints(
  ctx: CanvasRenderingContext2D, pts: number[][], color: string, labels: boolean, r = 3.5,
) {
  ctx.fillStyle = color;
  for (const [x, y] of pts) {
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  if (!labels) return;
  ctx.font = 'bold 11px sans-serif';
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(0,0,0,0.85)';
  ctx.fillStyle = '#fff';
  pts.forEach(([x, y], i) => {
    ctx.strokeText(String(i), x + 4, y - 4);
    ctx.fillText(String(i), x + 4, y - 4);
  });
}

function polyline(ctx: CanvasRenderingContext2D, pts: number[][], color: string, closed: boolean, w = 1.5) {
  ctx.strokeStyle = color; ctx.lineWidth = w;
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  if (closed) ctx.closePath();
  ctx.stroke();
}

/** Renders adapted points (left panel) and the similarity-aligned GPUPixel template (right panel). */
async function renderOverlay(crop: [number, number, number, number], scale: number) {
  const img = await loadImage('/tests/fixtures/sample_face.png');
  const W = fixture.width, H = fixture.height;
  const face = adapt({ points: new Float32Array(fixture.points) }, W, H);
  const px = (a: Float32Array) => Array.from({ length: a.length / 2 }, (_, i) => [a[i * 2] * W, a[i * 2 + 1] * H]);
  const pts = px(face.pts111), ext = px(face.ext), oval = px(face.oval);
  const tmpl = Array.from({ length: N }, (_, i) => [GPUPIXEL_TEMPLATE[i * 2], GPUPIXEL_TEMPLATE[i * 2 + 1]]);
  const fit = fitSimilarity(tmpl, pts);
  const tPts = tmpl.map(fit);
  const iod = Math.hypot(pts[74][0] - pts[77][0], pts[74][1] - pts[77][1]);
  const resid = pts.map((p, i) => Math.hypot(p[0] - tPts[i][0], p[1] - tPts[i][1]) / iod);

  const [cx, cy, cw, ch] = crop;
  const panelW = Math.round(cw * scale), panelH = Math.round(ch * scale);
  const canvas = document.createElement('canvas');
  canvas.width = panelW * 2 + 10; canvas.height = panelH;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#222'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (let panel = 0; panel < 2; panel++) {
    ctx.save();
    ctx.translate(panel * (panelW + 10), 0);
    ctx.beginPath(); ctx.rect(0, 0, panelW, panelH); ctx.clip();
    ctx.globalAlpha = 0.55;
    ctx.drawImage(img, cx, cy, cw, ch, 0, 0, panelW, panelH);
    ctx.globalAlpha = 1;
    const T = (p: number[]) => [(p[0] - cx) * scale, (p[1] - cy) * scale];
    if (panel === 0) {
      polyline(ctx, oval.map(T), '#00e5ff', true);
      polyline(ctx, pts.slice(0, 33).map(T), '#ffd400', false, 1);
      drawPoints(ctx, pts.map(T), '#7CFC00', true);
      drawPoints(ctx, ext.map(T), '#ff00ff', false, 5);
      ctx.fillStyle = '#ff00ff'; ctx.font = 'bold 12px sans-serif';
      ext.map(T).forEach(([x, y], i) => ctx.fillText('e' + i, x - 22, y + 4));
    } else {
      // residual vectors template → adapted
      ctx.strokeStyle = '#ff5050'; ctx.lineWidth = 1.5;
      pts.forEach((p, i) => {
        const a = T(tPts[i]), b = T(p);
        ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
      });
      polyline(ctx, tPts.slice(0, 33).map(T), '#ffd400', false, 1);
      drawPoints(ctx, tPts.map(T), '#ffa500', true);
    }
    ctx.font = 'bold 16px sans-serif'; ctx.fillStyle = '#fff';
    ctx.fillText(panel === 0 ? 'adapted 111 (lime) + ext (magenta) + FACE_OVAL (cyan)' : 'GPUPixel template, similarity-fit (orange); red = residual', 8, 20);
    ctx.restore();
  }
  const order = resid.map((r, i) => [i, r] as const).sort((a, b) => b[1] - a[1]);
  return {
    png: canvas.toDataURL('image/png'),
    yaw: face.yaw,
    iodPx: iod,
    meanResidIod: resid.reduce((s, r) => s + r, 0) / N,
    maxResid: order.slice(0, 10).map(([i, r]) => `${i}:${r.toFixed(3)}`),
  };
}

function summarize(l: Landmarks478 | null) {
  if (!l) return null;
  let maxDiff = 0;
  for (let i = 0; i < l.points.length; i++) maxDiff = Math.max(maxDiff, Math.abs(l.points[i] - fixture.points[i]));
  return { n: l.points.length / 3, maxDiffVsFixture: maxDiff, nan: l.points.some((v) => Number.isNaN(v)) };
}

async function modelBuffer() {
  const r = await fetch('/models/face_landmarker/float16-1/face_landmarker.task');
  return new Uint8Array(await r.arrayBuffer());
}

/** createTracker with the real model + self-hosted wasm, then detectImage on the sample face. */
async function runTracker(delegate: 'auto' | Delegate) {
  const t0 = performance.now();
  const tracker = await createTracker({ modelBuffer: await modelBuffer(), wasmBase: '/mediapipe/0.10.35', delegate });
  const createMs = performance.now() - t0;
  const img = await loadImage('/tests/fixtures/sample_face.png');
  const bmp = await createImageBitmap(img);
  const t1 = performance.now();
  const a = summarize(tracker.detectImage(img));
  const imageMs = performance.now() - t1;
  const b = summarize(tracker.detectImage(bmp));
  const blank = document.createElement('canvas');
  blank.width = 320; blank.height = 240;
  blank.getContext('2d')!.fillRect(0, 0, 320, 240);
  const none = tracker.detectImage(blank);
  tracker.close();
  const afterClose = tracker.detectImage(img);
  return { delegate: tracker.delegate, createMs, imageMs, img: a, bitmap: b, blankIsNull: none === null, afterCloseIsNull: afterClose === null };
}

/** detectVideo on a <video> fed by Chromium's fake camera, interleaved with detectImage. */
async function runVideo(delegate: 'auto' | Delegate, frames: number) {
  const tracker = await createTracker({ modelBuffer: await modelBuffer(), wasmBase: '/mediapipe/0.10.35', delegate });
  const video = document.createElement('video');
  video.muted = true; video.playsInline = true;
  const notReady = tracker.detectVideo(video, 1); // readyState 0 → must be null, no throw
  video.srcObject = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 }, audio: false });
  await video.play();
  await new Promise((r) => setTimeout(r, 300));
  let hits = 0, nulls = 0, ms = 0;
  const firstPts: number[] = [];
  for (let i = 0; i < frames; i++) {
    await new Promise((r) => requestAnimationFrame(r));
    const t = performance.now();
    // deliberately repeat a timestamp every 5th frame: the tracker must bump it, not throw
    const l = tracker.detectVideo(video, i % 5 === 4 ? 1000 : 1000 + i * 33);
    ms += performance.now() - t;
    if (l) {
      hits++;
      if (!firstPts.length) firstPts.push(l.points[1 * 3], l.points[1 * 3 + 1]);
    } else nulls++;
    if (i === Math.floor(frames / 2)) {
      const img = await loadImage('/tests/fixtures/sample_face.png');
      const r = summarize(tracker.detectImage(img));
      if (!r || r.maxDiffVsFixture > 0.02) throw new Error('detectImage mid-video failed: ' + JSON.stringify(r));
    }
  }
  // snapshot: last frame with the adapted 111 points, to eyeball video landmarks
  const snap = document.createElement('canvas');
  snap.width = video.videoWidth; snap.height = video.videoHeight;
  const sctx = snap.getContext('2d')!;
  const last = tracker.detectVideo(video, 1e6);
  sctx.drawImage(video, 0, 0);
  if (last) {
    const f = adapt(last, snap.width, snap.height);
    const P = (a: Float32Array) => Array.from({ length: a.length / 2 }, (_, i) => [a[i * 2] * snap.width, a[i * 2 + 1] * snap.height]);
    polyline(sctx, P(f.oval), '#00e5ff', true);
    drawPoints(sctx, P(f.pts111), '#7CFC00', false, 2.5);
    drawPoints(sctx, P(f.ext), '#ff00ff', false, 3.5);
  }
  // same frame through IMAGE mode on a canvas copy: video landmarks must agree with it
  const still = document.createElement('canvas');
  still.width = video.videoWidth; still.height = video.videoHeight;
  still.getContext('2d')!.drawImage(video, 0, 0);
  const ref = tracker.detectImage(still);
  let videoVsImageMaxDiff = -1;
  if (last && ref) {
    videoVsImageMaxDiff = 0;
    for (let i = 0; i < 478; i++) {
      videoVsImageMaxDiff = Math.max(videoVsImageMaxDiff,
        Math.abs(last.points[i * 3] - ref.points[i * 3]), Math.abs(last.points[i * 3 + 1] - ref.points[i * 3 + 1]));
    }
  }
  const s = video.srcObject as MediaStream;
  s.getTracks().forEach((t) => t.stop());
  tracker.close();
  return { delegate: tracker.delegate, notReadyIsNull: notReady === null, videoW: video.videoWidth, videoH: video.videoHeight, hits, nulls, avgMs: ms / frames, noseTip: firstPts, videoVsImageMaxDiff, png: snap.toDataURL('image/png') };
}

/**
 * Lose the tracker's own WebGL context (WEBGL_lose_context on the canvas MediaPipe draws into)
 * and wait for the tracker to replace its instance and detect the sample face again.
 */
async function runContextLoss(delegate: 'auto' | Delegate) {
  // capture every WebGL context created on an OffscreenCanvas from here on (MediaPipe's included)
  const ctxs: WebGL2RenderingContext[] = [];
  const proto = OffscreenCanvas.prototype as unknown as { getContext: (...a: unknown[]) => unknown };
  const orig = proto.getContext;
  proto.getContext = function (this: OffscreenCanvas, ...a: unknown[]) {
    const c = orig.apply(this, a);
    const gl = c as WebGL2RenderingContext | null;
    if (gl && typeof a[0] === 'string' && a[0].startsWith('webgl') && !ctxs.includes(gl)) ctxs.push(gl);
    return c;
  };
  const states: string[] = [];
  try {
    const tracker = await createTracker({
      modelBuffer: await modelBuffer(),
      wasmBase: '/mediapipe/0.10.35',
      delegate,
      onStateChange: (s) => states.push(s),
    });
    const img = await loadImage('/tests/fixtures/sample_face.png');
    const before = summarize(tracker.detectImage(img));
    const delegateBefore = tracker.delegate;
    const lost = ctxs.filter((c) => !c.isContextLost());
    for (const c of lost) c.getExtension('WEBGL_lose_context')?.loseContext();
    await new Promise((r) => setTimeout(r, 50));
    const rightAfterHasFace = tracker.detectImage(img) !== null;
    const t0 = performance.now();
    let after: ReturnType<typeof summarize> = null;
    let detectErrors = 0;
    while (!after && performance.now() - t0 < 10000) {
      await new Promise((r) => setTimeout(r, 100));
      try {
        after = summarize(tracker.detectImage(img));
      } catch {
        detectErrors++;
      }
    }
    const recoveredMs = after ? performance.now() - t0 : -1;
    tracker.close();
    return { delegateBefore, delegateAfter: tracker.delegate, contextsLost: lost.length, before, rightAfterHasFace, after, recoveredMs, detectErrors, states };
  } finally {
    proto.getContext = orig;
  }
}

Object.assign(window, { renderOverlay, runTracker, runVideo, runContextLoss, harnessReady: true });
