// BeautyPanel (spec §7.3): tab row 一鍵 · 美膚 · 美型 · 美體 · 濾鏡 · 美妝 · 調節 (the editor adds 裁切, v0.4 step 3) over a
// horizontal item strip. The value slider (and the 增高 band overlay) are rendered by the screen (floating in Camera,
// docked in Editor).
import { Fragment } from 'preact';
import { useLayoutEffect, useRef } from 'preact/hooks';
import type { Lens } from '../../edit/lens';
import { isIdentity, type CropLock } from '../../geometry/view';
import type { EditState, Geometry, LookId, Size } from '../../types';
import { cropItems, type CropAction } from '../cropPanel';
import { Icon } from '../icons';
import {
  activate,
  bodyNoteFor,
  EDITOR_TABS,
  itemsFor,
  leadChip,
  partButtons,
  partHasValue,
  personNote,
  photoTabLabel,
  selectPart,
  skinNote,
  tabHasValue,
  TABS,
  tapToast,
  type BodyContext,
  type BodyNote,
  type PanelItem,
  type PanelSelection,
  type SkinPanelContext,
  type TabId,
} from '../panelModel';
import { haptic } from '../platform';
import { toast } from '../state';

interface Props {
  lens: Lens;
  sel: PanelSelection;
  onSel(sel: PanelSelection): void;
  /** a tap-level change (always an undo step) */
  onEdit(edit: EditState): void;
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
  /**
   * the photo-level items already touched in this editor (shared with its slider toasts): the first tap of a 濾鏡 tile or
   * 背景保護 adds 「{label}套用於整張照片」 (S §2.4). Omitted (the camera) → no first-touch toast
   */
  photoTouched?: Set<string>;
  /** the 質感 LUT of this look failed to load (a re-tap of the selected look then retries it) */
  lookFailed?: (id: LookId) => boolean;
  /** the tapped look is selected but its LUT failed to load: retry it (step-2 spec §2.2; no edit, no undo step) */
  onRetryLook?(id: LookId): void;
  /** the editor's 裁切 tab (absent in the camera: the tab is not listed) */
  crop?: { geometry: Geometry; lock: CropLock; oSize: Size; onAction(a: CropAction): void };
  /** 膚質 context; the editor passes it, the camera never does */
  skin?: SkinPanelContext;
  id?: string;
}

/** tabs whose effects need a detected face */
export const FACE_TABS: readonly TabId[] = ['shape', 'makeup'];

export function BeautyPanel({ lens, sel, onSel, onEdit, collapsed, faceNote, body, photoTouched, lookFailed, onRetryLook, crop, skin, id }: Props) {
  const stripRef = useRef<HTMLDivElement>(null);
  const stripKey =
    sel.tab === 'makeup' ? `makeup.${sel.makeupPart}` : sel.tab === 'preset' ? `preset.${sel.presetPart}` : sel.tab;

  // new tab → start of strip, then bring the selected item into view
  useLayoutEffect(() => {
    const strip = stripRef.current;
    if (!strip) return;
    strip.scrollLeft = 0;
    // a 美體 note (download progress, no person, a person without a body, the bands note…) leads the strip: keep it in view
    if (strip.querySelector('.body-note')) return;
    const selected = strip.querySelector<HTMLElement>('.item.selected:not(.part)');
    if (selected && selected.offsetLeft + selected.offsetWidth > strip.clientWidth) {
      strip.scrollLeft = selected.offsetLeft - strip.clientWidth / 2 + selected.offsetWidth / 2;
    }
  }, [stripKey]);

  const tabs = crop ? EDITOR_TABS : TABS;
  const items = sel.tab === 'crop' && crop ? cropItems(crop.geometry, crop.lock, crop.oSize) : itemsFor(lens, sel, body, skin);
  const look = lens.look();
  const parts = partButtons(sel, { makeupOn: (p) => partHasValue(lens, p), look });
  const lead = leadChip(sel, look);
  // photo-level face note (no face, 基本模式, tracker health) first; then the selected person's (S §2.4, U5);
  // 調節 and 一鍵 › 質感 act on the whole photo: no per-person strip note (step-2 spec §2.2)
  const pNote = photoTabLabel(sel) ? null : personNote(sel.tab, lens);
  const offText = faceNote ?? (pNote?.dim ? pNote.text : null);
  const faceOff = !!offText && FACE_TABS.includes(sel.tab);
  const infoNote = !faceOff && pNote && !pNote.dim ? pNote.text : null;
  // 美膚: a tone item's note (why it is off, or the closed-mouth / closed-eye hint; skin-cleanup spec §2.2)
  const note = sel.tab === 'body' ? bodyNoteFor(body, lens, sel) : sel.tab === 'skin' ? skinNote(lens, sel, skin) : null;
  const bodyOff = body?.status === 'unsupported';

  const tapItem = (item: PanelItem) => {
    // 裁切: the Editor applies it (cropActivate needs the O size; the ratio lock is its UI state)
    if (item.action.type === 'crop') {
      if (item.disabled || !crop) return;
      haptic();
      crop.onAction(item.action.crop);
      return;
    }
    const r = activate(item, lens, sel, { lookFailed });
    const text = tapToast(item, lens, r, photoTouched);
    // a notice keeps its longer stay; the first-touch line alone stays as long as the slider's (toast's default)
    if (text) toast(text, r.notice ? (item.disabled ? 2600 : 3200) : undefined);
    if (r.retryLook) onRetryLook?.(r.retryLook);
    if (!r.changed) return;
    const a = item.action.type;
    if (a === 'preset' || a === 'reset' || a === 'protect' || a === 'look') haptic();
    if (r.sel !== sel) onSel(r.sel);
    if (r.edit !== lens.edit) onEdit(r.edit);
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
              {offText}
            </p>
          )}
          {infoNote && (
            <p class="strip-note" role="note">
              {infoNote}
            </p>
          )}
          {note && <StripBodyNote note={note} />}
          {parts && (
            <>
              {parts.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  class={`item part${p.active ? ' selected' : ''}${p.hasValue ? ' has-value' : ''}`}
                  aria-pressed={p.active}
                  onClick={() => {
                    if (p.active) return;
                    haptic();
                    onSel(selectPart(sel, p.id));
                  }}
                >
                  <span class="item-tile">
                    <Icon name={p.icon} />
                  </span>
                  <span class="item-label">{p.label}</span>
                  <span class="item-dot" />
                </button>
              ))}
              <span class="strip-divider" />
            </>
          )}
          {lead && (
            <button
              type="button"
              class="lead-chip"
              onClick={() => {
                haptic();
                onSel(lead.target);
              }}
            >
              {lead.label}
            </button>
          )}
          {items.map((item) => (
            <Fragment key={`${stripKey}:${item.key}`}>
              {item.divider === 'before' && <span class="strip-divider" aria-hidden="true" />}
              <button
                type="button"
                role="option"
                aria-selected={item.selected}
                aria-disabled={faceOff || item.disabled ? 'true' : undefined}
                aria-pressed={item.pressed}
                aria-description={item.disabled ? (item.reason ?? undefined) : item.badge ? '整張照片' : undefined}
                class={`item${item.selected ? ' selected' : ''}${item.hasValue ? ' has-value' : ''}${item.disabled ? ' disabled' : ''}${
                  item.pressed === undefined ? '' : item.pressed ? ' switchable on' : ' switchable'
                }`}
                onClick={() => tapItem(item)}
              >
                <span class="item-tile">
                  <ItemVisual item={item} />
                  {item.pressed !== undefined && <i class="item-switch" aria-hidden="true" />}
                  {item.badge && (
                    <span class="item-badge" aria-hidden="true">
                      {item.badge}
                    </span>
                  )}
                </span>
                <span class="item-label">{item.label}</span>
                <span class="item-dot" />
              </button>
            </Fragment>
          ))}
        </div>
        <div class="tabs" role="tablist">
          {tabs.map((t) => {
            // stays tappable: a remembered selection may already be on it
            const unavailable = t.id === 'body' ? bodyOff : (!!faceNote || personNote(t.id, lens)?.dim === true) && FACE_TABS.includes(t.id);
            const why = t.id === 'body' ? bodyNoteFor(body, lens, sel)?.text : (faceNote ?? personNote(t.id, lens)?.text);
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
                  {!unavailable && (t.id === 'crop' ? !!crop && !isIdentity(crop.geometry) : tabHasValue(lens, t.id, body)) && (
                    <i class="tab-dot" aria-hidden="true" />
                  )}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/**
 * 美體 note at the head of the strip: download progress, no person / failure (+ 重試), camera note; with ≥ 2 persons the
 * selected person without a body, or the bands / 長腿 anchor note (S §2.4).
 */
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
  if (v.kind === 'thumb') return <Thumb src={v.src} fallback={v.fallback ?? 'filter'} />;
  if (v.kind === 'swatch')
    return <span class={`swatch${v.color ? '' : ' orig'}`} style={v.color ? { background: v.color } : undefined} />;
  if (v.kind === 'ratio') return <RatioIcon aspect={v.aspect} />;
  return <Icon name={v.icon} />;
}

/** a rectangle drawn with the ratio's aspect; 自由 is the dashed-square `free` icon */
function RatioIcon({ aspect }: { aspect: number | null }) {
  if (aspect === null) return <Icon name="free" />;
  const w = aspect >= 1 ? 16 : 16 * aspect;
  const h = aspect >= 1 ? 16 / aspect : 16;
  return (
    <svg class="icon" width={24} height={24} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width={1.75} aria-hidden="true" focusable="false">
      <rect x={12 - w / 2} y={12 - h / 2} width={w} height={h} rx={1.5} />
    </svg>
  );
}

/** Thumbnail over an icon (the filter icon, or the look icon), so a missing PNG degrades to the icon instead of a hole. */
function Thumb({ src, fallback }: { src: string; fallback: string }) {
  return (
    <>
      <Icon name={fallback} />
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
