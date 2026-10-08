// Test-only (Node): load a recorded PoseLandmarker detection from tests/fixtures (B3's pose JSON format).
import { existsSync, readFileSync } from 'node:fs';
import type { BodyDetection } from '../types';

export function loadPoseFixture(name: string): BodyDetection | null {
  const url = new URL(`../../tests/fixtures/${name}`, import.meta.url);
  if (!existsSync(url)) return null;
  const j = JSON.parse(readFileSync(url, 'utf8'));
  return {
    pose: { points: new Float32Array(j.points) },
    mask: j.mask ? { width: j.mask.width, height: j.mask.height, data: new Uint8Array(Buffer.from(j.mask.data, 'base64')) } : null,
    people: j.people,
    width: j.width,
    height: j.height,
  };
}
