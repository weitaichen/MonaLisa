import { describe, expect, it } from 'vitest';
import { FACE_TABLE_CARRIER } from '../config/limits';
import { faceTableCarrier, rendererOf } from './faceTableCarrier';

describe('the face table carrier per renderer (S §4.4, §6.4 2026-10-18)', () => {
  it('a GPU gets FACE_TABLE_CARRIER (the UBO: 8 faces at 2048 in 4.4–4.8 ms vs 11.8–12.3 ms on the desktop GPU)', () => {
    expect(FACE_TABLE_CARRIER).toBe('ubo');
    for (const r of [
      'ANGLE (Intel, Intel(R) UHD Graphics 770 (0x0000A780) Direct3D11 vs_5_0 ps_5_0, D3D11)',
      'Apple GPU',
      'ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)',
      'Mali-G78',
      'Adreno (TM) 740',
    ])
      expect(faceTableCarrier(r), r).toBe(FACE_TABLE_CARRIER);
  });
  it('a software rasterizer gets the texture (SwiftShader: the UBO program is 2–3.5× slower there)', () => {
    for (const r of [
      'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)',
      'Google SwiftShader',
      'llvmpipe (LLVM 15.0.7, 256 bits)',
      'ANGLE (Microsoft, Microsoft Basic Render Driver (0x0000008C) Direct3D11 vs_5_0 ps_5_0, D3D11)',
    ])
      expect(faceTableCarrier(r), r).toBe('texture');
  });
  it('an unknown renderer gets FACE_TABLE_CARRIER', () => {
    expect(faceTableCarrier(null)).toBe(FACE_TABLE_CARRIER);
    expect(faceTableCarrier('')).toBe(FACE_TABLE_CARRIER);
  });
  it('rendererOf reads the unmasked renderer when the context offers it, else RENDERER; null when neither is a string', () => {
    const fake = (ext: boolean, renderer: unknown, unmasked: unknown) =>
      ({
        RENDERER: 0x1f01,
        getExtension: (n: string) => (ext && n === 'WEBGL_debug_renderer_info' ? { UNMASKED_RENDERER_WEBGL: 0x9246 } : null),
        getParameter: (p: number) => (p === 0x9246 ? unmasked : p === 0x1f01 ? renderer : null),
      }) as unknown as WebGL2RenderingContext;
    expect(rendererOf(fake(true, 'WebKit WebGL', 'Apple GPU'))).toBe('Apple GPU');
    expect(rendererOf(fake(false, 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)', null))).toContain('SwiftShader');
    expect(rendererOf(fake(true, null, null))).toBeNull();
  });
});
