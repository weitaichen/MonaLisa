// BeautyPanel in step 2 (step-2 spec §2.1–2.2, §7): the 一鍵 part row 美顏／質感, the 調節 strip dividers, the
// 「質感：{label}」 lead chip, look thumbnails over the look icon, the haptic on look picks, the failed-look retry and
// no per-person strip note on the photo-level tabs. Mounted with real Preact on a tiny DOM stand-in (vitest runs in
// node), as Slider.test.tsx and HeightBandOverlay.test.tsx do.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, type ComponentChild } from 'preact';
import { act } from 'preact/test-utils';
import { lensFor, NO_FACE_NOTE, type Lens } from '../../edit/lens';
import { defaultPhoto, naturalPerson, neutralPerson } from '../../edit/state';
import { IDENTITY_GEOMETRY, rotateLeft, type CropLock } from '../../geometry/view';
import type { EditState, Geometry, LookId, PhotoParams, Size } from '../../types';
import type { CropAction } from '../cropPanel';
import { TONE_COPY } from '../../edit/toneCopy';
import { CAMERA_BODY, INITIAL_SELECTION, type BodyContext, type PanelSelection, type SkinPanelContext } from '../panelModel';

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
  extra: {
    faceNote?: string | null;
    lookFailed?: (id: LookId) => boolean;
    crop?: { geometry: Geometry; lock: CropLock; oSize: Size; onAction(a: CropAction): void };
    skin?: SkinPanelContext;
    body?: BodyContext;
    collapsed?: boolean;
  } = {},
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

  it('美妝 has no part row', () => {
    const { strip } = mount(lensOf(editOf()), sel({ tab: 'makeup' }));
    expect(sequence(strip).slice(0, 2)).toEqual(['無', '原色']);
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

describe('裁切 (v0.4 step 3, S §2.1)', () => {
  const O = { width: 1536, height: 2048 };
  const cropOf = (geometry: Geometry = IDENTITY_GEOMETRY, lock: CropLock = 'free') => ({ geometry, lock, oSize: O, onAction: vi.fn() });
  const tabs = (root: FakeElement) => root.all().filter((e) => e.attrs.role === 'tab');
  const tabLabels = (root: FakeElement) => tabs(root).map((e) => e.find('tab-label')!.text);
  const cropSel = sel({ tab: 'crop' });

  it('the tab is listed only with the crop prop: 8 editor tabs with 裁切 last, the camera keeps 7', () => {
    expect(tabLabels(mount(lensOf(editOf()), sel({})).root)).toEqual(['一鍵', '美膚', '美型', '美體', '濾鏡', '美妝', '調節']);
    expect(tabLabels(mount(lensOf(editOf()), sel({}), { crop: cropOf() }).root)).toEqual(['一鍵', '美膚', '美型', '美體', '濾鏡', '美妝', '調節', '裁切']);
  });

  it('strip: 自由 · 原比例 · 1:1 · 3:4 · 4:3 · 9:16 · 16:9 │ 旋轉 · 翻轉 · 還原; the lock is selected, 還原 dimmed at identity', () => {
    const { strip } = mount(lensOf(editOf()), cropSel, { crop: cropOf(IDENTITY_GEOMETRY, '1:1') });
    expect(sequence(strip)).toEqual(['自由', '原比例', '1:1', '3:4', '4:3', '9:16', '16:9', '│', '旋轉', '翻轉', '還原']);
    expect(button(strip, '1:1').attrs['aria-selected']).toBe('true');
    expect(button(strip, '自由').attrs['aria-selected']).toBe('false');
    expect(button(strip, '還原').attrs['aria-disabled']).toBe('true');
    expect(button(strip, '旋轉').attrs['aria-disabled']).toBeUndefined();
    const turned = mount(lensOf(editOf()), cropSel, { crop: cropOf(rotateLeft(IDENTITY_GEOMETRY)) }).strip;
    expect(button(turned, '還原').attrs['aria-disabled']).toBeUndefined();
  });

  it('icons: 自由 is the dashed free square, a ratio a rectangle of its aspect, 旋轉 / 翻轉 / 還原 their own', () => {
    const { strip } = mount(lensOf(editOf()), cropSel, { crop: cropOf() });
    const svg = (label: string) => button(strip, label).find('item-tile')!.elements[0];
    expect(shape(svg('自由'))).toBe(iconShape('free'));
    expect(shape(svg('旋轉'))).toBe(iconShape('rotateLeft'));
    expect(shape(svg('翻轉'))).toBe(iconShape('flipH'));
    expect(shape(svg('還原'))).toBe(iconShape('reset'));
    // each is its own drawing, not the fallback
    for (const name of ['free', 'rotateLeft', 'flipH']) expect(iconShape(name), name).not.toBe(iconShape('none'));
    const rect = (label: string) => svg(label).elements[0];
    expect([rect('1:1').attrs.width, rect('1:1').attrs.height]).toEqual(['16', '16']);
    expect([rect('16:9').attrs.width, rect('16:9').attrs.height]).toEqual(['16', '9']);
    expect([rect('3:4').attrs.width, rect('3:4').attrs.height]).toEqual(['12', '16']);
  });

  it('a tap sends its crop action with a haptic (never onEdit / onSel); the dimmed 還原 does nothing', () => {
    const crop = cropOf();
    const m = mount(lensOf(editOf()), cropSel, { crop });
    click(button(m.strip, '1:1'));
    click(button(m.strip, '旋轉'));
    click(button(m.strip, '還原'));
    expect(crop.onAction.mock.calls.map((c) => c[0])).toEqual([{ type: 'ratio', lock: '1:1' }, { type: 'rotate' }]);
    expect(haptic).toHaveBeenCalledTimes(2);
    expect(m.onEdit).not.toHaveBeenCalled();
    expect(m.onSel).not.toHaveBeenCalled();
  });

  it('the 裁切 tab dot shows while the geometry is not identity', () => {
    const dot = (g: Geometry) => !!tabs(mount(lensOf(editOf()), sel({}), { crop: cropOf(g) }).root).at(-1)!.find('tab-dot');
    expect(dot(IDENTITY_GEOMETRY)).toBe(false);
    expect(dot(rotateLeft(IDENTITY_GEOMETRY))).toBe(true);
  });
});

describe('美膚 tone notes (skin-cleanup spec §2.2): above the strip, outside the scroller', () => {
  const skin = (extra: Partial<SkinPanelContext> = {}): SkinPanelContext => ({
    answer: 'faces',
    mouthClosed: false,
    eyesClosed: false,
    spots: { inScope: 0, total: 0, onePerson: false },
    ...extra,
  });
  const toneSel = (id: string) => sel({ tab: 'skin', skin: id as PanelSelection['skin'] });
  /** the .panel-inner children, in order: ¶ for the tone note, ▤ for the strip, ▭ for the tab row */
  const layout = (root: FakeElement): string[] =>
    root.find('panel-inner')!.elements.map((e) => (e.classes.includes('skin-note') ? '¶' : e.attrs.role === 'listbox' ? '▤' : e.classes.includes('tabs') ? '▭' : e.localName));

  it('白牙 with the mouth closed, 亮眼 with the eyes closed, a disabled selection: the note precedes the strip, never in it', () => {
    const cases: [string, SkinPanelContext, string][] = [
      ['tone.teeth', skin({ mouthClosed: true }), TONE_COPY.mouthClosed],
      ['tone.eyeBright', skin({ eyesClosed: true }), TONE_COPY.eyesClosed],
      ['tone.even', skin({ answer: 'basic' }), TONE_COPY.basic],
    ];
    for (const [id, ctx, text] of cases) {
      const m = mount(lensOf(editOf()), toneSel(id), { skin: ctx });
      expect(layout(m.root), id).toEqual(['¶', '▤', '▭']);
      const note = m.root.find('skin-note')!;
      expect(note.text, id).toBe(text);
      expect(note.attrs.role).toBe('status');
      // the strip is exactly as without a note: nothing is inserted ahead of the tiles, so they do not shift
      expect(m.strip.find('skin-note'), id).toBeUndefined();
      expect(m.strip.find('strip-note'), id).toBeUndefined();
      expect(sequence(m.strip), id).toEqual(sequence(mount(lensOf(editOf()), toneSel(id), { skin: skin() }).strip));
    }
  });

  it('no note: 白牙 with an open mouth, 磨皮, the camera (no skin context), a collapsed panel', () => {
    const none = (s: PanelSelection, extra: Parameters<typeof mount>[2]) => mount(lensOf(editOf()), s, extra).root.find('skin-note');
    expect(none(toneSel('tone.teeth'), { skin: skin() })).toBeUndefined();
    expect(none(toneSel('skin.smooth'), { skin: skin({ answer: 'basic', mouthClosed: true }) })).toBeUndefined();
    expect(none(toneSel('tone.teeth'), {})).toBeUndefined();
    expect(none(toneSel('tone.teeth'), { skin: skin({ mouthClosed: true }), collapsed: true })).toBeUndefined();
  });

  it('美體 keeps its note at the head of the strip', () => {
    const m = mount(lensOf(editOf()), sel({ tab: 'body' }), { body: CAMERA_BODY });
    expect(layout(m.root)).toEqual(['▤', '▭']);
    expect(sequence(m.strip)[0]).toBe('¶');
    expect(m.strip.find('body-note')).toBeDefined();
  });

  it('the 美膚 tab dot lights for the photo’s spots alone (S §2.1)', () => {
    const neutral: EditState = { ...editOf({ values: { ...defaultPhoto().values, 'skin.whiten': 0, 'skin.sharpen': 0 } }), persons: { p0: neutralPerson() } };
    const dot = (total: number) => {
      const tab = mount(lensOf(neutral), sel({}), { skin: skin({ spots: { inScope: 0, total, onePerson: false } }) })
        .root.all()
        .filter((e) => e.attrs.role === 'tab')
        .find((e) => e.find('tab-label')!.text.startsWith('美膚'))!;
      return !!tab.find('tab-dot');
    };
    expect(dot(0)).toBe(false);
    expect(dot(2)).toBe(true);
  });
});
