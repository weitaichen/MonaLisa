# Mona Misa 美顏 v0.4 step 4: 膚質 tools (祛痘, 勻膚, 膚色, 黑眼圈, 法令紋, 白牙, 亮眼)

- **Date:** 2026-10-12
- **Status:** proposal for the user's review. The user has not discussed these designs yet; the real choices are in §11. Every other decision is made here so the plan can start without TBDs.
- **Base:** branch `feat/meiyan-pwa` at `892ea61` (v0.3.0). Line anchors are at that commit.
- **Contract:** [v0.4 roadmap and architecture contract](2026-10-12-v04-roadmap.md), called **C** below (step 4 row of C §1.2; C §2.1, §2.3, §3.1–3.5, §4.2–4.7, §5.3, §8). Per-person model: [選臉／選人 spec](2026-10-12-face-person-select-design.md) and C §3.2–3.4.
- **Depends on:** step 1 (`EditState`, lens, persons, face table with cap, per-face mask M), step 3 (view transform, the CPU back-map, the tile planner and `uWin`).
- **Research:** `reports/醒圖 功能差距分析.md` (**GAP**), `research_notes/醒圖 功能差距分析/xingtu_portrait.md` (**XP**), `xingtu_product.md` (**XPR**).
- **Changes C:** yes, see §0.2. The amendments were folded into C in the 2026-10-12 consistency pass (C §1.2, §3.2, §4.2–4.7, §8), as C "Role" requires; the pass order is still a user choice (§11 Q2, C §12).

## 摘要（繁體中文）

第 4 步在「美膚」加入七個膚質工具：祛痘（點一下就修掉）、勻膚、膚色（冷↔暖）、黑眼圈、法令紋、白牙、亮眼。除了祛痘，每個工具都是每個人物各自一組數值，也可以選「全部」一起調；祛痘點跟著照片存，並記得點在誰的臉上，「清除」只清目前選中的人。
做法是頻率分離：只修正色斑、泛紅、暗沉這類中低頻的部分，毛孔、雀斑等細節保留，所以不會像醒圖用戶抱怨的「祛法令紋會讓臉變糊」。祛痘用痘痘周圍一圈的顏色，加上旁邊一小塊乾淨皮膚的紋理補上，原理和 Photoshop 的修復筆刷相同。
這些修正放在美型、美妝之前，直接在原圖上做：腮紅、口紅、紅潤不會被勻膚洗掉，瘦臉、大眼之後修過的地方也會跟著臉一起移動。這和總規格原本寫的處理順序不同，總規格已一併更新（§0.2），你仍可在 §11 Q2 選擇改回原本的順序。
全部在手機上處理，存進「最近編輯」，每一點、每一次滑動都能復原；相機即時預覽不提供這些工具。

---

## 0. Sources, scope and changes to the contract

### 0.1 What 醒圖 users expect (and what this spec takes from it)

| Finding | Source | Consequence here |
|---|---|---|
| 勻膚 and 祛痘 are the most praised 醒圖 features; together with 推臉筆 they lead the reviews | GAP:11; XPR:117, 138 | Both are first-class: 勻膚 as a slider, 祛痘 as a dedicated tap mode |
| 醒圖's 美颜 covers 祛斑祛痘, 祛油光, 皮肤肌理, 匀肤 (3 textures), 去皺 (法令纹/颈纹/眼纹), 肤色 冷暖, 白牙, 亮眼, 祛黑眼圈 | XP:22-29, 104 | v0.4 ships the seven GAP marks P1 (GAP:51); 祛油光, 肌理, 焕肤, 頸紋/眼紋, 3 勻膚 textures are out of scope (§10) |
| Recommended strengths: 祛黑眼圈 about 50, 匀肤 up to 100 | XP:116 | Gains are calibrated so 50 looks natural and 100 is the strongest sensible value |
| A tutorial complains that 祛法令纹 "makes the face blurry" | XP:25 | Hard constraint: every tool keeps the high frequencies (pores, freckles, fine lines) |
| 2026 「祛斑祛痘」 upgrade: "precisely fade blemishes, keep natural texture" | XP:30 | 祛痘 transplants real neighbouring skin texture (§4.5), not a blur |
| 肤色 is a two-way 冷暖 slider (冷白皮) | XP:29, 120, 127 | 膚色 is bidirectional, −50 冷 … +50 暖 |
| 2021 醒圖 could not do skin per face; Meitu 2026 does 「皮膚美化分人臉」 | GAP:73-75; XP:151 | Per-person tone values put Mona Misa ahead of 醒圖's documented behaviour |
| Hypic 2026 added a Concealer pen | XP:32 | Covered by tap 祛痘; a painting brush is out of scope |

### 0.2 Contract amendments

C §4.2 places 祛痘 (P2b) and the tone stages (P5) **after** the warp, in V. This spec moves both **before** makeup and the warp, into O. That changes C in six places:

| # | C says | This spec | Why |
|---|---|---|---|
| A1 | 祛痘 is P2b, after P2, one quad per spot in V (C §4.2, §4.4, §4.7) | **P0b in O**, before P1 | Spots are stored in O (C §3.5). Drawing them in V needs the forward map O→V, and the engine has only the backward map (P2 computes `tc` per V pixel). In O, a spot follows its content exactly under every face warp, body field, liquify stroke, rotation and crop, and tiles need no inverse map. |
| A2 | 勻膚, 膚色, 黑眼圈, 法令紋, 白牙, 亮眼 are composite stages after 磨皮, gated by the skin ramp `p` (C §4.2 P5, C §4.4) | **P0c** (a cached low-frequency *tone field* in O) and **P0d** (a full-resolution *retouch* pass in O), both before P1. They are gated by the region masks and colour guards of §4.2–4.4, not by `p`. **COMPOSITE_FS is not changed by step 4.** | Makeup is drawn in P1, before P5. A P5 band-pass would treat blush as uneven skin and partly remove it, and 膚色 would tint blush and lipstick. In O the field depends only on the healed source and the tone values, so it is reused across every 美型, 美體, 推臉筆, 調節 and 濾鏡 drag, and a tiled export reuses the preview's field without an apron. `p` fades out on darker skin (§4.3). |
| A3 | P0 writes 勻膚 to M.B and 膚色 to M.A; R is warped to R_v (C §4.2, §4.7) | M stays exactly as step 1 makes it (B and A stay 0). Step 4 adds **R** (feature regions) and **Q** (skin regions), both at ¼ O and **never warped**. No S buffer. | Both are consumed in O (A2). 膚色 needs a wider region than 磨皮 (§4.2), and the low-pass needs a skin coverage that does not depend on any strength. |
| A4 | `Spot { x, y, r }` (C §3.2) | `Spot { x, y, r, dx, dy, owner }` (§3.2) | The stored donor offset makes the heal deterministic across preview, reopen and tiles. `owner` scopes 清除 to a person (§2.3, §11 Q1). |
| A5 | Tile apron includes "the largest heal radius" (C §4.6) | Each spot whose quad meets the tile window adds its own ring and donor box; the tone field is one global texture (§4.6) | Follows from A1 and A2 |
| A6 | Composite texture unit 9 = R_v (C §4.3); `COMPOSITE_FS` re-pinned at step 4 (C §8.2) | Unit 9 stays free; step 4 pins new shaders instead (§4.8) | Follows from A2 and A3 |

C §4.7's sentence "no new full-size buffer is added: heal reuses A" stays true (§4.1). With a non-identity geometry the two full-size buffers are re-sized within a frame; §4.1 states the cost, and §6 gives the measured fallback.

**Why not keep the heal in V with a CPU forward map.** C's P2b would need the forward map O→V for every spot on every frame: Newton iterations of the CPU back-map for up to 100 spots during every 美型／美體／推臉筆 drag. It turns a circle into an ellipse under anisotropic warps, and it still could not give 勻膚 and 膚色 a place before makeup. A1 needs only the backward map, once per tap (§3.4).

**Impact on the parallel sub-specs** (aligned in the 2026-10-12 consistency pass):
- Step 3 (`2026-10-12-crop-and-fullres-export-design.md`) assumes A1 and A5: its §3.5 row 祛痘, its §4.2 row for the step-4 passes, its planner hook `spotWindowGrowth` (§4.4) and `backMapCpu` (§4.6). It now also states the step-4 GL tile budget `(3·win² + 2·buf²) · 4 B` (§4.4 planner step 1) and passes `toneSource` on every tile (§4.4 runner).
- Step 6 (`2026-10-12-push-brush-design.md`, §4.5 row 祛痘): a spot follows its content when a later push moves it, because P0b heals the source before every warp.

---

## 1. Goal and user-visible behaviour

### 1.1 The seven tools

| Tool | Control | What the user sees | Where it acts | Scope |
|---|---|---|---|---|
| **祛痘** | Tap mode, 大小 小／中／大 | Tap a pimple, a dark spot or a small blemish: it disappears, and the skin there keeps its pores and grain. Each tap is one ↶ step. | Anywhere in the photo except inside the eyes and the open mouth | Photo-level list (C §3.1); each spot remembers the person it was tapped on |
| **勻膚** | 0–100 | Blotches, redness and uneven patches fade; pores, freckles and fine lines stay | Face skin: the 磨皮 region (oval plus ring, without eyes and mouth) | Person |
| **膚色** | −50 冷 … +50 暖 | 冷: less yellow, slightly pink-white (冷白皮). 暖: golden. Brightness is unchanged. | Face skin and the upper neck, fading out | Person |
| **黑眼圈** | 0–100 | Under-eye darkness and its blue-purple cast lift toward the surrounding skin tone | A crescent under each eye | Person |
| **法令紋** | 0–100 | The shadow of the nasolabial folds lightens; skin texture is kept | Two bands from the nose wing past the mouth corner | Person |
| **白牙** | 0–100 | Yellowish teeth turn neutral white; lips, gums and tongue are untouched | Inside the lips, only on tooth-coloured pixels | Person |
| **亮眼** | 0–100 | Whites of the eyes become clearer (less red and yellow); the iris becomes crisper and slightly brighter | Inside the eye openings | Person |

- All sliders start at 0 (膚色 at its centre). The beauty presets keep them neutral (C §3.4, C §11 Q7 default).
- **Strength scale:** 50 is the natural setting (醒圖's tutorials recommend about 50: XP:116); 100 is strong but still keeps texture.

### 1.2 Rules

- **Per person** through the lens (C §3.3): the selected person, or every person under 全部 (「各人不同」 when they differ). A person without a face gets the C §2.2 note. A photo without any face disables the six sliders with 「未偵測到臉部，膚質工具不會套用」; 祛痘 still works. In 基本模式 the six sliders are disabled with 「基本模式不支援膚質工具」, and 祛痘 works as on a photo without a face (C §7: photo-level tools work in 基本模式). While the face answer is only temporarily unknown (the three tracker states of `Editor.tsx:789-797`), all seven items are disabled with the matching note of §2.4, because the faces that refuse eye and mouth taps may still arrive.
- **Non-destructive:** the values and the spots are part of `EditState` and are saved in 最近編輯. ↶ ↷ cover every slider commit, every spot and every 清除.
- **Editor only** (C §2.4, C §11 Q3 default). The camera strip leaves the seven items and the divider out.
- **Works with everything else:** 瘦臉, 大眼, 美體, 推臉筆, 裁切 and 旋轉 move the corrected skin with the face; makeup and 紅潤 are drawn on top; 按住對比 shows the untouched original.
- **Export:** the standard 2048 export and the tiled full-resolution export look the same; 亮眼 is marginally crisper at full resolution (§4.6).

### 1.3 Build order inside step 4

Each sub-step ends green (`typecheck`, `test`, `build`, `test:e2e`) with a local commit (C §1.2).

| Sub-step | Contents |
|---|---|
| 4a | Param defs, `Spot` type, sanitize, lens rules, presets neutral, undo of add/clear (§3); no UI yet |
| 4b | `toneGeometry.ts`, the R and Q targets in P0, unit tests (§4.2) |
| 4c | The fixture (§8.3) first; `toneCpu.ts`, the `TONE` calibration on the fixture and the hash pins; then tone field P0c and retouch P0d, the engine harness and the A/B ping-pong (§4.1, §4.3, §4.4, §8.2) |
| 4d | Heal P0b, ring texture, `healCpu.ts` and its hash pins (§4.5) |
| 4e | `spots.ts`, `patch.ts`, the tap mapping, the 美膚 strip, `SpotControls`, `SpotOverlay`, notes (§2, §3.4–3.6) |
| 4f | Tiles and `toneSource` (§4.6), bench rows (§6), `tone.spec.ts` (§8.4) |

---

## 2. UI

### 2.1 美膚 strip (C §2.1)

**⊘ 原圖 · 磨皮 · 美白「整張」 · 紅潤 · 銳化「整張」 │ 勻膚 · 膚色 · 黑眼圈 · 法令紋 · 白牙 · 亮眼 · 祛痘**

- **│** is step 2's strip divider: 勻膚 carries `PanelItem.divider: 'before'` (adjust-and-looks spec §3.4), rendered as the `strip-divider`, not focusable and not an item.
- The strip scrolls (12 items and the divider). The existing "bring the selected item into view" logic applies (`BeautyPanel.tsx`, the `useLayoutEffect` on the strip key).
- **Icons:** seven new original line icons in `icons.tsx` (24 × 24 grid, 1.75 px stroke, as icons.tsx:1): `even`, `tone`, `darkCircle`, `nasolabial`, `teeth`, `eyeBright`, `spot`.
- **Accent dot** (`hasValue`): on a tone item when the selected person's value (the primary person's under 全部) is not neutral; on 祛痘 when the 清除 scope (§2.3) holds at least one spot. `tabHasValue('skin')` (panelModel.ts:547-561) is also true when a tone item is not neutral or `photo.spots` is not empty.
- **⊘ 原圖** behaves as C §2.1 says: it resets the person items of the selection (including the six tone items), resets 美白／銳化 only under 全部 or with fewer than 2 persons, and never touches spots.
- 祛痘 never shows the 「整張」 badge: spots work anywhere, and the 清除 scope follows the selection.

### 2.2 Sliders and notes

- 勻膚, 黑眼圈, 法令紋, 白牙, 亮眼: 0–100; double tap returns to 0.
- 膚色: −50 … +50, centre 0. The track shows the end captions 「冷」 (left) and 「暖」 (right). This needs a new optional `SliderBinding.ends?: [string, string]` (panelModel.ts:457-466), rendered by `SliderRow` as two 11 pt `--text-2` captions under the two ends of `.slider-track` (Slider.tsx:170-177); `aria-valuetext` (Slider.tsx:155) becomes e.g. 「−20 冷」 or 「+15 暖」.
- **Strip notes** (the existing `body-note` style above the strip), shown only while that item is selected:
  - 白牙, when the selected face's mouth opening (§4.2) is below 0.01: 「嘴巴閉合時看不到牙齒，白牙效果不明顯」
  - 亮眼, when both eyes have EAR below 0.12: 「閉眼時亮眼效果不明顯」
  - Under 全部 a note shows only when it holds for every face the item applies to.

### 2.3 祛痘 mode (C §2.3)

**Entering and leaving.** Tapping 祛痘 selects it (`sel.skin = 'spot'`), the same pattern as 美體's 增高 (`BodySel`, panelModel.ts:25; `showsHeightBand`, panelModel.ts:175). Tapping any other item or tab leaves the mode. `lastSel` (Editor.tsx:66) never stores `'spot'`: leaving the editor in 祛痘 mode reopens the next photo on 磨皮, so a first touch on a new photo can never add a spot.

**Layout.**
- A caption at the top centre of the stage, in the `.corner-label` style: 「點一下痘痘或瑕疵即可去除」. It is hidden while 按住對比 is held, where the existing 「原圖」 label shows (Editor.tsx:842).
- `SpotControls` replaces the slider row, at the same height so the canvas does not jump:
  - 大小: a segmented control 小｜中｜大 (44 pt segments). The default is 中. The choice is remembered for the app session in a module variable, like `lastSel` (Editor.tsx:66), and is not persisted.
  - The 清除 button on the right:

    | Situation | Label | Clears |
    |---|---|---|
    | Fewer than 2 selectable persons, or 全部 selected | 全部清除（n） | Every spot |
    | One person selected in a group photo | 清除此人（n） | Spots whose `owner` is that person |

    It is disabled at n = 0. The first tap turns the label into 「確定清除？」 for 3 s; a second tap within that time clears, as one ↶ step. This is the confirmation 推臉筆's 全部清除 and 重置 use (push-brush spec §1.2), so both clear buttons of the editor behave alike.
- Face boxes are hidden (C §2.2). The person strip stays, and choosing a chip changes the 清除 scope.

**Canvas input** (`zoomPan` gains a tap mode, next to C's `onTap`; in 祛痘 mode the Editor passes no `onTap`, so a photo tap adds a spot and never changes the selection, which only the chips change here):
- A single tap (one finger, moved < 8 px, not on a button: zoomPan.ts:82, 94) adds a spot at the finger. It fires on `pointerup`, without waiting for a possible double tap. A `pointercancel` never adds a spot: today `pointercancel` runs the same handler as `pointerup` (zoomPan.ts:118), so the tap mode passes the event type through and ignores a cancel.
- Double-tap-to-fit (zoomPan.ts:103-113) is off in this mode. Pinch and one-finger pan while zoomed work as today.
- **Feedback:** a haptic tick, and `SpotOverlay` draws a 1.5 px `--accent` ring at the finger with the spot's on-screen radius (r through the view scale, ignoring warps). It lives in `.zoom-layer`, so its stroke width is 1.5 / s px for the zoom scale s. The ring scales 1.15 → 1 and fades out over 350 ms.
- The tap is **snapped to the blemish** within 0.8 r (§3.5), so the finger need not be exact.
- If the spot's on-screen diameter is below 12 pt, the toast 「放大畫面可以點得更準」 appears once per editor session.
- A tap inside an eye or the open mouth adds nothing and shows 「眼睛和嘴巴不適用祛痘」.
- A tap outside the photo (letterbox) or while 按住對比 is held is ignored.
- The 101st spot shows 「祛痘點已達上限」 (cap 100, C §5.3).

**Spot size.** radius = k × the reference face width, with k = 小 0.018, 中 0.030, 大 0.048.
- The reference face is the face whose oval contains the tap; else the nearest face whose box, grown by 50 %, contains it; else the median face width of the photo; else 0.35 × the O short edge (no face).
- The radius is clamped to [3 working px, 0.04 × O short edge].
- Example: `sample_face.png` has a face width of 589 px (|P(0) − P(32)| from `landmarks_sample_face.json`), so 小 = 11 px, 中 = 18 px and 大 = 28 px. A 3–6 mm blemish with its red halo is 12–25 px across on that face.

**No spot markers.** The healed result is the feedback, and the count is on the 清除 button. Tapping an earlier spot to delete it is out of scope; ↶ removes the last one.

### 2.4 New copy (in addition to C §2.6)

| Key | 繁體中文 |
|---|---|
| strip labels | 勻膚 · 膚色 · 黑眼圈 · 法令紋 · 白牙 · 亮眼 · 祛痘 |
| 膚色 slider ends | 冷 / 暖 |
| 祛痘 hint (C) | 點一下痘痘或瑕疵即可去除 |
| size control | 大小 · 小 · 中 · 大 |
| clear, all / one person / confirm | 全部清除（{n}） / 清除此人（{n}） / 確定清除？ |
| spot cap (C) | 祛痘點已達上限 |
| refused | 眼睛和嘴巴不適用祛痘 |
| zoom hint | 放大畫面可以點得更準 |
| mouth closed | 嘴巴閉合時看不到牙齒，白牙效果不明顯 |
| eyes closed | 閉眼時亮眼效果不明顯 |
| no face in the photo | 未偵測到臉部，膚質工具不會套用 |
| 基本模式 | 基本模式不支援膚質工具 |
| face answer not definite (the three tracker states of `Editor.tsx:789-797`) | 臉部偵測重新啟動中，膚質工具暫不套用 / 臉部偵測暫停，膚質工具暫不套用 / 臉部偵測失敗，膚質工具暫不套用 |

---

## 3. Architecture and data model

### 3.1 Parameter definitions (`src/engine/params.ts:4-37`, `src/types.ts:6-34`)

`ParamGroup` gains `'tone'` (C §3.8). New `ParamDef` rows, in strip order, appended after the 美膚 group:

| id | label | bidirectional | default | icon | scope | live |
|---|---|---|---|---|---|---|
| `tone.even` | 勻膚 | false | 0 | `even` | person | false |
| `tone.warmth` | 膚色 | true | 0.5 | `tone` | person | false |
| `tone.darkCircle` | 黑眼圈 | false | 0 | `darkCircle` | person | false |
| `tone.nasolabial` | 法令紋 | false | 0 | `nasolabial` | person | false |
| `tone.teeth` | 白牙 | false | 0 | `teeth` | person | false |
| `tone.eyeBright` | 亮眼 | false | 0 | `eyeBright` | person | false |

- They are person-level face items: they need a face (lens `applies`); an edit sets that person's `preset = 'custom'` and never touches `presetLink` (C §3.4).
- Every preset holds them neutral (C §3.4, Q7 default), so applying 自然／精緻／氣色／原圖 resets them.
- `重置` resets them with everything else and clears the spots (C §3.4: `defaultPhoto()` has no spots).

### 3.2 Types

```ts
// src/types.ts (replaces C §3.2's Spot)
export interface Spot {
  /** O-space centre, normalized by W_O and H_O (top-left origin) */
  x: number;
  y: number;
  /** radius, fraction of the O short edge */
  r: number;
  /** donor offset, fraction of the O short edge (isotropic); dx = dy = 0 → fill mode (no donor found) */
  dx: number;
  dy: number;
  /** the person whose face region (else body mask) held the centre when it was tapped; null = elsewhere */
  owner: PersonId | null;
}
export type SpotSize = 'S' | 'M' | 'L';

// DebugState (types.ts:409-421) gains, for e2e:
//   spots: number; lastSpot: Spot | null; toneBuilds: number; passes: string[];
```

Panel types (`src/ui/panelModel.ts`):
- `export type SkinSel = ParamId | 'spot'`, and `PanelSelection.skin: SkinSel` (the `BodySel` pattern, panelModel.ts:25).
- `ItemAction` gains `{ type: 'spot' }`. The divider is not an item: 勻膚 carries step 2's `PanelItem.divider: 'before'`.
- `SliderBinding` (panelModel.ts:457) gains `ends?: [string, string]`.

### 3.3 New pure modules

| Module | Contents |
|---|---|
| `src/config/limits.ts` (step 1 creates it, C §3.6) | `SPOT_CAP = 100` and `HEAL_RING_SAMPLES = 32`, next to the other caps, so the §6 fallbacks are one-line changes |
| `src/edit/spots.ts` | `SPOT_K = { S: 0.018, M: 0.030, L: 0.048 }`; `spotRadius(o, size, faces, oShort)`; `regionAt(o, faces) → { kind: 'eye' \| 'mouth' \| 'lip' \| 'skin' \| 'other'; face?: string }`; `ownerAt(o, detect) → PersonId \| null`; `planSpot(patch, tap, r, ctx) → Spot \| { refused: 'eye' \| 'mouth' \| 'cap' }`; `addSpot(edit, spot)`; `clearSpots(edit, scope: PersonId \| 'all')`; `spotsInScope(edit, scope)`; `sanitizeSpot(raw, personIds)` |
| `src/edit/patch.ts` | `readPatch(bitmap, rectO, maxSide) → { data, w, h, x0, y0, scale }` on the working bitmap. One reused 2D surface (`willReadFrequently: true`) from `createSurface` (`exporter.ts:99-129`, exported for this: `OffscreenCanvas`, else a detached `<canvas>`), `drawImage` then `getImageData`. It is the only DOM-touching function; everything in `spots.ts` runs on synthetic patches in Vitest. The patch only steers the snap and the donor choice; the heal itself always reads the GPU source, so a colour-management difference between the 2D canvas and the WebGL upload cannot misplace pixels. |
| `src/engine/passes/toneGeometry.ts` | Region builders for R and Q (§4.2) and the gates `eyeOpen(face, side)`, `mouthOpen(face)`, `farSide(face)`. Step 5's blink gate (C §4.4) reuses `eyeOpen`. |

`regionAt` uses, all from the cached O-space face:
- the face oval;
- the eye ring (pts111 52·53·72·54·55·56·73·57 and 58·59·75·60·61·62·76·63, adapter111.ts:22-32), padded by 0.15 eye width → `eye`;
- the inner-lip polygon (96–103) → `mouth`;
- the outer-lip polygon (84–95, adapter111.ts:35-38) minus the inner one → `lip`;
- the oval minus all of these → `skin` of that face;
- anything else → `other`.

`ownerAt` takes the face region first. Otherwise it takes the body mask with the highest value ≥ 0.5 (the C §2.2 hit-test rule). Otherwise it returns null.

### 3.4 Tap → spot (Editor)

1. zoomPan tap → client point → V (view module, C §3.5).
2. `o = backMapCpu(v, frame)` (`src/engine/backMapCpu.ts`, crop spec §3.8 and §4.6): the single CPU copy of P2's backward map. It applies Geo⁻¹, then the body field, then the summed multi-face chains with caps and protect; step 6 adds liquify first (`reshapeMapCpu(…, liquify?)`, push-brush spec §4.4). Its accuracy is pinned by C §8.2: the GPU agrees within 0.05 px. One call per tap; no inverse is ever needed. The result is the source position whose content the finger is on.
3. `regionAt(o)`: `eye` or `mouth` → refuse with the §2.3 toast.
4. Take r from §2.3. `readPatch` reads the square centred on o with half-side 5.6 r. That covers the farthest donor ring after the largest snap (0.8 r + 3.2 r + 1.4 r = 5.4 r) with a 0.2 r margin. It is scaled so that r ≥ 6 patch px and the side is ≤ 112 px, so r is 6 to 10 patch px.
5. `planSpot` snaps the centre and chooses the donor (§3.5).
6. `owner = ownerAt(centre)`.
7. Cap check; `addSpot` returns a new `EditState`; one undo push; render.

CPU budget: ≤ 6 ms on the test iPhone (patch read ≤ 2 ms, search ≤ 3 ms).

### 3.5 `planSpot` (CPU, deterministic)

Patch pixels, values 0..1. Y is Rec. 709 luma; Cb and Cr are JPEG full-range YCbCr. Disc and annulus means are direct sums over precomputed integer offset lists (a summed-area table only gives boxes). With r between 6 and 10 patch px (§3.4) that is at most about 200 snap candidates × 350 offsets, under 0.1 M operations per tap.

**Snap.**
- Score s(x) = max(0, Ȳ_ring(x) − Ȳ_core(x)) + 0.6 · max(0, C̄r_core(x) − C̄r_ring(x)). The core is a disc of 0.5 r; the ring is an annulus from 1.3 r to 1.6 r.
- Search every patch pixel within 0.8 r of the tap and take the maximum.
- If the maximum is below 0.015 (nothing that looks like a blemish), keep the tap. Ties go to the point nearest the tap.

**Donor candidates.** 16 offsets: distances {2.4 r, 3.2 r} × directions k · 45°. A candidate is valid when:
- the donor disc and its ring (1.4 r) lie inside the image;
- `regionAt` of the donor centre has the same kind and the same face as the spot (skin of the same face, lip of the same face, or other);
- `regionAt` of 8 points on the donor rim (radius 1.1 r) is never `eye` or `mouth`, so no lash or tooth is copied;
- the donor disc stays 1.1 (r + r_s) away from the centre of every existing spot s.

**Cost** (lower is better). Δ_k = T_k − D_k are the RGB means on the 1.3 r ring around the spot (T) and around the donor (D), at 32 angles, and Δ̄ is their mean. The membrane removes any smooth difference (§4.5), so the cost scores what it cannot remove:

  E = mean_k ‖Δ_k − Δ̄‖₁                                   (ring mismatch the membrane would have to bend around)
    + 0.25 · ‖Δ̄‖₁                                         (prefer donors of a similar tone)
    + 2 · max(0, sd_Y(donor disc) − 1.5 · sd_Y(donor ring))  (the donor holds its own blemish or an edge)
    + 0.5 · |hf(donor disc) − hf(spot ring)|,  with hf = mean |Y − box3(Y)| (texture match)

All four terms are in the same unit (mean absolute value differences), so standard deviations, not variances, are used. The minimum wins. Ties go to the smaller distance, then the lower angle index.

**No valid candidate** (the image edge, a tiny region): dx = dy = 0, fill mode. The result is converted to O units (x, y normalized; r, dx, dy as fractions of the O short edge).

### 3.6 Lens and panel (step-1 lens, C §3.3)

- `applies('tone.*')` needs a face. When the selected person has none, the reason is C §2.2's. When the photo has no face at all, the reason is 「未偵測到臉部，膚質工具不會套用」.
- The spot item never goes through the lens, because spots are photo-level. `clearSpots` reads the selection.
- `itemsFor`, case `'skin'` (panelModel.ts:326-340) returns: reset, the skin group, the tone group (勻膚 with `divider: 'before'`), the spot item. The camera context drops `live: false` items, so the divider goes with 勻膚.
- `activate` treats `{ type: 'spot' }` like `{ type: 'height' }` (select only).
- `sliderFor` returns null for `'spot'` (the screen shows `SpotControls`) and adds `ends: ['冷', '暖']` for `tone.warmth`.
- `showsSpotMode(sel)` mirrors `showsHeightBand` (panelModel.ts:175-177).

### 3.7 Files to add and change

| File | Change | Sub-step |
|---|---|---|
| `src/types.ts:6-34, 409-421` | `'tone'` group, tone ids (C), `Spot` (§3.2), `SpotSize`, DebugState fields | 4a |
| `src/types.ts:276-292` | `RenderInput.toneSource?: { source: TexImageSource; width: number; height: number }` (§4.6) | 4f |
| `src/config/limits.ts` | `SPOT_CAP`, `HEAL_RING_SAMPLES` (§3.3) | 4a |
| `src/engine/params.ts:4-37` | Six `ParamDef` rows (§3.1); presets neutral | 4a |
| `src/edit/state.ts`, `src/edit/lens.ts` (step 1) | `sanitizeSpot` inside `sanitizeEditState`; tone `applies`; 重置／⊘ rules | 4a |
| `src/engine/passes/toneGeometry.ts` (+ test) | New (§4.2) | 4b |
| `src/engine/passes/toneMask.ts` | New: draws R and Q per face (§4.2) | 4b |
| `src/engine/shaders/tone.ts` | New: `TONE_FIELD_FS`, `RETOUCH_FS`, box and Gaussian shaders, the `TONE` constant table | 4c |
| `src/engine/passes/toneField.ts` | New: P0c passes, cache key, `toneBuilds` | 4c |
| `src/engine/toneCpu.ts` (+ test) | New CPU reference, hash-pinned (§4.8) | 4c |
| `src/engine/pipeline.ts:103-112, 245-255, 360-424, 433-440` | `planPasses` gains `heal`, `toneField`, `retouch`; P0b–P0d; the A/B ping-pong (§4.1); new FB names | 4c, 4d |
| `src/engine/passes/heal.ts` | New: copy, ring pass, instanced quads (§4.5) | 4d |
| `src/engine/healCpu.ts` (+ test) | New CPU reference, hash-pinned | 4d |
| `src/engine/index.ts:174-194, 235-245` | Pass spots and tone values into the job; `toneBuilds` and `passes` debug; the export reuses the tone field | 4c, 4f |
| `src/edit/spots.ts`, `src/edit/patch.ts` (+ tests) | New (§3.3, §3.5) | 4e |
| `src/media/exporter.ts:99-129` | Export `createSurface` for `readPatch` | 4e |
| `src/ui/panelModel.ts:22-55, 326-340, 400-455, 457-505, 547-561` | `SkinSel`, strip, divider, spot action, `ends`, `showsSpotMode`, notes, `tabHasValue` | 4e |
| `src/ui/components/BeautyPanel.tsx` | Divider rendering; tone notes in the note slot | 4e |
| `src/ui/components/Slider.tsx:41-160` | `ends` captions | 4e |
| `src/ui/components/SpotControls.tsx`, `SpotOverlay.tsx` | New (§2.3) | 4e |
| `src/ui/screens/zoomPan.ts:33-126` | Tap mode: tap on `pointerup`, never on `pointercancel`, double-tap-to-fit off | 4e |
| `src/ui/screens/Editor.tsx:66, 679, 789-797, 832-871` | 祛痘 mode wiring, `lastSel` never `'spot'`, the §2.4 notes, `SpotControls` instead of `SliderRow`, `SpotOverlay` in `.zoom-layer`, tap → spot (§3.4) | 4e |
| `src/ui/icons.tsx` | Seven icons | 4e |
| `src/media/exportPlan.ts`, `src/media/exportFull.ts` (step 3) | `spotWindowGrowth` (the heal window rule), the GL budget while step-4 passes run, `toneSource` on every tile (§4.6) | 4f |
| `src/bench/main.ts` | `tone` row (§6) | 4f |
| `scripts/gen-tone-fixture.mjs`, `tests/e2e/global-setup.ts`, `.gitignore`, `LICENSES/NOTICE.txt` | Fixture (§8.3) | 4c |
| `tests/e2e/tone-engine.spec.ts`, `tests/e2e/pages/tone.{html,ts}` | New engine harness (§8.2) | 4c–4f |
| `tests/e2e/tone.spec.ts` | New app flows (§8.4) | 4e–4f |

---

## 4. Engine and shader changes

### 4.1 Pass order (replaces the tone and heal lines of C §4.2)

```
P0   mask     ¼ O   M  (step 1, unchanged)
                    R  RGBA8: R 黑眼圈_k · G 法令紋_k · B 白牙_k · A 亮眼_k              [any tone item > 0]
                    Q  RGBA8: R 勻膚_k · G skin coverage · B 膚色 (0.5-offset) · A 0      [勻膚, 膚色, 黑眼圈 or 法令紋 > 0]
P0b  heal     O     src → A: copy, ring pass (32 × N), instanced spot quads                [spots ≠ ∅]
P0c  field    ⅛ O   base0 → Mn8 → L (1/16 or 1/32) → Δ8 (法令紋 also reads base0); cached [勻膚, 膚色, 黑眼圈 or 法令紋 > 0;
                                                                                            亮眼 > 0 needs Mn8 only]
P0d  retouch  O     base0 → next: c = base0 + Δ8; 白牙 (R.B); 亮眼 (R.A)                   [any tone item > 0]
P1   makeup   …     reads the current base, writes the other full-size buffer
P2   warp     …     maskWarp of M only (R and Q are never warped)
P3/P4 mean, P5 composite: unchanged by step 4
```

- `base0` is A after P0b, otherwise `src`.
- R is drawn on every frame that runs P0d (白牙 and 亮眼 read it there); Q is drawn only when the tone field rebuilds (§4.3).
- **Ping-pong.** Today makeup always writes A and reshape always writes B (pipeline.ts:394, 408). From step 4, each full-resolution pass writes whichever of A and B is not its input. The capture output stays "the full-size buffer that is not the composite input" (pipeline.ts:436). Example with every pass on: P0b src→A, P0d A→B, P1 B→A, P2 A→B, composite reads B, capture writes A. No full-size buffer is added.
- **Buffer sizes under a crop or rotation (step 3).** The O passes (P0b, P0d, P1) render at the source size and P2 at the V size (crop spec §4.1, §4.3). With identity geometry the two are equal, so nothing changes. With a non-identity geometry and two or more O passes in the frame, the buffer P2 writes was used at the source size earlier in the same frame, so `fb()` re-specifies its storage twice per frame (pipeline.ts:234-243, gl.ts:190-197). The resident memory stays at two full-size buffers. The cost is two texture re-allocations per frame, and WebKit may hold the old storage until the GPU is done with it. §6 measures this and gives the fallback.
- `planPasses` (pipeline.ts:103-112) gains `heal`, `toneField` and `retouch`. With neutral tone values and no spots, all three are false and the frame is bit-identical to step 3 (parity goldens, C §8.3).
- The live camera never sets tone values or spots (`live: false`), so these passes never run there.

### 4.2 Region masks (P0: `toneMask.ts`, geometry in `toneGeometry.ts`)

**Notation.**
- P(i) is pts111 point i; all distances are iso (mask.ts:70).
- fw = |P(0) − P(32)| (mask.ts:94); eyeW_L = |P(52) − P(55)|; eyeW_R = |P(58) − P(61)|; mouthW = |P(84) − P(90)|.
- x̂ = unit(P(77) − P(74)), the line between the eye centres. ŷ = x̂ turned +90° (down in image coordinates), negated if ŷ · (ext[4] − P(46)) < 0, so it always points to the chin.
- For a side, the outward direction o is −x̂ on the image-left side and +x̂ on the image-right side.

**Shader.** One program: `in vec2 aPos; in float aVal; uniform vec4 uStr;`. Output = `uStr · smoothstep(0, 1, aVal)`, except Q.B, which is `0.5 + 0.5 · uWarm · smoothstep(0, 1, aVal)`.

**Clear and blend.**
- R is cleared to (0, 0, 0, 0). Each region draw writes only its own channel (the others output 0) with `MAX`, so overlaps keep the strongest face.
- Q is cleared to (0, 0, 0.5, 0).
  - The skin draw uses `colorMask(R, G)`: `MAX` for the base, `MIN` for the holes, as mask.ts:174-182.
  - The wide 膚色 draw uses `colorMask(B)`. A warm face (`uWarm ≥ 0`) draws `MAX` for the base and `MIN` for the holes; a cool face draws `MIN` for the base and `MAX` for the holes. A hole outputs `0.5 + 0.5 · uWarm · h`, so it pulls toward neutral from either side.
  - Faces of the same sign keep the stronger one where they overlap, like every other channel. Opposite signs can only meet in feather rings, and there the face drawn later (table order) wins. This is accepted.

**Geometries** (per face, in O, with the same aspect handling as `buildMaskGeometry`):

| Region | Target.channel | Built from | Shape and feather | Gate folded into `uStr` |
|---|---|---|---|---|
| 勻膚 and skin coverage | Q.R = strength, Q.G = 1 | `buildMaskGeometry` (mask.ts:58-125): oval + 8 % fw ring, eye and mouth holes | As 磨皮 | — |
| 膚色 | Q.B | Oval + a wide ring of width w_T, the same eye and mouth holes. w_T = 0.30 fw when the face has no cap (step 1 writes `cap_f = −1` in face-table texel 73 for a face without a neighbour; `cap_f = 0` is a real cap with zero influence); otherwise w_T = clamp(cap_f − r_oval, 0.08 fw, 0.30 fw), with r_oval the largest iso distance from the cap centre c_f to an oval point (C §4.3). The ring therefore stops about halfway to the next face. | Ring value 1 → 0 | — |
| 黑眼圈 | R.R | Lower-lid chain, image-left 52·57·73·56·55, image-right 61·62·76·63·58 (adapter111.ts:22-32), resampled to 7 points by arc length, t = 0…1 | Rows along ŷ with τ = sin(πt): 0.06 eyeW (value 0), (0.06 + 0.12τ) eyeW (value τ), (0.06 + 0.40τ) eyeW (value 0). It tapers to nothing at the corners and leaves the lashes alone. | Far-side fade |
| 法令紋 | R.G | Per side: S = P(82 or 83) + 0.04 fw·o − 0.01 fw·ŷ; E = P(84 or 90) + 0.06 fw·o + 0.05 fw·ŷ; control C = (S + E)/2 + 0.035 fw·o. A quadratic Bézier with 9 samples. | Half-width h(t) = 0.035 fw · (0.6 + 0.4 sin πt); rows −h (0), −h/2 (1), centre (1), +h/2 (1), +h (0): full strength over the inner half, since the fold reference of §4.3 lifts only a valley across the band, so the band marks where a fold may lie and need not guess its line (step 4 follow-up; the first band, a tent peaking on the centre row, left the fixture's fold cores at a mean R.G of 0.68 / 0.80); the inner rows × smoothstep over the first and last 15 % | Far-side fade |
| 白牙 | R.B | Inner-lip polygon 96·97·98·99·100·101·102·103 (adapter111.ts:39-40) | Value 1 on the whole polygon (a fan from its centroid), falling to 0 over an outward ring of 0.04 mouthW. R.B carries the strength only: the lip guard of §4.4 decides the lip line at full resolution (the ¼-res fan, read bilinearly, reaches a few pixels onto the lip), and the colour gate of §4.4 keeps gums and tongue out. | × smoothstep(0.01, 0.03, mouthOpen), mouthOpen = \|P(98) − P(102)\| / mouthW |
| 亮眼 | R.A | Eye rings 52·53·72·54·55·56·73·57 and 58·59·75·60·61·62·76·63 | Each ring point p_i is moved toward the eye centroid c: 0 at an inset of min(0.04 eyeW, 0.25 \|c − p_i\|), 1 at an inset of min(0.12 eyeW, 0.5 \|c − p_i\|), a fan of 1 inside. The lid skin stays out (its chroma would pass the iris gate of §4.4). | × smoothstep(0.12, 0.18, EAR) per eye, EAR = \|P(72) − P(73)\| / eyeW_L (right: P(75), P(76), eyeW_R); far-side fade |

- **Why no fixed inset.** A fixed inset crosses the centroid on a narrow opening and folds the geometry. `sample_face.png` shows its teeth through an opening of 8.7 px with mouthW 204 px (mouthOpen 0.042), so a fixed inset of 0.08 mouthW (16 px) would turn the mouth region inside out. The eye insets are capped by the distance to the centroid for the same reason (a squint at EAR 0.18 has a half-height of about 0.09 eyeW).

- **Far-side fade.** The far side is the one whose eye is nearer to the nose tip P(46) in the image: image-right when `yaw > 0` (adapter111.ts:92-103). Its regions are multiplied by 1 − smoothstep(0.25, 0.50, |yaw|); the near side and the mouth are not faded. MediaPipe invents landmarks on a hidden cheek, and this keeps a crescent off the nose bridge or the background.
- Every face in the table is drawn (a person whose items are all 0 writes 0, C §4.1). The draw count is ≤ 6 faces × (2 skin + 2 crescents + 2 bands + 1 mouth + 2 eyes): tiny.

### 4.3 Tone field (P0c: `toneField.ts`, shaders in `shaders/tone.ts`)

It is computed at the **working resolution** (W, C §3.5), in O, into RGBA8 buffers, and never per tile.

**Scales** (fractions of the short edge SE, so they do not depend on resolution, tiles or crop):
- σ_mid = 0.0141 · SE. This is the effective σ of the P3/P4 sparse mean: taps {0, ±1.5, ±3.5} · 4 · SE/720 with weights 1/9 and 2/9 give 10.15 px at SE 720 (uniforms.ts:42-61). The tone field's "mid band" is therefore the same band 磨皮 works on.
- σ_low = clamp(0.08 · fw_max, 3 σ_mid, 0.12 SE), where fw_max is the largest fw among faces with 勻膚, 膚色, 黑眼圈 or 法令紋 above 0. One σ per photo: in a group photo it fits the largest edited face, and a smaller face gets a broader reference, which is harmless.

**Passes** (all tiny; the largest buffer is ⅛ of W, 256 × 192 for 2048 × 1536):
1. **D8**: 8 × 8 box of `base0` (16 bilinear taps) → ⌈W/8⌉ × ⌈H/8⌉.
2. **Mn8**: separable Gaussian σ_mid/8 on D8 (2 passes, linear-sampled tap pairs, radius ⌈3σ⌉).
3. **L**: an (f_L/8)-box of (Mn8 · q, q) with q = Q.G (skin coverage), at 1/f_L size, f_L = 16 if σ_low ≤ 96 W-px else 32; then a separable Gaussian σ_low/f_L (2 passes). L holds premultiplied (rgb · q, q): a normalized convolution, so hair, background, eyes and the mouth do not bias the skin reference.
4. **Δ8**: ⅛ size, stored offset-encoded as `0.5 + 2Δ` with Δ clamped to ±0.25 (an 8-bit step of 0.5/255, below one output LSB).

**Δ math** (`TONE` constants live in one table in `shaders/tone.ts`, mirrored by `toneCpu.ts`):

```
m    = Mn8(x)
Lc   = L.rgb / max(L.a, 1/255);   conf = smoothstep(0.15, 0.30, L.a)
b    = m − Lc;   bY = dot(b, LUMA709);   bC = b − bY            // mid band: luma and chroma parts
lift = −min(bY, 0)                                               // only darker-than-reference is lifted
gE   = 1 − smoothstep(0.06, 0.14, |bY|)                          // 勻膚 leaves moles, brows, nostrils alone
gD   = 1 − smoothstep(0.20, 0.30, −bY)                           // 黑眼圈 / 法令紋 leave lashes and frames alone
wE   = Q.r · conf · gE;   wD = R.r · conf · gD                   // 勻膚, 黑眼圈
fL   = 1 − (1 − 0.45 · wE) · (1 − 0.85 · wD)                     // lift: 勻膚, then 黑眼圈 on what is left (v0.4 cleanup)
fC   = 1 − (1 − min(1, 0.90 · wE)) · (1 − 0.70 · wD)              // chroma, the same; neither factor passes 1
ΔY   = fL · lift;   ΔC = −fC · bC                                 // a luma lift and a zero-luma chroma correction
// 法令紋 (step 4 follow-up): the valley depth across its band, not the mid band against L
B(p) = the 8 × 8 box of base0 centred at p (D8's footprint, 16 bilinear taps)
n    = the unit normal of the nearest listed band chord S → E     // §4.2's S and E; none listed: no 法令紋
bN   = B(x) − (B(x + k·n) + B(x − k·n)) / 2,   k = 2 σ_mid
bNY  = dot(bN, LUMA709);   gN = 1 − smoothstep(0.20, 0.30, −bNY);   wN = R.g · conf · gN
ΔY   = max(ΔY, 1.20 · wN · −min(bNY, 0))                          // over 勻膚 / 黑眼圈: the larger lift, not the sum
nC   = −0.30 · wN · (bN − bNY);   sC = ΔC + nC
ΔC   = sC · min(1, max(|ΔC|, |nC|) / max(|sC|, 1e-6))             // no longer than the longer correction
Δ    = ΔC + ΔY
c0   = m + Δ;   s = 2 · (Q.b − 0.5)                              // 膚色, already × region ramp
g    = s ≥ 0 ? 1 + s · (0.06, 0.02, −0.07) : 1 + |s| · (−0.03, −0.02, 0.07)
c1   = c0 · g;   c1 *= Y(c0) / max(Y(c1), 1e-4)                  // brightness kept
Δ   += (c1 − c0) · skin(c0)
```

- `skin(c)` is a soft box on Cb ∈ [0.302, 0.498] and Cr ∈ [0.522, 0.678] (8-bit 77–127 and 133–173, Chai & Ngan 1999) with 0.03 soft edges. It keeps 膚色 off hair, clothes and background inside the wide ring.
- The tone tools do **not** use GPUPixel's skin ramp `p` (composite.ts:167). That ramp needs `I.r` above about 0.2–0.45, so it fades out on darker skin. The region masks and the guards above work for every skin tone.
- **Why 法令紋 has its own reference (step 4 follow-up).** A nasolabial fold often lies on a convex cheek highlight. L, at σ_low, averages that highlight with the darker cheek edge and mouth around it, so the fold reads as brighter than L and `lift = −min(bY, 0)` never sees it: on the fixture the fold cores keep a mean mid-band bY of +0.036 / +0.023, and 法令紋 recovered 0.002 / 0.013 of the fold (0.002 / 0.021 at lift ×2). A reference across the band fixes that, but not at the mid-band scale: on the fixture's image-left side the soft fold sits on a steep flank, Mn8 falls monotonically across it, and the ridge's own curvature at ±2–4 σ_mid is as large as the fold's (pairs of Mn8 values reached at most 0.19 there, at lift ×2). At D8's 8 × 8 box the fold is still sharp (σ about 12 px for the fixture's 11.8 px) while the ridge's curvature over ±k = 2 σ_mid stays small. The pair mean also leaves a linear slope exactly alone, and a convex ridge without a fold reads as no valley, so the term stays self-limiting. The chords come from `toneGeometry.foldChords` through `ToneJob.folds` and `ToneFieldPass.build(…, folds)` (uniforms `uFolds`, `uFold[12]` in working px, `uFoldK`, and base0 on unit 4; `toneCpu.foldBand` mirrors it). The gain 1.20 (×1.5 from 0.80) is calibrated in §8.2.
- **Overlapping tools (v0.4 cleanup).** 勻膚's region (Q.R, §4.2) covers the crescents and the bands, so the tools meet there. They used to add: under the eyes the lift factor reached 0.45 + 0.85 = 1.30 and the chroma factor 1 + 0.70 = 1.70, past L. 勻膚 and 黑眼圈 read the same mid band b, so they now combine as if one ran after the other against the same L: what 勻膚 leaves, (1 − e)·b, 黑眼圈 lifts by d, giving 1 − (1 − e)(1 − d). Neither factor can pass 1, each slider still acts where the other is at 100, and each tool alone is unchanged. 法令紋 reads its own reference, so its factor is not composed with theirs (that would let 勻膚 weaken 法令紋 on a fold that reads brighter than L, where 勻膚 lifts nothing): ΔY takes the larger lift, and the chroma sum is cut to the longer correction's length. On the fixture at 100 (CPU), 勻膚 + 黑眼圈 + 法令紋 move from (adding) to (composed): darkL Y 1.114 → 1.092, darkR 0.753 → 0.609, left lash line kept 0.792 → 0.801 (the 0.8 keep of §8.2 failed before), right 0.839 → 0.882, folds 0.612 / 0.718 → 0.611 / 0.713 (法令紋 alone 0.606 / 0.694); the blotches stay at 1.239 / 0.496. A recovery above 1 is not a factor past 1: 黑眼圈 alone reaches 0.963 on darkL, and both tools also lift the photo's own under-eye shading against L, which no factor rule can tell from the synthetic darkening. A plain `min(1, e + d)` would have changed nothing there (darkL 1.114, lash line 0.792), since the summed factor stays at or below 1 over most of that crescent.
- **Why the result keeps texture:** Δ is built from Mn8 and L, and 法令紋's from 8 × 8 box means of base0, so it holds no detail finer than an 8 px box (σ_mid for every tool but 法令紋). The high frequencies of `base0` pass through P0d untouched.
- **Cache.** `toneKey` = the working image's identity (the `RenderInput.source` object of the preview, or `RenderInput.toneSource.source` in a tile, §4.6, plus its size) + the spots key (base0 includes the heal) + per face (id, fw, the four field values, a 亮眼-on flag) + σ_low. The engine re-uploads `source` on every render (index.ts:224), so the key uses the object, not the texture. An unchanged key reuses Mn8, L and Δ8. `DebugState.toneBuilds` counts rebuilds. A 瘦臉, 美體, 推臉筆, 調節 or 濾鏡 drag never rebuilds the field. The field targets are not shrunk by step 3's `releaseBuffers`; they are freed only on dispose or context loss.

### 4.4 Retouch (P0d, `RETOUCH_FS`)

Full resolution: the preview, or one tile through `uWin`. Units: base0, Δ8, Mn8, R (4 units).

```
c = base0(o) + Δ8(o)
// 白牙
w = R.B(o) · lipGuard(o)                                                       // 0 outside the inner-lip polygons
if (w > 0) {
  t = smoothstep(0.12, 0.18, Y(c)) · (1 − smoothstep(0.555, 0.60, Cr(c)))     // tooth-like (shadowed teeth too), not gum/tongue
  k = w · t
  Cb += max(0, 0.5 − Cb) · 0.75 k;   Cr += (0.5 − Cr) · 0.35 k;   Y += 0.08 k (1 − Y)
}
// 亮眼
w = R.A(o)
if (w > 0) {
  ch = 2 · length(Cb − 0.5, Cr − 0.5)
  sc = smoothstep(0.32, 0.50, Y) · (1 − smoothstep(0.10, 0.20, ch))           // sclera
  Cb, Cr move toward 0.5 by min(1, 0.60 · w · sc);   Y += 0.05 · w · sc · (1 − Y)   // never past neutral
  ir = smoothstep(0.05, 0.12, ch) · smoothstep(0.06, 0.12, Y) · (1 − smoothstep(0.45, 0.60, Y))   // iris
  Y += 0.04 · w · ir
  c += 0.70 · w · (1 − sc) · clamp(base0(o) − Mn8(o), −0.12, 0.12)            // clarity: iris texture, lash line
}
out = clamp(c, 0, 1)
```

- YCbCr uses the JPEG full-range matrices; Y in the tone stages is Rec. 709.
- The order is fixed: field, then 白牙, then 亮眼.
- **白牙's tooth gate and lip guard (step 4 follow-up, plan Task 11 decision (b)).** The first gate, smoothstep(0.28, 0.42, Y), passed none of `sample_face.png`'s teeth: they are in shadow at Y 0.15–0.25 (the gap between them ≤ 0.13), as teeth often are, so 白牙 did nothing on the reference face. The gate is now smoothstep(0.12, 0.18, Y). A lower gate alone moved the lips 23–28/255, and colour cannot fix that: the lip pixels 0–3 px outside the inner-lip line (Y 0.10–0.22, Cb 0.47, Cr 0.53–0.57) look exactly like the shadowed teeth (Y 0.15–0.25, Cb 0.46–0.49, Cr 0.52–0.57), and on this photo some of them are teeth the landmarks miss. Nor can the ¼-res R.B: read bilinearly, any fan reaches 2–4 px past the line (an inset fan still moved the lips 10/255). So P0d tests the inner-lip polygon 96–103 of every face with 白牙 on at full resolution: `lipGuard(o)` is 0 outside every polygon and smoothstep(0, 0.01 · mouthW, d) inside, d being the true iso distance to the lip line (uniforms `uMouths`, `uMouth[48]`, `uMouthW[6]`, `uAspect`; `toneCpu.lipGuard` mirrors it). No landmark is added. Measured on the fixture: teeth Cb recovery 0.879 (CPU and GPU), lips 0/255, outside 0/255. On `sample_face.png` at 100, over the 486 teeth pixels: mean ΔY +11.95/255, ΔCb +4.12/255, Δchroma −8.74/255; the lips and everything outside the inner lip move 0/255.
- **Gains above 1 (step 4 follow-up).** The calibration raised 亮眼's detint to 1.20 and 勻膚's chroma to 1.08 (§8.2). Both act through an effective factor capped at 1 (`min(1, 1.20 · w · sc)`, `min(1, 1.08 · wE)`), so a fully weighted sclera lands on neutral and 勻膚 cancels bC without inverting it; above 1 a gain only steepens the region ramp. Where 勻膚 and 黑眼圈 overlap, the combined factors stay at or below 1 too (§4.3, overlapping tools).
- Iris and sclera are told apart by colour, not geometry, so step 4 needs no iris landmarks (`Face.iris` stays in step 5, C §3.8).

### 4.5 Heal (P0b, `heal.ts`)

1. **Copy** `src` → A with `COPY_FS` (gl.ts:21), blending off.
2. **Ring pass** into `RING` (RGBA8, NEAREST, 32 × N). Fragment (k, s), with θ_k = 2πk/32:
   - T_k = mean of `src` at c + {1.2, 1.3, 1.4} r · u_k; D_k = the same at + d.
   - Δ_k = T_k − D_k, or T_k in fill mode.
   - Robust weights over the 32 values: μ = mean, σ = rms of Y(Δ_k − μ) + 0.01, o_k = 1 / (1 + (|Y(Δ_k − μ)| / 2σ)²); μ is recomputed with o, then o once more. A hair or another blemish crossing the ring therefore barely counts.
   - Output: rgb = 0.5 + Δ_k (fill mode: T_k), a = o_k.
3. **Spot quads**: one instanced draw (`drawArraysInstanced`; per instance: c, r, d, mode). The quad half-side is 1.1 r. Blending is `ONE, ONE_MINUS_SRC_ALPHA` (premultiplied). Each fragment reads `src` and `RING`:

```
ρ  = |p − c| / r;                if (ρ > 1.1) discard
ρ' = |p − c| / (1.3 r);          φ = angle(p − c)
P_k = (1 − ρ'²) / (1 − 2 ρ' cos(φ − θ_k) + ρ'²)       // Poisson kernel: the exact harmonic interpolant on a disc
M   = Σ o_k P_k Δ_k / Σ o_k P_k
healed = donor ? src(p + d) + M : M                    // donor + membrane = Poisson-cloned patch (healing brush)
α   = 1 − smoothstep(0.80, 1.10, ρ)
out = vec4(healed · α, α)
```

- The donor brings real pores and grain. The membrane M removes the colour and brightness difference between the donor's surroundings and the spot's, so there is no seam. This is the healing-brush construction (Poisson image editing on a disc). With 32 ring samples the spacing is 0.26 r; where the feather starts (ρ = 0.8) the kernel's peak is about 0.5 r wide, so the sampling resolves it, and beyond that α fades the result out.
- Spots are drawn in list order, and every quad reads the unhealed `src`. Donors avoid other spots (§3.5) and the robust weights ignore other spots in a ring, so overlaps compose cleanly.
- The heal runs every frame while spots exist (copy + 32·N ring fragments + the quads): ≤ 1.5 ms for 20 spots. It is not cached, since caching would need a new full-size buffer (the §6 fallback is the one case that adds it).

### 4.6 Tiled export (C §4.6, amended by A5)

- **Tone field:** one global texture computed from the working-resolution image. A tile's `source` is only its window bitmap, so the tile runner also passes `RenderInput.toneSource` = the working bitmap (`still.ts` holds it) and its size. When the key matches, the preview's field is reused. Otherwise (the export started before the preview drew the latest edit, say) the engine rebuilds it once from `toneSource`, running P0b and P0c at working resolution, before the tile's own passes. Every tile samples the field by O coordinates, so it needs no apron.
- **R** is drawn per tile at ¼ tile size from the face table through `uWin`, like M. Q is not needed per tile: its strengths are already folded into Δ8.
- **GL budget:** while a step-4 pass runs, B holds an O-space result at window size before P2 re-sizes it (§4.1), so the step-3 planner counts src, A and B at window size and C and D at buffer size: `(3·win² + 2·buf²) · 4 B ≤ 40 MB` (crop spec §4.4, planner step 1).
- **Heal window:** for each spot whose quad (1.1 r) meets the tile's source window, the window grows to include bbox(c ± 1.4 r) ∪ bbox(c + d ± 1.4 r). With r ≤ 0.04 SE and |d| ≤ 3.2 r, it grows by at most 0.18 SE, toward that spot only. The ring pass runs per tile on the tile's own pixels.
- **Retouch** per tile reads the global Mn8 and Δ8. 亮眼's detail term uses the tile's full-resolution pixels minus the working-resolution Mn8, so the export also sharpens detail finer than one working pixel and looks slightly crisper. This is accepted; the ±0.12 clamp bounds it.
- σ_mid, σ_low, r and d are all fractions of SE (C §3.5 `fullShortEdge` rule).

### 4.7 GPU resources (replaces C §4.7 rows R and S)

| Resource | Format | Size (2048 × 1536 working image) |
|---|---|---|
| R | RGBA8 | ¼ O, 0.8 MB |
| Q | RGBA8 | ¼ O, 0.8 MB |
| D8 (holds Mn8 after pass 2), T8 | RGBA8 | ⅛ O, 2 × 0.2 MB |
| Δ8 | RGBA8 | ⅛ O, 0.2 MB |
| L, Lt | RGBA8 | 1/16 or 1/32 O, ≤ 2 × 0.05 MB |
| RING | RGBA8 NEAREST | 32 × ≤ 100, 13 KB |
| Spot instance buffer | Float32 | ≤ 100 × 6 floats |

The total is about 2.3 MB. C budgeted 1.6 MB for R and S, so step 4 adds 0.7 MB to C's ≤ 6 MB resident budget (C §4.7). No full-size buffer is added (unless the §6 fallback is triggered), and every format is renderable in core WebGL2, with no extension. RGBA16F would need `EXT_color_buffer_float`; the 8-bit precision of L's premultiplied sums costs at most about 1.5/255 in the reference colour where `conf` is 1, and L is sampled bilinearly, so it shows as a smooth error, not as banding.

### 4.8 CPU ports and hash pins (C §8.2)

| Shader | CPU port | Pin |
|---|---|---|
| `HEAL_RING_FS`, `HEAL_FS` | `src/engine/healCpu.ts` | Hash of both sources, pinned in `healCpu.test.ts` at step 4 |
| `TONE_FIELD_FS`, `RETOUCH_FS` (+ the box and Gaussian shaders) | `src/engine/toneCpu.ts` | Hash pinned in `toneCpu.test.ts` |
| `toneMask` geometry | `toneGeometry.test.ts` | — |
| `COMPOSITE_FS` | — | **Not re-pinned by step 4** (A6) |

---

## 5. Persistence and migration

- **Tone values** live in `PersonParams.values` (C §3.2) and are saved with `EditState` in `HistoryEntry.edit`. v1 entries, migrated camera looks (`splitLegacy`) and new persons from `template` get neutral values. `sanitizeEditState` clamps them to 0..1 like every value.
- **Spots** live in `edit.photo.spots`. `sanitizeSpot`:
  - drops a spot with any non-finite field;
  - clamps x and y to [0, 1] and drops a spot outside [−0.01, 1.01];
  - clamps r to [0.0005, 0.04];
  - sets dx = dy = 0 (fill mode) when |d| > 0.2;
  - sets `owner` to null when the id is not a person in the detection cache;
  - keeps the first 100 (C §5.3);
  - drops every spot when `sanitizeEditState` gets no `oSize` (the camera look, C §3.2), so `CameraLook.photo.spots` is always `[]`.
- **Dedupe key:** `editKey` (C §3.4) includes the spot values (at most 100 × 6 numbers).
- **Rollback:** `legacyProjection` drops the tone values and the spots, so 0.3 opens a 0.4 entry without them (C §5.1 rollback note). An entry 0.3 then edits keeps both on the way back to 0.4: 0.3 stores no `tone.*` value and no spot, so `mergeLegacy` leaves them as the v2 edit has them (step-1 spec §5.3, v0.4 step 4 follow-up).
- **Re-detection** with remapped persons (C §5.2, last rows): `owner` is remapped through the same person map; an unmatched owner becomes null. Spot positions never change, because they are in O.
- **Nothing GPU-side is persisted.** The tone field is rebuilt on open (≤ 2 ms).
- **Size:** ≤ 100 spots × about 70 B ≈ 7 KB per entry, well inside C's 512 KB edit budget.

---

## 6. Performance budget and measurements

| Path | Budget (test iPhone; desktop Chromium first) |
|---|---|
| Tap → healed spot on screen | ≤ 50 ms: CPU ≤ 6 ms (§3.4) + one render |
| Slider frame at 2048, one face, every tone tool on, 20 spots | ≤ 4 ms more than the same frame without tone or spots |
| Tone-field rebuild (a 勻膚, 膚色, 黑眼圈 or 法令紋 drag) | ≤ 1.5 ms GPU |
| Heal with 100 spots | ≤ 3 ms |
| Other drags (美型, 美體, 調節…) with tone on | No field rebuild (`toneBuilds` unchanged) |
| Full export, 12 MP, tone and 20 spots | ≤ +0.8 s over C §6.1's 6 s |
| Slider frame with a crop, 20 spots, 勻膚 and 口紅 on (the two re-sizes of §4.1) | ≤ 1 ms more than the same frame without the crop |
| New resident memory | +0.7 MB over C's R and S rows (§4.7) |

**Measurements.**
- `src/bench/main.ts` gains a **tone** row on `sample_face.png`: GPU time of P0b with 20 and 100 spots; P0c rebuild; P0d; the whole frame with and without tone; `planSpot` CPU time (median of 20 taps); and **tone + crop**: the same frame with a 3:4 crop and a 90° rotation, against identity geometry, with the Web Inspector memory timeline over 10 s of a 瘦臉 drag.
- Desktop now; iPhone through `/bench.html` only after the user's go-ahead for a preview deploy (C §6.2.3).
- **Fallbacks if the iPhone numbers miss the budget:**
  - heal cost: lower the spot cap to 50, then the RING to 24 samples (spacing 0.34 r, still under the 0.5 r peak width at ρ = 0.8). These are one-line changes in `src/config/limits.ts` (`SPOT_CAP`, `HEAL_RING_SAMPLES`).
  - tone + crop over budget, or memory that keeps growing: a third O-size buffer `H` holds the P0b/P0d result, so the chain becomes P0b src→A, P0d A→H (or one of them straight into H), P1 H→A, P2 A→B, and A and B keep one size each. `H` is allocated only while a step-4 pass runs with a non-identity geometry, never on tier L, and is deleted when either stops. It also lets frames whose step-4 inputs did not change skip P0b and P0d. It costs 12.6 MB at 2048 × 1536 while it exists, so it is the fallback, not the default.

---

## 7. Error and edge cases

| Case | Handling |
|---|---|
| Photo without a face | Tone sliders disabled with 「未偵測到臉部，膚質工具不會套用」; 祛痘 works, sized by 0.35 × short edge |
| 基本模式 | Tone sliders disabled with 「基本模式不支援膚質工具」; 祛痘 works as without a face (no eye or mouth refusal, sized by 0.35 × short edge) |
| Face answer temporarily unknown (tracker recovering, paused or failed: `Editor.tsx:789-797`) | All seven items disabled with the §2.4 note until the answer is definite; a tap could otherwise heal an eye that the refusal rule cannot see yet |
| Spot tapped before 美體 detection ran (arms, body) | `owner` = null, and it is not recomputed when bodies arrive later; 全部清除 or ↶ removes it |
| Selected person without a face | C §2.2 note; under 全部 the tone items write only the persons with faces |
| Closed mouth / closed eyes | Gates fade 白牙 and 亮眼 to nothing; the §2.2 notes explain it |
| Profile or strongly turned face | Far-side regions fade (§4.2) |
| Glasses, hair over the face, beard | 勻膚's guard skips high-contrast features; 黑眼圈 only lifts darker-than-reference mid-band shading and 法令紋 only a valley across its band, and both skip extreme darkness. A thick frame inside the crescent can still turn slightly grey at 100 (§9). |
| Heavy makeup | Tone runs before P1, so the app's own makeup is untouched. Makeup already in the photo is skin to the tools: 勻膚 may soften strong contour at 100. |
| Tap on an eye or the open mouth | Refused with a toast (§2.3) |
| Tap near the image border, or no clean donor | Fill mode (membrane only, smooth). Rare; at most a slightly flat disc. |
| Tap on a spot that already exists | A second spot is added. Its donor search avoids the first disc, and its ring may cross it (robust weights). |
| Tap on another person than the selected one | Allowed; `owner` is the person tapped. 清除此人 for the selected person keeps it. |
| Spot cap reached | Toast; no spot |
| Spot later cropped away or warped | Kept in O; invisible while cropped, back when the crop is undone (C §7) |
| Spot on arms or background | Works; owner = the body person or null |
| Rotation, flip, crop, 推臉筆 after spots | Spots stay on their content (A1). The tap mapping uses the current back-map, so a spot tapped after a rotation lands on what the finger touched. |
| A detection cache rebuilt with new person ids | Owners remapped or nulled (§5); tone values follow C §5.2 |
| Context loss or engine swap | All state is in `EditState`; the field rebuilds on the next frame |
| `readPatch` throws | The spot is still added at the tap with fill mode, and the error is logged with `reportError` |
| A `pointercancel` (system gesture, incoming call) during a tap | No spot (§2.3) |
| Tiled export with a spot on a tile border | Window rule (§4.6); the engine harness checks tiled = untiled within 1/255 (§8.2) |
| An export that starts before the preview drew the latest edit | The tone field is rebuilt from `toneSource` before the first tile (§4.6) |

---

## 8. Testing

### 8.1 Unit (Vitest)

- **`toneGeometry.test.ts`** on the recorded face (`landmarks_sample_face.json`) and its mirror:
  - every vertex is finite;
  - crescent rows lie below the lower-lid chain along ŷ, and the top row is ≥ 0.05 eyeW from the lid;
  - each nasolabial band lies inside the box of P(82|83) and P(84|90) grown by 0.1 fw;
  - the area where the mouth region is 1 equals the inner-lip polygon's within 1 %, and the eye region never folds: a synthetic eye with EAR 0.15 and a mouth with mouthOpen 0.01 still give positive-area, non-self-intersecting triangles;
  - the mirrored face gives the mirrored geometry within 1e-6;
  - a degenerate face (all points equal) gives zero-area output and no NaN;
  - `eyeOpen`, `mouthOpen` and the far-side fade are monotonic, with the stated thresholds;
  - w_T is 0.30 fw for a lone face (cap off), and shrinks toward 0.08 fw as another face comes close; the ring never passes the midpoint between two face centres when there is room for 0.08 fw.
- **`toneCpu.test.ts`:**
  - neutral values give Δ = 0, and the retouch output equals the input bit for bit;
  - 勻膚 at 1 removes ≥ 85 % of a synthetic mid-band chroma pattern, while `I − Mn` changes ≤ 1/255;
  - a mole (bY = −0.2) is untouched by 勻膚;
  - 黑眼圈 lifts only negative bY;
  - overlapping tools (v0.4 cleanup): 勻膚 + 黑眼圈 at once equal 勻膚, then 黑眼圈 on its result, so a fully weighted texel stays between m and L; 黑眼圈 at 0.5 still adds over 勻膚 at 1; 法令紋 over them gives the larger lift and a chroma correction no longer than the longer one; on the fixture at 100 (toneCalibration.test.ts), 勻膚 + 黑眼圈 + 法令紋 together keep every bound of each tool and each recovers at least what it does alone;
  - 法令紋 lifts a soft fold on the flank of a convex ridge, where Mn8 makes no minimum, by ≥ 50 % at its core; leaves the ridge without the fold and a linear slope within 1/255; and does nothing without a listed band chord (step 4 follow-up);
  - 膚色 ±1 is symmetric in Cb, keeps Y within 1/255, and does nothing on green or blue pixels;
  - 白牙 neutralizes yellow-white pixels and leaves red (lip, gum) pixels unchanged;
  - 亮眼 detints the sclera, and its clarity respects the clamp;
  - σ_low selection;
  - the Δ offset encoding round-trips within 0.5/255;
  - the hash pin.
- **`healCpu.test.ts`:**
  - harmonic property: a constant ring gives a constant disc exactly, and a linear ring a linear disc within 1e-3;
  - donor + membrane matches the ring at ρ' → 1;
  - a dark Gaussian dot on a synthetic textured field: the disc's Y standard deviation ends within 15 % of the surrounding skin's and its mean within 1 %;
  - fill mode;
  - an outlier sector (a 2 px dark line crossing the ring) adds < 2/255 error;
  - two overlapping spots compose;
  - the hash pin.
- **`spots.test.ts`** on synthetic patches:
  - snapping to a dot within 1 px when the tap is within 0.8 r, and no snapping on flat skin;
  - donors respect image edges, other spots and regions (never an eye, a different face or lip-to-skin; no rim point in an eye or the mouth);
  - a donor whose ring differs from the spot's ring only by a constant offset beats a closer-toned donor with a mismatched texture (the cost of §3.5);
  - determinism;
  - fill mode;
  - refusals in eye and mouth;
  - the radius rules for all four reference cases;
  - the cap;
  - `clearSpots` by owner and for all;
  - `sanitizeSpot` (fuzzed);
  - `ownerAt`: the face beats the body, and the highest mask wins.
- **`panelModel.test.ts`:**
  - strip order and divider (camera: none of them);
  - 祛痘 selects without changing params;
  - the 清除 label and scope for 1 person, a group plus a person, and a group plus 全部; the 「確定清除？」 second tap within 3 s (fake clock);
  - the notes;
  - 膚色 `ends`;
  - `tabHasValue` with spots only and with a tone value only;
  - the disabled reasons, including 基本模式 and the three tracker states;
  - `lastSel` never keeps `'spot'`.
- **`zoomPan` tap mode:** the tap rule is a pure function (`tapOutcome(events)`, next to `clampView`, zoomPan.ts:15) tested for a tap, a move over 8 px, a second finger, a `pointercancel` and a double tap with fit off.
- **Edit state:** presets reset tone; ⊘ keeps spots; 重置 clears them; adding a spot and clearing are one undo step each; `rebase` keeps spots; `renamePersons` (step-1 spec §5.3) remaps each `owner` and nulls an unmatched one; the camera look (no `oSize`) keeps no spots.
- **History:** a v2 round trip with spots and tone values (fake-indexeddb); `sanitizeSpot` runs on load.

### 8.2 Engine harness (`tests/e2e/tone-engine.spec.ts`, page `tests/e2e/pages/tone.{html,ts}`, dev server)

The page follows `tests/e2e/pages/engine.ts`: it renders `sample_face_tone.png` through the real engine with the recorded landmarks of `sample_face.png` (the defects change colours only) and hands lossless PNGs from `renderToImageData` back to Node. Pixel assertions with exact positions live here, not in the app e2e, because the app's canvas is only reachable as a resampled screenshot (`grab`, fixtures.ts:91).

**Calibration and thresholds.** The gains in §4.3–4.4 are starting values. Sub-step 4c tunes them once with `toneCpu` on this fixture so that, at 100, 勻膚 removes ≥ 50 % of the blotches' Cr excess, 黑眼圈 recovers ≥ 60 % of the crescent core's darkening, 法令紋 ≥ 50 % of the fold's, 白牙 ≥ 45 % of the teeth's Cb shift and 亮眼 ≥ 45 % of the sclera's Cr shift, without breaking any "keeps" bound below. The tuned `TONE` table is what the hash pin covers. Case 1 below runs `toneCpu` in Node on the R and Q targets read back from the GPU, and also asserts these targets on its output, so a later change that weakens a tool fails. Each GPU threshold is ⅔ of its target, so GPU rounding (SwiftShader in CI, `playwright.config.ts`) cannot make the test flaky. Statistics are taken over the defect pixels that `sample_face_tone.json` lists, and "recovers" is measured against `sample_face.png`.

**Calibrated targets (as built, step 4 follow-up 2026-10-14).** Where a target cannot be met without breaking a keep, `TARGETS` (`toneStats.node.ts`) holds the best value reached, rounded down to 0.05 (§9):

| Tool | Spec target | `TARGETS` | CPU at 100 | Why |
|---|---|---|---|---|
| 勻膚 | 0.50 | 0.45 | blotch1 1.239, blotch2 0.496 | The chroma factor is capped at 1 (§4.4); no gain up to 2× gets blotch2 past 0.496, since about half of a σ 0.04 fw blotch lies in L's band |
| 黑眼圈 | 0.60 | 0.45 | 0.963 / 0.475 | One more lift step breaks the left lash-line keep (plan Task 9) |
| 法令紋 | 0.50 | 0.50 | 0.606 / 0.694 | Met since the fold reference of §4.3 and the band's full-strength inner half (§4.2), at `nasolabial.lift` ×1.5 (step 4 follow-up). Against L it was 0.002 / 0.013, since the fold path on `sample_face.png` is a cheek highlight. ×1.3 is the first 10 % step past 0.5 (0.526 / 0.604); ×1.5 also gives §8.4 case 1, which reads the union of the two fold boxes, a margin (CPU mean change there 0.514/255 at ×1.3, 0.588/255 at ×1.5) |
| 白牙 | 0.45 | 0.45 | 0.879 | Met since the tooth gate and lip guard of §4.4 (plan Task 11 decision (b)) |
| 亮眼 | 0.45 | 0.25 | 0.252 / 0.295 | The eye region's inset ramps leave the sclera near the lids at R.A < 1 (plan Task 9), and the detint cap of §4.4 |

No target is 0 any more. Were a calibration to fall back to 0, the GPU would not assert a bare ⅔·0: the recovery would have to stay within what a 0.5/255 bias in the mean is worth (foldL −0.026, foldR −0.039; `toolChecks`).

1. **GPU against CPU.**
   - P0c + P0d with every tool at 0.5 and at 1. `toneCpu` takes the R and Q targets read back from the GPU as input (rasterization is not ported; `toneGeometry.test.ts` covers the geometry) and runs D8, Mn8, L, Δ8 and the retouch with 8-bit quantization after every stage. On six 64 × 64 crops (cheek, both crescents, a band, the mouth, an eye) the GPU output equals the CPU output within max 2/255 and mean 0.25/255.
   - P0b with the fixture's three dots, plus one spot at the image border (fill mode): GPU equals `healCpu` within 2/255.
2. **Each tool changes only its region**, at 100 (膚色 at ±50):
   - 勻膚: the blotches' Cr excess drops ≥ 33 %, the cheek's high-frequency energy changes ≤ 10 %, and the three blemishes keep ≥ 80 % of their contrast (勻膚 is not 祛痘);
   - 膚色 +50: mean cheek Cb falls ≥ 0.008; −50 raises it ≥ 0.008; Y stays within 1 %;
   - 黑眼圈: the crescent core's Y recovers ≥ 40 % of the synthetic darkening, and the lash line keeps ≥ 80 % of its contrast;
   - 法令紋: the fold recovers ≥ 33 % (as built, step 4 follow-up: GPU 0.607 / 0.696);
   - 白牙: teeth Cb recovers ≥ 30 %, and lip pixels move ≤ 2/255 (as built: 0.879, 0/255), both between the outer and the inner lip line and in the ring 1–4 px outside the inner-lip line, where the lip's colour passes the tooth gate (v0.4 cleanup; the same ring is checked by `toneStats.test.ts` on `sample_face.png` itself, 0/255 while 417 tooth pixels gain ≥ 4/255 luma). With the lip guard removed (lipGuard forced to 1) the ring reads 24/255 on both images and the outer-lip check 28/255, so neither check is vacuous; both still take the lip line from landmarks 96–103, as the guard does (§9);
   - 亮眼: sclera Cr deviation drops ≥ 30 %, and iris RMS detail rises ≥ 10 %;
   - for every tool, pixels outside its region move ≤ 1/255. The region is the oval grown by 0.10 fw for 勻膚, 黑眼圈 and 法令紋, by w_T + 0.02 fw for 膚色, and the eye or mouth polygon grown by 0.06 of its width for 亮眼 and 白牙.
3. **Heal.** On dot 1, in its 1.2σ disc, the Y standard deviation drops ≥ 60 % and the mean comes within 3 % of the ring.
4. **Passes.** `passes` lists `heal`, `toneField` and `retouch` only when they are active; a frame with neutral tone and no spots lists none of them.
5. **Tiles** (step 3's harness, `tests/e2e/pages/export.{html,ts}`): with 黑眼圈, 白牙 and 亮眼 on and spots across tile borders, a forced `TILE = 256` render equals the untiled render within 1/255. The same case with a cleared field cache checks the `toneSource` rebuild.

### 8.3 Fixture

`scripts/gen-tone-fixture.mjs` (Node + `pngjs`, deterministic, no browser) reads `sample_face.png` and `landmarks_sample_face.json`. It writes `tests/fixtures/sample_face_tone.png` (1000 × 1500) and `sample_face_tone.json`, which lists every synthetic defect in O pixels:

| Defect | Where | How |
|---|---|---|
| 3 blemishes | Left cheek (midpoint of P(6) and P(82)), forehead (midpoint of ext[1] and P(35)), right cheek near the jaw (0.6 P(26) + 0.4 P(83)) | Gaussian dots σ 5 px: Y × (1 − 0.22 g), Cr + 0.03 g |
| 2 blotches (for 勻膚) | Right cheek at the midpoint of P(77) and P(26); forehead at the midpoint of ext[1] and P(40). On `sample_face.png` they lie ≥ 0.16 fw from every blemish; the image-left cheek is the narrow far side (yaw −0.15) and gets none. | Gaussian σ 0.04 fw: Cr + 0.025 g, Y × (1 − 0.03 g) |
| Dark circles | An ellipse under each eye: centre lower-mid lid + 0.22 eyeW·ŷ, semi-axes 0.45 × 0.16 eyeW, feathered | Y × 0.84, Cb + 0.015 |
| Nasolabial folds | A soft shadow along P(82 or 83) + 0.04 fw·o → P(84 or 90) + 0.06 fw·o: a Gaussian across the line, σ 0.02 fw (28 px wide at half depth, 2σ_mid), fading in and out over the first and last 15 % of its length like the band of §4.2 (step 4 follow-up; first a 6 px line, finer than σ_mid) | Y × (1 − 0.12 g) |
| Yellow teeth | Inner-lip polygon, pixels with Y > 0.15 and chroma < 0.15 (plan Task 7: the teeth of `sample_face.png` are in shadow; Y > 0.35 caught 8 lip-corner pixels) | Cb − 0.05 |
| Red sclera | Eye ring, pixels with Y > 0.5 and chroma < 0.15 | Cr + 0.03 |

- `sample_face.png` shows its teeth through an 8.7 px opening (mouthOpen 0.042), which the 白牙 gate of §4.2 passes in full, and a visible sclera, so the teeth and sclera defects have pixels to act on.
- Like `face.y4m`, the PNG and its JSON are gitignored and generated by `tests/e2e/global-setup.ts` when they are missing or older than the script.
- `LICENSES/NOTICE.txt` gains a test-data line: a generated, uncommitted modified derivative of `sample_face.png` (Apache-2.0 §4(b) change notice).
- The C fixture `group_faces.png` (C §8.3) is used for the per-person tests.

### 8.4 E2E (Playwright, Chromium, production build): `tests/e2e/tone.spec.ts`

The app's canvas is read with `grab` and compared with `mad` (fixtures.ts:91, 104), the helpers `editor.spec.ts` uses. O positions from `sample_face_tone.json` are mapped to screen positions through the frame's fitted rectangle (no zoom). Exact pixel values are the harness's job (§8.2); these tests check the flows.

1. **Each slider acts on its face area.** For each of the six sliders at 100: `mad` inside the face box > 0.5, and ≤ 0.2 in a 64 px square of background beside the head. As built (step 4 follow-up): inside 勻膚 2.26, 膚色 3.92, 黑眼圈 0.77, 法令紋 0.58, 白牙 1.88, 亮眼 1.06, all > 0.5, background 0.000. 法令紋's area is the union of the two fold boxes, mostly mouth and philtrum, so its reading follows its recovery closely (0.02 against L, 0.47 at a tent-shaped band and lift ×1.8).
2. **祛痘 removes a blemish, and undo restores it.** Tap dot 1: the screen-space Y standard deviation in its 1.2σ disc drops ≥ 50 %. ↶ restores the pre-tap screenshot (`mad` ≤ 0.2); ↷ heals again; `__meiyan.spots` reads 1. A drag of 20 px while zoomed adds no spot.
3. **Snapping.** A tap 0.5 r away from dot 2 gives `lastSpot` within 0.15 r of the true centre.
4. **Spots follow the geometry.** Set 瘦臉 100 and 大眼 100, find dot 3 on the screenshot (the darkest blob in its search window) and tap it: `lastSpot` is within 0.3 r of the dot's O position, and the blob is gone. Repeat after 裁切 › 旋轉 and 翻轉.
5. **Refusals and cap.** A tap in an eye shows 「眼睛和嘴巴不適用祛痘」 and adds no spot. With 100 spots seeded through `seedHistory` (C §8.4, a v2 record), the next tap shows 「祛痘點已達上限」.
6. **Persistence.** Reopen from Home: `spots` and the tone values are intact, the screenshot matches (`mad` ≤ 0.2), and `detectCalls` is 0.
7. **Cache.** With 勻膚 50, dragging 瘦臉 leaves `toneBuilds` unchanged; dragging 勻膚 increases it.
8. **Per person** (`group_faces.png`):
   - person 2 selected, 黑眼圈 100: `mad` > 0.3 inside face 2's box and ≤ 0.1 inside the boxes of faces 1 and 3; under 全部, all three boxes change;
   - a tap on face 1 while person 2 is selected gives `owner` f0; 清除此人（0） under person 2 is disabled; under 全部, 「全部清除（1）」 then 「確定清除？」 removes the spot, and a single tap left for 3 s removes nothing.
9. **No face.** A 600 × 800 PNG made in the test with `pngjs` (skin-tone noise and one dark dot) is imported through the file input: the six sliders are disabled with 「未偵測到臉部，膚質工具不會套用」, and a tap on the dot heals it.
10. **Parity.** `parity.spec.ts` (C) stays green: neutral tone and no spots are bit-identical.

---

## 9. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Landmark regions miss on unusual faces (strong yaw, occlusion, glasses) | A crescent or band on the wrong skin | The far-side fade; self-limiting operations (only darker-than-reference is lifted; teeth and sclera gated by colour); the guards |
| Over-flat, plastic skin at 100 | The 「假」 look 醒圖 is criticized for (XPR:118, 139) | High frequencies are never touched; no mid-band or retouch factor passes 1, alone or where 勻膚 and 黑眼圈 overlap (they combine as one after the other, §4.3–4.4), and 法令紋 over them takes the larger lift, not the sum. The one gain above 1 that applies is 法令紋's 1.20 on its own valley depth (§4.3), calibrated to recover 0.606 / 0.694 of the fixture's folds, so it does not lift a fold past its sides there; 50 is the natural point |
| Teeth in shadow (common: the lips shade them) | 白牙 does nothing on real photos | The tooth gate passes Y ≥ 0.12 (first 0.28, which passed none of `sample_face.png`'s teeth); the full-resolution lip guard of §4.4 keeps the lips at 0/255 though they look like shadowed teeth. Cost: a strip of real teeth that the landmarks leave outside the inner-lip line stays as it was. Open: the guard and its checks trust landmarks 96–103, so landmark error lands on the lip; the step 4 follow-up review measured, on `sample_face.png` with the inner-lip points moved, up to 28/255 on the lip for 2 px and 29/255 for 4 px (a grey sliver on the upper lip), 10/255 for the polygon grown 2 px. Decided in plan Task 11 (b) (the user delegated the choice) |
| A nasolabial fold that is not darker than the low-pass reference (a faint crease on a lit cheek) | Against L, 法令紋 did nothing there: on the fixture it recovered 0.002 / 0.013 against the 0.5 target | Decided (step 4 follow-up): 法令紋 lifts the valley depth across its band, from 8 × 8 boxes of base0 at ±2 σ_mid (§4.3), over a band at full strength across its inner half (§4.2). Fixture 0.606 / 0.694 (CPU), 0.607 / 0.696 (GPU). Left: a fold on a steeper ridge recovers less (a synthetic fold on a ridge of amplitude 0.20 reads 0.45, of 0.15 0.54); a dark spot inside the band (a mole, a freckle) is lifted too, as a valley in every direction (on `sample_face.png` at 100 the fold path moves by a mean 0.83/255; the largest change, 13/255, is a darker patch beside the image-left nose wing where the band starts, 154 pixels move ≥ 8/255) |
| One σ_low per photo with faces of very different sizes | Weaker 黑眼圈 or 法令紋 on the smallest edited face | Chosen on the largest edited face; acceptable for v0.4 (§10) |
| Heal looks flat in fill mode or on strong texture (hairline, brow edge) | A visible patch | Donor search penalizes texture mismatch; fill mode only at borders; refused in eyes and mouth |
| The ping-pong refactor of A and B breaks makeup or capture | Wrong output buffer | Parity goldens; every existing engine e2e; `passes` assertions |
| With a crop or rotation, the buffer P2 writes is re-sized twice per frame (§4.1) | Jank or memory churn on iPhone while 祛痘 or 膚質 is on | The tone + crop bench row; the `H` fallback (§6) |
| The tone gains do not reach the calibration targets on the fixture without breaking a "keeps" bound | Weak 黑眼圈 or 勻膚 at 100 | 4c tunes the `TONE` table with `toneCpu` before any GPU work; the harness thresholds follow the tuned values (§8.2; as built 勻膚 0.45, 黑眼圈 0.45, 法令紋 0.50, 白牙 0.45, 亮眼 0.25) |
| The CPU back-map drifts from the GPU P2 | Spots land off the finger after warps | Pinned by C §8.2 (≤ 0.05 px); app e2e case 4 (§8.4) |
| Contract amendments A1–A6 drift from C again | Two specs disagree | Folded into C on 2026-10-12 (§0.2); the step-4 plan re-checks C before code |
| iPhone cost of 100 spots | Slow drags | Budget row, then the fallback (§6) |

---

## 10. Out of scope for v0.4

- Automatic blemish detection (一鍵祛痘、智能祛斑); tap only (§11 Q5).
- 祛油光, 皮膚肌理／質感, 焕肤 (水光肌), 去皺 beyond 法令紋 (頸紋, 眼紋), 遮瑕筆 (painting), 整牙.
- 醒圖's three 勻膚 textures (少女／磨砂／嬰兒) (§11 Q4).
- 膚色 on arms, legs and other body skin (§11 Q3).
- Spot markers, tapping a spot to delete it, per-spot strength, drag-to-paint healing.
- Different σ_low per face.
- Tone tools and 祛痘 in the live camera (C §11 Q3).
- 祛痘 inside the eyes or the open mouth.

---

## 11. Open questions for the user

Each has a default that this spec uses if the user does not answer.

1. **祛痘 per person or per photo?** The step brief says "per person"; the contract's default (C §11 Q1) is one list per photo. This spec keeps one list per photo, and each spot remembers whose face it is on, so 「清除此人」 clears only the selected person's spots while 全部 clears all. The alternative is strict per-person spots: taps are only accepted on the selected person's face or body, and arms or background cannot be fixed. *Default: one list per photo, tagged by person.*
2. **祛痘 and 膚質 before 美型／美妝 (contract change A1–A2)?** The tools work on the original photo before reshaping and makeup. Visible result: blush, lipstick and 紅潤 are never washed out by 勻膚 or tinted by 膚色, and every correction follows the face when 瘦臉 or 大眼 moves it. The alternative, the contract's original order, applies them last, over the makeup. *Default: before 美型／美妝.*
3. **How far does 膚色 reach?** Face plus upper neck with a soft fade (no extra detection), or all visible skin including arms, which needs the 美體 person detection to have run (it loads the pose model, about a second) and its person mask. *Default: face + upper neck.*
4. **勻膚 styles?** One 勻膚 slider, or also 醒圖's three styles 少女／磨砂／嬰兒 (a finish choice on top of the slider) in a later version? *Default: one slider in v0.4.*
5. **一鍵祛痘?** An automatic "find and remove all blemishes" button on top of tap 祛痘. It is harder (it must tell blemishes from moles and freckles) and is not in v0.4. *Default: not in v0.4; tap 祛痘 only.*
