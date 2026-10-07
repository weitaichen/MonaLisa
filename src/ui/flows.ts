// Multi-step user flows shared by several screens.
import type { BeautyParams } from '../types';
import { reportError } from './debug';
import { deps } from './deps';
import { app, go, toast, type EditorSource } from './state';

function maxImportEdge(): number {
  // RB §4: long edge 2048, 1440 on tier L
  return app.get().prefs.tier === 'L' ? 1440 : 2048;
}

/** Decode a photo (file or history original) and open it in the editor. */
export async function openInEditor(
  blob: Blob,
  opts: { params?: BeautyParams; historyId?: string | null; returnTo: EditorSource['returnTo'] },
): Promise<void> {
  app.set({ busy: '正在開啟照片…' });
  try {
    const bitmap = await deps.importPhoto(blob, maxImportEdge());
    go({
      name: 'editor',
      source: { bitmap, params: opts.params ?? app.get().params, historyId: opts.historyId ?? null, returnTo: opts.returnTo },
    });
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
