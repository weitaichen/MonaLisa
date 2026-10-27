// ReshapePass.carrier (S §4.4, §6.4): the carrier the pass reports is the one its program was compiled with, which is
// what window.__meiyan.gl.FACE_TABLE_UBO shows (engine/index.ts noteCarrier, through Pipeline.faceTableCarrier).
import { describe, expect, it, vi } from 'vitest';
import { createProgram } from '../gl/gl';
import { createReshapePass } from './reshape';

vi.mock('../gl/gl', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../gl/gl')>()),
  createProgram: vi.fn(() => ({ program: {}, use: vi.fn(), u: vi.fn(() => ({})), a: vi.fn(), dispose: vi.fn() })),
  createTexture: vi.fn(() => ({ tex: {}, width: 1, height: 1 })),
  createTextureArray: vi.fn(() => ({ tex: {}, width: 1, height: 1, layers: 1 })),
}));

/** the GL calls createReshapePass makes besides the faked gl.ts helpers */
const fakeGl = () =>
  ({
    uniform1i: vi.fn(),
    uniformBlockBinding: vi.fn(),
    getUniformBlockIndex: vi.fn(() => 0),
    createBuffer: vi.fn(() => ({})),
    bindBuffer: vi.fn(),
    bufferData: vi.fn(),
  }) as unknown as WebGL2RenderingContext;

describe('createReshapePass: carrier', () => {
  it.each(['texture', 'ubo'] as const)('%s: reports the carrier its RESHAPE_FS was compiled with', (carrier) => {
    vi.mocked(createProgram).mockClear();
    const pass = createReshapePass(fakeGl(), { carrier });
    expect(pass.carrier).toBe(carrier);
    const fs = vi.mocked(createProgram).mock.calls[0][2];
    expect(fs.includes('#define FACE_TABLE_UBO')).toBe(carrier === 'ubo');
  });

  it('defaults to the texture carrier (the harnesses and pins that pass no carrier)', () => {
    expect(createReshapePass(fakeGl()).carrier).toBe('texture');
  });
});
