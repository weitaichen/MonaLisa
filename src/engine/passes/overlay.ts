// Debug overlay: draws the 111 adapted points (lime) + ext anchors (magenta) as round GL_POINTS
// onto the canvas, with the same flip-Y / mirror-X as the present pass; step 5: the eye frames (cyan).
import type { Face } from '../../types';
import { createProgram } from '../gl/gl';
import type { GL, Program } from '../gl/gl';
import { browGapEnd, eyeFrames, eyeToUv, LID_STATIONS, STATION_XS } from './eyeFrame';

export interface LandmarkOverlay {
  /** Draw onto the currently bound canvas framebuffer using the SAME flipY/mirrorX as the present pass. */
  draw(face: Face, mirrorX: boolean, aspect?: number): void;
  dispose(): void;
}

const POINT_SIZE = 4;

/** per eye: 17 upper + 17 lower lid stations, the brow end of each upper station's gap, 24 iris-circle points */
const EYE_POINTS = 2 * (LID_STATIONS * 3 + 24);

/** UV points of the eye frames for the 顯示臉部特徵點 overlay (face-detail spec §3.6) */
export function eyeDebugPoints(face: Face, aspect: number): Float32Array {
  const out = new Float32Array(EYE_POINTS * 2);
  let n = 0;
  const put = (p: readonly [number, number]) => {
    out[n++] = p[0];
    out[n++] = p[1];
  };
  for (const f of eyeFrames(face, aspect)) {
    STATION_XS.forEach((x, k) => {
      put(eyeToUv(f, x, f.upper[k], aspect));
      put(eyeToUv(f, x, f.lower[k], aspect));
      const e = browGapEnd(f, x, f.upper[k]);
      put(eyeToUv(f, e[0], e[1], aspect));
    });
    const iris = f.iris ?? f.irisFallback;
    for (let j = 0; j < 24; j++) {
      const t = (j / 24) * 2 * Math.PI;
      put([iris.c[0] + iris.r * Math.cos(t), (iris.c[1] + iris.r * Math.sin(t)) * aspect]);
    }
  }
  return out;
}

const OVERLAY_VS = /* glsl */ `#version 300 es
in vec2 aPos;          // UV, top-left origin
uniform float uMirror; // 1 = mirror X
uniform float uSize;
void main() {
  float x = mix(aPos.x, 1.0 - aPos.x, uMirror);
  // Canvas: NDC +1 is the top row, so image top (v=0) maps to +1 (the present flip).
  gl_Position = vec4(x * 2.0 - 1.0, 1.0 - aPos.y * 2.0, 0.0, 1.0);
  gl_PointSize = uSize;
}`;

const OVERLAY_FS = /* glsl */ `#version 300 es
precision highp float;
uniform vec3 uColor;
out vec4 outColor;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  if (dot(d, d) > 0.25) discard;
  outColor = vec4(uColor, 1.0);
}`;

export function createLandmarkOverlay(gl: GL): LandmarkOverlay {
  const prog: Program = createProgram(gl, OVERLAY_VS, OVERLAY_FS, 'overlay');
  const vao = gl.createVertexArray();
  const buf = gl.createBuffer();
  const pts = new Float32Array(Math.max(222 + 16, EYE_POINTS * 2));
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, pts.byteLength, gl.DYNAMIC_DRAW);
  const aPos = gl.getAttribLocation(prog.program, 'aPos');
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);
  gl.bindBuffer(gl.ARRAY_BUFFER, null);

  return {
    draw(face, mirrorX, aspect = 1) {
      const n111 = Math.min(111, face.pts111.length >> 1);
      const nExt = Math.min(8, face.ext.length >> 1);
      pts.set(face.pts111.subarray(0, n111 * 2), 0);
      pts.set(face.ext.subarray(0, nExt * 2), n111 * 2);
      prog.use();
      gl.uniform1f(prog.u('uMirror'), mirrorX ? 1 : 0);
      gl.uniform1f(prog.u('uSize'), POINT_SIZE);
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, pts, 0, (n111 + nExt) * 2);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
      gl.disable(gl.BLEND);
      gl.uniform3f(prog.u('uColor'), 0.722, 0.941, 0.165); // #B8F02A
      gl.drawArrays(gl.POINTS, 0, n111);
      gl.uniform3f(prog.u('uColor'), 1, 0.2, 0.85);
      gl.drawArrays(gl.POINTS, n111, nExt);
      const eyes = eyeDebugPoints(face, aspect);
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, eyes);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
      gl.uniform3f(prog.u('uColor'), 0.2, 0.9, 1);
      gl.drawArrays(gl.POINTS, 0, eyes.length / 2);
      gl.bindVertexArray(null);
    },
    dispose() {
      prog.dispose();
      gl.deleteVertexArray(vao);
      gl.deleteBuffer(buf);
    },
  };
}
