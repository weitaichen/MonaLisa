# Mona Misa 美顏 v0.4 step 3: 裁切／旋轉／翻轉 and 原解析度＋PNG 匯出

- **Date:** 2026-10-12
- **Status:** draft for the user's review. Nothing here was discussed with the user yet: every choice below is a **proposal** with a default, and the real choices are listed in §11.
- **Base:** branch `feat/meiyan-pwa` at `892ea61` (v0.3.0). Line anchors below are at that commit.
- **Contract:** [v0.4 roadmap and architecture contract](2026-10-12-v04-roadmap.md) (called **C** below; "C §3.5" = its section 3.5). This file is the step-3 sub-spec C §1.2 asks for. It adds detail to C §2.1 (裁切 strip), §2.3 (裁切 mode), §2.5 (輸出 settings), §3.5 (coordinate spaces), §4.2 (P2), §4.6 (full-resolution export) and §5 (persistence). Where it refines a C decision, §3.9 lists the delta; the deltas were folded into C in the 2026-10-12 consistency pass, and the ones that are real choices are in C §12.
- **Assumes from step 1** ([選臉／選人 spec](2026-10-12-face-person-select-design.md), written in parallel): `EditState` with `photo.geometry` (C §3.2), `DetectionCache` in O-space (C §3.6), `UndoStack<EditState>` with `{clone: false}` (C §3.4), HistoryEntry v2 (C §5.1).
- **Sibling specs it stays consistent with:** [adjust-and-looks](2026-10-12-adjust-and-looks-design.md) (step 2: `uVMap` for 暗角 and 顆粒), [skin-cleanup-tools](2026-10-12-skin-cleanup-tools-design.md) (step 4: heal in O, `backMapCpu`), [face-detail-and-makeup](2026-10-12-face-detail-and-makeup-design.md) (step 5: 左／右 labels follow the screen, makeup drawn through `uWin`), [push-brush](2026-10-12-push-brush-design.md) (step 6: strokes in the warped O frame, `maxDisp(tileRectO)`).
- **Research:** `reports/醒圖 功能差距分析.md` (**GAP**), `research_notes/醒圖 功能差距分析/` (**GN**), research brief (**RB**).

## 摘要（繁體中文）

編輯器新增「裁切」分頁：自由與 1:1、3:4、4:3、9:16、16:9、原比例，以及 90° 旋轉、水平翻轉和 ±45° 拉直。裁切、旋轉、翻轉都只是最後套用的幾何變換：臉部、身體、遮罩、位移場、祛痘點與推臉筆筆畫一律存成原圖座標，旋轉照片不必重新偵測，所有效果都留在原本的人身上。
裁切分頁裡，畫面用 CSS 直接轉動整張照片，拖曳時不必重新算圖，所以很流暢；離開分頁才算出裁切後的結果。拉直為 0° 時，裁切和旋轉是逐像素複製，不會變模糊。
儲存改成預設「原始解析度」：最長邊最多 4096 像素（4:3 照片約 1,260 萬像素），格式可選 JPEG（品質 0.95）或 PNG。匯入時若原檔比 2048 大，就把原檔一起存進「最近編輯」，日後重開也能用原解析度輸出。
大圖用分塊算圖（每塊 1024 像素，邊緣多算一圈），再拼成一張輸出，以避開 iPhone 的記憶體上限；記憶體不夠的裝置、畫質「低」、或上次輸出時程式中止過，就自動改用標準解析度。輸出超過 4 秒時，按鈕會變成「分享」，再點一下即可分享；輸出途中切到別的 App 會中斷輸出並釋放記憶體。
需要你決定的事情列在 §11，例如：按住對比時要不要連裁切一起還原、「重置」要不要清掉裁切、要不要加 4:5 比例、要不要保留原始拍攝日期。

---

## 1. Goal and user-visible behaviour

### 1.1 What users expect (from the 醒圖 research)

| Finding | Source | What this spec does |
|---|---|---|
| 裁切、旋轉、翻轉 are missing from the editor; users expect them to exist. Ranked **P0**. | GAP gap table (line 27) and the P0 list (line 49) | A full 裁切 tab (§2.1) |
| 「吞画质」 (exports lose quality) is one of 醒圖's four main complaints (GAP: 「最大的抱怨之一」). Mona Misa caps import and export at 2048 (1440 on tier L), `flows.ts:7-13`. Ranked **P1**. | GAP line 11 and the P1 list (line 54) | 原始解析度 export, long edge ≤ 4096 (§2.3, §4.4) |
| 醒圖 offers JPG/PNG as a custom format plus a 高清 switch; high-resolution, uncompressed export is a paid tier (VIP 1080P, SVIP 4K). No 4K option was found on mobile. | GN `xingtu_editing_ai.md:292, 339-345`; `xingtu_product.md:92` | Free JPEG q 0.95 or PNG at up to 4096, in 設定 › 輸出 (§2.4) |
| 醒圖's 構圖調整 also has 畸變矯正 (lens distortion); perspective correction is unconfirmed. | GN `xingtu_editing_ai.md:54, 82, 106` | Out of scope (§10) |
| Mona Misa's positioning: the paid layer of 醒圖, free, on the device, at the original's quality. | GAP line 101 | Full resolution is the default (C §11 Q5) |

### 1.2 What the user gets

1. **裁切 tab** (the 8th editor tab, C §2.1). Opening it shows the **whole** photo, even if it was cropped before, with the crop box on top. The user can:
   - pick a ratio: 自由 · 原比例 · 1:1 · 3:4 · 4:3 · 9:16 · 16:9;
   - drag a corner or an edge of the box, or drag inside the box to move it;
   - set 拉直 on the slider row (−45.0°…+45.0°, 0.1° steps);
   - tap 旋轉 (90° counter-clockwise, as in iOS 照片), 翻轉 (horizontal mirror) or 還原 (undo all geometry).
   Every change is one undo step (↶ ↷). Leaving the tab shows the cropped, rotated result. The camera has no 裁切 tab (C §2.4).
2. **Edits stay on their content.** Face edits, 美體, 增高, 祛痘 spots and 推臉筆 strokes stay on the same person and the same skin after any crop, rotation or flip. A rotation runs no detector, except the one-time case in §3.6 (a sideways photo with no face found yet).
3. **儲存** exports at **原始解析度** by default: the long edge of the photo as picked, capped at 4096. A crop exports the cropped part at that density, so cropping never upscales. The format is JPEG (q 0.95) or PNG, set in 設定 › 輸出.
   - A large export shows 「正在輸出原始解析度…」 with a percentage and a 「取消」 button.
   - If it took more than 4 s, the pill turns into 「分享」 and one more tap opens the share sheet (C §4.6).
4. **最近編輯** keeps the crop and rotation (the thumbnail shows the cropped result) and, when the picked file was larger than the working copy, keeps the file itself, so a reopened photo still exports at full resolution.

### 1.3 Invariants

- **Parity:** a photo with identity geometry renders exactly as in v0.3 (C §1.1; the parity goldens of C §8.3). With identity geometry, no window and no warps, P2 is still skipped (`pipeline.ts:103-112`). Every new uniform reduces to an exact identity in IEEE arithmetic (×1, +0), so the GPU output is bit-identical even when P2 runs.
- **One resample:** crop, quarter turns, flip and 拉直 are folded into P2's sample coordinate (C §4.2). At 拉直 0° the crop is snapped to whole pixels of the render resolution, so a crop, a quarter turn or a flip is a **pixel copy** with no blur: every sample lands on a texel centre (up to fp32 rounding of the coordinate, which tests allow as 1/255).
- **No re-detection for geometry:** detections, masks, fields and strokes are in O-space (C §3.5) and are never recomputed because of a crop, flip or straighten.
- **Same look at every resolution:** kernels scale with `fullShortEdge`, the O short edge in output pixels (C §3.5). 磨皮, 銳化 and 顆粒 look the same in the 2048 preview, in a crop, in a tile and in the 4096 export.

---

## 2. UI

### 2.1 The 裁切 tab

**Strip** (BeautyPanel strip, same item component as the other tabs; it scrolls when needed):

```
自由 · 原比例 · 1:1 · 3:4 · 4:3 · 9:16 · 16:9 │ 旋轉 · 翻轉 · 還原
```

- **Ratio items** are a radio group. The icon is a rectangle drawn with that aspect (自由: a dashed square; 原比例: the photo's own aspect). The selected item gets the 1 px accent outline (DS §7.1). The ratio is written as width:height, the same convention as the camera's `RATIO_VALUE` (`state.ts:12`).
  - Tapping a ratio replaces the crop with the **largest rectangle of that aspect that fits, centred** (§3.3 `applyRatio`). This is one undo step; nothing happens if the crop already has that aspect.
  - Tapping 自由 unlocks the aspect and leaves the crop as it is.
  - The highlighted ratio is UI state (`PanelSelection.crop`), not persisted and not undoable. On entering the tab, and after ↶ ↷ and 重置, it is derived from the crop (`lockFor`, §3.3): 自由 for an uncropped photo, otherwise the ratio the crop matches within 0.5 %, otherwise 自由.
  - After a 旋轉 the lock transposes with the photo: 3:4 ↔ 4:3, 9:16 ↔ 16:9; 1:1, 原比例 and 自由 stay.
- **旋轉** rotates the photo and the crop 90° counter-clockwise (`rotateLeft`, C §3.5; `quarter' = (quarter + 3) % 4`). If a 增高 band exists, it is removed in the same undo step and the toast 「旋轉後已移除增高」 appears (C §3.5).
- **翻轉** mirrors the view horizontally (C's `flipView`). The band is kept.
- **還原** sets the geometry to identity in one undo step. It is dimmed (`aria-disabled`) when the geometry is already identity. It never touches beauty edits, except the 增高 band of a turned photo: when `upQuarter` is not 0, 還原 turns E back, so it removes the band in the same undo step with the toast 「旋轉後已移除增高」, as 旋轉 does (C §3.5).
- **拉直** is the slider row of this tab, always shown while the tab is open (it is not a strip item; delta D1 in §3.9). Label 拉直, bidirectional, −45.0°…+45.0°, step 0.1°, snap to 0 within ±0.5°, the bubble reads e.g. 「+3.5°」, and a double tap resets it to 0°. Positive values turn the picture clockwise.
- **Person strip** (step 1): dimmed, with the caption 「整張照片」 (C §2.2).

**Canvas in 裁切 mode** (the stage while the tab is open):

- `.frame` gets the class `crop-mode` and fills the whole stage (`width: 100cqw; height: 100cqh`, no `--r`), so the corners a 拉直 turns out of the E box stay visible under the scrim instead of being clipped by the frame's `overflow: hidden` (`theme.css:257-267`).
- The engine draws the photo with **identity** geometry: the full O image with every edit. The display key in this mode leaves out `photo.geometry` (§3.8 `still.ts`), so a geometry-only change (a handle drag, 拉直, 旋轉, 翻轉) draws **no** engine frame. CSS then shows it in the edit orientation: the canvas element gets `transform: rotate(θ + 90°·quarter) scaleX(flipH ? −1 : 1)`, centred in the **E box**, which is the upright frame fitted into the stage with a 24 pt inset on every side (so a handle on the photo's edge stays reachable). The layout comes from `cropModeLayout` (§3.2).
  - **Why CSS:** handle drags, moves and 拉直 drags then cost no engine frame. They run at display rate, while one full render at 2048 costs up to 33 ms (C §6.1). 旋轉 and 翻轉 animate over 240 ms with the zoomPan easing `cubic-bezier(0.22, 1, 0.36, 1)` (`zoomPan.ts:54`); there is no animation under `prefers-reduced-motion`. The rotation angle is kept unwrapped while animating, so 270° → 0° turns 90°, not back 270°.
- **Scrim:** everything outside the crop box is darkened by `rgba(0,0,0,0.55)`, drawn as a large `box-shadow` on the box. This also covers the corners a 拉直 rotation pushes out.
- **Crop box:**
  - a 1 pt white border;
  - corner handles: white L shapes, 3 pt thick and 20 pt long;
  - edge handles: 24 × 3 pt bars at the edge midpoints, shown only with 自由;
  - every handle has a 44 × 44 pt hit target, and each is a `<button>` with an `aria-label` (e.g. 「左上角」, 「上邊」; group label 「裁切框」), so zoomPan never sees it (`zoomPan.ts:82`);
  - the rule-of-thirds grid (0.5 pt white at 50 %) shows only while a handle, move or 拉直 gesture is active.
- **Gestures** (pure reducers in `src/geometry/cropModel.ts`, §3.3):
  - **corner drag:** the opposite corner stays fixed. With a ratio lock, the finger's dominant axis drives the size and the aspect is kept.
  - **edge drag** (自由 only): moves that edge.
  - **one-finger drag inside the box:** moves the box (the photo stays where it is; delta D2). The box slides along a limit instead of stopping.
  - Every gesture stops at the limits: the box must stay inside the straightened photo and inside the E frame, and must be at least 5 % of each E dimension and at least 64 px at working resolution (C §7).
  - zoomPan is off in this mode and its view is reset to identity when the tab opens (`zoomPan.ts:33-125`, `enabled` false). Pinch does nothing.
- **拉直 drag:** the box shrinks about its centre so it stays inside the rotated photo. A box that is still the **largest fit** (an untouched crop, or one just set by a ratio) follows 拉直 in **both** directions: it grows back when the angle returns toward 0°. A box the user shaped by hand only shrinks as needed (§3.3 `setStraighten`).
- **Hidden in this mode:** face boxes, the 增高 lines, spot markers and the brush (C §2.2). 按住對比 still works: it shows the unedited photo with the same CSS transform. 重置 stays.
- **Leaving the tab** (any other tab): the engine renders the V image, the frame takes the V aspect (`Editor.tsx:798` `ratio` becomes the V aspect) and zoomPan is enabled again. If the face cache is still empty and the final up-frame was never scanned, the one-time face scan of §3.6 runs now, not on each 旋轉 tap, so tapping 旋轉 three times in a row stays instant.

### 2.2 Normal mode after a crop

- The canvas holds the V image at working density (`viewSize`, §3.2). The `.frame` aspect `--r` is the V aspect (`theme.css:257-262`).
- **按住對比** shows the unedited photo **through the same geometry** (same crop, same rotation), so the framing does not jump (§11 Q1). This uses `renderOriginal` with `uGeo` (§4.2).
- **Overlays** map through `src/geometry/view.ts`:
  - **Face boxes and the person hit-test** (step 1): the face's O-space oval is mapped O→V and its axis-aligned bounding box is drawn. The number badge is never rotated or mirrored. A tap goes client → V → O.
  - **增高 lines:** they are E rows, so in V they are tilted by θ. The overlay renders inside a container rotated by θ about the mapped band centre and clipped to the frame. A drag maps client → V → E and moves along the line's normal. `HeightBandOverlay.tsx:232-235` (`yOf`: client rect → UV) becomes client → V → E (C §3.5). With θ = 0 this is the same as today.
  - **Brush** (step 6): a finger point maps client → V → O with `vToO` (geometry only: strokes live in the O frame of the warped image, push-brush spec §3.1); deltas map as vectors (the linear part of the inverse affine); the radius on screen is `r · O short edge · (V px per O px) · CSS scale`. A rotation preserves lengths.
  - **Spot taps** (step 4): client → V → O through `backMapCpu` (§4.6), because spots are content positions of the source (skin-cleanup spec A1).
  - **顯示臉部特徵點** (the debug landmark overlay, drawn by the engine on the canvas): its O-space points go through the view's O→V map (`uOToV` = `glMat3(oToV(g, {width: oAspect, height: 1}))`, applied before the present flip and mirror); the identity in 裁切 mode and in the camera.
  - **Person chips** (step 1): each face thumbnail is cut from the O bitmap and shown upright with a CSS `rotate(90°·quarter) scaleX(±1)`; θ is ignored.
- **A strong crop previews soft.** The preview is rendered at working density, so a 10 % crop of a 2048 photo is a 205 px canvas shown on a 1125 px screen. When a source exists, the export decodes it, so the file is sharp; without one (camera shots, 標準, files not kept) the export has the preview's density. This is accepted (no preview re-decode).

### 2.3 儲存 (export) flow

The pill keeps its three looks: 「儲存」, 「準備中」 and the new 「分享」.

| Plan (§3.7) | What a tap does |
|---|---|
| `working`: the export size equals the working size (standard mode, no source, camera shot, source ≤ working edge) | **Today's path** (`Editor.tsx:700-737`). For JPEG, the debounced pre-encode (`Editor.tsx:626-669`) keeps a ready file, so the share is synchronous. For PNG there is no pre-encode (a PNG encode costs more battery on every edit): the tap encodes, then shares. |
| `tiled`: a source decode larger than the working copy | 1. The stage shows `<Status spinner title="正在輸出原始解析度…" detail="{n}%">` with a 「取消」 button. The topbar's ↶ ↷, the panel and the canvas tools are `inert`. ✕ cancels, then closes. <br>2. The export runs from the user's state at the tap (as today: `snapshotField`, `Editor.tsx:538-541`). While it runs, the still session draws nothing to the display and the debounced encode/autosave (`Editor.tsx:626-669`) waits; both resume when it ends. Otherwise a preview frame or a pending autosave between two tiles would grow the FBOs back to the working size (about 50 MB more at the peak). <br>3. If it finished within 4 s of the tap, the share sheet opens at once (transient activation lasts 5 s, RB §1 #10). Otherwise the pill turns 「分享」 (accent fill) with the toast 「已準備好，點一下分享」; the next tap shares synchronously. <br>4. The file becomes the share cache (`fresh`, with the same stamp as today), so a repeated 儲存 shares it at once. It is dropped on the next edit and when the editor closes (it can be 25 MB). |

- **The debounced pre-encode** runs only when the plan is `working` and the format is JPEG. For `tiled` or PNG the debounce still renders the working-size image for the thumbnail and the autosave, but encodes no share file.
- **儲存 of a photo whose original was larger but not kept** (§3.7, plan `fallback: 'noSource'` while `sourceWidth`/`sourceHeight` exceed the working edge): toast 「此照片只保留了 {edge} 解析度」 once per editor session, where {edge} is the working copy's long edge (2048, or 1440 on tier L; `noSourceCopy`); the export is `working`.
- **Failure** (decode error, aspect mismatch, context loss, exception): one fallback to `working`, with the toast 「已改用標準解析度輸出」 (C §4.6). 「取消」 shows nothing.
- **The app goes to the background** (`visibilitychange` → hidden) during a `tiled` export: the export is aborted like 「取消」 and its memory is released at once, before the existing history flush runs (`Editor.tsx:386-393`). iOS suspends a hidden page anyway, and a hidden page holding about 140 MB is a likely target for the memory killer, which would leave a false crash breadcrumb (§3.7). On return the toast 「輸出已中斷，請再按一次「儲存」」 appears.
- **Share sheet:** `navigator.share({files: [file]})` with no title or text, so iOS offers 「儲存影像」 for JPEG and for PNG (`exporter.ts:72-86`). When the share sheet is unavailable (Chromium), the existing long-press fallback shows the full file.
- **File name:** `meiyan-YYYYMMDD-HHMMSS.jpg` or `.png`. The prefix stays (`exporter.ts:9-14`; C §3.8).

### 2.4 設定 › 輸出 (C §2.5, detailed)

A new group 「輸出」 between 「拍攝」 and 「效能」 (`Settings.tsx:92-103`):

| Row | Control | Sub-text |
|---|---|---|
| 輸出格式 | Segmented: JPEG（較小） · PNG（無損） | JPEG: 「檔案較小，適合分享」. PNG: 「PNG 檔案較大，約為 JPEG 的 3–5 倍」 |
| 輸出解析度 | Segmented: 原始解析度 · 標準（{edge}）, {edge} = the working long edge the tier decodes at: 2048, or 1440 on tier L (`standardLabel`, delta D6) | 「原始解析度：最長邊最多 4096 像素」, or the blocked reason below |

- **The control shows the effective setting.** When a block applies, the segmented control shows 標準（{edge}） as selected, while the stored pref (`'full'` by default) is kept for when the block lifts. The export resolves to `working`. `Segmented` ignores a tap on the option that is already selected (`Controls.tsx:67`), so showing the effective value is also what makes the retry below a real change. The sub-text names the reason:
  - effective tier L because the device is slow (auto tier), or an SE-class screen (375 × 667 pt, or 320 × 568 pt, which the same phones report with Display Zoom set to Larger Text): 原始解析度 is disabled (`Segmented` gains a per-option `disabled`, `Controls.tsx:47-57`), sub-text 「此裝置記憶體不足，改用標準解析度」;
  - 畫質 set to 「低」 by hand: disabled, sub-text 「畫質設為「低」時使用標準解析度」;
  - crash breadcrumb (§3.7): 原始解析度 stays **enabled**, with the sub-text 「上次以原始解析度輸出時程式中止，已改用標準解析度。再選一次「原始解析度」即可重試」. Tapping it sets the pref to `'full'` and clears `meiyan.exportCap.v1`.
- **輸出格式 applies to every save,** including the camera's review screen. `Camera.tsx:200` and `Review.tsx:49` encode with `encodeOutput(image, prefs.exportFormat)`; a camera JPEG keeps q 0.92. A camera frame is at most 1920 px, so 輸出解析度 does not apply there.

### 2.5 New strings

Strings already listed in C §2.6 (rotation band toast, re-detect, two-tap share, fallback, breadcrumb, no source) are used as written there.

| Key | 繁體中文 |
|---|---|
| tab | 裁切 |
| ratios | 自由 · 原比例 · 1:1 · 3:4 · 4:3 · 9:16 · 16:9 |
| actions | 旋轉 · 翻轉 · 還原 |
| slider | 拉直 (bubble 「+3.5°」 / 「−12.0°」 / 「0°」) |
| crop box aria | 裁切框 · 左上角 · 右上角 · 左下角 · 右下角 · 上邊 · 下邊 · 左邊 · 右邊 |
| export overlay | 正在輸出原始解析度… · {n}% · 取消 |
| export interrupted (app went to the background) | 輸出已中斷，請再按一次「儲存」 |
| context not restored in time (§7) | 畫面恢復後請再按一次「儲存」 |
| pill | 儲存 · 準備中 · 分享 |
| settings | 輸出 · 輸出格式 · JPEG（較小） · PNG（無損） · 檔案較小，適合分享 · PNG 檔案較大，約為 JPEG 的 3–5 倍 · 輸出解析度 · 原始解析度 · 標準（{edge}） · 原始解析度：最長邊最多 4096 像素 · 畫質設為「低」時使用標準解析度 · 再選一次「原始解析度」即可重試 |

---

## 3. Architecture and data model

### 3.1 `Geometry` (C §3.2) and its invariants

```ts
export interface Geometry {
  flipH: boolean;
  /** clockwise quarter turns, applied after flipH */
  quarter: 0 | 1 | 2 | 3;
  /** degrees, −45…45; positive turns the picture clockwise on screen, about the E-frame centre */
  straighten: number;
  /** in the straighten plane, normalized to the E frame (W_E, H_E); axis-aligned in the view */
  crop: Rect;
}
export const IDENTITY_GEOMETRY: Geometry = { flipH: false, quarter: 0, straighten: 0, crop: { x: 0, y: 0, w: 1, h: 1 } };
```

- **Validity:** the four crop corners lie inside the straightened image **and** inside [0,1]² (delta D3). Both regions are convex, so checking the corners is exact.
- **Minimum size:** `crop.w ≥ 0.05`, `crop.h ≥ 0.05`, and at least 64 px at working resolution on each axis.
- **Range:** `straighten` is finite and within [−45, 45], rounded to 0.1°.
- **Lives in** `edit.photo.geometry` (C §3.1). It is photo-level: under 全部 or with a person selected it is the same.

### 3.2 Coordinate math (`src/geometry/view.ts`, new, pure)

Spaces are as in C §3.5: **O** (oriented original, normalized), **E** (O after flip, then quarter turns), **V** (the crop of the straightened E), **T** (a tile of V). One more is added:

- **U**, the up frame: O rotated by whole quarter turns only (never mirrored) so that U-up equals E-up. `upQuarter(g) = g.flipH ? (4 − q) % 4 : q`. Then E = U, or E = mirror_x(U). **E rows and U rows are the same rows.**

**O → E** (an exact permutation of normalized coordinates):
- F (when `flipH`): `(x, y) → (1 − x, y)`;
- then Rq: R1 `(x, y) → (1 − y, x)`, R2 `(1 − x, 1 − y)`, R3 `(y, 1 − x)`.
- Size: `(W_E, H_E) = q odd ? (H_O, W_O) : (W_O, H_O)`.

**E → V:**
1. Pixels about the E centre: `e = (x·W_E − W_E/2, y·H_E − H_E/2)`.
2. Rotate in the plane: `p = Rot_θ e`, with `Rot_θ = [[cos θ, −sin θ], [sin θ, cos θ]]` (clockwise on a y-down screen for θ > 0).
3. Normalize: `p_n = (p + (W_E/2, H_E/2)) / (W_E, H_E)`.
4. Crop: `v = (p_n − crop.xy) / crop.wh`.

The rotation is done in pixels, so it is rigid even when W ≠ H.

**Every map is one affine.** O→E, E→V and their composition are 2 × 3 affines in normalized coordinates (type `Affine {a, b, c, d, e, f}` in DOMMatrix order). The module exposes:
- `oToE`, `eToO`, `eToV`, `vToE`, `oToV(g, oSize)`, `vToO(g, oSize)`;
- `apply(m, p)` and `applyVec(m, d)` (the linear part, for brush deltas);
- `glMat3(vToO)`: the column-major `mat3` for `uGeo`.

**Sizes:**
- `viewSize(g, oPx)` returns the V pixel size at the density of `oPx`: `round(crop.w·W_E) × round(crop.h·H_E)` in that density's E pixels.
- `snapCrop(g, oPx)`, used when θ = 0, rounds the crop edges to whole pixels of that resolution. The preview (W) and the export (decode size) each snap to their own grid; the difference is under one pixel.

**Crop-mode layout:** `cropModeLayout(stage, oSize, g, inset = 24)` returns:
- `eBox`: the E frame fitted into the stage minus the inset, in stage px;
- the canvas CSS box: the O aspect, sides swapped for odd q, centred on `eBox`;
- `transform: rotate(θ + 90·q deg) scaleX(±1)`;
- the crop box in stage px: `eBox.xy + crop.xy·eBox.wh`.

Because the crop is axis-aligned in the plane, the box is axis-aligned on screen.

### 3.3 Actions (pure reducers: `view.ts` for geometry, `cropModel.ts` for gestures)

| Function | Result |
|---|---|
| `rotateLeft(g)` | `quarter' = (q + 3) % 4`, θ kept. The crop follows the content: `x' = y`, `y' = 1 − x − w`, `w' = h`, `h' = w`. (Rotating the whole plane commutes with Rot_θ, so containment is kept.) |
| `flipView(g)` | C §3.5 canonical form: `flipH' = !flipH`, `quarter' = (4 − q) % 4`, `θ' = −θ`, `crop.x' = 1 − crop.x − crop.w`. `upQuarter` is invariant. |
| `maxFit(θ, W_E, H_E, a)` | The largest centred crop of pixel aspect `a`: `h = min(W_E / (a·c + s), H_E / (a·s + c), H_E, W_E / a)`, `w = a·h`, with `c = cos|θ|`, `s = sin|θ|`. It is returned normalized. |
| `isMaxFit(g, oSize)` | The crop equals `maxFit` for its own θ and aspect, centred, within 1e-4 |
| `setStraighten(start, θ, oSize)` | From the geometry at gesture start. If `isMaxFit(start)`, the crop is `maxFit(θ, …, aspect of start.crop)`; otherwise it is `cropConstrain` of `start.crop` at θ. Every move of one drag starts from `start`, so returning to the start angle restores the start crop. |
| `cropConstrain(g, oSize)` | 1. If the crop centre is outside the valid region, move it along the segment toward the E centre until it is inside (bisection, 24 steps). <br>2. Shrink about the centre to the largest scale ≤ 1 that is valid (bisection, 24 steps). <br>3. If that is below the minimum size, move the centre toward the E centre until the minimum fits. <br>The aspect is kept. The result is valid and idempotent. |
| `applyRatio(g, lock, oSize)` | `crop = maxFit(θ, W_E, H_E, aspect(lock))`, centred. 自由 returns `g` unchanged. |
| `dragCorner(start, corner, dPlane, lock)` | The anchor is the opposite corner. With a lock, the dominant axis sets the size and the other follows the aspect. Then bisection on the scale from the anchor (24 steps) until the crop is valid; then the minimum size. |
| `dragEdge(start, edge, dPlane)` | 自由 only. Bisection on the edge position. |
| `dragMove(start, dPlane)` | Bisection on the fraction of the delta; then the remaining delta is tried on x alone and on y alone, so the box slides along a limit. |
| `resetGeometry()` | `IDENTITY_GEOMETRY` |
| `lockFor(g, oSize)` | 自由 for the full-frame crop; otherwise the first of 原比例, 1:1, 3:4, 4:3, 9:16, 16:9 whose aspect matches within 0.5 %; otherwise 自由 |

Other rules:
- **Edit-state reducers** (`src/edit/state.ts`): `rotateLeft` also sets `photo.heightBand = null`; `flipView` keeps it. Each reducer returns a new `EditState` and is one undo step, as in C §3.4.
- **Gestures in the Editor** follow the slider pattern: `update(edit, false)` while moving and `update(edit, true)` on release (`Editor.tsx:169-180`).

### 3.4 Up-dependent computations run in U (refines C §3.5)

C puts the row bands and the body measure in E. They are computed in **U**, which has the same rows and the same "up", and is never mirrored (delta D4):
- **Body field:** cached O poses are mapped O→U, the measure and the field are built on a U grid, and the grid goes back to O with an exact texel permutation and the vector components rotated.
- **Field rebuilds:** `BodyFieldMemo` (`editorModel.ts:235`) keys on `upQuarter(g)`, not on `flipH`, so a 翻轉 never rebuilds the field.
- **Bands:** `photo.heightBand` stays "rows in E" (C §3.1). E rows = U rows, so nothing about its storage changes.

### 3.5 What each artifact does under geometry and full resolution

| Artifact | Stored in | 裁切 / 拉直 | 旋轉 | 翻轉 | Full-resolution export |
|---|---|---|---|---|---|
| Face landmarks, boxes, persons (`DetectionCache.faces`, C §3.6) | O, raw 478 | Unchanged. The boxes are mapped O→V for display. | Unchanged. Re-detect only when the cache has no face (§3.6). | Unchanged | Same normalized data. Every face warp uses the same `oAspect` (§4.1: the working bitmap's width/height, never a buffer's or the decode's), so the shapes are identical. |
| Body poses and masks (`bodies`) | O | Unchanged | Unchanged. The measure is re-derived in the new U (cheap, no detector). | Unchanged | Same |
| 美體 field (RG16F, 256) | O texture, built in U | Unchanged | Rebuilt (new U). Band cleared. | Unchanged (U invariant) | Same texture, sampled at O coordinates |
| 瘦臉 limit (`FaceProtect`, R16F) | O | Unchanged | Unchanged | Unchanged | Same |
| 增高 band | E rows | Unchanged; lines tilt by θ in the view | **Cleared** (toast) | Kept | Same |
| 長腿 | photo value + `legsAnchor` | Unchanged | Re-measured in U | Unchanged | Same |
| 祛痘 spots (step 4) | O content positions of the source | Kept even when cropped away (C §7) | Kept | Kept | Healed in O before P1 (skin-cleanup spec A1); the tile window grows around each spot that meets it (its A5) |
| 推臉筆 strokes (step 6) | O frame of the warped image | Kept | Kept | Kept | O-space liquify field, sampled at `o`; no windowing |
| Makeup | O mesh | — | — | — | Drawn per tile through `uWin` |
| `左右分開` (step 5) | Per person, by side of the face in O | Values stay on their side of the face. The 左／右 labels follow the screen (C §11 Q6), so after a 翻轉 the value set under 左 is shown under 右. | Same rule | Same rule | — |
| Thumbnail (`HistoryEntry.thumb`) | V | Shows the crop | Shows the rotation | Shows the flip | — |
| `HistoryEntry.original` | O, working JPEG | Uncropped, so 還原 works after a reopen | — | — | Not used when a source exists |

### 3.6 Detection in a rotated frame (C §3.5 "sideways photos", made concrete)

- **Faces:** whenever the editor is in **normal mode** (so on leaving the 裁切 tab, or after a ↶ ↷ in another tab) while `DetectionCache.faces` is empty, a tracker exists, `faceScans` holds the upright answer and has no entry for the current `upQuarter` (delta D12: C §3.5 says "after a 旋轉 action"; scanning per tap would block each tap for up to 1.5 s while the user is still turning the photo). A cache without the upright answer (a 基本模式 cache reopened with a tracker, or one 美體 wrote while the tracker could not answer, step-1 spec §7) forces no scan: the session's own detection asks upright first, and its re-detects retry it:
  1. Make U from the working bitmap: an `OffscreenCanvas` of the U size, `imageSmoothingEnabled = false`, `drawImage` with the quarter-turn transform (an exact permutation, about 12.6 MB at 2048), then `createImageBitmap`. The canvas is released at once.
  2. Run `detectImage(u, {maxFaces: EDIT_DETECT_FACES})` (step-1 spec §3.5, the same `numFaces` as the first detection) behind the status 「正在重新偵測臉部…」.
  3. Map every landmark (x, y) U→O exactly; z is unchanged. The yaw proxy uses isotropic pixel distances (`adapter111.ts:93-104`), so it is rotation-invariant and `adapt` on O landmarks is correct.
  4. Append `{quarter: upQuarter, flipH: false}` to `faceScans`. A scan counts for both flip states (a mirror does not change detectability).
  5. New persons enter through `rebase` (C §3.4, §7). Undoing the rotation keeps them; the cache only grows.
  A cache that has faces is never re-detected (C §3.5).
- **Bodies:** body detection (first 美體 open) runs on the U image of the geometry at that time, and the poses and masks are mapped U→O exactly. If the result is "nobody" (`bodies = []`) and the user later rotates to a U not yet scanned, the next 美體 open runs body detection once more on that U. This needs `DetectionCache.bodyScans?: Quarter[]`; absent means `[0]` (delta D5). The first detection on a cache records only its own U (before it, with `bodies` null, no U was tried). The same holds for the cache 美體 writes before the first face answer while the tracker cannot give one (step-1 spec §7). `normalizeDetect` (step-1 spec §5.4) keeps it only as an array of distinct integers 0–3 and otherwise drops it (= `[0]`).
- **Selfie segmenter** (the 瘦臉 limit's mask, `Editor.tsx:571`): when it first runs, it runs on the U image of the geometry at that time too, and its mask is mapped U→O by the same exact permutation. Like every cached artifact, it is never recomputed because the geometry changed later.

### 3.7 Export model (`src/media/exportPlan.ts`, new, pure)

```ts
export type ExportFormat = 'jpeg' | 'png';
export type ExportSize = 'full' | 'standard';
export type FullBlock = 'tierL' | 'tierLow' | 'device' | 'guard' | null;

export interface SourceInfo {
  /**
   * the source to export from: on reopen HistoryEntry.source; in the first session the picked File, but only when
   * shouldKeepSource accepted it (so the first session and every reopen export the same); null = none
   */
  blob: Blob | null;
  /** oriented size from probeSize; null = unknown (v1 entries, camera shots) */
  width: number | null;
  height: number | null;
}
export interface PxRect { x: number; y: number; w: number; h: number }
export interface TileJob {
  /** V output pixels this tile writes (integers, the tiles partition V) */
  out: PxRect;
  /** V pixels the GPU buffers cover: out ⊕ kernel apron, snapped outward to multiples of 4, THEN clipped to V */
  buf: PxRect;
  /** decode pixels the source crop covers: bbox(Geo⁻¹(buf)) ⊕ displacement bound ⊕ 4, snapped outward to multiples of 4, THEN clipped to the decode */
  win: PxRect;
}
export interface ExportPlan {
  mode: 'working' | 'tiled';
  format: ExportFormat;
  /** JPEG only: 0.95 when the size pref is 'full' (whatever the mode), 0.92 for 'standard' */
  quality: number;
  /** V output size in pixels */
  width: number;
  height: number;
  /** 'tiled': the size the source is decoded at (long edge min(source, FULL_EXPORT_MAX_EDGE)) */
  decode: { width: number; height: number } | null;
  /** O short edge in output pixels (kernel scale, C §3.5) */
  fullShortEdge: number;
  tile: number;
  tiles: TileJob[];
  /** why the plan is 'working' while the size pref is 'full', for the copy; null otherwise */
  fallback: 'noSource' | 'notLarger' | FullBlock;
}
```

**`fullExportBlock(env)`**, where env = `{prefTier, autoTier, screen, capped}`:
1. `'tierLow'` when the user set 畫質 低;
2. `'tierL'` when the auto tier settled on L;
3. `'device'` for an SE-class screen (`screen.width × screen.height` = 375 × 667, or 320 × 568, in either orientation). The SE 2/3 report 320 × 568 with Display Zoom set to Larger Text, a size no iOS 18 phone has natively; the 12/13 mini zoomed report 320 × 693 and are not SE-class;
4. `'guard'` when `meiyan.exportCap.v1` is set;
5. otherwise null.

**`planExport(edit, prefs, source, working, env, bounds)`:**
1. If the size pref is 'standard', or a block applies, or there is no source blob, or the source long edge ≤ the working long edge → `working`. The size is `viewSize(g, working)`; this is exactly today's export (`Editor.tsx:615-620`). On tier L that is 1440, as today (delta D6).
2. Otherwise `tiled`:
   - `decode = fitLongEdge(source, FULL_EXPORT_MAX_EDGE)` (`importer.ts:16-26`);
   - `width × height = viewSize(snapCrop(g, decode), decode)`;
   - `fullShortEdge = min(decode)`;
   - tiles from §4.4.

**Source retention** (`shouldKeepSource`, pure; C §4.6):
- Keep the picked `File` when all of these hold: the probed long edge > the working edge, `file.size ≤ 30 MB`, and `navigator.storage.estimate()` reports `quota − usage ≥ 3 × file.size`.
- When `estimate` is missing or throws, keep it only if `file.size ≤ 10 MB`.
- `sourceWidth` and `sourceHeight` are recorded **whenever** the probed size exceeds the working edge, also when the file is not kept. That is how the editor knows to show 「此照片只保留了 {edge} 解析度」.
- A file that is not kept gives `SourceInfo.blob = null` in the first session too: the first session exports like every later reopen, as C §4.6 says ("Otherwise there is no source"). The one exception is the add's retry without the file (§5): when the add drops a kept file, the current session keeps exporting from the in-memory file, and a reopen exports `working` with the note.
- The decision runs once per import, in `writeHistory` before the `addEntry` that creates the entry (`Editor.tsx:299-318`); the editor keeps the `File` reference until then (it is file-backed, so it costs no pixel memory).
- The probe comes from the import itself: `importPhoto` gains a sibling `importPhotoInfo(file, edge) → {bitmap, oriented: {width, height}}` (`importer.ts:4-13, 49-84`), so there is no second header read.
- Camera shots carry no source (the frame is ≤ 1920 and is already `original`).

**Crash breadcrumb** (C §4.6):
- Before a `tiled` export, `localStorage['meiyan.exportGuard.v1'] = {at: Date.now(), w, h, format}` is written synchronously. It is removed on success, on a caught failure, on 取消 and on the background abort (§2.3).
- At launch, if a guard is found: remove it, set `meiyan.exportCap.v1 = 2048`, and show the breadcrumb toast once.
- Choosing 原始解析度 in 設定 removes the cap (§2.4).
- Every storage access is in try/catch (`settings.ts:59-82`).

**Test knob** (works in the production build that e2e runs, `playwright.config.ts`): `localStorage['meiyan.debug.export.v1'] = {tile?: 256|512|1024|2048, slowMs?: number, failAt?: 'decode' | 'tile' | 'encode'}` is read once per export. It only changes the tiling grain, adds a delay, or injects a failure; it never changes the output.

### 3.8 Files to add and change

| Area | Change |
|---|---|
| `src/geometry/view.ts` (new) | §3.2, §3.3: spaces, affines, `viewSize`, `snapCrop`, `upQuarter`, `maxFit`, `cropConstrain`, `rotateLeft`, `flipView`, `setStraighten`, `applyRatio`, `lockFor`, `cropModeLayout` |
| `src/geometry/cropModel.ts` (new) | `dragCorner`, `dragEdge`, `dragMove`, `CropLock`, `lockAspect`, `transposeLock` |
| `src/media/exportPlan.ts` (new) | §3.7: `planExport`, `fullExportBlock`, `shouldKeepSource`, tile planner (§4.4), guard and cap helpers |
| `src/media/exportFull.ts` (new, C §3.8) | The tile runner (§4.4) against a `TileRenderer` interface, so it is unit-testable with fakes |
| `src/media/exporter.ts:5-26, 99-129` | `outputFileName(format, d)` (`jpegFileName` stays as a wrapper); `encodeOutput(img, format, quality)`; `encodePng`; `createSurface(w, h, {type, alpha: false})`, where today the JPEG type is hard-coded at `:106` and `:122` |
| `src/media/importer.ts:4-13, 49-84` | `importPhotoInfo` returning the oriented probe size |
| `src/config/limits.ts` (step 1 creates it) | `FULL_EXPORT_MAX_EDGE = 4096`, `TILE_DEFAULT = 1024`, `GL_TILE_BUDGET_MB = 40`, `SOURCE_MAX_MB = 30`, `SHARE_WINDOW_MS = 4000`, `MIN_CROP_FRAC = 0.05`, `MIN_CROP_PX = 64` |
| `src/types.ts:276-292` | `RenderInput.geometry`, `sourceWindow`, `output` (C §4.1) |
| `src/types.ts:303-328` | `Engine.renderTile(input, read: PxRect): ImageData`; `renderOriginal` takes `geometry`; `Engine.releaseBuffers()` |
| `src/types.ts:370-377` | `Prefs.exportFormat: 'jpeg' \| 'png'`, `Prefs.exportSize: 'full' \| 'standard'` |
| `src/types.ts:379-405` | `HistoryEntry.source`, `sourceWidth`, `sourceHeight` (C §5.1) |
| `src/types.ts:409-421` | `DebugState.renderCount` (display frames the engine drew; FBO exports do not count) and `DebugState.export: {mode, width, height, tiles, ms} \| null`, for e2e. Step 1's `boxes` become V-normalized (as drawn). |
| `src/edit/state.ts` (step 1 creates it) | Edit-state wrappers for the geometry reducers: `rotateLeft` clears `heightBand`, `flipView` keeps it, `resetGeometry`. `sanitizeEditState(raw, personIds, oSize?)` gains the O size (`HistoryEntry.width/height`), because crop validity at θ ≠ 0 depends on the aspect; without it (the camera look) the geometry is identity (delta D13). It is the same `{width, height}` that step 6 carries as `EditorSource.frame` (`LiquifyFrame`, push-brush spec §3.3), so `openState` returns it once and both steps read it. |
| `src/engine/index.ts:54-63, 174-194, 220-258` | The job carries `win`, `tile`, `geo`, `oAspect`, `srcSize`, `fullShortEdge`; `render` sizes the canvas to V; `renderTile`; `renderOriginal` with geometry; `releaseBuffers` shrinks every pipeline FBO (A–D, M, N) and the src texture to 1 × 1 |
| `src/engine/pipeline.ts:53-75, 103-112, 343-357, 382-461` | `FrameJob` fields; `planPasses` adds `windowed` and `geoIdentity`; buffer sizes per pass (§4.3); mean and sharpen steps from `fullShortEdge` |
| `src/engine/uniforms.ts:18-26, 50-71` | `viewSize`-based processing size; `meanStep(buf, fullShortEdge, axis)`, `sharpenTexel(buf, fullShortEdge)` |
| `src/engine/passes/reshape.ts:214-319, 333-406`; `reshapeCpu.ts` | `uGeo`, `uTile`, `uWin`; `uAspect = oAspect` passed explicitly (today `dst.width / dst.height`, `reshape.ts:356`); `displacementBound`; CPU port with geometry and window; hash pin re-set (C §8.2) |
| `src/engine/passes/mask.ts:33-38`, `makeup.ts:56-67` | `uWin` in the vertex shaders |
| `src/engine/shaders/present.ts:6-21` | `uGeo` for 按住對比 in normal mode |
| `src/engine/shaders/composite.ts:158-201` | No shader change in step 3. Step 2's `uVMap`, `uVAspect` and `uGrainScale` (adjust-and-looks spec §4.4–4.5) are fed from `output.tile`, the V aspect, and the whole V size in output pixels divided by `cellPx = fullShortEdge/1080`, so 暗角 and 顆粒 are tile-safe |
| `src/engine/backMapCpu.ts` (new) | `backMapCpu(v, frame) → o`: the single CPU implementation of P2's backward map (Geo⁻¹, liquify in step 6, body field, the multi-face chains with caps and protect). Shared with step 4's spot taps, where the skin-cleanup spec §3.4 calls it `cpuSample(v, input)`. |
| `src/app/still.ts:6-118, 267-274` | `viewSize`; `setViewMode('crop' \| 'normal')`: crop mode draws identity geometry, and its display key leaves out `photo.geometry`; `pauseDisplay(on)`, held during a tiled export (no display frame, the last one stays on screen); `exportImageData` (always V, from `edit.photo.geometry`, in either mode); `tileInput(edit, field)`; `bounds()` for the planner. `session.width/height` stay the working size: `writeHistory` records them as the size of `original` (`Editor.tsx:299-311`), and only the frame ratio uses `viewSize`. |
| `src/store/history.ts:27-45, 161-180, 236-252` | Copy and validate `source`, `sourceWidth`, `sourceHeight`. `withStore` swallows every error today (`history.ts:236-252`); it gains an `onError(err)` hook so that `addEntry` sees a `QuotaExceededError`, skips the reconnect retry for it, and puts the entry once more without `source` (same id). Any other failure keeps the reconnect retry with the file; when that fails too, the entry is put once more without `source` as well. |
| `src/store/settings.ts:13-20, 42-57` | Default prefs `exportFormat: 'jpeg'`, `exportSize: 'full'`; sanitize; guard, cap and debug keys |
| `src/ui/state.ts:27-40` | `EditorSource.source: SourceInfo` |
| `src/ui/flows.ts:16-45`, `Home.tsx:86-104` | Carry the source on import and on reopen |
| `src/ui/screens/Editor.tsx` (`:58-68`, `:203-212`, `:290-318`, `:386-393`, `:615-737`, `:798`, `:830-841`) | Crop mode, geometry reducers, plan-based encode and save, export overlay, two-tap pill, source on `addEntry`, frame ratio; the debounced encode/autosave waits while a tiled export runs; `visibilitychange` → hidden aborts a tiled export before `flushHistory` |
| `src/ui/components/CropOverlay.tsx` (new, C §3.8) | Scrim, box, handles, grid, gestures |
| `src/ui/theme.css:257-267` | `.frame.crop-mode` fills the stage |
| `src/ui/components/HeightBandOverlay.tsx:232-235` | Client → V → E; container rotated by θ |
| `src/ui/components/Slider.tsx:15-31`, `panelModel.ts:457-466` | `SliderBinding.scale?: {min, max, step, snap, suffix}`, default today's 0–100 or −50…+50; `dragValue` and `formatDisplay` honour it |
| `src/ui/panelModel.ts:22-34` | `TabId += 'crop'`; `PanelSelection.crop: CropLock`; strip items |
| `src/ui/components/BeautyPanel.tsx:145-147` | The 裁切 tab; ratio icons |
| `src/ui/screens/zoomPan.ts:33-125` | Disabled and reset in crop mode |
| `src/ui/screens/Settings.tsx:92-103`, `Controls.tsx:47-57` | 輸出 group showing the effective 輸出解析度 (§2.4); `Segmented` per-option `disabled` |
| `src/ui/screens/Camera.tsx:200`, `Review.tsx:49` | `encodeOutput(image, prefs.exportFormat)` |
| `src/ui/icons.tsx` | `rotateLeft`, `flipH`, `ratio` (parametric rectangle), `free` |
| `src/bench/main.ts` | Export rows (§6.2) |
| `tests/e2e/pages/export.html`, `export.ts` (new, dev server) | Tile-equivalence harness (§8.2) |

### 3.9 Deltas to the contract (folded into C in the 2026-10-12 consistency pass)

| # | C section | Refinement |
|---|---|---|
| D1 | §2.1 裁切 strip | 拉直 is the tab's permanent slider row, not a strip item |
| D2 | §2.3 裁切 row "drag the image inside the crop" | The photo stays fixed and the crop box moves; there is no pinch or auto-zoom in 裁切 mode (§11 Q4) |
| D3 | §3.2 `Geometry.crop` comment | The crop also lies inside [0,1]² of E. Positive θ is clockwise. 旋轉 is counter-clockwise. |
| D4 | §3.5 "computed in E" | Computed in **U** (rotation only). E rows = U rows; the body field never rebuilds on a flip. |
| D5 | §3.6 `DetectionCache` | Optional `bodyScans`; body detection runs on U; one body re-scan after a rotation when nobody was found |
| D6 | §1.2 step 3 "Tier L … export at 2048, as today" | `standard` is today's working path: 2048, or **1440** on tier L |
| D7 | §4.6 `maxDisp` "33 × 33 grid of the CPU ports" | An analytic upper bound (§4.4), which a grid can undercut; tested against a dense CPU-port grid |
| D8 | §4.6 breadcrumb | The cap is lifted when the user chooses 原始解析度 again in 設定 |
| D9 | §4.6 tiles | TILE adapts to a 40 MB GPU budget (2048, then 1024, 512, 256) instead of a fixed 1024 |
| D10 | §3.8 file table | Adds `exportPlan.ts`, `cropModel.ts`, `Camera.tsx:200`, `Review.tsx:49` (輸出格式 also applies to camera saves) |
| D11 | §4.6 kernel apron "mean 2·3.5·4·k plus sharpen k" | `ceil(14·k) + 2`: the H and V mean passes act on different axes, so their reach per axis is 14·k, not 28·k, and the sharpen reach k lies inside it (§4.4). C's value is safe but costs about 25 % more GPU memory per tile. |
| D12 | §3.5 "when a 旋轉 action leaves the face cache empty" | The scan runs when normal mode shows an unscanned up-frame (on leaving 裁切, or after ↶ ↷), not on each 旋轉 tap (§3.6) |
| D13 | §3.2 `sanitizeEditState(raw, personIds)` | Gains an optional `oSize`; without it the geometry is identity (§3.8, §5) |

---

## 4. Engine and shader changes

### 4.1 Job fields

`FrameJob` (`pipeline.ts:53-75`) gains:

```ts
/** O-normalized rect the uploaded src covers; preview [0,0,1,1] */
win: [number, number, number, number];
/** V-normalized rect the processing buffers cover; preview [0,0,1,1] */
tile: [number, number, number, number];
/** V → O affine, normalized, column-major mat3; identity when the geometry is identity */
geo: Float32Array;
geoIdentity: boolean;
/**
 * the iso metric of every face warp, the protect budget and the face table: the WORKING bitmap's width / height,
 * the same number for the preview, every tile and the export (v0.3's uAspect and the editor's bodyAspect,
 * Editor.tsx:147). Never the decode's aspect, which differs by rounding: a different number would move the warps.
 */
oAspect: number;
/** src pixel size (the window) and V buffer pixel size */
srcSize: Size;
size: Size;
/** O short edge in output pixels; k = fullShortEdge / 720 (uniforms.ts:48) */
fullShortEdge: number;
```

- **Preview:** `win = tile = [0,0,1,1]`, `geo` from `edit.photo.geometry` (identity in 裁切 mode), `size = viewSize(g, W)` capped by `maxSize` (`index.ts:58-62`), `fullShortEdge` = the working bitmap's short edge.
- **Identity geometry:** `size` = the source size and `fullShortEdge = min(size)`, which is exactly today's `meanScale` (`uniforms.ts:50-52`); `oAspect` equals today's `job.size.width / job.size.height`, so the P2 and maskWarp aspect is bit-identical.
- **Tile:** `fullShortEdge` = the decode's short edge; `oAspect` unchanged.

### 4.2 Pass by pass

| Pass | Change | Buffer |
|---|---|---|
| P0 mask (`mask.ts:33-38`) | VS: `vec2 q = (aPos − uWin.xy) / uWin.zw; gl_Position = vec4(q·2 − 1, 0, 1)` | M: ¼ of `srcSize` |
| P1 makeup (`makeup.ts:56-67`) | VS: the same window map applied to the landmark position (`aPos` is `landmark·2 − 1` today). The copy and `uInvDst` read the window-sized base. | A: `srcSize` |
| P2 reshape (`reshape.ts:286-318`) | See the code below | B: `size` |
| maskWarp | The same program with src = M (window, ¼). `aspect` = `oAspect`, no longer `job.size` (`pipeline.ts:420`). | N: ¼ of `size` |
| Step-4 passes in O (skin-cleanup spec A1–A2) | Heal P0b, the R target and retouch P0d are drawn per tile through `uWin`, like P0. The tone field P0c is one global texture built at working resolution from `RenderInput.toneSource`, never per tile (skin-cleanup spec §4.6). | window-sized |
| P3/P4 mean (`pipeline.ts:343-357`) | `meanStep(size, fullShortEdge, axis)`: unit = `4 · fullShortEdge / 720` px, step = unit / buffer px | C, D: `size` |
| P5 composite | `uTexel = sharpenTexel(size, fullShortEdge)` (`pipeline.ts:454`). 暗角 and 顆粒 take absolute V through step 2's `uVMap` (V = vUv·uVMap.xy + uVMap.zw), set from `output.tile`, with `uGrainScale` = the whole V size in output pixels (`output.pixelSize / output.tile.wh`) divided by `cellPx = fullShortEdge/1080` (adjust-and-looks spec §4.4–4.5). | canvas or FBO |
| present / 按住對比 (`present.ts:16-21`) | `texture(uSrc, (uGeo * vec3(vUv, 1)).xy)`; identity in 裁切 mode and in the camera | canvas |

P2 after this step:

```glsl
uniform mat3 uGeo;   // V → O, normalized
uniform vec4 uTile;  // buffer uv → V
uniform vec4 uWin;   // O → src uv
...
vec2 v  = uTile.xy + vUv * uTile.zw;
vec2 o  = (uGeo * vec3(v, 1.0)).xy;
vec2 tc = o;
// step 6: tc += texture(uLiqDisp, o).xy   (push-brush spec §4.4)
if (uBodyOn != 0.0) tc += uBodyOn * texture(uBodyDisp, tc).xy;   // C §4.2 D_body(tc); today at vUv, which equals tc here at identity
// face chain(s) and protectContour on tc, unchanged (O-space, uAspect = oAspect)
outColor = texture(uSrc, (tc - uWin.xy) / uWin.zw);
```

- **Parity:** with identity `uGeo`, `uTile = uWin = (0, 0, 1, 1)`, every new operation is ×1 or +0, which are exact in fp32, so the output equals v0.3 bit for bit. `RESHAPE_FS` changes, so its hash pin (`reshapeCpu.test.ts:31`) is re-set in this step with the CPU port updated in the same commit (C §8.2).
- **Edges:** sampling keeps `CLAMP_TO_EDGE` (`gl.ts:105-128`). A valid crop never maps outside O, so clamping only happens where a warp reaches past the image edge, as today.

### 4.3 When P2 runs, and buffer sizes

- `planPasses` (`pipeline.ts:103-112`) adds two inputs: `geoIdentity` and `windowed` (`win ≠ tile` as rectangles). Then `reshape = (faceOn && reshapeActive) || bodyOn || liqOn || !geoIdentity || windowed`.
- With identity geometry and no warps, P2 is skipped and composite samples src directly (O = V), as today.
- In a tile, P2 always runs: it is the window → buffer resample. With identity geometry, `win` and `buf` lie on the same pixel grid, so every sample is a texel centre (up to fp32 rounding) and the copy has no blur.
- **The FBO output** (`pipeline.ts:433-441`) keeps today's rule (whichever of A and B is not the composite input). A is resized from `srcSize` to `size` once P2 has read it.

### 4.4 Tiled render (`exportPlan.ts` planner, `exportFull.ts` runner)

**Kernel apron**, in V pixels, per side (C §4.6), rounded up to a multiple of 4:

```
apronV = ceil(14·k) + 2,   k = fullShortEdge / 720
```

- **Mean:** the outermost tap of one pass sits at 3.5 × 4·k = 14·k px along that pass's **own** axis (`MEAN_TAP_OFFSETS`, `MEAN_SPACING`, `uniforms.ts:42-61`). P3 is horizontal and P4 vertical (`pipeline.ts:343-357`), so D at a pixel depends on B inside a box of ±14·k px per axis, not ±28·k (delta D11). Each pass's bilinear tap adds at most 1 px, hence the +2.
- **Sharpen:** P5 reads B at ±k px (`composite.ts:173-185`), inside the same box, so it adds nothing. The composite reads D, M and N at the pixel itself.
- At a 4096 × 3072 decode, k ≈ 4.27 and `apronV` = 62 → **64** px.
- The heal (step 4) runs in O before P1 (skin-cleanup spec A1, A5), so it grows the **window** around each spot instead of the apron (`spotWindowGrowth`, a planner hook step 4 fills). Only if the user picks the alternative of skin-cleanup spec §11 Q2 (heal after the warp, in V) would its radius join `apronV`.

**Displacement bound** (delta D7). The window must contain every sample `tc` of every buffer pixel. The backward map is `tc = o + D_liq(o)`, then `+ D_body`, then the face chains. So:

```
|tc − o| ≤ L + B + Σ_{f near the tile} F_f
```

- **Units:** every term is in decode pixels. A UV vector (dx, dy) counts as `hypot(dx·W_dec, dy·H_dec)`; an iso length counts as `iso · W_dec` (iso units are fractions of the width on both axes, `reshape.ts:236`).
- `B` is the maximum vector length over the body field's texels; a bilinear field never exceeds its largest texel. `L` is the liquify model's `maxDisp(tileRectO)`: the maximum over the texels covering the tile's O region, plus one texel (push-brush spec §4.4).
- `F_f = displacementBound(face_f, u_f)` (`reshape.ts`, new) is the sum of each active warp's largest move:
  - `curveWarp`: `|t − o|·d`;
  - `enlargeEye` and `scaleAround`: `R·|d|`;
  - `shiftAround`: `|disp|`;
  - plus the step-5 warps when they exist. The influence cap (C §4.3), the 瘦臉 limit and the yaw attenuation only scale moves down, so the bound ignores them.
- "Near" means the face's `uBox`, grown by `F_f`, intersects the tile's O region (grown by `L + B`).
- A unit test (§8.1) checks the bound against the CPU port's measured maximum on a dense grid.

**Planner:**
1. **Tile size:** the largest `TILE ∈ {2048, 1024, 512, 256}` whose worst tile meets the GL budget: `(2·win² + 3·buf²) · 4 B ≤ 40 MB`, counting src and A at window size and B, C, D at buffer size. While a step-4 pass runs, B also holds an O-space result at window size, so the budget is `(3·win² + 2·buf²) · 4 B ≤ 40 MB` (skin-cleanup spec §4.6). The default is 1024 (C §4.6). The test knob can force a size.
2. **Outputs:** `out` tiles partition V in row-major order; tile origins are multiples of 4.
3. **Buffers:** `buf = out ⊕ apronV`, snapped outward to multiples of 4, **then** clipped to V. The order matters: clipping last means a buffer never holds pixels beyond the V edge, so at a true V edge the mean clamps exactly where the untiled render clamps (a buffer reaching past the crop would read real photo content there instead).
4. **Windows:** `win` = the bounding box of `Geo⁻¹` applied to the 4 corners of `buf` (the map is affine, so the image of a rectangle is a parallelogram and the corners give its exact bounding box), grown by the displacement bound, plus 4 px (one texel of the ¼-resolution masks M and R, which also covers the bilinear taps of src); snapped outward to multiples of 4, **then** clipped to the decode frame. Clipping last keeps the crop inside the bitmap: a `createImageBitmap` crop rectangle that reaches past the bitmap is filled with transparent black, which `CLAMP_TO_EDGE` would then smear into the image edge.
5. **Grids:** aligned origins make the ¼-resolution M and N grids coincide with an untiled render's grids whenever the decode and V sizes are multiples of 4 (true for iPhone photos: 4032 × 3024, 5712 × 4284 decoded to 4096 × 3072). Otherwise the untiled ¼ grid is not exactly 4 px per texel and tiles differ by ≤ 2/255 on the feathered masks (§8.2, §9).

**Runner** (`runTiledExport(renderer, sourceBlob, plan, input, {signal, onProgress})`):
1. Write the breadcrumb.
2. Decode: `full = importPhoto(source, FULL_EXPORT_MAX_EDGE)`. This uses the same importer as the import (EXIF orientation via `imageOrientation: 'from-image'` and `probeSize`, `importer.ts:28-84`; the `<img>` fallback for formats `createImageBitmap` lacks, e.g. HEIC on some WebKit builds, `importer.ts:96-109`).
3. **Aspect check:** `|aspect(full) / aspect(W) − 1| ≤ 1 %`. Otherwise throw `ExportError('aspect')`, which leads to the fallback. This catches a decoder that ignored the orientation.
4. Create the output: `OffscreenCanvas(width, height)` with a 2D context `{alpha: false}` (every pixel is opaque anyway; whether the PNG encoder then writes RGB or RGBA is the browser's choice, and a constant alpha channel deflates to almost nothing, so no size gain is counted on). When OffscreenCanvas 2D is missing, use a detached `<canvas>` (the `createSurface` pattern, `exporter.ts:99-129`).
5. For each tile, after checking `signal`:
   - `bmp = await createImageBitmap(full, win.x, win.y, win.w, win.h)`;
   - `img = renderer.renderTile({...input, source: bmp, width: win.w, height: win.h, sourceWindow: win / decode, output: {tile: buf / V, pixelSize: buf.wh, fullShortEdge}, toneSource: the working bitmap (step 4)}, read = out − buf.xy)`. It is synchronous: upload, passes, readback;
   - `bmp.close()` as soon as it returns;
   - `ctx.putImageData(img, out.x, out.y)`;
   - `onProgress((i + 1) / n)`;
   - `await new Promise(requestAnimationFrame)`, so the overlay paints and the main thread stays responsive.
6. Free memory before encoding: `full.close()`, then `renderer.releaseBuffers()`. Encoding is then the only big allocation besides the canvas.
7. Encode: `convertToBlob({type: 'image/jpeg', quality: 0.95})` or `{type: 'image/png'}`, then set the canvas size to 0 × 0.
8. Remove the breadcrumb and return `new File([blob], outputFileName(format), {type})`.

**Abort** (「取消」, ✕, the background rule of §2.3): the runner registers its big resources on `signal`. The abort listener runs synchronously: it closes `full`, sets the output canvas to 0 × 0, calls `renderer.releaseBuffers()` and removes the breadcrumb. The pending step then rejects with `AbortError`, which shows nothing. So the memory is free before the caller's next statement (for the background rule, before `flushHistory` renders the thumbnail).

`renderTile` reads back only the `out` part of the buffer: `readPixels(out.x − buf.x, out.y − buf.y, out.w, out.h)`. Row 0 is the image top (the `gl.ts` convention), so the result is an `ImageData` the canvas takes as it is.

**What the GPU state looks like after an export:** `releaseBuffers` shrinks the FBOs and the src texture. The still session's display pause ends, and its next preview frame re-allocates them at the working V size. The display canvas is untouched (exports use FBOs), so it keeps showing the last preview frame throughout.

### 4.5 Encoding

| | JPEG | PNG |
|---|---|---|
| Quality | 0.95 for `full`, 0.92 for `standard` (C §4.6) | Lossless; opaque |
| 12 MP size (estimate) | 4–7 MB | 15–25 MB |
| Metadata | None (EXIF-free, as today: RB §4 "Capture and save") | None |
| Colour | sRGB, as today. The preview and the export decode through the same importer, so they match (§9). | sRGB |
| Encoder | `OffscreenCanvas.convertToBlob` (Safari 16.4+), else `canvas.toBlob` | Same |

HEIC output is out of scope (C §10).

### 4.6 CPU port

`reshapeCpu.ts` gains the geometry and the window. `src/engine/backMapCpu.ts` wraps it with the body field into `backMapCpu(v, frame) → tc`, in O-normalized coordinates: the one CPU copy of P2's backward map, in the same order as the shader (Geo⁻¹, then liquify from step 6, then the body field sampled at the liquified point, then the face chains). Step 4 also uses it (skin-cleanup spec §3.4, which calls it `cpuSample`). It is used by:
- the tile planner tests (every sample inside its window);
- `displacementBound` tests;
- step 4's spot taps (V → content position in O);
- the e2e GPU-vs-CPU check in `reshape.spec.ts` (within 0.05 px), which gains geometry cases.

---

## 5. Persistence and migration

| Item | Where | Default and migration | Validation |
|---|---|---|---|
| `edit.photo.geometry` | HistoryEntry v2 `edit` (C §5.1) | Identity for v1 entries and new photos | `sanitizeEditState(raw, personIds, oSize)` (C §3.4; `oSize` = the entry's `width`/`height`, delta D13): non-finite or mistyped fields → that field's identity. A crop outside the valid region by ≤ 1e-4 → `cropConstrain` (float noise); by more → the whole geometry becomes identity. `straighten` is clamped to ±45 and rounded to 0.1. The camera look has no `oSize`, so its geometry is always identity. Then `openState` fits the result to the bitmap decoded now (`fitToDecode`): a 2048 / 1440 tier change rounds the aspect apart by about 3e-4, which pushes a max-fit crop at θ ≠ 0 past the rotated edge and would leave every crop handle dead; a crop that does not fit the decode goes through `cropConstrain` against it (step-3 review). |
| `HistoryEntry.source`, `sourceWidth`, `sourceHeight` | IndexedDB `meiyan` / `edits`, plain properties, no schema bump (C §5.1) | Written once by the `addEntry` that creates the entry (`history.ts:27-45`); never patched by `updateEntry`. Absent for v1 entries and camera shots. | `normalizeEntry` (`history.ts:161-180`): `source` must be a `Blob` with `size > 0`; the sizes must be finite positive integers. Otherwise that part is dropped and the entry kept. |
| Quota failure | `addEntry` | A put that fails with `QuotaExceededError` is retried once **without** `source`, with the same id (the entry must never be lost because of the file). Today `withStore` swallows the error and retries on a fresh connection (`history.ts:236-252`), which would put the 30 MB file twice and then drop the whole entry; its new `onError` hook lets `addEntry` see the quota error and skip that retry. Any other error (a dropped connection, or WebKit's `UnknownError` / `NotReadableError` for a blob it cannot write) keeps the reconnect retry with the file; when that attempt fails too, the entry is put once more without `source`, so no failure of the attempts that carry the file loses the entry. `sourceWidth` and `sourceHeight` are kept, so a reopen shows the "only the working copy kept" note. | — |
| `Prefs.exportFormat`, `exportSize` | `meiyan.prefs.v1` (key unchanged) | `'jpeg'`, `'full'`; `sanitizePrefs` keeps a valid value or the default (`settings.ts:42-57`) | — |
| Breadcrumb, cap, debug | `meiyan.exportGuard.v1`, `meiyan.exportCap.v1`, `meiyan.debug.export.v1` | Absent = none | JSON shape checked; anything else is ignored |
| Legacy projection `params` (C §5.1) | HistoryEntry | Carries no geometry. A rollback to 0.3 opens a 0.4 entry uncropped, while its thumbnail shows the crop. Accepted. Under a quarter turn it carries no 增高 band either: the band is in E rows and 0.3 would apply them as O rows, across the unturned photo. | — |

- **Thumbnails** are rendered from V, so 最近編輯 shows the crop. `original` stays the uncropped O working copy (`Editor.tsx:203-212`), so 還原 works after a reopen.
- **Reopen:** `Home.tsx:86-104` passes `source: {blob: entry.source ?? null, width: entry.sourceWidth ?? null, height: entry.sourceHeight ?? null}` through `openInEditor`. The working bitmap is still decoded from `original`.
- **Eviction and deletion** are unchanged: `HISTORY_LIMIT` 12, and `deleteEntry` removes the source with the entry. Blobs in IndexedDB are file-backed in WebKit, so `listEntries` loads no source pixels.

---

## 6. Performance budget and measurements

### 6.1 iPhone Safari limits this design relies on

| Limit | Value | Consequence |
|---|---|---|
| `MAX_TEXTURE_SIZE` | ≥ 8192 on 100 % of iOS devices, ≥ 16384 on 98 % (RB §1 #5) | Tiles of ≤ 2048 + apron always fit. A whole 4096 frame would fit too, but would cost 5 × 50 MB of FBOs: hence tiles. |
| 2D canvas area | 8192² on current WebKit (276145@main); 4096² before, with the shipping iOS version unverified (RB §1 #6) | `FULL_EXPORT_MAX_EDGE = 4096` keeps the output canvas ≤ 4096 × 4096 = 16.7 MP, which fits **both** limits. A native 24 MP output (5712 × 4284 = 24.5 MP) would not fit the older limit (§11, C §11 Q4). |
| Page memory | Killed at about 100 MB on an SE 3, about 200 MB on an 8th-gen iPad; the kill cannot be caught (RB §1 #6) | `tiled` only on tiers H and M, never on SE-class screens; the breadcrumb; GL budget 40 MB |
| `createImageBitmap(Blob)` | Decodes the full frame once internally, even with `resize*` (RB §1 #6; `importer.ts:43-48`) | A 24 MP source costs a 98 MB transient during the decode. The decode runs **first**, before the canvas and the tile buffers exist. |
| Transient activation | 5 s (RB §1 #10) | Two-tap 「分享」 after 4 s |
| HEIC | Decoding since Safari 17; `accept="image/*"` returns HEIC originals; `createImageBitmap(heic)` likely works but is unverified (RB §1 #17) | The source is kept as HEIC (small). The export decodes through the importer's `<img>` fallback when needed. That path costs more memory: the full-size decoded `<img>`, a 4096 canvas and the bitmap copied from it (`importer.ts:96-133`), about 48 + 50 + 50 MB for 12 MP. It still happens before the tile buffers exist. iPhone check in §6.4 and §8.4. |
| Storage | Up to 60 % of disk; the Home Screen app's IndexedDB is separate from Safari's (RB §1 #12) | 30 MB per source, the 3× free-space rule, 12 entries |

### 6.2 Memory at 4096 × 3072 (estimates; Phase 0 measures them)

| Phase | Allocation | MB |
|---|---|---|
| Decode (24 MP source) | WebKit's internal full frame (transient) + the 4096 bitmap | 98 + 50 |
| Decode, `<img>` fallback (12 MP HEIC) | Decoded image + 4096 canvas + bitmap copy (transient) | 48 + 50 + 50 |
| Tiles (TILE 1024, k ≈ 4.3, apron 64 px, no spots, moderate warps) | Bitmap 50 · output canvas 50 · GL: src + A at a window of about 1200² ≈ 2 × 5.8, B + C + D at 1152² ≈ 3 × 5.3, M + N ≈ 1 → 29 · tile bitmap 6 · readback 4 | **≈ 140** |
| Encode | Output canvas 50 · encoder working copy ≤ 50 (unknown) · file 5–25 | ≈ 105–125 |
| After | File kept as the share cache until the next edit: 5–25 | — |

The C §6.1 budget of ≤ 150 MB extra peak holds at TILE 1024 without spots. The GL part also **replaces** the preview's own working-size buffers rather than adding to them (A–D at 2048 × 1536 are about 50 MB), because the tiles reuse the same FBOs and the display is paused (§2.3); the table does not subtract that. With large heal windows or strong warps, the planner drops TILE to keep the GL part ≤ 40 MB (delta D9).

### 6.3 Time and frame budgets

| Path | Budget |
|---|---|
| 裁切 gestures (handles, move, 拉直) | Display rate; no engine frame during the gesture |
| Entering or leaving 裁切 | One render: ≤ 100 ms at 2048 |
| 旋轉 / 翻轉 tap | 240 ms CSS animation; no engine frame in 裁切 mode |
| Normal frame with non-identity geometry (P2 forced) | ≤ 4 ms over the same edit without geometry at 2048 |
| Re-detect after a rotation | ≤ 1.5 s, including the U copy |
| Full export, 12 MP, JPEG | ≤ 6 s from the tap (C §6.1). Estimate: decode 0.2–0.6 s, 12 tiles at about 50 ms, encode 0.3–0.8 s. |
| Full export, 12 MP, PNG | ≤ 9 s; the two-tap flow is expected |
| Standard export | As today |

### 6.4 Phase 0 rows for this step

These are added to the export bullet of C §6.2 (`src/bench/main.ts`, `/bench.html`). They run on desktop Chromium now; on the iPhone only after a preview deploy the user approves (C §1.2).

1. Decode of 12, 24 and 48 MP JPEG and HEIC to a 4096 long edge: time and peak memory (Safari Web Inspector timeline). Also which importer path ran.
2. A tiled render of a synthetic 4096 × 3072 frame with 6 faces, a body field and geometry, at TILE 512, 1024 and 2048: time per tile, `readPixels` time, `putImageData` time.
3. `convertToBlob` time and peak for JPEG q 0.95 and PNG at 4096 × 3072.
4. A canvas-area probe: 4096 × 4096 and 8192 × 6144 OffscreenCanvas 2D, draw, read back one pixel. Recorded for C §11 Q4.
5. Activation window: share a file after awaiting 3.5, 4.5 and 5.5 s (manual, on the device).
6. P2 cost with non-identity geometry at 2048.

| Measured | Default | Rule |
|---|---|---|
| Tiles-phase peak | TILE 1024, `tiled` on H and M | > 200 MB → GL budget 20 MB (TILE 512). A crash or > 300 MB → `tiled` on tier H only (C §6.2). |
| JPEG export total, 12 MP | ≤ 6 s | > 6 s on tier M → `tiled` on tier H only |
| Canvas area probe passes 8192 × 6144 on iOS 18 | Cap stays 4096 | C §11 Q4 decides whether tier H may go native |
| `createImageBitmap(heic)` fails | `<img>` fallback | Fallback also fails, or its decode peak (§6.2) exceeds 200 MB on the slowest tier-M phone → keep no HEIC source (the export uses the working copy with the note) |
| Share after 4.5 s works | `SHARE_WINDOW_MS = 4000` | It fails → 3000 |

---

## 7. Error and edge cases

| Case | Handling |
|---|---|
| A ratio that does not fit the straightened photo well (16:9 on a tall photo at 30°) | `maxFit` gives the largest one; the minimum size moves the centre if needed |
| A crop at the minimum size, or a tiny photo (< 64 px crop) | The handles stop at the minimum (5 %, ≥ 64 working px). A photo too small for 64 px keeps its full frame. |
| A 拉直 drag past ±45° | Clamped. Larger turns use 旋轉 plus 拉直. |
| 旋轉 with a 增高 band | Band cleared in the same undo step, toast 「旋轉後已移除增高」 |
| 還原 of a turned photo (`upQuarter` ≠ 0) with a 增高 band | The same: band cleared in the 還原 step, toast 「旋轉後已移除增高」. A crop, straighten or flip alone keeps the band |
| 旋轉 on a sideways photo with no face yet | One re-detect in U when the 裁切 tab is left (§3.6). No face found → the usual 「未偵測到臉部…」 state. A later crop session that ends on another unscanned U tries once more. |
| ↶ after a re-detect found faces | Geometry undone, faces kept (C §7) |
| Spots or strokes cropped out of view | Kept in O; invisible; back when the crop is undone (C §7) |
| Reopen of a v1 entry | Identity geometry; no source, so `working` export without the note (the original size is unknown) |
| Source blob unreadable at export (`NotReadableError`, file evicted) | Decode fails → fallback once to `working`, with toast |
| Decoded aspect differs from O by > 1 % (orientation ignored) | `ExportError('aspect')` → fallback |
| Context lost during the tiles | The runner throws → fallback to `working`. WebGL calls on a lost context do nothing and `readPixels` leaves zeros while `webglcontextlost` is only queued, so `renderTile` (and `renderToImageData`) check `gl.isContextLost()` after the read-back, throw, and mark the engine lost; the runner also checks the renderer's `lost` once the tiles are drawn, before the encode (`ExportError('lost')`), so a loss in the last tile never ships a black tile. The fallback's `encode` waits for `webglcontextrestored` (`whenRestored`, at most `EXPORT_RESTORE_WAIT_MS` = 10 s), then `prepareExport` waits for the reloaded textures. The wait also ends as soon as a session on a new engine has taken over (重新載入引擎: `recoverEngine` disposes the lost engine, whose canvas never fires the restore; polled every `RESTORE_POLL_MS` = 100 ms) or the editor closed, and `exportOnLatest` then exports on that session at once. Not restored in time: no file, the pill returns to 儲存, toast 「畫面恢復後請再按一次「儲存」」 (never the raw error). |
| Context lost just before a history flush (✕, or the app going to the background, inside the autosave debounce) | The flush keeps the params of the entry, without a thumbnail (no GL to draw one), whether the loss is known on entry (`lost`) or found by the flush's own read-back while `webglcontextlost` is still queued (`renderToImageData` throws, see the row above); any other render failure keeps them too and is reported. That is an existing entry or the one the first autosave is still creating (its `addEntry` encodes and stores for a while): the params write reads the entry id inside its own step of the history queue, as every history write does, so it lands after that `addEntry`. The stored thumbnail is then owed: once the context is restored, with the editor still open, the autosave effect draws it and writes it without reordering 最近編輯, whatever the plan and also when the share file for these params is already made (a 儲存 tap inside the debounce made it before the flush). |
| Context lost under any other output read-back (the flush's corrected thumbnail once a loading 濾鏡 / 質感 LUT lands, the autosave's thumbnail or history render after its `prepareExport`) | The read-back throws (see the rows above). It is no bug report: no `console.error`, no `lastError`; only a failure while the engine is not lost is reported. Nothing is written from the lost context, and the autosave effect re-arms once the context is restored. A corrected thumbnail that could not be drawn leaves the stored one owed, as above. |
| The app goes to the background mid-export | Aborted at once (§2.3): memory released, breadcrumb removed, then the history flush runs. On return the toast 「輸出已中斷，請再按一次「儲存」」. Only a kill while the page is visible leaves the breadcrumb. |
| ✕ or 取消 during the tiles | The abort releases the memory at once (§4.4); the breadcrumb is removed; nothing is shared. The overlay, the 準備中 pill, the inert controls and the paused display end at the abort too, not when the runner's pending step settles (a multi-second decode, an encode, or a rAF that never fires while hidden); the runner checks the signal after every await, so it draws no tile once the display is back. A file that finished just before the abort is dropped (v0.4 cleanup, step-3 review) |
| An edit attempted during the export | Not possible: the panel is `inert` (§2.3) |
| An autosave pending when 儲存 is tapped (an edit less than 400 ms before) | Waits until the export ends, then runs once (§2.3) |
| Export took > 4 s | Pill 「分享」 plus toast; the cached file is dropped on the next edit |
| `navigator.share` rejects with NotAllowedError (activation expired anyway) | The existing fallback overlay shows the file (`exporter.ts:72-86` returns `'fallback'`) |
| Panorama (16000 × 4000) | Decode 4096 × 1024; working 2048 × 512; tiles as usual |
| 48 MP ProRAW / DNG (> 30 MB) | No source kept → `working` with the note, in the first session too (§3.7); the import itself works only if the browser decodes the format |
| PNG screenshot ≤ 2048 | `working` path. The first session exports from the decoded file; a reopen exports from the JPEG q 0.9 working copy (§11 Q5). |
| Existing fixtures and e2e tests | Every committed fixture is ≤ 2048 (`sample_face.png` 1000 × 1500, `fullbody*.jpg` ≤ 1000), so every existing export takes the `working` path and keeps its dimensions (`editor.spec.ts:107`) |
| Storage almost full | No source kept (3× rule), or the add is retried without the source on `QuotaExceededError` |
| Basic mode (no tracker) | Crop and export work; no re-detect |
| Camera | No 裁切 tab; 輸出格式 applies to its saves |

---

## 8. Testing

### 8.1 Unit (Vitest)

- **`src/geometry/view.test.ts`:**
  - round trips `vToO ∘ oToV = id` within 1e-9 for all 2 × 4 flip and quarter states × θ ∈ {−45, −7.3, 0, 12, 45} × random crops;
  - the affine equals the composed functions;
  - `rotateLeft` four times = identity;
  - `flipView` twice = identity;
  - `flipView ∘ rotateLeft = rotateLeft⁻¹ ∘ flipView`;
  - a content point inside the crop stays inside after `rotateLeft` and after `flipView`;
  - `upQuarter` is invariant under `flipView` and changes by one under `rotateLeft`;
  - `maxFit` against the closed form and against a brute-force search;
  - `cropConstrain` (fuzzed): the output is valid, keeps the aspect, is idempotent, and leaves a valid input unchanged;
  - `setStraighten`: a max-fit crop re-expands at 0°; a hand-shaped crop only shrinks;
  - `applyRatio` per lock; `lockFor` and `transposeLock`;
  - `viewSize` and `snapCrop` (θ = 0 gives integer pixel edges);
  - `cropModeLayout` for odd quarters.
- **`src/geometry/cropModel.test.ts`:** corner, edge and move drags stay valid at every step (fuzzed deltas); the lock keeps the aspect; the move slides along a limit; the minimum size holds.
- **`src/edit/state.test.ts`:** `rotateLeft` clears `heightBand` in the same step and `flipView` keeps it; 還原 is one step, and clears `heightBand` only from a turned up-frame; `sanitizeEditState` geometry rules (§5).
- **`src/media/exportPlan.test.ts`:**
  - plan selection for every row of §3.7, including tier L (1440), SE-class, guard, no source, source not larger, standard pref, and camera shot;
  - quality 0.95 / 0.92;
  - `outputFileName`;
  - tiles partition V exactly, with no gap and no overlap;
  - origins are multiples of 4; `buf ⊆ V`; `win ⊆ decode`, also for decode and V sizes that are not multiples of 4 (snap first, clip last);
  - `apronV` = `ceil(14·k) + 2` rounded up to 4, e.g. 64 at k = 4.27;
  - the TILE choice under the 40 MB budget;
  - **coverage:** for small configurations (multi-face, body field, geometry with θ = 12°), every buffer pixel's sample `backMapCpu(v)` lies inside its tile's window;
  - `shouldKeepSource`: size, quota, estimate missing, not larger;
  - the guard and cap state machine.
- **`src/engine/passes/reshape.test.ts`:** `displacementBound(face, u) ≥` the CPU port's measured maximum displacement on a 257 × 257 grid, fuzzed over faces from the fixtures and random slider values.
- **`src/engine/uniforms.test.ts`:** `meanStep` and `sharpenTexel` with `fullShortEdge` equal today's values when `fullShortEdge = min(size)`, and scale with `fullShortEdge / buffer` otherwise.
- **`src/media/exportFull.test.ts`:** the runner against a fake `TileRenderer` and a fake canvas:
  - the order is decode → tiles → close → release → encode;
  - progress is reported;
  - an abort closes `full`, zeroes the canvas, calls `releaseBuffers` and removes the guard synchronously inside the abort call, and the pending step rejects with `AbortError`;
  - each `failAt` knob leads to the fallback;
  - an aspect mismatch throws `ExportError('aspect')`.
- **`src/media/exporter.test.ts`:** `encodeOutput` type and name per format; `createSurface` with `alpha: false`.
- **`src/media/importer.test.ts`:** `importPhotoInfo` returns the probed oriented size, also on the `<img>` fallback.
- **`src/store/history.test.ts`** (fake-indexeddb): `source` fields round trip; invalid fields are dropped and the entry kept; a `QuotaExceededError` add is put exactly once more, without the source and with the same id (no reconnect retry with the file), and the entry is stored (without the source, same id, sizes kept); other errors keep today's reconnect retry, and an `UnknownError` / `NotReadableError` that fails both attempts with the file still stores the entry (without the source, same id, sizes kept). Each of these failures is modelled as the engines report it, at commit: the source record's put succeeds and its transaction then aborts with the error (`QuotaExceededError`, `UnknownError` or `NotReadableError`), rolling back the entry put queued before it. A synchronous throw from `put` would let the transaction commit the entry anyway, so its outcome cannot tell the fallback put from no fallback at all. Each test checks the outcome and the call order: for the quota case the entry, its source record, then the entry once more; for the others two attempts with the source, then the entry. An abort of only the first attempt keeps the retry, which stores the file, with no third put.
- **`src/store/settings.test.ts`:** the new prefs sanitize to defaults; the guard and cap keys.
- **`src/app/still.test.ts`:** in crop mode a geometry-only change schedules no display frame, and `exportImageData` still applies the geometry; `pauseDisplay(true)` drops every display frame until `pauseDisplay(false)`, which draws once.
- **`src/ui/editorModel.test.ts`:** `needsFaceScan(cache, geometry, mode)` is true only in normal mode, with an empty face cache that holds the upright answer, a tracker, and an unscanned `upQuarter`; a scan at one quarter counts for both flip states.
- **Settings model:** the 輸出解析度 control shows 標準（{edge}） under every block and under the cap (標準（1440） on tier L); under the cap, tapping 原始解析度 sets `'full'` and clears `meiyan.exportCap.v1`.
- **`src/ui/components/Slider` tests:** `dragValue` and `formatDisplay` with `{min: −45, max: 45, step: 0.1, snap: 0.5, suffix: '°'}`; the default scale is unchanged.
- **`reshapeCpu.test.ts`:** hash pin re-set; CPU port = shader for geometry and window cases.

### 8.2 E2E (Playwright, Chromium)

**Engine harness** `tests/e2e/pages/export.html` (dev server, imports `src/`):
- An 800 × 600 synthetic frame with `sample_face.png` composited, 大眼 + 瘦臉 + 磨皮 + a body field + 顆粒 50 + 暗角 50 + the 膠片 look (step 2 promises tile-independent grain and vignette, adjust-and-looks spec §4.4), at geometries {identity, quarter 1 + flip, θ = 12° + crop}. Steps 4, 5 and 6 add their own cases to this harness (spots and tone, every makeup part, strokes).
- `renderTile` with one tile covering everything vs the forced TILE = 256 plan: max channel difference ≤ 1/255 everywhere. The one accepted exception (`tests/e2e/export.spec.ts`, `LIFTED_CASES`, `MAX_LIFTED`): under off-centre bilinear taps (θ ≠ 0, or a warped quarter turn) the fp32 rounding flips B by 1 LSB all over, and the 膠片 curve with 顆粒's mid-tone weight lifts a rare one to 2/255. A case may have at most 3 such pixels, each at least one apron (`apronFor`) from every tile line; a seam would put them on the lines. The exception is granted by name, only to the cases where it is measured. On SwiftShader that is one channel of one pixel in θ 12° + crop (30 px from the nearest tile line), in step 5's quarter 1 + flip (44 px) and in the release gate (72 px). Every other case keeps 1/255 with no pixel above it. That includes the cases with off-centre taps but nothing lifted: quarter 1 + flip, step 5's θ 12° + crop, and strokes + 90° turn (push-brush spec §8.3 test 9). A case that starts to need the exception is added to the list together with this text.
- A 601 × 799 frame (not a multiple of 4): ≤ 2/255 anywhere (§4.4 grid note), with the same bound of 3 pixels above 1/255 (`GRID_CASES`).
- The harness returns only a summary of the pixels above 1/255 for each case: their count, their smallest distance to a tile line, and the 8 nearest a line. A regression that moves the whole frame then fails the assertions with a readable message. Before the summary, the harness sent one entry per pixel across nine cases, and a regression like that ran the Playwright worker out of memory.

**App specs** (`tests/e2e/crop.spec.ts`, production build). A helper `exportFile(page)` taps 儲存, taps again if the pill reads 「分享」 (a 12 MP tiled export on SwiftShader can pass 4 s), and returns the long-press fallback image (headless Chromium has no file share, so `saveFile` returns `'fallback'`).
1. **Dimensions:** import a 3000 × 4000 synthetic JPEG made in the page (canvas `toBlob`). The source is kept, so with the `full` pref the long-press fallback image is 3000 × 4000. After 1:1 it is 3000 × 3000. After 旋轉 a 3:4 crop becomes 4:3 with the sides swapped. With `standard` it is 1536 × 2048 (`naturalWidth` as in `editor.spec.ts:107`).
2. **Exact copy:** with the 自然 look (the default until 2026-10-18; the test taps it), a 翻轉 export equals the horizontal mirror of the unflipped export in the interior (more than 2·apron from the edges), within 1/255; every stage is computed in O or uses a symmetric kernel. A 旋轉 export equals the rotated unrotated export within 2/255, because the mean's 8-bit intermediate is then quantized after the other axis.
3. **拉直 12°:** the corner pixels of the export are not the black stage colour (the crop stays inside the photo); the dimensions match `maxFit`.
4. **Consistency:** on `group_faces.png` (C §8.3), after 旋轉 + 翻轉 the face boxes sit on the faces (the box centre is within 2 % of the mapped landmark centre), and selecting face 2 + 大眼 changes pixels only inside face 2's mapped box. On `fullbody.jpg`, the 增高 lines stay on the same content after 翻轉 and disappear after 旋轉 with the toast.
5. **Undo:** each action and each gesture is one ↶ step; ↷ restores; 還原 is one step.
6. **Reopen:** close, reopen from 最近編輯: the geometry is kept, `detectCalls` is 0, and the full-resolution export still gives 3000 × n (the source persisted).
7. **PNG:** with 輸出格式 PNG, the fallback image's blob type is `image/png` and the name ends `.png`. This is also checked on the camera's review save.
8. **Fallback and breadcrumb:** `failAt: 'tile'` gives the toast 「已改用標準解析度輸出」 and a working-size file. A seeded `meiyan.exportGuard.v1` gives the launch toast, standard dimensions, and in 設定 the sub-text with 標準（2048） (tier H) shown selected; tapping 原始解析度 clears the cap.
9. **Two-tap:** `slowMs: 4500` makes the pill read 「分享」 with the toast; the second tap shows the file.
8a. **Context loss in the last tile:** the context is lost inside the last tile's read-back and restored 300 ms later: the file is the working size (no black tile), the toast 「已改用標準解析度輸出」 shows, and no 「無法輸出照片…」 toast. Never restored: no file after the wait, the pill is 儲存 again, toast 「畫面恢復後請再按一次「儲存」」. Never restored but 重新載入引擎 tapped during the wait: the working-size file comes from the new engine well within the 10 s wait (under 6 s from the tap), with no retry note. In `editor.spec.ts`, the context is lost in the same task as a background flush inside the autosave debounce: the entry gets the params, keeps its thumbnail, and gets the new thumbnail once the context is restored. Test-only holds (`installHolds`: a held thumbnail encode, a held LUT decode that loses the context right after its upload, a stretched debounce) cover the rest of that window: a ✕ flush that finds the loss while the first autosave's `addEntry` is still pending (the entry, once created, has the last edit); 儲存 inside the debounce, then the lost background flush (the owed thumbnail is written after the restore although the share file is fresh); a background flush whose corrected thumbnail and, with PNG output, an autosave whose render read back with the loss still queued (no `console.error`, no `lastError`, nothing written while lost, the thumbnail written once restored).
9a. **Background abort:** with `slowMs: 4500`, the test sets `document.visibilityState` to hidden and dispatches `visibilitychange` mid-export: `meiyan.exportGuard.v1` is gone, `DebugState.export` is null, the pill reads 儲存; after making it visible again, the toast 「輸出已中斷，請再按一次「儲存」」 shows.
10. **EXIF orientation:** a JPEG with Orientation = 6 (APP1 spliced into a canvas-encoded JPEG in the test) imports upright, and the full-resolution export is upright with swapped dimensions.
11. **裁切 mode:** the canvas keeps its O size while handles move, 拉直 is dragged and 旋轉 is tapped three times (no engine frame: the debug `renderCount` does not change); leaving the tab renders once. On a copy of `sample_face.png` turned 90° clockwise in the page before import: 旋轉 (now upright) and two 翻轉 taps run no detection (`detectCalls` unchanged). On leaving the tab, if the import found no face, exactly one scan runs (`detectCalls` + 1) and finds the face; if the import already found it (BlazeFace sometimes does at 90°), no scan runs.
12. **parity.spec.ts** (C §8.4) stays green: identity geometry equals v0.3.

`reshape.spec.ts` gains geometry and window cases (GPU = CPU port within 0.05 px).

### 8.3 Fixtures

There are no new committed binaries. The large JPEG and the EXIF-orientation JPEG are generated inside the test page from `sample_face.png` and a gradient (deterministic code). They are derivatives of the Apache-2.0 GPUPixel sample already in `LICENSES/NOTICE.txt`; NOTICE gains one line for these derived test images (C §1.3 item 2).

### 8.4 On-device checklist (the user's iPhone, after an approved preview deploy)

- A 12 MP HEIC from 照片: import, crop, rotate, export JPEG and PNG, 儲存影像 into 照片; check the dimensions in 照片's info panel.
- A 24 MP or 48 MP photo: timings and peak memory from §6.4.
- The share sheet within 4 s; the two-tap path after it.
- 拉直 drag smoothness; 旋轉 animation.

---

## 9. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| iPhone memory at 4096 (the kill cannot be caught) | The page dies while saving | Tiles, the 40 MB GPU budget, tiers H and M only, no SE-class, decode before allocating, the display and autosave paused, close and release before encode, abort when hidden, breadcrumb, Phase 0 numbers |
| The JPEG/PNG encoder's own copy is larger than estimated | Encode-phase peak | Measured in Phase 0; the rule moves `tiled` to tier H only |
| HEIC decode through `createImageBitmap` unverified | Export fails for HEIC sources | `<img>` fallback in the importer; failure → working copy plus note; Phase 0 row |
| The share activation expires | The share sheet does not open | Two-tap 「分享」 at 4 s; fallback overlay |
| `maxDisp` underestimated → samples outside a window | Seams at tile edges | Analytic bound (D7) with fuzzed tests against the CPU port; the coverage test; the tiled = untiled e2e |
| ¼-resolution grids differ on frames not divisible by 4 | Tiny tile-edge differences | ≤ 2/255, tested; invisible on feathered masks |
| P3 colour: iPhone photos are Display P3; the pipeline is sRGB, as today | Slight gamut loss | Unchanged from v0.3; preview and export match. Wide gamut is out of scope. |
| Storage growth from sources (up to 12 × 30 MB) | Quota pressure | 30 MB cap, 3× free rule, quota-retry without the source |
| A strong crop previews soft | The user thinks the export is soft | The export is sharp (source decode); accepted for v0.4 |
| 增高 lines tilted under 拉直 | Looks odd at large angles | Consistent with "bands are E rows" (C §3.5); §11 Q6 |
| `RESHAPE_FS` gains three uniforms | Another hash re-pin | One commit with the CPU port (C §8.2) |

---

## 10. Out of scope

- Perspective (梯形) and lens distortion (畸變矯正) correction; vertical flip as its own action (旋轉 twice + 翻轉 does it); auto-straighten (horizon detection); free rotation beyond ±45° in one control.
- Pinch-zoom and auto-zoom-to-fit inside 裁切 mode; aspect presets beyond the seven (§11 Q3); 擴圖 (canvas expand).
- 裁切 in the live camera (C §10).
- Export above a 4096 long edge (C §11 Q4); HEIC or WebP output; transparent PNG; keeping EXIF or other metadata, including the capture date (§11 Q2); Display P3 output; batch export.
- A preview re-rendered from the source for strong crops; a Web Worker or streaming encoder.

---

## 11. Open questions for the user

Each question has a default that this spec uses if the user does not answer. C §11 Q4 (cap at 4096, or native size for 24/48 MP where memory allows) and Q5 (原始解析度 JPEG as the default output) also govern this step.

1. **按住對比 after cropping:** show the unedited photo in the **same crop and rotation**, or the whole uncropped original? *Default: the same crop and rotation, so the framing does not jump.*
2. **Original capture date:** v0.4 strips all metadata, so a saved photo sorts in 照片 by the day it was saved, not by the day it was taken. Should we write only the original's DateTimeOriginal (no location, no camera data) into the exported JPEG? *Default: no, nothing is kept (as v0.3).*
3. **Ratios:** add 4:5 (common for Instagram posts) and 2:3 / 3:2 to the seven in C §2.1? *Default: no, the seven only.*
4. **Crop gestures:** the box moves over a fixed photo (simpler, the v0.4 default), or the iOS 照片 style, where the box stays put, the photo pans and zooms under it, and the view re-fits after each gesture? *Default: the box moves.*
5. **Small PNG and HEIC files:** also keep the picked file when it is no larger than 2048 but is not a JPEG (e.g. a PNG screenshot), so a reopened photo exports PNG without the JPEG-q0.9 working copy's artifacts? This costs a few MB per entry and needs a one-line change to C §4.6. *Default: no (C's rule: keep the file only when it is larger than the working copy).*
6. **增高 with 拉直:** the band stays on the photo's own rows, so its lines tilt with 拉直, or it follows the screen's rows (a contract change)? *Default: the photo's rows.*
7. **重置:** C §3.4 makes 「重置」 reset everything, crop and rotation included (it is one undo step). Keep that, or make 重置 leave the geometry alone, so only 裁切 › 還原 resets it? *Default: as C, 重置 resets the geometry too.*
