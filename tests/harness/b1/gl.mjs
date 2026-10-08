// GL parity: upload the body field as RG16F (FLOAT data, LINEAR, CLAMP — B2's contract), sample
// src(uv + field(uv)) in a WebGL2 fragment shader in headless Chromium and compare with the CPU sampler.
import { writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import { PNG } from 'pngjs';

const server = await createServer({
  root: new URL('../../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'),
  configFile: false, logLevel: 'silent', server: { middlewareMode: true, hmr: false }, appType: 'custom', optimizeDeps: { noDiscovery: true, include: [] },
});
const c = (await server.ssrLoadModule('/tests/harness/b1/render.ts')).glCase();
await server.close();
if (!c) throw new Error('run decode.mjs first and make sure tests/fixtures/pose_fullbody.json exists');

const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage();
const logs = [];
page.on('console', (m) => logs.push(m.text()));
const res = await page.evaluate((c) => {
  const cv = document.createElement('canvas');
  cv.width = c.w;
  cv.height = c.h;
  const gl = cv.getContext('webgl2');
  const vs = `#version 300 es
  out vec2 vUv; void main(){ vec2 p = vec2(float((gl_VertexID<<1)&2), float(gl_VertexID&2)); vUv = p; gl_Position = vec4(p*2.0-1.0,0.0,1.0); }`;
  const fs = `#version 300 es
  precision highp float; in vec2 vUv; uniform sampler2D uSrc; uniform sampler2D uBody; out vec4 o;
  void main(){ vec2 tc = vUv + texture(uBody, vUv).xy; o = texture(uSrc, tc); }`;
  const sh = (t, s) => { const x = gl.createShader(t); gl.shaderSource(x, s); gl.compileShader(x); if (!gl.getShaderParameter(x, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(x)); return x; };
  const pr = gl.createProgram();
  gl.attachShader(pr, sh(gl.VERTEX_SHADER, vs));
  gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(pr);
  gl.useProgram(pr);
  const tex = (unit) => { const t = gl.createTexture(); gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v); return t; };
  tex(0);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, c.w, c.h, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(c.rgba));
  tex(1);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG16F, c.field.width, c.field.height, 0, gl.RG, gl.FLOAT, new Float32Array(c.field.data));
  gl.uniform1i(gl.getUniformLocation(pr, 'uSrc'), 0);
  gl.uniform1i(gl.getUniformLocation(pr, 'uBody'), 1);
  const fbo = gl.createFramebuffer();
  const out = gl.createTexture();
  gl.activeTexture(gl.TEXTURE2);
  gl.bindTexture(gl.TEXTURE_2D, out);
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, c.w, c.h);
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, out, 0);
  gl.viewport(0, 0, c.w, c.h);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  const px = new Uint8Array(c.w * c.h * 4);
  gl.readPixels(0, 0, c.w, c.h, gl.RGBA, gl.UNSIGNED_BYTE, px); // FBO row 0 = image top (gl.ts convention)
  let maxd = 0, sum = 0, over4 = 0;
  for (let i = 0; i < px.length; i++) { if (i % 4 === 3) continue; const d = Math.abs(px[i] - c.cpu[i]); maxd = Math.max(maxd, d); sum += d; if (d > 4) over4++; }
  return { glError: gl.getError(), maxd, mean: sum / (c.w * c.h * 3), over4, px: Array.from(px) };
}, c);
await browser.close();
const png = new PNG({ width: c.w, height: c.h });
png.data.set(res.px);
writeFileSync(new URL('./out/gl_fullbody_all_max.png', import.meta.url), PNG.sync.write(png));
console.log(JSON.stringify({ glError: res.glError, maxAbsDiff: res.maxd, meanAbsDiff: +res.mean.toFixed(4), channelsOver4: res.over4, logs }));
