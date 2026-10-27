// The photo bundle: face_landmarker.task with its short-range face_detector.tflite swapped for the full-range one,
// assembled in the browser by a stored-zip reader / writer (faceBundle.ts). Checked against Google's own packing of the
// shipped bundle and against the pinned full-range detector.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BLENDSHAPES_ENTRY, crc32, FACE_DETECTOR_ENTRY, readStoredZip, withFaceDetector, withoutBlendshapes, writeStoredZip, type StoredEntry } from './faceBundle';

const root = resolve(import.meta.dirname, '../..');
const u8 = (b: Buffer) => new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
const SHIPPED = u8(readFileSync(resolve(root, 'public/models/face_landmarker/float16-1/face_landmarker.task')));
const FULL_RANGE_PATH = resolve(root, 'public/models/face_detector/full-range-float16-1/blaze_face_full_range.tflite');
const enc = (s: string) => new TextEncoder().encode(s);
const same = (a: Uint8Array, b: Uint8Array) => Buffer.from(a.buffer, a.byteOffset, a.byteLength).equals(Buffer.from(b.buffer, b.byteOffset, b.byteLength));

function bytes(n: number, seed: number): Uint8Array {
  const b = new Uint8Array(n);
  for (let i = 0; i < n; i++) b[i] = (i * 7 + seed) & 255;
  return b;
}

/** bytes with the TFLite file identifier 'TFL3' at offset 4, like every .tflite flatbuffer */
function tflite(n: number, seed: number): Uint8Array {
  const b = bytes(n, seed);
  b.set(enc('TFL3'), 4);
  return b;
}

function entry(name: string, data: Uint8Array): StoredEntry {
  return { name, data, crc: crc32(data), time: 0x902e, date: 0x56a3, madeBy: 0x314, external: 0x1800000 };
}

/** offsets of every local header's data, read from the raw bytes (not through readStoredZip) */
function dataOffsets(zip: Uint8Array): number[] {
  const v = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const out: number[] = [];
  for (let i = 0; i + 30 <= zip.byteLength; i++) {
    if (v.getUint32(i, true) !== 0x04034b50) continue;
    const at = i + 30 + v.getUint16(i + 26, true) + v.getUint16(i + 28, true);
    out.push(at);
    i = at + v.getUint32(i + 18, true) - 1;
  }
  return out;
}

describe('crc32', () => {
  it('gives the zip (IEEE 802.3) check values', () => {
    expect(crc32(new Uint8Array(0))).toBe(0);
    expect(crc32(enc('123456789'))).toBe(0xcbf43926);
    expect(crc32(enc('The quick brown fox jumps over the lazy dog'))).toBe(0x414fa339);
  });
});

describe('readStoredZip', () => {
  it("lists the shipped face_landmarker.task's stored entries in order, each matching its recorded CRC", () => {
    const e = readStoredZip(SHIPPED);
    expect(e.map((x) => [x.name, x.data.byteLength])).toEqual([
      ['face_detector.tflite', 229_746],
      ['face_landmarks_detector.tflite', 2_553_590],
      ['geometry_pipeline_metadata_landmarks.binarypb', 19_376],
      ['face_blendshapes.tflite', 955_312],
    ]);
    for (const x of e) expect(crc32(x.data)).toBe(x.crc);
    expect(e[0].name).toBe(FACE_DETECTOR_ENTRY);
  });

  it('rejects bytes without an end-of-central-directory record, a truncated archive and a compressed entry', () => {
    expect(() => readStoredZip(tflite(4096, 1))).toThrow(/zip/);
    expect(() => readStoredZip(SHIPPED.subarray(0, SHIPPED.byteLength - 400))).toThrow(/zip/);
    const deflated = writeStoredZip([entry('a.bin', tflite(64, 2))]);
    // central directory compression method → 8 (deflate)
    const cd = new DataView(deflated.buffer).getUint32(deflated.byteLength - 6, true);
    new DataView(deflated.buffer).setUint16(cd + 10, 8, true);
    expect(() => readStoredZip(deflated)).toThrow(/stored/);
  });
});

describe('writeStoredZip', () => {
  it('rewriting the shipped bundle unchanged reproduces it byte for byte (Google pads entries so data is 4-byte aligned)', () => {
    expect(same(writeStoredZip(readStoredZip(SHIPPED)), SHIPPED)).toBe(true);
  });

  it('round-trips entries of any name length with every data offset on a 4-byte boundary', () => {
    const entries = [entry('x', bytes(13, 1)), entry('ab.tflite', tflite(1001, 2)), entry('long_name_for_a_file.binarypb', bytes(7, 3))];
    const zip = writeStoredZip(entries);
    const back = readStoredZip(zip);
    expect(back.map((e) => e.name)).toEqual(entries.map((e) => e.name));
    back.forEach((e, i) => {
      expect(same(e.data, entries[i].data)).toBe(true);
      expect(e.crc).toBe(entries[i].crc);
    });
    const offs = dataOffsets(zip);
    expect(offs).toHaveLength(3);
    for (const o of offs) expect(o % 4).toBe(0);
  });
});

/** the entries both bundles the app runs keep (S §6.5, 2026-10-18): never face_blendshapes.tflite */
const KEPT = ['face_detector.tflite', 'face_landmarks_detector.tflite', 'geometry_pipeline_metadata_landmarks.binarypb'];

describe('withoutBlendshapes (the camera bundle)', () => {
  it('drops face_blendshapes.tflite from the shipped bundle and keeps every other entry byte for byte, in order', () => {
    const out = withoutBlendshapes(SHIPPED);
    const e = readStoredZip(out);
    expect(e.map((x) => x.name)).toEqual(KEPT);
    expect(e.some((x) => x.name === BLENDSHAPES_ENTRY)).toBe(false);
    expect(out.byteLength).toBe(2_803_159);
    const src = readStoredZip(SHIPPED);
    e.forEach((x, i) => {
      expect(same(x.data, src[i].data)).toBe(true);
      expect(x.crc).toBe(src[i].crc);
    });
    for (const o of dataOffsets(out)) expect(o % 4).toBe(0);
  });

  it('leaves a bundle without the entry as it is, and refuses what is not a stored zip', () => {
    const once = withoutBlendshapes(SHIPPED);
    expect(same(withoutBlendshapes(once), once)).toBe(true);
    expect(() => withoutBlendshapes(tflite(4096, 1))).toThrow(/zip/);
  });
});

describe('withFaceDetector', () => {
  it('replaces face_detector.tflite and drops face_blendshapes.tflite: the other entries keep their bytes, CRCs and order', () => {
    const det = tflite(5000, 9);
    const out = readStoredZip(withFaceDetector(SHIPPED, det));
    const src = readStoredZip(SHIPPED);
    expect(out.map((e) => e.name)).toEqual(KEPT);
    expect(same(out[0].data, det)).toBe(true);
    expect(out[0].crc).toBe(crc32(det));
    for (let i = 1; i < out.length; i++) {
      expect(same(out[i].data, src[i].data)).toBe(true);
      expect(out[i].crc).toBe(src[i].crc);
    }
  });

  it('gives the same photo bundle from the shipped bundle and from the camera bundle (without blendshapes)', () => {
    const det = tflite(5000, 9);
    expect(same(withFaceDetector(SHIPPED, det), withFaceDetector(withoutBlendshapes(SHIPPED), det))).toBe(true);
  });

  it('refuses a detector that is not a TFLite model and a bundle without a face detector', () => {
    expect(() => withFaceDetector(SHIPPED, enc('<!doctype html><html></html>'))).toThrow(/TFLite/);
    const noDetector = writeStoredZip(readStoredZip(SHIPPED).slice(1));
    expect(() => withFaceDetector(noDetector, tflite(100, 1))).toThrow(FACE_DETECTOR_ENTRY);
  });

  it('the shipped full-range detector (pinned blaze_face_full_range.tflite) turns the shipped bundle into the photo bundle', () => {
    expect(existsSync(FULL_RANGE_PATH)).toBe(true);
    const det = u8(readFileSync(FULL_RANGE_PATH));
    expect(det.byteLength).toBe(1_083_786);
    expect(createHash('md5').update(det).digest('base64')).toBe('XeN2/MhVJzxccgdm02UjoA==');
    const photo = withFaceDetector(SHIPPED, det);
    // 4,612,636 B with the blendshape model (0.5.0)
    expect(photo.byteLength).toBe(3_657_199);
    const e = readStoredZip(photo);
    expect(e.map((x) => x.name)).toEqual(KEPT);
    expect(same(e[0].data, det)).toBe(true);
    for (const o of dataOffsets(photo)) expect(o % 4).toBe(0);
  });
});
