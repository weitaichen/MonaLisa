// Multi-step user flows shared by several screens.
import type { BeautyParams } from '../types';
import { reportError } from './debug';
import { deps } from './deps';
import { app, go, toast, type EditorSource } from './state';

function maxImportEdge(): number {
  // RB §4: long edge 2048, 1440 on tier L. 'auto' means the tier the live loop settled on this session
  // (H until the camera has run, so an import before that still decodes at 2048).
  const pref = app.get().prefs.tier;
  const tier = pref === 'auto' ? deps.autoTierSession() : pref;
  return tier === 'L' ? 1440 : 2048;
}

/** Decode a photo (file or history original) and open it in the editor. */
export async function openInEditor(
  blob: Blob,
  opts: {
    params?: BeautyParams;
    historyId?: string | null;
    body?: EditorSource['body'];
    returnTo: EditorSource['returnTo'];
  },
): Promise<void> {
  app.set({ busy: '正在開啟照片…' });
  try {
    const bitmap = await deps.importPhoto(blob, maxImportEdge());
    const source: EditorSource = {
      bitmap,
      params: opts.params ?? app.get().params,
      historyId: opts.historyId ?? null,
      returnTo: opts.returnTo,
    };
    if (opts.body !== undefined) source.body = opts.body;
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
