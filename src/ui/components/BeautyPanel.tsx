// BeautyPanel (spec §7.3): tab row 一鍵 · 美膚 · 美型 · 濾鏡 · 美妝 over a horizontal item strip.
// The value slider is rendered by the screen (floating in Camera, docked in Editor).
import { useLayoutEffect, useRef } from 'preact/hooks';
import type { BeautyParams } from '../../types';
import { Icon } from '../icons';
import { activate, itemsFor, MAKEUP_PARTS, tabHasValue, TABS, type PanelItem, type PanelSelection, type TabId } from '../panelModel';
import { haptic } from '../platform';

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
  id?: string;
}

/** tabs whose effects need a detected face */
export const FACE_TABS: readonly TabId[] = ['shape', 'makeup'];

export function BeautyPanel({ params, sel, onSel, onParams, collapsed, faceNote, id }: Props) {
  const stripRef = useRef<HTMLDivElement>(null);
  const stripKey = sel.tab === 'makeup' ? `makeup.${sel.makeupPart}` : sel.tab;

  // new tab → start of strip, then bring the selected item into view
  useLayoutEffect(() => {
    const strip = stripRef.current;
    if (!strip) return;
    strip.scrollLeft = 0;
    const selected = strip.querySelector<HTMLElement>('.item.selected:not(.part)');
    if (selected && selected.offsetLeft + selected.offsetWidth > strip.clientWidth) {
      strip.scrollLeft = selected.offsetLeft - strip.clientWidth / 2 + selected.offsetWidth / 2;
    }
  }, [stripKey]);

  const items = itemsFor(params, sel);
  const faceOff = !!faceNote && FACE_TABS.includes(sel.tab);

  const tapItem = (item: PanelItem) => {
    const r = activate(item, params, sel);
    if (!r.changed) return;
    if (item.action.type === 'preset' || item.action.type === 'reset') haptic();
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
              aria-disabled={faceOff ? 'true' : undefined}
              class={`item${item.selected ? ' selected' : ''}${item.hasValue ? ' has-value' : ''}`}
              onClick={() => tapItem(item)}
            >
              <span class="item-tile">
                <ItemVisual item={item} />
              </span>
              <span class="item-label">{item.label}</span>
              <span class="item-dot" />
            </button>
          ))}
        </div>
        <div class="tabs" role="tablist">
          {TABS.map((t) => {
            // stays tappable: a remembered selection may already be on it
            const unavailable = !!faceNote && FACE_TABS.includes(t.id);
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={sel.tab === t.id}
                aria-description={unavailable ? faceNote ?? undefined : undefined}
                class={`tab${sel.tab === t.id ? ' active' : ''}${unavailable ? ' unavailable' : ''}`}
                onClick={() => tapTab(t.id)}
              >
                <span class="tab-label">
                  {t.label}
                  {!unavailable && tabHasValue(params, t.id) && <i class="tab-dot" aria-hidden="true" />}
                </span>
              </button>
            );
          })}
        </div>
      </div>
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
