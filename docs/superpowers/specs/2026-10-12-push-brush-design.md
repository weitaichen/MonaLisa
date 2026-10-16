# Mona Misa 美顏 v0.4 step 6: 推臉筆＋恢復筆 (manual liquify) design

- **Date:** 2026-10-12
- **Status:** proposal for the user's review. The real choices are listed in §11.
- **Base:** `feat/meiyan-pwa` at `892ea61` (v0.3.0). Line anchors are at that commit unless marked "after step N".
- **Builds on:** the v0.4 architecture contract [`2026-10-12-v04-roadmap.md`](2026-10-12-v04-roadmap.md) (called **C** below; §C2.3, §C3.1–3.5, §C4.2, §C4.4, §C4.6, §C4.7, §C5.3 are the parts this spec details), the 選臉／選人 spec [`2026-10-12-face-person-select-design.md`](2026-10-12-face-person-select-design.md) (**PS**, per-person model), `reports/醒圖 功能差距分析.md` (**GAP**) and its notes, `reports/全身美體修圖 PWA 實作.md` (**BR**).
- **Ships in:** the single 0.4.0 release, as step 6 of 6 (§C1.2). No version bump in this step.
- **Numbers marked "measured"** come from a CPU simulation of exactly the stamp operators in §4.2–4.3 (3:4 frame, 384 × 512 grid, 中 brush at zoom 1 = 28.7 texels). The step-6 unit tests (§8.1) pin the same numbers.

## 摘要（繁體中文）

在「美型」或「美體」分頁點「推臉筆」，就能用單指直接推動臉或身體，雙指照常縮放和移動畫面。底下可以切換「推／恢復」，筆刷有「小／中／大」三種大小，還有「全部清除」。
推出去的筆畫會連同照片存進「最近編輯」，重新開檔一樣在。每一筆（手指按下到放開）是一個復原步驟，↶ ↷ 都能用。
筆畫套在所有自動美型、美體效果的「最上層」，也就是你推的就是你看到的畫面；恢復筆只會擦掉推臉筆的效果，不會動到滑桿的效果。
引擎仍然只對原圖取樣一次。推動時每一小步都會檢查，畫面拉伸到上限時效果會自動停住，不會摺疊或破圖；在同一個起點反覆推，第二、三次之後就推不動，要從更後面開始推或換大筆刷。
背景保護目前不套用到推臉筆：筆刷底下的東西都會跟著動，推歪的背景可以用恢復筆擦回來。這點和醒圖的做法不同，請在 §11 決定。

---

## 1. Goal and user-visible behaviour

### 1.1 Why

GAP ranks manual liquify P2: 醒圖 users single out 推臉筆 as a reason they like the app (GAP §摘要; `xingtu_product.md:105, 138`). Hypic users complain that manual tools moved behind the Pro paywall (GAP §摘要), so a free, on-device brush is a selling point. The documented 醒圖 workflow is 「選『推脸』往內推、可選『小号画笔』，推過頭用『恢复笔』塗抹還原；也可以用來推身體」 (`research_notes/醒圖 功能差距分析/xingtu_portrait.md:61`). That gives four expectations this design meets:

1. one tool for face **and** body;
2. a push mode and a restore mode;
3. a choice of brush size;
4. restore is a brush you smear over the overshoot, not a global undo.

v0.3 has no manual liquify (`monalisa_inventory.md:216`). The displacement-texture contract that BR §管線 set up (`reshape.ts:286-290`: the 美體 field is already the outermost backward map) is the hook this step uses.

### 1.2 What the user does

1. In 美型 or 美體, tap **推臉筆** at the end of the strip (§C2.1). The editor enters brush mode:
   - the slider row is replaced by the brush bar (§2.2);
   - face boxes hide, and the person strip dims with the caption 「整張照片」 (strokes are photo-level, §C3.1);
   - a hint pill 「單指推動，雙指縮放」 shows over the canvas for 2.5 s.
2. **One finger drags:** the content under the brush follows the finger at about ¾ of its speed for short drags and fades out towards the ring's edge. One stroke moves content at most about two brush radii; a longer drag leaves content behind. The canvas updates on every frame while the finger moves.
3. **Two fingers** pinch-zoom and pan, exactly as outside the mode. They never draw. Zooming in makes the brush finer in image terms, because the brush size is a screen size.
4. Switching to **恢復** and smearing over an area brings the 推臉筆 effect there back towards none. One pass over the pushed area removes about 90 % of it, a second pass about 98 %. After a few more passes the area is exactly the slider-only image again (§4.2).
5. **↶** undoes the whole last stroke (finger down to finger up), and **↷** redoes it. Changing 推／恢復 or the size is not an undo step.
6. **全部清除** removes every stroke. It needs a second tap within 3 s (「確定清除？」, the 重置 pattern from `Editor.tsx:756-769`) and is one undo step.
7. Leaving the mode means tapping any other strip item or tab. Strokes stay applied on every tab, in 儲存, in the thumbnail and in 「最近編輯」. A reopened photo shows the same strokes, and ↶ starts from that state.
8. **The brush resists** when an area is stretched to the limit (§4.3): the stamp is weakened or skipped and the ring dims while it does. In practice this happens when the user pushes from the same starting point again and again; starting the next push further back, or with a larger brush, moves the content further.

### 1.3 What it is not (v0.4)

- The brush has no strength slider, no bloat or pucker, no twirl and no freeze mask. There are no symmetric face strokes and no pressure.
- The brush is not limited by 背景保護 or by other persons (§4.5, §11 Q1).
- 恢復 never reverts the automatic 美型 or 美體 warps (§C11 Q2 default, §4.5).
- The brush is not in the live camera (`live: false`, §C2.4).

---

## 2. UI

### 2.1 Entry points (strips)

| Tab | Item | Position | Gating |
|---|---|---|---|
| 美型 | 推臉筆 (icon `brush`, our own 1.5–2 px stroke SVG in `src/ui/icons.tsx`, DS §7.1) | Last, after 左右分開 (§C2.1) | **Never gated.** It stays enabled with no face, in 基本模式, and while the face note dims the rest of the strip. `BeautyPanel.tsx:63` (`faceOff`) exempts this item, and the Editor shows the brush bar even when `faceOff` (`Editor.tsx:797, 865`). |
| 美體 | 推臉筆 (same icon) | Last, after 背景保護 (§C2.1) | **Never gated** by `bodyGate` (`panelModel.ts:153-172`). It works while 美體 is loading, finds nobody, or has failed. |

- The item shows the 4 px has-value dot when `photo.strokes.length > 0`. Tab dots do not count strokes, so a tab dot keeps meaning "a slider item here has a value".
- `PanelSelection` (`panelModel.ts:41-47`) gains `shape: ParamId | 'brush'` and `body: BodySel | 'brush'` (`BodySel`, `panelModel.ts:25`). `ItemAction` gains `{ type: 'brush' }`. `showsBrush(sel)` mirrors `showsHeightBand` (`panelModel.ts:175-178`): `(sel.tab === 'shape' && sel.shape === 'brush') || (sel.tab === 'body' && sel.body === 'brush')`.
- Inside one photo, `sel` keeps `'brush'`: leaving the tab and coming back shows the brush again. **The module-level `lastSel` (`Editor.tsx:66`) never stores `'brush'`.** It keeps the item selected before the brush, so the next photo never opens in brush mode.

### 2.2 Brush bar (replaces the slider row in brush mode)

```
┌──────────────────────────────────────────────────────┐
│ [ 推 | 恢復 ]   [ 小 | 中 | 大 ]          [ 全部清除 ] │   same height as the slider row (50 px, theme.css:1677)
└──────────────────────────────────────────────────────┘
```

| Control | Component | Values | Default | Notes |
|---|---|---|---|---|
| Mode | `Segmented` (`Controls.tsx:47`), aria 「筆刷模式」 | 推 · 恢復 | 推 | Switching re-shows the hint pill. |
| Size | `Segmented`, aria 「筆刷大小」 | 小 · 中 · 大 = brush **radius** 16 / 28 / 44 CSS px on screen | 中 | Changing it draws a preview ring at the centre of the frame for 700 ms. |
| Clear | text button | 全部清除 → 確定清除？ (3 s) | — | Disabled when there are no strokes. One undo step. |

- The mode and size are remembered for the app session (module level, like `lastSel`). They are not persisted and are not undo steps. A change while a stroke is live applies to the next stroke.
- Width at 375 pt: 2 × 48 + 3 × 44 + 88 + 2 × 12 gaps = 340 pt, which fits inside the 16 pt margins. `Segmented` buttons are 44 px tall plus 2 px padding (`theme.css:1853-1861`), so every target is ≥ 44 pt (DS §7.1) and the bar fits the 50 px row.
- The bar sits outside `.editor-stage`, so the stage's gesture handler never sees it.

### 2.3 Canvas overlay (`src/ui/components/BrushOverlay.tsx`, new)

- An SVG in `.frame`, **outside** `.zoom-layer` (like `.corner-label`, `Editor.tsx:842`), so it is drawn in screen space and needs no zoom value. The ring is centred on the finger (`clientX/Y` minus the frame rect), with a 1.5 px stroke.
- Ring radius on screen = the real brush radius: `BRUSH_PX[size]`, or larger when the image radius is clamped to `R_MIN` at deep zoom (§3.3), converted back to CSS px with the same V→O mapping.
- The ring is drawn while a finger is down and drawing:
  - 推: `--accent`;
  - 恢復: white, dashed 4/4;
  - `--dim` while the brush resists (the last stamp was skipped by the guard, §4.3) or after a cap is hit (§3.6).
- The ring hides while pinching, while 按住對比 is held, and when the mode ends.
- Hint pill: top centre of `.frame` (also outside the zoom layer), `--panel` background. It shows 「單指推動，雙指縮放」 (推) or 「單指塗抹恢復，雙指縮放」 (恢復) for 2.5 s on entering the mode and on each mode switch, and fades out over 300 ms.

### 2.4 Copy (new strings; the contract's strings are kept exactly)

| Key | 繁體中文 |
|---|---|
| strip item | 推臉筆 |
| mode segments / aria | 推 · 恢復 / 筆刷模式 |
| size segments / aria | 小 · 中 · 大 / 筆刷大小 |
| clear / confirm | 全部清除 / 確定清除？ |
| hint (推) | 單指推動，雙指縮放 (§C2.3) |
| hint (恢復) | 單指塗抹恢復，雙指縮放 |
| cap toast | 推臉筆筆畫已達上限 (§C2.6). Shown once per gesture that hits a cap. |
| replay status (> 300 ms) | 正在套用推臉筆… |
| person strip caption in brush mode | 整張照片 (§C2.6) |

### 2.5 Gestures: drawing versus pinch-zoom (decision)

zoomPan owns every pointer on the stage today: one finger pans when zoomed, two fingers pinch, and a double tap fits (`zoomPan.ts:81-113`). Button, slider-row and status targets are ignored (`zoomPan.ts:82`). In brush mode the same listener arbitrates, so pinch never loses its first finger to an overlay that has stopped propagation (the `HeightBandOverlay` pattern at `HeightBandOverlay.tsx:237-249` cannot be used here). The hooks are read through a ref, so entering or leaving the mode does not re-subscribe the listeners (the effect keys only on `enabled`, `zoomPan.ts:125`).

The rules are a pure reducer, `src/ui/brushGesture.ts` (new), with states `idle → stroke → pinch → locked` and an injected clock:

| Event | In state | Result |
|---|---|---|
| First pointer down (not on a button, `.slider-row` or `.status`) | idle | → **stroke**. Start a `LiveStroke` at the pointer (§3.5). Stamps are applied from the first movement; there is no added latency. |
| Pointer move | stroke | Feed every coalesced point (`getCoalescedEvents()` when present) to the stroke. |
| Second pointer down **≤ 200 ms** after the first (`PINCH_GRACE_MS`) | stroke | **Cancel** the stroke: the preview reverts and no undo step is made. → **pinch** with both pointers. |
| Second pointer down **> 200 ms** after the first | stroke | **Commit** the stroke so far (one undo step if it changed anything). → **pinch**. |
| Moves with ≥ 2 pointers | pinch | `pinchView` as today (`zoomPan.ts:26-31, 95-97`) |
| One of two pointers lifts | pinch | → **locked**. The remaining finger neither pans nor draws. |
| Last pointer lifts | stroke | **Commit** (one undo step if it changed anything). → idle. |
| Last pointer lifts | pinch / locked | → idle |
| `pointercancel` (iOS system gesture, call) | stroke | Commit, like `BandDrag` (`HeightBandOverlay.tsx:197-207`). |
| Third pointer | any | Ignored |
| Double tap with no stamps | idle | Fit, as today (`zoomPan.ts:105-111`). A gesture that applied any stamp is never a tap. Single taps are not forwarded to step 1's `onTap` (PS §2.3), so there is no person selection in brush mode. |

- With one finger in brush mode, zoomPan never pans (`zoomPan.ts:98-101` is skipped). The user moves around a zoomed photo with two fingers.
- `.editor-stage` already has `touch-action: none` (`theme.css:1606-1608`), so Safari delivers every touch as pointer events.
- Apple Pencil (`pointerType: 'pen'`) draws like a finger and its pressure is ignored. The mouse primary button draws, which is what the e2e tests use.
- **↶ ↷ are disabled while a stroke is live.** Anything that ends the editing context during a live stroke commits the stroke first: 儲存, a tab or strip-item tap (leaving the mode), `visibilitychange` to hidden, and unmounting the editor (then the normal flush runs, `Editor.tsx:343-398`).

---

## 3. Architecture and data model

### 3.1 Frames and units

- **Strokes live in the output O frame.** P2 evaluates `o = Geo⁻¹(v)` and then `tc = o + L(o)` (§C4.2). A stroke point is the `o` under the finger: the client point goes to V (the frame's rect, as `HeightBandOverlay.tsx:232-235` does), then to O through `vToO` (`src/geometry/view.ts`, step 3).
  - The O frame has the same normalized axes as the source O frame that landmarks, poses and masks use (§C3.5), but it describes the **warped** image. Strokes therefore stay attached to what the user pushed when the geometry changes (rotate, flip, straighten, crop), and no re-detection is involved.
- **S units (isotropic) for every brush computation.** Normalized O is anisotropic, so the brush works in `S = (x·W/S₀, y·H/S₀)`, where `S₀ = min(W, H)`. Radii are fractions of the short edge (`Stroke.radius`, §C3.2), so circles stay circles. `W × H` is the frame's pixel size (§3.3).
- **The field** `L` stores backward displacement in **O UV units**, RG, row 0 = image top. It has exactly the `BodyField` layout (`types.ts:173-180`), so the shader contract and the upload code are shared: `export type LiquifyField = BodyField`.
- **Grid:** `[w, h] = fieldSize(W / H, LIQUIFY_LONG_EDGE = 512)` (`geom.ts:46-51`). Texel `(i, j)` is centred at `((i + 0.5)/w, (j + 0.5)/h)`. Let `F = min(w, h)` be the number of texels per S unit.

### 3.2 Types (`src/types.ts`; the `Stroke` shape is the contract's, with tightened meaning)

```ts
/** §C3.2, unchanged fields. Immutable once committed. */
export interface Stroke {
  /** unique within the photo; also the stroke's equality key in editKey (§C3.4) */
  id: string;
  kind: 'push' | 'restore';
  /** brush radius, fraction of the frame's short edge (S units), clamped to [rMin(frame), R_MAX] (§3.3) */
  radius: number;
  /** per-stamp gain: PUSH_GAIN or RESTORE_GAIN when it was drawn, stored so retuning the constants never changes old photos */
  strength: number;
  /**
   * O-frame (x, y) pairs, 2…MAX_STROKE_POINTS pairs. Consecutive points are radius/4 apart in S units (to Float32
   * rounding), except the last gap, which is in [radius/8, radius/4). A continuation record (§3.4) starts with its
   * predecessor's last point.
   */
  points: Float32Array;
}
export type LiquifyField = BodyField;
/** the pixel size whose aspect and short edge the liquify grid is built on (§3.3) */
export interface LiquifyFrame { width: number; height: number }
export type BrushKind = Stroke['kind'];
export type BrushSize = 's' | 'm' | 'l';
```

- `PhotoParams.strokes: readonly Stroke[]` is part of the contract (§C3.2). The **order is the replay order**.
- `RenderInput.liquify?: LiquifyField | null` is part of the contract (§C4.1).
- `DebugState` (`types.ts:409-421`) gains `liquify?: { strokes: number; version: number; work: number; maxDisp: number; pending: boolean }`. The Editor writes it in every build, like `face` (`debug.ts:5-19` creates `__meiyan` everywhere); `strokes` counts records, and it is updated on commit, sync and rebuild end, not per stamp.

### 3.3 Constants (`src/config/limits.ts`, the single file of §C3.8)

| Constant | Value | Meaning |
|---|---|---|
| `LIQUIFY_LONG_EDGE` | 512 | Field long edge (§C4.4, §C4.7) |
| `BRUSH_PX` | `{ s: 16, m: 28, l: 44 }` | Screen radius in CSS px |
| `rMin(frame)` | `4 / F` | Smallest image radius: 4 texels, below which the field cannot represent a smooth stamp |
| `R_MAX` | 0.25 | Largest image radius (S units) |
| `STAMP_SPACING` | 0.25 | × radius |
| `PUSH_GAIN` | 0.75 | Content at the brush centre moves ¾ of a short drag (§4.2) |
| `RESTORE_GAIN` | 0.5 | Per-stamp restore factor at the centre |
| `SNAP` | 2e-5 (UV) | A restored texel whose displacement falls below this is set to exactly 0 (0.1 px at 4096); compared as a squared length |
| `LIQUIFY_MIN_DET` | 0.2 | Fold guard floor for strokes (§4.3). Deliberately below the body field's 0.35 (`field.ts:70`). |
| `GUARD_STEPS` | 6 | Per-stamp bisection steps |
| `MAX_STROKE_POINTS` | 256 | Per record (§C3.2) |
| `MAX_STROKES` | 120 | Records per photo (§C5.3) |
| `LIQUIFY_WORK_CAP` | 12 000 000 texel-stamps | Bounds the worst-case replay to about 1 s of work on the test iPhone (§6). Phase 0 rescales it. |
| `LIQUIFY_SYNC_WORK` | 1 500 000 texel-stamps | Larger rebuilds are chunked (§3.5) |
| `PATCH_BUDGET` | 1 MiB | Undo patch ring (§3.5) |
| `PATCH_TILE` | 32 texels | Copy-on-write tile edge |
| `PINCH_GRACE_MS` | 200 | §2.5 |

**Frame.** `LiquifyFrame` is the history entry's `width × height` (the stored `original`, which does not change once written, `types.ts:379-405`), or the imported bitmap's size before the first write (the first write stores that same size). It is **not** the decode size of the current session. A tier-L reopen decodes at 1440 but builds the same grid, so a replay is bit-identical on every device. `openState(entry, …)` (PS §5.3, `src/edit/migrate.ts`) passes it to `sanitizeEditState` and returns it, and `EditorSource` (`state.ts:27-40`, after step 1) gains `frame: LiquifyFrame`. It is the same size step 3 passes to `sanitizeEditState` as `oSize` (crop spec D13); if step 3 has already added the field under another name, step 6 reuses it.

**Radius at stroke start.** `R = clamp(|S(vToO(p + (BRUSH_PX[size], 0))) − S(vToO(p))|, rMin(frame), R_MAX)`, evaluated with the current zoom and geometry. It stays fixed for the stroke.

### 3.4 Strokes, gestures and records (`src/edit/liquify.ts`, new, pure TS)

```ts
export class StrokeBuilder {
  constructor(kind: BrushKind, radius: number, frame: LiquifyFrame, start: { x: number; y: number });
  /** feed a raw O-frame pointer point (clamped to [−1, 2]²); returns how many resampled points it emitted (0…n) */
  add(o: { x: number; y: number }): number;
  /** finger up: emit the final point if the remainder is ≥ radius/8; split into records of ≤ 256 points */
  finish(newId: () => string): Stroke[];
}
```

- **Resampling** walks the raw polyline in S units and emits a point every `h = radius/4`. The emitted points are speed-independent and finger jitter below `h` emits nothing. A tap emits no second point, so it produces no record and no undo step.
- **Splitting:** after 256 points the builder closes the record and starts a continuation record with the same last point, so the next push stamp has a valid Δ and no restore stamp is duplicated (§4.2).
- **One gesture = one undo step**, however many records it produced. Undo is snapshot-based (`UndoStack<EditState>`, §C3.4): the gesture is one `update(edit, true)` that appends all its records.
- **Ids:** 8 base-36 characters from `crypto.getRandomValues`, regenerated on a collision with an id already in the photo.
- **No-op gestures are dropped.** A gesture whose stamps changed no texel (a 恢復 over an unpushed area, or a push fully stopped by the guard) makes no record and no undo step.

### 3.5 The liquify model (`src/edit/liquify.ts`)

```ts
export class LiquifyModel {
  constructor(frame: LiquifyFrame);
  /** the field for the strokes applied so far; null = no strokes (P2 skips liquify, no GPU texture, nothing allocated) */
  readonly field: LiquifyField | null;
  /** a rebuild is running in slices; the field does not match the last sync target yet */
  readonly pending: boolean;
  /** actual work of the applied records, guard steps included (§3.6) */
  readonly work: number;
  /** bring the field to exactly these strokes; returns whether `field` changed (same object, new version) */
  sync(strokes: readonly Stroke[]): { changed: boolean; pending: boolean };
  /** start a gesture; null when a cap is already reached (the caller toasts) */
  begin(kind: BrushKind, radius: number, start: { x: number; y: number }): LiveStroke | null;
  /** max |L| (UV) over the texels covering an O rect, plus one texel: the tile planner's term (§4.4) */
  maxDisp(r: Rect): number;
  /** o + L(o), bilinear: maps a tap on the output to the auto-warped image (body tap, §4.5) */
  backward(o: { x: number; y: number }): { x: number; y: number };
  /** a copy of the committed field for an export asked for now (like snapshotField, Editor.tsx:538) */
  snapshot(): LiquifyField | null;
  dispose(): void;
}
export interface LiveStroke {
  add(o: { x: number; y: number }): boolean;      // field changed
  readonly state: 'ok' | 'resisting' | 'capped';  // ring colour (§2.3)
  commit(newId: () => string): Stroke[];          // [] = no-op gesture
  cancel(): void;                                 // restore the gesture's tiles
}
```

- **Applied list.** The model remembers the ids of the records applied to its buffer, grouped by gesture, with each record's actual work.
- **`sync(target)`** has four cases:
  1. `target` equals the applied list: nothing to do. This is the case right after a commit, because the live gesture already applied its records under the ids that `commit` returns.
  2. `target` extends the applied list (redo, ↶ after 全部清除, or a load): apply the extra records in order.
  3. The applied list extends `target` and every removed gesture still has its patch (undo): copy the patch tiles back, newest first.
  4. Anything else (undo past the patch ring, a reopen): **full rebuild**. Zero the buffer and replay every record.
  - `target = []` frees the buffers, the scratch and the patch ring and sets `field` to null (全部清除, 重置, undo of the first stroke). The GPU texture is deleted by the pipeline when the field becomes null.
  - A `sync` that arrives while a rebuild is pending restarts the rebuild with the new target.
- **Patches (copy-on-write).** Before a gesture's first write to a 32 × 32 tile, that tile's 8 KB is copied into the gesture's patch. Records applied by case 2 get patches the same way, so an undo after a redo is fast too. The ring keeps the newest gestures' patches up to `PATCH_BUDGET` and evicts the oldest first. A live gesture's patch is exempt from the budget only during its first `PINCH_GRACE_MS`, the only time `cancel` can happen (§2.5); after that it obeys the budget like any other and an undo of it falls back to case 4.
- **Long rebuilds.** A rebuild whose actual work (§3.6) is ≤ `LIQUIFY_SYNC_WORK` (about 120 ms) runs synchronously. A larger one runs in 24 ms slices, one per animation frame (about 1.3 s wall time at the cap):
  - `pending` is true while it runs;
  - brush input is refused;
  - the Editor skips `session.render` and keeps the previous frame (on a reopen there is none yet, so the canvas waits with the status);
  - after 300 ms the status 「正在套用推臉筆…」 is shown.
- **Determinism.** Every stamp is a deterministic function of the buffer region it reads, and records replay in order. So incremental drawing, a patch revert and a full rebuild produce **bit-identical** buffers (unit test, §8.1). The stamp math uses only `+ − × ÷` and `Math.sqrt` (no `Math.exp`, `pow` or `hypot`, which are not correctly rounded and differ between V8 and JavaScriptCore), on doubles stored to Float32. Node tests and Safari therefore agree bit for bit.
- **Finite by construction.** Sanitized inputs are finite and every operator is bounded, so the field never holds a non-finite value (the fuzz test asserts it). `liquifyTexture` therefore skips `bodyTexture`'s full-buffer `every(Number.isFinite)` scan (`pipeline.ts:268`), which would otherwise cost about 400 k calls per drawn frame.

**Editor wiring** (`Editor.tsx`, after step 1):
- One `LiquifyModel` per photo, created from `source.frame`. Its sync effect is declared **before** the render effect (`Editor.tsx:602-609`) so a frame never draws new strokes with an old field.
- A live stroke never goes through React state. Pointer points are queued; one `requestAnimationFrame` drains up to 6 ms of stamps, then calls `session.setLiquify(model.field)`, which schedules the session's coalesced render (`still.ts:120-123, 247-250`). The queue keeps the rest for the next frame, so points are never dropped.
- **Exports always match committed strokes.** The encode/autosave effect (`Editor.tsx:626-669`) returns early while a stroke is live or `model.pending`. A `liquifyTick` state, bumped when a live stroke ends (commit **or** cancel) and when a chunked rebuild finishes, is in its dependency list, so a skipped export runs afterwards. Without this, a debounced export firing mid-stroke would cache a file with half a stroke under the previous `editKey`, and ↶ would make 儲存 share it. Every export renders with `model.snapshot()`.

### 3.6 Work accounting and caps

- The **base work** of a stamp is the texel count of its clipped bounding box. The base work of a record is the sum over its stamps; it is computable from the record and the frame alone, so `sanitizeStrokes` can check it.
- The **actual work** of a stamp is its base work × (1 + the bisection steps it ran, §4.3). Measured: a straight drag runs no bisection at the floor of 0.2; repeated pushes from one spot and circles bisect on most stamps (§4.3). The model sums actual work per record as it applies it. Replay cost is proportional to actual work, and replay repeats exactly the same guard decisions, so capping actual work bounds the replay.
- `begin` returns null when `strokes.length ≥ MAX_STROKES` or the model's actual work is ≥ `LIQUIFY_WORK_CAP`.
- During a gesture, the next stamp is refused (`state = 'capped'`, the ring turns `--dim`, the toast shows once) when it would exceed either cap, counting the gesture's own records. Finger up commits what was drawn.
- **Size:** 120 records × 256 points × 8 B ≈ 246 KB, inside §C5.3's 512 KB edit budget.

### 3.7 Files to add and change

Anchors are at `892ea61`; "after step N" marks code that earlier v0.4 steps reshape first.

| Area | Change |
|---|---|
| `src/types.ts:173-180, 276-292, 409-421` | `LiquifyField`, `LiquifyFrame`, `BrushKind`, `BrushSize`; `RenderInput.liquify` (§C4.1); `DebugState.liquify` |
| `src/config/limits.ts` (step 1) | §3.3 constants |
| `src/edit/liquify.ts` (new) | `StrokeBuilder`, stamp operators, guard, `LiquifyModel`, `strokeWork`, `sanitizeStrokes(strokes, frame)` |
| `src/edit/state.ts` (step 1) | `withStrokes(edit, recs)`, `clearStrokes(edit)`; `sanitizeEditState(raw, personIds, oSize?)` calls `sanitizeStrokes` with the size as the frame and drops all strokes when none is given (the camera look, §4.5). The size argument is the one step 3 adds (crop spec D13, §C3.2): one `{width, height}` serves the crop validity and the liquify grid. `editKey` replaces `points` with `id` (§C3.4) |
| `src/edit/migrate.ts` (step 1) | `openState` passes `{width: entry.width, height: entry.height}` as the frame and returns it |
| `src/ui/state.ts:27-40`, `src/ui/flows.ts:16-45` (after step 1) | `EditorSource.frame`; a new import or camera shot uses the bitmap size |
| `src/body/field.ts:166-192` | `fieldMinJacobianRect(f, x0, y0, x1, y1)`; `fieldMinJacobian(f)` becomes the full-rect call, with the same result, so existing tests keep their assertions |
| `src/engine/passes/reshape.ts:180-183, 214-319, 345-412` (after steps 1, 3, 5) | `LIQUIFY_UNIT = 4`, `uLiqDisp`/`uLiqOn`, the body lookup moved to `tc` (§4.4) |
| `src/engine/passes/reshapeCpu.ts:53-143` | Optional `liquify` argument, applied first, with f16 rounding (§4.4) |
| `src/engine/passes/reshapeCpu.test.ts:32` | Hash pin re-set |
| `src/engine/pipeline.ts:53-75, 83-112, 250-287, 400-424` | `FrameJob.liquify`; `PassPlanInput.liquifyOn`; `liquifyTexture()` mirroring `bodyTexture` without the finite scan; passed to the reshape and maskWarp draws |
| `src/engine/index.ts` (`job()`, `index.ts:174-194`) | Forward `RenderInput.liquify` |
| `src/app/still.ts:20-26, 60-72, 109-118, 247-250, 267-274` | `setLiquify(field)`, `readonly liquify`; `StillSessionOptions.liquify` so a replacement session draws the strokes on its first frame (seeded at `Editor.tsx:229-233` like `body`); included in `input()`; `exportImageData(p, body?, liquify?)` takes the snapshot like `body` |
| `src/ui/brushGesture.ts` (new) | §2.5 reducer |
| `src/ui/screens/zoomPan.ts:33-126` | `useZoomPan(stage, layer, enabled, opts?: { brush?: BrushHooks \| null; onTap? })`, hooks read through a ref. With `brush` set, the reducer decides; single-finger pan is off; double-tap only for stamp-free taps. |
| `src/ui/components/BrushOverlay.tsx`, `BrushBar.tsx` (new) | §2.2, §2.3 |
| `src/ui/icons.tsx` | `brush` icon |
| `src/ui/panelModel.ts:25, 41-47, 175-178, 258-299, 301, 400, 480` | `'brush'` selection, items in both strips, `showsBrush`, `activate` for `{type:'brush'}`, `sliderFor` returns null in brush mode |
| `src/ui/components/BeautyPanel.tsx:63` | The brush item is exempt from `faceOff` dimming |
| `src/ui/screens/Editor.tsx:66, 152-180, 229-233, 343-398, 525-545, 602-609, 626-669, 679, 700-737, 739-754, 797, 832-875` | The `LiquifyModel` per photo; the sync effect before the render effect; `LiveStroke` wiring and the rAF stamp queue; session seeding; commit before flush, save, undo and mode exit; export gating with `liquifyTick`; snapshot at export; brush bar in place of `SliderRow` (also when `faceOff`); `lastSel` rule; debug state |
| `src/ui/components/{FaceBoxes,PersonStrip}.tsx` (step 1) | Hidden / dimmed in brush mode |
| `src/media/exportFull.ts` (step 3) | Tile window term from `model.maxDisp` (§4.4) |
| `src/bench/main.ts` | Liquify rows (§6.2) |
| `tests/e2e/liquify.spec.ts` (new), `reshape.spec.ts`, `fixtures.ts`, `pages/reshape.ts` | §8 |

---

## 4. Engine and shader changes

### 4.1 Composition: one field, one resample

P2 after all six steps (§C4.2):

```
o  = Geo⁻¹(v)                                  step 3 (identity: o = vUv)
t1 = o  + L(o)                                 this step: the liquify field
t2 = t1 + D_body(t1)                           美體 (combined multi-person field, §C4.5)
tc = t2 + Σ_f cap_f(chain_f(t2) − t2)          face chains + protect (steps 1, 5); cap_f limits the length of
                                               the face's displacement by its cap budget (§C4.3), not a window
out = A(window(tc))                            one resample of the source
```

- L is the **outermost** map (§C4.2), so the user pushes the image they see, which already includes every automatic warp.
- The face chains still see detected-landmark coordinates, and the body field still sees source anatomy, because both are inner maps.
- maskWarp runs the same map (`pipeline.ts:414-423`), so 磨皮, 紅潤 and the step-4 regions follow the pushed face.
- Makeup is drawn in source space before P2 (`pipeline.ts:393-399`), so it follows too.

### 4.2 Stamp operators (CPU, `src/edit/liquify.ts`)

Profile: `w(r) = (1 − r²/R²)³` for `r < R`, else 0. This is the contract's "Gaussian profile" (§C4.4) in compact form: it matches `exp(−3r²/R²)` near the centre, it is C², and it is exactly 0 at R. A compact profile makes the stroke's bounding box exact (incremental updates need that) and needs no `Math.exp` (§3.5). `max |∇w| = 1.717/R`, at `r = R/√5`.

All coordinates are in S units. `toUV(d) = (d.x · S₀/W, d.y · S₀/H)`. Each stamp touches only the texels whose centre X has `|X − c| < R`:

```
push stamp i (i ≥ 1): c = p[i−1], Δ = p[i] − p[i−1], g = strength·λ
    B(X)   = −g · w(|X − c|) · Δ                         backward displacement of the stamp (S units)
    L'(X)  = toUV(B(X)) + L(X + B(X))                    compose: M_new = M_old ∘ S  (BR:138: D_brush + D_old(x + D_brush))
restore stamp i (i ≥ 1): c = p[i], k = strength·λ
    L'(X)  = (1 − k · w(|X − c|)) · L(X);   |L'(X)|² < SNAP² → 0
```

`λ` is 1 unless the guard (§4.3) lowers it; it applies to both operators.

- **Composition, not addition.** The contract's earlier wording "each stamp adds −w·Δ" holds only where L is locally constant. Composing makes a push act on what is on screen.
  - Composing maps that are each fold-free cannot fold in the continuum; on the 512 grid the guard (§4.3) makes it hold exactly.
  - A plain sum of many stamps folds as soon as the summed gradients pass 1.
  - `L(X + B)` is a bilinear, clamp-to-edge read of the **pre-stamp** values: the stamp is computed into a scratch buffer and then copied back.
- **Per-stamp bound (push).** `|Δ| ≤ R/4` by construction. So on an identity field `det(I − g·Δ⊗∇w) ≥ 1 − 0.75 · 0.25 · 1.717 = 0.68`: one push stamp cannot fold by itself. A **restore** stamp has no such bound: where |L| is large compared with the restore radius, `−k·L⊗∇w` dominates and one stamp folds (measured: det −8 for a 小 恢復 line across a 4 R 大 push without the guard). The guard therefore covers restore stamps too.
- **Travel per stroke (measured).** With `g < 1`, content falls behind the brush:
  - a short drag of length `d ≲ R` moves content at the stroke start by `0.6–0.75·d`;
  - over a long straight drag the travel saturates at about **1.8 R** (1.44 R at a 2.1 R drag, 1.8 R at 4.3 R). Moving content further takes a new stroke;
  - in the continuum the steady state is `∫₋R^R g·w/(1 − g·w) dr` (content crosses the whole disc), which diverges at g = 1: the content sticks to the finger and smears across the photo. That is why `PUSH_GAIN` is 0.75, not 1 (§11 Q3).
- **Restore strength (measured).** One straight pass of a 大 brush along a 中 push leaves about 10 % of the push's max |L|, a second pass about 2 % (the per-pass product at the centre is `∏(1 − 0.5·wᵢ)` ≈ 0.10, since Σw ≈ 3.66 for stamps every R/4). `SNAP` then zeroes texels; in the measured case the whole area is exactly 0 after 7 passes, and the image is then bit-identical to the slider-only image. Restoring a push much larger than the brush is slow (a 小 brush over a 4 R 大 push still leaves 58 % after nine passes, because the guard limits each stamp); the 恢復 hint therefore stays generic and §7 says to use 大.
- **Frame edges.** Reads beyond the grid clamp to the edge, the same as `texture()` in the shader. Pushing at the photo border stretches border pixels, as every liquify tool does; 恢復 fixes it. No edge pinning is added (YAGNI).

### 4.3 Fold prevention: a per-stamp minimum-Jacobian guard

- After a stamp (push or restore) is written, `fieldMinJacobianRect` checks the cells of the stamp's bounding box plus one texel. Outside that box the field did not change, so the check is exact (the function evaluates the four corner determinants, which is exact for the bilinear map, `field.ts:166-192`).
- If the minimum is below `LIQUIFY_MIN_DET` (0.2), the stamp's box is restored from a stamp-local backup and the stamp is re-applied with λ found by bisection over `GUARD_STEPS = 6` (λ ∈ [0, 1], keep the largest passing value, `lo`). `lo = 0` means the stamp is skipped and the ring shows `resisting`.
  - By induction, the field before every stamp passes the guard: it starts at identity (det 1), and every stamp leaves a passing field.
  - The bisection is therefore always well-defined.
- The guard is **part of the stamp operator**. Replay runs it too, so no per-stamp λ is stored, and preview, commit and replay are the same field.
- **Where it binds (measured).** In a backward map det < 1 means content is stretched (magnified); compression (det > 1) is never limited. A push stretches the area **behind its starting point**, so:
  - a single straight drag of any length never reaches 0.2 (min det 0.247);
  - repeated pushes from the same start add less each time and stop: cumulative travel next to the start is 0.47 R, 0.54 R, 0.55 R after 1, 2, 3 pushes of 1 R;
  - circles and back-and-forth scrubs bisect on 25–60 % of stamps.
- **Why 0.2 and not the body field's 0.35.** 0.35 is a quality floor for automatic warps the user did not draw. Measured with 0.35, the second 1 R push from the same start adds nothing (0.38 R → 0.39 R) and even one 1 R push bisects, so the brush feels broken. The user sees and controls the brush's stretch and can 恢復 it, so the floor only has to prevent folds: 0.2 allows up to 5× magnification. The RG16F upload perturbs det by at most 0.044 in every measured case (0.2 → 0.156), so the GPU map stays fold-free.
- **Contract delta.** §C4.4 said "guards each committed stroke … scaled back by bisection". This spec guards each stamp. With a per-stroke guard, the result at finger-up would differ from what the user saw while drawing; with a per-stamp guard, a push that is too hard simply stops (the content "resists"), and it does so live. (Applied to C, see the appendix.)
- **Stacking with other layers.** The body field (`field.ts:148-159`) and the face chains (influence cap, §C4.3) keep their own guards. The composed map's Jacobian is the product of the layers' Jacobians, each > 0 (≥ 0.2 × 0.35 = 0.07 for liquify on top of the body field), so the composition never folds. No cross-layer guard is needed.

### 4.4 Shader, CPU port and upload

**RESHAPE_FS** (`reshape.ts:214-319`; shown against today's lines 286-290; steps 1, 3 and 5 rewrite the rest of `main()`):

```glsl
uniform sampler2D uLiqDisp; // RG16F backward displacement in O UV units, row 0 = image top (LIQUIFY_UNIT)
uniform float uLiqOn;
...
vec2 o = vUv;                                        // step 3: o = geo(vUv)
vec2 tc = o;
if (uLiqOn != 0.0) tc += texture(uLiqDisp, o).xy;
if (uBodyOn != 0.0) tc += uBodyOn * texture(uBodyDisp, tc).xy;   // today: texture(uBodyDisp, vUv)
```

- With no strokes and identity geometry, `tc == vUv` exactly at the body lookup, so v0.3 output is bit-identical and the parity goldens hold (§C8.4).
- `LIQUIFY_UNIT = 4` (after `BODY_UNIT` 1, `PROTECT_UNIT` 2, and the face table on 3 from step 1, PS §4). That makes 5 units in P2, as §C4.3 budgets.
- `uLiqOn = 0` binds the existing 1 × 1 `zero` texture (`reshape.ts:351-352`), so no sampler reads an empty unit.

**Pipeline** (`pipeline.ts`):
- `FrameJob.liquify: LiquifyField | null`.
- `planPasses`: `reshape = … || i.liquifyOn` (`pipeline.ts:103-112`), so a strokes-only frame runs P2 and maskWarp.
- `liquifyTexture(f)` is a copy of `bodyTexture` (`pipeline.ts:258-287`) with its own upload key and the same validity rule (`bodyFieldValid`, `MAX_BODY_FIELD_EDGE = 2048`, `pipeline.ts:133-147`), without the finite scan (§3.5). It uploads RG16F from FLOAT data, which is filterable in core WebGL2.
- The whole texture is uploaded on each version change: 512 × 384 RG is 196 k texels. If Phase 0 measures more than 2 ms on the iPhone, the fallback is sub-rect uploads of the dirty 32-texel tiles (`UNPACK_ROW_LENGTH`/`SKIP_*`). The tiles are already tracked for patches, so the fallback needs no new bookkeeping.
- The texture is deleted when the field becomes null.

**CPU port** (`reshapeCpu.ts:53-143`):
- `reshapeMapCpu(…, liquify?)` applies `L` first, with each texel rounded by `f16` before the bilinear blend (`reshapeCpu.ts:30, 43`), which is what the GPU reads back from RG16F, like `protectAt` (`reshapeCpu.ts:33-47`).
- The body field is then sampled at the liquified coordinate.
- The hash pin `reshapeCpu.test.ts:32` is re-set (§C8.2).

**Tiled export (§C4.6).** The liquify texture covers the whole O frame and is sampled at `o`, so tiles need no field windowing. The window must contain every sample of the composed map, and the inner maps are sampled at `t1 = o + L(o)`, which can lie up to `m = model.maxDisp(rectO)` outside the tile's O rect. So the planner computes `m` exactly from the CPU buffer, then evaluates the body and face `maxDisp` over `rectO` dilated by `m`, and pads by the sum (+ 4 px and the kernel apron, §C4.6, crop spec §4.4). The 33 × 33 grid of the CPU ports alone could miss a small brush's peak between samples (a 小 stroke at deep zoom is 4 texels of 512).

### 4.5 Interaction with per-person auto warps and 背景保護 (decisions)

| Topic | Decision | Why |
|---|---|---|
| Layer order | Strokes act on top of every automatic warp (§4.1) | §C4.2: "the user pushes what they see" |
| A slider moved **after** strokes | The strokes stay where they were drawn in the output frame, and the new auto warp moves content under them. Nothing is re-fitted. | Strokes are a pure function of their points, which keeps undo, persistence and determinism simple. Auto warps are smooth and local, so the shift under a stroke is small. Listed under Risks (§9). |
| Persons and 全部 | Strokes are photo-level (§C3.1). Selection, 全部 and per-person presets never touch them; one stroke may cross several persons. Face boxes hide in brush mode, and the person strip dims with 「整張照片」. | A brush edits pixels where it is drawn, not a person |
| ⊘ 原圖 / presets / 重置 | ⊘ and presets never touch strokes (§C2.1). 重置 clears them (`defaultPhoto()`, §C3.4). | Contract |
| 背景保護 (`photo.bodyProtect`) | **Not applied to strokes.** It keeps protecting the automatic 美體 field per person (§C4.5). | (1) Direct manipulation: protection that silently refuses to move background under the finger reads as a broken brush. (2) The brush radius is already the only ring of background that moves, and the user sees it and can 恢復 it. (3) The brush must also work on photos with no person. **This differs from 醒圖**, which added 背景保護 to its 瘦臉瘦身 manual tool (BR:20), so §11 Q1 asks the user and gives the design if they want it. |
| 瘦臉 limit (`FaceProtect`) and the face influence caps | Unchanged and unaware of strokes. They are evaluated in source space, inside L. | Inner maps |
| Other persons as protected zones (§C4.5) | Not applied to strokes | Same as 背景保護 |
| 恢復 scope | Only 推臉筆 strokes (§C11 Q2 default). In areas the auto warps moved, 恢復 brings back the slider-only image, not the original photo. | Restoring auto warps under the brush would need a restore mask that blends `tc` back toward `o` inside the face chains and body field, and a guard on the **composed** map evaluated through every CPU port at stamp time (about 10× the stamp cost). §11 Q2. |
| Overlays | A photo tap (PS §2.3 `hitPerson`, faces and bodies alike) goes through `model.backward(o)` before the body field and the hit-test. Face boxes stay at their detected positions: a push that moves a whole face leaves its box offset by up to the push (≈ 2 R per stroke). 增高 lines are not mapped (they are rows in E-space, §C3.5). | Boxes are a selection affordance with ≥ 44 pt hit areas and are hidden in brush mode. Re-centring them needs a robust inverse of the field (a fixed-point inverse diverges where pushes compress content: measured residuals of 11–50 texels), which is not worth it (§10). |
| 祛痘 spots (step 4) | A spot follows its content: a later push carries the healed blemish with the skin, so the user never taps again. A spot tapped after strokes lands on what the finger touched, because the tap goes through `backMapCpu`, which applies liquify first (skin-cleanup spec §3.4). | P0b heals the source in O before every warp (skin-cleanup spec A1, §C4.2) |
| Camera | No brush. `CameraLook.photo.strokes` is always `[]` (sanitize without a frame drops strokes). | `live: false` (§C2.4) |

---

## 5. Persistence and migration

### 5.1 What is stored

- `HistoryEntry.edit.photo.strokes` (§C5.1) holds the records with their `Float32Array` points, which IndexedDB structured-clones as the body cache already does (`history.ts:38-39`). Nothing derived is stored: the field is rebuilt from the records on reopen (§3.5).
  - A stored field would cost about 0.8 MB per entry as f16 (× 12 entries).
  - It would also break bit-exact replay, because later strokes would compose on an f16-rounded buffer.
- Every committed gesture is one params write, through the existing debounced autosave (`paramsPatch`, §C5.1). It carries the whole `EditState`, at most about 250 KB of strokes.
- The thumbnail and the shared file are rendered with the committed strokes (§3.5 export gating), so they match the preview.
- **Legacy projection** (`params: BeautyParams`, §C5.1) cannot represent strokes. A rollback to 0.3 opens the entry with its slider look and without liquify. This is accepted and documented in the release notes.

### 5.2 Sanitize (`sanitizeStrokes(strokes, frame)`, called by `sanitizeEditState`)

Without a frame (the camera look) every stroke is dropped. Otherwise, in order, each rule drops only the offending record, and the replay order is kept:

1. `kind` must be `'push'` or `'restore'`.
2. `id` must be a string of 1–64 characters, unique within the photo. A duplicate is dropped (the first one is kept).
3. `points` must be a `Float32Array`, or an array, which is converted. It must hold an even number of values, 2…256 pairs, every value finite and inside [−1, 2] (a stroke may start beside the photo, §7).
4. `radius` is clamped to [`rMin(frame)`, `R_MAX`]; a non-finite value drops the record. `strength` is clamped to [0, 1]; a non-finite value drops the record.
5. Caps: keep records while the running count ≤ `MAX_STROKES` and the running **base** work (§3.6) ≤ `LIQUIFY_WORK_CAP`. The first record over a cap and every later one are dropped. Later records were drawn on top of earlier ones, so a gap in the middle would change what they push. Base work ≤ actual work, so this never drops a record the app itself committed.

### 5.3 Migration

- v1 entries and `meiyan.params.v1` have no strokes: `strokes = []` (`defaultPhoto()`, §C5.2). No other migration is needed.
- **Future algorithm changes:** a record without an `algo` field means "algorithm 1", which is this spec. A later version that changes the stamp maths writes `algo: 2` on new records and keeps replaying unmarked ones with algorithm 1. So nothing is added now (YAGNI), and old photos never change.

### 5.4 Undo

- `UndoStack<EditState>` with `{ clone: false, key: editKey }` (§C3.4). Appending makes a new array (`[...strokes, ...recs]`), and the records and their `Float32Array`s are shared by every state that contains them. 50 undo states with 120 strokes cost about 50 × 120 pointers, not 50 copies of the points.
- `editKey` serializes `Stroke.id` instead of `points` (§C3.4), so stroke arrays are never stringified for comparison.
- **Granularity:**
  - one gesture is one step;
  - 全部清除 is one step;
  - mode, size, zoom and selection are never steps;
  - a cancelled gesture (second finger within 200 ms) and a no-op gesture make no step.
- **Speed:** an undo that hits the patch ring costs O(touched tiles), under 5 ms. An undo past the ring, or ↶ after 全部清除, is a replay (§3.5).

---

## 6. Performance budget and measurements

### 6.1 Budget (targets on the user's iPhone; Phase 0 and the step-6 bench confirm them)

| Path | Budget |
|---|---|
| Stamp, 中 brush at zoom 1 (about 3.3 k texels of bounding box, push with the guard check) | ≤ 0.27 ms (≈ 80 ns per texel-stamp) |
| Stamps per pointer frame | ≤ 6 ms. The rest is queued and drained on the next frame, so points are never dropped. |
| Field upload (512 × 384 RG FLOAT → RG16F) | ≤ 2 ms per changed frame |
| Preview frame at 2048 while drawing, everything on | ≤ 33 ms (the slider budget, §C6.1) |
| Commit (finger up) | ≤ 5 ms (no bisection at commit: the guard ran per stamp) |
| Undo within the patch ring | ≤ 5 ms |
| Reopen replay, 30 typical strokes (a cheek push is about 9 stamps) | ≤ 100 ms, synchronous, before the first render |
| Worst-case replay at `LIQUIFY_WORK_CAP` | ≤ 1 s of work, ≈ 1.3 s wall in 24 ms slices, 「正在套用推臉筆…」. This is the one exception to §C6.1's "first frame ≤ 300 ms" on reopen, and only for photos above `LIQUIFY_SYNC_WORK`. |
| Memory when the photo has strokes | CPU field ≤ 2 MiB (512², Float32) + patch ring ≤ 1 MiB + stamp scratch and guard backup ≤ 2 × 0.5 MiB (a 256² box at `R_MAX`) + GPU texture ≤ 1 MiB = **≤ 5 MiB (5.2 MB)**. With no strokes: 0 (nothing is allocated). |

**Contract delta (memory).** §C4.7 counted only the liquify texture toward the "≤ 6 MB new resident memory" budget; it omitted the CPU mirror that composition and undo patches need. This spec allocates everything lazily on the first stroke and frees it when the strokes become empty (全部清除, 重置, ↶ of the first stroke) and on editor unmount. So: ≤ 6 MB for photos without strokes, as §C4.7 says, and at most 5.2 MB more while strokes exist. On SE-class devices (§C6.2) this stays well clear of the roughly 100 MB kill, because a stroke never coexists with a full-resolution export buffer: an export takes a 2 MiB snapshot and nothing more. (Applied to C, see the appendix.)

### 6.2 Measurements (step-6 bench rows in `src/bench/main.ts`; desktop now, iPhone via `/bench.html` only after the user's go-ahead for a preview deploy, §C6.2)

| Row | Measures | Rule if the iPhone misses the budget |
|---|---|---|
| `liquify.stamp` | ns per texel-stamp for push with the guard check, push with a full bisection, and restore, at sizes 小/中/大; share of bisected stamps on the `S30` fixture | Over 80 ns: scale `LIQUIFY_WORK_CAP` and `LIQUIFY_SYNC_WORK` so the worst replay stays ≤ 1 s of work and the synchronous one ≤ 100 ms |
| `liquify.upload` | ms for a full 512² RG16F upload | Over 2 ms: dirty-tile sub-uploads (§4.4) |
| `liquify.frame` | Editor frame at 2048 with strokes and every effect on | Over 33 ms: while a finger is down, render at half the processing size (a draft flag on `session.render`, added only if this row fails) |
| `liquify.replay` | ms to replay fixtures `S30` (30 typical strokes) and `SCAP` (at the work cap), from `tests/fixtures/strokes_*.json` generated by the unit-test helper | As `liquify.stamp` |
| Memory | Safari Web Inspector timeline: open a photo, draw 30 strokes, undo 10, export | Over 5.2 MB: `PATCH_BUDGET` → 512 KiB |

---

## 7. Error and edge cases

| Case | Handling |
|---|---|
| A stroke starts on 重置 or 按住對比 (buttons inside `.frame`) | Not a stroke: zoomPan's target check (`zoomPan.ts:82`) runs before the reducer |
| A stroke starts outside the photo (stage letterbox) | Raw points are clamped to [−1, 2]² and kept (§5.2). Stamps clip to the grid, so the brush takes effect where it enters the photo. |
| Pushing at the photo border | Border pixels stretch (clamp to edge); 恢復 fixes it |
| Second finger ≤ 200 ms / > 200 ms after the first | Cancel / commit, then pinch (§2.5) |
| `pointercancel`, editor unmounted or hidden mid-stroke, tab or item tapped mid-stroke | Commit what was drawn (one undo step), then the normal flow |
| 推／恢復 or size changed mid-stroke | Applies to the next stroke |
| ↶ ↷ during a live stroke | Disabled until finger up |
| 儲存 during a live stroke | Commit first, then export with `model.snapshot()` |
| The debounced autosave fires during a live stroke or a chunked rebuild | Skipped; `liquifyTick` re-arms it when the stroke ends or the rebuild finishes (§3.5). The timer checks again when it fires, reading the live stroke from its ref (`editorModel.outputWaits`): Preact runs the cleanup that cancels a timer armed before the stroke only after the next frame, whose queue drain already applied the first stamps (v0.4 cleanup, step-6 review) |
| An export waits for a filter LUT while the user keeps drawing | The export uses the snapshot taken at the tap (the `snapshotField` rule, `Editor.tsx:533-541`) |
| WebGL context loss mid-stroke | The field lives on the CPU. After restore, the pipeline re-uploads it (the new texture has no upload key) and the stroke continues. |
| Engine swap or re-detect replaces the session | The replacement is created with `liquify: model.field` (§3.7), so its first frame has the strokes |
| Cap reached before or during a gesture | Toast 推臉筆筆畫已達上限 once. Before: nothing is drawn. During: further stamps are refused, the ring dims, and finger up commits. 全部清除 or ↶ frees room. |
| A push the guard stops completely, or a 恢復 over an unpushed area | No record, no undo step |
| Repeated pushes from the same spot | The area behind the start stops stretching at 5× (det 0.2); later pushes there do nothing and the ring shows `resisting`. Starting further back or a larger brush moves content further. It never folds or mirrors. |
| A small 恢復 brush over a large push | Restores gradually (the guard limits each stamp); 大 restores it in a couple of passes |
| Deep zoom on a small brush | The radius clamps to `rMin` (4 texels); the ring grows on screen to show it |
| Panorama (4:1) or tiny photos | Grid `fieldSize(aspect, 512)` (e.g. 512 × 128); `rMin` follows the short edge. Nothing special. |
| Rotate, flip, straighten, crop after strokes | Strokes are in O under `Geo⁻¹`, so they stay on their content. Strokes on an area cropped away are kept and invisible (§C7). |
| Re-detection after rotation, or new persons from 美體 | Strokes are unaffected (photo-level, not keyed to persons) |
| A slider moved after strokes | §4.5: strokes stay in the output frame |
| A corrupt stroke record in history | Dropped by `sanitizeStrokes`, along with every later record (§5.2) |
| Tier-L reopen (1440 decode) | Same grid from `LiquifyFrame` (§3.3), so the replay is bit-identical |
| 基本模式, or no face and no body | The brush works; it needs no detection |
| Rollback to 0.3 | Look without liquify (§5.1) |

---

## 8. Testing

### 8.1 Unit (Vitest)

`src/edit/liquify.test.ts` (a test helper inverts the field along the stroke line by bisection; the app has no inverse):
- **Resampling:** gaps of R/4 in S units (relative tolerance 1e-6, Float32) with the last gap in [R/8, R/4); speed independence (the same straight path fed as 3 or 300 raw points gives the same records); a tap gives no record; 700 points split into 3 records whose continuations repeat the last point; S-units on a 3:4 and a 16:9 frame (a circle stays a circle); raw points beyond [−1, 2] are clamped.
- **Push:** one stamp on an empty field equals `toUV(−g·w(|X − c|)·Δ)` at every texel (Float32 tolerance) and is exactly 0 outside the disc; a stroke's touched texels equal its predicted bounding box; content at the start of a 0.5 R drag moves 0.6–0.8× the drag; a 6 R straight drag moves content by ≤ 2.0 R (measured 1.8 R); a single straight drag never bisects.
- **Restore:** a 中 push then one 大 restore pass leaves ≤ 12 % of max |L| and two leave ≤ 3 %; repeated passes reach L exactly 0 everywhere (`SNAP`) within 10 passes, after which the warped CPU image equals the unwarped one bit for bit.
- **Fold guard:** fuzz 200 random sequences mixing push and restore, every size, scribbles, circles and back-and-forth scrubs. After each stamp, `fieldMinJacobian(field) ≥ LIQUIFY_MIN_DET − 1e-6` and every value is finite. Regression cases: a 小 restore line across a 4 R 大 push (folds without the guard on restore); ten 1 R pushes from one start (travel next to the start is non-decreasing and ≤ 0.6 R; the later stamps are skipped and `state` is `resisting`). The f16-rounded field keeps min det > 0.1 on the regression cases.
- **Determinism:**
  - live drawing, `sync` of the same records into a fresh model, and a revert to a prefix followed by re-applying are **bit-identical** (`Float32Array` equality);
  - a revert via patches equals a full rebuild of the prefix;
  - after patch eviction, `sync` falls back to a rebuild with the same result;
  - a live gesture's patch is kept past `PATCH_BUDGET` during the grace and evicted after it.
- **Caps and work:** `begin` returns null at 120 records and at the work cap; a gesture crossing a cap sets `state = 'capped'` and commits only the stamps before it; actual work ≥ base work, and actual work equals base work × (1 + bisection steps) per stamp.
- **No-op gesture:** a restore over an empty area commits `[]`.
- **`sync([])`** frees the buffers (`field === null`); ↶ afterwards replays to the same bits.
- **Chunked rebuild:** above `LIQUIFY_SYNC_WORK` the rebuild reports `pending`, a new `sync` during it restarts it, and the end result equals a synchronous rebuild.
- **`sanitizeStrokes`:** every rule of §5.2, including "drop the first over-cap record and all later ones", duplicate ids, and "no frame drops all".
- **`maxDisp`, `backward`:** `maxDisp` is an upper bound of `|L|` sampled densely inside the rect; `backward(o)` equals `o + L(o)` with the bilinear read.

Elsewhere:
- **`src/edit/state.test.ts`:** `editKey` is equal for the same ids with different point contents and differs for different ids (§C8.1); `withStrokes` shares the existing records by reference.
- **`src/body/field.test.ts`:** `fieldMinJacobianRect` over the full rect equals `fieldMinJacobian` on every existing fixture.
- **`src/ui/brushGesture.test.ts`:** every row of §2.5 with a fake clock, including grace boundaries at 199 and 201 ms, pinch → locked → idle, cancel versus commit, a double tap without stamps fitting, and a tap with stamps not fitting.
- **`src/ui/panelModel.test.ts`:** 推臉筆 is in both strips and is never gated (no face, 基本模式, 美體 loading, none or error); `lastSel` never holds `'brush'`; the has-value dot follows `strokes.length`; `sliderFor` returns null in brush mode.
- **`src/engine/passes/reshapeCpu.test.ts`:** a null liquify field is the identity; liquify is applied before the body field (the body field is sampled at the liquified coordinate); hash pin re-set.
- **`src/engine/pipeline.test.ts`:** `planPasses` with `liquifyOn` only gives `reshape: true`; liquify validity mirrors `bodyFieldValid`.
- **`src/store/history.test.ts`:** a v2 round trip with strokes through fake-indexeddb (`Float32Array` survives); a corrupt record is dropped by sanitize; the frame comes from the entry's `width × height`.
- **`src/geometry/view.test.ts` (step 3):** client → V → O for brush points under every flip and quarter turn and under straighten with a crop; radius conversion at zoom 1 and 5.

### 8.2 Shader port

- `tests/e2e/reshape.spec.ts`: a new case renders RESHAPE_FS on the coordinate texture with a liquify field built by `src/edit/liquify.ts` on the harness page (`tests/e2e/pages/reshape.ts`). The field comes from a fixed record list: a push across the face contour and a restore over half of it, with the body field and face warps on. The GPU map must equal `reshapeMapCpu` within 0.05 px (§C8.2), like the existing cases.
- `parity.spec.ts` (§C8.4) runs with no strokes and must stay within 1/255.

### 8.3 E2E (`tests/e2e/liquify.spec.ts`, Chromium, mobile viewport `playwright.config.ts:22-30`)

Fixture: `tests/fixtures/fullbody_lines.jpg` (already in the repo, Apache-2.0 derivative, 638 × 1000). Its door line at x = 230 runs beside the waist's left edge at x = 249 on row 419 (`fullbody_lines.json`). Positions are converted between photo px and client px through the frame rect; grabs are element screenshots (`fixtures.ts:91-95`), so distances below are in CSS px.

`fixtures.ts` gains:
- `brushDrag(page, from, to, steps)` (mouse);
- `touch(page, points[][])` (CDP `Input.dispatchTouchEvent` with two touch points, for pinch);
- `liquifyState(page)` (reads `__meiyan.liquify`);
- `emptyPng()`, moved from `body.spec.ts:43-57` (the person-free gradient with a dark line).

| # | Test | Pass condition |
|---|---|---|
| 1 | **Push moves the edge.** 美體 › 推臉筆, 中, start on the door line at row 419, drag 24 CSS px rightwards | The door line (darkest column on rows 410–430) moves right by 0.45–0.85× the drag (measured 0.63×); `mad` in a region more than 2 brush radii away < 0.5; `strokes == 1` |
| 2 | **恢復 restores.** Then 恢復, 大, two passes along the push, each starting and ending half a 大 radius beyond it | `mad` against the pre-push grab ≤ 1.0 in a box of 2 大 radii around the push; `maxDisp` ≤ 5 % of its post-push value |
| 3 | **↶ ↷** after test 1 | ↶: grab equal to before the push (`mad` ≤ 0.5) and `strokes == 0`; ↷: equal to the push grab |
| 4 | **Persisted.** Push, go back to Home, reopen the entry | Grab equal to the post-push grab (`mad` ≤ 0.5); `strokes` equal; `pending` false; `detectCalls == 0` (§C8.4) |
| 5 | **Two fingers do not draw.** Two touch points 30 ms apart, spread 80 px | The zoom-layer transform scale > 1; `strokes == 0`; ↶ still disabled |
| 6 | **Late second finger commits.** One finger draws for 300 ms, then a second lands | `strokes == 1`, one undo step, zoom changes |
| 7 | **Face tab entry and clear.** 美型 › 推臉筆 on `sample_face.png`, push the cheek, 全部清除 → 確定清除？ | `strokes == 0`; one ↶ brings the stroke back |
| 8 | **No face.** `emptyPng()`, 美型 › 推臉筆 (the strip shows 未偵測到臉部，臉型與美妝不會套用) | The item is enabled, the brush bar shows, and a push across the dark line moves it |
| 9 | **Tiled export** (extends `crop.spec.ts`, forced `TILE = 256`) with two strokes and a 90° rotation | Tiled export equals untiled within 1/255 |

### 8.4 Fixtures and licensing

No new image. The stroke fixtures `tests/fixtures/strokes_s30.json` and `strokes_cap.json` are generated deterministically by a helper in `liquify.test.ts` (our own data, no third-party content) and are used by the bench and by the replay budget test. No NOTICE change is needed.

---

## 9. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| A slider moved after strokes slides content under them (layer order, §4.5) | A pushed cheek plus a later 瘦臉 can look different from what the user expected | Strokes are local and the auto warps are smooth, so the shift is small. ↶ and 恢復 recover. A note goes in the user-facing tips; re-fitting strokes is out of scope. |
| Repeated pushes from one spot stop working (guard, §4.3) | "推不動了" | The floor is 0.2, not 0.35 (40 % more travel, measured); the ring shows `resisting`; §7 and the tips say to start further back or use a larger brush. Raising the push feel is §11 Q3. |
| JavaScript stamp cost on older iPhones | Laggy drawing, slow reopen | Per-frame stamp budget with a queue; work cap on actual work; Phase 0 rescaling rules (§6.2) |
| RG16F precision for large displacements (≈ 1 px steps at 4096 for \|L\| ≥ 0.25) | Faint jaggedness in heavily pushed areas at full resolution | Measured in the step-6 bench against Float32. Travel per stroke is bounded (≈ 1.8 R), so \|L\| stays mostly below 0.25. |
| Gesture misfires on iOS (palm, a slow second finger) | Unwanted strokes | 200 ms grace cancel; one-step undo; the locked state after a pinch |
| Memory with strokes on SE-class devices | Page killed | Lazy allocation, ≤ 5.2 MB, patch ring shrink rule (§6.2) |
| Users expect 背景保護 on the brush (醒圖 has it) | "背景歪了" complaints | §11 Q1 with a ready design; 恢復 as the workaround |
| Composition is order-dependent, so replay cost grows with history | Slow reopen after very heavy use | Work cap, chunked rebuild, patch ring for the common undo |

---

## 10. Out of scope (v0.4)

- 推臉筆 in the live camera; per-person strokes; strokes that follow later slider changes (re-fitting).
- A 力度 slider, a continuous size slider, Apple Pencil pressure, a magnifier loupe.
- Other liquify tools: bloat or pucker (放大縮小), twirl, freeze or protect masks, a symmetric face brush, edge-aware smart push.
- 背景保護 and other-person protection for strokes, unless §11 Q1 changes it.
- 恢復 reverting automatic warps, unless §11 Q2 changes it.
- Re-centring face boxes and spot markers on pushed content (needs a robust field inverse).
- Storing the computed field, and keyboard-driven brushing.

---

## 11. Open questions for the user

Each question has a default that this spec uses if the user does not answer.

1. **背景保護 on 推臉筆?** 醒圖 puts 背景保護 on its manual 瘦臉瘦身 tool, so pushing a waist does not bend a door frame behind it.
   *Default: no.* The brush moves exactly what is under it, and 恢復 fixes background bends.
   If the user wants it, the design is:
   - a 「背景保護」 chip in the brush bar, on by default, stored per stroke as `protect: true`;
   - each stamp's backward displacement is multiplied by a person weight P(x): 1 on the union of every cached person mask dilated by R/2, falling to 0 over another R/2, built once per photo on the 512 grid from the masks already cached (§C3.6). Pushing a body edge inward still works; pushing it outward into the background mostly does not;
   - with no person mask (no 美體 detection yet, or nobody found), the brush behaves as unprotected;
   - cost: one more 0.8 MB grid, and the 美體 detection must run before the first protected stroke.
2. **恢復筆 scope** (= §C11 Q2): only 推臉筆 strokes, or also the automatic 美型 and 美體 warps under the brush?
   *Default: only strokes.* The alternative costs a restore mask through every warp layer and about 10× the stamp cost (§4.5).
3. **Push feel.** Content under the brush moves about ¾ of a short drag and at most about two brush radii per stroke (default), or it sticks to the finger (gain 1: faster, but smears across the photo and hits the stretch limit sooner), or a 力度 slider is added in the brush bar?
   *Default: ¾, no slider.*
4. **Brush sizes.** Three fixed screen sizes (radius 16 / 28 / 44 px; zooming in makes the brush finer on the photo), as §C2.3 lists them? Or should 大 be larger for whole-body pushes (e.g. 64 px)?
   *Default: 16 / 28 / 44.*

---

## Appendix: contract deltas

This spec refines C in the places below. The critic applied the ones marked **applied** to `2026-10-12-v04-roadmap.md` with minimal wording changes, because C's **Role** line (C header) forbids a sub-spec to change a C decision without updating C, and these C statements were wrong as written. The rest are detail that C does not need.

1. **§C4.4 Liquify (applied):**
   - "each stamp adds −w(x)·Δ" → each push stamp **composes**: `L' = B + L∘(id + B)`;
   - "Gaussian profile" → compact `(1 − r²/R²)³`;
   - "guards each committed stroke … by bisection" → **each stamp** (push and restore) is guarded by bisection inside the operator (preview = commit = replay), floor 0.2;
   - incremental updates use copy-on-write tile patches, and undo reverts them.
2. **§C3.2 `Stroke` (applied):** points are resampled at radius/4 (the last gap shorter), not "≥ radius/4". (Not applied: one gesture may produce several records; `strength` is the stored per-stamp gain. Both are detail.)
3. **§C5.3 (applied):** a replay-work cap `LIQUIFY_WORK_CAP` next to the 120-record cap.
4. **§C4.7 / §C6.1 (applied):** liquify needs ≤ 5.2 MB (CPU mirror, patches, scratch, texture), allocated only while strokes exist; the ≤ 6 MB budget applies to photos without strokes.
5. **§C8.4 step 6 (applied):** "a push moves an edge by the drag distance" → by 0.45–0.85× the drag (content moves about ¾ of a short drag).
6. **§C2.3 (detail, not applied):** the brush bar replaces the slider row; double tap to fit stays for stamp-free taps; ↶ ↷ are disabled during a live stroke; the second-finger rule (cancel ≤ 200 ms, commit after). Brush mode joins the photo-level modes where the person strip is dimmed with 「整張照片」 (§C2.2 already hides face boxes in 推臉筆 mode).
7. **§C4.5 / §C11 (not applied):** 背景保護 is not applied to strokes in v0.4; this spec's §11 Q1 owns the question.
