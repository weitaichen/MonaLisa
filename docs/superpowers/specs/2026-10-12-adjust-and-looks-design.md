# Mona Misa 美顏 v0.4 step 2: 調節 and 一鍵質感

- **Date:** 2026-10-12
- **Status:** proposal for the user's review. The user chose the scope (12 調節 items and 5 質感 looks, photo-level, in the editor and the live camera), but the design has not been discussed with them yet. The real choices are in §11.
- **Base:** `feat/meiyan-pwa` at `892ea61` (v0.3.0). Built after step 1 (選臉／選人), so it uses the `EditState` / `PhotoParams` / lens model of the contract.
- **Contract:** [v0.4 roadmap](2026-10-12-v04-roadmap.md), called **C** below: §2.1 (tabs and strips), §3.1–3.4 (param layers, lens, presets, 質感 in `photo.look`), §3.5 (coordinate spaces), §4.2 (pass order), §4.4 (調節 and 質感 in brief), §4.7 (GPU resources), §8 (tests). This spec owns the exact maths, the UI details, the look definitions and the step-2 test list. §1.4 lists where it refines C.
- **Research:** `reports/醒圖 功能差距分析.md` (**GAP**) and `research_notes/醒圖 功能差距分析/xingtu_editing_ai.md` (**XE**).

## 摘要（繁體中文）

新增「調節」分頁，共 12 項：亮度、曝光、對比、高光、陰影、色溫、色調、飽和、鮮艷度、褪色、顆粒、暗角。調節套用於整張照片，照片編輯器和即時相機都能用，而且會存進「最近編輯」，也可以復原。
「一鍵」分頁分成「美顏」和「質感」兩部分。質感有 5 款：膠片、CCD、直閃、藍調、電影感。每一款都由三樣東西組成：一張本專案自己算出來的色彩 LUT、一組固定的調節數值（例如顆粒、暗角、褪色），再加上「程度」滑桿控制強弱。你自己調的調節數值會疊加在質感上，滑桿顯示的仍是你自己的數值。
質感、濾鏡、美顏預設三者互不覆蓋，可以疊加使用。
所有新效果都在現有的最後合成步驟裡完成：不多一個 pass，也不多一次重新取樣。沒用到調節和質感時，跑的是原本的合成程式，畫面和速度都和現在完全一樣。開啟後，即時相機每幀預估只多 1 到 1.5 毫秒，實際數字會在 iPhone 上量測。
LUT、縮圖和圖示全是原創，由程式算出，不使用任何第三方的 LUT 或濾鏡素材。

---

## 1. Goal and user-visible behaviour

### 1.1 What the user gets

| Where | Behaviour |
|---|---|
| Editor, new **調節** tab | 12 sliders: 亮度, 曝光, 對比, 高光, 陰影, 色溫, 色調, 飽和, 鮮艷度 (−50…+50), plus 褪色, 顆粒, 暗角 (0–100). They act on the whole photo, after every beauty effect and after the 濾鏡. Each slider commit is one undo step (↶ ↷). The values are saved with the photo in 最近編輯 and come back on reopen. |
| Editor, **一鍵** tab | Two part buttons, **美顏** and **質感** (the pattern of 美妝's 口紅／腮紅). 美顏 is today's strip (原圖 · 自然 · 精緻 · 氣色 · 自訂). 質感 offers 無 · 膠片 · CCD · 直閃 · 藍調 · 電影感 with thumbnails. The 程度 slider belongs to the active part. |
| Live camera | The same 調節 tab (the camera has 7 tabs) and the same 一鍵 › 質感. The preview shows the result live, including the vignette and moving grain. The shutter captures what the preview shows. 編輯 on the shot keeps the 調節 values and the 質感. |
| Interaction | A 質感 never changes the 濾鏡, the beauty preset or the user's 調節 values. A beauty preset never changes 調節 or 質感. 重置 clears all of them (C §3.4). Hold-to-compare (按住對比) shows the untouched original, as today. |
| 基本模式 | 調節 and 質感 need no face model, so they work in 基本模式 too. |

### 1.2 What 醒圖 users expect, and how this maps

- 醒圖's 調節 is a Lightroom-style panel: 亮度, 曝光, 對比, 高光, 陰影, 色溫, 色調, 飽和, 鮮艷度, 褪色, 顆粒 and 暗角. 暗角 was added in v13.7.0 (2025-12) (XE Q2). Mona Misa 美顏 has none of them today (GAP table, row 調節). This step ships the first batch exactly as GAP P0 lists it. Curves, HSL, levels, 紋理 and 結構 come later (§10).
- 醒圖's 2026 updates concentrate on one-tap looks and camera presets: 一鍵電影感 (v14.0), 一鍵藍調 (v14.4), 直閃 in the camera (v14.8), 直閃水光 (v15.3–15.6), and one-tap 膠片／CCD (v15.6.0). They come with an adjustable strength (XE Q2 and the version table). The five looks here follow those themes and have a 程度 slider.
- 醒圖 applies these looks while editing. Mona Misa can also show them **live in the camera** (GAP: "即時相機也能直接用"). Live preview is the differentiator, so the looks are `live: true`.
- In 醒圖, a lot of 調節 sits behind the VIP paywall (GAP, low confidence). Here everything is free and stays on the device.

### 1.3 Invariants

1. **Parity.** With every 調節 item neutral and no drawable look (`look = null`, or its LUT not resident), the frame is drawn by the **base composite program**, whose text is the step-1 composite unchanged (hash-pinned, §4.7). The output is therefore identical to step 1 (and to v0.3 under C §1.1) by construction, and so are its compile time and per-pixel cost. `parity.spec.ts` stays green. Inside the 調節 program every stage still sits behind a uniform branch that is skipped at neutral (C §4.2), so switching between the two programs never jumps.
2. **Photo level.** Every 調節 item and the look live in `EditState.photo` (C §3.1). Under 選人 they apply to the whole photo, whatever the selection. The person strip is dimmed with the caption 「整張照片」 on 調節 and on 一鍵 › 質感 (C §2.2).
3. **One resample, no new pass.** Every stage is a per-pixel operation inside P5 composite, after the 濾鏡 LUT. No FBO, readback or texture copy is added.
4. **Same look at every size.** The vignette is defined on the picture frame V. Grain cells are sized on the photo's own short edge (`fullShortEdge`, C §3.5) and indexed in global V coordinates. The 2048 preview, the live preview, the capture and the step-3 tiled full-resolution export therefore look the same.

### 1.4 Relation to the contract (refinements, no reversals)

| C says | This spec | Why |
|---|---|---|
| §4.4 褪色 "black lift plus contrast toward a 0.08 floor" | Floor = 0.16·v at the 0–100 value v (褪色 100 lifts black to 41/255), white drops by 0.04·v, chroma × (1 − 0.1·v) | 0.08 at the maximum is too faint to read as matte. The looks' 褪色 offsets are tuned against this definition. |
| §4.2 "every new stage sits behind a uniform branch that is skipped at neutral" | Kept inside the 調節 program, and in addition the composite is built in two variants from one source, `compositeFs({adjust})`. Frames with nothing to draw use the base variant (the step-1 text); the 調節 variant is compiled on first need (§4.1) | Startup compile time and the neutral per-pixel cost stay exactly as in step 1 for everyone who never touches 調節 or 質感, and parity holds by construction rather than by branch discipline |
| §4.4 "`look_<id>.png`" and "`lutFor('look', id)`" | `public/luts/looks/look_<id>.png` plus `look_<id>_thumb.png`. The texture cache key is `${kind}:${id}` (the filter `film` and the look `film` share an id), with an LRU cap of 6 textures for filters and looks together (§3.5) | C §4.7 says "resident only while used"; today's filter cache is unbounded (8 MB if every filter is browsed), so the cap keeps C §6.1's "≤ 6 MB new resident memory" true |
| §4.1 `RenderInput` | Two more optional fields: `pictureFrame` (the picture rectangle, needed for the camera's ratio crop) and `grainSeed` (moving grain in the camera). In step 3, `output.tile` and `fullShortEdge` feed the same uniforms (§4.5). | §4.5 |
| §3.4 a look = LUT + offsets | A look is **all-or-nothing**: while its LUT is not yet resident, neither the LUT nor its offsets are drawn | Avoids a flash of half a look in the camera, and keeps the export rule the same as for 濾鏡 |

C §2.1 and §2.4 gave the tab widths without the 6 px side padding of `.tabs` (`theme.css:420-426`). They were corrected in C during this review: 8 tabs are (375 − 12)/8 = 45.4 pt (still ≥ 44 pt) and 7 tabs are 51.9 pt.

**Naming.** C uses `tone` for the 膚質 group of step 4 (`tone.even`, `resetGroup('tone')`, C §3.1). This step therefore names its code `adjust` (`adjustMath.ts`, `ADJUST_GLSL`, `adjustStage()`, `uAdjustOn`), so that step 4's skin-tone stage and this step's 調節 stage never share a name in the same shader.

---

## 2. UI

### 2.1 調節 tab

Position: after 美妝 (C §2.1). In step 2 the editor has 7 tabs (一鍵 · 美膚 · 美型 · 美體 · 濾鏡 · 美妝 · 調節); 裁切 arrives in step 3. Every item is an icon tile (44 × 74 pt, DS §7.3). The strip scrolls, and two `strip-divider`s split it into light │ colour │ effects:

**⊘ 原圖 · 亮度 · 曝光 · 對比 · 高光 · 陰影 │ 色溫 · 色調 · 飽和 · 鮮艷度 │ 褪色 · 顆粒 · 暗角**

| Element | Behaviour |
|---|---|
| Default selection | 亮度 (`PanelSelection.adjust`, remembered in the module-level `lastSel` like the other tabs) |
| Item dot | 4 px accent dot when the user's value is drawn: `adjustItemActive` (`adjustMath.ts`), the engine's own neutral rule (\|s\| > 1e-4, v > 1e-4, §4.3) applied to the user's value without the look. Not `hasValue`'s > 0.01, which hid display ±1 (v = 0.01), a visible 顆粒 or 暗角 (step-2 review) |
| Tab dot | 調節 shows the tab dot when any of the 12 user values is drawn (the same rule) |
| ⊘ 原圖 | Resets the 12 user values to neutral in one undo step. It does not touch the 質感. It is a no-op (no haptic, no undo step) when everything is already neutral, like 美體 (`panelModel.ts:426-427`). Neutral is the dots' rule (`adjustIsNeutral` = `adjustValuesNeutral`), so ⊘ makes an undo step exactly when a dot shows. |
| Slider | One slider for the selected item. Bidirectional items show −50…+50 with a centre tick and snap to 0 within ±3; one-way items show 0–100. Double-tap resets to neutral (`Slider.tsx`, unchanged). There is no recommended-default dot, because neutral is the default. |
| Slider tint | 色溫's track shows a blue → amber gradient and 色調's a green → magenta gradient (new `SliderBinding.track?: 'temperature' \| 'tint'` → CSS class `track-temperature` / `track-tint`). Every other item uses the plain track. |
| 質感 chip | When `photo.look ≠ null`, a compact pill leads the strip: 「質感：膠片」. Tapping it switches to 一鍵 › 質感. It tells the user that the look also moves some 調節 items, while the sliders keep showing the user's own numbers. |
| Persons | With ≥ 2 persons, the person strip is dimmed with the caption 「整張照片」 and the face boxes are hidden (C §2.2). The step-1 first-touch toast 「{label}套用於整張照片」 fires once per editor session for the whole tab, with the label 調節 (「調節套用於整張照片」), not once for each of the 12 items. |
| Face gating | None: 調節 is never dimmed by `faceNote` (`FACE_TABS` stays `['shape', 'makeup']`, `BeautyPanel.tsx:43`) |

### 2.2 一鍵 tab: 美顏 and 質感

```
[美顏] [質感] │ 原圖 · 自然 · 精緻 · 氣色 (· 自訂)              ← part 美顏 (today's items)
[美顏] [質感] │ 無 · 膠片 · CCD · 直閃 · 藍調 · 電影感          ← part 質感 (thumbnails)
```

- **Part buttons** use the makeup part row markup and behaviour (`BeautyPanel.tsx:93-120`): `aria-pressed`, a haptic on change, and a has-value dot. 質感 shows the dot while a look is set; 美顏 never shows one. The default part is 美顏, so the strip looks as it does today on first open and existing tests keep finding 自然／精緻／氣色.
- **質感 items.** 無 uses the `none` icon; every look uses its thumbnail `/luts/looks/look_<id>_thumb.png` over the `look` icon (the `Thumb` fallback, `BeautyPanel.tsx:212-228`, which gains a `fallback` icon prop; filters keep `filter`). Exactly one item is selected: 無 when `look = null`.
  - Tapping a look **from 無** sets `look = {id, amount: defaultAmount}` (0.8).
  - Tapping **another look** keeps the current amount, like hopping between presets (`panelModel.ts:412-417`).
  - Tapping **the selected look** does nothing, unless its LUT failed to load: then the tap retries the load (`loadLut`), with no undo step (§7).
  - **無** clears the look.
  - Each change is one undo step with a haptic (`BeautyPanel` `tapItem` adds `'look'` to its haptic list, `BeautyPanel.tsx:72`).
- **程度 slider.** In 美顏 it is today's preset 程度. In 質感 it is `look.amount` (0–100, default dot at 80, double-tap → 80), hidden while 無 is selected. Its key is `look.<id>`, so switching looks resets the drag state.
- **Tab dot:** 一鍵 shows the tab dot while a look is set (`tabHasValue('preset')` returns `false` today, `panelModel.ts:549-550`).
- **Persons:** the 美顏 part is person-level (C §3.4) and behaves as in step 1. The 質感 part is photo-level: dimmed chips with 「整張照片」, face boxes hidden and no per-person strip notes (C §2.2). The first look pick of an editor session with ≥ 2 persons shows 「質感套用於整張照片」.

### 2.3 Camera

- **Tabs:** 一鍵 · 美膚 · 美型 · 美體 · 濾鏡 · 美妝 · 調節 (C §2.4). Every 調節 item and every look is `live: true`.
- **Slider:** the floating `SliderRow` (`Camera.tsx:364-370`) is used unchanged. Slider moves update the live state directly (`setParams` → `CameraLook`) and have no undo, as today.
- **Preview and capture:**
  - The preview uses the shot's crop as its picture frame (§4.5). The vignette is therefore centred on what is saved, not on the full sensor frame that the canvas crops with `object-fit: cover`.
  - Grain moves in the preview (a new seed every frame, §4.4); the capture freezes the grain of its own frame.
- **Persistence:** 調節 and 質感 persist with the rest of the camera look under `meiyan.look.v1` (C §3.7), as 濾鏡 does today. Imports started from the camera look (C §3.7, `flows.ts:32`), so an imported photo also opened with the camera's 調節 and 質感, as with its 濾鏡. Since 2026-10-18 a new photo, imported or a camera shot, opens at 原圖 (C §3.7): the camera keeps its 調節 and 質感 for its own preview and capture. See §11 Q5.
- **Hand-over:** shutter → Review → 編輯 carried `look.photo`, so the editor opened with the same 調節 values and 質感 (C §3.7), re-rendered on the unprocessed crop. Since 2026-10-18 the shot opens at 原圖 (C §3.7): the camera's 調節 and 質感 draw the preview and the capture only.

### 2.4 Copy (new strings)

| Key | 繁體中文 |
|---|---|
| tab | 調節 |
| items | 亮度 · 曝光 · 對比 · 高光 · 陰影 · 色溫 · 色調 · 飽和 · 鮮艷度 · 褪色 · 顆粒 · 暗角 |
| reset item | 原圖 |
| 一鍵 parts | 美顏 / 質感 |
| looks | 無 · 膠片 · CCD · 直閃 · 藍調 · 電影感 |
| slider | 程度 |
| 調節 lead chip | 質感：{label} |
| first touch with ≥ 2 persons (the step-1 template, once per session each) | 調節套用於整張照片 / 質感套用於整張照片 |
| look LUT failed (once per look per session) | 無法載入「{label}」質感，請稍後再試 |
| 調節 program failed to compile (once per session) | 調節效果暫時無法使用 |

Labels that appear twice are accepted, as they are in 醒圖: 調節's 高光 vs 美妝's 高光 (C §2.1), and 濾鏡's 膠片 vs 質感's 膠片 (§3.3, §11 Q2).

### 2.5 Icons

13 new original line icons in `src/ui/icons.tsx` (24 × 24 grid, 1.75 px stroke, the existing style, `icons.tsx:1`). The keys are `brightness`, `exposure`, `contrast`, `highlights`, `shadows`, `temperature`, `tint`, `saturation`, `vibrance`, `fade`, `grain`, `vignette` and `look` (the 質感 part button and the thumbnail fallback). No icon font and no third-party SVG is used.

---

## 3. Architecture and data model

### 3.1 Parameters (`src/types.ts:6-47`, `src/engine/params.ts:4-37`)

`ParamGroup` gains `'adjust'`. Twelve `ParamId`s are added, each with `group: 'adjust'`, `scope: 'photo'` and `live: true` (C §3.1), and with `default` equal to neutral. They sit outside every beauty preset.

| ParamId | Label | Bidirectional | Display | Shader value at the extremes (§4.2) |
|---|---|---|---|---|
| `adjust.brightness` | 亮度 | yes | −50…+50 | mid grey 0.5 → 0.324 / 0.653 |
| `adjust.exposure` | 曝光 | yes | −50…+50 | ±1 EV, highlight shoulder on + |
| `adjust.contrast` | 對比 | yes | −50…+50 | mid slope 0.76 / 1.66, black and white fixed |
| `adjust.highlights` | 高光 | yes | −50…+50 | upper-tone knots ±0.12·weight |
| `adjust.shadows` | 陰影 | yes | −50…+50 | lower-tone knots ±0.12·weight |
| `adjust.temperature` | 色溫 | yes | −50…+50 | R/B gains 2^(±0.30), luminance kept (+ = warmer) |
| `adjust.tint` | 色調 | yes | −50…+50 | G gain 2^(∓0.20) (+ = magenta) |
| `adjust.saturation` | 飽和 | yes | −50…+50 | chroma × 0 (−50 = black and white) … × 2 |
| `adjust.vibrance` | 鮮艷度 | yes | −50…+50 | chroma × (1 ± 0.7·weight), skin guarded |
| `adjust.fade` | 褪色 | no | 0–100 | black → 41/255 at 100 |
| `adjust.grain` | 顆粒 | no | 0–100 | monochrome, peak ±0.08 in the midtones |
| `adjust.vignette` | 暗角 | no | 0–100 | corner gain in linear light 1 → 0.3 (darkens only, C §11 Q8) |

`AdjustId = Extract<ParamId, \`adjust.${string}\`>`. `PhotoParamId` already includes `adjust.*` (C §3.2). The existing helpers carry over unchanged: `displayValue`/`fromDisplay`/`signed` (`params.ts:258-271`), the slider's ±50 snap, and `hasValue`.

### 3.2 Looks (`src/engine/looks.ts`, new; re-exported as `LOOKS` from `params.ts`)

```ts
// src/types.ts (LookId is in C §3.2)
export interface LookDef {
  id: LookId;                      // 'film' | 'ccd' | 'flash' | 'blue' | 'cinema'
  label: string;                   // 膠片 · CCD · 直閃 · 藍調 · 電影感
  /** 程度 when picked from 無 */
  defaultAmount: number;           // 0.8 for every look (§11 Q3)
  /** at 程度 100, in display units (−50…+50 / 0–100); scaled by amount in shader space (§4.3) */
  offsets: Readonly<Partial<Record<AdjustId, number>>>;
}
```

**Definition of a look.** A look L with amount a renders as:

1. `color ← mix(color, LUT_L(color), a)`, right after the 濾鏡 LUT;
2. for every 調節 item i: `e_i ← clamp(u_i + a·o_i)` in shader space (u = the user's value, o = the look's offset);
3. the 調節 stages run on `e`.

Grain, vignette and fade are therefore not separate look features. They are 調節 offsets, so there is one code path, one CPU port and one test list.

`looks.ts` has only `import type` imports, so the Node asset script can import it (§4.6). `gen-luts.mjs` already exports a `LOOKS` of its own (the 濾鏡 grades, `gen-luts.mjs:403`, imported by the t5 tests), so the script imports this table as `import { LOOKS as LOOK_DEFS } from '../src/engine/looks.ts'`.

| Look | LUT character (§4.6 recipe) | Offsets at 程度 100 (C §4.4 starting values) |
|---|---|---|
| **膠片** `film` | Warm-neutral portrait film: soft toe and shoulder, olive greens, slate blues, creamy highlights, skin held. **Not** the 濾鏡 膠片, which has green shadows and a strong matte. | 褪色 30 · 顆粒 35 · 暗角 20 · 對比 −10 · 飽和 −10 · 色溫 +8 |
| **CCD** `ccd` | Early-2000s compact digital: clean cool white balance, cyan shadows, slightly magenta highlights, richer pinks and cyans, skin kept pink | 曝光 +8 · 高光 +15 · 飽和 +12 · 色溫 −10 · 顆粒 15 · 暗角 10 |
| **直閃** `flash` | Direct on-camera flash: neutral-cool, hard curve with deep blacks and a bright shoulder, colours almost neutral, skin held | 曝光 +10 · 對比 +20 · 高光 +20 · 陰影 −15 · 暗角 35 · 顆粒 10 · 色溫 −6 |
| **藍調** `blue` | Blue hour: blue shadows, cyan-blue mids, slightly cool highlights, greens turn teal, warm tones calmer, skin kept out of most of the cast | 色溫 −25 · 色調 −5 · 陰影 +10 · 飽和 −8 · 褪色 10 · 暗角 15 |
| **電影感** `cinema` | Teal and orange: teal shadows, orange highlights, greens and blues pulled to teal, skin and oranges a little richer, mild S-curve | 對比 +12 · 陰影 −10 · 鮮艷度 −10 · 褪色 12 · 顆粒 12 · 暗角 25 |

The tuning loop (§4.6) may change the offsets and the LUT recipes. It must stay within the acceptance tests in §8.2; the tests check behaviour, not the constants.

### 3.3 Interaction with 濾鏡, beauty presets and 重置

| Action | 濾鏡 (`filterId`, `filter.amount`) | 質感 (`photo.look`) | 調節 user values | `presetLink` | Person `preset` |
|---|---|---|---|---|---|
| Apply 原圖／自然／精緻／氣色, or change its 程度 | Set by the preset's photo part (C §3.4) | Unchanged | Unchanged | Set | Set |
| Pick a 濾鏡 or drag 濾鏡強度 | Set | Unchanged | Unchanged | → null | Unchanged |
| Pick a 質感, or drag 質感 程度 | Unchanged | Set | Unchanged | Unchanged | Unchanged |
| Drag a 調節 slider / ⊘ 原圖 in 調節 | Unchanged | Unchanged | Set / neutral | Unchanged | Unchanged |
| 重置 | `neutralPhoto()` (原圖's photo part: no filter; 自然's `defaultPhoto()` until 2026-10-18) | null | Neutral | `{original, 1}` | `original` |

- **濾鏡 and 質感 stack.** The 濾鏡 LUT runs first, then the 質感 LUT, then 調節. Making them exclusive would mean a look changes `filterId`, which breaks `presetLink` and goes against C §3.4 ("a look never changes a beauty preset"). The looks are tuned on `filterId = none`; the presets' filters run at 40 % and are mild, so the stacks stay wearable. §11 Q1 asks whether the user prefers exclusivity.
- **`matchesPreset`** compares the person part only (C §3.4), so a look never turns the preset indicator into 自訂.
- **The two 膠片s:** the 濾鏡 膠片 is a colour-only matte print grade. The 質感 膠片 is a complete look with grain, fade and vignette. The t5 test in §8.2 checks that their thumbnails differ (mean difference ≥ 5/255).

### 3.4 Edit state, lens and panel model

- **`src/edit/state.ts`** (from step 1) gains:
  - `setLook(edit, id: LookId | null, amount)`. An id of null gives `look: null`; the amount is clamped to 0..1.
  - `resetGroup(edit, 'adjust')`: the 12 values become neutral and the look is untouched.
  - `defaultPhoto()` and `neutralPhoto()` (原圖, what a new photo opens with and 重置 returns to, 2026-10-18) already make `adjust.*` neutral and `look: null`.
- **The lens** (C §3.3) already has `setLook` and `resetGroup`. It gains `look(): PhotoParams['look']` for reading. `adjust.*` ids route to `photo` under every selection, as every photo item does.
- **`src/ui/panelModel.ts`** (after the step-1 port to `(lens, sel, ctx)`):
  - `TabId` gains `'adjust'`. `TABS` gains `{id: 'adjust', label: '調節'}` after 美妝 (`panelModel.ts:22-34`); the camera's tab list is the same (it never shows 裁切).
  - `PanelSelection` gains `adjust: AdjustId` (default `'adjust.brightness'`) and `presetPart: 'beauty' | 'look'` (default `'beauty'`) (`panelModel.ts:41-55`).
  - `ItemAction` gains `{type: 'look'; id: LookId | null}` (`panelModel.ts:194-204`). `{type: 'param'}` is reused for 調節, and `reset` on the adjust tab calls `lens.resetGroup('adjust')`.
  - `itemsFor`:
    - `'adjust'`: ⊘ followed by the 12 defs, with dividers after 陰影 and after 鮮艷度. `PanelItem` gains `divider?: 'before'` so that `BeautyPanel` renders the `strip-divider`.
    - `'preset'` with `presetPart: 'look'`: 無 + `LOOKS`.
  - `sliderFor`:
    - `'adjust'`: binds the def, with `track` set for 色溫 and 色調;
    - `'preset'` + `look`: 程度 bound to `look.amount`, default `defaultAmount`; null when no look is set;
    - `'preset'` + `beauty`: today's binding (`panelModel.ts:482-493`).
  - `tabHasValue`: `'adjust'` returns true when any value is non-neutral; `'preset'` returns true when `look ≠ null`.
- **`BeautyPanel.tsx`:**
  - The part row is generalized from `MAKEUP_PARTS` to `partsFor(tab)`, which gives `MAKEUP_PARTS` for 美妝 and `PRESET_PARTS = [{beauty, 美顏, presetGlow}, {look, 質感, look}]` for 一鍵.
  - `stripKey` becomes `preset.<part>` for 一鍵 (`BeautyPanel.tsx:47`).
  - The 質感 lead chip is rendered when `tab === 'adjust' && look`.

### 3.5 Engine API and the LUT cache (`src/engine/index.ts`, `src/types.ts:303-328`)

```ts
type LutKind = 'filter' | 'look';
interface Engine {
  /** kept: loadLut('filter', id) */
  loadFilter(filterId: string): Promise<void>;
  /** make a LUT resident (lazy-loaded on first use); resolves when uploaded; an explicit call retries a failed one */
  loadLut(kind: LutKind, id: string): Promise<void>;
  /** for export readiness: settled = 'ready' | 'failed' */
  lutState(kind: LutKind, id: string): 'none' | 'loading' | 'ready' | 'failed';
}
```

- **Paths:** `filter` → `/luts/filters/<id>.png` (unchanged); `look` → `/luts/looks/look_<id>.png`. Both are validated with `FILTER_ID` and must be 512² (`index.ts:26-28, 136-140`).
- **One cache** replaces `filterTex`, `filterLoads` and `filterFailed` (`index.ts:46-49`). Entries are keyed by `${kind}:${id}`, and `lutFor(kind, id)` generalizes `filterFor` (`index.ts:159-167`).
  - **LRU cap `MAX_RESIDENT_LUTS = 6`** (6 MB of GPU memory). Each frame touches the LUTs it draws with. When a load would exceed the cap, the least recently used texture is deleted, but never one the current frame uses.
  - Today the cache is unbounded: browsing all 8 filters and 5 looks would keep 13 MB resident. That is a real share of an SE-class page budget (about 100 MB before the kill).
  - A context loss clears the cache, as `dropGlState` does today (`index.ts:80-88`).
- **Frame job:** `job()` (`index.ts:174-194`) resolves `filterLut` and `lookLut` and builds `adjust = adjustUniforms(photo, lookDef, lookReady, frame)` (§4.3). `lookReady` is true only when the look's texture is resident. `adjust.on` (any effective value non-neutral, or a drawable look) picks the composite program (§4.1).
- **`still.ts`:**
  - `ensureFilter` becomes `ensureLuts(photo)`, which requests both the filter LUT and the look LUT (`still.ts:143-160, 184-197`);
  - `prepareExport` awaits both (`still.ts:199-226`);
  - `exportReady` returns true only when `lutState` is settled for both (`still.ts:260-266`). It asks the engine, not a local set, because with the LRU an evicted LUT would otherwise count as ready.
  - The corrected-thumbnail path (`Editor.tsx:337-384`) works unchanged for looks.
- **`live.ts`:**
  - `ensureFilter` (`live.ts:242-246`) becomes `ensureLuts(look.photo)`.
  - `draw` and `capture` (`live.ts:176-179, 323-337`) pass `pictureFrame` (the ratio's centre crop) and `grainSeed`.
- **`hooks.ts`:** `useFilterLoader` (`hooks.ts:6-17`) becomes `useLutLoader(engine, photo)`, used at `Editor.tsx:600` and `Camera.tsx:90`.

### 3.6 Files to add and change (anchors at `892ea61`; step-1 files named as in C §3.8)

| File | Change |
|---|---|
| `src/types.ts:6-34, 36-47` | `'adjust'` group, the 12 ids, `AdjustId`, `LookDef` |
| `src/types.ts:276-292` (`RenderInput`, C §4.1) | `pictureFrame?: Rect` (source-uv rectangle that the vignette and the grain lattice treat as the picture V; default `[0,0,1,1]`), `grainSeed?: number` (default 0) |
| `src/types.ts:303-328` | `Engine.loadLut`, `lutState` |
| `src/engine/params.ts:4-37` | 12 `ParamDef`s; `export { LOOKS, lookDef } from './looks'` |
| `src/engine/looks.ts` | **New**: `LOOKS` table (§3.2), `lookDef(id)` (`offsetToShader` moved to `adjustMath.ts` in the v0.4 cleanup, so `effectiveAdjust` uses the tested mapping) |
| `src/engine/adjustMath.ts` | **New**, pure, `import type` only: `ADJUST_K` constants, `offsetToShader(def, d)`, `effectiveAdjust` (adds each look offset through `offsetToShader`), `curveKnots`, `adjustUniforms`, `adjustRgb` (per-pixel reference), `grainAt`, `lowbias32` |
| `src/engine/shaders/adjust.ts` | **New**: `ADJUST_GLSL` (uniform declarations + `adjustStage()`), original work with no GPUPixel header |
| `src/engine/shaders/composite.ts:9-16, 47-59, 61-83, 196-201` | The shader becomes `compositeFs({adjust: boolean})`; `COMPOSITE_FS = compositeFs({adjust: false})` is the step-1 text, unchanged. With `adjust: true` it adds the unit `look: 8`, `uLookLut`, `uLookAmt`, the 質感 LUT block, the `${ADJUST_GLSL}` splice and the `adjustStage` call. Header "Modified" list gains "calls the 調節 stages of adjust.ts after the filter LUT". |
| `src/engine/compositeCpu.ts` | **New**: CPU reference for P5's new stages on an RGBA8 image: a GPUImage lookup port (with the GPUImage attribution, as `composite.ts:17-19`) + `adjustMath.adjustRgb` |
| `src/engine/shaderHash.ts`, `src/engine/passes/reshapeCpu.test.ts:9-17` | **New** home of the existing `shaderHash` (moved, unchanged; the reshape pin keeps its value) |
| `src/engine/pipeline.ts:53-75, 207-226, 442-466` | `FrameJob.adjust`, `lookLut`; the 調節 program created lazily and selected per frame (§4.1); sampler setup shared by both programs; uniform upload; the unbind loop goes from `unit < 8` to `unit < 9` |
| `src/engine/index.ts:26-28, 46-49, 80-88, 122-194, 260-273` | LUT cache with kinds and LRU, `loadLut`, `lutState`, `job()` |
| `src/app/still.ts:38-51, 143-160, 184-266` | `ensureLuts`, `prepare`, `exportReady` |
| `src/app/live.ts:24-32, 176-179, 242-246, 323-337` | `LiveDeps.getFrame(): Rect` (normalized `centerCropRect` of the current ratio), the grain frame counter, `ensureLuts` |
| `src/ui/panelModel.ts`, `BeautyPanel.tsx`, `Slider.tsx`, `theme.css` | §3.4; slider track tints; part row for 一鍵; lead chip; the `.tabs` comment (`theme.css:420-423`) |
| `src/ui/icons.tsx:20` | 13 icons (§2.5) |
| `src/ui/screens/Editor.tsx:600`, `Camera.tsx:90`, `hooks.ts:6-17` | `useLutLoader` |
| `src/ui/screens/Camera.tsx:196-197` | The ratio already used for the crop also feeds `LiveDeps.getFrame` |
| `scripts/gen-luts.mjs:24, 403, 593-603` | `LOOK_IDS`, `LOOK_GRADES` (§4.6), output to `public/luts/looks/`, thumbnails through `adjustMath.ts` |
| `public/luts/looks/look_<id>.png`, `look_<id>_thumb.png` | **New** generated assets (5 + 5) |
| `src/bench/main.ts` | 調節 cost row (§6.4) |
| `src/ui/screens/Settings.tsx:252-253`, `LICENSES/NOTICE.txt:48` | Credits and NOTICE sentences (§4.8) |

### 3.7 Build order inside step 2

Each sub-step ends with `typecheck`, `test`, `build` and `test:e2e` green, plus a local commit (C §1.2).

1. **2a.** `adjustMath.ts`, `looks.ts`, the param defs and their unit tests (pure).
2. **2b.** `ADJUST_GLSL`, `compositeFs({adjust})` and the lazily compiled 調節 program in `pipeline.ts`, `compositeCpu.ts`, the two hash pins, and the `composite.spec.ts` harness.
3. **2c.** Look LUT generation, the assets, the t5 tests and the preview sheet. **Show the sheet to the user before 2e.**
4. **2d.** The engine LUT cache, plus the `still`/`live` wiring (`pictureFrame`, `grainSeed`).
5. **2e.** UI: the 調節 tab, the 一鍵 parts, icons, tints, the chip, and the camera tab.
6. **2f.** `adjust.spec.ts`, the bench row, NOTICE and credits.

---

## 4. Engine and shader changes

### 4.1 Where the stages run (P5 composite)

```
… 磨皮 → 銳化 → 美白 → 紅潤 → 濾鏡 LUT                       (composite.ts:166-199, unchanged)
→ 質感 LUT      if (uLookAmt > 0)  mix(a, lut64(uLookLut, a), uLookAmt)
→ adjustStage     if (uAdjustOn > 0):
    曝光           linear light, gain + shoulder                  if (uExpGain != 1)
    亮度/對比/高光/陰影   one monotone tone curve on encoded luma    if (uCurveOn > 0)
    色溫/色調       linear-light gains                              if (uWbOn > 0)
    飽和/鮮艷度      chroma scale about luma                         if (uSatOn > 0)
    褪色                                                            if (uFade > 0)
    暗角           V-space radial gain                              if (uVig > 0)
    顆粒           V-space value noise                              if (uGrainAmp > 0)
→ outColor
```

This is the order of C §4.2.

- **Two programs from one source.** `compositeFs({adjust: false})` is the step-1 composite text, unchanged (the 質感 block, the splice and the call are inserted only when `adjust` is true). `createPipeline` compiles the base program as today (`pipeline.ts:208`). The 調節 program is compiled the first time a frame has `adjust.on`, the same lazy pattern as the face passes (`pipeline.ts:4`), and kept until dispose or context loss. Each frame uses the 調節 program when `adjust.on`, otherwise the base program. Sampler bindings and the shared uniforms are set by one helper for both programs.
  - Consequences: an app start that never touches 調節 or 質感 compiles exactly what it compiles today, and a neutral frame costs exactly what it costs today.
  - Switching is seamless: every stage is continuous at neutral (§4.2), so a value one step off neutral, drawn by the 調節 program, differs from the base render by at most 1 level (tested, §8.3).
  - The first frame that needs the 調節 program pays one compile and link (measured, §6.4).
  - `PassPlan` gains `adjust` (= `adjust.on`), and the frame's `passes` list gains `'adjust'` when the 調節 program draws, so tests can see which program ran. A neutral frame's `passes` are exactly step 1's.
- **Uniform branches.** Inside the 調節 program every branch tests a uniform, so the whole frame takes the same path and the cost scales with the stages that are on.
- **Texture units:** unit 8 is the look LUT (C §4.3), used by the 調節 program only; a 1×1 white texture is bound when no look is drawn, as for the filter (`pipeline.ts:453`). The 調節 program then uses 9 units; step 4 adds none, because its passes run in O before makeup (skin-cleanup spec A6).
- **Uniforms:** at most 40 vec4 slots, even if every scalar takes a slot of its own (`uCurve[9]` as `vec2` plus about 25 scalars). WebGL2 guarantees 224 fragment uniform vectors.
- **Constants live in TypeScript.** Every tunable constant is in `ADJUST_K` (`adjustMath.ts`). The shader receives derived values (gains, knots, amplitudes), so tuning a look or a constant never touches the shader text, and the hash pins do not move.

### 4.2 Stage maths

Notation: `c` is the encoded sRGB colour (0..1) after the LUTs, clamped on entry to `adjustStage`. `Y = dot(c, L709)` with `L709 = (0.2126, 0.7152, 0.0722)` is encoded luma. `lin()` and `enc()` are the exact IEC 61966-2-1 sRGB transfer functions. Bidirectional effective values s ∈ [−1, 1]; one-way values v ∈ [0, 1].

**Hue-safe luma change** (used by the tone curve): it moves luma from Y to Y′ without changing hue and without leaving the gamut.

```
toLuma(c, Y, Y′) = Y′ ≤ Y ? c · (Y′ / max(Y, 1e-5))
                          : 1 − (1 − c) · ((1 − Y′) / max(1 − Y, 1e-5))
```

**曝光** (s_e):
- `x = lin(c) · 2^(s_e)` per channel, that is ±1 EV.
- For s_e > 0 a shoulder maps the new white `Lw = 2^(s_e)` back to 1. With knee k = 0.75 and a = (Lw − k)/(1 − k), values x > k become `k + (1 − k)·(1 − (1 − min(1, (x − k)/(Lw − k)))^a)`.
- This is C¹ at the knee and the identity at s_e = 0, so there is no jump when the slider leaves 0.
- For s_e < 0 there is no shoulder.
- Output: `c = enc(x)`.

**Tone curve** (亮度 s_b, 對比 s_c, 高光 s_h, 陰影 s_s). One monotone cubic through 9 knots, x_i = i/8, built on the CPU (`curveKnots`) and evaluated in the shader:

1. 亮度: `y = x^(2^(−0.7·s_b))`, a gamma that keeps black and white fixed.
2. 對比:
   - s_c > 0: K = 6·s_c and `y ← (σ(K(y − ½)) − σ(−K/2)) / (σ(K/2) − σ(−K/2))`;
   - s_c < 0: K = 4·|s_c| and the inverse of that normalized sigmoid;
   - |s_c| < 1e-3: skipped.
3. 陰影 and 高光: `y_i += 0.12·(s_s·W_S[i] + s_h·W_H[i])` with
   - `W_S = [0, .70, .75, .45, .20, .05, 0, 0, 0]`
   - `W_H = [0, 0, 0, .05, .20, .45, .75, .70, 0]`

   Black and white stay fixed; 曝光 moves white.
4. Clamp to [0, 1], then force the knots non-decreasing (`y_i = max(y_i, y_{i−1})`).
5. Fritsch–Carlson tangents m_i, the same algorithm as `gen-luts.mjs:75-113`, ported to TS.

In the shader: `t = Y·8`, `i = min(floor(t), 7)`, `f = t − i`; cubic Hermite on `(y_i, y_{i+1}, m_i/8, m_{i+1}/8, f)` gives Y′; then `c = toLuma(c, Y, Y′)`. The curve runs on luma, so skin hue does not shift with contrast. Saturation is the user's to set with 飽和.

**色溫／色調** (s_t, s_n):
- `g = (2^(0.30·s_t + 0.10·s_n), 2^(−0.20·s_n), 2^(−0.30·s_t + 0.10·s_n))`, then `g /= dot(g, L709)`, so a neutral grey keeps its luminance.
- `c = enc(clamp(lin(c) · g, 0, 1))`.
- A positive 色溫 is warmer; a positive 色調 is magenta (the Lightroom and 醒圖 directions).

**飽和／鮮艷度** (s_σ, s_ν):
- S = (max − min)/max(max, 1e-5) is the HSV saturation of c, and h its HSV hue.
- `skin = win(h; 0.07, 0.07) · smoothstep(0.08, 0.20, S) · (1 − smoothstep(0.60, 0.80, S)) · smoothstep(0.15, 0.35, max)`. Here `win` is a raised-cosine hue window: centre 25°, half-width 25°, circular distance.
- `k = (1 + s_σ) · (1 + 0.7·s_ν·w_ν)` with
  - `w_ν = (1 − S)(1 − 0.6·skin)` for s_ν > 0: muted colours gain most, skin is guarded;
  - `w_ν = 1 − 0.6·skin` for s_ν < 0.
- If k > 1: `k = 1 + (k − 1)·(1 − smoothstep(0.6, 0.95, S))`, the gamut taper used by `gen-luts.mjs:174-179`.
- `c = clamp(Y + (c − Y)·k)`.

**褪色** (v_f): `c = 0.16·v_f + c·(1 − 0.20·v_f)`, then `c = Y′ + (c − Y′)·(1 − 0.1·v_f)` with Y′ the luma of the faded colour.

**暗角** (v_g, darkens only):
- `q = (V − ½)·(A, 1) / |(A/2, ½)|`, with V the V-space uv (§4.5) and A the frame's aspect (width/height). `r = |q|` is 1 at the corners and circular in the image.
- The linear-light gain is `m = 1 − 0.7·v_g·smoothstep(0.4, 1.0, r)`. It is applied in encoded space as `c ·= m^(1/2.2)` (one scalar pow per pixel).

**顆粒** (v_n): see §4.4.

### 4.3 Effective values (user + look)

```
lookOn  = look ≠ null && lookReady           // all-or-nothing (§1.4)
a       = lookOn ? look.amount : 0
bidirectional: s_i = clamp((u_i − 0.5)·2 + a·o_i/50, −1, 1)
one-way:       v_i = clamp(u_i + a·o_i/100, 0, 1)
uLookAmt = a                                 // the LUT mix
uAdjustOn  = any effective value non-neutral (|s| > 1e-4, v > 1e-4)
adjust.on  = uAdjustOn || a > 0               // picks the 調節 program (§4.1)
```

- Sliders and the dots (`adjustItemActive`) read the user's value `u_i` only.
- `adjustUniforms` is memoized on `(user values, look id, amount, lookReady, uVMap, grain scale)`. During a drag it rebuilds 9 knots, which takes microseconds.
- With a look on, a one-way item (褪色, 顆粒, 暗角) can only be raised above the look's own amount, never lowered below it; only 程度 lowers it, together with the rest of the look. This follows from C §3.4 (sliders show the user's value, the look adds on top); §11 Q6 asks the user about it.

### 4.4 Grain (deterministic, tile-independent)

- **Cell size** (C §3.5, §4.4): `cellPx = fullShortEdge/1080` output pixels, where `fullShortEdge` is the short edge of the photo O in output pixels. That is 1 px at the camera's tier H, 1.42 px in a 2048 × 1536 editor preview, and 2.8 px in a 4032 × 3024 export, so the grain has the same size relative to the scene at every resolution.
  - In step 2 every render covers the whole O, so `job()` takes `fullShortEdge` as the short edge of the processing size (`processingSize`, `uniforms.ts:18-26`). In the editor, O = V = the working photo; in the camera, O is the video frame (the canvas at the tier, or the full frame at capture) and V its ratio crop. Step 3's `output.fullShortEdge` replaces this value for crops and tiles.
  - In step 3, cropping does not change `cellPx`: a tight crop shows the grain at the same scale relative to the scene, like an enlarged negative.
- **Lattice.** `P = V · uGrainScale` with `uGrainScale = (V width, V height in output px) / cellPx`, computed on the CPU. V is the global picture coordinate (§4.5), so the lattice never depends on the tile or the canvas size.
- **Value.** Bilinear interpolation of lattice values `n(ix, iy) = lowbias32(ix ^ rowHash(iy)) >> 8`, mapped to [−1, 1), with `rowHash(iy) = lowbias32(iy ^ seedMix)`. That is 6 hashes per pixel: 2 row hashes and 4 lattice hashes.
  - `seedMix = lowbias32(seed + 0x9e3779b9)` is computed on the CPU.
  - `lowbias32` is the xorshift-multiply integer finalizer (`x ^= x >> 16; x *= 0x7feb352d; x ^= x >> 15; x *= 0x846ca68b; x ^= x >> 16`, §4.8).
  - The arithmetic is `highp uint` in GLSL ES 3.00 (wrapping is defined) and `Math.imul(…) >>> 0` in the port, so the hash is bit-exact on both. Negative lattice indices (outside the camera's frame) convert with `uint(int(…))`, which keeps the bit pattern, and `>>> 0` in the port.
  - **Variance normalization.** A bilinear blend of independent values has a variance that depends on where the pixel falls inside its cell: at the cell centre it is ¼ of the variance at a lattice point. Without a correction, a cell of exactly 1 px (every pixel at a cell centre) would carry about 25 % less grain than a 2.8 px cell, and a 1.42 px cell would show a faint periodic pattern. The blend is therefore divided by `sqrt(((1 − fx)² + fx²)·((1 − fy)² + fy²))` (fx, fy = the fractional position), so every pixel has the same variance whatever the cell size and alignment.
- **Amount.** `c += n · 0.08·v_n · (0.3 + 0.7·4Y(1 − Y)) · min(1, cellPx)`, monochrome, then clamp.
  - The last factor damps grain when a cell is smaller than a pixel (camera tiers M and L), because point sampling cannot average sub-pixel cells. It approximates the averaging a viewer's eye does over 1/cellPx cells per pixel, so a tier-M preview and its full-resolution capture read alike on screen.
- **Seed.** The editor, its export and history thumbnails use seed 0, which is deterministic. The camera passes a frame counter, so the grain moves (§11 Q4). A capture uses its frame's seed.
- **Tiles.** The lattice is indexed by global V coordinates. A tile therefore gets exactly the noise of the same region of the whole image (tested on the CPU port in step 2, and on the GPU in step 3's `crop.spec.ts`).

### 4.5 The picture frame (`pictureFrame` → `uVMap`)

Vignette and grain need to know which rectangle is "the picture". The shader takes an affine `uVMap` (V = vUv·uVMap.xy + uVMap.zw), plus `uVAspect` (the vignette's aspect) and `uGrainScale` (§4.4). `vUv` is the source coordinate; the present step mirrors only clip space (`present.ts:6-13`), so a mirrored camera preview needs no special case: the vignette is symmetric and the grain stays attached to the frame.

- **Editor (step 2):** the identity. V is the whole photo.
- **Camera:** `pictureFrame` is the normalized `centerCropRect` of the current ratio (`imaging.ts:12`, the crop the shutter applies at `Camera.tsx:196-197`). The preview's vignette is then centred on the saved 3:4, 1:1 or 9:16 frame, and the capture matches the preview. Outside the frame (never shown) r > 1, and the gain stays at its corner value.
- **Step 3:** V becomes the crop window (C §3.5). A tile sets `uVMap` from `output.tile`, and `uGrainScale` from the whole V size in output pixels (`output.pixelSize / output.tile.wh`) and `fullShortEdge`. No shader change is needed, because the uniforms already exist.

### 4.6 Look LUTs and thumbnails (`scripts/gen-luts.mjs`)

**Generation:**
- New exports `LOOK_IDS = ['film', 'ccd', 'flash', 'blue', 'cinema']` and `LOOK_GRADES` (one transform per look, built only from the script's existing primitives: `whiteBalance`, `curve`, `chroma`, `tone`, `holdSkin`, `labToSrgb`).
- `main()` writes `public/luts/looks/look_<id>.png` (512², the GPUImage 64³ layout, opaque RGB, no colour chunks: `encodePng`).
- The existing `FILTER_IDS`/`LOOKS` exports stay as they are, because the t5 tests import them.

**Starting recipes.** Hue bands are OKLab degrees, as in the filters. The tuning loop may adjust them.

| Look | Recipe |
|---|---|
| film | WB [1.04, 1, 0.93] · curve [0,.03] [.25,.27] [.5,.53] [.75,.77] [1,.97] · chroma sat .9, skinSat 1, bands {140°±55 sat .7 shift −22}, {250°±50 sat .8 shift −12}, {75°±40 sat 1.08} · tone shadows [.004,.006] mids [.006,.014] highlights [.006,.024] skinKeep .5 · holdSkin k .6 chroma 1.04 |
| ccd | WB [0.95, 1, 1.07] 'max' · curve [0,0] [.25,.24] [.5,.52] [.75,.8] [1,1] · chroma sat 1.08, skinSat 1, bands {0°±35 sat 1.15 shift −6}, {200°±50 sat 1.1 shift −10}, {140°±50 shift +12} · tone shadows [−.018,−.022] highlights [.014,−.006] skinKeep .6 · holdSkin k .7 hueShift −6 |
| flash | WB [0.98, 1, 1.03] 'max' · curve [0,0] [.15,.11] [.5,.5] [.85,.9] [1,1] · chroma sat .94, skinSat 1.02 · tone shadows [−.004,−.008] highlights [.002,.004] skinKeep .8 · holdSkin k .8 |
| blue | curve [0,.02] [.25,.25] [.5,.51] [.75,.76] [1,.98] · chroma sat .92, skinSat .95, bands {140°±55 sat .8 shift +30}, {60°±35 sat .8} · tone shadows [−.012,−.04] mids [−.012,−.02] highlights [−.006,−.006] skinKeep .65 · holdSkin k .5 hueShift −6 chroma .9 |
| cinema | curve [0,.02] [.2,.18] [.5,.5] [.8,.83] [1,.98] · chroma sat .95, skinSat 1.04, bands {140°±60 sat .75 shift +45}, {250°±45 sat .9 shift −18}, {60°±30 sat 1.06} · tone shadows [−.026,−.022] highlights [.012,.03] skinKeep .55 · holdSkin k .6 chroma 1.05 |

**Thumbnails** (`look_<id>_thumb.png`, 96²):
- Each is the existing synthetic swatch (`drawSwatch`, `gen-luts.mjs:556-578`) graded by the full look at `defaultAmount`: `applyLut` and then `adjustRgb` with the look's offsets.
- `gen-luts.mjs` imports `src/engine/adjustMath.ts` and `src/engine/looks.ts` directly. Node ≥ 22.18 strips types, and the repository's Node is v24. Both modules have only `import type` imports, which a unit test enforces.
- At 96 px the 1080-cell grain would average away, so the thumbnails draw grain at the thumbnail's own pixel grid (cellPx = 1) with amplitude × 0.6. This is a thumbnail-only option of `adjustRgb`.

**Tuning loop:**
- `node tests/harness/t5/preview-looks.mjs` writes `tests/harness/t5/previews/looks.png` (gitignored): `sample_face.png`, the swatch and the gradient chart, each at 程度 50, 80 and 100 for every look, next to the 濾鏡 膠片.
- The user reviews this sheet in 2c (§3.7). Constants then move in `ADJUST_K`, `LOOKS` and the recipes until the sheet is approved and §8.2 is green.

### 4.7 CPU port and hash pin

- `compositeCpu.ts` applies the 質感 LUT (a GPUImage `lut64` port) and `adjustRgb` per pixel to an RGBA8 image whose skin stages are neutral and whose filter is 無. That is exactly P5's input, so GPU and CPU start from the same 8-bit values.
- `compositeCpu.test.ts` pins two hashes with `shaderHash`, the FNV-1a over the whitespace-collapsed text from `src/engine/passes/reshapeCpu.test.ts:9-17`, moved unchanged to `src/engine/shaderHash.ts` so both pin tests import it:
  - `compositeFs({adjust: true})`, the whole 調節 program, as C §8.2 asks. Any edit of the composite must be mirrored in `compositeCpu.ts` / `adjustMath.ts` where it touches ported stages, and then the pin is updated. Steps 3 and 4 change only the uniforms fed to the composite, not its text (crop spec §3.8, skin-cleanup spec A6), so both pins stay as step 2 sets them (C §8.2).
  - `compositeFs({adjust: false})`, equal to the hash of the composite as step 1 left it. This proves that step 2 does not change the neutral path.
- A splice assertion: the 調節 program contains `ADJUST_GLSL` and calls `adjustStage(` exactly once, after the filter block; the base program contains neither `uLookLut` nor `adjustStage`. Moving the stage then fails a test rather than only changing pixels.

### 4.8 LUT and asset licensing

- **Look LUTs and thumbnails** are original work, computed by our own code in `gen-luts.mjs` from colour maths (OKLab, our own curves and toning) and our own synthetic swatch.
  - No third-party LUT, `.cube` or `.3dl` file, film-stock profile, camera profile, app preset or SDK bitmap is used, fetched or sampled.
  - The looks are **not** calibrated against 醒圖, Hypic or camera output images. Only the generic look themes come from the public version notes (XE).
- **Names** are generic photographic terms: 膠片, CCD (a sensor type), 直閃, 藍調, 電影感. No product or brand name is used: no 佳能, 理光 GR, 富士, Kodak or Portra in ids, labels or comments.
- **The 調節 maths** uses textbook formulas: the IEC 61966-2-1 sRGB transfer, Rec. 709 luma weights, the logistic sigmoid, and Fritsch–Carlson 1980 monotone cubic interpolation. It is written for this project in a new file (`shaders/adjust.ts`) **without** the GPUPixel header, so the Apache-2.0 derivation note in `composite.ts:1-16` does not ambiguously cover it. `composite.ts`'s "Modified:" list gains one line naming the splice and the call.
- **The grain hash** uses the `lowbias32` finalizer constants published in Chris Wellons' hash-prospector, which is dedicated to the public domain (Unlicense). The code is our own. A courtesy line goes into NOTICE.
- **The GPUImage lookup port** in `compositeCpu.ts` carries the same GPUImage BSD-3 attribution as `composite.ts:17-19`. No new license file is needed.
- **NOTICE** (`LICENSES/NOTICE.txt:48`) becomes: "Original to this project: the filter LUTs, the 質感 look LUTs and thumbnails, makeup shade colours and the icons." It also gets the hash-prospector courtesy line.
- **Credits:** the sentence at `Settings.tsx:252-253` becomes 「濾鏡與質感 LUT、色號與圖示為本專案原創」.
- No new npm dependency and no new fixture file are added: the e2e chart is generated in code (§8.3).

---

## 5. Persistence and migration

- **Editor:** the 12 values live in `EditState.photo.values` and the look in `photo.look` (C §3.2). They are stored with the v2 history entry as they are (C §5.1), and add under 200 bytes per entry. `editKey` covers them, so the encode de-dupe and the autosave re-arm on every change (C §3.4).
- **Camera:** `CameraLook.photo` holds the same fields, as JSON under `meiyan.look.v1` (C §3.7). Writes are debounced, as today (`state.ts:93-108`).
- **Sanitize** (`sanitizeEditState` and the camera-look reader):
  - each `adjust.*` value: finite → clamp01; missing or invalid → neutral;
  - `look`: kept only if `id ∈ LOOK_IDS` and `amount` is finite (clamped to 0..1), otherwise null.
- **Migration:** v1 history entries and `meiyan.params.v1` have no 調節 or look. `splitLegacy` gives neutral values and `look: null` through `defaultPhoto()`, so old photos render exactly as before (C §5.2).
- **Rollback to 0.3:** the legacy `params` projection (C §5.1) has no 調節 or 質感. A 0.3 build shows the photo without them, and nothing breaks.
- **Undo:** each slider commit, look pick, 無, 程度 commit and ⊘ is one step. Part and tab changes are not steps (C §3.4).

---

## 6. Performance budget and measurements

### 6.1 Live loop

| Item | Estimate (to be measured) | Budget |
|---|---|---|
| Work added per pixel, every stage on | About 15 pow/exp2 + about 190 ALU + 6 integer hashes + 1 inversesqrt + 2 bilinear LUT taps | — |
| Tier H, 1080 × 1920 (9:16, the largest live frame) | About 0.5 G ops/frame: about 0.5–0.8 ms on an A15-class GPU, about 1–1.5 ms on A13 (SE 2nd gen) | **≤ 1.5 ms** added on the test iPhone; ≥ 24 fps with 3 faces + 調節 (C §6.1) |
| Typical look (5–7 stages on) | About 60 % of the above | — |
| Neutral 調節, no look | 0: the base program runs, unchanged (§4.1) | 0 |
| First frame with 調節 or a look | One compile and link of the 調節 program | ≤ 50 ms on the test iPhone (§6.4) |
| CPU per frame | `adjustUniforms` memoized; about 20 uniform floats uploaded | ≤ 0.05 ms |
| Look LUT first use | PNG decode + 1 MB upload, about 20–60 ms, off the frame path; the frame draws without the look until resident | ≤ 60 ms; precached, so no network |

No pass, FBO, readback or resample is added. The stages run inside the composite draw that already runs every frame.

**Fallbacks**, in order:
1. The existing AutoTier (`liveCore.ts:10-16`). GPU back-pressure shows up as skipped frames, which `frameCost` charges (`liveCore.ts:125-133`), so a too-slow look lowers the tier on its own.
2. Only if the bench measures more than **3 ms** added at tier H on the test iPhone: an `ADJUST_FAST` define for the live 調節 program. It replaces the exact sRGB transfer with `pow(x, 2.2)` / `pow(x, 1/2.2)` and the bilinear grain with one lattice tap. The CPU port gets the same switch, and both variants are hash-pinned. This variant is written only if the measurement calls for it, the same rule C §4.3 uses for the UBO fallback.
3. Only if the 調節 program's compile exceeds **50 ms** on the test iPhone: the editor and the camera pre-warm it (`engine.prewarm('adjust')`) when the 調節 tab or the 質感 part is first opened, so the hitch moves off the first drag. Written only if measured.

### 6.2 Editor and export

- **2048 × 1536 preview, every stage on:** about 3.1 MP, so about 1–2 ms more per slider frame, within C's ≤ 33 ms frame.
- **Export:** the same stages at export size. Step 3's 12 MP tiled export adds about 4× that GPU time in total, which is negligible next to decode and encode.
- **Memory:**
  - resident look LUT: 1 MB each, under the LRU cap of 6 LUT textures total (≤ 6 MB, against today's unbounded filter cache);
  - no new full-size buffer;
  - new resident memory in C §6.1's terms: ≤ 1 MB per look in use.
- **Shader:** the base program is unchanged, so startup compile time does not move. The 調節 program is about 120 lines longer and is compiled once, on first need (§4.1); its compile time is measured (§6.4).

### 6.3 Download and precache

- 5 LUTs at about 170 KB (the filter LUTs are 144–180 KB) plus 5 thumbnails at about 7 KB come to **about 0.9 MB** of precache.
- Workbox already precaches `**/*.png` (`vite.config.ts:110`), and `/luts/` is not in `globIgnores`, so no config change is needed.

### 6.4 Measurements (step 2)

**Bench row 「調節」 in `src/bench/main.ts`:**
- Frame: the camera frame at tier H, plus a synthetic 1080 × 1920 bitmap.
- Configurations: (a) neutral (base program); (b) + all 12 調節 items at ±40; (c) + each look at 0.8.
- Timing: 30 renders each, every one followed by a 1 × 1 `readPixels` to force GPU completion. The median is reported, because `renderMs` measures CPU issue time only.
- The row also reports the compile-and-link time of the 調節 program (first use, cold) and checks the GPU grain hash against the CPU port (a bit-exact probe of the lattice values).
- **As built (v0.4 cleanup).** `runAdjustBench(video)` times the synthetic bitmap as a still, and the live camera frame at tier H as the live loop draws it (not a still: the tier's short edge, the video uploaded every frame) when 開始 has the camera live; on the start screen the row says 「相機 H：未開相機」 instead (the 調節效能 button sits on the gate and, after 開始, in the panel; the live loop pauses while it runs). The compile is timed on its own: `compileAdjustMs` builds the 調節 program on a fresh context before any engine of the run does (`createProgram` waits for `LINK_STATUS`), cold for the page, though the browser's program cache may hold it from an earlier visit. The first 調節 frame's overhead over its median is reported apart as 首幀額外, per source. The old figure, (first frame − median), was that overhead, not the compile: on desktop Chromium (ANGLE D3D11) the direct compile is 82.6–83.4 ms on both an Intel UHD 770 and an RTX 4070, while 首幀額外 reads 2.7–4.1 ms; on SwiftShader it is the reverse (compile 4.0 ms, first frame 40 ms, since SwiftShader builds its code at the first draw). Rows on the UHD 770: synthetic 1080 × 1920 neutral 7.1 ms, 調節 ×12 13.3 ms; the camera (Playwright's fake 1280 × 720 stream, which tier H does not upscale) neutral 2.6 ms, 調節 ×12 5.1 ms. On the RTX 4070: 4.8 / 4.7 ms and 0.5 / 0.5–0.6 ms. The > 50 ms pre-warm rule is for the iPhone's number, which needs the preview deploy (C §6.2).

**Where:**
- desktop Chromium now (Playwright `bench.spec.ts` gains a smoke check that the row runs);
- the user's iPhone through `/bench.html`. That needs a preview deploy, which happens **only with the user's go-ahead** (C §6.2).

**Decisions:** (b) − (a) ≤ 1.5 ms → ship as specified. 1.5–3 ms → ship, relying on AutoTier. > 3 ms → `ADJUST_FAST` in the camera. Compile > 50 ms → pre-warm (§6.1 fallback 3).

---

## 7. Error and edge cases

| Case | Handling |
|---|---|
| Look LUT still loading | The look is drawn neither in part nor in full (§1.4). A camera frame shows it as soon as it is resident. An export waits through `prepareExport`; a history flush writes a corrected thumbnail later (`Editor.tsx:337-384`). |
| Look LUT failed (offline before precache, corrupt file) | `lutState = 'failed'`. The toast 「無法載入「{label}」質感，請稍後再試」 is shown once per look per session. The look stays selected and saved, but is not drawn (all-or-nothing, so its offsets are not drawn either). Tapping the selected look again calls `loadLut` explicitly, which retries; it is not an undo step (§2.2). An export proceeds without it, as with a failed 濾鏡. `prepareExport` also asks again (`loadLut` retries a failed LUT): when that load works, the export carries the look and the still preview redraws with it, so the file and the screen agree (step-2 review). |
| Look LUT load cut by a WebGL context loss | Not the LUT's failure: the engine drops the entry (no `'failed'` mark) and the restored context loads it again (the still session's `onRestored`, the live loop's next frame). `requestLut` shows no toast and does not spend the once-per-look notice while `engine.lost` or when the state is not `'failed'` after the rejection (step-2 review). |
| First frame with 調節 or a look | The 調節 program is compiled and linked synchronously in that frame (§4.1): a one-time hitch per page session, measured in §6.4. A compile or link failure is logged, the base program keeps drawing (the look and 調節 are not shown, in the preview and in exports alike), the toast 「調節效果暫時無法使用」 appears once, and the compile is not retried until the next context restore. |
| Camera on a landscape stream (desktop webcam, the e2e fake camera) | The saved crop keeps less than the frame's short edge, so the editor's O (the crop) is smaller than the camera's O and its grain cells are proportionally smaller. On iPhone portrait streams (1080 × 1920) the three ratios keep the full short edge, so preview, capture and editor match. |
| WebGL context loss and restore | The LUT cache is dropped and reloaded on demand (`index.ts:80-111`). `still`/`live` re-request both LUTs (`still.ts:184-197`). |
| User value + look offset out of range | Clamped per item in shader space (§4.3). The slider still shows the user's value. |
| Extreme combinations (對比 +50, 陰影 −50, 曝光 −50) | The knots are forced monotone and every stage clamps, so there are no NaNs or inversions (fuzz test §8.1). |
| Banding on smooth 8-bit gradients under strong curves | Accepted; the source is 8-bit. Grain, when on, hides it. No hidden dithering is added (it would break neutral parity and add noise users did not ask for). |
| 黑白 濾鏡 + a 質感 | The stack gives a toned monochrome. Allowed, and visible in the thumbnail strip as the user explores. |
| Camera ratio change or flip | `getFrame()` is read every frame. The vignette follows the new crop at once. The grain counter keeps running. |
| Shot → 編輯 (mirrored or not) | Since 2026-10-18 the shot opens at 原圖, without the camera's 調節 and 質感 (C §3.7). Before, the vignette landed in the same place (symmetric, §2.3) and the editor re-rendered the grain with seed 0. |
| 基本模式 (no face model) | 調節 and 質感 work. `faceNote` never dims 調節 or 一鍵 › 質感. |
| 按住對比 | `renderOriginal`: no 調節 and no 質感, as for every other effect. |
| A history entry written by 0.4 opened by 0.3 | The legacy projection carries no 調節 or 質感 (§5). |

---

## 8. Testing

### 8.1 Unit tests (Vitest)

- **`src/engine/adjustMath.test.ts`**
  - **Neutral:**
    - with every value neutral and no look, `uAdjustOn = false`;
    - forcing `adjustRgb` on with neutral values is the identity on a 17³ colour grid (exact).
  - **Each item moves the right thing** on colour ramps, at ±max:
    - 亮度: mid-grey luma rises / falls; black and white are fixed.
    - 曝光: +50 doubles linear 18 % grey (± 1 %); white ≤ 1; `|f(s = 0.001) − x| < 0.002` (no jump off 0); −50 halves linear grey.
    - 對比: + widens the 10–90 % luma spread and keeps 0.5 fixed; − narrows it.
    - 高光: moves Y > 0.6 at least 4× more than Y < 0.3. 陰影: the reverse.
    - 色溫: + raises the R/B ratio of grey and keeps its luminance within 1 %. 色調: + lowers G/(R + B) of grey.
    - 飽和: −50 gives zero chroma; +50 does not clip a 70 %-saturated colour.
    - 鮮艷度: + raises a low-chroma blue more than a high-chroma red; it raises a skin patch less than 40 % of what a non-skin hue of equal chroma gains.
    - 褪色: 100 maps black → 41 ± 1 and white → 245 ± 1 (/255).
    - 暗角: 100 multiplies the encoded corner colour by 0.3^(1/2.2) ± 0.5 % (the linear gain of 0.3 applied through the 2.2 approximation of §4.2) and the centre by 1; symmetric; follows the frame aspect.
  - **Curve fuzz:** 2000 random (亮度, 對比, 高光, 陰影) quadruples. The knots are non-decreasing, f(0) = 0 and f(1) = 1, and 1000 Hermite samples are monotone, finite and in [0, 1].
  - **Grain:**
    - mean within ±0.002;
    - std proportional to 顆粒 (within 5 %);
    - the per-pixel std is the same within 5 % at `cellPx` 1, 1.42 and 2.8, and does not vary periodically across a 1.42 px lattice (variance normalization, §4.4);
    - deterministic for a given seed; a different seed gives a different pattern (correlation < 0.1);
    - a 64 × 64 region evaluated through two different `uVMap` windows (two tiles of one image) is equal within 1e-6 (tile independence);
    - `cellPx` follows `fullShortEdge`, and the damping factor applies below 1 px per cell;
    - `lowbias32` matches known vectors, including negative lattice indices.
  - **Effective values:** user + a·offset with clamping; `lookReady = false` ignores the look entirely; amount 0 gives neutral output; `adjust.on` is false exactly when every effective value is neutral and no look is drawn.
  - **Import hygiene:** the module has no runtime `import` (regex over the source), so `gen-luts.mjs` can load it.
- **`src/engine/looks.test.ts`:** 5 unique ids and labels; offsets use only `AdjustId`s and stay within display range; `defaultAmount` is 0.8. `adjustMath.test.ts` checks that `offsetToShader` round-trips and that `effectiveAdjust` adds exactly `offsetToShader(amount · offset)` for every look and item (v0.4 cleanup).
- **`src/engine/params.test.ts`:**
  - 12 adjust defs: group `adjust`, scope `photo`, `live: true`, neutral default;
  - no `PRESETS` entry changes an adjust value or the look (C §3.4);
  - the scope-table test (C §3.1) includes them.
- **`src/edit/*.test.ts`** (step-1 files):
  - `setLook` / `resetGroup('adjust')` / 重置;
  - the lens routes `adjust.*` to `photo` under `person` and `all`;
  - `sanitizeEditState` (invalid look id → null, NaN → neutral);
  - `editKey` changes with every adjust value and with the look's id and amount.
- **`src/ui/panelModel.test.ts`:**
  - 調節 items: order, dividers, dots, ⊘ no-op when neutral, slider bindings (bidirectional flags, `track` for 色溫 and 色調);
  - 一鍵 parts: 質感 items have exactly one selected; picking from 無 gives 0.8; hopping keeps 程度; re-tapping is a no-op, except on a failed look, where it asks for a retry without changing the edit; no slider for 無;
  - `tabHasValue('adjust')` and `('preset')`;
  - the lead chip appears only with a look;
  - the step-1 first-touch toast gets the label 調節 for every 調節 item and 質感 for every look, once each per session.
- **`src/engine/pipeline.test.ts`:** `planPasses` gains `adjust`, true exactly when the frame's `adjust.on` is; every existing case keeps its plan.
- **`src/engine/compositeCpu.test.ts`:** the two hash pins and the splice assertions (§4.7).
- **`src/engine/index.test.ts`:**
  - `loadLut` kinds, the key `${kind}:${id}`, and that `film` and `film` stay separate;
  - LRU eviction at 7, which never evicts the current frame's LUTs;
  - `lutState` transitions; failed + explicit retry; the cache is cleared on loss.
- **`src/app/still.test.ts`:** `exportReady` is false until the look LUT has settled; `prepareExport` loads both LUTs; an evicted LUT turns `exportReady` false again.
- **`src/app/live.test.ts`:**
  - `grainSeed` advances once per drawn frame and not on `redraw`;
  - `capture` uses the current seed;
  - `pictureFrame` equals the normalized `centerCropRect` for each ratio.
- **`src/store/settings.test.ts`** and **`history.test.ts`:** `meiyan.params.v1` → neutral 調節 and `look: null`; a v2 entry round-trips the adjust values and the look.

### 8.2 Generated assets (`tests/harness/t5/assets.test.mjs`, run by `npm test`)

For each look, the same checks the filters get today (`assets.test.mjs:100-128`), plus a few more:
- the LUT is a 512² opaque RGB PNG with only `IHDR`/`IEND` besides `IDAT`;
- it matches the generator byte for byte;
- `lutStats`: `maxStep ≤ 36` and a monotone grey axis;
- its thumbnail differs from `none_thumb.png` (mean ≥ 4/255);
- the five look thumbnails are mutually distinct (mean ≥ 5);
- **every look thumbnail differs from every filter thumbnail by mean ≥ 5**, which also covers 膠片 vs 膠片;
- **skin stays skin-like under the full look** at `defaultAmount` (LUT + offsets through `adjustRgb`): on the 7 skin patches of `assets.test.mjs:146-154`, the OKLab hue stays in 20°–75°, chroma in 0.02–0.12, and L ≥ input L − 0.06;
- the thumbnails match the generator exactly (`gen-luts.mjs` and the test both call `adjustRgb`).

### 8.3 E2E (Playwright, Chromium)

- **`tests/e2e/composite.spec.ts` + `tests/e2e/pages/composite.{html,ts}`** (new engine harness, C §8.2):
  - **Inputs:** a test chart generated in the page (grey ramp, hue sweep at three saturations, the 7 skin patches, a flat mid-grey block for grain statistics) and `sample_face.png`. Skin stages are neutral and the filter is 無, so the composite input is the source itself.
  - **Cases:** each 調節 item at −max and +max, each look at 1.0, every item together, and a grain-only case.
  - **Tolerances, GPU vs `compositeCpu`:**
    - ALU-only cases: max ≤ 1 level and mean ≤ 0.25;
    - look cases: mean ≤ 1 level (GPU bilinear LUT precision, as `engine.spec.ts:147-165` accepts < 2 for 黑白);
    - grain-only: the 99.9th percentile ≤ 1 level (cell-boundary rounding).
  - **Neutral:** with every 調節 item neutral and no look, `passes` has no `'adjust'`: the base program drew, whose pixels the `parity.spec.ts` goldens already cover.
  - **No jump at the switch:** 亮度 at +1 and 曝光 at +1 display unit (set programmatically, below the slider's snap) draw through the 調節 program (`passes` has `'adjust'`) and differ from the neutral render by at most 1 level everywhere.
- **`tests/e2e/adjust.spec.ts`** (C §8.4):
  - **Editor**, `sample_face.png`. For each 調節 item, drag the slider and check that the right statistic moves:
    - mean luma for 亮度, 曝光 and 褪色 (black level);
    - the 10–90 % spread for 對比;
    - R/B of a neutral patch for 色溫;
    - chroma for 飽和 and 鮮艷度;
    - corner/centre luma for 暗角;
    - the local std of a flat region for 顆粒.

    Then: ⊘ resets all twelve; ↶ restores; the tab and item dots behave.
  - **一鍵 › 質感:** pick 膠片; the strip and 程度 slider appear; the export differs from 無; 無 restores. Reopen from 最近編輯: the look, its 程度 and the 調節 values are back.
  - **Camera** (`face.y4m`):
    - the 調節 tab exists;
    - 暗角 100 darkens the preview corners;
    - CCD changes the preview;
    - shutter → Review → 編輯 opens at 原圖: 暗角 and 顆粒 0, 質感 無 (2026-10-18; it kept the look and the values before);
    - after a reload `meiyan.look.v1` holds them.

    Grain moves, so camera comparisons run with 顆粒 at 0, except one check that grain raises the frame-to-frame difference in a flat region.
- **Existing tests:** `parity.spec.ts`, `engine.spec.ts`, `editor.spec.ts` and `camera.spec.ts` keep their assertions. The 一鍵 strip opens on 美顏 by default, so preset clicks are unchanged. Any selector that counted strip options is ported mechanically in the same commit (C §1.1).

### 8.4 Fixtures

No new binary fixture. The e2e chart is generated in code, `sample_face.png` is already in the repository (Apache-2.0, NOTICE), and the t5 preview sheet is gitignored output.

---

## 9. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| The looks do not match what users expect from 醒圖's 膠片／CCD／直閃 | The feature feels off-brand | The preview sheet goes to the user before the UI work starts (2c). Constants are single-sourced in TS, so tuning never touches the shader. Thumbnails make each look obvious before it is applied. |
| GPU cost on older iPhones | Live fps drops with a look on | The base program when neutral, uniform-branch skipping, the bench row, AutoTier, and the `ADJUST_FAST` fallback (§6.1) |
| First use compiles the 調節 program | A one-time stutter on the first 調節 drag or look pick | Measured in the bench; pre-warm on opening the tab if it exceeds 50 ms (§6.1); a compile failure keeps the base program drawing (§7) |
| Stacking 濾鏡 + 質感 + 調節 gets muddy | Ugly results | The defaults are mild (presets' filters at 40 %, looks at 80 %); the user decides (§11 Q1) |
| Two labels 膠片 (and two 高光) | Confusion | Different tabs, different thumbnails, the t5 distinctness test; §11 Q2 |
| Moving grain looks like sensor noise in the camera | A cheap look | Cell size tied to the picture, midtone weighting, damping on low tiers; §11 Q4 |
| Integer hash differs on an iOS GPU | Grain not reproducible between preview and export | GLSL ES 3.00 `highp uint` wrap is defined; the bench bit-exact probe |
| LRU eviction makes a frame skip its LUT | One frame without the filter or look while scrolling many LUTs | The current frame's LUTs are never evicted; the cap of 6 covers a filter + a look + 4 recent; `exportReady` asks the engine |
| `gen-luts.mjs` needs Node ≥ 22.18 to import TS | Asset regeneration fails on an old Node | Documented in the script header. Vercel never runs it, because the assets are committed (`package.json:14`); the repository's Node is v24. |

---

## 10. Out of scope

- 曲線, HSL (with colour picking), 黑白色階／色階, 紋理, 結構, 局部調整 (control points), 畸變矯正, 色偏矯正, 智能優化／自動, AI 光影 (XE Q2).
- 直閃水光 and any face-aware gloss or flash-on-skin effect; real torch or flash control in the camera.
- Per-person 調節 or 質感 (C §10: per-person filters are out).
- 濾鏡 or 質感 favourites and user-saved looks; more looks (GR, named camera emulations); importing `.cube` LUTs.
- A 暗角 that lightens (C §11 Q8 default), and vignette midpoint or roundness controls.
- Dithering, and grain size or roughness controls.

---

## 11. Open questions for the user

Each question has a default that this spec uses if the user does not answer.

1. **濾鏡 and 質感 together:** may they stack (the 濾鏡 first, then the 質感), or should picking a 質感 set 濾鏡 to 無? *Default: they stack. Nothing changes the 濾鏡 behind the user's back, and a 質感 never breaks the beauty preset.*
2. **Two 膠片 labels:** keep 濾鏡「膠片」 and 質感「膠片」 side by side, or rename the filter to 「復古」? *Default: keep both. They sit in different tabs, and the thumbnails differ clearly.*
3. **Default 程度 of a 質感:** 80 or 100 when first tapped? *Default: 80. Each look is tuned so that 80 is the intended look, which leaves room to push it.*
4. **Grain in the live camera:** moving (a new grain pattern every frame, like film) or still (a fixed pattern that stays on the screen)? *Default: moving. A still pattern looks like dirt on the lens when the camera moves.*
5. **Camera 調節 across launches and into imports:** keep the camera's 調節 values and 質感 when the app is reopened (as 濾鏡 is kept today), or reset 調節 at each launch and keep only the 質感? The same choice decides what an imported photo starts with, because imports start from the camera look (C §3.7): with the default, a photo picked from 相簿 opens with the camera's 曝光, 色溫 and so on already applied. *Default: keep everything, and imports start with it, as today's camera look does for 濾鏡.* **Decided 2026-10-18:** the camera keeps everything across launches, but imports and camera shots open at 原圖, without it (C §3.7).
6. **Lowering a look's grain, fade or vignette:** with a 質感 on, 顆粒, 褪色 and 暗角 can only be raised above what the look adds; turning the look's grain down means lowering 程度, which also weakens its colour. Is that acceptable, or should these three sliders, while a look is on, start at the look's own amount and move both ways? *Default: acceptable (C §3.4: sliders show your own value, the look adds on top). The alternative changes what these sliders mean whenever a look is set, so it is left out unless asked for.*
