// Pure text / number formatting for engine-download progress.
import type { EngineAssetsProgress } from '../types';

export function progressFraction(p: EngineAssetsProgress | null): number | null {
  if (!p) return null;
  if (p.phase === 'done') return 1;
  if (p.phase === 'wasm') return null;
  return p.total > 0 ? Math.min(1, p.loaded / p.total) : null;
}

export function progressText(p: EngineAssetsProgress | null): string {
  if (!p) return '準備下載美顏引擎…';
  if (p.phase === 'wasm') return '準備臉部偵測模組…';
  if (p.phase === 'done') return '美顏引擎已就緒';
  const f = progressFraction(p);
  if (f !== null) return `下載美顏引擎 ${Math.round(f * 100)}%`;
  return `下載美顏引擎 ${(p.loaded / 1048576).toFixed(1)} MB`;
}
