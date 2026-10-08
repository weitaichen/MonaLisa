// BeautyPanel (spec §7.3): tab row 一鍵 · 美膚 · 美型 · 美體 · 濾鏡 · 美妝 over a horizontal item strip.
// The value slider (and the 增高 band overlay) are rendered by the screen (floating in Camera, docked in Editor).
import { useLayoutEffect, useRef } from 'preact/hooks';
import type { BeautyParams } from '../../types';
import { Icon } from '../icons';
import {
  activate,
  bodyNote,
  itemsFor,
  MAKEUP_PARTS,
  tabHasValue,
  TABS,
  type BodyContext,
  type BodyNote,
  type PanelItem,
  type PanelSelection,
  type TabId,
} from '../panelModel';
import { haptic } from '../platform';
import { toast } from '../state';

interface Props {
  params: BeautyParams;
  sel: PanelSelection;
  onSel(sel: PanelSelection): void;
  /** a tap-level change (always an undo step) */
  onParams(params: BeautyParams): void;
  collapsed?: boolean;
  /**
   * Set when face effects cannot apply (基本模式, or a photo with no face): 美型 / 美妝 are dimmed with this
   * note. Values are kept untouched (they apply once a face / the full engine is back). null → available.
   */
  faceNote?: string | null;
  /**
   * 美體 detection state for the 美體 tab (Editor: idle → loading → ready / none / error; Camera: CAMERA_BODY).
   * Omitted → 'idle' (sliders wait, 增高 / 背景保護 work).
   */
  body?: BodyContext;
  id?: string;
}

/** tabs whose effects need a detected face */
export const FACE_TABS: readonly TabId[] = ['shape', 'makeup'];

export function BeautyPanel({ params, sel, onSel, onParams, collapsed, faceNote, body, id }: Props) {
  const stripRef = useRef<HTMLDivElement>(null);
  const stripKey = sel.tab === 'makeup' ? `makeup.${sel.makeupPart}` : sel.tab;

  // new tab → start of strip, then bring the selected item into view
  useLayoutEffect(() => {
    const strip = stripRef.current;
    if (!strip) return;
    strip.scrollLeft = 0;
    // a 美體 note (download progress, no person, ≥ 2 people…) leads the strip: keep it in view
    if (strip.querySelector('.body-note')) return;
    const selected = strip.querySelector<HTMLElement>('.item.selected:not(.part)');
    if (selected && selected.offsetLeft + selected.offsetWidth > strip.clientWidth) {
      strip.scrollLeft = selected.offsetLeft - strip.clientWidth / 2 + selected.offsetWidth / 2;
    }
  }, [stripKey]);

  const items = itemsFor(params, sel, body);
  const faceOff = !!faceNote && FACE_TABS.includes(sel.tab);
  const note = sel.tab === 'body' ? bodyNote(body) : null;
  const bodyOff = body?.status === 'unsupported';

  const tapItem = (item: PanelItem) => {
    const r = activate(item, params, sel);
    if (r.notice) toast(r.notice, item.disabled ? 2600 : 3200);
    if (!r.changed) return;
    const a = item.action.type;
    if (a === 'preset' || a === 'reset' || a === 'protect') haptic();
    if (r.sel !== sel) onSel(r.sel);
    if (r.params !== params) onParams(r.params);
  };

  const tapTab = (tab: TabId) => {
    if (tab === sel.tab) return;
    haptic();
    onSel({ ...sel, tab });
  };

  return (
    <div id={id} class={`panel${collapsed ? ' collapsed' : ''}`} aria-hidden={collapsed ? 'true' : undefined} inert={collapsed}>
      <div class="panel-inner">
        <div class={`strip${faceOff ? ' face-off' : ''}`} ref={stripRef} role="listbox" aria-label="效果">
          {faceOff && (
            <p class="strip-note" role="note" id="face-note">
              {faceNote}
            </p>
          )}
          {note && <StripBodyNote note={note} />}
          {sel.tab === 'makeup' && (
            <>
              {MAKEUP_PARTS.map((p) => {
                const on = params.values[p.id === 'lip' ? 'makeup.lip' : 'makeup.blush'] > 0.01;
                const active = sel.makeupPart === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    class={`item part${active ? ' selected' : ''}${on ? ' has-value' : ''}`}
                    aria-pressed={active}
                    onClick={() => {
                      if (active) return;
                      haptic();
                      onSel({ ...sel, makeupPart: p.id });
                    }}
                  >
                    <span class="item-tile">
                      <Icon name={p.id} />
                    </span>
                    <span class="item-label">{p.label}</span>
                    <span class="item-dot" />
                  </button>
                );
              })}
              <span class="strip-divider" />
            </>
          )}
          {items.map((item) => (
            <button
              key={`${stripKey}:${item.key}`}
              type="button"
              role="option"
              aria-selected={item.selected}
              aria-disabled={faceOff || item.disabled ? 'true' : undefined}
              aria-pressed={item.pressed}
              aria-description={item.disabled ? (item.reason ?? undefined) : undefined}
              class={`item${item.selected ? ' selected' : ''}${item.hasValue ? ' has-value' : ''}${item.disabled ? ' disabled' : ''}${
                item.pressed === undefined ? '' : item.pressed ? ' switchable on' : ' switchable'
              }`}
              onClick={() => tapItem(item)}
            >
              <span class="item-tile">
                <ItemVisual item={item} />
                {item.pressed !== undefined && <i class="item-switch" aria-hidden="true" />}
              </span>
              <span class="item-label">{item.label}</span>
              <span class="item-dot" />
            </button>
          ))}
        </div>
        <div class="tabs" role="tablist">
          {TABS.map((t) => {
            // stays tappable: a remembered selection may already be on it
            const unavailable = t.id === 'body' ? bodyOff : !!faceNote && FACE_TABS.includes(t.id);
            const why = t.id === 'body' ? bodyNote(body)?.text : faceNote;
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={sel.tab === t.id}
                aria-description={unavailable ? (why ?? undefined) : undefined}
                class={`tab${sel.tab === t.id ? ' active' : ''}${unavailable ? ' unavailable' : ''}`}
                onClick={() => tapTab(t.id)}
              >
                <span class="tab-label">
                  {t.label}
                  {!unavailable && tabHasValue(params, t.id, body) && <i class="tab-dot" aria-hidden="true" />}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** 美體 status at the head of the strip: download progress, no person / failure (+ 重試), multi-person hint, camera note. */
function StripBodyNote({ note }: { note: BodyNote }) {
  const p = note.progress;
  return (
    <div class={`strip-note body-note ${note.tone}`} role="status" aria-live="polite">
      <span class="body-note-text num">
        {/* one clause per line: CJK would otherwise wrap mid-word in the narrow note */}
        {note.text.split('，').map((part, i, all) => (
          <span key={i}>{i < all.length - 1 ? `${part}，` : part}</span>
        ))}
      </span>
      {p !== undefined && (
        <span class={`body-note-bar${p === 'indeterminate' ? ' indeterminate' : ''}`} aria-hidden="true">
          <i style={p === 'indeterminate' ? undefined : { width: `${Math.round(p * 100)}%` }} />
        </span>
      )}
      {note.action && (
        <button
          type="button"
          class="body-note-action"
          onClick={() => {
            haptic();
            note.action?.run();
          }}
        >
          {note.action.label}
        </button>
      )}
    </div>
  );
}

function ItemVisual({ item }: { item: PanelItem }) {
  const v = item.visual;
  if (v.kind === 'thumb') return <Thumb src={v.src} />;
  if (v.kind === 'swatch')
    return <span class={`swatch${v.color ? '' : ' orig'}`} style={v.color ? { background: v.color } : undefined} />;
  return <Icon name={v.icon} />;
}

/** Filter thumbnail over the filter icon, so a missing PNG degrades to the icon instead of a hole. */
function Thumb({ src }: { src: string }) {
  return (
    <>
      <Icon name="filter" />
      <img
        src={src}
        alt=""
        draggable={false}
        decoding="async"
        onError={(e) => {
          (e.currentTarget as HTMLImageElement).style.display = 'none';
        }}
      />
    </>
  );
}
