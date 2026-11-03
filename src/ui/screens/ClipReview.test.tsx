// Clip screen 預覽 (beauty video spec §4.5): what showSaveFallback tells the save dialog, 儲存 handing the file to the
// share sheet inside the tap, and the screen revoking its object URL when it goes. The screen is mounted with real
// Preact on a tiny DOM stand-in (vitest runs in node), as HeightBandOverlay.test.tsx and Slider.test.tsx do. What
// happens once saveFile answers is shareFile's, tested in flows.share.test.ts.
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import type { SaveResult } from '../../types';
import { deps } from '../deps';
import { haptic } from '../platform';
import { app, closeSaveFallback, showSaveFallback, type Clip } from '../state';
import { ClipReview } from './ClipReview';

// state.ts → debug.ts keeps window.__meiyan from import on; node has no `window`
vi.hoisted(() => {
  (globalThis as { window?: unknown }).window = globalThis;
});
// haptic() is a no-op in node (no HTMLInputElement): spy on it to see the tap buzz
vi.mock('../platform', async (orig) => ({ ...(await orig<typeof import('../platform')>()), haptic: vi.fn() }));

class FakeNode {
  childNodes: FakeNode[] = [];
  parentNode: FakeNode | null = null;
  constructor(
    readonly nodeType: number,
    readonly localName: string,
  ) {}
  get firstChild() {
    return this.childNodes[0] ?? null;
  }
  get nextSibling(): FakeNode | null {
    const p = this.parentNode;
    return p ? (p.childNodes[p.childNodes.indexOf(this) + 1] ?? null) : null;
  }
  insertBefore(n: FakeNode, ref: FakeNode | null) {
    n.parentNode?.removeChild(n);
    const i = ref ? this.childNodes.indexOf(ref) : -1;
    if (i < 0) this.childNodes.push(n);
    else this.childNodes.splice(i, 0, n);
    n.parentNode = this;
    return n;
  }
  appendChild(n: FakeNode) {
    return this.insertBefore(n, null);
  }
  removeChild(n: FakeNode) {
    this.childNodes.splice(this.childNodes.indexOf(n), 1);
    n.parentNode = null;
    return n;
  }
  remove() {
    this.parentNode?.removeChild(this);
  }
  get text(): string {
    return this.childNodes.map((c) => c.text).join('');
  }
}
class FakeText extends FakeNode {
  constructor(public data: string) {
    super(3, '#text');
  }
  override get text(): string {
    return this.data;
  }
}
class FakeElement extends FakeNode {
  attrs: Record<string, string> = {};
  style: Record<string, unknown> & { setProperty(k: string, v: string): void } = {
    setProperty(k: string, v: string) {
      this[k] = v;
    },
  };
  // Preact attaches `onClick` as 'click' (its proxy then looks the handler up by e.type) when the property exists
  onclick = null;
  constructor(name: string) {
    super(1, name);
  }
  setAttribute(k: string, v: string) {
    this.attrs[k] = String(v);
  }
  removeAttribute(k: string) {
    delete this.attrs[k];
  }
  getAttribute(k: string) {
    return this.attrs[k] ?? null;
  }
  listeners: Record<string, (e: unknown) => unknown> = {};
  addEventListener(type: string, fn: (e: unknown) => unknown) {
    this.listeners[type.toLowerCase()] = fn;
  }
  removeEventListener(type: string) {
    delete this.listeners[type.toLowerCase()];
  }
  /** all descendants (self included) */
  all(): FakeElement[] {
    return [this, ...this.childNodes.flatMap((c) => (c instanceof FakeElement ? c.all() : []))];
  }
}
const fakeDocument = {
  createElement: (n: string) => new FakeElement(n),
  createElementNS: (_ns: string, n: string) => new FakeElement(n),
  createTextNode: (t: string) => new FakeText(t),
};

let saved: unknown;
beforeAll(() => {
  saved = (globalThis as { document?: unknown }).document;
  (globalThis as { document?: unknown }).document = fakeDocument;
});
afterAll(() => {
  (globalThis as { document?: unknown }).document = saved;
});
afterEach(() => {
  vi.restoreAllMocks(); // deps.saveFile, URL
  vi.mocked(haptic).mockClear();
  app.set({ screen: { name: 'home' }, saveFallback: null, saveFallbackName: null, saveFallbackKind: 'image' });
});

const clip = (): Clip => ({
  file: new File(['mp4'], 'meiyan-20261029-120000.mp4', { type: 'video/mp4' }),
  url: 'blob:clip',
  durationMs: 2000,
  hasAudio: true,
});

function mount(c: Clip) {
  const root = new FakeElement('div');
  act(() => {
    render(<ClipReview clip={c} />, root as unknown as Element);
  });
  const buttons = () => root.all().filter((e) => e.localName === 'button');
  return {
    video: () => root.all().find((e) => e.localName === 'video'),
    labels: () => buttons().map((b) => b.text),
    button: (label: string) => buttons().find((b) => b.text === label)!,
    unmount: () => act(() => render(null, root as unknown as Element)),
  };
}

/** a tap: Preact's click listener, called as the browser does (`this` = the element) */
function tap(el: FakeElement) {
  const fn = el.listeners.click;
  if (!fn) throw new Error(`no click listener on ${el.localName}`);
  act(() => {
    fn.call(el, { type: 'click', currentTarget: el, target: el });
  });
}

it('showSaveFallback sets the video kind for a video file and the image kind for a photo', () => {
  const create = vi.spyOn(URL, 'createObjectURL').mockReturnValueOnce('blob:one').mockReturnValueOnce('blob:two').mockReturnValueOnce('blob:three');
  const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  const mp4 = new File(['v'], 'meiyan-20261029-120000.mp4', { type: 'video/mp4' });
  showSaveFallback(mp4);
  expect(create).toHaveBeenCalledWith(mp4);
  expect(app.get()).toMatchObject({ saveFallback: 'blob:one', saveFallbackName: 'meiyan-20261029-120000.mp4', saveFallbackKind: 'video' });
  // a photo replaces it: the kind follows the file, and the previous URL goes
  showSaveFallback(new File(['p'], 'meiyan-20261029-120000.jpg', { type: 'image/jpeg' }));
  expect(app.get()).toMatchObject({ saveFallback: 'blob:two', saveFallbackName: 'meiyan-20261029-120000.jpg', saveFallbackKind: 'image' });
  expect(revoke).toHaveBeenCalledWith('blob:one');
  // WebM is a video too
  showSaveFallback(new File(['w'], 'meiyan-20261029-120000.webm', { type: 'video/webm' }));
  expect(app.get().saveFallbackKind).toBe('video');
  // closed: back to the defaults
  closeSaveFallback();
  expect(app.get()).toMatchObject({ saveFallback: null, saveFallbackName: null, saveFallbackKind: 'image' });
  expect(revoke).toHaveBeenLastCalledWith('blob:three');
});

it('the clip screen saves through saveFile inside the tap', () => {
  const c = clip();
  const save = vi.spyOn(deps, 'saveFile').mockReturnValue(new Promise<SaveResult>(() => undefined));
  const ui = mount(c);
  tap(ui.button('儲存'));
  // called before the click listener returned: nothing was awaited first (the share sheet needs the tap's activation)
  expect(save).toHaveBeenCalledTimes(1);
  expect(save).toHaveBeenCalledWith(c.file);
});

it('the clip screen revokes its URL on unmount', () => {
  const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  const c = clip();
  const ui = mount(c);
  expect(revoke).not.toHaveBeenCalled();
  ui.unmount();
  expect(revoke).toHaveBeenCalledTimes(1);
  expect(revoke).toHaveBeenCalledWith(c.url);
});

it('the clip screen plays the clip inline on a loop, muted so it can autoplay, and offers 重錄 and 儲存 only', () => {
  const c = clip();
  const ui = mount(c);
  const video = ui.video()!;
  expect(video.attrs.src).toBe(c.url);
  expect(video.attrs['aria-label']).toBe('錄影結果');
  // the JSX names; the browser reads them case-insensitively
  const names = Object.keys(video.attrs).map((k) => k.toLowerCase());
  for (const n of ['playsinline', 'loop', 'autoplay', 'muted', 'controls']) expect(names, n).toContain(n);
  expect(ui.labels()).toEqual(['重錄', '儲存']);
});

it('the clip screen sends 重錄 back to the camera', () => {
  const ui = mount(clip());
  tap(ui.button('重錄'));
  expect(haptic).toHaveBeenCalledTimes(1);
  expect(app.get().screen).toEqual({ name: 'camera' });
});
