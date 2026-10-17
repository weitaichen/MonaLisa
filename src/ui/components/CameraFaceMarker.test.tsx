// The camera's face marker (S §2.5) on a DOM stand-in (vitest runs in node), driven frame by frame through a stubbed
// requestAnimationFrame: the ring and the dot follow the beautified face, and the layer keeps its nodes across frames
// (one dot, one ring per selection) and writes a style only when its value changes (step-1 review P3).
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import type { LiveLoop } from '../../app/live';
import type { LiveTrackView } from '../../app/faceTracks';
import { CameraFaceMarker } from './CameraFaceMarker';

let created = 0;
let styleWrites = 0;

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
  append(...ns: FakeNode[]) {
    for (const n of ns) this.appendChild(n);
  }
  replaceChildren(...ns: FakeNode[]) {
    for (const c of [...this.childNodes]) this.removeChild(c);
    this.append(...ns);
  }
  removeChild(n: FakeNode) {
    this.childNodes.splice(this.childNodes.indexOf(n), 1);
    n.parentNode = null;
    return n;
  }
  remove() {
    this.parentNode?.removeChild(this);
  }
}
class FakeText extends FakeNode {
  constructor(public data: string) {
    super(3, '#text');
  }
}
class FakeElement extends FakeNode {
  attrs: Record<string, string> = {};
  className = '';
  /** every write counts, also of an unchanged value: the marker must not repeat them */
  style: Record<string, string> = new Proxy({} as Record<string, string>, {
    set(t, k, v) {
      styleWrites++;
      t[k as string] = String(v);
      return true;
    },
  });
  constructor(name: string) {
    super(1, name);
    created++;
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
  addEventListener() {}
  removeEventListener() {}
}
const fakeDocument = {
  createElement: (n: string) => new FakeElement(n),
  createElementNS: (_ns: string, n: string) => new FakeElement(n),
  createTextNode: (t: string) => new FakeText(t),
};

const frames = new Map<number, FrameRequestCallback>();
let nextId = 1;
let clock = 1000;
const g = globalThis as unknown as Record<string, unknown>;
const saved: Record<string, unknown> = {};
beforeAll(() => {
  for (const k of ['document', 'requestAnimationFrame', 'cancelAnimationFrame']) saved[k] = g[k];
  g.document = fakeDocument;
  g.requestAnimationFrame = (cb: FrameRequestCallback) => {
    frames.set(nextId, cb);
    return nextId++;
  };
  g.cancelAnimationFrame = (id: number) => frames.delete(id);
  vi.spyOn(performance, 'now').mockImplementation(() => clock);
});
afterAll(() => {
  for (const k of Object.keys(saved)) g[k] = saved[k];
  vi.restoreAllMocks();
});
beforeEach(() => {
  frames.clear();
  clock = 1000;
});

/** one animation frame: run the callbacks queued so far (each queues the next while the marker has something to draw) */
function frame(ms = 16) {
  clock += ms;
  const now = [...frames.values()];
  frames.clear();
  for (const cb of now) cb(clock);
}
const pending = () => frames.size;

const view = (id: number, x: number, beautified: boolean): LiveTrackView =>
  ({ id, box: { x, y: 0.3, w: 0.2, h: 0.3 }, rawBox: { x, y: 0.3, w: 0.2, h: 0.3 }, weight: 1, presence: 1, beautified, present: true }) as LiveTrackView;

function mount(views: { current: LiveTrackView[] }, ring: { id: number; at: number } | null, all = false) {
  const root = new FakeElement('div');
  const loop = { tracks: () => views.current } as unknown as LiveLoop;
  const canvas = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 300, height: 400 }) } as unknown as HTMLCanvasElement;
  const video = { videoWidth: 300, videoHeight: 400 } as HTMLVideoElement;
  const el = (r: typeof ring, a = all) => <CameraFaceMarker loop={loop} canvas={canvas} video={video} mirrored={false} ring={r} all={a} count={views.current.length} />;
  act(() => render(el(ring), root as unknown as Element));
  const marker = root.childNodes[0] as FakeElement;
  return { marker, rerender: (r: typeof ring, a = all) => act(() => render(el(r, a), root as unknown as Element)) };
}

const shown = (marker: FakeElement, cls: string) =>
  marker.childNodes.filter((c): c is FakeElement => c instanceof FakeElement && c.className === cls && c.style.display !== 'none');

describe('CameraFaceMarker', () => {
  it('keeps one dot node across frames while ≥ 2 faces are shown, and moves it only by changed styles', () => {
    const views = { current: [view(1, 0.1, true), view(2, 0.6, false)] };
    const { marker } = mount(views, null);
    frame();
    expect(shown(marker, 'cam-dot')).toHaveLength(1);
    const dot = shown(marker, 'cam-dot')[0];
    expect(dot.style.left).toBe('57px'); // 0.1·300 + 0.2·300/2 − 3
    expect(dot.style.top).toBe('108px'); // 0.3·400 − 12
    const nodes = marker.childNodes.length;
    const made = created;
    // a still scene: no node created or removed, no style written
    styleWrites = 0;
    for (let i = 0; i < 10; i++) frame();
    expect(marker.childNodes.length).toBe(nodes);
    expect(created).toBe(made);
    expect(styleWrites).toBe(0);
    // the face moves: the same node follows it, and only `left` is written
    views.current = [view(1, 0.2, true), view(2, 0.6, false)];
    frame();
    expect(marker.childNodes.length).toBe(nodes);
    expect(created).toBe(made);
    expect(shown(marker, 'cam-dot')[0]).toBe(dot);
    expect(dot.style.left).toBe('87px');
    expect(styleWrites).toBe(1);
    // the selection moves to face 2: still the same dot
    views.current = [view(1, 0.2, false), view(2, 0.6, true)];
    frame();
    expect(shown(marker, 'cam-dot')[0]).toBe(dot);
    expect(dot.style.left).toBe('207px');
    expect(created).toBe(made);
  });

  it('shows the ring for 800 ms on one node (its fade runs once), then hides it; a new selection gets a fresh ring', () => {
    const views = { current: [view(1, 0.1, true), view(2, 0.6, false)] };
    const { marker, rerender } = mount(views, { id: 2, at: 1000 });
    frame();
    const ring = shown(marker, 'cam-ring');
    expect(ring).toHaveLength(1);
    expect(ring[0].style).toMatchObject({ left: '180px', top: '120px', width: '60px', height: '120px' });
    const nodes = marker.childNodes.length;
    const made = created;
    for (let i = 0; i < 20; i++) frame();
    expect(shown(marker, 'cam-ring')[0]).toBe(ring[0]);
    expect(marker.childNodes.length).toBe(nodes);
    expect(created).toBe(made);
    frame(800);
    expect(shown(marker, 'cam-ring')).toHaveLength(0);
    expect(shown(marker, 'cam-dot')).toHaveLength(1);
    // a tap on face 1: one new ring node (a new fade), the old one gone, node count unchanged
    rerender({ id: 1, at: clock });
    frame();
    const ring2 = shown(marker, 'cam-ring');
    expect(ring2).toHaveLength(1);
    expect(ring2[0]).not.toBe(ring[0]);
    expect(marker.childNodes.length).toBe(nodes);
  });

  it('stops its loop when it has nothing to draw (one face, or 全部套用 without a ring)', () => {
    const views = { current: [view(1, 0.1, true), view(2, 0.6, false)] };
    const { marker, rerender } = mount(views, null, true);
    frame();
    expect(shown(marker, 'cam-dot')).toHaveLength(0);
    expect(pending()).toBe(0);
    rerender(null, false);
    frame();
    expect(shown(marker, 'cam-dot')).toHaveLength(1);
    expect(pending()).toBe(1);
    views.current = [view(1, 0.1, true)];
    frame();
    expect(shown(marker, 'cam-dot')).toHaveLength(0);
    expect(pending()).toBe(0);
  });
});
