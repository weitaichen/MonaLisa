// The photo detection model: face_landmarker.task with its face detector swapped (step-1 spec §6.5, 2026-10-17).
//
// The shipped bundle's face_detector.tflite is BlazeFace short-range (128×128 input), which finds a face only once it is
// about 10–15 % of the photo's edge: a group photo's small faces never reach the landmark step. MediaPipe's full-range
// detector (blaze_face_full_range.tflite, 192×192) finds them, and FaceLandmarker accepts it in place of the short-range
// file. The photo bundle is assembled here, in the browser, from the shipped bundle and the 1.1 MB detector, instead of
// shipping a second 4.6 MB bundle: a .task is a zip of stored (uncompressed) entries that MediaPipe reads straight out of
// the buffer, so the swap is a copy plus one CRC-32. Every other entry stays byte-identical.
//
// The writer pads in front of each local header so every entry's data starts on a 4-byte boundary (flatbuffers want
// aligned buffers), which is how Google packs face_landmarker.task: rewriting it unchanged reproduces it byte for byte.
//
// Both bundles the app runs leave out face_blendshapes.tflite (S §6.5, 2026-10-18): the camera's (withoutBlendshapes,
// 2,803,159 B) and the photo bundle (withFaceDetector, 3,657,199 B).

/** the entry FaceLandmarker reads its face detector from */
export const FACE_DETECTOR_ENTRY = 'face_detector.tflite';
/**
 * the entry FaceLandmarker reads its blendshape model from (955,312 B). The tracker never turns outputFaceBlendshapes on,
 * and FaceLandmarker loads the model only when the bundle has it: the landmarks are bit-identical without it (desktop
 * D3D11, SwiftShader and CPU, VIDEO and IMAGE). Every graph rebuild copies the whole bundle into the wasm heap, so the
 * entry cost one growth step of its high-water mark.
 */
export const BLENDSHAPES_ENTRY = 'face_blendshapes.tflite';

export interface StoredEntry {
  name: string;
  data: Uint8Array;
  /** CRC-32 of `data` */
  crc: number;
  /** MS-DOS modification time and date */
  time: number;
  date: number;
  /** central-directory "version made by" and external attributes, kept so a rewrite matches its source */
  madeBy: number;
  external: number;
}

const LOCAL = 0x04034b50;
const CENTRAL = 0x02014b50;
const END = 0x06054b50;
const LOCAL_SIZE = 30;
const CENTRAL_SIZE = 46;
const END_SIZE = 22;
/** "version needed to extract" for stored entries without zip64, as Google writes it */
const VERSION = 20;
const ALIGN = 4;

let table: Uint32Array | null = null;

/** CRC-32 as zip uses it (IEEE 802.3, reflected, polynomial 0xEDB88320) */
export function crc32(data: Uint8Array): number {
  if (!table) {
    table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = table[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function bad(why: string): Error {
  return new Error(`not a stored zip bundle: ${why}`);
}

/** The end-of-central-directory record: the last signature whose comment ends exactly at the end of the buffer. */
function findEnd(v: DataView): number {
  const n = v.byteLength;
  for (let i = n - END_SIZE; i >= Math.max(0, n - END_SIZE - 0xffff); i--) {
    if (v.getUint32(i, true) === END && i + END_SIZE + v.getUint16(i + 20, true) === n) return i;
  }
  throw bad('no end-of-central-directory record (truncated, or not a zip)');
}

/**
 * Entries of a zip whose entries are all stored (method 0), in central-directory order. `data` views into `zip` (no copy).
 * Throws on anything else: compression, encryption, zip64, multiple disks, or offsets outside the buffer.
 */
export function readStoredZip(zip: Uint8Array): StoredEntry[] {
  const v = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const end = findEnd(v);
  const count = v.getUint16(end + 10, true);
  if (v.getUint16(end + 4, true) !== 0 || v.getUint16(end + 6, true) !== 0 || v.getUint16(end + 8, true) !== count) {
    throw bad('multi-disk archive');
  }
  let p = v.getUint32(end + 16, true);
  if (p + v.getUint32(end + 12, true) > end) throw bad('central directory outside the archive');
  const names = new TextDecoder();
  const out: StoredEntry[] = [];
  for (let k = 0; k < count; k++) {
    if (p + CENTRAL_SIZE > end || v.getUint32(p, true) !== CENTRAL) throw bad(`central directory entry ${k}`);
    const flags = v.getUint16(p + 8, true);
    const method = v.getUint16(p + 10, true);
    const size = v.getUint32(p + 20, true);
    const nameLen = v.getUint16(p + 28, true);
    const name = names.decode(zip.subarray(p + CENTRAL_SIZE, p + CENTRAL_SIZE + nameLen));
    if (method !== 0 || flags & 1 || v.getUint32(p + 24, true) !== size) throw bad(`${name} is not stored uncompressed`);
    if (size === 0xffffffff) throw bad(`${name} needs zip64`);
    const local = v.getUint32(p + 42, true);
    if (local + LOCAL_SIZE > end || v.getUint32(local, true) !== LOCAL) throw bad(`${name} has no local header`);
    const at = local + LOCAL_SIZE + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
    if (at + size > end) throw bad(`${name} runs past the archive`);
    out.push({
      name,
      data: zip.subarray(at, at + size),
      crc: v.getUint32(p + 16, true),
      time: v.getUint16(p + 12, true),
      date: v.getUint16(p + 14, true),
      madeBy: v.getUint16(p + 4, true),
      external: v.getUint32(p + 38, true),
    });
    p += CENTRAL_SIZE + nameLen + v.getUint16(p + 30, true) + v.getUint16(p + 32, true);
  }
  return out;
}

/** A zip of stored entries in the given order, zero padding in front of each local header so its data is 4-byte aligned. */
export function writeStoredZip(entries: readonly StoredEntry[]): Uint8Array {
  const names = entries.map((e) => new TextEncoder().encode(e.name));
  const locals: number[] = [];
  let size = 0;
  entries.forEach((e, i) => {
    size += (ALIGN - ((size + LOCAL_SIZE + names[i].length) % ALIGN)) % ALIGN;
    locals.push(size);
    size += LOCAL_SIZE + names[i].length + e.data.byteLength;
  });
  const cd = size;
  for (const n of names) size += CENTRAL_SIZE + n.length;
  const cdSize = size - cd;
  size += END_SIZE;

  const out = new Uint8Array(size);
  const v = new DataView(out.buffer);
  /** the fields local and central headers share, from "version needed" to the name length */
  const common = (at: number, e: StoredEntry, nameLen: number) => {
    v.setUint16(at, VERSION, true);
    v.setUint16(at + 2, 0, true); // flags
    v.setUint16(at + 4, 0, true); // stored
    v.setUint16(at + 6, e.time, true);
    v.setUint16(at + 8, e.date, true);
    v.setUint32(at + 10, e.crc, true);
    v.setUint32(at + 14, e.data.byteLength, true);
    v.setUint32(at + 18, e.data.byteLength, true);
    v.setUint16(at + 22, nameLen, true);
  };
  let p = cd;
  entries.forEach((e, i) => {
    const n = names[i];
    const l = locals[i];
    v.setUint32(l, LOCAL, true);
    common(l + 4, e, n.length);
    out.set(n, l + LOCAL_SIZE);
    out.set(e.data, l + LOCAL_SIZE + n.length);

    v.setUint32(p, CENTRAL, true);
    v.setUint16(p + 4, e.madeBy, true);
    common(p + 6, e, n.length);
    // extra length, comment length, disk, internal attributes stay 0
    v.setUint32(p + 38, e.external, true);
    v.setUint32(p + 42, l, true);
    out.set(n, p + CENTRAL_SIZE);
    p += CENTRAL_SIZE + n.length;
  });
  v.setUint32(p, END, true);
  v.setUint16(p + 8, entries.length, true);
  v.setUint16(p + 10, entries.length, true);
  v.setUint32(p + 12, cdSize, true);
  v.setUint32(p + 16, cd, true);
  return out;
}

/** a TFLite flatbuffer carries the file identifier 'TFL3' at byte 4 */
function isTflite(b: Uint8Array): boolean {
  return b.byteLength > 8 && b[4] === 0x54 && b[5] === 0x46 && b[6] === 0x4c && b[7] === 0x33;
}

/** `bundle` (a face_landmarker.task) without face_blendshapes.tflite, every other entry unchanged: the camera's bundle */
export function withoutBlendshapes(bundle: Uint8Array): Uint8Array {
  return writeStoredZip(readStoredZip(bundle).filter((e) => e.name !== BLENDSHAPES_ENTRY));
}

/**
 * `bundle` (a face_landmarker.task) with its face_detector.tflite replaced by `detector` and without
 * face_blendshapes.tflite; every other entry unchanged. The photo bundle: the tracker assembles it right before each
 * switch to it (tracker.ts setMode) and keeps no reference, since MediaPipe copies the buffer it is given.
 */
export function withFaceDetector(bundle: Uint8Array, detector: Uint8Array): Uint8Array {
  if (!isTflite(detector)) throw new Error('face detector is not a TFLite model');
  const entries = readStoredZip(bundle).filter((e) => e.name !== BLENDSHAPES_ENTRY);
  const i = entries.findIndex((e) => e.name === FACE_DETECTOR_ENTRY);
  if (i < 0) throw new Error(`bundle has no ${FACE_DETECTOR_ENTRY}`);
  entries[i] = { ...entries[i], data: detector, crc: crc32(detector) };
  return writeStoredZip(entries);
}

/** whether `detector` could be the photo detector (the check withFaceDetector makes first) */
export function isFaceDetectorModel(detector: Uint8Array): boolean {
  return isTflite(detector);
}
