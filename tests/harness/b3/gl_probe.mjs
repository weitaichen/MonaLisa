import { chromium } from '@playwright/test';
const b = await chromium.launch({ args: (process.env.GPU_ARGS ?? '').split(' ').filter(Boolean) });
const p = await b.newPage();
await p.goto('http://127.0.0.1:5403/bench.html');
console.log(await p.evaluate(() => { const gl = new OffscreenCanvas(1,1).getContext('webgl2'); const e = gl.getExtension('WEBGL_debug_renderer_info'); return [gl.getParameter(e.UNMASKED_VENDOR_WEBGL), gl.getParameter(e.UNMASKED_RENDERER_WEBGL), !!gl.getExtension('EXT_color_buffer_float')]; }));
await b.close();
