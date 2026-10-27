# Mona Misa 美顏 v0.4 step 5: 臉型細項 and 美妝擴充

- **Date:** 2026-10-12
- **Status:** proposal for the user's review. The user picked this scope. The design itself has not been discussed with the user yet. Real choices are collected in §11. Each has a default, and the build uses the default if the user does not answer.
- **Base:** `feat/meiyan-pwa` at `892ea61` (v0.3.0). It assumes steps 1 to 4 have landed as the [v0.4 roadmap](2026-10-12-v04-roadmap.md) (**RM**) describes them.
- **Builds on:** RM §1.2 step 5, §2.1, §3.1–3.4, §4.2–4.4 and §8; the [選臉／選人 spec](2026-10-12-face-person-select-design.md), written in parallel: its face-table layout (§4.4 there) is the base of §4.4 here; the [skin-cleanup spec](2026-10-12-skin-cleanup-tools-design.md), whose tone passes run before P1 (§4.11); the [v1 design spec](2026-10-07-meiyan-pwa-design.md) (**DS**); the [research brief](2026-10-07-meiyan-research-brief.md) (**RB**) §2.4, §2.5 and §2.7; `reports/醒圖 功能差距分析.md` (**GAP**) and `research_notes/醒圖 功能差距分析/xingtu_portrait.md` (**XP**).
- **Role:** this is the step-5 sub-spec RM §1.2 asks for. It adds detail to RM. §1.3 lists the places where it refines an RM sentence. The 2026-10-12 consistency pass already wrote them into RM (§2.1, §3.8, §4.4, §4.7), so RM and this spec agree; the user can still reverse them (§11 Q7, RM §12).

## 摘要（繁體中文）

美型新增 6 項：下頜線、太陽穴、髮際線、鼻翼、山根、嘴高。另有「左右分開」開關，開啟後瘦臉、V臉、窄臉、下頜線、太陽穴、大眼可以左右臉分別調整；「左」「右」以螢幕上看到的方向為準。
美妝從 2 個部位擴充到 10 個：口紅、腮紅、眉毛、眼影、眼線、睫毛、臥蠶、修容、高光、美瞳。新妝容全部用程式在臉部特徵點上算出來，不使用任何第三方圖片素材。
美妝分頁改成兩層：先選部位，再選顏色，所以面板高度不變，畫面不會跳動。美型共 17 個項目（第 6 步加上推臉筆後是 18 個），依原本順序用分隔線分組。
眼影、眼線、睫毛、臥蠶沿著偵測到的眼皮輪廓畫上去。閉眼時，美瞳和睫毛會自動淡出；眼影、眼線、臥蠶畫在眼皮上，閉眼時照樣顯示。美瞳只畫在上下眼皮之間，不會畫到眼皮上。修容和高光遇到頭髮、眼鏡等非皮膚的地方會自動變淡。
每位人物的設定各自獨立，照片編輯和即時相機都能使用，也可以復原、會隨「最近編輯」一起存檔。

---

## 1. Goal and user-visible behaviour

### 1.1 What step 5 adds

| Area | New items | What the user sees |
|---|---|---|
| 美型 | 下頜線 (0–100) | A crisper, lifted jaw line from the jaw angle to the chin. It does not remove a double chin (that would need inpainting, §10). |
| | 太陽穴 (±) | + fills hollow temples outward; − slims the upper face sides. |
| | 髮際線 (±) | + lowers the hairline (fuller hairline, smaller forehead); − raises it. The brows do not move. |
| | 鼻翼 (±) | − narrows the nose wings toward the nose; + widens them. |
| | 山根 (±) | + narrows the nasal root between the eyes, so the bridge looks higher; − widens it. The eyes, including the inner corners, do not move. |
| | 嘴高 (±) | + moves the whole mouth up (shorter philtrum); − moves it down. The mouth keeps its shape and the nose base stays. |
| | 左右分開 (switch) | When on, 大眼, 瘦臉, V臉, 窄臉, 下頜線 and 太陽穴 get separate 左 and 右 values. |
| 美妝 | 眉毛 | Fills and darkens the brows with a soft head and a tapered tail, with a fine hair-stroke texture. Shades or 原色. |
| | 眼影 | A wash on the upper lid that is strongest at the lash line and outer corner, plus a light accent on the lower outer lid. Shades or 原色. |
| | 眼線 | A line on the upper lash line that thickens toward the outer corner, with a short wing. Shades. |
| | 睫毛 | Upper lashes drawn from a texture generated from math. One look (自然). |
| | 臥蠶 | A soft highlight band under the lower lash line, plus a faint shadow at its lower edge. One look (自然). |
| | 修容 | Shading inside the jaw contour, under the cheekbones and along the nose sides. One look (自然). |
| | 高光 | Highlights on the nose bridge, the cheekbones, the forehead centre and the chin. One look (自然). |
| | 美瞳 | Tinted lenses with a darker limbal ring, clipped by the eyelids, with the catchlight kept. Shades or 原色 (ring only). |

This matches the GAP P1 rows 臉型細項 and 美妝擴充. 醒圖 has had these since 2021 (XP §面部重塑, §美妝: 鼻翼／山根, 嘴巴高度, 太陽穴, 髮際線, 下頜線, 單邊調整; 眉毛, 眼影, 眼線, 睫毛, 臥蠶, 修容, 高光, 美瞳).

### 1.2 Behaviour rules

- **Per person.** Every new item is a person-level `ParamId` (RM §3.1), so it follows the 選臉 selection, 全部, undo, presets and persistence rules without special cases. With ≥ 2 persons and a person selected, an item changes only that person. Under 全部, a slider drag writes that item's value to every person with a face. A shade tap or the 左右分開 switch also applies to every person (RM §2.2).
- **Editor and camera.** Every new item is `live: true`. The camera uses the same strips with one look for every face (RM §2.4).
- **Undo.** One slider drag, one shade tap, one part reset and one 左右分開 toggle are each one undo step. Panel navigation (part list ↔ shades, the 左／右 chip) is view state and is never an undo step.
- **Presets.** Per RM §11 Q7 (default), applying 原圖, 自然, 精緻 or 氣色 sets every new item to neutral, sets the new shades to null and sets `right = null`. 程度 does not touch them, because they are neutral in every preset. Every edit of a new item, a new shade, a side value or the 左右分開 switch is a person-level face edit, so it sets that person's `preset = 'custom'` (RM §3.4). Turning 左右分開 on changes no pixel, but the 一鍵 tab then shows 自訂, because a preset always has `right = null`.
- **Invariant.** With every new item neutral and 左右分開 off, the output of a one-face photo equals the step-4 output exactly. This is not just within 1/255: every new shader branch is skipped (§4.3, §4.6). The RM §8.4 parity goldens therefore keep passing. In a group photo the same holds: the influence cap does not depend on the warps, and where a new warp's `U_MAX` box would reach outside the v0.3 box, only the protect window of a face with a contour edit grows (§4.4; not the case on the fixture faces).

### 1.3 Refinements of RM (to confirm with the user, §11)

1. **Blink gate scope.** RM §4.4 says that "eye items" fade with an EAR gate (EAR < 0.15 → 0). Here the gate applies to **美瞳** (exactly RM's threshold) and **睫毛** (a lower threshold, §4.9). 眼影, 眼線 and 臥蠶 sit on the lid and are drawn on closed eyes too. Make-up on a closed eye is a common photo and should not vanish.
2. **Blend modes.** RM says "multiply or soft-light". Soft-light needs the destination colour, and with several items stacked on one face that means a framebuffer feedback loop. Highlights therefore use **screen** blending, the closest fixed-function mode (§4.6).
3. **Two new warp primitives.** RM §4.4 says "reuse today's primitives", but two items cannot be built from them without bending or folding (§4.2):
   - `shiftEllipse` for 嘴高 and 髮際線. The disc profile of `shiftAround` bends a wide feature: the mouth corners would move only 42 % as far as its centre.
   - `squeezeAxis` for 山根. RM's "shift the upper bridge contour" needs a disc that ends at the inner eye corner, but on real faces the bridge side (p78, MediaPipe 245) sits only 0.04 face widths from the inner corner. On the fixture face a shift of the intended size folds the skin there (min det J 0.26). `squeezeAxis` compresses the whole band between the two inner eye corners instead, so it cannot fold (det J ≥ 0.70) and never moves an eye.
   The other four warps reuse `curveWarp` and `shiftAround`.
4. **鼻翼** is a pair of opposed `shiftAround`s at the alar points, the same construction as 眼距. A `scaleAround` *centred on* each alar point, as RM's wording suggests, would shrink each wing in place instead of narrowing the nose.
5. **Split sides by landmark half.** RM says left values apply "for points with x below the face midline, smoothstepped over ±0.05 IOD". Every split anchor belongs to a fixed half of the GPUPixel layout, so the side is a constant per anchor (§4.3). The midline point p16 lies exactly on the midline, so it gets the 0.5 that RM's smoothstep gives there. The result is identical, costs nothing at run time, and stays correct for rotated and mirrored faces.
6. **美妝 navigation** is a two-level strip: a part list, then the shades of one part (§2.3). RM says "the part row scrolls". Here the part list scrolls, but it is not on screen at the same time as the shades.
7. **眼線 has no 原色.** `shades.liner = null` reads as the first shade, 黑.
8. **`Face.lids`.** RM lists `Face.iris` as the only new `Face` field and says the meshes live in "landmark space (pts111, ext, iris)". The eye items also need MediaPipe's dense eyelid contour (16 points per eye, `Face.lids`, §3.3). The 5 GPUPixel lid points per lid are too sparse: a least-squares lid curve through them misses the real lid by up to 0.045 eye widths on the fixture face. That equals the full width of the eyeliner, so the liner would float above the lash line or cut into the eye. `lids` comes from the cached raw landmarks, like `iris`, so no re-detection is needed.
9. **Lashes texture 512 × 128 R8**, not RM §4.7's 256 × 64 RGBA8. Both take 64 KB before mips. The larger single-channel texture keeps the lashes sharp at the 4096 export of a close-up selfie, where the 256-texel texture would be magnified about 2.3× (§4.10).

RM §4.4 states that "each sub-spec owns the exact math", so items 1–5 stay within the contract. The RM sentences that named the old math (§4.4: the blink-gate sentence, "multiply or soft-light", the warp list, "landmark space (pts111, ext, iris)", the split midline), the 美妝 row of §2.1, the `Face` row of §3.8 and the lashes row of §4.7 were updated in the 2026-10-12 consistency pass.

---

## 2. UI

### 2.1 美型 strip

The order is RM §2.1's. Thin `.strip-divider`s (`theme.css:319-325`) separate the groups that are contiguous in that order:

```
⊘原圖 · 大眼 │ 瘦臉 · V臉 · 窄臉 · 下頜線 · 太陽穴 · 下巴 · 額頭 · 髮際線 │ 瘦鼻 · 鼻翼 · 山根 │ 嘴型 · 嘴高 │ 眼距 │ 左右分開 · 推臉筆
```

- That is 17 items, 18 with 推臉筆 from step 6, at 64 px each (`.item` 58 px plus a 6 px gap, `theme.css:327-336`). About 5.4 items are visible at 375 pt, so the strip scrolls as today. The selected item scrolls into view when the tab opens (`BeautyPanel.tsx:50-60`).
- The dividers use the field that step 2 adds for the 調節 strip, `PanelItem.divider: 'before'` (adjust spec §3, `itemsFor` `'adjust'`). Step 5 adds no new field for them.
- **左右分開** is a `switchable` item with a `pressed` state, like 背景保護 (`panelModel.ts:283-292`, `theme.css:497-530`). Its icon is `split`. Tapping it never changes the selected slider item.
- While 左右分開 is on, each split-capable item (大眼, 瘦臉, V臉, 窄臉, 下頜線, 太陽穴) shows the small corner badge 「左右」, drawn by the same item-badge mechanism that step 1 uses for 「整張」 (`PanelItem.badge?: string`; if step 1 names it differently, this spec uses step 1's field).
- **Under 全部,** the switch shows as on when the lens's reference person (the primary person, RM §3.3) has `right ≠ null`. A tap sets every face person to the opposite of that state.
- **⊘ 原圖** resets all 15 shape values of the target person or persons to neutral and sets `right = null`. This is one undo step.
- Has-value dots: an item has a value when its left or its right value differs from neutral (`hasValue`, `params.ts:254-256`, applied per side). The tab dot covers `right` too.

### 2.2 左右分開 interaction

- **On:** `right` becomes a copy of the current values of the six split items, so nothing moves at first. The side chip is set to 左. The toast reads 「已開啟左右分開：左、右以螢幕上看到的方向為準」.
- **Off:** both sides take the value the slider was showing (the active side), and `right = null`. The toast reads 「已關閉左右分開：左右臉改回相同」.
- **Slider row.** While it is on and a split item is selected, a segmented control 「左｜右」 replaces the slider label (`Slider.tsx:145-146`). It has two 44 × 32 pt segments, `role="radiogroup"`, and the selected one in accent. The slider track loses about 48 px at 375 pt and keeps about 195 px. The slider's `aria-label` becomes 「{label}（左）」 or 「{label}（右）」, so the item name is still announced. The slider edits the chosen side; the value text shows that side. A small caption under the slider, in `--text-2`, shows the other side's value: 「右 +12」 or 「左 30」. A double tap resets only the chosen side.
- **A non-split item while 左右分開 is on** shows the normal single slider. The first time this happens in a session, the toast reads 「{label}左右一起調整」.
- **Which side is 左.** Per RM §11 Q6 (default), 左 is the side seen on the left of the screen. It is decided per face from where the two eyes appear on screen: the side whose eye centre (p74 or p77) has the smaller screen x. The editor maps O → V through `src/geometry/view.ts` (RM §3.5), so 翻轉 and 旋轉 are handled. The camera adds the preview mirror (`facing === 'user'`, `live.ts:124`). The stored values never change when the view flips; only the labels move. §3.4 gives the storage rule.
- **Under 全部,** the chip edits the screen-left (or screen-right) side of every face, each face mapped on its own.

### 2.3 美妝 tab: two-level strip

The panel height stays the same in every tab, so the canvas never jumps (RM §2.2 sets the same rule for the person strip). Ten parts and up to nine swatches do not fit in one row, so the strip has two levels inside its existing 92 px.

**Level 2 (shades of one part)** is the default view and today's look:

```
[口紅 ‹]  │  無 · 原色 · 珊瑚 · 豆沙 · 玫瑰 · 正紅 · 蜜橘
```

- The leading tile is the active part. It is a `.part` tile (`theme.css:398-405`) with the part icon, the part name as its label, and a small `‹` at its top left. Its `aria-label` is 「切換部位（目前：口紅）」. Tapping it opens level 1.
- Until the part list has been opened once on this device, the leading tile carries a 6 px accent dot. The flag is kept under `localStorage` key `meiyan.seen.makeupParts.v1` (a new key; no existing key is renamed). No toast is shown.
- The items are produced by `itemsFor` as today: 無 · (原色) · shades (`panelModel.ts:354-383`). The existing unit test (`panelModel.test.ts:70-73`) and the camera e2e (`camera.spec.ts:33`, 原色 visible on 美妝) keep their assertions.
- The strip key (`BeautyPanel.tsx:47`) becomes `makeup.${makeupView}.${makeupPart}`, so switching level or part scrolls the strip back to its start, as switching tabs does.

**Level 1 (part list):**

```
卸妝  │  口紅 · 腮紅 · 眉毛 · 眼影 · 眼線 · 睫毛 · 臥蠶 · 修容 · 高光 · 美瞳
```

- Each part tile shows its icon, a has-value dot, and, when the part is on with a shade, a 10 px swatch of that shade at the tile's lower right. The active part is outlined. Tapping a part makes it active and opens level 2 for it.
- **卸妝** (icon `makeupOff`) resets every makeup part of the target persons: values to 0, shades to null. It is one undo step with no confirmation, since ↶ undoes it. When nothing is on, it is a no-op.
- The slider always shows the active part's intensity, on both levels. As today, it is never unmounted mid-drag (`panelModel.ts:531-542`).

**Items per part** (`無` selects "off", exactly one item is selected in every state, as today):

| Part | Items after 無 | Blend (§4.6) |
|---|---|---|
| 口紅 | 原色 · 珊瑚 · 豆沙 · 玫瑰 · 正紅 · 蜜橘 (unchanged) | GPUPixel mesh |
| 腮紅 | 原色 · 蜜桃 · 粉紅 · 杏橘 · 玫瑰 (unchanged) | GPUPixel mesh |
| 眉毛 | 原色 · 自然黑 · 深棕 · 灰棕 · 摩卡 · 栗棕 | multiply |
| 眼影 | 原色 · 大地 · 蜜桃 · 玫瑰 · 珊瑚 · 奶茶 · 紫霧 | multiply |
| 眼線 | 黑 · 深棕 · 棕 · 酒紅 · 藏青 | over |
| 睫毛 | 自然 | over (texture) |
| 臥蠶 | 自然 | screen + multiply |
| 修容 | 自然 | multiply |
| 高光 | 自然 | screen |
| 美瞳 | 原色 · 自然黑 · 巧克力 · 琥珀 · 霧灰 · 冰藍 · 薄荷綠 | over (reads the source) |

- **原色** on the new parts means "intensify the person's own colour". 眉毛 deepens the brows in their own hue. 眼影 adds a neutral, skin-toned depth. 美瞳 darkens only the limbal ring and leaves the iris colour.
- **自然** on the four parts without shades is the single "on" state. Its tile shows the part icon.
- Picking a shade or 自然 while the part's intensity is 0 sets the pick default (`MAKEUP_PICK_DEFAULT`, `params.ts:80`, extended in §3.1).
- **眼線's effective shade** is `shades.liner ?? 'black'`. The strip selects 黑 when the liner is on and the effective shade is `black`, and the "same item tapped again" no-op (`panelModel.ts:449-453`) compares effective shades. So raising the slider from 0 (which leaves the shade null) shows 黑 selected, and tapping 黑 then is not an undo step.

### 2.4 Strip notes (the `faceNote` pattern, `Editor.tsx:789-797`, `BeautyPanel.tsx:86-91`)

| When | Where | Copy |
|---|---|---|
| The selected person's eyes are closed (gate < 0.5 for both eyes, §4.9); editor only, not under 全部 | 美妝 level 2, parts 美瞳 and 睫毛 | 「眼睛閉合時不套用美瞳與睫毛」 |
| The selected person's face is below the 睫毛 size gate (§4.9) | 美妝 level 2, part 睫毛 | 「臉部太小，睫毛不會套用」 |
| The procedural makeup program failed to compile on this device (§7) | 美妝 level 2, the eight new parts | 「此裝置無法使用這個妝容」 |

A note never blocks the slider. The value is stored and takes effect when the condition goes away (in the camera, when the eyes open).

### 2.5 Camera

The camera uses the same strips (RM §2.4): 美型 without 推臉筆, and 美妝 with all ten parts. The side chips appear in the floating slider row (`SliderRow float`). Taps on the side chips must not toggle panel collapse: `Camera.tsx:261` already ignores taps inside `.slider-row`. The camera shows no strip notes for closed eyes, because they change every frame.

### 2.6 New strings

| Key | 繁體中文 |
|---|---|
| shape labels | 下頜線 · 太陽穴 · 髮際線 · 鼻翼 · 山根 · 嘴高 |
| split item / badge / chips | 左右分開 / 左右 / 左 · 右 |
| split on / off toasts | 已開啟左右分開：左、右以螢幕上看到的方向為準 / 已關閉左右分開：左右臉改回相同 |
| non-split item while split | {label}左右一起調整 |
| other-side caption | 左 {n} / 右 {n} |
| part labels | 口紅 · 腮紅 · 眉毛 · 眼影 · 眼線 · 睫毛 · 臥蠶 · 修容 · 高光 · 美瞳 |
| part list reset / part tile aria | 卸妝 / 切換部位（目前：{part}） |
| no-shade item | 自然 |
| shades | §3.2 |
| notes | 眼睛閉合時不套用美瞳與睫毛 · 臉部太小，睫毛不會套用 · 此裝置無法使用這個妝容 |

---

## 3. Architecture and data model

### 3.1 Parameter definitions (`src/engine/params.ts:4-37`, `src/types.ts:8-34`)

New `ParamId`s, in the `PARAM_DEFS` positions that produce the RM §2.1 strip order. `paramsInGroup` keeps definition order (`params.ts:47-49`).

| id | Label | Bi | Split | Live | Default | Icon | Inserted after |
|---|---|---|---|---|---|---|---|
| `shape.jawline` | 下頜線 | no | ✓ | ✓ | 0 | `jawline` | `shape.faceNarrow` |
| `shape.temple` | 太陽穴 | ✓ | ✓ | ✓ | 0.5 | `temple` | `shape.jawline` |
| `shape.hairline` | 髮際線 | ✓ | | ✓ | 0.5 | `hairline` | `shape.forehead` |
| `shape.noseWing` | 鼻翼 | ✓ | | ✓ | 0.5 | `noseWing` | `shape.noseSlim` |
| `shape.noseBridge` | 山根 | ✓ | | ✓ | 0.5 | `noseBridge` | `shape.noseWing` |
| `shape.mouthHeight` | 嘴高 | ✓ | | ✓ | 0.5 | `mouthHeight` | `shape.mouthSize` |
| `makeup.brow` | 眉毛 | no | | ✓ | 0 | `brow` | `makeup.blush` |
| `makeup.eyeshadow` | 眼影 | no | | ✓ | 0 | `eyeshadow` | |
| `makeup.liner` | 眼線 | no | | ✓ | 0 | `liner` | |
| `makeup.lashes` | 睫毛 | no | | ✓ | 0 | `lashes` | |
| `makeup.aegyo` | 臥蠶 | no | | ✓ | 0 | `aegyo` | |
| `makeup.contour` | 修容 | no | | ✓ | 0 | `contour` | |
| `makeup.highlight` | 高光 | no | | ✓ | 0 | `highlight` | |
| `makeup.lens` | 美瞳 | no | | ✓ | 0 | `lens` | |

- All 14 have `scope: 'person'`. Step 1 adds only `scope` and `live` to `ParamDef` (select spec §3.2), so step 5 adds `ParamDef.split?: true`, the `SplitParamId` type (RM §3.2) and `PersonParams.right`, and sets `split: true` on all six: `eyeEnlarge`, `faceSlim`, `faceV`, `faceNarrow`, `jawline`, `temple`.
- Every default is neutral, so first launch and every preset are unchanged.
- `MakeupPart` moves from `panelModel.ts:23` to `src/types.ts` (next to `ShadePart`), because `params.ts` is engine code and must not import from `src/ui`. `panelModel.ts` re-exports it.
- `MAKEUP_PICK_DEFAULT` (`params.ts:80`) becomes `Record<MakeupPart, number>`: lip 0.5, blush 0.4 (unchanged), brow 0.45, eyeshadow 0.45, liner 0.6, lashes 0.55, aegyo 0.5, contour 0.4, highlight 0.4, lens 0.6.
- **Schema tests** (`params.test.ts:44-104`) are ported in the same commit: the count, the bidirectional list (+ temple, hairline, noseWing, noseBridge, mouthHeight), the defaults table (+14 rows) and `paramsInGroup('makeup')` / `('shape')` order. Each assertion stays; only the expected tables grow. This is the mechanical port that RM §1.1 allows.
- The new icons are original 24 × 24 line icons in `src/ui/icons.tsx` (keys above, plus `split` and `makeupOff`), drawn in the existing style (1.75 px stroke, `icons.tsx:1`). A `parts` icon was drawn for the 美妝 lead tile, but the tile shows the selected part's own icon (`makeupLeadItem`), so it was removed unused (v0.4 cleanup).

### 3.2 Shades (`params.ts:63-77`, extended)

`ShadeDef` (`types.ts:69-74`) is unchanged. `SHADES: Record<ShadePart, readonly ShadeDef[]>` replaces the two exported arrays. `LIP_SHADES` and `BLUSH_SHADES` stay exported as aliases. `shadeColor(part, shade)` (`params.ts:273-276`) takes any `ShadePart`. All colours are original to this project (NOTICE, §5.4).

| Part | id: label `#hex` |
|---|---|
| brow | `black`: 自然黑 `#2E2824` · `darkBrown`: 深棕 `#4B3628` · `greyBrown`: 灰棕 `#6A5C55` · `mocha`: 摩卡 `#7B5B45` · `chestnut`: 栗棕 `#8A5636` |
| eyeshadow | `earth`: 大地 `#A27A63` · `peach`: 蜜桃 `#EFA07F` · `rose`: 玫瑰 `#C76F7F` · `coral`: 珊瑚 `#E5806B` · `milktea`: 奶茶 `#B99686` · `mauve`: 紫霧 `#9A7FA6` |
| liner | `black`: 黑 `#151313` · `darkBrown`: 深棕 `#3A2A22` · `brown`: 棕 `#6A4A37` · `wine`: 酒紅 `#6B2B34` · `navy`: 藏青 `#25304E` |
| lens | `black`: 自然黑 `#231E1C` · `choco`: 巧克力 `#5B3B29` · `amber`: 琥珀 `#A9712F` · `grey`: 霧灰 `#7E8891` · `blue`: 冰藍 `#6E9AC6` · `green`: 薄荷綠 `#7EA788` |

What `null` means, per part (`ORIG_PARTS = ['lip', 'blush', 'brow', 'eyeshadow', 'lens']`):

| Part | `null` means |
|---|---|
| lip, blush | 原色 = the GPUPixel texture colour (unchanged) |
| brow | 原色: multiply by grey 0.60 |
| eyeshadow | 原色: multiply by `#CCBDB6` (a neutral, skin-toned shadow) |
| lens | 原色: limbal-ring darkening only |
| liner | `SHADES.liner[0]` (黑). The UI never offers 原色 for the liner. |

Fixed colours of the parts without shades:
- 睫毛 `#141212`
- 臥蠶 light `#FFF1E8`, shadow `#B79F95`
- 修容 `#A8897A`
- 高光 `#FFF3E3`

### 3.3 Types

```ts
// src/types.ts:117-130 — RM §3.8 step 5 (+ lids, §1.3 item 8)
export interface Face {
  pts111: Float32Array; ext: Float32Array; oval: Float32Array; yaw: number;
  /** MediaPipe 468–477 (x, y) pairs: [0..9] = 468 centre + 469–472 (GPUPixel-left eye), [10..19] = 473 + 474–477 */
  iris: Float32Array; // length 20
  /**
   * MediaPipe eye contours (x, y), 16 points per eye: outer corner, 7 upper (outer → inner), inner corner,
   * 7 lower (outer → inner). [0..31] GPUPixel-left eye = MP 33, 246, 161, 160, 159, 158, 157, 173, 133,
   * 7, 163, 144, 145, 153, 154, 155; [32..63] GPUPixel-right eye = MP 263, 466, 388, 387, 386, 385, 384, 398, 362,
   * 249, 390, 373, 374, 380, 381, 382 (FaceLandmarker's RIGHT_EYE / LEFT_EYE contours).
   */
  lids: Float32Array; // length 64
}

// src/types.ts (moved from panelModel.ts:23, which re-exports it)
export type MakeupPart = ShadePart | 'lashes' | 'aegyo' | 'contour' | 'highlight';

// src/ui/panelModel.ts:22-55
export const MAKEUP_PARTS: readonly { id: MakeupPart; label: string; param: ParamId; shades: boolean; orig: boolean }[];
export interface PanelSelection {
  /* fields after steps 1–4, unchanged here: tab, skin (SkinSel, step 4), shape, body, adjust and presetPart (step 2), crop (step 3) */
  makeupPart: MakeupPart;
  /** 美妝 strip level; INITIAL 'shades' */
  makeupView: 'parts' | 'shades';
  /** 左右分開 slider side, as seen on screen; INITIAL 'L'; set to 'L' whenever 左右分開 turns on */
  side: 'L' | 'R';
}
export type ItemAction = /* existing */
  | { type: 'part'; part: MakeupPart } | { type: 'parts' } | { type: 'makeupReset' } | { type: 'split' }
  | { type: 'makeupOn'; part: MakeupPart }; // 自然 on the four parts without shades
// PanelItem: no new field. Dividers use step 2's `divider: 'before'`, badges use step 1's badge field (§2.1).
export interface SliderBinding {
  /* step-1 shape */
  /** present for a split item while 左右分開 is on */
  sides?: { active: 'L' | 'R'; other: number; select(side: 'L' | 'R'): PanelSelection };
}

// src/engine/passes/eyeFrame.ts (new, pure)
export const LID_STATIONS = 17; // x_k = k/16
export interface EyeFrame {
  /** outer corner, UV */ o: [number, number];
  /** iso unit axes: x outer → inner corner, y toward the chin (orthogonalized) */ ex: [number, number]; ey: [number, number];
  /** eye width (corner to corner), iso */ w: number;
  /** lid y in eye units (x: 0 outer … 1 inner; y toward the chin) at x_k, piecewise-linear through Face.lids */
  upper: Float32Array; lower: Float32Array; // length LID_STATIONS each
  /** distance (eye units) from each upper station to the brow-lower polyline pts111 64–67 / 71–68 */
  browGap: Float32Array; // length LID_STATIONS
  /** |iso(p72) − iso(p73)| / w (left), |iso(p75) − iso(p76)| / w (right) */ ear: number;
  /** iso centre and radius; null → fallback (§4.7) */ iris: { c: [number, number]; r: number } | null;
}
export function eyeFrames(face: Face, aspect: number): readonly [EyeFrame, EyeFrame]; // [GPUPixel-left, GPUPixel-right]

// src/engine/passes/makeupProc.ts (new)
export type MakeupLayer = 'contour' | 'highlight' | 'brow' | 'shadow' | 'aegyoLight' | 'aegyoShade' | 'lens' | 'liner' | 'lashes';
export const LAYER_ORDER: readonly MakeupLayer[]; // the order above (§4.6)
/** 11 floats per vertex (§4.6); each layer is one TRIANGLE_STRIP over every face, pieces joined by degenerate vertices */
export interface MakeupGeometry { data: Float32Array; ranges: Record<MakeupLayer, [first: number, count: number]> }
export const MAX_PMAKEUP_VERTS_PER_FACE = 768;
export function buildMakeupGeometry(faces: readonly RenderFace[], aspect: number, out?: Float32Array): MakeupGeometry;

// src/engine/passes/makeupProcCpu.ts (new, test-only; §8.2)
/** CPU form of PMAKEUP_FS's 修容／高光 occlusion gate (§4.9), sRGB-encoded 0..1 */
export function skinGate(r: number, g: number, b: number): number;

// src/ui/state.ts:17-25 (if step 1 has not added it already)
export interface Shot { /* … */ mirrored: boolean } // Camera.tsx:205 already computes it
```

### 3.4 Sides: storage and labels

- **Storage is landmark-sided.** `PersonParams.values[id]` drives the **GPUPixel-left** half of a split item: indices 0–15, 52–57, 72–74. That is MediaPipe's `RIGHT_*`, the subject's right as it appears in the image the face was detected on (`adapter111.ts:3-4`). `right[id]` drives the GPUPixel-right half. The midline anchor p16 takes the mean.
- Changing the view never changes the stored values. 翻轉, 旋轉 and the camera mirror only change which chip, 左 or 右, shows which value.
- **The label mapping** is `screenLeftIsGpLeft(face, toScreen)`: true when `toScreen(p74).x < toScreen(p77).x`. In the editor, `toScreen` is `oToV` (RM §3.5). In the camera it is the identity, or `x → 1 − x` for `facing === 'user'`, applied to the beautified track's face: the live loop reports its unmirrored answer (`LiveStats.gpLeftOnLeft`), which holds until the eyes cross by a fifth of their distance, so a face rolled near ±90° keeps its labels; before the first face an upright face is assumed (`cameraScreenSwap(facing, gpLeftOnLeft)`). The lens (RM §3.3) gets this per person as `PersonInfo.screenSwap = !screenLeftIsGpLeft(...)`.
- **Lens operations** (in `src/edit/lens.ts`, step 1's module). `side` is the on-screen side; the lens maps it per person through `screenSwap` to `values` or `right`:
  - `get(id, side?: 'L' | 'R'): {value, mixed}` and `set(id, v, side?)`. Without `side`, for a non-split item, or while that person's `right` is null, both read and write `values`; `set` never creates `right`. Under 全部, `mixed` compares the requested side across persons.
  - `split(): boolean` (the reference person's `right ≠ null`) and `setSplit(on: boolean, activeSide)`: on copies the six values into `right`; off writes the active side's value to both sides, then `right = null`.
  - Every one of these is one `EditState` change, so it is one undo step.
- **Camera → editor hand-over.** The camera detects on the unmirrored frame. A shot saved mirrored (`Shot.mirrored`) becomes an O whose GPUPixel-left half is the subject's other cheek. `mirrorSides(person)` swaps `values[id]` and `right[id]` for the six split ids. It is applied to `primaryInit` and `template` when `shot.mirrored` (RM §3.7). Unit-tested. **Removed 2026-10-18:** the shot opens at 原圖 (RM §3.7), so no split value is handed over and nothing needs swapping; `Shot.mirrored`, `mirrorSides` and `handOverLook` are gone.
- **Engine.** `reshapeUniforms(person, weight)` returns `dL = values[id]` and `dR = right?.[id] ?? values[id]` for each split item. Non-split items are unchanged.

### 3.5 Presets, 重置, sanitize, legacy

- **Presets** (`params.ts:98-143`, ported to person parts in step 1): the person part of every preset sets the 14 new values to neutral, `right = null`, and `shades.brow`, `.eyeshadow`, `.liner` and `.lens` to null. Under Q7's alternative ("leave them"), the person part would omit these fields. That is the only code that changes.
- **`matchesPreset`** (`params.ts:307-311`, ported) also requires `right === null` and neutral new values.
- **重置** sets every person to `neutralPerson()` (RM §3.4; `naturalPerson()` until 2026-10-18), which is neutral for every new item.
- **`sanitizeEditState`** (RM §3.4), additions:
  - missing new ids → neutral; missing new shade keys → null; a missing `right` → null (entries from step-1 to step-4 builds have none);
  - a shade id not in `SHADES[part]` → null;
  - `right`: keep only `SplitParamId` keys with finite numbers, clamped to 0..1; an empty object → null.
- **`legacyProjection`** writes `values` (the GPUPixel-left side) for split items. A 0.3 build reading a 0.4 entry ignores the unknown ids, because `sanitizeParams` iterates only its own `PARAM_DEFS` (`params.ts:285-288`). 0.3 draws 大眼, 瘦臉, V臉 and 窄臉 with one value on the whole face, so when 0.3 changed one of them after a rollback, `mergeLegacy` gives that value to both halves (`right` too); a split item 0.3 left at the projected value keeps its `right`, and `right` becomes null when no item's halves differ any more (step-1 spec §5.3).

### 3.6 Files to add and change (anchors at `892ea61`; step-1 modules by name)

| File | Change |
|---|---|
| `src/types.ts:8-34, 117-130` | 14 ids; `ParamDef.split`; `SplitParamId`; `MakeupPart` (moved); `Face.iris`, `Face.lids` |
| `src/tracking/adapter111.ts:106-140` | `iris` from MP 468–477 and `lids` from the two eye contours (normalized x, y) |
| `src/engine/params.ts:4-37, 63-80, 228-237, 273-305` | New defs in order; `split` on six defs; `SHADES`, `ORIG_PARTS`, fixed tints; `MAKEUP_PICK_DEFAULT` per part; `shadeColor` generalized; preset person parts |
| `src/engine/passes/reshape.ts:20-65, 93-98, 101-178, 214-319` | Uniform builder with L/R; new tables (`JAW_L/R`, `TEMPLE_OVAL`, side tables); new geometry (targets, ellipses, root band, box discs); `shiftEllipse`, `squeezeAxis`; chain order (§4.5); face-table step-5 block (§4.4) |
| `src/engine/passes/faceCap.ts` (step 1, `uMaxBox`) | `U_MAX` includes the six new warps at ±max, for the protect window (§4.4) |
| `src/engine/passes/reshapeCpu.ts:53-143` | Port of every addition; hash re-pinned (`reshapeCpu.test.ts:32`) |
| `src/engine/passes/eyeFrame.ts` | New: eye frames, lid stations, brow gaps, EAR, iris, gates (pure) |
| `src/engine/passes/makeupProc.ts` | New: `buildMakeupGeometry` (pure), `createProcMakeupPass(gl)`, `PMAKEUP_VS/FS` |
| `src/engine/passes/makeupProcCpu.ts` | New, test-only: CPU port of the PMAKEUP per-kind α and colour functions, the blend modes and `skinGate` (§8.2) |
| `src/engine/passes/makeup.ts:113-119, 180-188, 192-225` | After step 1's copy/mesh split: procedural layers are drawn after every face's GPUPixel mesh. `ready` also waits until the lashes load has settled; a lashes failure disables only 睫毛 (§4.10) |
| `src/engine/pipeline.ts:103-112, 320-332, 393-399` | `planPasses`: the makeup pass runs when `(lip or blush active and GPUPixel textures ready) or (a procedural item active and the PMAKEUP program compiled)`; lazy procedural program; pass names `mk.<layer>` |
| `src/engine/gl/gl.ts:140-149` | `loadImageTexture(gl, url, {mipmap?: boolean, r8?: boolean})` for the lashes texture (today it takes no options) |
| `src/engine/passes/overlay.ts` | With 顯示臉部特徵點 on, also draws the lid stations, the brow-gap ends and the iris circles (debug) |
| `scripts/gen-makeup.mjs:13-18` | `lashes()` generator → `public/makeup/own/lashes.png` (§4.10) |
| `src/edit/lens.ts`, `src/edit/state.ts`, `src/edit/legacy.ts` (step 1) | Side-aware `get/set`, `split`, `setSplit`, `mirrorSides` (until 2026-10-18), `screenSwap`; new neutral values |
| `src/ui/panelModel.ts:22-55, 241-247, 301-561` | `MAKEUP_PARTS` × 10, `makeupView`, `side`, level-1 items, 卸妝, `makeupOn`, liner effective shade, split item, dividers, badges, side binding |
| `src/ui/components/BeautyPanel.tsx:43-120` | Two-level makeup strip (leading part tile, part list), dividers, badges, the seen-dot |
| `src/ui/components/Slider.tsx:48-53, 145-166` | `binding.sides` → segmented 左｜右 plus the other-side caption |
| `src/ui/icons.tsx` | 17 new icons |
| `src/ui/screens/Editor.tsx:789-797`, `Camera.tsx:205`, `Review.tsx:84-92`, `src/ui/state.ts:17-25` | Strip notes (§2.4); `Shot.mirrored` and `mirrorSides` at hand-over (until 2026-10-18: the shot opens at 原圖) |
| `LICENSES/NOTICE.txt:48` | "Original to this project" gains the procedural makeup and `public/makeup/own/lashes.png` |
| `src/bench/main.ts` | Step-5 rows (§6.2) |

---

## 4. Engine and shader changes

### 4.1 Landmark regions

GPUPixel 111 indices (RB §2.7) unless marked. "L/R" means GPUPixel-left / GPUPixel-right.

| Item | Region and anchors |
|---|---|
| 下頜線 | Contour L 6, 8, 10, 12, 14 · R 26, 24, 22, 20, 18 (jaw angle → chin, chin 16 excluded) |
| 太陽穴 | `Face.oval` L [30, 31, 32] = MP 162, 21, 54 · R [6, 5, 4] = MP 389, 251, 284 (`faceOval.ts:6-9`) |
| 髮際線 | `ext[0]` = MP 10 (forehead top); FH = \|ext[0] − ext[2]\| (MP 10 → glabella 9) |
| 鼻翼 | p80 / p81 (MP 48 / 278, nose wings) |
| 山根 | band centred on mid(p78, p79) (MP 245 / 465, bridge sides at canthus height), ending exactly at the inner eye corners p55 / p58; height from p43 (MP 6) to p45 (MP 5) |
| 嘴高 | p106 (mouth centre); its axis points from p49 (subnasale) to p106; p84 / p90 (corners) set the width |
| Eye frame | outer corner L 52 / R 61; inner corner L 55 / R 58 |
| Upper lid | `Face.lids`: outer corner, 7 upper points, inner corner (9 points; MP 33 … 133 / 263 … 362) |
| Lower lid | `Face.lids`: outer corner, 7 lower points, inner corner (9 points) |
| EAR | L p72 / p73 (MP 159 / 145) · R p75 / p76 (MP 386 / 374) |
| Brow | upper L 33–37 (outer → inner) · R 42–38; lower L 64–67 · R 71–68 |
| Iris | `Face.iris` L = MP 468 (+469–472), R = MP 473 (+474–477) |
| 修容 | jaw contour L 2–14 · R 30–18; cheek hollow p4 → p84 · p28 → p90; nose sides p78 → p82 · p79 → p83 |
| 高光 | bridge p43 → p45; cheekbone between p57 → p2 · p62 → p30; forehead ext[1] → ext[2] (MP 151 → 9); chin p16 → p93 |
| 臥蠶 | the lower lid |

Notation: `iso(p) = (p.x, p.y / aspect)` as in the shader (`reshape.ts:236`). FW = `faceWidthIso` (`reshape.ts:208-211`). m̂ = unit(iso(p16) − iso(p43)) points toward the chin. r̂ is the unit perpendicular to m̂ with r̂ · (iso(p77) − iso(p74)) > 0, so it points from the GPUPixel-left eye toward the GPUPixel-right eye. Both are defined by landmarks, so they hold for rotated and mirrored faces.

### 4.2 New warps

| Item | Primitive | Target / radius | Engine delta | Max move | Min det J |
|---|---|---|---|---|---|
| 下頜線 | 10 × `curveWarp` | t_i = p_i + uv(0.22·FW·unit(n_i + 0.35·(−m̂))); n_i = inward contour normal (⊥ p_{i+1} − p_{i−1}, toward p46) | d = 0.12·v (per side) | 0.050 FW | 0.73 |
| 太陽穴 | 6 × `curveWarp` | t_k = o_k + uv(0.12·FW·n_out,k); n_out = outward oval normal (⊥ oval[k+1] − oval[k−1], away from the oval centroid); weights 0.6, 1, 0.6 | d = 0.22·s·w_k (per side) | 0.035 FW | 0.62 (+) / 0.67 (−) |
| 髮際線 | `shiftEllipse` | c = ext[0]; axes r̂, m̂; rx = 0.40 FW, ry↑ = 0.50 FH, ry↓ = 0.55 FH | disp = uv(0.09·s·FH·m̂) (+ moves down) | 0.09 FH (0.024 FW) | 0.56 (+) / 0.60 (−) |
| 鼻翼 | 2 × `shiftAround` | R = 0.55·\|iso(p81) − iso(p80)\| | disp_L = −0.10·s·(p81 − p80); disp_R = −disp_L | 0.10 alar width per wing (0.024 FW) | 0.72 |
| 山根 | `squeezeAxis` | c = mid(p78, p79); axes r̂ (across), m̂ (along); r− = r̂·(c − p55), r+ = r̂·(p58 − c) (iso), ry = \|iso(p45) − iso(p43)\| | k = 0.30·s (+ narrows) | 0.012 FW; the bridge sides move 7–16 % of the root half-width | 0.76 (+) / 0.70 (−) |
| 嘴高 | `shiftEllipse` | c = p106; ay = unit(iso(p106) − iso(p49)), ax ⊥ ay; rx = 2·max(\|ax·(p84 − p106)\|, \|ax·(p90 − p106)\|) (iso), ry↑ = L, ry↓ = 1.6·L, L = \|iso(p106) − iso(p49)\| | disp = uv(−0.18·s·L·ay) (+ moves up) | 0.18 L (0.029 FW) | 0.73 (+) / 0.56 (−) |

`v` is the one-way value and `s = (v − 0.5)·2` (`params.ts:268-271`). Every delta is multiplied by the live weight and by `yawAttenuation` (`reshape.ts:71-75`), as today.

The last two columns are measured on the recorded fixture face (`landmarks_sample_face.json`, 1000 × 1500, slightly turned) and on its `mirrored` landmarks, with the item alone at ±max, by a 300 × 300 finite-difference sweep of the backward map. They include the overlap of neighbouring primitives: 下頜線's ten discs overlap by about 40 %, so the item moves almost twice as far as one primitive and its det J is lower than one primitive's 1 − d. The unit tests (§8.1) pin each value within ±0.05. 下頜線 uses d = 0.12, not 0.20: at 0.20 the item moved 0.084 FW (more than 瘦臉 at 100) with det J 0.57.

**The new primitives** (GLSL and exact CPU ports):

```glsl
// Elliptical local translate with a flat top: content near c moves by disp. ax / ay = unit iso axes (face-right,
// face-down); r = (rx, ry toward −ay, ry toward +ay) in iso units. Profile (1 − w⁴)²: the feature moves almost
// rigidly (k ≥ 0.88 for w ≤ 0.5), C¹ everywhere, and max |dk/dw| = 2.42 (at w = 0.81).
vec2 shiftEllipse(vec2 tc, vec2 c, vec2 ax, vec2 ay, vec3 r, vec2 disp) {
  vec2 d = iso(tc) - iso(c);
  float qy = dot(d, ay);
  vec2 q = vec2(dot(d, ax) / r.x, qy / (qy < 0.0 ? r.y : r.z));
  float w2 = dot(q, q);
  if (w2 >= 1.0) return tc;
  float k = 1.0 - w2 * w2;
  return tc - disp * k * k;
}

// Squeeze toward the axis through c along ay: content at signed distance a = (q − c)·ax moves toward the axis by
// k·a·(1 − t²)²·(1 − v²)², t = a / r− or a / r+ (by side), v = (q − c)·ay / ry. Zero on the axis and exactly zero at
// |t| = 1 and |v| = 1, C¹. The displacement is along ax only, so det J = 1 + k·(1 − t²)(1 − 5t²)·(1 − v²)²,
// which lies in [1 − 0.8k, 1 + k] for k > 0 and in [1 − |k|, 1 + 0.8|k|] for k < 0.
vec2 squeezeAxis(vec2 tc, vec2 c, vec2 ax, vec2 ay, vec3 r, float k) {
  vec2 d = iso(tc) - iso(c);
  float a = dot(d, ax);
  float t = a / (a < 0.0 ? r.x : r.y);
  float v = dot(d, ay) / r.z;
  if (t * t >= 1.0 || v * v >= 1.0) return tc;
  float h = (1.0 - t * t) * (1.0 - v * v);
  vec2 s = ax * (k * a * h * h);              // iso
  return tc + vec2(s.x, s.y * uAspect);        // iso → UV
}
```

Why they are needed:
- **`shiftEllipse`:** with `shiftAround`'s disc profile (1 − w²)², the mouth corners (w ≈ 0.59 at any radius that keeps the nose still) move 42 % of the centre's distance, so 嘴高 would curve the lips. With the flat top and rx set from the farther corner, both corners sit at w ≤ 0.5 and move 88 % or more, also on a turned face.
- **`squeezeAxis`:** the bridge side p78 lies only 0.04 FW from the inner eye corner p55 on the fixture face (the GPUPixel template suggests 0.07 FW). A `shiftAround` that ends at the corner has to carry its whole shift over that gap: at the intended 12 % of the root width it folds (det J 0.26 on the fixture). The squeeze spreads the change over the whole band between the inner corners: the middle is compressed, the skin beside each corner stretches, and the corners themselves stay exactly fixed.

**Fold safety.** `buildReshapeTable` clamps each warp on the CPU, so that warp alone keeps det J ≥ 0.5 even on unusual landmarks:
- `curveWarp`: |d| ≤ 0.5;
- `shiftAround`: |disp| ≤ 0.32·R (1 − 1.54·0.32 ≈ 0.5);
- `shiftEllipse`: |disp| ≤ 0.20·min(ry↑, ry↓) (1 − 2.42·0.20 ≈ 0.52);
- `squeezeAxis`: |k| ≤ 0.5.

With the constants above, the clamps bind only on degenerate faces; the 山根 band is also skipped when r− or r+ is below 0.01 FW. The RM §4.3 fold sweep (select spec §4.4: centre distances 0.6–2.6 FW, two and three faces, `min det J ≥ MIN_DET` = 0.35) covers all 15 shape items, also with the six split items set to opposite extremes, and the step-6 strokes off.

**Locality guarantees** (each is a unit test, §8.1):
- 山根 never moves an eye: the band ends exactly at the inner corners (|t| = 1 at p55 and p58), and every other eye point lies farther out.
- 嘴高 never moves the subnasale p49: it lies on the ellipse's own axis at w = 1 exactly. The chin p16 lies outside the ellipse (w ≈ 1.2 on the fixture).
- 髮際線 never moves the brows: every brow point lies at w ≥ 1.6 of the ellipse on the fixture face.
- 鼻翼 and 山根 move the nose only along r̂.

### 4.3 Split sides in the shader

Each split anchor's side is a compile-time constant, because GPUPixel indices are sided by construction (§3.4, §1.3 item 5):

```glsl
const float SLIM_SIDE[9]   = float[9](0., 1., 0., 1., 0., 1., 0., 1., .5); // origins 3,29,7,25,10,22,14,18,16
const float VJAW_SIDE[6]   = float[6](0., 0., 0., 1., 1., 1.);             // 8,10,12 | 24,22,20
const float NARROW_SIDE[4] = float[4](0., 0., 1., 1.);                     // 2,4 | 30,28
const float JAW_SIDE[10]   = float[10](0.,0.,0.,0.,0., 1.,1.,1.,1.,1.);
const float TEMPLE_SIDE[6] = float[6](0.,0.,0., 1.,1.,1.);
const float TEMPLE_W[6]    = float[6](.6, 1., .6, .6, 1., .6);            // d_k = sided(tL, tR, side_k) · w_k
float sided(float dl, float dr, float side) { return dl + (dr - dl) * side; } // == dl exactly when dr == dl
```

大眼 uses `eyeL` at p74 and `eyeR` at p77. With 左右分開 off, `dr == dl`, so every delta equals today's value bit for bit.

### 4.4 Face-table step-5 block

The 選臉 spec (§4.4 there) fixes the step-1 layout of the 96-texel RGBA32F row:
- 66–67 hold the v0.3 strengths: slim, v, narrow, chin, forehead, nose, mouth, eye. For split items these are the **left** values (GPUPixel-left).
- 65 holds `eyeDisp`, which carries 眼距.
- 70–71 are reserved for step 5.
- 72–74 hold the influence box, the cap and the protect window (select spec r2).
- 75–95 are spare.

Step 5 fills them as follows. Every value is already multiplied by the live weight and the yaw attenuation, and the vectors are clamped (§4.2).

| Texel | Contents |
|---|---|
| 70 | right values: slimR, vR, narrowR, eyeR |
| 71 | jawR, templeR, 0, 0 |
| 75 | jawL, templeL, hairline, noseWing |
| 76 | 山根 k, mouthHeight, 0, 0 (k is the amount; mouthHeight is a zero test, its vector is in 90) |
| 77–81 | jaw targets t_i, 10 × vec2 |
| 82–84 | temple anchors o_k, 6 × vec2 |
| 85–87 | temple targets t_k, 6 × vec2 (the weights are the GLSL constant `TEMPLE_W`, §4.3) |
| 88 | face axes r̂, m̂ (iso) |
| 89 | hairline (rx, ry↑, ry↓, 0) |
| 90 | hairline disp (uv, 2) · mouth-height disp (uv, 2) |
| 91 | mouth-height (rx, ry↑, ry↓, 0) |
| 92 | mouth-height axis ay (iso, 2), 0, 0 (ax is its perpendicular; `shiftEllipse` only uses ax squared) |
| 93 | nose wing (R, disp_L.xy, 0) |
| 94 | nasal root: centre c (uv, 2), r−, r+ |
| 95 | nasal root: ry, 0, 0, 0 |

With 左右分開 off, texel 70 equals the left values and texel 71 equals texel 75's first two values, so `sided()` returns the left value exactly (§4.3). The row is then full: step 5 uses all 21 spare texels. If the 選臉 sub-spec moves a step-1 slot during its review, this block moves with it; the counts (2 reserved and 21 spare texels, all used by step 5) are what this spec relies on, and any later item needs a wider row (RM §4.3).

`reshapeGeometry().box` (`reshape.ts:151-177`) gains the influence discs of every active new warp:
- `curve(o, t)` for jaw and temple;
- for both ellipses, the bounding box of the rotated ellipse with semi-axes rx and max(ry↑, ry↓): half-widths `hypot(rx·ax.x, ry·ay.x)` and `hypot(rx·ax.y, ry·ay.y)` (iso), not a disc of the largest radius, which would reach 0.4 FW above the forehead;
- `disc(p80/p81, R)` for 鼻翼 and `disc(c, max(r−, r+, ry))` for 山根.

The skip test that holds outside the box therefore stays exact.

**Influence cap and protect window.** In the 選臉 spec (r2) each face's cap is half the iso distance to its nearest neighbour, a displacement budget that does not depend on the warps, so step 5 does not change any cap. The `U_MAX` influence box (every 美型 item at maximum, `uMaxBox` in `faceCap.ts`, select spec A3 and §4.7) sizes each face's 128² protect window when the photo has ≥ 2 selectable faces. Step 5 adds the six new warps at ±max to `U_MAX` (both signs are tried for the bidirectional ones, and the larger box is kept), so the window still covers every sample of the chain. On the fixture face and its mirror, every new box above lies inside the v0.3 `U_MAX` box (the 瘦臉 and 額頭 discs are larger), so the window, and with it the 瘦臉 limit, does not change. A unit test checks this. The fold sweep of select spec §4.4 (RM §4.3) covers the new warps.

### 4.5 Face chain order (per face, inside the RM §4.2 sum)

```
tc0 = tc
contour: 瘦臉 (SLIM, sided) → V臉 (sided) → 窄臉 (sided) → 下頜線 (sided) → 太陽穴 (sided) → 下巴 → 額頭 → 髮際線
protectContour(tc0, tc)                 // 瘦臉 limit now also bounds 下頜線, 太陽穴, 髮際線 (RM §4.4 "bounded by the protect array")
nose:    瘦鼻 → 鼻翼 → 山根
mouth:   嘴高 → 嘴型                     // backward order: forward, 嘴型 scales about the true p106, then 嘴高 moves it
eyes:    眼距 → 大眼 (eyeL at p74, eyeR at p77)
```

Every new step sits behind its own zero test, as today (`reshape.ts:293-316`). The FaceProtect comment (`reshape.ts:185-201`, `faceProtect.ts:1-5`) is updated to list the three new contour warps. The maskWarp pass (`pipeline.ts:414-423`) uses the same map, so the skin mask follows the new warps automatically.

### 4.6 Procedural makeup pass (P1)

**Terms.** In this section, `src` is P1's **input** texture and "the target" is P1's output buffer. Today those are the source and A. From step 4 they come from its A/B ping-pong (skin-cleanup spec §4.1): with every pass on, P0d writes B, so P1 reads B and writes A.

**Where.** In P1 (RM §4.2), after the copy and after **every** face's GPUPixel lip/blush mesh: those draws read `src` and overwrite their whole mesh (`makeup.ts:90-95`), so they must come first. Then `procMakeup.draw(target, geometry, src)` draws the layers in `LAYER_ORDER`, one `drawArrays` per non-empty layer, covering all faces at once. That is **at most 9 draw calls per frame for any number of faces.**

**No feedback loop.** Every layer writes with fixed-function blending, so stacked items compose without reading the target. A fragment may read `src` (texture unit 0, never the target) for its colour or its skin gate. The blending uses `blendFuncSeparate`, which keeps the destination alpha at 1:

| Mode | Blend func (RGB; alpha `ZERO, ONE`) | Fragment output | Layers |
|---|---|---|---|
| multiply | `DST_COLOR, ZERO` | `mix(vec3(1), tint, α)` | contour, brow, shadow, aegyoShade |
| screen | `ONE, ONE_MINUS_SRC_COLOR` | `tint · α` | highlight, aegyoLight |
| over | `SRC_ALPHA, ONE_MINUS_SRC_ALPHA` | `(color, α)` | lens, liner, lashes |

**Order** (`LAYER_ORDER`): contour → highlight → brow → shadow → aegyoLight → aegyoShade → lens → liner → lashes. The lens colour comes from `src`, and only lid items and the lashes overlap the iris; those are drawn after it.

**Vertex layout** (11 floats, 44 B):

| Attribute | Contents |
|---|---|
| `aPos` (2) | O-space UV (step 3's `uWin` maps it to the buffer) |
| `aLoc` (2) | item-local coordinates: eye ribbons (u, d), other ribbons (u, v), ellipses (ξ, η), the lens (q − c)/r |
| `aAux` (2) | per-kind extras: 眼影 strip height H; 眼線 thickness T; the lens's distances (dU, dL) to the upper and lower lid; otherwise 0 |
| `aCol` (4) | tint RGB and α_max (intensity × live weight × gates) |
| `aKind` (1) | shape enum (§4.8) |

The lens's (q − c)/r and the ellipses' (ξ, η) are affine in the position, so they interpolate exactly. Ribbon coordinates are exact at the vertices and linear inside each triangle; with 17 stations per lid that is well below a pixel of error. Antialiasing uses `fwidth` of the signed distances, so edges stay one pixel wide at any resolution and in any tile. Uniforms: `uSrc` (0), `uLashes` (1), `uInvDst`, `uWin` and `uLayerMode`. The uniform count does not depend on N.

**Geometry builder** (`buildMakeupGeometry`, pure, unit-tested in Node):
- Per face it reads `RenderFace.person` (values and shades), `weight`, `face` and `eyeFrames(face, aspect)`.
- It emits nothing for an item at 0 after the gates, so an item with nothing to draw costs nothing.
- Eye items are ribbons along the lid stations (§4.7), and the lens is the aperture strip between the lids. Brows and the 修容／高光 ribbons are strips along their landmarks, and ellipses are 4-vertex quads.
- Each layer is **one `TRIANGLE_STRIP` over every face**. Consecutive pieces are joined by repeating the last vertex of one and the first vertex of the next (one more repeat when needed to keep the strip's parity). Culling is off, as for the GPUPixel mesh (`makeup.ts:220-221`).
- With all ten parts on, a face needs about 680 vertices (joins included); the cap is `MAX_PMAKEUP_VERTS_PER_FACE = 768`. The buffer holds `MAX_RENDER_FACES × 768 × 44 B` = 338 KB (10 faces since step-1 spec §6.7; 270 KB at 8, 203 KB at 6), and only the used range is uploaded with `bufferSubData` each frame.

### 4.7 Eye frames, lid stations, EAR, iris (`eyeFrame.ts`)

- **Frame.** o = the outer corner. ex = unit(iso(inner) − iso(outer)). ey = unit of m̂ minus its ex component, so it points toward the chin. w = \|iso(inner) − iso(outer)\|. Eye-local coordinates: x = (q − o)·ex / w and y = (q − o)·ey / w, with 0 at the outer corner, 1 at the inner corner, and y positive downward.
- **Lid stations.** `Face.lids` gives 9 upper points (outer corner, 7 upper, inner corner) and 9 lower points per eye, in eye units. `upper[k]` and `lower[k]` are their piecewise-linear interpolation at x_k = k/16 (points ordered by x; a non-monotonic run takes the running maximum of x). With 9 points per lid the chord error is below 0.005 eye units, about a tenth of the liner's width. A parabola through the 5 GPUPixel lid points was rejected: it misses the real lid by up to 0.045 eye units on the fixture face (§1.3 item 8).
- **Normals.** Each station gets the lid's outward unit normal: the perpendicular of the central-difference tangent, pointing away from the aperture (up for the upper lid, down for the lower lid). Ribbons are offset along these normals, so a band keeps its width where the lid is steep near the corners.
- **Overhang.** For 眼影 and 睫毛, the upper lid is extended past the outer corner with stations at x = −0.07, −0.14 and −0.22. For 眼影's lower accent, the lower lid is extended the same way to x = −0.15 (stations at −0.075 and −0.15). 眼線's wing has its own stations (§4.8).
  - The overhang stations lie on the corner line: y = the lid's y at x = 0, which is 0 because the lid's corner point is the frame origin. So the upper overhang never runs below the corner, the lower one never above it, and both eyes get the same overhang.
  - Each overhang station takes the normal of the corner station (x = 0), and the lid normals are central differences over the stations at x ≥ 0 only. The overhang therefore leaves the lid stations unchanged, and a ribbon over it cannot fold at the corner.
  - Extending the lid along its end tangent was rejected. The dense contour's first chord (MP 33 → 246, 263 → 466) is about 0.07 eye units long and steep, so the upper overhang ran 0.22–0.73 eye units below the corner at x = −0.22 on the fixture faces, up to 3× differently on the two eyes of one face, and crossed the lower one.
  - Continuing along the wing direction (−0.16, −0.07) was also rejected. With central-difference normals, the turn of 70–100° at the corner folds the 眼影 and 睫毛 ribbons between x = −0.07 and 0 on every fixture eye. With the corner normal, the overhang strip is almost flat on steep eyes, where that normal is within 1–4° of the wing direction.
- **Aperture.** h_k = max(0, lower[k] − upper[k]). A closed or inverted eye has h = 0 at every station, so the lens strip has no area.
- **Brow gap.** `browGap[k]` is the distance from upper station k to the brow-lower polyline (pts111 64–67 / 71–68 in eye units, extended flat past its ends).
- **EAR** = \|iso(p72) − iso(p73)\| / w (left) and \|iso(p75) − iso(p76)\| / w (right). It is about 0.39 on the GPUPixel template and 0.37–0.46 on the fixture face.
- **Iris.**
  - c = the iris centre; r = the mean iso distance of its four boundary points.
  - It is valid when 0.12 ≤ r/w ≤ 0.32, 0.1 ≤ c.x ≤ 0.9 and c.y lies between upper(c.x) − 0.5·r/w and lower(c.x) + 0.5·r/w (eye units). Otherwise the fallback is c = p104 / p105 and r = 0.21·w.
  - `adapt()` fills `iris` and `lids` from the raw landmarks. RM §3.6 already caches raw landmarks for this reason, so no re-detection is needed.

### 4.8 Item shapes

In eye units, with `band(y, a, b, f) = smoothstep(a − f, a + f, y) · (1 − smoothstep(b − f, b + f, y))`. For the eye ribbons, `aLoc = (u, d)`: u is the eye x of the station, and d is the signed offset from the lid along its outward normal, positive away from the eyeball. All constants are initial values; the step-5 tuning may change them within the test bounds of §8. I is the intensity after weight and gates. The shape kinds are those `aKind` selects.

| Kind | Geometry | α (before × I) | Colour |
|---|---|---|---|
| **shadow** (眼影, per eye) | Upper piece: upper-lid stations x ∈ [−0.22, 1], d from −0.02 to H_k = 0.65·max(browGap_k, 0.25) (`aAux.x` = H). Lower accent: lower-lid stations x ∈ [−0.15, 0.55], d ∈ [−0.03, 0.10] | Upper: α₁ = `smoothstep(−0.02, 0.01, d)` · (1 − `smoothstep(0.30·H, H, d)`) · h(u), with h = `smoothstep(−0.22, 0.02, u)`·(1 − `smoothstep(0.80, 1.02, u)`)·(0.55 + 0.45(1 − u)). Lower: α₂ = 0.35 · `band(d, 0, 0.07, 0.02)` · `smoothstep(−0.15, 0.05, u)`·(1 − `smoothstep(0.35, 0.55, u)`). Where the two pieces meet at the outer corner, multiply blending composes them | multiply shade |
| **liner band** (眼線) | upper-lid stations x ∈ [0, 1], d ∈ [−0.03, T(u) + 0.02], `aAux.x` = T(u) = 0.045·(0.35 + 0.65(1 − u)) | `smoothstep(−0.006 − f, −0.006 + f, d)` · (1 − `smoothstep(T − f, T + f, d)`) · (1 − `smoothstep(0.85, 1.0, u)`), f = max(0.75·`fwidth(d)`, 0.004) | over shade |
| **liner wing** | 3 stations from the outer corner toward eye-units direction (−0.16, −0.07) (outward and up); thickness T_s = T(0)·(1 − s) over s = 0, 0.5, 1 | the band formula with T = T_s, so the wing tapers to nothing at its tip | over shade |
| **lashes** (睫毛) | upper-lid stations x ∈ [−0.22, 1], d ∈ [0, Lh(u)]; `aLoc` = ((u + 0.2)/1.2, d/Lh(u)) | `texture(uLashes, vec2(aLoc.x, 1 − aLoc.y)).r`. Lh: piecewise linear over u = −0.2, 0, 0.15, 0.5, 0.8, 0.95, 1 → 0.12, 0.12, 0.20, 0.20, 0.13, 0.08, 0 (constant below −0.2; the texture's edge columns are empty) | over `#141212` |
| **aegyo light / shade** (臥蠶) | 17 lower-lid stations re-spaced over x ∈ [0.05, 1.0], d ∈ [0, 0.16] | v = d/0.12. Light: 0.45·h·`smoothstep(0.05, 0.35, v)`(1 − `smoothstep(0.55, 0.85, v)`). Shade: 0.35·h·`band(v, 0.86, 1.0, 0.06)`. h = `smoothstep(0.10, 0.35, u)`(1 − `smoothstep(0.80, 0.95, u)`) | screen `#FFF1E8` / multiply `#B79F95` |
| **lens** (美瞳) | the aperture strip: upper and lower stations at x_k alternate; `aLoc` = (q − c)/r (iso); `aAux` = (dU, dL) = (0, h_k) on upper vertices and (h_k, 0) on lower vertices | ρ = \|aLoc\|; mask = 1 − `smoothstep(1.04, 1.10, ρ)`; pupil = `smoothstep(0.30, 0.38, ρ)`; ring = `smoothstep(0.78, 0.92, ρ)`; lid = `smoothstep(0, 0.05, dU)`·`smoothstep(0, 0.04, dL)`; catch = 1 − `smoothstep(0.72, 0.88, Y(src))`. α = mask·lid·catch·(shade ? pupil : ring) | over: shade: `shade·(0.42 + 1.15·Y(src))·(0.92 + 0.08·sin(28θ))·mix(1, 0.55, ring)·(0.85 + 0.15·smoothstep(0, 0.10, dU))`; 原色: `src·0.55` |
| **brow ribbon** (眉毛) | 6 stations (tail extension at u = −0.12, then upper/lower pairs at u = 0…1, tail → head), each edge pushed out by 8 % of the local width; lower edge resampled to 5 points by arc length | `smoothstep(0, 0.22, v)`(1 − `smoothstep(0.78, 1, v)`) · `smoothstep(−0.12, 0.05, u)` · mix(1, 0.45, `smoothstep(0.70, 1.0, u)`) · strokes, with strokes = mix(0.89, 0.78 + 0.22·stripe, vis), stripe = 1 − `smoothstep(0.15, 0.35, \|fract(18u + tilt(u)·2.2v) − 0.5\|)`, tilt = mix(0.15, 0.7, `smoothstep(0.6, 1, u)`), vis = 1 − `smoothstep(0.25, 0.5, fwidth(18u))` | multiply shade (原色 grey 0.60) |
| **contour jaw ribbon** (修容) | contour L 2–14 / R 30–18, inward 0.10 FW along n_i | 0.55 · skin · `smoothstep(0, 0.18, v)`(1 − `smoothstep(0.35, 1, v)`) · `smoothstep(0, 0.12, u)`(1 − `smoothstep(0.88, 1, u)`) | multiply `#A8897A` |
| **contour ellipse** | centre lerp(p4, p84, 0.30) / lerp(p28, p90, 0.30); half-axes (0.30, 0.085)·\|p84 − p4\| along p84 − p4 | 0.45 · skin · (1 − `smoothstep(0.35, 1, ξ² + η²)`) | multiply `#A8897A` |
| **contour nose ribbon** | p78 → p82 / p79 → p83, width 0.035 FW | 0.30 · skin · (1 − `smoothstep(0.3, 1, \|2v − 1\|)`) · `smoothstep(0, 0.15, u)`(1 − `smoothstep(0.75, 1, u)`) | multiply `#A8897A` |
| **highlight ribbon** (高光) | p43 → p45, width 0.055 FW | 0.35 · skin · (1 − `smoothstep(0.2, 1, \|2v − 1\|²)`) | screen `#FFF3E3` |
| **highlight ellipse** | cheekbone lerp(p57, p2, 0.45) / lerp(p62, p30, 0.45), half-axes (0.11, 0.05) FW along p2 − p57; forehead lerp(ext[1], ext[2], 0.35), (0.13, 0.07) FW along r̂; chin lerp(p16, p93, 0.40), (0.06, 0.035) FW | k · skin · (1 − `smoothstep(0.2, 1, ξ² + η²)`), with k = 0.30 / 0.22 / 0.25 | screen `#FFF3E3` |

Intensity mapping: α_max = I for every part. The constants above set the visual maximum (for example 修容 at 100 multiplies the shaded skin by at most `mix(1, tint, 0.55)`). Like 口紅 today, the slider is opacity (`makeup.ts:95`).

### 4.9 Gates: blink, occlusion, yaw, size

| Gate | Formula | Applies to |
|---|---|---|
| Blink, lens | g = `smoothstep(0.15, 0.20, EAR)` per eye (RM: EAR < 0.15 → 0) | 美瞳 |
| Blink, lashes | g = `smoothstep(0.08, 0.14, EAR)` per eye | 睫毛 |
| Lid clip | the lens is drawn only on the aperture strip between the lid polylines; its `lid` term (§4.8) fades in over 0.05 eye units below the upper lid and 0.04 above the lower lid, with an upper-lid shadow | 美瞳 |
| Lash-line seal | the liner reaches 0.006 eye units into the aperture, and the eyeshadow's lower edge is feathered over d ∈ [−0.02, 0.01], so no gap shows and almost no colour reaches the eyeball | 眼線, 眼影 |
| Skin | skin(src) = `smoothstep(0.06, 0.14, Y)` · `smoothstep(0.005, 0.04, r − b)`, with Y = Rec. 709 luma of the sRGB-encoded `src` at the fragment. The luma floor is low on purpose: the drafted 0.12–0.22 removed half of 修容 from deep skin in the cheek hollow (sRGB (52, 35, 28), Y ≈ 0.15). Black hair, beards, eyeglass frames and grey backgrounds are rejected by the chroma term (r − b ≤ 0.005) | 修容, 高光 |
| Yaw, far side | the far side is the half whose eye is nearer the nose tip (`yawProxy`, `adapter111.ts:96-103`); its items × `yawAttenuation(yaw)` | 修容 (all three kinds), 高光 cheekbone |
| Size | `smoothstep(0.010, 0.016, w / shortEdgeIso)`, with shortEdgeIso = min(1, 1/aspect): normalized, so preview, tiles and export agree | 睫毛 |
| Live weight | × `RenderFace.weight` (face easing) | all |

How occlusion is handled:
- **Eyelids over the iris:** the lid clip.
- **Hair over the brows, forehead or temples:** brows are multiply, so dark hair barely changes. The skin gate removes 高光 and 修容 from black or grey hair, beards, eyeglass frames and neutral backgrounds. Brown or blond hair has skin-like chroma and keeps part of them (§9).
- **Hands over the face:** they pass the skin gate, an accepted limitation (§9).
- **Glasses over the eyes:** not detected; an accepted limitation (§9).
- **Profile views:** the far side fades through the yaw gate.
- **Faces overlapping each other:** the GPUPixel lip/blush meshes are drawn in table order, so the last face wins there (RM §4.3). The procedural layers blend, so where two faces' items overlap, both show.

### 4.10 Lashes texture (`scripts/gen-makeup.mjs`, own work)

- **Output:** `public/makeup/own/lashes.png`, 512 × 128, an 8-bit greyscale PNG whose value is coverage. Row 127 is the root and row 0 the tip. u covers eye x ∈ [−0.2, 1.0] (u = (x + 0.2)/1.2), so lashes that lean past the outer corner stay inside the texture. The 512 texels span 1.2 eye widths, so the texture is not magnified below an eye width of about 430 px. A close-up selfie exported at 4096 reaches about 500 px, which is 1.2× here and would be 2.3× with 256 texels.
- **Lashes:** 42. Root k sits at eye x_k = 0.02 + 0.96·(k + 0.5 + j_k)/42, where j_k ∈ ±0.3 comes from a fixed LCG (seed `0x6d6c`), so the output is deterministic. Each lash is a quadratic Bézier from the root to a tip shifted outward by lean(x_k)·0.35 eye units, with lean(x) = 0.15 + 0.35·(1 − x): outer lashes lean outward more. Every third lash is 85 % long.
- **Rendering:** thickness tapers from 3.2 px at the root to 0.6 px at the tip. Coverage comes from the distance to the curve with 8 × 8 supersampling, evaluated only inside each lash's bounding box and combined across lashes with max.
- **Upload and caching:** `loadImageTexture(gl, url, {r8: true, mipmap: true})` uploads it as `R8` from `RED` (WebGL2 takes the red channel of the decoded image) and calls `generateMipmap` with `LINEAR_MIPMAP_LINEAR`: 64 KB plus mips, about 85 KB, the same as a 256 × 64 RGBA8 texture. It is precached by the existing glob (`vite.config.ts:110`).
- **Load failure:** disables 睫毛 only, as a failed GPUPixel load disables makeup today (`pipeline.ts:328`). The makeup pass's `ready` waits until the lashes load has settled (success or failure), so `engine.spec.ts:66-68` holds for a first 睫毛 render too.

### 4.11 Interaction with the other passes

- **P0 mask:** unchanged. Makeup is drawn on the unwarped source, so P2 carries it with the features: 大眼 enlarges the liner with the eye, and 嘴高 moves the lipstick. That is correct by construction.
- **Step-4 tone tools:** the skin-cleanup spec runs 祛痘, 勻膚, 膚色, 黑眼圈, 法令紋, 白牙 and 亮眼 in O **before** P1 (its P0b–P0d). Makeup is therefore drawn on the retouched face:
  - 美瞳 reads the retouched iris as `src`, so 亮眼's crisper iris shows through the tint;
  - 臥蠶 sits on the under-eye that 黑眼圈 has already lifted;
  - 勻膚 never sees blush or eyeshadow and so cannot remove them, which is why step 4 made that choice.
- **Composite:** 磨皮's variance gate leaves the high-contrast liner and lashes nearly untouched, and the eye holes (`mask.ts:19-26`) cover most of them.
- **Tiles (step 3):**
  - geometry is in O and mapped through `uWin`;
  - `src` reads use `gl_FragCoord` in the tile's own window;
  - mip levels depend on the output scale, not the tile.

  A tiled export therefore equals an untiled one. Step 5 adds that case to step 3's export harness (`tests/e2e/pages/export.ts`, crop spec §8.2): §8.3 item 9.
- **The "match GPUPixel" debug option:** unaffected.

---

## 5. Persistence and migration

1. **No new storage fields.** The 14 values live in `PersonParams.values`, the four new shades in `PersonParams.shades` and the split values in `PersonParams.right`, all of which RM §3.2 defines. `HistoryEntry` v2 and `CameraLook` (`meiyan.look.v1`) carry them as they are. There is no IndexedDB schema bump, and no `meiyan-*` name changes.
2. **Older entries.**
   - v1 entries (v0.3) are migrated per RM §5.2: new values neutral, shades null, `right = null`.
   - v2 entries written by pre-step-5 development builds are filled the same way by `sanitizeEditState` (§3.5).
   - Reopening needs no detection: `Face.iris` and `Face.lids` come from the cached raw landmarks (RM §3.6).
3. **Undo** stores `EditState` by reference (RM §3.4), so `right` and the new shades share structure and add a few bytes per state.
4. **Licensing.** `LICENSES/NOTICE.txt:48` becomes: "Original to this project: the filter LUTs, the look LUTs, the makeup shade colours, the procedural makeup (src/engine/passes/makeupProc.ts) and public/makeup/own/lashes.png (generated by scripts/gen-makeup.mjs), and the icons." No third-party makeup asset is added. `public/makeup/gp/*` stays the only GPUPixel-derived makeup.

---

## 6. Performance budget and measurements

### 6.1 Budget (targets on the user's iPhone; desktop Chromium numbers are recorded first)

| Path | Budget |
|---|---|
| Reshape at 2048, 10 faces (the cap since step-1 spec §6.7; 8 from §6.6, 6 before), all 15 shape items non-neutral and split | ≤ 8 ms (the RM §6.2 rule: above it, the editor cap drops to 8, then 6, then 4 faces) |
| Reshape live at 1080, 3 faces, all items | ≤ 3 ms |
| P1 makeup at 2048, 10 faces, all 10 parts | ≤ 3 ms GPU; ≤ 9 draw calls plus N GPUPixel meshes |
| P1 makeup live at 1080, 3 faces, all parts | ≤ 1.5 ms |
| `buildMakeupGeometry` + `eyeFrames` (CPU) | ≤ 0.2 ms per face |
| PMAKEUP program compile (lazy, first frame with a procedural item) | ≤ 40 ms once |
| New resident memory | lashes texture with mips 85 KB + VBO 203 KB: under 0.3 MB of the RM §4.7 6 MB |
| Live, 3 faces, everything in RM §6.1 plus all step-5 items | still ≥ 24 fps at tier H |

### 6.2 Bench rows (`src/bench/main.ts`)

1. A reshape microbench with the step-5 warps at N = 1, 3, 6 and 10 (the cap, step-1 spec §6.7), at 1080 and 2048, every item at ±max: the median of 20 frames with a `gl.finish()` fence.
2. P1 with all ten parts at N = 1, 3, 6 and 10.
3. PMAKEUP compile time.
4. Live fps in the `chromium-group` Playwright project (`group.y4m`, RM §8.4) with all makeup on.

The iPhone runs use `/bench.html` and need a preview deploy, which happens only with the user's go-ahead (RM §1.2).

**If the numbers are bad,** the steps below are taken in order. Each is a one-line constant in `src/config/limits.ts`.
1. Live at tier M/L: brow strokes off (`vis = 0`) and the lens pattern off.
2. Live: 睫毛 sampled with a +1 LOD bias.
3. The RM §4.3 face-cap ladder.

---

## 7. Error and edge cases

| Case | Handling |
|---|---|
| Closed eye, or a wink | Per-eye blink gates (§4.9). Lid items stay, which is right for closed-eye makeup. The editor shows the §2.4 note. |
| Squint or smile (EAR 0.15–0.20) | The lens fades partly, and the lid clip shows only the visible iris. Lashes stay. |
| Eye nearly closed, or the lower lid detected above the upper lid | h = max(0, lower − upper) is 0, so the aperture strip has no area and no lens is drawn. |
| Implausible iris landmarks | Fallback centre and radius (§4.7). |
| Looking sideways | The iris landmarks follow the gaze, so the lens follows. |
| Glasses | Not detected. Liner and lashes sit on the lash line, under most frames. The skin gate removes 高光 and 修容 from the frames. Lenses may tint behind glass (§9). |
| Bangs over the brows or forehead | Brow multiply barely changes dark hair. The skin gate removes 高光 from black or grey hair; brown or blond bangs keep part of it (§9). 髮際線 moves the fringe edge, which reads as longer bangs. |
| Beard or stubble | The skin gate removes 修容 from black or grey hair; a brown beard keeps part of it (§9). |
| Turned face (\|yaw\| > 0.15) | Warps: `yawAttenuation`, as today. Far-side 修容 and 高光 fade. The eye items keep the landmark geometry, which follows foreshortening. |
| Tiny face (group photos) | Below `MIN_FACE_FRAC` (RM §3.6) nothing is drawn. Above it, 睫毛 waits for the size gate, and the brow strokes fade through `fwidth`. |
| Upside-down or rotated photo | Sides and axes come from landmarks (§3.4, §4.1), and the labels come from the V-space eye positions, so everything stays consistent. |
| 翻轉 / 旋轉 after split edits | Stored values are unchanged, and the labels swap to match the screen. |
| Camera flip (front ↔ back) | The look is subject-sided, so the labels re-map on the next frame. The physical cheek stays the same for a subject facing the camera. |
| Mirrored save → 編輯 | The shot opens at 原圖 (2026-10-18), so no split value crosses over; until then `mirrorSides` kept the same cheek (§3.4). |
| Overlapping faces | Warps: the RM influence cap. Lip and blush meshes: table order, last face wins. Procedural items blend, so both faces' items show where they overlap. |
| Feature at the image border | Geometry is clipped by the viewport, and reshape samples clamp to the edge, as today. |
| Open mouth + 嘴高 | The ellipse moves lips and teeth together. The subnasale stays. |
| 左右分開 under 全部 with mixed persons | Toggling applies one state to all. The 「各人不同」 caption compares each side separately. |
| Makeup GPUPixel textures fail | 口紅 and 腮紅 off (today). Procedural parts still work. |
| `lashes.png` fails | 睫毛 off. The other parts work. |
| PMAKEUP compile fails | The eight new parts are off, with the §2.4 note. The warps and 口紅/腮紅 are unaffected. Logged once. |
| Context loss | Rebuilt with the other passes. The geometry is rebuilt each frame from the cached faces. |
| 基本模式 or no face | The existing `faceNote` dims 美型 and 美妝 (`Editor.tsx:789-797`; `editor.spec.ts:140-160` keeps its text). |

---

## 8. Testing

### 8.1 Unit (Vitest)

- **Params and shades:**
  - the ported schema tests (§3.1);
  - every new def has `scope: 'person'` and `live: true`; `split` is exactly the six ids;
  - shade ids are unique per part and every hex is valid;
  - `shadeColor` for every part, including liner null → 黑;
  - the pick defaults.
- **Presets:** every preset leaves the new items neutral with `right = null` (Q7 default); `matchesPreset` fails when `right ≠ null`.
- **Sanitize** (fuzzed): unknown shade → null; `right` drops non-split keys and non-finite values; an empty `right` → null; missing new ids → neutral.
- **Lens and sides:**
  - `setSplit` on copies and off keeps the active side;
  - side writes with `screenSwap` false and true;
  - 全部 + split;
  - `mirrorSides` swaps exactly the six ids and is an involution (removed with it, 2026-10-18);
  - `screenLeftIsGpLeft` for upright, mirrored, flipH and quarter-turned faces;
  - under 全部 the label is resolved per face.
- **Adapter:** `iris` and `lids` from `landmarks_sample_face.json` and its `mirrored` landmarks. The iris centres equal p104 and p105, and the radius / eye width is in [0.15, 0.3]. The lid corners equal p52 / p55 and p61 / p58, and the upper-mid and lower-mid points (MP 159 / 145, 386 / 374) equal p72 / p73 and p75 / p76.
- **`eyeFrames`** on the fixture face:
  - every point of `Face.lids` lies on its lid polyline within 1e-6 (eye units);
  - h_k ≥ 0 everywhere and h_k > 0.05 for k = 2…14 (the eyes are open);
  - the brow gaps lie in [0.3, 1.2] eye units;
  - EAR ≈ the measured value (pinned within 0.02);
  - a face with the upper lid moved onto the lower lid (synthetic, in `pts111` and `lids`) gives EAR < 0.05, h = 0 at every station and both blink gates at 0;
  - a horizontally mirrored face (x → 1 − x, which keeps the GPUPixel index halves) gives mirrored frames within 1e-6;
  - the overhang (§4.7), on the fixture face, its `mirrored` landmarks and the three `group_faces.png` faces: the overhang stations lie on the corner line within 1e-9 (upper y ≤ 0, lower y ≥ 0), the two eyes agree within 0.05 at x = −0.22, the stations at x ≥ 0 are the same with and without the overhang, and no quad of a 睫毛 (d ≤ 0.20), 眼影 upper (d ≤ H, and d ≤ 0.8) or lower-accent ribbon folds.
- **Warps** through `reshapeMapCpu`, per new item at ±max:
  - direction: 下頜線 moves jaw content inward; 太陽穴 + moves the temple contour outward; 髮際線 + moves content at ext[0] down; 鼻翼 − brings the wings together; 山根 + narrows the root (p78 and p79 move toward each other); 嘴高 + moves p106 up;
  - locality: the §4.2 guarantees (p55, p58 and every `lids` point fixed under 山根; p49 fixed under 嘴高; pts111 33–42 and 64–71 fixed under 髮際線), and identity outside the box;
  - min det J ≥ 0.5 per item, and within ±0.05 of the §4.2 table on the fixture and its mirror; the RM §4.3 fold sweep with every new item at its extremes keeps `min det J ≥ MIN_DET` (0.35);
  - split: L ≠ R moves only that half; p16 gets the mean; with `right = null` the map is bit-identical to the pre-step-5 map;
  - the protect window: on the fixture and its mirror, every new warp's box lies inside the v0.3 `U_MAX` box, so `uMaxBox` and the window are unchanged (§4.4);
  - the face-table packing: the step-5 block fills texels 70–71 and 75–95 and leaves 72–74 (box, cap, protect window) untouched.
- **`shiftEllipse`:** port equals formula; C¹ at qy = 0; k ≥ 0.88 for w ≤ 0.5.
- **`squeezeAxis`:** port equals formula; zero displacement on the axis and at |t| = 1 and |v| = 1; det J within [1 − 0.8k, 1 + k] on a dense grid for k = ±0.3 and ±0.5.
- **`skinGate`:** ≥ 0.9 on deep skin in shadow sRGB (52, 35, 28) and on light skin (235, 190, 170); ≤ 0.1 on black hair (25, 24, 26), mid grey (128, 128, 128) and a blue background (90, 120, 170).
- **`buildMakeupGeometry`:**
  - finite;
  - empty for all-zero intensities;
  - per-layer ranges in `LAYER_ORDER`, each a valid strip (degenerate joins only between pieces);
  - at most `MAX_PMAKEUP_VERTS_PER_FACE` vertices per face with all ten parts on;
  - every 修容 vertex lies inside the contour polygon (pts111 0–32 closed through ext[0]) grown by 0.02 FW, the antialiasing margin;
  - eye ribbons stay within their §4.8 station range and offset range; the lens strip has zero area for the closed-eye face;
  - two faces produce disjoint geometry with interleaved layers;
  - the gates scale α_max (blink, size, yaw far side, live weight).
- **Panel model:**
  - level 2 keeps `['reset', 'orig', …shades]` (existing tests);
  - level 1 lists 卸妝 plus 10 parts in RM order;
  - 卸妝 is a no-op when nothing is on;
  - the liner strip has no `orig`;
  - the four no-shade parts show `['reset', 'on']`;
  - `makeupOn` from 0 applies the pick default;
  - the split item's pressed state; badges only while split is on; dividers at the five group starts; `tabHasValue` sees `right`;
  - the side binding: label chip, other-side caption, double tap resets one side.
- **Lashes generator:** regenerating gives the committed PNG pixel for pixel; it is 512 × 128 and single-channel. The value is 0 in the outermost 4 columns on both sides (no lash is clipped by the texture edge, and the clamped edge reads as empty), and the root row is non-zero only over the root span.

### 8.2 Shader CPU ports and hash pins

| Shader | Port | Pin |
|---|---|---|
| `RESHAPE_FS` | `reshapeCpu.ts`, every step-5 addition | `reshapeCpu.test.ts:32` re-pinned in the step-5 commit |
| `PMAKEUP_FS` | `makeupProcCpu.ts`: each kind's α and colour, the blend modes and `skinGate` | `makeupProcCpu.test.ts` pins the FNV-1a hash of `PMAKEUP_FS`, the same pattern as the reshape pin |

No CPU rasterizer is ported. Geometry is checked in Node through `buildMakeupGeometry` (§8.1), and the fragment math is checked on the GPU with quads whose attributes are known affine ramps (§8.3 item 2). `fwidth` of an affine attribute is a constant, so the CPU side computes it exactly.

### 8.3 E2E (Playwright, Chromium) — `tests/e2e/shape-makeup.spec.ts` (RM §8.4 step 5)

1. **Warps equal the port:** `tests/e2e/pages/reshape.ts` gains cases for every new warp at ±max, split L ≠ R, and all items on. Each must have max \|GPU − CPU\| < 0.05 px, as `reshape.spec.ts`.
2. **Makeup math equals the port:** a new harness `tests/e2e/pages/makeup.{html,ts}` draws, for each kind and each blend mode, one 256 × 256 quad on a target filled with a known colour ramp. The quad's `aLoc` and `aAux` are affine ramps across it that cover the kind's whole range (e.g. d from −0.05 to 0.3, ρ from 0 to 1.2), and `src` is a second ramp texture for the skin gate and the lens colour. The GPU result must equal `makeupProcCpu` evaluated at the pixel centres within 2/255. The lashes kind samples the real `lashes.png`.
3. **Each part changes only its region:** on `sample_face.png`, starting from 原圖 (every other item neutral, so P2 is skipped and no warp or smoothing spreads the change), each part at 100 with its first shade changes pixels only inside the union of its geometry's bbox dilated by 3 px; outside it, the max channel difference is ≤ 2/255. The lip and blush rows of `engine.spec.ts:120ff` stay. For 美瞳: the changed pixels lie inside the iris disc × 1.12 ∩ the aperture strip dilated by 2 px, and pixels with Y > 0.88 (catchlight) are unchanged within 2/255.
4. **Blink:** the harness feeds a synthetic closed-eye `Face` (upper-lid points copied onto the lower lid in `pts111` and `lids`, and the iris moved onto the lid line). 美瞳 and 睫毛 then leave the image unchanged, while 眼影 still changes the lid.
5. **左右分開:** in the editor on `sample_face.png`, 瘦臉 with 左 = 100 and 右 = 0 moves only the screen-left cheek (mean displacement of pts111 3/7/10/14 vs 29/25/22/18 regions). After 翻轉 (step 3) the chips swap and the image is mirrored. On `group_faces.png`, face B is a mirrored copy, and 左 still moves its screen-left cheek. Undo of the toggle restores `right = null`.
6. **Per person:** `group_faces.png`, person 2 + 眼影 大地 changes pixels only inside face 2's box. 全部 + 眉毛 changes all three faces. Reopening from 最近編輯 restores shades, values and split with `detectCalls === 0`.
7. **UI flow:**
   - editor: 美妝 → leading tile → 10 part tiles → 眼影 → 大地 → slider label 眼影 → ↶ restores;
   - 卸妝 clears all;
   - camera (`camera.spec.ts` style): 美妝 → part list → 美瞳 → 冰藍 → the preview changes in the iris region; 美型 → 左右分開 → the 左｜右 chips appear in the floating slider and do not collapse the panel.
8. **Parity:** `parity.spec.ts` (RM §8.4) passes unchanged, because the new items are neutral.
9. **Tiles:** in step 3's export harness, every makeup part at 100 and every new warp at max on the composited face, with the geometry cases of crop spec §8.2: a forced `TILE = 256` render equals the untiled render within 1/255 (the 睫毛 mip level included), up to crop spec §8.2's accepted exception: at most 3 isolated pixels at 2/255 (the 膠片 lift of a 1-LSB resample flip), each at least one apron from every tile line. Of this step's cases, only quarter 1 + flip is granted it: it has one such pixel, 44 px from the nearest line on SwiftShader. Identity and θ 12° + crop keep 1/255.

### 8.4 Fixtures

There is no new photo. The tests use:
- `sample_face.png` with its recorded landmarks;
- `group_faces.png` and its JSON from step 1 (a mirrored copy B, the small faces C and D);
- synthetic `Face` edits made in the harness (a closed eye, a mirrored face, yaw: the landmarks of one side compressed toward the nose).

A non-asserting `shape-makeup.spec.ts` case tagged `@sheet` writes a contact sheet to `test-results/makeup-sheet/`: every part × shade at 50 and 100, and every warp at ±50, on `sample_face.png` and the three group faces. It is shown to the user at the step-5 hand-off for visual tuning. It is not committed.

---

## 9. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Eye-item registration: MediaPipe's lid points sit up to ~0.02 W_e off the true lash line on some eyes | The liner floats, or the eyeshadow edge shows | Ribbons follow MediaPipe's dense lid contour (`Face.lids`, 9 points per lid, chord error < 0.005 W_e) instead of a curve fit through 5 points (error up to 0.045 W_e, §1.3 item 8); lash-line seal overlaps (§4.9); feathered edges; contact-sheet review on four faces and two scales; the constants are one table |
| The skin gate passes brown or blond hair and brown beards (skin-like chroma) | Some 高光 on light bangs, some 修容 on a brown beard | The gate is tuned not to remove makeup from deep skin (§4.9), which matters more; the contact sheet includes the fixture's hairline; accepted for v0.4 |
| The look is judged by eye, and procedural makeup can look "drawn on" | Users dislike it | Conservative maxima (§4.8); 原色 options that intensify the person's own colour; brow strokes; the contact sheet before release; Q2 and Q3 left open for style choices |
| Lenses on dark irises look fake in light colours | Uncanny eyes | Luminance-keyed colour (keeps the iris texture), limbal ring, catchlight kept, lid shadow; light shades capped by `0.42 + 1.15·Y` |
| Hands and glasses defeat the skin gate | Highlight on a hand, tint on a lens | Accepted for v0.4 (no extra model under the one-instance and 100 MB rules); documented |
| Combined warps on small faces in group shots | Folding next to a neighbour | Per-warp clamps, RM influence cap, the RM §4.3 fold sweep |
| An 18-item 美型 strip is long | Items are hard to find | Group dividers, the selected item scrolls into view, the split badges; the order is unchanged from RM so 大眼 stays first |
| Live cost with 3 faces and everything on | fps below 24 | ≤ 9 makeup draws per frame, short strips with procedural shading (≤ 768 vertices per face), the §6.2 ladder |
| WebKit `fwidth` / derivative precision on Apple GPUs | Jagged edges on iPhone | Edges also have a minimum feather in eye units (0.006–0.02); checked on the iPhone bench pass |

---

## 10. Out of scope (v0.4)

- Makeup 套裝 (whole looks), 眼神光 (catchlight), 痣 (beauty marks), 雙眼皮 (double eyelid), 妝容筆 (makeup brush), lower lashes, and lash, liner or brow *styles* (Q2).
- Tone choices for 修容 and 高光 (Q3); a free colour picker; per-part blend choice.
- Brow shaping or moving warps (眉型, 眉高), eye-shape warps (眼角, 眼高, 眼睛角度), 人中, 顴骨, 蘋果肌, 流暢臉, 小臉.
- Double-chin removal (needs inpainting), 五官立體 and 打光 (lighting), 3D 塑顏, 黃金側顏, expressions (GAP 不做).
- Glasses or hand detection; per-face makeup in the camera (one camera look, RM §2.4).
- New makeup in the beauty presets (RM Q7 default) and in 一鍵質感.

---

## 11. Open questions for the user

Each has a default. The build uses the default if the user does not answer.

1. **美妝 navigation.** Two-level strip (part list ↔ colours, the panel height never changes), or an always-visible second row of part names (both visible at once, but the photo shrinks by about 44 pt on the 美妝 tab only)? *Default: two-level strip.*
2. **Styles for 睫毛, 眼線 and 眉毛.** One shape each with an intensity slider (v0.4), or 2–3 shapes each (e.g. 睫毛 自然／濃密／根根分明)? *Default: one shape each; styles later.*
3. **修容 and 高光 tones.** One tone each, or a choice (修容 冷調／暖調, 高光 珠光／柔霧)? *Default: one tone each.*
4. **閉眼時的眼妝.** Fade only 美瞳 and 睫毛, and keep 眼影, 眼線 and 臥蠶 on closed eyes (this spec), or fade every eye item as the roadmap wording says? *Default: fade only 美瞳 and 睫毛.*
5. **髮際線 direction.** + lowers the hairline (fuller, smaller forehead), or + raises it? *Default: + lowers it.* By the same "+ = more of the thing" rule: 太陽穴 + = fuller, 山根 + = higher (narrower root), 嘴高 + = higher, 鼻翼 + = wider.
6. **下頜線.** One-way (tighten only, as the roadmap lists it), or both ways (− softens the jaw)? *Default: one-way.*
7. **Confirm the roadmap refinements in §1.3** (blink-gate scope, screen instead of soft-light, the `shiftEllipse` and `squeezeAxis` primitives, 鼻翼's construction, split sides by landmark half, the two-level 美妝 strip, no 原色 for 眼線, `Face.lids`, the 512 × 128 R8 lashes texture). *Default: approve. RM §2.1, §3.8, §4.4 and §4.7 already carry them (2026-10-12 consistency pass); a "no" on any item reverts that RM line and this spec together.*
