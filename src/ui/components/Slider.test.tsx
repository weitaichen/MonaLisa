// SliderRow with persons (S §2.4): the empty row's text (程度 under 全部 with different presets), the aria-label naming
// the target, and 「各人不同」 on the label and the value text. Mounted with real Preact on a tiny DOM stand-in (vitest
// runs in node), as HeightBandOverlay.test.tsx does.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import type { SliderBinding } from '../panelModel';
import { SliderRow } from './Slider';

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
  onpointerdown = null;
  onpointermove = null;
  onpointerup = null;
  onpointercancel = null;
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
  addEventListener() {}
  removeEventListener() {}
  all(): FakeElement[] {
    return [this, ...this.childNodes.flatMap((c) => (c instanceof FakeElement ? c.all() : []))];
  }
  find(cls: string): FakeElement | undefined {
    return this.all().find((e) => (e.attrs.class ?? '').split(' ').includes(cls));
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

function mount(binding: SliderBinding | null, emptyText?: string | null): FakeElement {
  const root = new FakeElement('div');
  act(() => {
    render(<SliderRow binding={binding} emptyText={emptyText} onChange={() => undefined} onCommit={() => undefined} />, root as unknown as Element);
  });
  return root;
}

const eye = (over: Partial<SliderBinding> = {}): SliderBinding => ({
  key: 'f1:shape.eyeEnlarge',
  param: 'shape.eyeEnlarge',
  label: '大眼',
  bidirectional: false,
  value: 0.2,
  mixed: false,
  defaultValue: 0.2,
  apply: (l) => l.edit,
  ...over,
});

describe('SliderRow and persons (S §2.4)', () => {
  it('no binding, no text: the hidden empty row of v0.3', () => {
    const row = mount(null).find('slider-row')!;
    expect(row.attrs.class).toBe('slider-row empty');
    expect(row.attrs['aria-hidden']).toBe('true');
    expect(row.text).toBe('');
  });
  it('no binding with a text (程度 under 全部 with different presets): a visible row that says it', () => {
    const row = mount(null, '各人不同').find('slider-row')!;
    expect(row.attrs.class).toBe('slider-row empty has-text');
    expect(row.attrs['aria-hidden']).toBeUndefined();
    expect(row.find('slider-empty')?.text).toBe('各人不同');
  });
  it('the aria-label names the target; absent → the label (one person, v0.3)', () => {
    expect(mount(eye({ aria: '大眼，人物 2' })).all().find((e) => e.attrs.role === 'slider')?.attrs['aria-label']).toBe('大眼，人物 2');
    expect(mount(eye()).all().find((e) => e.attrs.role === 'slider')?.attrs['aria-label']).toBe('大眼');
  });
  it('mixed: 「各人不同」 on the label and in the value text', () => {
    const root = mount(eye({ mixed: true, aria: '大眼，全部' }));
    const slider = root.all().find((e) => e.attrs.role === 'slider')!;
    expect(slider.attrs['aria-valuetext']).toBe('20，各人不同');
    expect(root.find('slider-label')?.text).toBe('大眼各人不同');
    expect(root.find('slider-mixed')?.text).toBe('各人不同');
    const plain = mount(eye());
    expect(plain.all().find((e) => e.attrs.role === 'slider')?.attrs['aria-valuetext']).toBe('20');
    expect(plain.find('slider-mixed')).toBeUndefined();
  });
});

describe('SliderRow tints and the default dot (step-2 spec §2.1)', () => {
  const track = (root: FakeElement) => root.find('slider-track')!;
  it('色溫 / 色調 tint the track; every other slider keeps the plain track', () => {
    expect(track(mount(eye({ bidirectional: true, value: 0.5, defaultValue: 0.5, track: 'temperature' }))).attrs.class).toBe(
      'slider-track track-temperature',
    );
    expect(track(mount(eye({ bidirectional: true, value: 0.5, defaultValue: 0.5, track: 'tint' }))).attrs.class).toBe('slider-track track-tint');
    expect(track(mount(eye())).attrs.class).toBe('slider-track');
  });
  it('hideDefault (調節 one-way items: neutral is the default) omits the default dot; otherwise it stays', () => {
    const hidden = mount(eye({ param: 'adjust.grain', value: 0.3, defaultValue: 0, hideDefault: true }));
    expect(hidden.find('slider-def')).toBeUndefined();
    expect(hidden.find('slider-tick')).toBeUndefined();
    expect(mount(eye()).find('slider-def')).toBeDefined();
    // bidirectional sliders keep the centre tick, hideDefault or not
    expect(mount(eye({ bidirectional: true, value: 0.5, defaultValue: 0.5, hideDefault: true })).find('slider-tick')).toBeDefined();
  });
});
