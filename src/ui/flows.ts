// Multi-step user flows shared by several screens.
import { importEdit, openState } from '../edit/migrate';
import type { CameraHandOver, EditState, FaceSeed, HistoryEntry } from '../types';
import { reportError } from './debug';
import { deps } from './deps';
import { app, go, toast, type EditorSource } from './state';

/** the working copy's long edge an import or a reopen decodes at; also the edge 設定 names for 標準 (C D6) */
export function maxImportEdge(): number {
  // RB §4: long edge 2048, 1440 on tier L. 'auto' means the tier the live loop settled on this session
  // (H until the camera has run, so an import before that still decodes at 2048).
  const pref = app.get().prefs.tier;
  const tier = pref === 'auto' ? deps.autoTierSession() : pref;
  return tier === 'L' ? 1440 : 2048;
}

/**
 * A new photo's editor source (an import or a camera shot): nothing cached (the editor detects once, sessionPlan). A
 * shot carries its face seed and its hand-over persons (camera per-person §5.3) to the photo's first face answer.
 */
export function freshSource(
  bitmap: ImageBitmap,
  edit: EditState,
  returnTo: EditorSource['returnTo'],
  faceSeed: FaceSeed = null,
  handOver: CameraHandOver['persons'] | null = null,
): EditorSource {
  return { bitmap, edit, historyId: null, detect: null, rematch: null, v1Body: null, cacheDropped: false, faceSeed, handOver, frame: { width: bitmap.width, height: bitmap.height }, returnTo };
}

/**
 * Decode a photo (file or history original) and open it in the editor; an entry goes through openState (S §5.3).
 * `picked`: a file the user just picked, decoded with its oriented size so the Editor can decide to keep it (S §3.7);
 * a reopen carries the entry's kept source.
 */
export async function openInEditor(blob: Blob, opts: { entry?: HistoryEntry | null; returnTo: EditorSource['returnTo']; picked?: boolean }): Promise<void> {
  app.set({ busy: '正在開啟照片…' });
  try {
    let bitmap: ImageBitmap;
    let oriented: { width: number; height: number } | null = null;
    if (opts.picked) {
      const info = await deps.importPhotoInfo(blob, maxImportEdge());
      bitmap = info.bitmap;
      oriented = info.oriented;
    } else bitmap = await deps.importPhoto(blob, maxImportEdge());
    const entry = opts.entry ?? null;
    let source: EditorSource;
    if (entry) {
      const o = openState(entry, { width: bitmap.width, height: bitmap.height });
      source = { ...freshSource(bitmap, o.edit, opts.returnTo), historyId: entry.id, detect: o.detect, rematch: o.rematch, v1Body: o.v1Body, cacheDropped: o.cacheDropped, frame: o.frame };
      if (entry.faceProtect === true) source.faceProtect = true;
      if (entry.faceMask) source.faceMask = entry.faceMask;
    } else source = freshSource(bitmap, importEdit(), opts.returnTo);
    if (entry) source.source = { blob: entry.source ?? null, width: entry.sourceWidth ?? null, height: entry.sourceHeight ?? null };
    else if (opts.picked && oriented) {
      source.picked = blob as File;
      source.source = { blob: null, width: oriented.width, height: oriented.height };
    }
    go({ name: 'editor', source });
  } catch (e) {
    toast(`無法開啟照片：${reportError(e, 'importPhoto')}`, 4000);
  } finally {
    app.set({ busy: null });
  }
}

let fileInput: HTMLInputElement | null = null;
let onPicked: ((f: File) => void) | null = null;

/** One persistent hidden <input type=file accept="image/*"> (no `capture`, no image/heic — RB §1 #17). Call from a tap. */
export function pickPhoto(onFile: (f: File) => void): void {
  if (!fileInput) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.tabIndex = -1;
    input.setAttribute('aria-hidden', 'true');
    // in the document (not display:none) so iOS opens the picker reliably
    input.style.cssText = 'position:fixed;left:-100px;top:0;width:1px;height:1px;opacity:0';
    input.addEventListener('change', () => {
      const f = input.files?.[0];
      input.value = '';
      if (f && onPicked) onPicked(f);
    });
    document.body.appendChild(input);
    fileInput = input;
  }
  onPicked = onFile;
  fileInput.click();
}
