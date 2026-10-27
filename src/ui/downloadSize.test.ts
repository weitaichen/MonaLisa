// The first-run download the engine overlay announces (components/EngineStatus.tsx) is what the engine download fetches
// (engine/assets.ts): the model and the full-range photo detector (served uncompressed: octet-stream), the wasm and its
// loader (brotli at best, gzip at worst). The copy's ends are those two totals rounded to whole MB of 2^20 B, the unit
// progressText shows.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { ENGINE_PATHS } from '../engine/assets';

const root = resolve(import.meta.dirname, '../..');
const pub = (p: string) => resolve(root, 'public', `.${p}`);

describe('first-run download size (C12)', () => {
  // public/mediapipe is copied from node_modules by scripts/fetch-assets.mjs (npm run dev / build)
  it.skipIf(!existsSync(pub(ENGINE_PATHS.wasmFile)))('「首次使用需下載約 A–B MB」 brackets the model, the photo detector, the wasm and its loader over the wire', () => {
    const copy = /首次使用需下載約 (\d+)–(\d+) MB/.exec(readFileSync(resolve(import.meta.dirname, 'components/EngineStatus.tsx'), 'utf8'));
    expect(copy).not.toBeNull();
    const raw = statSync(pub(ENGINE_PATHS.model)).size + statSync(pub(ENGINE_PATHS.photoDetector)).size;
    expect(statSync(pub(ENGINE_PATHS.photoDetector)).size).toBe(1_083_786);
    const packed = [ENGINE_PATHS.wasmFile, ENGINE_PATHS.wasmLoader].map((p) => readFileSync(pub(p)));
    const best = packed.reduce((s, b) => s + brotliCompressSync(b, { params: { [constants.BROTLI_PARAM_QUALITY]: 9 } }).length, 0);
    const worst = packed.reduce((s, b) => s + gzipSync(b, { level: 6 }).length, 0);
    const mib = (n: number) => n / 1048576;
    expect([Number(copy![1]), Number(copy![2])]).toEqual([Math.round(mib(raw + best)), Math.round(mib(raw + worst))]);
  });
});
