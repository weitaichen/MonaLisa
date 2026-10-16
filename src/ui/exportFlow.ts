// The 儲存 flow's rules (S §2.3), pure: which file a tap may share at once, when the pill asks for a second tap, what a
// failure does, and when to say that only the 2048 copy was kept.
import { SHARE_WINDOW_MS } from '../config/limits';
import { photoLuts } from '../engine/looks';
import type { ExportPlan, SourceInfo } from '../media/exportPlan';
import type { Engine, Size } from '../types';
import { stampIs } from './editorModel';

export type Pill = 'save' | 'preparing' | 'share';

export function pillLabel(p: Pill): string {
  return p === 'preparing' ? '準備中' : p === 'share' ? '分享' : '儲存';
}

/** the output settings a share file was made with: a 設定 change after a pre-encode must not share the old file */
export function planSig(p: Pick<ExportPlan, 'mode' | 'format' | 'quality' | 'width' | 'height'>): string {
  return `${p.mode}|${p.format}|${p.quality}|${p.width}x${p.height}`;
}

export interface ShareCache {
  key: string;
  field: number;
  sig: string;
  file: File;
}

export function shareReady(c: ShareCache | null, key: string, field: number, sig: string): boolean {
  return !!c && stampIs(c, key, field) && c.sig === sig;
}

/** the debounced pre-encode makes a share file only for a working-size JPEG (a PNG encode costs battery on every edit) */
export function preEncodes(p: Pick<ExportPlan, 'mode' | 'format'>): boolean {
  return p.mode === 'working' && p.format === 'jpeg';
}

/** within the tap's transient activation (5 s; SHARE_WINDOW_MS leaves a margin): share at once */
export function shareNow(startedAt: number, now: number): boolean {
  return now - startedAt <= SHARE_WINDOW_MS;
}

/**
 * What a finished export does (S §2.3): inside the tap's 4 s it is shared at once (the state at the tap). Later the pill
 * turns 「分享」 only while the file is still for the user's edit (`current`: the edit key, not the share cache's test,
 * since a field or limit the system settled meanwhile is no edit); one an edit superseded while it ran (準備中 leaves a
 * working-size export's panel usable) is dropped like a finished file on the next edit, and the pill is 儲存.
 */
export function deliverAction(startedAt: number, now: number, current: boolean): 'share' | 'pending' | 'drop' {
  if (shareNow(startedAt, now)) return 'share';
  return current ? 'pending' : 'drop';
}

/**
 * What a pill tap does (S §2.3): 「分享」 shares the file the slow export just delivered, synchronously inside the tap,
 * whatever plan made it (a fallback's working-size file too, and also when a settling 美體 field kept it out of the share
 * cache), so the second tap can never start another export that ends in 「分享」 again.
 */
export function tapAction(pill: Pill, hasPending: boolean): 'ignore' | 'sharePending' | 'export' {
  if (pill === 'preparing') return 'ignore';
  return pill === 'share' && hasPending ? 'sharePending' : 'export';
}

/** 「取消」, ✕ and the background abort reject with AbortError (shows nothing); any other failure falls back once */
export function exportOutcome(e: unknown): 'abort' | 'fallback' {
  return typeof e === 'object' && e !== null && (e as { name?: unknown }).name === 'AbortError' ? 'abort' : 'fallback';
}

/**
 * The tiled export's drawState (runTiledExport): what a tile of `photo` draws with besides its input. The static
 * textures stand as `engine.ready` (a context restore replaces it and reloads them), then each 濾鏡 / 質感 LUT's state.
 * null while one of those LUTs has not settled: still loading, or not asked for (the engine's lutFor would start it and
 * draw that tile without it).
 */
export function tileDrawState(engine: Pick<Engine, 'ready' | 'lutState'>, photo: Parameters<typeof photoLuts>[0]): unknown[] | null {
  const states = photoLuts(photo).map((r) => engine.lutState(r.kind, r.id));
  return states.every((s) => s === 'ready' || s === 'failed') ? [engine.ready, ...states] : null;
}

/** 「此照片只保留了 2048 解析度」: a working plan for want of a source, although the original was larger than the working copy */
export function noSourceNote(plan: ExportPlan, source: SourceInfo, working: Size): boolean {
  return plan.fallback === 'noSource' && !!source.width && !!source.height && Math.max(source.width, source.height) > Math.max(working.width, working.height);
}
