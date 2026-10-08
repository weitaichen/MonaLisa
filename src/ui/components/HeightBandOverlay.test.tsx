// 增高 band overlay: the band invariants of a line drag / arrow key, and the gesture commit (one undo step per
// gesture, also when the overlay unmounts mid-drag). The component is mounted with real Preact on a tiny DOM
// stand-in (vitest runs in node): just the node / attribute / listener calls Preact's diff makes.
//
// Invariants of every band a drag or key step emits (and of what the overlay shows for it):
//  I1  source rows 0 ≤ top < bottom ≤ 1, the display length ≥ MIN_GAP, so setHeightBand never drops it;
//  I2  the lower display edge passes the frame bottom by at most HEIGHT_MAX_CROP (the 8 % crop);
//  I3  the amount is the band's amount when the gesture started (a line drag never resets it);
//  I4  the live display edges are where the emitted band is seen (bandToDisplay(band));
//  I5  a gesture that moved commits exactly once, its last preview, however it ends.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { render } from 'preact';
import { useState } from 'preact/hooks';
import { act } from 'preact/test-utils';
import { heightBandStretch, HEIGHT_MAX_CROP } from '../../body/bands';
import { defaultParams, setHeightBand, setParam } from '../../engine/params';
import { UndoStack } from '../../store/undo';
import type { BeautyParams, HeightBand } from '../../types';
import { bandOrSuggested } from '../panelModel';
import {
  BandDrag,
  bandEdges,
  bandToDisplay,
  defaultStretch,
  dragEdge,
  HeightBandOverlay,
  keyStep,
  MIN_GAP,
  type BandStretch,
} from './HeightBandOverlay';

const EPS = 1e-9;

function expectInvariants(band: HeightBand, display: { top: number; bottom: number } | null, amount: number, stretch: BandStretch) {
  // I1
  expect(band.top).toBeGreaterThanOrEqual(0);
  expect(band.bottom).toBeLessThanOrEqual(1);
  expect(band.top).toBeLessThan(band.bottom);
  const shown = bandToDisplay(band, stretch);
  expect(shown.bottom - shown.top).toBeGreaterThanOrEqual(MIN_GAP - EPS);
  const stored = setHeightBand(defaultParams(), band).heightBand;
  expect(stored).not.toBeNull();
  // I2
  expect(shown.bottom - 1).toBeLessThanOrEqual(HEIGHT_MAX_CROP + EPS);
  // I3
  expect(band.amount).toBe(amount);
  expect(stored!.amount).toBe(amount);
  // I4
  if (display) {
    expect(display.top).toBeCloseTo(shown.top, 6);
    expect(display.bottom).toBeCloseTo(shown.bottom, 6);
  }
}

const sweep = (from: number, to: number, step = 0.005) => {
  const ys: number[] = [];
  for (let y = from; step > 0 ? y <= to + EPS : y >= to - EPS; y += step) ys.push(y);
  return ys;
};

describe('增高 line drag: band invariants', () => {
  const bands: HeightBand[] = [
    { top: 0.5, bottom: 1, amount: 1 }, // the lower line overshot the frame (round 2 stores source bottom 1)
    { top: 0.5, bottom: 0.98, amount: 1 }, // the suggested hips → ankles band at full 增高
    { top: 0.5, bottom: 0.96, amount: 1 },
    { top: 0.3, bottom: 0.8, amount: 0.6 }, // inside the frame
    { top: 0.6, bottom: 0.9, amount: 0 },
  ];
  for (const stretch of [heightBandStretch, defaultStretch]) {
    const name = stretch === heightBandStretch ? 'heightBandStretch' : 'defaultStretch';
    for (const band of bands) {
      it(`${name} ${JSON.stringify(band)}: the top line dragged down onto the lower edge and back`, () => {
        // fed back from each returned display (what a chained caller does) …
        let model = bandToDisplay(band, stretch);
        for (const y of [...sweep(band.top, 1.1), ...sweep(1.1, 0, -0.005)]) {
          const r = dragEdge('top', y, model, band.amount, stretch);
          expectInvariants(r.band, r.display, band.amount, stretch);
          model = r.display;
        }
        // … and from the gesture's start edges (what BandDrag does)
        const start = bandToDisplay(band, stretch);
        for (const y of sweep(0, 1.1)) {
          const r = dragEdge('top', y, start, band.amount, stretch);
          expectInvariants(r.band, r.display, band.amount, stretch);
          // the lower line stays where it is seen, until the source band reaches the image bottom
          if (r.band.bottom < 1 - 1e-6) expect(bandToDisplay(r.band, stretch).bottom).toBeCloseTo(start.bottom, 6);
        }
      });
      it(`${name} ${JSON.stringify(band)}: the lower line dragged up onto the top line and down past the frame`, () => {
        const start = bandToDisplay(band, stretch);
        for (const y of [...sweep(0, 1.3), ...sweep(1.3, 0, -0.005)]) {
          const r = dragEdge('bottom', y, start, band.amount, stretch);
          expectInvariants(r.band, r.display, band.amount, stretch);
          expect(r.band.top).toBe(band.top);
        }
      });
      it(`${name} ${JSON.stringify(band)}: arrow keys on both lines`, () => {
        for (const edge of ['top', 'bottom'] as const) {
          for (const step of [0.01, -0.01]) {
            let b = band;
            for (let i = 0; i < 120; i++) {
              b = keyStep(edge, step, b, stretch);
              expectInvariants(b, null, band.amount, stretch);
            }
          }
        }
      });
    }
  }

  it('G2: the top line onto a lower edge past the frame keeps the band and its amount (was: dropped, amount 0)', () => {
    // the lower line overshot: source bottom 1, seen at 1.075
    const band = { top: 0.5, bottom: 1, amount: 1 };
    let model = bandEdges(band, heightBandStretch, null).model;
    expect(model.bottom).toBeCloseTo(1.075);
    let p: BeautyParams = setHeightBand(defaultParams(), band);
    for (const y of [0.9, 0.98, 0.99, 1]) {
      const r = dragEdge('top', y, model, band.amount, heightBandStretch);
      p = setHeightBand(p, r.band);
      expect(p.heightBand).not.toBeNull();
      expect(bandOrSuggested(p, undefined).amount).toBe(1);
      expect(r.display.bottom - r.display.top).toBeGreaterThanOrEqual(MIN_GAP - EPS);
      model = r.display;
    }
    // stops where the band ending at row 1 is still MIN_GAP long on screen: (1 − t)·1.15 = 0.06
    expect(p.heightBand!.top).toBeCloseTo(1 - MIN_GAP / 1.15, 4);
    expect(p.heightBand!.bottom).toBeCloseTo(1, 9);
  });

  it('arrow keys are unchanged where they never hit the limit', () => {
    const band = { top: 0.5, bottom: 0.98, amount: 1 };
    expect(keyStep('top', -0.01, band, heightBandStretch).bottom).toBeCloseTo(0.49 + (1.052 - 0.49) / 1.15, 3);
    expect(keyStep('bottom', -0.01, band, heightBandStretch).bottom).toBeCloseTo(0.5 + 0.542 / 1.15, 3);
    // ArrowDown on the top line: stops MIN_GAP (on screen) above the image bottom, as before
    let b: HeightBand = band;
    for (let i = 0; i < 60; i++) b = keyStep('top', 0.01, b, heightBandStretch);
    expect(b.top).toBeCloseTo(0.9478, 3);
    expect(b.bottom).toBeCloseTo(1, 3);
  });
});

// ───────────── the component, on a DOM stand-in ─────────────

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
}
class FakeText extends FakeNode {
  constructor(public data: string) {
    super(3, '#text');
  }
}
class FakeElement extends FakeNode {
  attrs: Record<string, string> = {};
  style: Record<string, unknown> & { setProperty(k: string, v: string): void } = {
    setProperty(k: string, v: string) {
      this[k] = v;
    },
  };
  listeners: Record<string, (e: unknown) => unknown> = {};
  captured = new Set<number>();
  // Preact attaches `onPointerDown` as 'pointerdown' when the lower-case handler property exists
  onpointerdown = null;
  onpointermove = null;
  onpointerup = null;
  onpointercancel = null;
  onlostpointercapture = null;
  onkeydown = null;
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
  addEventListener(type: string, fn: (e: unknown) => unknown) {
    this.listeners[type.toLowerCase()] = fn;
  }
  removeEventListener(type: string) {
    delete this.listeners[type.toLowerCase()];
  }
  getBoundingClientRect() {
    return { top: 0, left: 0, width: 100, height: 100, right: 100, bottom: 100 };
  }
  setPointerCapture(id: number) {
    this.captured.add(id);
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

/** dispatch a DOM event on one of the overlay's elements (Preact's listener, with `this` = the element) */
function fire(el: FakeElement, type: string, init: Record<string, unknown>) {
  const fn = el.listeners[type];
  if (!fn) throw new Error(`no ${type} listener on ${el.localName}`);
  const ev = {
    type,
    currentTarget: el,
    target: el,
    defaultPrevented: false,
    stopPropagation() {},
    preventDefault() {
      ev.defaultPrevented = true;
    },
    ...init,
  };
  act(() => {
    fn.call(el, ev);
  });
  return ev;
}

/** the Editor's params / undo wiring for the overlay: update(p, commit) pushes an undo step on commit */
function editorLike(initial: BeautyParams) {
  const undo = new UndoStack<BeautyParams>(50);
  undo.reset(initial);
  const ed = {
    params: initial,
    undo,
    commits: 0,
    update(p: BeautyParams, commit: boolean) {
      ed.params = p;
      if (commit) {
        ed.commits++;
        undo.push(p);
      }
    },
  };
  return ed;
}

/** mounts the overlay the way the Editor does: hidden while 按住對比 is held */
function mount(ed: ReturnType<typeof editorLike>) {
  const root = new FakeElement('div');
  let setHeld: (v: boolean) => void = () => undefined;
  function Harness() {
    const [held, set] = useState(false);
    setHeld = set;
    const [, bump] = useState(0);
    return held ? null : (
      <HeightBandOverlay
        band={bandOrSuggested(ed.params, undefined)}
        stretch={heightBandStretch}
        onChange={(b, commit) => {
          ed.update(setHeightBand(ed.params, b), commit);
          bump((n) => n + 1);
        }}
      />
    );
  }
  act(() => render(<Harness />, root as unknown as Element));
  const lines = () => root.all().filter((e) => e.attrs.role === 'slider');
  return {
    root,
    line: (edge: 'top' | 'bottom') => lines()[edge === 'top' ? 0 : 1],
    hold: (v: boolean) => act(() => setHeld(v)),
    unmount: () => act(() => render(null, root as unknown as Element)),
  };
}

describe('HeightBandOverlay gesture commit', () => {
  const band = { top: 0.4, bottom: 0.8, amount: 0.6 };
  const orig = setHeightBand(defaultParams(), band);
  const slim = setParam(orig, 'body.slim', 0.5);

  it('G6: a drag cut off by 按住對比 (the overlay unmounts) still commits one undo step', () => {
    const ed = editorLike(orig);
    ed.update(slim, true);
    const ui = mount(ed);
    const top = ui.line('top');
    fire(top, 'pointerdown', { pointerId: 1, clientY: 40 });
    fire(top, 'pointermove', { pointerId: 1, clientY: 35 });
    fire(top, 'pointermove', { pointerId: 1, clientY: 30 });
    expect(ed.params.heightBand!.top).toBeCloseTo(0.3);
    expect(ed.commits).toBe(1); // only slim so far
    ui.hold(true); // a second finger on 按住對比: no pointerup / cancel ever reaches the line
    expect(ed.commits).toBe(2);
    expect(ed.undo.canUndo).toBe(true);
    // 復原 reverts only the band edit, 重做 brings it back
    expect(ed.undo.undo()).toEqual(slim);
    const redone = ed.undo.redo()!;
    expect(redone.values['body.slim']).toBe(0.5);
    expect(redone.heightBand!.top).toBeCloseTo(0.3);
    expect(redone.heightBand!.amount).toBe(0.6);
    // the overlay comes back after the hold: no second commit, a new drag works
    ui.hold(false);
    expect(ed.commits).toBe(2);
    fire(ui.line('bottom'), 'pointerdown', { pointerId: 2, clientY: 85 });
    fire(ui.line('bottom'), 'pointermove', { pointerId: 2, clientY: 75 });
    fire(ui.line('bottom'), 'pointerup', { pointerId: 2, clientY: 75 });
    expect(ed.commits).toBe(3);
  });

  it('G6: an aborted first edit enables 復原 (the overlay is torn down with the screen / session)', () => {
    const ed = editorLike(orig);
    const ui = mount(ed);
    fire(ui.line('bottom'), 'pointerdown', { pointerId: 7, clientY: 70 });
    fire(ui.line('bottom'), 'pointermove', { pointerId: 7, clientY: 60 });
    expect(ed.undo.canUndo).toBe(false);
    ui.unmount();
    expect(ed.commits).toBe(1);
    expect(ed.undo.canUndo).toBe(true);
    expect(ed.undo.undo()).toEqual(orig);
  });

  it('a gesture commits exactly once: pointerup then lostpointercapture, or a lost capture alone', () => {
    const ed = editorLike(orig);
    const ui = mount(ed);
    const top = ui.line('top');
    fire(top, 'pointerdown', { pointerId: 1, clientY: 40 });
    fire(top, 'pointermove', { pointerId: 1, clientY: 30 });
    fire(top, 'pointerup', { pointerId: 1, clientY: 30 });
    fire(top, 'lostpointercapture', { pointerId: 1 });
    expect(ed.commits).toBe(1);
    fire(top, 'pointerdown', { pointerId: 2, clientY: 30 });
    fire(top, 'pointermove', { pointerId: 2, clientY: 20 });
    fire(top, 'lostpointercapture', { pointerId: 2 });
    expect(ed.commits).toBe(2);
    expect(ed.params.heightBand!.top).toBeCloseTo(0.2);
    ui.unmount(); // nothing pending: no extra step
    expect(ed.commits).toBe(2);
  });

  it('a tap (no move past the slop) and an unmount after release commit nothing', () => {
    const ed = editorLike(orig);
    const ui = mount(ed);
    fire(ui.line('top'), 'pointerdown', { pointerId: 1, clientY: 40 });
    fire(ui.line('top'), 'pointermove', { pointerId: 1, clientY: 41 });
    ui.unmount();
    expect(ed.commits).toBe(0);
    expect(ed.params).toEqual(orig);
  });

  it('G2 end to end: lower line past the frame, then the top line onto it and back, keeps the band and amount', () => {
    const p0 = setHeightBand(defaultParams(), { top: 0.5, bottom: 0.96, amount: 1 });
    const ed = editorLike(p0);
    const ui = mount(ed);
    // (1) the lower line (seen at 1.029, drawn at the frame bottom) dragged past the frame
    const lower = ui.line('bottom');
    expect(lower.style.top).toBe('100.000%');
    fire(lower, 'pointerdown', { pointerId: 1, clientY: 99 });
    fire(lower, 'pointermove', { pointerId: 1, clientY: 140 });
    fire(lower, 'pointerup', { pointerId: 1, clientY: 140 });
    expect(ed.params.heightBand).toEqual({ top: 0.5, bottom: 1, amount: 1 });
    // (2) the top line down onto it, past the frame, and back up to 0.6
    const top = ui.line('top');
    fire(top, 'pointerdown', { pointerId: 2, clientY: 50 });
    for (const y of [70, 90, 98, 99, 100, 105, 90, 60]) {
      fire(top, 'pointermove', { pointerId: 2, clientY: y });
      expect(ed.params.heightBand).not.toBeNull();
      expect(ed.params.heightBand!.amount).toBe(1);
      expectInvariants(ed.params.heightBand!, null, 1, heightBandStretch);
    }
    fire(top, 'pointerup', { pointerId: 2, clientY: 60 });
    // path independent: the same as dragging straight to 0.6
    expect(ed.params.heightBand!.top).toBeCloseTo(0.6);
    expect(ed.params.heightBand!.bottom).toBe(1);
    expect(ed.params.heightBand!.amount).toBe(1);
    expect(ed.commits).toBe(2);
  });

  it('arrow keys on both lines, incl. the lower line past the frame', () => {
    const p0 = setHeightBand(defaultParams(), { top: 0.5, bottom: 0.96, amount: 1 });
    const ed = editorLike(p0);
    const ui = mount(ed);
    const key = (edge: 'top' | 'bottom', k: string) => fire(ui.line(edge), 'keydown', { key: k });
    // the lower line is drawn at the frame bottom but steps from its real edge (1.029)
    expect(key('bottom', 'ArrowDown').defaultPrevented).toBe(true);
    expect(ed.params.heightBand!.bottom).toBeGreaterThan(0.96);
    for (let i = 0; i < 20; i++) key('bottom', 'ArrowDown');
    expect(ed.params.heightBand!.bottom).toBe(1);
    const commits = ed.commits;
    key('bottom', 'ArrowDown'); // at the limit: no empty undo step
    expect(ed.commits).toBe(commits);
    for (let i = 0; i < 60; i++) {
      key('top', 'ArrowDown');
      expectInvariants(ed.params.heightBand!, null, 1, heightBandStretch);
    }
    for (let i = 0; i < 60; i++) {
      key('bottom', 'ArrowUp');
      expectInvariants(ed.params.heightBand!, null, 1, heightBandStretch);
    }
    expect(key('top', 'Enter').defaultPrevented).toBe(false);
  });
});

describe('BandDrag', () => {
  it('uses the amount and edges the gesture started with, whatever the parent echoes back', () => {
    let band: HeightBand = { top: 0.4, bottom: 0.8, amount: 0.6 };
    const seen: [HeightBand, boolean][] = [];
    const d = new BandDrag(
      () => ({ band, stretch: heightBandStretch, onChange: (b, c) => seen.push([b, c]) }),
      () => undefined,
    );
    expect(d.down('top', 1, 0.4, 40)).toBe(true);
    expect(d.down('bottom', 2, 0.8, 80)).toBe(false); // one drag at a time
    expect(d.move(2, 0.9, 90)).toBe(false);
    d.move(1, 0.3, 30);
    band = { top: 0.52, bottom: 0.86, amount: 0 }; // e.g. a suggested band after a transient drop
    d.move(1, 0.35, 35);
    expect(d.end(1)).toBe(true);
    expect(seen.map(([b]) => b.amount)).toEqual([0.6, 0.6, 0.6]);
    expect(seen.map(([, c]) => c)).toEqual([false, false, true]);
    expect(seen[2][0]).toEqual(seen[1][0]); // commits its last preview
    // the lower line stays where it was seen when the gesture started
    expect(bandToDisplay(seen[2][0], heightBandStretch).bottom).toBeCloseTo(bandToDisplay(seen[0][0], heightBandStretch).bottom, 6);
    expect(bandToDisplay(seen[2][0], heightBandStretch).bottom).toBeCloseTo(0.4 + 0.4 * 1.09, 6);
    d.abort(); // nothing pending
    expect(seen).toHaveLength(3);
  });
});
