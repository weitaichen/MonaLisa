// BeautyPanel in step 2 (step-2 spec §2.1–2.2, §7): the 一鍵 part row 美顏／質感, the 調節 strip dividers, the
// 「質感：{label}」 lead chip, look thumbnails over the look icon, the haptic on look picks, the failed-look retry and
// no per-person strip note on the photo-level tabs. Mounted with real Preact on a tiny DOM stand-in (vitest runs in
// node), as Slider.test.tsx and HeightBandOverlay.test.tsx do.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, type ComponentChild } from 'preact';
import { act } from 'preact/test-utils';
import { lensFor, NO_FACE_NOTE, type Lens } from '../../edit/lens';
import { defaultPhoto, naturalPerson, neutralPerson } from '../../edit/state';
import type { EditState, LookId, PhotoParams } from '../../types';
import { INITIAL_SELECTION, type PanelSelection } from '../panelModel';

// haptic() is a no-op in node (no HTMLInputElement): spy on it to see which taps buzz
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
  listeners: Record<string, (e: unknown) => unknown> = {};
  // Preact attaches `onClick` as 'click' (its proxy then looks the handler up by e.type) when the property exists
  onclick = null;
  onerror = null;
  scrollLeft = 0;
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
  /** the strip's scroll-into-view effect: nothing to scroll to here */
  querySelector() {
    return null;
  }
  get classes(): string[] {
    return (this.attrs.class ?? '').split(' ');
  }
  get elements(): FakeElement[] {
    return this.childNodes.filter((c): c is FakeElement => c instanceof FakeElement);
  }
  all(): FakeElement[] {
    return [this, ...this.elements.flatMap((c) => c.all())];
  }
  find(cls: string): FakeElement | undefined {
    return this.all().find((e) => e.classes.includes(cls));
  }
  findAll(cls: string): FakeElement[] {
    return this.all().filter((e) => e.classes.includes(cls));
  }
}
const fakeDocument = {
  createElement: (n: string) => new FakeElement(n),
  createElementNS: (_ns: string, n: string) => new FakeElement(n),
  createTextNode: (t: string) => new FakeText(t),
};

type Panel = typeof import('./BeautyPanel').BeautyPanel;
let BeautyPanel: Panel;
let Icon: typeof import('../icons').Icon;
let haptic: ReturnType<typeof vi.fn>;
let saved: unknown;
beforeAll(async () => {
  saved = (globalThis as { document?: unknown }).document;
  (globalThis as { document?: unknown }).document = fakeDocument;
  // the app store (toast) uses window timers
  vi.stubGlobal('window', { setTimeout, clearTimeout });
  ({ BeautyPanel } = await import('./BeautyPanel'));
  ({ Icon } = await import('../icons'));
  haptic = (await import('../platform')).haptic as unknown as ReturnType<typeof vi.fn>;
});
afterAll(() => {
  (globalThis as { document?: unknown }).document = saved;
  vi.unstubAllGlobals();
});
beforeEach(() => {
  haptic.mockClear();
});

const editOf = (photo: Partial<PhotoParams> = {}, persons: readonly string[] = ['p0']): EditState => ({
  v: 2,
  photo: { ...defaultPhoto(), ...photo },
  persons: Object.fromEntries(persons.map((id) => [id, naturalPerson()])),
  template: neutralPerson(),
  primaryInit: null,
});
const lensOf = (e: EditState): Lens => lensFor(e, { kind: 'person', id: 'p0' }, [{ id: 'p0', face: true, body: false }], 'p0');
const sel = (over: Partial<PanelSelection>): PanelSelection => ({ ...INITIAL_SELECTION, ...over });

interface Mounted {
  root: FakeElement;
  strip: FakeElement;
  onSel: ReturnType<typeof vi.fn>;
  onEdit: ReturnType<typeof vi.fn>;
  onRetryLook: ReturnType<typeof vi.fn>;
}
function mount(
  lens: Lens,
  s: PanelSelection,
  extra: { faceNote?: string | null; lookFailed?: (id: LookId) => boolean } = {},
): Mounted {
  const root = new FakeElement('div');
  const onSel = vi.fn();
  const onEdit = vi.fn();
  const onRetryLook = vi.fn();
  act(() => {
    render(
      <BeautyPanel lens={lens} sel={s} onSel={onSel} onEdit={onEdit} onRetryLook={onRetryLook} {...extra} />,
      root as unknown as Element,
    );
  });
  const strip = root.all().find((e) => e.attrs.role === 'listbox')!;
  return { root, strip, onSel, onEdit, onRetryLook };
}
/** the strip, left to right: a button's label, │ for a divider, the chip's text, ¶ for a note */
function sequence(strip: FakeElement): string[] {
  return strip.elements.map((e) => {
    if (e.classes.includes('strip-divider')) return '│';
    if (e.classes.includes('lead-chip')) return `[${e.text}]`;
    if (e.classes.includes('strip-note')) return '¶';
    return e.find('item-label')?.text ?? e.text;
  });
}
const button = (strip: FakeElement, label: string): FakeElement => {
  const b = strip.elements.find((e) => e.localName === 'button' && (e.find('item-label')?.text ?? e.text) === label);
  if (!b) throw new Error(`no ${label} in ${sequence(strip).join(' ')}`);
  return b;
};
function click(el: FakeElement) {
  const fn = el.listeners.click;
  if (!fn) throw new Error(`no click listener on ${el.localName}`);
  act(() => {
    fn.call(el, { type: 'click', currentTarget: el, target: el, preventDefault() {}, stopPropagation() {} });
  });
}
/** an element subtree as a string (tag, attributes, children), to compare icons */
function shape(e: FakeElement): string {
  const a = Object.entries(e.attrs)
    .sort(([x], [y]) => x.localeCompare(y))
    .map(([k, v]) => `${k}=${v}`)
    .join(',');
  return `${e.localName}(${a})[${e.elements.map(shape).join('')}]`;
}
function iconShape(name: string): string {
  const root = new FakeElement('div');
  act(() => {
    render((<Icon name={name} />) as ComponentChild, root as unknown as Element);
  });
  return shape(root.elements[0]);
}

describe('一鍵: the part row 美顏／質感 (step-2 spec §2.2)', () => {
  it('leads the strip like the 美妝 口紅／腮紅 row; 美顏 is the default part and the strip is as before otherwise', () => {
    const { strip } = mount(lensOf(editOf()), sel({ tab: 'preset' }));
    const seq = sequence(strip);
    expect(seq.slice(0, 7)).toEqual(['美顏', '質感', '│', '原圖', '自然', '精緻', '氣色']);
    const beauty = button(strip, '美顏');
    const look = button(strip, '質感');
    expect(beauty.classes).toEqual(expect.arrayContaining(['item', 'part', 'selected']));
    expect(beauty.attrs['aria-pressed']).toBe('true');
    expect(look.attrs['aria-pressed']).toBe('false');
    // 質感 shows the dot only while a look is set; 美顏 never
    expect(look.classes).not.toContain('has-value');
    const withLook = mount(lensOf(editOf({ look: { id: 'film', amount: 0.8 } })), sel({ tab: 'preset' })).strip;
    expect(button(withLook, '質感').classes).toContain('has-value');
    expect(button(withLook, '美顏').classes).not.toContain('has-value');
    // the part buttons wear the parts' icons
    expect(shape(button(strip, '質感').find('item-tile')!.elements[0])).toBe(iconShape('look'));
    expect(shape(button(strip, '美顏').find('item-tile')!.elements[0])).toBe(iconShape('presetGlow'));
  });

  it('a part tap switches the part with a haptic; the active part does nothing', () => {
    const m = mount(lensOf(editOf()), sel({ tab: 'preset' }));
    click(button(m.strip, '質感'));
    expect(m.onSel).toHaveBeenCalledTimes(1);
    expect(m.onSel.mock.calls[0][0]).toMatchObject({ tab: 'preset', presetPart: 'look' });
    expect(haptic).toHaveBeenCalledTimes(1);
    click(button(m.strip, '美顏'));
    expect(m.onSel).toHaveBeenCalledTimes(1);
    expect(haptic).toHaveBeenCalledTimes(1);
  });

  it('美妝 keeps its 口紅／腮紅 row (icons lip / blush)', () => {
    const { strip } = mount(lensOf(editOf()), sel({ tab: 'makeup' }));
    expect(sequence(strip).slice(0, 3)).toEqual(['口紅', '腮紅', '│']);
    expect(shape(button(strip, '口紅').find('item-tile')!.elements[0])).toBe(iconShape('lip'));
  });
});

describe('一鍵 › 質感 items (step-2 spec §2.2, §7)', () => {
  const lookSel = sel({ tab: 'preset', presetPart: 'look' });

  it('無 · 膠片 · CCD · 直閃 · 藍調 · 電影感: thumbnails over the look icon (the filter icon stays for 濾鏡)', () => {
    const { strip } = mount(lensOf(editOf()), lookSel);
    expect(sequence(strip)).toEqual(['美顏', '質感', '│', '無', '膠片', 'CCD', '直閃', '藍調', '電影感']);
    const tile = button(strip, '膠片').find('item-tile')!;
    expect(shape(tile.elements[0])).toBe(iconShape('look'));
    expect(tile.elements[1].localName).toBe('img');
    expect(tile.elements[1].attrs.src).toBe('/luts/looks/look_film_thumb.png');
    expect(shape(button(strip, '無').find('item-tile')!.elements[0])).toBe(iconShape('none'));
    const filters = mount(lensOf(editOf()), sel({ tab: 'filter' })).strip;
    const filterTile = filters.elements.find((e) => e.find('item-tile')?.all().some((x) => x.localName === 'img'))!.find('item-tile')!;
    expect(shape(filterTile.elements[0])).toBe(iconShape('filter'));
  });

  it('a look pick from 無 is one edit at 程度 80 with a haptic', () => {
    const m = mount(lensOf(editOf()), lookSel);
    click(button(m.strip, '膠片'));
    expect(m.onEdit).toHaveBeenCalledTimes(1);
    expect((m.onEdit.mock.calls[0][0] as EditState).photo.look).toEqual({ id: 'film', amount: 0.8 });
    expect(haptic).toHaveBeenCalledTimes(1);
    expect(m.onRetryLook).not.toHaveBeenCalled();
  });

  it('the selected look: a no-op, unless its LUT failed — then the tap retries the load (no edit, no haptic)', () => {
    const lens = lensOf(editOf({ look: { id: 'film', amount: 0.6 } }));
    const ok = mount(lens, lookSel, { lookFailed: () => false });
    click(button(ok.strip, '膠片'));
    expect(ok.onEdit).not.toHaveBeenCalled();
    expect(ok.onRetryLook).not.toHaveBeenCalled();
    const failed = mount(lens, lookSel, { lookFailed: (id) => id === 'film' });
    click(button(failed.strip, '膠片'));
    expect(failed.onRetryLook).toHaveBeenCalledWith('film');
    expect(failed.onEdit).not.toHaveBeenCalled();
    expect(failed.onSel).not.toHaveBeenCalled();
    expect(haptic).not.toHaveBeenCalled();
    // another look still hops (keeping 程度), with no retry
    click(button(failed.strip, 'CCD'));
    expect((failed.onEdit.mock.calls[0][0] as EditState).photo.look).toEqual({ id: 'ccd', amount: 0.6 });
    expect(failed.onRetryLook).toHaveBeenCalledTimes(1);
  });
});

describe('調節 strip (step-2 spec §2.1)', () => {
  it('⊘ 原圖 · light │ colour │ effects', () => {
    const { strip } = mount(lensOf(editOf()), sel({ tab: 'adjust' }));
    expect(sequence(strip)).toEqual(['原圖', '亮度', '曝光', '對比', '高光', '陰影', '│', '色溫', '色調', '飽和', '鮮艷度', '│', '褪色', '顆粒', '暗角']);
    expect(strip.findAll('strip-divider').every((d) => d.attrs['aria-hidden'] === 'true')).toBe(true);
  });

  it('「質感：膠片」 leads the strip while a look is set; a tap opens 一鍵 › 質感', () => {
    const none = mount(lensOf(editOf()), sel({ tab: 'adjust' }));
    expect(none.root.find('lead-chip')).toBeUndefined();
    const m = mount(lensOf(editOf({ look: { id: 'film', amount: 0.8 } })), sel({ tab: 'adjust', adjust: 'adjust.grain' }));
    expect(sequence(m.strip)[0]).toBe('[質感：膠片]');
    const chip = m.strip.find('lead-chip')!;
    expect(chip.localName).toBe('button');
    click(chip);
    expect(m.onSel).toHaveBeenCalledWith({ ...sel({ tab: 'adjust', adjust: 'adjust.grain' }), tab: 'preset', presetPart: 'look' });
    expect(haptic).toHaveBeenCalledTimes(1);
    expect(m.onEdit).not.toHaveBeenCalled();
    // no chip on the other tabs
    expect(mount(lensOf(editOf({ look: { id: 'film', amount: 0.8 } })), sel({ tab: 'skin' })).root.find('lead-chip')).toBeUndefined();
  });

  it('never dimmed by the face note (基本模式, no face); 美型 still is', () => {
    expect(mount(lensOf(editOf()), sel({ tab: 'adjust' }), { faceNote: '未偵測到臉部' }).strip.classes).not.toContain('face-off');
    expect(mount(lensOf(editOf()), sel({ tab: 'preset', presetPart: 'look' }), { faceNote: '未偵測到臉部' }).strip.classes).not.toContain('face-off');
    expect(mount(lensOf(editOf()), sel({ tab: 'shape' }), { faceNote: '未偵測到臉部' }).strip.classes).toContain('face-off');
  });
});

describe('≥ 2 persons: no per-person strip note on the photo-level tabs (step-2 spec §2.2)', () => {
  const persons = [
    { id: 'f0', face: true, body: false },
    { id: 'b0', face: false, body: true },
  ];
  const bodyOnly = () => lensFor(editOf({}, ['f0', 'b0']), { kind: 'person', id: 'b0' }, persons, 'f0');

  it('一鍵 › 美顏 keeps the step-1 note for a body-only person; 一鍵 › 質感 and 調節 show none', () => {
    const beauty = mount(bodyOnly(), sel({ tab: 'preset' })).strip;
    expect(beauty.find('strip-note')?.text).toBe(NO_FACE_NOTE);
    expect(mount(bodyOnly(), sel({ tab: 'preset', presetPart: 'look' })).strip.find('strip-note')).toBeUndefined();
    expect(mount(bodyOnly(), sel({ tab: 'adjust' })).strip.find('strip-note')).toBeUndefined();
  });
});
