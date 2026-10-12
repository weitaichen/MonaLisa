# Mona Misa 美顏 v0.4 step 1: 選臉／選人 design

- **Date:** 2026-10-12
- **Status:** the user approved this design (§0.1). This file writes it down and makes it concrete. It is the step-1 sub-spec that roadmap §1.2 asks for. Code starts only after the plan for step 1 exists.
- **Contract:** [v0.4 roadmap and architecture contract](2026-10-12-v04-roadmap.md) (called **RM** below). This spec stays inside RM. §0.3 lists the places where it adds detail RM left open; none of them reverses an RM decision, and each one is folded into RM in the commit that lands it (A1, A2 and `RenderInput.obstacles`, which the sibling specs build on, were folded into RM §3.6 and §4.1 in the 2026-10-12 consistency pass). §0.4 lists the RM sections that r2 corrected in RM itself.
- **Backbone:** the change points T1–T5, P1–P6, S1, E1–E6, F1, U1–U5, C1–C3 and X1, and the persistence notes, of the verified multi-face code map (session scratchpad `multi-face-map.md` §2 and §5). §3.4 gives every change point its decided approach.
- **Anchors:** `file:line` at `892ea61` (v0.3.0).
- **Revision r2 (2026-10-12):** applies the engine, UX and persistence reviews. The RM sections this revision had to change are listed in §0.4.

## 摘要（繁體中文）

1. 合照裡每張臉都有框，點臉或點下方「全部｜1｜2｜3…」人物列即可選人。選了誰，磨皮、紅潤、9 項美型、美妝和局部美體就只改誰，每個人各自保存。美白、銳化、濾鏡、增高、長腿和背景保護標示為「整張照片」。
2. 臉部效果和美體一定落在同一個人身上。這修正了 v0.3 的錯位：臉部效果可能改到第一張臉，美體卻改到畫面中央的人。
3. 引擎一次處理所有臉：每張臉的位移在原圖座標算好後相加，影響範圍不超過與最近另一張臉（包括太小、不能選的臉）距離的一半，邊緣用與瘦臉背景保護相同的「位移預算」收邊，不會折疊。美體把每個人的位移合成一張場，其他人是保護區。
4. 相機最多追蹤 3 張臉，預設美化最大的臉，點別人的臉可以切換；「全部套用」讓每張臉用同一組效果。拍照後按「編輯」，編輯器會選好同一個人。
5. 偵測結果和每個人的參數都存進「最近編輯」，重開不必再偵測，只看不改也不會改變清單順序。v0.3 的舊紀錄打開後，效果會套在預設人物身上。
6. 動工前先量測（Phase 0）：多臉偵測時間、相機幀率、延遲與抖動、GPU 上限與記憶體。量測不理想時依 §6.3 降級，例如編輯器臉數上限 6 → 4 → 2、相機 3 → 2 → 1。

---

## 0. Inputs

### 0.1 Approved decisions (binding)

| Topic | Decision |
|---|---|
| Scope | Photo editor **and** live camera |
| Editor detection | Up to 6 faces and up to 4 bodies, paired into **persons**. A person may be face-only or body-only. Pairing compares pose head points with face landmarks, checks mask coverage, and takes pairs greedily 1:1 under a threshold. |
| Default selection | The largest, most central person (as today) |
| Editor UI | A tappable box on each face over the photo, plus a bottom strip 「全部｜1｜2｜3…」. In the 美體 tab, tapping a body also selects. A tab that does not apply to the selected person (no face, or no body) says why. |
| Per person | 磨皮, 紅潤, all 9 美型, 美妝, the local 美體 items |
| Per photo | 美白, 銳化, 濾鏡 and its strength, 增高 band, 長腿. Row bands stretch whole rows, so they are photo-level by construction. They are labelled 「整張照片」 with the reason. |
| 全部 | A slider drag writes that item's value to every person; other items keep each person's value. A preset tapped under 全部 applies to everyone. |
| Undo | Covers per-person param changes. Changing the selection is **not** an undo step. |
| Persistence | Detection results (faces and persons) and per-person params are cached in the history entry. A reopen needs no detection and always maps edits to the same person. Old entries (no cache) give their params to the default-selected person. |
| Engine | One pass for all faces. Every face's displacement is computed in original-image coordinates and the displacements are **summed**, never chained face after face. Each face's influence is capped at half the distance to the nearest other face. 磨皮 and 紅潤 strengths are per face, carried in the skin mask. Makeup is drawn per face. The source is still resampled once. |
| Multi-person 美體 | Each person's local field is computed and the fields are combined into **one** field. Other persons are protected zones. 背景保護 and the 瘦臉 background limit are computed per person. |
| Camera | Track up to 3 faces; default = the largest face; tap a face to switch; 「全部」 gives every face the same params (shown as the chip 「全部套用」, A10); no per-face settings in the camera; app-side landmark smoothing (MediaPipe smoothing is off when `numFaces > 1`), e.g. One-Euro; capture → 編輯 hands the selected face to the editor. |
| Phase 0 | Measure first: a group-photo fixture, numFaces/numPoses cost (desktop now, iPhone via `/bench.html` later), GL limits (`MAX_FRAGMENT_UNIFORM_VECTORS`, UBO size, float textures). Fallbacks such as a lower face cap exist for bad numbers. |
| Out of scope | Long-press re-detect of missed small faces; per-person filters; per-person camera settings |

### 0.2 Sub-steps

Each sub-step ends green (`npm run typecheck`, `npm test`, `npm run build`, `npm run test:e2e`) with local commits on `feat/meiyan-pwa`. Nothing is pushed or deployed without the user's go-ahead (RM §1.2).

| Sub-step | Change points | Leaves working |
|---|---|---|
| **1a Phase 0** | X1 (fixtures, parity goldens), bench rows, GL probes (§6) | Measurements recorded in §6.4; `src/config/limits.ts` set from them |
| **1b Param model + history v2** | U2, U3, U4, C3, persistence (§5); RM §3.2–3.4 | Every v0.3 feature with parity; v0.3 entries open unchanged; still one face |
| **1c Detection + engine** | T1–T3, S1, P1–P5, E1–E6, F1 | Group photos render per person, and the lens edits any person in unit and engine tests. The UI still edits only the primary person until 1d. |
| **1d Editor UI** | U1, U5, P6 | Boxes, strip, 全部, notes, body tap |
| **1e Camera** | T4, C1, C2 | Up to 3 tracked faces, tap to select, 全部套用, hand-over to 編輯 |

### 0.3 Detail added to the contract

| # | RM says | This spec adds | Why |
|---|---|---|---|
| A1 | Editor `numFaces = MAX_EDIT_FACES` (RM §3.6) | The editor requests `EDIT_DETECT_FACES = MAX_EDIT_FACES + 2` faces and keeps the `MAX_EDIT_FACES` largest selectable ones. Every face dropped after the dedupe is kept as an **obstacle** (RM §3.6 `obstacles`, §4.1). | With exactly the cap, `dropped.overCap` can never be non-zero, and a tiny background face would use up a slot that a real face needs |
| A2 | `globalSkin: {smooth, rosy}` (RM §4.1) | Adds `weight` (0..1) | The camera fades from "face" to "no face" exactly as v0.3 does (`mask.ts:48`: outside value `1 − w`) |
| A3 | The cap is a displacement budget, present whenever a face has a neighbour (RM §4.3, r2) | In the camera a neighbour's distance is divided by its presence easer, so a face entering or leaving the view moves the caps over 150 ms; a capped face's influence box is clipped to its cap disc; the `U_MAX` influence box (every 美型 item at its maximum, both ends of the bidirectional ones) sizes the protect window (§4.1, §4.7) | No on/off threshold exists inside a photo, so nothing switches part-way through a drag, and a face appearing in the camera does not pop |
| A4 | Other persons' texels "count as infinitely far" in the 瘦臉 limit (RM §4.5) | Realized on the **raw** signed distance: `sd_raw = max(sd_own_raw, R_f − d_O)`, then today's three box blurs and the clamp (§4.7) | The budget is 0 inside other persons; blurring after the max keeps the distance 1-Lipschitz **and** smooth, so the wall lines get no crease where the two terms cross (`faceProtect.ts:9-10`) |
| A5 | `detectVideo(...)` returns `Landmarks478[]` (RM §3.8) | It returns `Landmarks478[] \| null`: `null` = no answer (closed, frame not ready, tracker unusable, rebuild throttled, or a throw caught by the loop); `[]` = a definite "no face" | A tracker hiccup must not drop the camera's tracks and selection (`tracker.ts:365-367`, `live.ts:166-174`) |
| A6 | `StillSession.setFaceProtect` (today `still.ts:31`) | Removed; each `RenderFace` carries its own `protect` | One limit per face |
| A7 | Camera default = the largest face | Auto selection has hysteresis: it switches only when another face stays ≥ 1.2× larger for 500 ms. A switch crossfades both faces over 150 ms. | Two faces of similar size would otherwise flicker |
| A8 | 背景保護 is "one switch for the combined field; the protection itself is computed per person" (RM §3.1) | The switch is photo-level (label 「整張照片」); what it turns on, and the 瘦臉 limit, are computed per person (§4.6, §4.7). See §11 Q4. | The approved decision says "背景保護 and the 瘦臉 background limit become per person"; RM §10 keeps per-person switches out of scope |
| A9 | Photo-level items carry the badge 「整張」 (RM §2.1) | With ≥ 2 persons, the **slider-row label** of every photo-level item reads 「{label} · 整張照片」 (aria-label 「{label}，整張照片」). The short tile badge 「整張」 stays as an extra hint; it is the new field `PanelItem.badge?: string`, which step 5 reuses for its 「左右」 badge. | The approved decision labels them 「整張照片」 |
| A10 | The camera's 「全部」 | The camera chip reads 「全部套用」 | Alone on the preview, a bare 「全部」 does not say what it does; the editor strip keeps 「全部」 |
| A11 | Chips are dimmed on photo-level tabs (RM §2.2) | Chips and boxes are also dimmed, with 「整張照片」, while the **active item** of a mixed tab is photo-level (美白, 銳化, 增高, 長腿, 背景保護) | Otherwise "人物 2 selected" suggests that 美白 changes only person 2 |
| A12 | Phase 0 jitter rule (RM §6.2) | PJ1 jitter **and** J2 lag thresholds, PL2 (one face in view must not get slower), and `MAX_LIVE_FACES = 1` bypasses the filter (§6.3) | Smoothing has to be judged on lag too; at one face MediaPipe smooths already |
| A13 | Migration of a v1 entry with `body` (RM §5.2) | The primary is the person that owns b0; when b0 pairs with no face, its local 美體 values go to b0's person and the face part to the face-score primary (§5.3) | v0.3's body edits must keep rendering on the body v0.3 edited |
| A14 | Pairing rule (RM §3.6) | Exactly one face and one pose whose visible nose lies in the face box padded by 25 % always pair, whatever the IOD cost (§3.4 P4 step 7) | Otherwise one human becomes two persons in a full-body shot with a small face |
| A15 | 基本模式 writes `faceScans = []` (RM §3.6) | A later open with a working tracker detects faces once, merges them into the cache (bodies kept) and re-pairs (§5.3) | Otherwise a cache written in 基本模式 blocks face detection forever |
| A16 | Caps `MAX_EDIT_FACES`, `MAX_EDIT_BODIES` (RM §3.6) | Caps apply to **new** detections only. A cache is validated against `MAX_RENDER_FACES` and the body cap 4 and is never truncated. | PM1 makes the caps tier-dependent, and the 'auto' tier changes per session (`flows.ts:7-13`) |
| A17 | A detect-cache patch does not reorder 最近編輯 (RM §5.1) | `updateEntry(id, patch, {touch?})`; detection-driven rebases write `{schema, edit, params, detect}` and a thumbnail with `touch: false` (§5.2) | Viewing an entry must never reorder the list (`history.ts:69-74`) |

### 0.4 RM sections changed by r2

The reviews found places where RM itself was wrong or contradicted the approved decisions. RM was edited minimally in the same revision; nothing else in RM changed.

| RM § | Change | Finding |
|---|---|---|
| §2.1 notes | ⊘ with one person selected resets only that person's items of the tab; the tab's photo items are reset only under 全部 or with < 2 persons | ⊘ on person 2 wiped everyone's 美白, 銳化, 增高, 長腿 |
| §2.2 | Face boxes are visual only (`pointer-events: none`); every photo tap goes through zoomPan's `onTap(uv)` on person-level tabs (faces first, then bodies on 美體); persons found later are **appended** to the numbering | `zoomPan.ts:82` drops pointers that start on a `button`, so boxes blocked pinch, pan and double-tap on faces |
| §2.6 | Copy: no face, no body, over cap, too small, reset confirmation | Accuracy ("不會套用臉部效果"), the app's 「未偵測到…」 wording |
| §3.2, §3.6 | `p0` is the lens target whenever no person is known, created from `primaryInit ?? template`; person ids are immutable once persisted; `DetectionCache.obstacles` | Edits made before the first definite answer were dropped; ids were re-derived on re-detection; dropped faces were invisible to the caps |
| §3.3 | `Lens.get` mixed by display value; `Lens.shade` / `Lens.preset` return `{…, mixed}`; under 全部, `selected` and every no-op check mean "all targets match"; "the first applicable person" | Under 全部, tapping the preset or shade the primary already had did nothing for anyone else |
| §3.4 | 重置 confirmation 「確定重置全部？」 only with ≥ 2 persons | Single-person copy unchanged |
| §3.7 | Camera smoothing replicates MediaPipe's own smoother (per landmark, scale-normalized) | One cutoff from the box-centre speed lagged on nods, blinks and smiles |
| §3.8 | `detectVideo` returns `Landmarks478[] \| null` (A5) | — |
| §4.2, §4.3 | The cap is a slope-limited displacement budget (the 瘦臉 limit's construction), not a multiplicative window; fold check is a sweep against `MIN_DET`; P0 draws rings, then fans (blending off), then holes; protect layers are per-face windows with ≥ 2 faces; the face-table carrier is chosen by measurement | The window folded (its gradient reached 7.5/FW where the cheek moves most) and popped at its off threshold |
| §4.5 | Other persons enter each `L_p` as a magnitude budget; a per-person fold guard λ_p; the global λ is a last resort | A fixed 1.5 % feather folded between close persons, and one global λ let person 2's drag weaken person 1 |
| §4.7 | Protect array size | Per-face window layers (128²) |
| §5.1 | `HistoryEntry.paramsKey` | Rollback to 0.3, edit, re-upgrade |
| §6.2 | GL probes run in `/bench.html` and dev builds only; the face-table row | A `readPixels` stall on every production engine build had nothing to switch to |
| §8.1 | Cap tests: the sweep, `MIN_DET` | — |

Sibling sub-specs that quoted the old RM text were updated in the 2026-10-12 consistency pass: `2026-10-12-face-detail-and-makeup-design.md` (the fold test is now this spec's sweep against `MIN_DET`, and its step-5 face-table block starts at texel 75), `2026-10-12-push-brush-design.md` (the P2 formula uses the cap budget), `2026-10-12-skin-cleanup-tools-design.md` (a face without a cap reads −1 in texel 73).

---

## 1. Goal and user-visible behaviour

### 1.1 Photo editor

1. **Open.** On a new photo the editor shows 「正在分析臉部…」 (`Editor.tsx:812`) while one face detection runs. It finds up to 6 selectable faces; a face whose box is narrower than 3 % of the short edge is not selectable and gets no face effects.
2. **Persons.** Each face is a person. When the 美體 tab first runs body detection, bodies attach to their faces, and a body without a face becomes a body-only person.
3. **Default.** The primary person (largest × most central face, else body) is selected. A photo with one person looks and behaves exactly as in v0.3.
4. **With ≥ 2 persons:**
   - corner brackets mark each face (on person-level tabs); they are drawn, not buttons (§2.1);
   - the strip 「全部｜1｜2｜3…」 sits under the photo;
   - tapping a face on the photo, or a chip, selects that person;
   - in the 美體 tab, tapping a body also selects its person;
   - pinch, pan and double-tap work everywhere on the photo, faces included.
5. **Editing.** Every slider and preset of a person-level item changes only the selected person. Each person keeps their own values for 磨皮, 紅潤, 美型, 美妝 and the local 美體 items. Photo-level items (美白, 銳化, 濾鏡, 濾鏡強度, 增高, 長腿, 背景保護) change the whole photo whoever is selected; with ≥ 2 persons their slider label reads 「{label} · 整張照片」 and their tile carries the badge 「整張」 (A9), and the chips dim while one of them is active (A11).
6. **全部.** A slider writes its item's value to every person it applies to. Every other item keeps each person's value. Presets and shades apply to everyone, including persons who already match the primary (§2.4).
7. **Not applicable.** A body-only person has no face effects, and a face-only person has no local 美體. The tab says why, and the items that do not apply are disabled with the reason.
8. **Undo.** ↶ ↷ undo and redo param changes of any person. They never change the selection. After ↶ or ↷, the brackets **and** the chip of every person whose values changed get the `.changed` highlight for 600 ms (a static class, so it also shows with reduced motion). When the step touched only persons other than the selected one, a toast says 「已復原人物 {n} 的變更」 or 「已重做人物 {n} 的變更」 (for several: 「人物 {n}、{m}」).
9. **Reopen.** A reopened photo runs no detector. Every person keeps their edits. Viewing an entry without editing never reorders 最近編輯.
10. **v0.3 entries.** On first reopen the faces are detected once (and cached). The saved look goes to the primary person; the others stay untouched, as v0.3 left them. v0.3 edited MediaPipe's `faces[0]` (`numFaces` 1, `tracker.ts:46-57`), which need not be today's primary, so in a group photo the look can move to another face (accepted by the decision). When that happens the thumbnail is rewritten without reordering the list (§5.2).
11. **First group photo.** A one-time toast 「點選臉部或下方人物，可個別調整」 shows the first time any photo has ≥ 2 persons (key `meiyan.hint.persons.v1`, a new key).

### 1.2 Live camera

1. Up to 3 faces are tracked. By default the largest face is beautified; with one face that is v0.3's behaviour, and a tap on that face still collapses the panel as today.
2. **Tap** (only while ≥ 2 faces are tracked). Tapping a face the user has not picked beautifies that face (a face beautified only by default gets pinned); an accent ring shows around it for 800 ms. Tapping the picked face again, or the background, collapses the panel as today. While ≥ 2 faces are tracked and 全部套用 is off, a 6 px accent dot sits above the beautified face.
3. **全部套用.** A chip appears at the top left of the preview once ≥ 2 faces have been tracked for 300 ms. When it is on, every face gets the same look and no dot is shown; a tap on a face turns it off and selects that face. It is off at app start and not persisted, but it survives the review screen and retakes.
4. There is one look for every face; there are no per-face settings in the camera.
5. **Hand-over.** Shutter → 預覽 → 編輯 opens the photo with the same person selected. Under 全部套用, everyone in the editor carries the look.
6. VoiceOver users cannot pick a face by tapping; 全部套用 is their way to beautify everyone.

### 1.3 What does not change

- **Single-person parity:** a photo with one person, edited with v0.3 items, exports within 1/255 per channel of v0.3 (RM §1.1; checked by the parity goldens, §8.3).
- The IndexedDB database `meiyan` (`DB_VERSION` 1, store `edits`), every `meiyan.*` localStorage key, the cache names and the Vercel URL. New keys `meiyan.look.v1` (RM §3.7) and `meiyan.hint.persons.v1` are added; none is renamed.
- MediaPipe 0.10.35, one FaceLandmarker instance (`tracker.ts:3-5`), on-device only.

### 1.4 The bug this fixes

Today the face edits go to MediaPipe's `faces[0]` (`tracker.ts:46-57`). 美體 edits the largest, most central pose (`bodyTracker.ts:158-183, 237-252`). `measureBody(det, face)` then takes the head and neck anchors from that unrelated face (`measure.ts:192, 284-298`). In a group photo the two can be different people. After step 1, every edit is addressed to a person, and the head anchors come from the face paired with the body, or from none.

---

## 2. UI

### 2.1 Editor layout (≥ 2 persons)

```
┌ topbar: ✕ · ↶ ↷ · 儲存 ───────────────────────┐
│ stage (.zoom-layer): photo + FaceBoxes (drawn)  │
│   ⌜1  ⌝      ⌜2  ⌝ (selected: accent)           │
│   ⌞   ⌟      ⌞   ⌟      ⌜3⌝                     │
├ PersonStrip (52 pt): [全部] [①] [②] [③]         ┤
├ SliderRow ───────────────────────────────────────┤
├ BeautyPanel strip + tabs ────────────────────────┤
```

- **PersonStrip** (`src/ui/components/PersonStrip.tsx`, new) is mounted between the stage and `SliderRow` (`Editor.tsx:863-876`) whenever the photo has ≥ 2 selectable persons, on **every** tab, so the canvas does not jump on tab changes.
  - **Size:** chips 44 × 44 pt, 4 pt gaps, 12 pt side padding. 「全部」 plus the face cap of 6 is 7 chips = 332 pt, which fits a 375 pt screen. The row scrolls horizontally only when body-only persons push it past the width; then a 16 pt fade at the right edge shows that there is more, and every selection change calls `scrollIntoView({inline: 'nearest'})` on the selected chip.
  - **Content:** the first chip is the text 「全部」. Each further chip is a square thumbnail with the person's number in the corner. The thumbnail is the face box padded by 30 %. For a body-only person it is the box of the visible pose head points 0–10 padded by 60 %; with fewer than 3 visible head points (a back view) it is the top 30 % of the mask bounding box, or of the pose bounding box without a mask.
  - Thumbnails are drawn once per person from the working bitmap into 132 × 132 px canvases (44 pt at 3×), about 0.5 MB for 7 chips.
  - **Accessibility:** the row is `role="radiogroup"` with aria-label 「選擇人物」; each chip is `role="radio"` with `aria-checked`. Chip labels are 「全部」 and 「人物 {n}」; a body-only person is 「人物 {n}（未偵測到臉部）」, and after body detection a face-only person is 「人物 {n}（未偵測到身體）」.
  - **Selected chip:** 1 px `--accent` outline.
  - **Photo scope (A11):** while the tab is photo-level (濾鏡 in step 1) or the active item is photo-level, the chips are dimmed (`--dim`), `aria-disabled="true"` and not selectable, and the caption 「整張照片」 sits at the start of the row, before 「全部」, as the group's `aria-describedby`. The chips stay focusable, so VoiceOver still reads them. The selection is kept and applies again as soon as a person-level item is active.
  - **Late appearance:** a one-face photo becomes a two-person photo when 美體 finds a body-only person. The strip then mounts mid-session and the canvas loses 52 pt (on an iPhone SE the stage goes from about 405 to 353 pt), through the existing 260 ms `.frame` size transition (`theme.css:264-266`).
- **Numbering.** A person's number is its position in `DetectionCache.persons` plus 1. The list is written left to right by the centre x of the face box (y breaks ties within 0.01), or of the body box for a body-only person, **when it is first built**. Persons found later (body-only persons from 美體, faces merged after 基本模式) are **appended**, so a number shown once never changes for that photo, and a reopen shows the same numbers (§11 Q1). Numbers never derive from person ids.
- **FaceBoxes** (`src/ui/components/FaceBoxes.tsx`, new) are drawn inside `.zoom-layer` (`Editor.tsx:832-841`), so they follow pinch and pan. They are **not** buttons: `pointer-events: none` and `aria-hidden="true"`. Every tap on the photo, a face included, reaches zoomPan (§2.3), so pinch, pan and double-tap work on faces at any zoom. The chips are the accessible control.
  - **Position:** box `{x, y, w, h}` in normalized image coordinates becomes `left/top/width/height` in %. The editor draws with `mirror: false` (`Editor.tsx:199`), so image UV is screen UV in step 1. When the body field has row bands (增高, 長腿), the box's top and bottom go through `forwardY(bands, y)` (`bands.ts:50`) of the current field, so a face in a stretched row keeps its box. Local 美體 fields move faces far less than the bracket padding and are ignored.
  - **Look:** four corner brackets (each 22 % of the box side) on the box padded by 15 % outward, so the jaw and chin that 瘦臉, V臉 and 下巴 move stay uncovered. Unselected: `--text-2` at 60 % opacity with a 1 px dark outer shadow (`0 0 0 1px rgb(0 0 0 / 0.5)`), so they show on light photos. Selected: `--accent`. Under 全部 every face looks selected. An 18 pt number badge sits outside the top-left bracket; it is hidden on boxes narrower than 24 pt on screen (the number stays in the chip).
  - **Zoom-invariant strokes:** `zoomPan.apply` also writes `layer.style.setProperty('--zs', String(s))`. Brackets use `border-width: calc(2px / var(--zs, 1))`; the badge uses `transform: scale(calc(1 / var(--zs, 1)))` with `transform-origin: top left`.
  - **Fading:** the brackets are at full opacity when a person-level tab opens, when the selection changes, and for 1.5 s after any photo tap; after that they fade to 30 % (200 ms). The `.changed` highlight (§1.1 item 8) is drawn at full opacity.
  - **Visibility:** on person-level tabs (一鍵, 美膚, 美型, 美體, 美妝) when ≥ 2 persons exist. Hidden while a slider is dragged, while 按住對比 is held, and while the 增高 tool is active (`showsHeightBand`, `Editor.tsx:834`). Dimmed together with the chips under A11.
  - **Body-only persons** get dashed brackets around their pose bounding box, in the 美體 tab only, also `pointer-events: none`.

### 2.2 Selecting

| Event | Result |
|---|---|
| Detection finishes (first open, or reopen from cache) | `{kind: 'person', id: primary}` |
| A tap on a face on the photo (§2.3), or on a person chip | That person |
| Tap 「全部」 | `{kind: 'all'}` |
| 美體 tab: a tap that hits no face but hits a body | That body's person (§2.3) |
| A chip or photo tap while a slider drag is active | Ignored |
| ↶ ↷, preset, 重置 | Selection unchanged |
| The selected person disappears (`p0` hands over when the first persons become known, §3.3) | The new primary person |
| Camera hand-over with a point seed | The person whose face box, padded by 25 %, contains the seed (the nearest box centre if several do); that person **is** the primary. If no box contains it: the primary by score, and everyone starts neutral (§3.4 C2). |

The selection is view state. It lives in the Editor's `useState`, per photo. It is never in the undo stack, never persisted, and never part of the output key. The module-level `lastSel` (`Editor.tsx:66`) keeps only the panel tab and strip item, as today.

### 2.3 Tapping the photo

`useZoomPan(stage, layer, enabled, opts?: { onTap?(uv: [number, number]): void })` (`zoomPan.ts:33-126`; step 6 adds `brush` to the same options object):
- `onTap` fires on the pointer-up of a gesture that never had two pointers, moved ≤ 8 px and did not start on a button, `.slider-row` or `.status` (`zoomPan.ts:82`; the face boxes are no longer buttons, so they do not block anything).
- It fires on the first tap, without waiting: a double tap still fits the view (`zoomPan.ts:103-110`), and both taps hit the same person.
- The UV is computed from `layerRef.current.getBoundingClientRect()`, the transformed `.zoom-layer` (`zoomPan.ts:56`), not the untransformed `.frame`, and before a double tap's fit `apply`, so it is right at any zoom.
- `onTap` is read through a ref: the effect depends only on `[enabled]` (`zoomPan.ts:125`) and would otherwise call a stale callback with an old tab and person list.
- The Editor passes `onTap` only on person-level tabs with ≥ 2 persons, and not while the 增高 tool is active (`showsHeightBand`). Later steps leave it out in the same way in 祛痘 mode (step 4), 推臉筆 mode (step 6) and the 裁切 tab (step 3, where zoomPan is off).

Hit test (`hitPerson(uv, ctx)`, pure, `src/detect/persons.ts`):
1. **Display → source.** `src = uv + D(uv)`, where `D` is the current body field, a backward map (`reshape.ts:290`), sampled bilinearly; identity without a field. Step 3 maps the tap V→O through the geometry first, and step 6 applies the liquify field (`LiquifyModel.backward`) before the body field, so the hit test always uses P2's backward map without the face chains (crop spec §2.2, push-brush spec §4.5).
2. **Faces** (every person-level tab). Each face box, padded by 15 % as drawn, is expanded to at least 44 pt on screen, i.e. `44 / (s · layerWidthPt)` in UV at zoom `s`. Among the boxes that contain `src`, the smallest normalized centre distance `|Δx|/w + |Δy|/h` wins.
3. **Bodies** (美體 only, when no face was hit). Sample every cached person mask (256 long edge) at `src`; the highest value ≥ 128 wins, and on equal values the smaller mask area wins. Without masks (the CPU pose fallback), test the pose bounding boxes padded by 5 %; the smallest box wins.
4. **No hit:** nothing is selected; the brackets' 1.5 s full-opacity timer restarts.

### 2.4 Per-tab behaviour (step-1 tabs)

| Tab | Person selected | 全部 selected | Notes |
|---|---|---|---|
| 一鍵 | The preset's person part goes to that person; its photo part goes to the photo (RM §3.4) | Person part to every face person, photo part to the photo | **Body-only person:** the presets stay enabled; the person part is skipped, the strip highlights `photo.presetLink?.id`, and 程度 scales only the photo part. Info note 「這位人物未偵測到臉部，臉部效果不適用」. **Photo with no face:** the preset's 磨皮 and 紅潤 go to the primary person (all skin, RM §3.3), and the note is today's photo-level note (`Editor.tsx:789-797`). |
| 美膚 | 磨皮, 紅潤: that person. 美白, 銳化: photo (「整張照片」). | 磨皮, 紅潤 to every face person | **Body-only person:** 磨皮 and 紅潤 are disabled **per item** (`disabled` plus the no-face note as reason), not through `.strip.face-off`, so 美白 and 銳化 stay usable. **Photo with no face:** the all-skin exception wins over the person gate: 磨皮 and 紅潤 act on all skin, read and write the primary person and are labelled 「整張照片」 (RM §3.3). |
| 美型 | That person | Every face person | Body-only person: tab dimmed, no-face note (`FACE_TABS`, `BeautyPanel.tsx:43`) |
| 美體 | Local items: that person. 增高, 長腿, 背景保護: photo. 長腿 sets `legsAnchor` to the selected person if that person has a body, else to null (§4.6). The 增高 `suggestedBand` comes from the selected person's measure, else the primary's. | Local items to every body person the item is available for; 長腿 anchors on the primary (`legsAnchor = null`) | One note, the first that applies: (1) detection status (`bodyNote`, `panelModel.ts:126-143`); (2) the selected person has no body: 「這位人物未偵測到身體，僅能使用增高、長腿」 (never under 全部); (3) 增高 or 長腿 is the active item and there are ≥ 2 persons: 「增高、長腿會拉伸整排畫面，套用於整張照片」, or, while 長腿 is active with ≥ 2 body persons, 「長腿以人物 {n} 的腿長為準，套用於整張照片」 with a small ruler marker on that person's chip; (4) otherwise none. `BODY_MULTI_NOTE` (`panelModel.ts:94, 145`) is removed. Because the bands note shows only for those two items, `BeautyPanel.tsx:54-55` still scrolls the selected item into view in every other case. |
| 濾鏡 | Photo | Photo | Chips dimmed with 「整張照片」, boxes hidden |
| 美妝 | That person (shades too) | Every face person | Body-only person: tab dimmed, no-face note |

- **⊘ 原圖** (RM §2.1, r2). With ≥ 2 persons and one person selected, ⊘ resets only that person's items of the tab (美膚: 磨皮, 紅潤; 美體: the local items). Under 全部, or with fewer than 2 persons, it also resets the tab's photo items (美膚: 美白, 銳化; 美體: the 增高 band and 長腿), which is v0.3's behaviour (`params.ts:240-250`). Its no-op check (`panelModel.ts:427`) tests exactly those targets.
- **重置** resets every person and the photo in one undo step (RM §3.4). Its confirmation reads 「確定重置全部？」 with ≥ 2 persons and stays 「確定重置？」 (`Editor.tsx:848`) with one, so `tests/harness/t7/shoot.mjs:186` is unaffected.
- **The 全部 slider** shows the primary person's value, or that of the first applicable person if the primary does not apply. The label gets a small 「各人不同」 when the **display values** (`displayValue`, `params.ts`) of the applicable persons differ, so 0.3451 and 0.3549 (both shown as 35) do not count as mixed (RM §3.3).
- **Presets, shades and 無 under 全部** (RM §3.3, r2). An item shows `selected` only when every target person matches it, and every no-op check of `activate` (`panelModel.ts:413` preset, `422` makeup 無, `427` body ⊘, `451` shade) means "every target already matches". So with the primary at 自然 and person 2 at 精緻, tapping 自然 under 全部 makes person 2 自然. 程度 shows under 全部 only when every face person has the same preset id; otherwise the slider row shows 「各人不同」 and no slider.
- **Dots** (`tabHasValue`, `panelModel.ts:547-561`, and the item dots): with a person selected they show that person's values plus the photo items; under 全部, any applicable person's.
- **Slider identity.** `SliderBinding.key` becomes `${selKey}:${id}` (`selKey` = the person id or `all`), so a person switch resets the drag state and the double-tap timer (`Slider.tsx:58-64`); otherwise tap, chip, tap reads as a double tap and resets person 2. With ≥ 2 persons the slider aria-label is 「{label}，人物 {n}」 or 「{label}，全部」 (photo items: 「{label}，整張照片」, A9), and `aria-valuetext` adds 「各人不同」 when mixed. One-person labels are unchanged, so `camera.spec.ts:43` and the editor specs pass as they are.
- **Toasts:**
  - The first 全部 write in an editor session shows 「已套用到全部人物」.
  - The first touch of each photo-level item in a session with ≥ 2 persons shows 「{label}套用於整張照片」.
- **Availability under 全部:** a body item is enabled when it is available for at least one person (`paramAvailability` per person's measure, `measure.ts`). The write goes only to those persons.

### 2.5 Camera

- **全部套用 chip** (A10): top left of `.frame` (`Camera.tsx:340-342`), 32 pt tall, the pill style of the editor's float buttons, `aria-pressed`. When on, it has an accent fill.
  - It appears once ≥ 2 shown tracks (held tracks included) have existed for 300 ms, and hides after < 2 for 1200 ms (the badge debounce of `Camera.tsx:105-112`). It never hides while it is on.
  - The chip, the ring and the dot are hidden while 按住對比 is held, when the 原圖 `.corner-label` takes the top left (`Camera.tsx:345-353`, `theme.css:1387-1392`).
  - **State:** the flag lives in the in-memory `AppState.cameraAll` (not persisted, false at app start). It survives the review screen and retakes. The loop reads it through `LiveDeps.getAll()`, so a loop rebuilt on `[ctrl, bundle, live]` (`Camera.tsx:100-139`) keeps it.
- **Tap** (`cameraTapAction(hit, tracks, selection, allOn)`, pure, `src/app/faceTracks.ts`). The stage click handler (`Camera.tsx:260-264`) maps the tap to video UV (§3.4 C1), asks `loop.hitTest(u, v)` for the face under it, and then:

  | Condition | Action |
  |---|---|
  | Fewer than 2 shown tracks | Toggle the panel collapse, as today (keeps `camera.spec.ts:71-73` green) |
  | 全部套用 is on and the tap hits a face | Turn 全部套用 off and select that face (ring, haptic) |
  | The tap hits a face that is not manually selected (a face beautified only by `auto` counts as not selected) | Select it: ring, haptic, `auto` → that track |
  | The tap hits the manually selected face, or no face | Toggle the panel collapse |
- **Marker** (`src/ui/components/CameraFaceMarker.tsx`, new): a DOM layer over the canvas, `pointer-events: none` and `aria-hidden="true"`.
  - The 800 ms accent ring after a selection; with reduced motion it is a static ring shown for 800 ms.
  - The 6 px accent dot above the beautified face while ≥ 2 shown tracks exist and 全部套用 is off.
  - Its rAF loop reads `loop.tracks()` and runs only while it has something to draw.
  - Nothing of it reaches the captured photo, which is rendered offscreen (`live.ts:323-337`).
- The 「未偵測到臉部」 badge (`Camera.tsx:351-353`) keeps its meaning: no face at all.
- Face picking is not available to VoiceOver; 全部套用 is.

### 2.6 Copy (step 1)

| Key | 繁體中文 |
|---|---|
| strip group aria | 選擇人物 |
| strip chip / aria | 全部 / 人物 {n} / 人物 {n}（未偵測到臉部） / 人物 {n}（未偵測到身體） |
| mixed values | 各人不同 |
| photo-level slider label / tile badge / strip caption | {label} · 整張照片 / 整張 / 整張照片 |
| photo-level first touch | {label}套用於整張照片 |
| bands note | 增高、長腿會拉伸整排畫面，套用於整張照片 |
| 長腿 anchor note | 長腿以人物 {n} 的腿長為準，套用於整張照片 |
| no face | 這位人物未偵測到臉部，臉部效果不適用 |
| no body | 這位人物未偵測到身體，僅能使用增高、長腿 |
| 全部 first write | 已套用到全部人物 |
| ↶ / ↷ on other persons | 已復原人物 {n} 的變更 / 已重做人物 {n} 的變更 |
| over cap (once per photo, only while the strip shows) | 偵測到超過 {MAX} 張臉，只會美化最大的 {MAX} 張 |
| too small (once per photo, only while the strip shows; the over-cap toast wins when both apply, `state.ts:146-151` has one slot) | 有些臉太小，不會套用臉部效果 |
| cache dropped | 已重新偵測臉部，部分人物的設定已重設 |
| first group photo (once ever, `meiyan.hint.persons.v1`) | 點選臉部或下方人物，可個別調整 |
| reset confirmation | 確定重置全部？ (≥ 2 persons) / 確定重置？ (one person, unchanged) |
| camera chip | 全部套用 |

The existing notes for "no face in this photo", 基本模式 and tracker health (`Editor.tsx:789-797`) are unchanged and still apply when the photo has no face at all.

---

## 3. Architecture and data model

### 3.1 New modules

| File | Contents |
|---|---|
| `src/config/limits.ts` | Every number Phase 0 can change (§3.5) |
| `src/detect/faces.ts` | `prepareFaces`: adapt, box, size filter, dedupe, cap, order, ids, obstacles. `faceBox`, `personScore`. |
| `src/detect/persons.ts` | `pairPersons`, `primaryOf`, `appendPersons`, `seedPrimary`, `hitPerson` (§2.3) |
| `src/detect/cache.ts` | `DetectionCache` build, `cachedFits`, `normalizeDetect`, `withBodies`, `withFaces` (§5.3), `rematchByIoU`, `renamePersons` |
| `src/edit/state.ts`, `lens.ts`, `legacy.ts` | RM §3.2–3.4 (the step-1 subset, §3.2) |
| `src/edit/migrate.ts` | `openState(entry, size)`: a stored entry → `{edit, detect, needsFaceDetect, rematch}` (§5.3) |
| `src/edit/frame.ts` | `buildFrame(edit, faces, obstacles, protects)` → `RenderFace[]`, `obstacles`, `globalSkin`, `photo` |
| `src/engine/passes/faceCap.ts` | `capsFor(faces, obstacles, aspect, presence)`: `c_f`, `cap_f`, "no neighbour", the box clip (§4.1); `uMaxBox(face, aspect)` for the protect window (§4.7) |
| `src/app/oneEuro.ts`, `src/app/faceTracks.ts` | Live smoothing (MediaPipe's own smoother, §3.4 T4), track de-duplication and matching, selection, `cameraTapAction` |
| `src/ui/components/PersonStrip.tsx`, `FaceBoxes.tsx`, `CameraFaceMarker.tsx` | §2 |
| `scripts/gen-group-fixture.mjs`, `scripts/record-parity.mjs` | Fixtures and goldens (§8.3) |

### 3.2 Types (step 1)

Step 1 introduces the RM §3.2 shapes with the fields of v0.3's items only. Later steps add `look`, `geometry`, `spots`, `strokes`, `right` and the new shades. `sanitizeEditState` fills every missing field with its default, so an entry written by any intermediate dev build stays readable.

```ts
// src/types.ts (additions; RM §3.2, §3.6, §4.1)
export type ParamScope = 'photo' | 'person';
export type PhotoParamId = Extract<ParamId, 'skin.whiten' | 'skin.sharpen' | 'filter.amount' | 'body.legs'>;
export type PersonParamId = Exclude<ParamId, PhotoParamId>;
/**
 * 'f0'…'f5' a person first built from a face, 'b0'…'b3' a person first built from a body, 'p0' the implicit person
 * while no person is known, 'live' the camera. Immutable once persisted: a person keeps its id when it gains a face
 * or a body (the links are PersonInfoCached.face / .body), so `f2` may later own body `b1`, and `b1` may own face `f0`.
 */
export type PersonId = string;
export interface Rect { x: number; y: number; w: number; h: number }

export interface PhotoParams {
  values: Record<PhotoParamId, number>;
  filterId: string;
  presetLink: PresetRef | null;
  bodyProtect: boolean;
  heightBand: HeightBand | null;
  legsAnchor: PersonId | null;
}
export interface PersonParams {
  values: Record<PersonParamId, number>;
  shades: { lip: string | null; blush: string | null };
  preset: PresetRef | 'custom';
}
export interface EditState {
  v: 2;
  photo: PhotoParams;
  persons: Readonly<Record<PersonId, PersonParams>>;
  template: PersonParams;
  /** the look meant for the primary person; seeds `p0` (§3.3), consumed by the first assignPersons, then null */
  primaryInit: PersonParams | null;
}
export type Selection = { kind: 'all' } | { kind: 'person'; id: PersonId };
export interface CameraLook { photo: PhotoParams; person: PersonParams }
export type FaceSeed = { x: number; y: number } | 'all' | null;

export interface DetectionCache {
  v: 1;
  width: number;
  height: number;
  /** step 1 writes [{quarter: 0, flipH: false}] after a definite answer, [] in 基本模式 */
  faceScans: { quarter: 0 | 1 | 2 | 3; flipH: boolean }[];
  faces: CachedFace[];
  /** every face dropped after the dedupe (overCap and tooSmall): no effects, but it bounds its neighbours' caps (§4.1) */
  obstacles: CachedObstacle[];
  bodies: CachedBody[] | null;
  bodiesComplete: boolean;
  /** display order: left to right when first built, later persons appended (§2.1 numbering) */
  persons: PersonInfoCached[];
  primary: PersonId;
  dropped: { tooSmall: number; overCap: number };
}
export interface CachedFace { id: string; lm: Float32Array /* 478×3, O-space */; box: Rect }
/** ≈ 300 B each: the 36-point oval (O-space) and its bbox */
export interface CachedObstacle { box: Rect; oval: Float32Array }
export interface CachedBody { id: string; pose: Pose33; mask: PersonMask | null; score: number }
export interface PersonInfoCached { id: PersonId; face: string | null; body: string | null }

/** BodyTracker.detect result (P2); BodyDetection (types.ts:149-159) stays as the v1 storage shape */
export interface BodyDetections { bodies: { pose: Pose33; mask: PersonMask | null; score: number }[]; width: number; height: number }

// Tracker (types.ts:228-243) — T1, T2. maxFaces is required, so no call can toggle the count by omission.
/** null = no answer (closed, frame not ready, unusable, rebuild throttled); [] = no face (A5) */
detectVideo(video: HTMLVideoElement, tsMs: number, opts: { maxFaces: number }): Landmarks478[] | null;
/** [] = no face, or not known: the editor's health check tells them apart (editorModel.ts:15-24) */
detectImage(image: ImageBitmap | HTMLCanvasElement | HTMLImageElement, opts: { maxFaces: number }): Landmarks478[];

// RenderInput (types.ts:276-292) — E1, step-1 subset of RM §4.1
export interface RenderFace {
  face: Face;
  /** 1 in the editor; the track's eased weight in the camera (0 = listed for the caps only) */
  weight: number;
  person: PersonParams;
  protect: FaceProtect | null;
}
export interface RenderInput {
  source: TexImageSource;
  width: number;
  height: number;
  /** ≤ MAX_RENDER_FACES */
  faces: readonly RenderFace[];
  /** box centres (UV) of faces that are not rendered but bound the caps (§4.1): the editor's obstacles; [] in the camera */
  obstacles?: readonly [number, number][];
  /** all-skin 磨皮／紅潤: the editor when the photo has no face (weight 1), the camera's "no face" fade (A2) */
  globalSkin: { smooth: number; rosy: number; weight: number } | null;
  photo: PhotoParams;
  body?: BodyField | null;
}

// DebugState (types.ts:409-421): `face` kept (= any face); add
faces: number;          // selectable faces (editor) / tracked faces (camera)
persons: number;
selected: PersonId | 'all' | null;
detectCalls: number;    // face detectImage calls in this page session
boxes: { id: string; x: number; y: number; w: number; h: number }[]; // normalized, unmirrored
gl?: Record<string, number | boolean>; // Phase 0 limits (always) and probes (bench and dev builds only, §6.2)
```

Step-1 scope table (RM §3.1). `ParamDef` gains `scope` and `live`; a unit test checks it against this table.

| Scope | Step-1 ParamIds |
|---|---|
| photo | `skin.whiten`, `skin.sharpen`, `filter.amount`, `body.legs` |
| person | `skin.smooth`, `skin.rosy`, the 9 `shape.*`, `makeup.lip`, `makeup.blush`, the 9 local `body.*` |

Non-ParamId state: `filterId`, `presetLink`, `bodyProtect`, `heightBand` and `legsAnchor` are photo-level; `shades` and `preset` are person-level.

### 3.3 Data flow after step 1

**Photo editor**

1. `EditorSource` (`state.ts:27-40`) becomes `{bitmap, edit, historyId, detect?, needsFaceDetect, rematch?, faceSeed?, faceProtect?, faceMask?, returnTo}`. `params` and `body` are removed: `openState` (§5.3), called in `openInEditor` right after the decode (`flows.ts:29`), has turned them into `edit` and `detect`.
2. **`p0`, the person before any person is known** (RM §3.2, §3.6, r2). Whenever no detected person exists, `edit.persons` holds exactly `p0`, created by `openState`, `cameraShotEdit` or the import as `primaryInit ?? template`. Every person-level read and write then goes to `p0`: while the first answer is unsure, after a definite "no face" (where `p0` is the all-skin person), and in 基本模式. No edit made in that time is lost.
3. **Session** (`Editor.tsx:191-256`):
   - If `detect` exists, `cachedFits` passes and `needsFaceDetect` is false, or the faces are already known from an engine swap (`knownFaces` ref, formerly `knownFace`, `Editor.tsx:87`), the session is created with `faces` and **no detection runs**. This also holds without a tracker: cached faces are render inputs, and only detection needs the tracker (today `Editor.tsx:224` passes a face only with a tracker).
   - Otherwise, with a tracker, `still.ts` runs `tracker.detectImage(bitmap, {maxFaces: EDIT_DETECT_FACES})` once and then `prepareFaces`.
   - `detectSession` (`editorModel.ts:15-24`) decides `unsure` as today, with `faces.length === 0` in place of `!s.face`.
4. **First definite answer:**
   1. `buildCache(faces, obstacles, bodies = detect?.bodies ?? null)`, or `withFaces(detect, faces, obstacles)` for a 基本模式 cache (§5.3), gives the persons in display order, the primary and `dropped`. The primary is the seed's person for a camera shot (§2.2), b0's person for a migrated v1 entry with a body (§5.3, A13), else the best score.
   2. `assignPersons(edit, persons, primary)`: the primary gets `persons.p0`, which carries `primaryInit` plus every edit made meanwhile; everyone else gets `template`; `p0` is removed unless the list is `[p0]` (nobody found); `primaryInit` becomes null. With a `rematch` from a dropped cache (§5.3), `renamePersons(map)` runs instead.
   3. `undo.rebase(...)` applies the same mapping to every stored state, so ↶ across the answer gives the primary its earlier values and never brings `p0` back.
   4. The cache is written to history with `touch: false` (§5.2), the selection is set to the primary, the over-cap or too-small toast shows once (only while the strip shows), and on the first group photo ever the hint toast shows (§1.1 item 11).
5. **Render:** `frame = buildFrame(edit, adaptedFaces, obstacleCentres, protects)` → `session.render(frame)` on every change of `edit`, the cache or the protect map (`Editor.tsx:602-609`). The selection is not an input.
6. **美體:**
   - Detection stays lazy (`Editor.tsx:470-477`). `BodyTracker.detect` returns every body (P1–P3).
   - `withBodies(cache, bodies)` pairs them (P4) and **appends** the body-only persons, with the lowest free `b<j>` ids. The rebase adds them from `template`. In a photo without faces, `p0` hands its params to the primary body person, then disappears.
   - The cache is written again (`touch: false`).
   - Each body person is measured with its **paired** face (`measureBody(det, pairedFace)`).
   - `buildBodyField` combines every person into one field (P5).
7. **瘦臉 limit:** `FaceProtectSource` keeps one limit per face (F1). Each face's limit rides in its `RenderFace.protect`.
8. **Output:** the de-dupe key is `editKey(edit)` (U2). Writes carry `{schema: 2, edit, params: legacyProjection(edit, primary), paramsKey, faceProtect, faceMask?}`.

**Live camera**

1. `AppState.params` → `AppState.look: CameraLook` (`state.ts:53-54, 77`), persisted under `meiyan.look.v1` (C3). The panel uses `lensFor(cameraEdit(look), {kind:'person', id:'live'}, [{id:'live', face:true, body:false}], 'live')`.
2. Per frame: `detectVideo(video, ts, {maxFaces: MAX_LIVE_FACES})` → `FaceTracks.update(landmarks | null, ts)` de-duplicates, matches, filters and eases (T4). On frames without a detection (tier L, `liveCore.ts:141-143`) `update` is not called and the tracks hold.
3. **Render:**
   - `faces` = every shown track, with `weight` = the track's easer value and `person = look.person`. A track that is not beautified is listed with weight 0, so it still counts for the caps.
   - `obstacles = []`: the camera cannot see faces beyond `MAX_LIVE_FACES` (§7).
   - `globalSkin = {smooth, rosy, weight: 1 − anyFaceEaser}`, from `look.person`.
   - `photo = look.photo`.
4. **Capture** (`live.ts:323-337`) renders the same input and also returns the seed: the centre of the beautified track's **last raw detected** box (not the filtered one) in unmirrored video UV, or `'all'`, or null. `Camera.tsx` maps the seed into the saved crop (C2).

### 3.4 Change points: decided approach

**Tracking**

| # | Anchor | Decided approach | Sub-step |
|---|---|---|---|
| T1 | `tracker.ts:114-122` (`numFaces: 1`), `199` (`mode`), `256-262` (`replace` resets to VIDEO), `338-352` (`setMode`) | Add `let faces` beside `mode`. `setMode(m, n)` returns early only when `mode === m && faces === n && !needsRebuild`. Otherwise it sets `faces = n` (before `setOptions`, like `mode = m`, `tracker.ts:342`) and calls `setOptions({runningMode: m, numFaces: n})`: **both keys every time**, because the bundle writes `numFaces` only when the key is present, and options are sticky (map §0.5). `createInstance(…, numFaces)` (`tracker.ts:114-122`) builds the first instance and every replacement with the last requested count (initially `MAX_LIVE_FACES`), and `replace()` sets `faces` to that count, so the camera pays no second rebuild after a replacement. `maxFaces` is required and clamped to 1…`EDIT_DETECT_FACES`. The editor pays no extra rebuild: the count travels with the IMAGE switch it already makes. The camera always passes `MAX_LIVE_FACES` and never toggles the count, because every change costs a graph rebuild plus a slow first GPU inference (about 1 s on desktop Chromium, `tracker.ts:334-337`). | 1c |
| T2 | `toLandmarks` `tracker.ts:46-57`; `Tracker` `types.ts:228-243`; callers `still.ts:304`, `live.ts:168` (the bench reads `StillSession.face`, `bench/main.ts:464`) | `toLandmarksAll` returns one `Landmarks478` for every entry with ≥ 478 points, in result order; `[]` when there are none. `detectImage`: `[]` keeps the meaning of today's `null` (no face, or recovering, `types.ts:232-235`), and callers keep the health check (`editorModel.ts:15-24`); a throw still means "not known" (`still.ts:306-308`). `detectVideo` returns `null` for "no answer" (the early returns of `tracker.ts:358-367`) and `[]` only for a completed inference without a face (A5); the live loop turns a throw into `null` (`live.ts:166-174`). | 1c |
| T3 | `Face` has no id or box (`types.ts:117-130`); result order undocumented | `prepareFaces(lms, w, h)` (pure, `src/detect/faces.ts`): (1) `adapt` each face; (2) box = oval bbox clipped to [0,1] (the same bbox `maskCoversFace` uses, `faceProtectModel.ts:63-72`); (3) of two faces with box IoU > 0.6, keep the larger (a duplicate is the same face: dropped entirely); (4) drop faces narrower than `MIN_FACE_FRAC` of the short edge (`tooSmall`); (5) keep the `MAX_EDIT_FACES` largest (`overCap`); (6) sort by box centre x, with y breaking ties within 0.01; (7) ids `f0`… in that order; (8) every face dropped in (4) or (5) becomes an **obstacle** `{box, oval}` (A1, §4.1). The ids are persisted in the cache and never recomputed, so a different result order on another decode or delegate cannot swap identities. | 1c |
| T4 | `live.ts:63, 74-78, 131-142, 166-195`; `liveCore.ts:50-74` | `FaceTracks` (`src/app/faceTracks.ts`) holds up to `MAX_LIVE_FACES` tracks `{id, box, rawBox, filter: LandmarkSmoother, easer: FaceWeightEaser, presence: FaceWeightEaser, shown: Face, lastSeen, lastDetectTs}`. Each step is listed below this table. | 1e |
| T5 | Live crop alternative (keeps `numFaces = 1`) | **Rejected; not built.** MediaPipe ROI is unsupported in this bundle (map §0.3), a manual crop adds a `drawImage` per frame on the GPU path, and a moving crop defeats the smoothing. If Phase 0 rejects live multi-face, the fallback is `MAX_LIVE_FACES = 1`, i.e. v0.3 behaviour (§6.3). | — |

T4 steps, in order:

- **No answer** (`update(null)`): every easer eases toward 0, as v0.3 does on a null frame, but `lastSeen` does not age, no track is dropped and the selection stays. A tracker hiccup (throttle `REBUILD_INTERVAL_MS` = 1000 = `LOST_HOLD_MS`, context loss) therefore never resets the selection.
- **De-duplicate** (on detecting frames, before matching): of two detections with box IoU > 0.6 (T3's rule), keep the one that matches an existing track (IoU ≥ 0.3), else the larger. In VIDEO mode two tracked ROIs can converge on one face; without this a face would be warped twice, or get a near-zero cap.
- **Match:** greedy by box IoU ≥ 0.3, else the nearest centre within 0.5 box widths.
  - An unmatched detection starts a track; new ids count up per session.
  - An unmatched track is "missing". It keeps its last landmarks for `LOST_HOLD_MS = 1000` and is matched again near its last centre. After that it is dropped.
  - Tier L detects every second frame (`liveCore.ts:141-143`); `update` is not called on the frames in between, and the tracks hold their landmarks.
- **Filter** (RM §3.7, r2): MediaPipe's own smoother, replicated. Per landmark and per coordinate (x, y, z of all 478 points), a One-Euro filter on values in source pixels (x·W, y·H, z·W), scaled by `1 / ((boxW + boxH) / 2)` (box in px) so that the behaviour does not depend on resolution or face distance, with `ONE_EURO = {minCutoff: 0.05, beta: 80, dCutoff: 1.0}`. Those are the values MediaPipe's face-landmarks graph gives its `LandmarksSmoothingCalculator` when it smooths (`numFaces` 1); the 0.10.35 wasm carries that calculator with its `one_euro_filter` options, and sub-step 1a checks the values against the tasks-vision 0.10.35 source and records them in §6.4. The filter is fed only on detecting frames, with `dt` = the time since the track's previous detection. Then `adapt`.
  - **Bypass:** with `MAX_LIVE_FACES = 1` the filter is off (MediaPipe smooths at `numFaces` 1), and the shown landmarks are the raw ones. That makes the 1-face fallback exactly v0.3.
- **Selection:** `'auto' | {track}`. 全部套用 is not a selection: the loop reads `LiveDeps.getAll()` (the in-memory `AppState.cameraAll`, §2.5) every frame.
  - `auto` picks the largest box, with the A7 hysteresis.
  - `select(track)` pins a track. If the pinned track is dropped, the selection returns to `auto`.
- **Weights:** each track's easer target is `present && (getAll() || track is selected)`. A selection switch therefore crossfades over `FACE_EASE_MS` (150 ms). A separate `anyFaceEaser` targets "any track present" and feeds `globalSkin.weight`. With one face it is identical to today's single easer. Each track's `presence` easer targets "present" alone; it scales the track's part in its neighbours' caps (§4.1).
- **Reset:** `resetSession` (`live.ts:182-195`) clears the tracks and sets the selection to `auto`; 全部套用 is untouched. `pause` (`live.ts:197-206`) clears the tracks too.
- **API:** `LiveLoop` gains `hitTest(u, v): TrackId | null` (unmirrored video UV, boxes expanded as in C1), `select(id: TrackId)`, `selection(): 'auto' | TrackId` and `tracks(): LiveTrackView[]`; `LiveDeps` gains `getAll(): boolean`. `capture()` returns `{image, seed} | null`. `LiveStats` gains `faces: number` (shown tracks, held ones included), published when it changes, like `face` (`live.ts:266`); the chip's 300 / 1200 ms debounce lives in `Camera.tsx` (§2.5).

**Body**

| # | Anchor | Decided approach | Sub-step |
|---|---|---|---|
| P1 | `numPoses: 2` `bodyTracker.ts:292`; test `bodyTracker.test.ts:206-212` | `numPoses: MAX_EDIT_BODIES` (4). The test expectation changes from 2 to 4 (an intended change, RM §8.1). | 1c |
| P2 | `toDetection` `bodyTracker.ts:237-252`; `result.close()` `465-470` | `toDetections(result, w, h)` returns `BodyDetections`, or null when nobody is found. It keeps every pose with ≥ 33 points. `score` is `selectPerson`'s area × centrality, exported as `poseScore`. The CPU fallback has no masks (`mask: null` for every body). `selectPerson` stays for `BodyDetection` (v1) tests. **Mask readback, one mask alive at a time** (the list is below this table). | 1c |
| P3 | `BodyDetection` `types.ts:149-159`; `normalizeBody` `history.ts:183-198`; `bodyToPersist` `editorModel.ts:339-342`; body status `people` `editorModel.ts:210-220` | `BodyDetection` stays as the v1 storage shape and is read only by migration (§5.3). The editor's body state holds `BodyDetections`. `bodyToPersist` becomes a `detect` cache patch. `BodyContext.people` becomes the number of body persons. | 1b/1c |
| P4 | `measureBody(det, face)` `measure.ts:192, 284-298`; caller `Editor.tsx:479-488`; `maskCoversFace` heuristic `faceProtectModel.ts:216` | `pairPersons(faces, bodies, aspect)` in `src/detect/persons.ts`. The rule is listed below this table. Each body person is measured with its paired face or `null` (`measureSafe`, `editorModel.ts:155-168`, takes the paired face). That fixes the latent bug of §1.4. | 1c |
| P5 | `buildBodyField` `field.ts:99-164`, `localField` `258-322` | One combined field (§4.6). With one person it reduces to today's builder exactly. | 1c |
| P6 | `BODY_MULTI_NOTE` `panelModel.ts:93-95, 145` | Removed. With ≥ 2 persons the 美體 note is the bands note (§2.6). The person picker replaces the "main person" hint. The panel test (`panelModel.test.ts:264, 334`) is changed accordingly (intended). The comment at `measure.ts:154` is updated. | 1d |

P2 mask readback. In tasks-vision 0.10.35, `MPMask.getAsFloat32Array` caches the array inside the mask (`La` pushes it onto the mask's container list), `MPMask.close()` deletes only the GL texture, and `result.close()` only calls `close()` on each mask (`segmentationMasks?.forEach`). On iPhone and iPad, `La` also reads `RGBA, FLOAT` into a temporary 4× buffer (`new Float32Array(w·h·4)`, about 26 MB at 1280²). So:

1. Copy `result.segmentationMasks` into a local array and set `result.segmentationMasks = []`, so `result.close()` no longer reaches them.
2. For each mask in turn: `getAsFloat32Array()` → `downscaleMask` (`bodyTracker.ts:204-228`) → `mask.close()` → drop the local reference before the next readback. At most one cached full-size array (≤ 1280², about 6.5 MB) plus one transient 4× buffer is alive at once.
3. Any mask left after an exception is closed in `finally`.
4. Unit test (`bodyTracker.test.ts`): a fake `MPMask` that counts live arrays (created on `getAsFloat32Array`, released on `close`) never sees more than one, and `result.close()` closes nothing twice.

P4 pairing rule, step by step:

1. **Points.** Pose 0 (nose), 2 and 5 (eyes) and 9, 10 (mouth corners) against face `pts111[46]` (nose tip), `[104]`, `[105]` (pupils) and `[84]`, `[90]` (mouth corners). The eye and mouth pairs are **matched by image side** (left-most with left-most), so the person-left / image-right conventions of the two models cannot cross.
2. **Visibility.** Only pose points with visibility ≥ 0.5 count. A pose with fewer than 3 visible points cannot pair (for example, a back view).
3. **Cost.** The mean iso distance between the counted pairs, divided by the face's inter-ocular distance (`pts111[104]`–`[105]`).
4. **Candidate.** A pair is a candidate when the cost is ≤ 0.5, the pose nose (if visible) lies inside the face box padded by 10 %, and `maskCoversFace(face, mask)` holds (≥ 0.5) when the body has a mask (`faceProtectModel.ts:59-96`).
5. **Greedy.** Candidates are taken in ascending cost, 1:1.
6. **Unpaired.** An unpaired face is a face-only person whose id is its face id `f<i>`. An unpaired body is a body-only person whose id is its body id `b<j>`. Body ids are given by pose-bbox centre x on the first body detection; a later body detection (the v1 people ≥ 2 case, §5.3) keeps `b0` for the matched old pose and gives new bodies the lowest free `b<j>`.
7. **One face, one pose** (A14). When the photo has exactly one face and one pose, and the pose nose is visible and lies inside the face box padded by 25 %, they pair whatever the cost (a full-body shot with a small face, where pose face points can be off by more than 0.5 IOD).
8. **Ids never change** (RM §3.6, r2). A pairing found later (bodies after faces, or faces after 基本模式) only links the existing person to the new face or body; the person keeps its id and its params.

**Session**

| # | Anchor | Decided approach | Sub-step |
|---|---|---|---|
| S1 | `StillSession.face` `still.ts:9`; options `63-71`; detect `87-92`; protect bound to face `70-71, 104`; `input()` `109-118`; `detectOnce` `296-310` | The session interface changes as listed below this table. | 1c |

S1 interface changes:

- `face` → `faces: readonly SessionFace[]`, where `SessionFace = {id, face: Face, box: Rect, lm: Float32Array}`, plus `obstacles: readonly CachedObstacle[]` from `prepareFaces`. `faceKnown` is kept.
- `opts.face` → `opts.faces?: readonly CachedFace[]` and `opts.obstacles?`. Given → no detection, with or without a tracker; the faces are adapted at the bitmap size.
- `opts.faceProtect`, `setFaceProtect` and `faceProtect` are removed (A6).
- `render(frame)`, `prepareExport(frame)`, `exportReady(frame)` and `exportImageData(frame, body?)` take a `StillFrame = Omit<RenderInput, 'source' | 'width' | 'height' | 'body'>`. The session adds the source, the size and its body field, as today.
- `detectOnce` increments `__meiyan.detectCalls`. Debug `faces` is set from the result, and `face = faces.length > 0` keeps its e2e meaning (`editor.spec.ts:29, 148`).

**Engine**

| # | Anchor | Decided approach | Sub-step |
|---|---|---|---|
| E1 | `RenderInput` `types.ts:276-292`; `FrameJob` `pipeline.ts:53-75`; `job()` `index.ts:174-194` | `RenderInput` as §3.2. `job()` builds `FrameJob.faces: FrameFace[]`, one per listed face, with the reshape uniforms (yaw-attenuated and × weight, as `reshape.ts:355-366` does today), the makeup uniforms, `kSmooth`, `kRosy`, the protect layer and the cap. The skin uniforms come from `photo` plus the per-frame maxima `S` and `R` (§4.1). | 1c |
| E2 | `planPasses` `pipeline.ts:103-112`; white mask fallback `448, 460`; outside value `mask.ts:48, 158` | `planPasses` takes `anyFace` (any face with weight > 0) instead of `hasFace` / `faceWeight`. The mask is cleared to `(gS, gR)`, which is 0 whenever `globalSkin` is null. So when faces exist, a face whose person is neutral or not beautified gets no smoothing ("others untouched"). With no mask pass, the white texture keeps today's all-skin path. `mask.fill` (`mask.ts:11-14, 185-187`) becomes the clear. | 1c |
| E3 | R8 mask `pipeline.ts:385, 419`; composite scalars `composite.ts:167-170, 191-194` | M and N become **RGBA8**: R = 磨皮 strength, G = 紅潤 strength (§4.2). `fb()` ignores a format change on an existing FBO (`pipeline.ts:234-243`), so M and N are always RGBA8. maskWarp passes all channels through (`reshape.ts:318`). The composite reads `.r` for 磨皮 and `.g` for 紅潤 (§4.5). | 1c |
| E4 | `makeup.draw` `makeup.ts:192-225` | `draw(src, dst, faces: {face, u}[])`: one copy, then one 176-triangle mesh draw per face whose makeup is active, each reading `src`. `MESH_FS` (`makeup.ts:89-96`) discards fragments whose combined multiply factor is ≥ 0.999 in every channel, so a later face's mesh never erases an earlier face's lip or blush where the later face has none; "last wins" applies only where both faces have makeup (§4.3). | 1c |
| E5 | `RESHAPE_FS` `reshape.ts:214-319`; `draw` `355-406`; hash pin `reshapeCpu.test.ts:32` (`'ced9563c'`); CPU port `reshapeCpu.ts:53-143` | Face table behind one accessor `F(f, i)`, a loop over faces, summed displacements, the cap as a displacement budget, protect window layers (§4.4). The table carrier (RGBA32F texture or std140 UBO) is chosen by the Phase 0 bench (§6.3 PG1/PR1). The CPU port gets the same loop and the hash is pinned again. | 1c |
| E6 | Overlay `pipeline.ts:486-490`; `index.ts:228-231` | The debug overlay (`showLandmarks`) draws every listed face. The selected face is marked by the DOM boxes, not by the engine. | 1c |

**瘦臉 limit**

| # | Anchor | Decided approach | Sub-step |
|---|---|---|---|
| F1 | `FaceProtectSource` `faceProtectModel.ts:150-233` (single `cur`, `bodyOk`); `buildFaceProtect` `faceProtect.ts:107-145` | The changes are listed below this table; §4.7 gives the region rules. | 1c |

F1 changes:

- `FaceProtectSource.update(faces: ProtectRequest[], requested): ReadonlyMap<string, FaceProtect>`, with `ProtectRequest = {id, face, contour: boolean, regions}`.
- One memo entry per face id, keyed on the face object, its own mask and the other regions. Switching or adding faces never rebuilds a limit that is still valid.
- A limit is built only for a face whose person draws a contour warp (`contourActive` per person, `faceProtectModel.ts:46-49`), and at most one limit is built per animation frame (§6.1); a face whose limit is still pending renders without it for those frames, as a single face does today before its limit exists.
- `ProtectRegions` (§4.7) list every other selectable face **and every obstacle** (their ovals and centres), the other body persons' masks, and the window.
- The request stays photo-level and sticky: any contour edit on any person requests it.
- The selfie segmenter still runs at most once per photo, and its mask is still stored once (`HistoryEntry.faceMask`).
- `record()` reports the photo-level flag exactly as today (`faceProtectModel.ts:242-251`).
- `buildFaceProtect(face, regions, width, height)` gains the regions argument (§4.7). The single-face result is unchanged.

**Editor**

| # | Anchor | Decided approach | Sub-step |
|---|---|---|---|
| U1 | `.zoom-layer` `Editor.tsx:832-841`; `zoomPan.ts:52-57, 82, 103-125`; `HeightBandOverlay.tsx:232-235` | `FaceBoxes` (drawn, not buttons) and `PersonStrip` (§2.1); `useZoomPan(stage, layer, enabled, opts?: {onTap?})` with the tap mapped through the layer rect, the callback read through a ref, and `--zs` written by `apply` (§2.1, §2.3) | 1d |
| U2 | `keyOf` `Editor.tsx:68`; `saved` init `102`; `stampIs` `editorModel.ts:328-333` | `OutputStamp.key = editKey(edit)`. The selection changes nothing in the output, so it is not in the key. A reopened entry starts saved with `editKey(openState(entry).edit)`. A new protect map bumps `fieldGen` and `fieldTick`, as the limit does today (`Editor.tsx:595-597`). **Detection-driven rebases** (`assignPersons`, `withBodies`, the `p0` hand-over, `renamePersons`) must not look like edits: when `stampIs(saved, editKey(prev), …)` held before the rebase, `saved` becomes `{key: editKey(next), field: saved.field}` and the Editor queues `updateEntry(id, {schema: 2, edit, params, paramsKey, detect}, {touch: false})` (A17). If the rendered frame changed (`stableKey(buildFrame(…))` before ≠ after: a v1 group photo whose primary is not MediaPipe's old `faces[0]`, §1.1 item 10), a new thumbnail follows, also with `touch: false`. | 1b |
| U3 | `UndoLike<BeautyParams>` `Editor.tsx:152-161, 169-180, 739-754`; 重置 `761-769` | `UndoStack<EditState>` with `{clone: false, key: editKey}` and `rebase(fn)` (RM §3.4). `update(edit, commit)` keeps its draft gating. 重置 is one step for every person and the photo (RM §3.4). ↶ ↷ compute which persons changed (by key), set `.changed` on their brackets and chips for 600 ms, and toast when only other persons changed (§1.1 item 8). | 1b |
| U4 | `lastSel` `Editor.tsx:66, 163-166` | `PanelSelection` stays module-level; `Selection` is per-photo `useState` (§2.2) | 1b |
| U5 | `faceNote` `Editor.tsx:789-797`; `FACE_TABS` `BeautyPanel.tsx:43, 54-55, 63, 147`; debug `face` | `noteFor(tab, lens.applies)`: the photo-level notes of today apply first (no face in the photo, 基本模式, tracker health); then the person notes of §2.4, in the 美體 order given there. 美膚 gates 磨皮 and 紅潤 per item, not with `.strip.face-off`. `BeautyPanel` takes `faceNote` and a new `bodyPersonNote`. Debug fields as §3.2. | 1d |

**Camera**

| # | Anchor | Decided approach | Sub-step |
|---|---|---|---|
| C1 | Stage click `Camera.tsx:260-264`; canvas `object-fit: cover` (`Camera.tsx:342`); mirror at present `live.ts:124` | The mapping is listed below this table. | 1e |
| C2 | `Shot` `state.ts:17-25`; `Camera.tsx:218`; `Review.tsx:84-92`; crop `imaging.ts:12-23, 50-65` | `Shot` gains `look: CameraLook` (replacing `params`) and `faceSeed: FaceSeed`. The mapping is listed below this table. Review's 編輯 passes `{edit: cameraShotEdit(look, seed), faceSeed}`. Landmarks are never handed over: the pts111 sides are image-sided (`adapter111.ts:3-4`). | 1e |
| C3 | `AppState.params` `state.ts:53-54, 77`; `settings.ts:10, 25-31, 106-111` | `AppState.look`, key `meiyan.look.v1`; first load migrates `meiyan.params.v1` through `splitLegacy` and leaves the old key alone; `hasSavedSettings` checks both. No per-face camera params (approved). | 1b |

C1 mapping:

1. Canvas rect `r`, video size `(vw, vh)`, scale `s = max(r.w/vw, r.h/vh)`.
2. `u = (x − r.left − (r.w − vw·s)/2) / (vw·s)`, and `v` likewise.
3. For `facing === 'user'`, `u = 1 − u` (the preview is mirrored).
4. `loop.hitTest(u, v)` tests the shown track boxes, each expanded to at least 44 × 44 pt (half-width `22 / (s·vw)` in u, and likewise in v); among several hits, the nearest box centre wins.
5. `cameraTapAction` (§2.5) decides: select (haptic, ring), turn 全部套用 off and select, or toggle the collapse as today.
6. The floating slider row, `.status` and buttons are excluded as today (`Camera.tsx:261`).

C2 seed mapping: `rect = centerCropRect(vw, vh, ratio)`, `x' = (x·vw − rect.x)/rect.width`, `y' = (y·vh − rect.y)/rect.height`, **not clamped** (a seed outside the crop must not match an edge face). Then `x' = 1 − x'` when the shot is saved mirrored (`Camera.tsx:205`). The seed is the centre of the track's last raw detected box, `'all'` under 全部套用, and null when no face was tracked. `cameraShotEdit` sets:
- `photo` from `look.photo`, plus the editor defaults for editor-only fields;
- `primaryInit = look.person`, and `persons = {p0: look.person}` (§3.3 item 2);
- `template = neutralPerson()` for a point seed (the other faces were not beautified in the shot), or `look.person` for `'all'` or null (RM §3.7).

Seed matching in the editor (`seedPrimary`): the seed matches the face whose box, padded by 25 %, contains it (the nearest box centre if several do). 0.25 of the short edge, the earlier radius, is about the spacing of neighbouring faces in a group selfie, so a missed face would have matched its neighbour. The matched person is the primary and gets `p0`. If no box contains a point seed, the primary is chosen by score and **`p0` is discarded**: everyone starts from `template` (neutral), and the photo part is kept. Giving the look to a face the camera did not beautify would be wrong; the user can select the right face and apply 一鍵 there.

**Tests**

| # | Anchor | Decided approach | Sub-step |
|---|---|---|---|
| X1 | `fakeTracker` `testFakes.ts:190-212`; `makeBodyDetection` `testFakes.ts:221-236`; t7 fakes `tests/harness/t7/fakes.ts:179-241`; one-face fixtures only; `playwright.config.ts:7, 33-46` | Multi-face fakes: `fakeTracker(clock, faces = 1)` returns `faces` copies of `makeLandmarks()`, shifted 0.3 apart in x and scaled 0.6, and `null` from `detectVideo` while it is marked unusable. `makeBodyDetections(n)`. A fake `MPMask` that counts live arrays (P2). Group fixtures, parity goldens and the `chromium-group` project (§8). The harness typecheck (`tsconfig.json:20`) covers the new fakes. | 1a, 1c, 1e |

### 3.5 Limits (`src/config/limits.ts`)

| Constant | Default | Meaning | Set by |
|---|---|---|---|
| `MAX_EDIT_FACES` | 6 | Selectable faces per photo | §6.3 PD1, PR1, PE1, PM1 |
| `EDIT_DETECT_FACES` | `MAX_EDIT_FACES + 2` | `numFaces` of the editor's IMAGE detection (A1) | follows |
| `MAX_RENDER_FACES` | 6 | Shader loop bound and face-table height (compile-time) | fixed |
| `MAX_EDIT_BODIES` | 4 | `numPoses` | §6.3 PB1, PM1 |
| `MAX_LIVE_FACES` | 3 | Camera `numFaces`; 1 hides the camera's 選臉 | §6.3 PL1, PL2, PJ1 |
| `MIN_FACE_FRAC` | 0.03 | Minimum face box width / short edge | fixed |
| `LOST_HOLD_MS` | 1000 | Camera: a missing track is kept this long | fixed |
| `ONE_EURO` | `{minCutoff: 0.05, beta: 80, dCutoff: 1.0}` (Hz; values scaled by 1 / face size) | Camera smoothing, MediaPipe's own values (T4) | §6.3 PJ1, J2 |
| `SEED_BOX_PAD` | 0.25 | Seed → face match: the face box padded by this fraction must contain the seed | fixed |
| `PROTECT_WINDOW` | 128 | Protect layer edge with ≥ 2 selectable faces (§4.7) | fixed |
| `MAX_OBSTACLES` | 8 | Obstacles kept in a cache (validation bound) | fixed |

---

## 4. Engine and shader changes

### 4.1 Frame building (`index.ts` `job()`, `src/edit/frame.ts`)

1. **Faces.** `buildFrame` lists every selectable face in cache order. Each gets `weight 1`, its person's `PersonParams` (or `neutralPerson()` for a face whose person has no entry yet) and its protect. `obstacles` are the box centres of `detect.obstacles`. `globalSkin` is `{p.smooth, p.rosy, weight: 1}` of the primary person (`p0` or the primary body person) only when the photo has no face.
2. **Skin maxima.** Over faces with weight > 0, plus `globalSkin` when present: `S = max smooth`, `R = max 0.35·rosy` (`ROSY_MAX_OPACITY`, `uniforms.ts:96`). Per face, `kS_f = S > 0 ? smooth_f / S : 0` and `kR_f = R > 0 ? 0.35·rosy_f / R : 0`.
   - The composite gets `uSmooth = S` and `uRosy = R`.
   - `uWhiten`, `uSharpen` and `uFilterAmt` come from `photo` (`uniforms.ts:102-111`).
   - `needsMean` is `S > 0 || R > 0`.
3. **Caps** (approved influence cap; RM §4.3, r2). `capsFor(faces, obstacles, aspect, presence)` (`src/engine/passes/faceCap.ts`) runs in `job()`, so the editor and the camera share it. For face f with box centre `c_f` (oval bbox, T3):
   - `cap_f = ½ · min_g isoDist(c_f, c_g) / p_g`, over every other listed face (weight 0 included) and every obstacle. `p_g` is 1 in the editor and for obstacles. In the camera it is the neighbour track's presence easer (150 ms, T4), clamped below at 1e-3, so a face entering or leaving the view tightens or releases its neighbours' caps over 150 ms instead of in one frame.
   - A face without a neighbour (no other listed face and no obstacle, or every `p_g` = 0) has **no cap**: texel 73 holds −1. One face therefore warps exactly as today.
   - `cap_f = 0` (coincident centres, which the de-duplication of T3 and T4 rules out in practice) is a valid cap with zero influence, not "off".
   - With a cap, the face's influence box (texel 72) is intersected with the AABB of the disc `(c_f, cap_f)`. The displacement is 0 beyond `cap_f` (§4.4), so the clip is exact, and it makes fragments that run two chains rare.
   - The cap is the same budget as the 瘦臉 limit (§4.4), so it has no on/off threshold inside a photo: a slider drag never switches it. The `U_MAX` influence box (A3) is used only for the protect window (§4.7).
4. **Order.** The table order is the cache order (`f0`…), so packing is deterministic.

### 4.2 P0 skin mask (RGBA8)

- **Clear** to `(gS, gR, 0, 1)`: `gS = globalSkin ? weight · smooth/S : 0`, and likewise `gR` with rosy and `R`.
- **Geometry.** `buildMaskGeometry` (`mask.ts:58-125`) keeps its triangles but emits them as all fans first, then all ring triangles, then the holes, and returns `[count, base, fanEnd]`. `mask.test.ts` reads only the first two, which keep their meaning (`base` = fans + rings = 36 × 9).
- **Draw order**, over all faces, with the output `uG + uWK · smoothstep(0, 1, v)`, where `uG = (gS, gR)` and `uWK = w_f · (kS_f, kR_f)`:
  1. every face's ring with `blendEquation(MAX)`;
  2. every face's fan with blending **off** (v = 1, so each fan writes its own `uG + uWK_f`): inside its own oval a face's strength always wins, so a neighbour's 8 % FW ring (`mask.ts:20, 96-104`) never lifts a neutral face's cheek border;
  3. every face's eye and mouth holes with `MIN`.
- **Parity.** Fan and ring do not overlap for a star-shaped oval (the ring is pushed radially out of each edge, `mask.ts:96-104`), and both carry value 1 along their shared edges, so with one face the new order changes nothing. Today's shader writes `1 − w + w·m` over a clear of `1 − w` with blending off (`mask.ts:41-49, 156-184`). With one face, `uG = 1 − w`, `uWK = w` and `k = 1` give the same value, and MAX over a clear that is ≤ every ring fragment equals blending off. In the editor (`w = 1`), `uG = 0` and `uWK = 1` exactly, so M.r and M.g equal today's R8 mask bit for bit.
- **Multi-face.** Overlapping rings take the larger strength. A ring that reaches into another face's oval is overwritten there by that face's fan. Where two ovals overlap, the later fan wins. Holes always win, because they are drawn last.
- Channels B and A stay unused until step 4 (RM §4.2).

### 4.3 P1 makeup

One copy of `src` into A, then per face with active makeup (`makeupActive(makeupUniforms(person, w))`): upload pts111, set the face's intensities and shades, draw the mesh (`makeup.ts:200-223`). The uniform builder takes `(values, shades, weight)` instead of `BeautyParams`.

`MESH_FS` (`makeup.ts:89-96`) writes `base · mul` on every fragment of the mesh, reading `src`. A later face's mesh would therefore erase an earlier face's lip or blush wherever the meshes overlap, even where the later face has no makeup. So the shader gains one line:

```glsl
vec3 m = mix(vec3(1.0), lipMul, uLipI) * mix(vec3(1.0), blushMul, uBlushI * vBlushFade);
if (all(greaterThanEqual(m, vec3(0.999)))) discard;   // keeps A's copy (= src) bit for bit
outColor = vec4(base * m, 1.0);
```

With one face the change is below 1/255 (a discarded fragment keeps `src`, where `src · m` differed by at most 0.001). "Last wins" (approved) now applies only where both faces have makeup.

### 4.4 P2 reshape: face table, summed displacements, cap

**Face table.** One packed `Float32Array` of `96 × MAX_RENDER_FACES` vec4 (9.2 KB), read through one accessor `F(f, i)`. Two carriers share it, chosen at compile time by `#define FACE_TABLE_UBO`:
- **Texture:** `RGBA32F`, width 96, height `MAX_RENDER_FACES`, `NEAREST` and `CLAMP_TO_EDGE` (`createTexture` defaults to LINEAR, `gl.ts:108`, and a LINEAR float texture is incomplete), read only with `texelFetch`, re-uploaded with `texSubImage2D` when the packed key changed.
- **UBO:** a std140 block `vec4 uFaceTab[576]` (9.2 KB, within the guaranteed 16 KB), updated with `bufferSubData` when the packed key changed. The indices are dynamically uniform, so Apple GPUs can serve them from constant memory.

Phase 0 benches both (PR1, §6.3) and the faster ships; a PG1 failure forces the UBO.

| Texels | RGBA |
|---|---|
| 0–55 | `pts111`: texel i holds point 2i in `.xy` and point 2i+1 in `.zw` (the last `.zw` is unused) |
| 56–59 | `ext[0..7]` |
| 60–62 | V-face targets `vTargets[0..5]` |
| 63–64 | narrow targets `narrowTargets[0..3]` |
| 65 | `chinTarget.xy`, `eyeDisp.xy` |
| 66 | slim, v, narrow, chin (yaw-attenuated, × weight) |
| 67 | forehead, nose, mouth, eye |
| 68 | `eyeR.x`, `eyeR.y`, `mouthR`, protect layer (−1 = none) |
| 69 | the face's `uProt`: reach `PROTECT_REACH·fw`, slope, ramp, smooth `PROTECT_SMOOTH·fw` (`reshape.ts:202-205, 397-398`) |
| 70–71 | reserved, zero (step 5: right-side strengths for 左右分開) |
| 72 | influence box (minX, minY, maxX, maxY), clipped to the cap disc's AABB (§4.1); `EMPTY_BOX` when the face draws no warp (`reshape.ts:322, 363-365`) |
| 73 | cap: centre `c_f` (UV), `cap_f` (iso; **−1 = no cap**), `κ_f = PROTECT_SMOOTH·fw` |
| 74 | protect window: `x0, y0, 1/w, 1/h` in UV (`0, 0, 1, 1` for the whole-photo grid, §4.7) |
| 75–95 | spare (step 5) |

The program's uniforms are then `uSrc`, `uBodyDisp`, `uBodyOn`, `uFaces` (texture carrier only), `uProtArr`, `uCount` and `uAspect`, plus the block in the UBO carrier. That is fewer than 32 vectors outside the block for any N; today a single face needs about 146 (`reshape.ts:217-233`).

**Shader** (structure; the chain body is today's `reshape.ts:292-316`, reading its uniforms from the table):

```glsl
const int MAX_RENDER_FACES = 6;
#ifdef FACE_TABLE_UBO
layout(std140) uniform FaceTab { vec4 uFaceTab[96 * MAX_RENDER_FACES]; };
vec4 F(int f, int i) { return uFaceTab[f * 96 + i]; }
#else
uniform highp sampler2D uFaces;           // RGBA32F, NEAREST
vec4 F(int f, int i) { return texelFetch(uFaces, ivec2(i, f), 0); }
#endif
uniform mediump sampler2DArray uProtArr;  // R16F, LINEAR, one layer per face with a limit
uniform int uCount;
vec2 P(int f, int k) { vec4 t = F(f, k >> 1); return (k & 1) == 0 ? t.xy : t.zw; }

// The 瘦臉 limit's budget and smooth minimum (reshape.ts:267-278), factored out: it returns Ln / L, or 1.0 when the
// budget does not bind. protectContour keeps `s >= 1.0 ? tc : tc0 + g * s`, so the single-face limit is bit-identical.
float budgetScale(float L, float t, float l, float slope, float k) {
  float x = t / max(l, 1e-6);
  float B = t <= 0.0 ? 0.0 : (t < l ? slope * l * x * x * x * (1.0 - 0.5 * x) : slope * (t - 0.5 * l));
  float h = max(k - abs(L - B), 0.0) / k;
  float Ln = max(min(L, B) - 0.25 * h * h * k, 0.0);
  return Ln >= L ? 1.0 : Ln / L;
}

void main() {
  vec2 tcB = vUv;
  if (uBodyOn != 0.0) tcB += uBodyOn * texture(uBodyDisp, vUv).xy;   // body stays the outer map
  vec2 acc = vec2(0.0), only = tcB;
  int hits = 0; bool anyCap = false;
  for (int f = 0; f < MAX_RENDER_FACES; f++) {
    if (f >= uCount) break;
    vec4 box = F(f, 72);
    if (any(lessThan(tcB, box.xy)) || any(greaterThan(tcB, box.zw))) continue;
    vec2 tc = faceChain(f, tcB);            // contour → protect (layer F(f,68).w, window F(f,74)) → nose, mouth, eyes
    vec2 d = tc - tcB;
    vec4 cap = F(f, 73);
    if (cap.z >= 0.0) {                     // the cap: the same budget, centred on c_f, 0 beyond cap_f
      d *= budgetScale(length(iso(d)), cap.z - distance(iso(tcB), iso(cap.xy)), PROTECT_RAMP * cap.z, PROTECT_SLOPE, cap.w);
      anyCap = true;
    }
    acc += d; only = tc; hits++;
  }
  // one face without a cap: its chain output itself, so the single-face map is bit-identical to v0.3
  vec2 tc = (hits == 1 && !anyCap) ? only : tcB + acc;
  outColor = texture(uSrc, tc);              // one resample
}
```

- **Summed, never chained.** Every face's chain starts from the same `tcB` (detected-landmark coordinates in the source after the body map, as `reshape.ts:288-290` requires today), and only the displacements add. With caps, every face's support lies in its disc of radius `cap_f` ≤ half the distance to its nearest neighbour, so the supports are disjoint: at most one non-zero displacement reaches any fragment.
- **The cap is a budget, not a window** (RM §4.3, r2). `t = cap_f − |tcB − c_f|_iso` is 1-Lipschitz, the budget `B(t)` is 0 for `t ≤ 0`, eases in over `PROTECT_RAMP·cap_f` and then rises with slope `PROTECT_SLOPE`, and `|d|` is replaced by the smooth minimum of `|d|` and `B` (width `κ_f`). So:
  - the influence is exactly 0 beyond `cap_f` (the approved rule);
  - where `B ≥ |d| + κ_f` (near the centre: the eyes, nose and mouth of any face at ≥ 1.2 FW spacing) the warp is exactly the face's own;
  - what the cap adds to the Jacobian is bounded as for the 瘦臉 limit (`faceProtect.test.ts:170`: det J ≥ 1 − PROTECT_SLOPE − 0.02), instead of the window's `d ⊗ ∇w` term (|∇w| up to 7.5/FW at 1 FW spacing, right where the cheek moves most, about −0.45 of det J);
  - it is continuous in `cap_f`, so there is no pop.
- **Protect.** Inside `faceChain`, `protectContour(tc0, tc)` (`reshape.ts:267-278`) samples `textureLod(uProtArr, vec3((tc0 − win.xy) * win.zw, layer), 0.0)` when the face's layer is ≥ 0, where `win = F(f, 74)`. `textureLod`, not `texture`: the call sits in non-uniform control flow (after a per-fragment `continue`), where implicit derivatives are undefined. The layer index is a texture coordinate, so the rule that sampler arrays need constant indices does not apply.
- **GL plumbing.** `gl.ts` gains `createTextureArray(gl, w, h, layers, internalFormat)` and `bindTextureArray(gl, unit, tex)`: `bindTexture` binds only `TEXTURE_2D` (`gl.ts:151-154`). The unit cleanup (`pipeline.ts:466`) also unbinds `TEXTURE_2D_ARRAY` on unit 2. When no face has a limit (the camera, or no contour edit), a 1 × 1 × 1 zero R16F array is bound on unit 2 (today's `zero` is a 2D texture, `reshape.ts:351-352`). `PROTECT_RAMP` and `PROTECT_SLOPE` are written into the shader source from `reshape.ts:202-205`, as the `SLIM` tables are, so the GPU and the CPU port share one definition.
- **Context loss.** The face-table key and the per-layer protect keys live in the per-context pipeline closure next to `bodyKey` and `protKey` (`pipeline.ts:250-256`) and are reset in `dispose` (`pipeline.ts:504-508`), so `onRestored` → `build()` (`index.ts:98-110`) re-uploads them.
- **Shader compile** happens on first use today (`reshape ??= …`, `pipeline.ts:401`); bench row RC (§6.2) decides whether it moves to `build()`.
- **maskWarp** draws the same program into N, with the image's aspect (`pipeline.ts:414-423`).
- **Fold and strength sweep** (CPU port, `reshapeCpu.test.ts`; RM §4.3, §8.1, r2):
  - Layouts: centre distance 0.6–2.6 FW in 0.1 steps × directions 0°, 45° and 90° × {2 faces, 3 in a row} × yaw {0, 0.3}.
  - Settings: every one-way 美型 item at its maximum, combined with each end (0 and 1) of 下巴, 額頭, 嘴型 and 眼距.
  - Fold: `min det J ≥ MIN_DET` (0.35, `field.ts:70`), measured with `faceProtect.test.ts` `measure()`; the bound is never relaxed.
  - Strength: at ≥ 1.2 FW spacing, the eye, nose and mouth displacement (mean over `featurePolys`) keeps ≥ 0.9 of the single-face value; 下巴 and 額頭 keep ≥ 0.9 at ≥ 2.0 FW. Closer than that, the approved radius rule cuts them (§7, §11 Q5).
  - Editor safety net: on a slider commit with ≥ 2 capped faces, the CPU port checks `min det J` on a 65 × 65 grid over each capped face's box. Below `MIN_DET` (it should never be), a per-face strength scale `λ_f` is bisected in 6 steps, as `buildBodyField` does (`field.ts:148-160`), and multiplies that face's strengths in the table until the next change. The cap shape is never changed for this.

### 4.5 P5 composite (`composite.ts:158-201`)

```glsl
vec4 mk = texture(uMask, vUv);
float ramp = clamp((min(I.r, Mn.r - 0.1) - 0.2) * 4.0, 0.0, 1.0);
float pS = ramp * mix(1.0, mk.r, uMaskOn);   // 磨皮 gate (was p, line 167-168)
float pR = ramp * mix(1.0, mk.g, uMaskOn);   // 紅潤 gate (was p, line 193)
```

`kMin` uses `pS` and the 紅潤 mix uses `pR`. Every other line is unchanged. The white stand-in texture gives `pS = pR = ramp`, exactly today's no-mask path. 美白 stays unmasked (GPUPixel parity, `composite.ts:187-189`, asserted by `engine.spec.ts:82-84`).

### 4.6 Multi-person 美體 field (`field.ts`)

```ts
type LocalBodyId = Exclude<Extract<ParamId, `body.${string}`>, 'body.legs'>;
interface BodyPersonInput { id: PersonId; measure: BodyMeasure; values: Record<LocalBodyId, number> }
interface BodyFieldInput {
  /** persons with a body and any non-neutral local item */
  edited: readonly BodyPersonInput[];
  /** every body person's mask, edited or not (the other persons each edited person must not move) */
  masks: readonly { id: PersonId; mask: PersonMask }[];
  heightBand: HeightBand | null;
  /** 長腿, measured on the anchor person (below) */
  legs: { value: number; measure: BodyMeasure | null };
  bodyProtect: boolean;
  aspect: number;
}
buildBodyField(input, prev?, longEdge?): BodyField | null
```

**長腿 anchor:** `photo.legsAnchor` when that person has a body. Otherwise (null, or a person without a body) it is the primary person if it has a body, else the body person with the highest `score`.

1. **Bands** as today (`field.ts:112-119`): 增高 from `heightBand`, 長腿 from `legs`.
2. **Per person p:** `localTerms(m_p, values_p)` and the per-term 背景保護 weights from **p's own** mask grid (`field.ts:258-312`). This gives `L_p` before relaxation.
3. **Other persons as a budget** (RM §4.5, r2). `d_others,p` is the EDT, in Q units on the field grid, to the union of the other body persons' masks (0 inside them), cached per (mask set, grid size). Every texel of `L_p` is limited in magnitude: `|L_p| ← smin(|L_p|, 0.45 · d_others,p)`, with the same polynomial smooth minimum as the 瘦臉 limit (width 2 texels). The budget is 0 inside another person and rises with slope 0.45, so it adds at most about 0.45 to the Jacobian (the 瘦臉 limit's bound), whatever the gap between the persons: a fixed 1.5 % feather would add about `1.5·|L_p| / 0.015` there, and `relaxBackground` keeps the original field in gaps ≤ 0.03 (`field.ts:218-224`), exactly the gap between close persons. With one person there are no others and no budget, so the field is byte-equal to today's.
4. **Per-person fold guard.** `L_p` (budgeted, assembled through the bands) gets its own λ_p, bisected as today (`GUARD_STEPS_FULL` / `GUARD_STEPS_DRAFT`, `field.ts:78-79, 148-160`) when its `fieldMinJacobian` is below `MIN_DET`. A drag on person 2 therefore never scales person 1.
5. **Sum:** start from the first person's grid (no added zero arrays, so one person is bit-identical), then add the others.
6. **Relax once** (`relaxBackground`, `field.ts:316`) on the sum, with `inside` = the union of every person's mask, so every person's texels are held fixed.
7. `keepInFrame`, assemble through the bands, then the global λ guard over the summed local part (`field.ts:146-160`) as a **last resort** only. Its value is exposed as `bodyFieldCacheStats.lambdaGlobal` (1 when it did not act); the independence tests assert it is 1.
8. **Memo:** `BodyFieldMemo` (`editorModel.ts:235`) keys on every person's local values and measure identity, the band, 長腿 with its anchor, and `bodyProtect`. A drag rebuilds only the dragged person's budgeted, guarded `L_p` (cached per `(person, values, measure, others, grid size)`), then reruns steps 5–7 at draft size.

### 4.7 Per-face 瘦臉 limit regions (`faceProtect.ts`)

```ts
interface ProtectRegions {
  /** this face's person: its paired pose mask, else the selfie mask; null = the oval alone */
  own: PersonMask | null;
  /** true when `own` is the shared selfie mask: clip it to this face's Voronoi cell */
  clipToCell: boolean;
  /** box centres (UV) of every other selectable face and every obstacle, for the cell */
  otherCentres: readonly [number, number][];
  /** ovals of every other selectable face and every obstacle (CachedObstacle.oval) */
  otherOvals: readonly Float32Array[];
  /** pose masks of the other body persons */
  otherMasks: readonly PersonMask[];
  /** null = today's whole-photo grid (one selectable face); else this face's window (step 5) */
  window: Rect | null;
}
```

1. **Own region.** `own ≥ 0.5`, ∩ the face's cell (iso nearest-centre) when `clipToCell`, ∪ the own oval, connected to the oval (`keepConnected`, `faceProtect.ts:122-123`). Then the **raw** signed distance `sd_own_raw` as today, before any blur (`faceProtect.ts:124-137`).
2. **Others** = the other ovals ∪ the other masks ∪ (when `clipToCell`) the selfie texels outside the own cell, minus the own oval. `d_O` is the distance to others (EDT, iso units, 0 inside).
3. **Combine, then smooth** (A4): `sd_raw = max(sd_own_raw, R_f − d_O)`, where `R_f = PROTECT_REACH · fw`. Then today's three box blurs and the clamp (`faceProtect.ts:138-143`) run on `sd_raw`. Inside another person the budget `R − sd` is ≤ 0, so nothing moves there. The max of two 1-Lipschitz functions is 1-Lipschitz and box means keep that, so the slope bound of `reshape.ts:186-201` holds; blurring **after** the max rounds the kink where the two terms cross, which would otherwise crease the wall lines (`faceProtect.ts:9-10`).
4. **Single face:** no others, the cell is the whole photo and the grid is today's, so the result is byte-equal.
5. **Grid.** With one selectable face the grid is the photo's `protectGridSize` (`faceProtect.ts:24-27`), as today. With ≥ 2 selectable faces, every face gets a `PROTECT_WINDOW` = 128 × 128 window: the square (in iso units) around the face's `U_MAX` influence box (A3), padded by `R_f`. The chain runs only inside that box, so the window covers every sample. On the photo-wide 256 grid a face 5 % of the width has about 13 texels per face width (κ ≈ 0.3 texel, the ramp ≈ 1.2 texels, the blur radius clamped to 1 texel, `faceProtect.ts:141`); in its window it has about 49 at any size, so the smoothness the slope and crease bounds rely on holds for small faces too.
6. **Engine:** one `R16F` `TEXTURE_2D_ARRAY` with one layer per face that has a limit; the layer size is the photo grid (one face) or 128² (≥ 2 faces). The window transform rides in texel 74. A layer is re-uploaded with `texSubImage3D` when its object or version changes; the array is reallocated only when the layer count grows or the layer size changes.

### 4.8 GPU resources (step 1 delta)

Worst case is a square working image (2048 × 2048); the numbers at 2048 × 1536 are about ¾ of these.

| Resource | Before | After | Extra at 2048 × 2048 |
|---|---|---|---|
| M, N skin mask (¼ res, 512²) | R8 | RGBA8 | +0.79 MB each |
| Face table | — | RGBA32F 96 × 6 (or a 9.2 KB UBO) | 9.2 KB |
| Protect | one R16F 2D, ≤ 256 edge | R16F 2D array: one ≤ 256-edge layer (one face) or ≤ 6 layers of 128² | ≤ 0.19 MB |
| **Total** | | | **≤ 1.8 MB** |

Texture units in P2: src 0, body 1, protect array 2, face table 3 (texture carrier only; the WebGL2 minimum is 16). The composite is unchanged (units 0–7).

---

## 5. Persistence and migration

### 5.1 Stored fields (step 1)

`HistoryEntry` (`types.ts:379-405`) gains the RM §5.1 fields that step 1 uses: `schema?: 2`, `edit?: EditState`, `detect?: DetectionCache` and `paramsKey?: string` (RM §5.1, r2). `params` stays and holds `legacyProjection(edit, primary)` (the photo plus the primary person), so a rollback to 0.3 still opens the entry with the primary's look. `paramsKey = stableKey(params)` (`undo.ts:65`) is written with every v2 write: 0.3's `updateEntry` spreads the stored record (`history.ts:85`), so an entry edited in 0.3 after a rollback has a new `params` but a stale `edit`, and the key tells 0.4 so (§5.3). `body` (v1) is read for migration and never written by 0.4. There is no IndexedDB schema bump (`history.ts:15-18`). `addEntry`, `updateEntry` and `normalizeEntry` copy the new fields explicitly (`history.ts:30-44, 75-97, 161-180`).

### 5.2 Write points

`updateEntry(id, patch, opts?: {touch?: boolean})`. Without `touch` the rule is today's: the write bumps `updatedAt` when the patch has `params`, `thumb` or `edit`. `touch: false` never bumps, whatever the patch holds (A17).

| When | Call | Patch | Bumps `updatedAt` |
|---|---|---|---|
| A new photo's first autosave or flush | `addEntry` (`Editor.tsx:306-317`) | original, thumb, size, `schema: 2`, `edit`, `params`, `paramsKey`, `detect` (when known), `faceProtect`, `faceMask?` | new entry |
| A user edit (every params write) | `updateEntry` through `paramsPatch` (`faceProtectModel.ts:136-148`, extended; `Editor.tsx:290-293`) | `schema: 2`, `edit`, `params`, `paramsKey`, thumb, `faceProtect`, `faceMask?` | yes |
| A detection-driven change: the first definite face answer (new detection, v1 reopen, 基本模式 merge, rematch), body detection, the `p0` hand-over | `updateEntry(…, {touch: false})` (U2) | `detect`; plus `schema: 2`, `edit`, `params`, `paramsKey` when the rebase changed `edit`; plus a thumbnail when the rendered frame changed | **no** (like today's body cache, `history.ts:69-74`) |

The Editor also moves its `saved` stamp across such a rebase (U2), so autosave does not fire for it. No cache is written while the answer is unsure (tracker recovering, detect threw). Viewing an entry, whatever detection it triggers, never reorders 最近編輯.

### 5.3 Reading and migration (`src/edit/migrate.ts`, lazy, at open)

`openState(entry, size): {edit, detect, needsFaceDetect, rematch}` runs in `openInEditor` right after the decode (`flows.ts:29`), with the decoded bitmap's size; Home's `openEntry` (`Home.tsx:85-105`) passes the raw entry through. It holds the only `cachedFits` call.

| Stored | Opened as |
|---|---|
| v1, no `body`, no `detect` | `edit = {photo, persons: {p0: person}, template: neutralPerson(), primaryInit: person}` from `splitLegacy(params)`; `needsFaceDetect`. At the answer, the primary gets `p0` (the v0.3 look, plus any edit made meanwhile) and everyone else `neutralPerson()`, since v0.3 left the other faces untouched. The cache and the rebased `edit` are written at once (`touch: false`). |
| v1 with `body` (people = 1) | As above, plus `detect.bodies = [b0 = body]` and `bodiesComplete = true`, so the pose model is not needed. Pairing runs on the detected faces and b0 (with A14). **The primary is the person that owns b0** (the body v0.3 edited), so the body edits stay on that body and the face edits join it (A13). If faces exist but b0 pairs with none: the face-score person is the primary and gets `p0`'s face part (skin, shape, makeup, shades, preset) with neutral local 美體 items, and b0's body-only person gets `neutralPerson()` plus `p0`'s nine local `body.*` values, so v0.3's body edits keep rendering on the body v0.3 edited. Without faces, b0's person is the primary and gets `p0`. |
| v1 with `body` (people ≥ 2) | `bodies = [b0 = body]` and `bodiesComplete = false`; the same primary rules. The first opening of 美體 runs body detection again and matches the old pose to the new list (mean distance of the keypoints visible in both < 0.05). The matched body keeps the id `b0` and its person; the other bodies get the lowest free `b<j>` and become appended persons from `template`. |
| v1 with `body: null` | `bodies = []`, `bodiesComplete = true` |
| v1 with a `detect` cache (defensive: 0.4 writes `edit` together with `detect`) | `edit` from `splitLegacy`, assigned at once to `detect.primary` through `p0` and `assignPersons`; no detection |
| v2 with `detect` and `cachedFits` (aspect within 1 %, as `editorModel.ts:148-152`) | Used as is. **No detector runs** (`detectCalls` stays 0), also without a tracker (§3.3). |
| v2 whose `detect` came from 基本模式 (`faceScans` without `{quarter: 0, flipH: false}`), opened with a tracker | `needsFaceDetect = tracker && !detect.faceScans.some(s => s.quarter === 0 && !s.flipH)`. One detection; `withFaces` merges the faces into the cache and keeps `bodies`. A face that pairs with an existing body person links to it (the person keeps its id and params); the other faces are appended as persons from `template`, except that `p0`, if present, hands over to the primary. Written with `touch: false` (A15). Without a tracker the cache is used as is. |
| v2 with `edit` and no `detect` (closed before a definite answer) | `edit` as stored, its `p0` included; `needsFaceDetect` |
| v2 whose `detect` is corrupt or does not fit | `detect` is dropped. `normalizeEntry` keeps `edit.persons` **unfiltered** (values sanitized) and returns `staleBoxes: Record<PersonId, Rect>`, the face box of every person that still has a readable face in the raw record. `openState` returns `{edit, detect: null, rematch: staleBoxes}`. After the detection, `rematchByIoU(staleBoxes, faces)` (box IoU ≥ 0.5, greedy) gives an old → new id map, and `rebase(renamePersons(map))` renames the persons, `photo.legsAnchor` and, from step 4, every spot's `owner` (an unmatched owner becomes null). New persons without a match get `template`; old persons without a match are dropped. Toast 「已重新偵測臉部，部分人物的設定已重設」. |
| v2 whose `edit` is not an object, or has `v !== 2` | Opened as v1, from `params` (and `body`) |
| v2 whose `paramsKey` ≠ `stableKey(sanitizeParams(params))` (`params.ts:279`; edited in 0.3 after a rollback) | The photo part and the primary person's part are rebuilt from `splitLegacy(params)`; every other person is kept from `edit` |
| `meiyan.params.v1` without `meiyan.look.v1` (camera) | `splitLegacy` → `meiyan.look.v1` on the first load |

The first write after any migration writes the v2 record (`schema: 2`). Nothing is rewritten in bulk. The face and body caps apply only to **new** detections (A16): a cache is used as stored, validated against `MAX_RENDER_FACES`, the body cap 4 and `MAX_OBSTACLES`, and never truncated, even when this device's tier lowers `MAX_EDIT_FACES` (PM1).

### 5.4 Validation (`normalizeDetect`, `sanitizeEditState`)

- **Cache:**
  - `v === 1`; finite positive `width` and `height`;
  - each face has `lm.length === 1434` with finite values, a finite box within [−0.1, 1.1], and a unique id matching `/^f[0-5]$/`;
  - each obstacle has a 72-float finite oval and a finite box; at most `MAX_OBSTACLES`; a bad obstacle is dropped silently;
  - each body has 132 finite pose floats, a mask of `w·h` bytes or null, and a unique id matching `/^b[0-3]$/`;
  - persons have unique ids matching `/^(f[0-5]|b[0-3]|p0)$/` (a person's id need not equal its face or body id, §3.2); each link names an existing face or body, and no face or body is linked twice; `primary` is a listed person;
  - **a cache without faces and bodies** (`faces = []`, `bodies` null or `[]`) is valid with exactly `persons = [{id: 'p0', face: null, body: null}]` and `primary = 'p0'`. `p0` is valid only in that form;
  - a corrupt face or body drops only that part and its link. A person other than `p0` left with neither face nor body is dropped, and the cache-dropped toast shows.
- **Edit:** `sanitizeEditState(raw, personIds | null)` (RM §3.4). It clamps every value to 0..1 and validates `filterId`, the shades and the preset ids. With a person list it drops persons not in it and adds missing persons from `template`; with `null` (the cache was dropped) it keeps every person for the rematch.

### 5.5 Sizes

Six faces × 5.7 KB, eight obstacles × 300 B, and four bodies × (528 B pose + ≤ 64 KB mask): about 300 KB per entry at the caps. `edit` for six persons is about 4 KB; `paramsKey` about 1 KB. `HISTORY_LIMIT` stays 12.

---

## 6. Performance budget and Phase 0

### 6.1 Budget (targets on the user's iPhone)

| Path | Budget |
|---|---|
| Editor first open of a group photo (detect at `EDIT_DETECT_FACES`, session, cache write) | ≤ 1.5 s after the model is warm |
| Reopen from cache | 0 detector calls; first frame ≤ 300 ms |
| Changing the selection | No render, no rebuild; UI only (≤ 1 frame) |
| Slider frame at 2048, 6 faces, every face item on | ≤ v0.3's single-face drag on the same phone + 12 ms, and ≤ 33 ms where v0.3 already meets it |
| Reshape program compile + link | ≤ 300 ms |
| Body detection (`numPoses` 4 and 4 mask readbacks) | ≤ 1.5 s, once; one cached mask array plus one transient readback buffer alive at a time (P2) |
| Body field, 4 persons | full ≤ 120 ms; draft ≤ 16 ms |
| 瘦臉 limits, 6 faces | ≤ 8 ms per face, at most one limit built per animation frame (never 48 ms in one task) |
| Camera, 3 faces, skin + reshape + makeup | ≥ 24 fps (target 30) at tier H; detection p50 ≤ 20 ms |
| Camera smoothing | jitter and lag within 1.25 × MediaPipe's own smoothing at `numFaces` 1 (PJ1, PJ2) |
| Smoothing + matching, 3 faces | ≤ 0.3 ms per frame |
| New GPU memory at working resolution | ≤ 2 MB (§4.8: ≤ 1.8 MB at 2048 × 2048) |

### 6.2 Phase 0 procedure (sub-step 1a, before any feature code)

1. **Fixtures** (§8.3): `group_faces.png` with its recorded landmark JSON, `group6_faces.png`, `group_people.jpg` with its pose JSON, `group.y4m`, `group_noise.y4m`, `group_pan.y4m`, and the v0.3 parity goldens recorded from `892ea61`.
2. **GL limits and probes.**
   - Limits are read in `engine/index.ts` `build()` (next to `index.ts:58-62`), logged once and stored on `window.__meiyan.gl`: `MAX_FRAGMENT_UNIFORM_VECTORS`, `MAX_UNIFORM_BLOCK_SIZE`, `MAX_TEXTURE_SIZE`, `MAX_TEXTURE_IMAGE_UNITS`, `MAX_ARRAY_TEXTURE_LAYERS`, `EXT_color_buffer_float`, `OES_texture_float_linear`. These are `getParameter` calls and cost nothing.
   - The probes run **only in `/bench.html` and dev builds** (`import.meta.env.DEV`). In production they would add a `readPixels` stall to every engine build and context restore, and there would be nothing to switch to: the table carrier is a build-time choice (§4.4).
   - **PG1 (precision):** a 96 × 2 RGBA32F NEAREST texture, and the same values through the UBO carrier, holding 0.123456789, 0.999999, 1e9 and −1e9. Each is fetched in a draw into RGBA8 that outputs `0.5 + (fetched − expected) · 2^16`; the probe passes only at 128 ± 1 for every value. A 1/255 tolerance after an 8-bit encode would pass an fp16 or mediump path (relative error about 5e-4, roughly 1 px on landmark UVs at 2048), and `EMPTY_BOX = ±1e9` (`reshape.ts:322`) overflows fp16. With `EXT_color_buffer_float` the probe also renders into RGBA32F and compares the FLOAT readback within 2^-20 relative.
   - **PG2:** a 2-layer R16F `TEXTURE_2D_ARRAY` with LINEAR filtering, sampled with `textureLod` at the midpoint between texels of layer 1.
3. **Bench rows** (`src/bench/main.ts`, a new 「多臉」 section; results also go to the copy-results report, `bench/report.ts`). `/bench.html` deliberately has no fixed photo URL (`bench/main.ts:410-411`), so the procedure is: save `group_faces.png`, `group6_faces.png` and `group_people.jpg` to the phone's Photos and pick them; for the camera rows, show `group_faces.png` full screen on a second screen and point the phone at it.
   - **D:** `detectImage` on `group_faces.png` at decodes 2048 and 1440, with `numFaces` 1/4/6/8, on GPU and CPU. Columns: first call, median of 5 warm calls, faces found, whether the order matches across the two decodes.
   - **L:** `detectForVideo` on the camera at `numFaces` 1 and 3, with 1 and with 3 faces in view, at tier H. Columns: detection p50/p95, fps over 10 s.
   - **J (jitter):** a static scene, on the device (phone on a stand) or on `group_noise.y4m` (seeded per-frame landmark-scale noise; today's y4m repeats one identical frame, `gen-y4m.mjs:165-170`, so raw jitter there is about 0 and the comparison means nothing). The RMS over 2 s of every `pts111` point's deviation from its mean, in px scaled to a 1080-px frame height. Variants: `numFaces` 1 (MediaPipe smoothing), `numFaces` 3 raw, `numFaces` 3 with the app smoother.
   - **J2 (lag):** a panning clip (the phone panned slowly across the second screen, or `group_pan.y4m`, whose faces translate 0.5 face widths per second). The mean delay of the `pts111` centroid behind the raw detections, time-aligned, for `numFaces` 1 (MediaPipe smoothing) and `numFaces` 3 with the app smoother.
   - **B:** body detection on `group_people.jpg` with `numPoses` 2 and 4. Columns: detection time, readback and downscale time per person, persons found, and the peak JS heap during the readback (`performance.memory` where available).
   - **BF:** `buildBodyField` with 4 persons (`group_people.jpg`'s two measures plus their mirrored copies), full and draft.
   - **F:** `buildFaceProtect` for each of the 6 faces of `group6_faces.png` at 2048, with the selfie mask.
   - **R:** a reshape microbench with the `MAX_RENDER_FACES` loop, every item at maximum and the caps on, at 1080 and 2048, for both table carriers. Layouts: N = 1…6 spread across the frame, 6 faces in a row at 1.2 FW spacing, and a 2 × 3 grid at 1.3 FW. Timing: 30 warm-up draws, then batches of 10 draws per 1-px `readPixels` (iOS has no timer query, and one `readPixels` per draw lets the GPU idle and down-clock), divided by 10; the median of 10 batches, minus the N = 0 baseline.
   - **RC:** reshape compile + link time (the first draw), per carrier.
   - **RP:** the reshape pin harness (`tests/e2e/pages/reshape.ts`, with the two-face and capped cases of §8.2) run in `/bench.html`: max |GPU − CPU| in px on the phone's GPU. The e2e check runs only on Chromium (SwiftShader or ANGLE), never on Metal.
   - **PE:** an editor drag on `group6_faces.png` at 2048 (every face item + 磨皮 on every person), p50 of the frame time, and the same drag at `892ea61` on a one-face photo.
   - **M (memory):** the flow "open `group_people.jpg` → open 美體 → wait for persons". With a Mac and Safari Web Inspector: the peak of the memory timeline, against the same flow at `892ea61`. Without a Mac (this workspace is Windows): a kill test on the SE-class phone, running the flow 3 times with a localStorage breadcrumb set at the start and cleared at the end; pass = no reload and no stale breadcrumb.
4. **Where:**
   - Desktop: Chromium through Playwright for correctness, and GPU-enabled desktop Chrome on `npm run dev` for timings.
   - iPhone: `/bench.html`. It needs a secure-context preview deploy, **which happens only after the user's go-ahead**.
   - Until the iPhone numbers exist, the §3.5 defaults ship.

### 6.3 Thresholds and fallbacks

Each row is applied to the **slowest iPhone measured**. A change is one line in `limits.ts` (or the stated code path), committed together with the numbers.

| ID | Measured | Keep default if | Fallback |
|---|---|---|---|
| PD1 | `detectImage` warm median at `EDIT_DETECT_FACES` (8), 2048 | ≤ 400 ms | ≤ 800 ms → `MAX_EDIT_FACES = 4` (request 6); > 800 ms → `2` (request 4) |
| PD2 | Faces found on `group_faces.png` (A, B, C selectable; D below `MIN_FACE_FRAC`) | Chromium finds A, B and C at 2048 | Chromium misses C → regenerate the fixture with C at scale 0.26 (a fixture fix; e2e pins Chromium). iPhone misses are recorded only (re-detect is out of scope). |
| PL1 | Camera with 3 faces in view at `numFaces` 3, tier H | fps ≥ 24 and detection p50 ≤ 20 ms | Measure at `numFaces` 2: passes → `MAX_LIVE_FACES = 2`; fails → `1` (camera 選臉 hidden, smoother bypassed: v0.3 behaviour) |
| PL2 | Camera with **1** face in view: p50 at `numFaces` 3 minus p50 at `numFaces` 1 | ≤ 5 ms | `MAX_LIVE_FACES = 1` (the common selfie must not get slower) |
| PJ1 | Jitter (J), `numFaces` 3 + the app smoother | RMS ≤ max(0.4 px, 1.25 × the `numFaces` 1 RMS) | `minCutoff = 0.025` and measure J and J2 again; still failing → `MAX_LIVE_FACES = 1` |
| PJ2 | Lag (J2), `numFaces` 3 + the app smoother | ≤ 1.25 × the `numFaces` 1 lag | `beta = 160` and measure J and J2 again; still failing → `MAX_LIVE_FACES = 1` |
| PB1 | Body detection with `numPoses` 4 (detection + every readback) | ≤ 1.5 s | ≤ 2.5 s → `MAX_EDIT_BODIES = 3`; > 2.5 s → `2` |
| PBF | `buildBodyField`, 4 persons | full ≤ 120 ms and draft ≤ 16 ms | Draft over → `GUARD_STEPS_DRAFT` 4 → 2 and the draft edge −25 %; full over → `MAX_EDIT_BODIES = 3` |
| PF | `buildFaceProtect` per face (F) | ≤ 8 ms | > 16 ms → `PROTECT_WINDOW = 96` (still one limit per animation frame) |
| PG1 | Precision probe | Passes on the texture carrier | The UBO carrier is forced, whatever PR1 says |
| PG2 | R16F 2D-array LINEAR probe | Passes | Protect layers stacked vertically in one R16F 2D texture; each sample is clamped half a texel inside its layer's rows |
| PR1 | Reshape microbench (R), N = 6, the clustered layouts, 2048 | ≤ 8 ms with the faster carrier | The faster carrier ships either way. N = 4 ≤ 8 ms → `MAX_EDIT_FACES = 4`; else `2` |
| PRC | Reshape compile + link (RC) | ≤ 300 ms | Compile in `build()` instead of lazily (`pipeline.ts:401`); still over → `MAX_RENDER_FACES = 4` |
| PRP | GPU vs CPU port on the phone (RP) | max < 0.05 px | Treated as a PG1 failure (UBO carrier); still failing → a port or driver bug: step 1 does not ship until it is understood |
| PE1 | Editor drag (PE), p50 at 2048 | ≤ v0.3's one-face drag on the same phone + 12 ms | `MAX_EDIT_FACES = 4` |
| PM1 | Memory (M) | Kill test passes 3 of 3 (or, with Web Inspector, peak Δ vs v0.3 ≤ 20 MB) | On tier L devices only: `MAX_EDIT_FACES = 4`, `MAX_EDIT_BODIES = 2` |

`MAX_FRAGMENT_UNIFORM_VECTORS` and `MAX_UNIFORM_BLOCK_SIZE` are recorded. The design does not depend on them: the reshape program needs fewer than 32 vectors outside the table, and the UBO carrier needs 9.2 KB of the guaranteed 16 KB.

### 6.4 Recording the results

Sub-step 1a appends a dated table to this section, with device, OS, browser, row ID, value and the decision taken. The `limits.ts` change and the one-line update of RM §6.2 go in the same commit. Later iPhone runs append rows the same way.

---

## 7. Error and edge cases

| Case | Handling |
|---|---|
| More faces than `MAX_EDIT_FACES` | The largest are kept; the toast shows once (while the strip shows). A dropped face gets no face effects (mask 0, not in the table), even under 全部, but it stays an **obstacle**: its neighbours' caps and 瘦臉 limits respect it (§4.1, §4.7). |
| Faces below `MIN_FACE_FRAC` | Not selectable, no effects, obstacles. The too-small toast shows once, only while the strip shows; the over-cap toast wins when both apply. |
| A tiny unselectable face right next to a big one | It shrinks the big face's cap, as the approved rule says (half the distance to the nearest other face). §11 Q6 asks whether that should change. |
| Side-by-side faces closer than about 2 FW | The cap is a radius, so 下巴 and 額頭 (and the lowest jaw points of 瘦臉 and V臉) weaken although the neighbour is beside the face, not below it. Eyes, nose and mouth keep ≥ 0.9 of their effect down to 1.2 FW (§4.4). §11 Q5 asks whether a cell-shaped cap should replace the radius. |
| A duplicate detection of one face | IoU > 0.6 dedupe (T3 in the editor, T4 in the camera); a duplicate is not an obstacle |
| A face without a pose, or a pose without a face | A face-only or body-only person; the notes of §2.4 |
| Overlapping or adjacent faces | Cap budget (§4.1, §4.4); protect regions (§4.7); rings take the max, fans write their own face, holes the min (§4.2); makeup: the last face wins only where both faces have makeup (§4.3) |
| A photo with no face | `globalSkin` from the primary person (`p0`, or the primary body person); today's notes and toast (`Editor.tsx:248-251, 789-797`) |
| Tracker recovering, or the detect call throws, on first open | As today (`RedetectBudget`, `editorModel.ts:27-48`). Edits meanwhile go to `p0` and pass to the primary at the first definite answer (§3.3). No cache is written until then. |
| The editor is closed before a definite answer | The record has `edit` (with `p0`) and no `detect`; the next open detects (§5.3) |
| Engine swap or context loss | The new session gets `knownFaces` (or the cache) and does not detect again; the selection and the protect map are kept; the face table and the protect layers are re-uploaded, because their keys are reset in `dispose` (§4.4) |
| A detection that adds persons, then ↶ | `rebase` has injected them into every state, so they never disappear |
| 美體 adds a body-only person while 全部 is selected | The new person gets `template` and is appended to the numbering. The 全部 slider value and 「各人不同」 are recomputed. |
| 美體 adds the first body-only person to a one-face photo | The strip appears mid-session through the 260 ms frame transition (§2.1) |
| Body detection fails or finds nobody | Today's notes (`panelModel.ts:96-100`). Every person stays face-only; 增高 still works. |
| v1 `body` cannot be matched after re-detection (people ≥ 2) | The person that owned b0 keeps its params and loses b0. If that person was body-only, its params move to the new primary body person. No toast: v0.3 edited the primary body by construction (`bodyTracker.ts:245`), which is the same choice the new primary makes. |
| v1 `body` pairs with no detected face | b0's person keeps v0.3's local 美體 values; the face-score primary gets the face look (§5.3, A13) |
| A cache with faces reopened in 基本模式 | The cached faces render with every person's face effects, and the boxes and strip show; only a new detection is unavailable (§3.3) |
| A 基本模式 cache reopened with a tracker | One detection, merged into the cache; ids and params kept (§5.3, A15) |
| A cache with more faces than this device's `MAX_EDIT_FACES` | Used as stored (A16) |
| An entry edited in 0.3 after a rollback | `paramsKey` differs: the photo and the primary are rebuilt from `params` (§5.3) |
| The camera loses the selected face | It fades out over 150 ms and is held for 1 s; if it is found again near its last centre, the selection resumes; otherwise the selection returns to `auto` (largest). A tracker "no answer" (`null`) never drops a track or the selection (T4). |
| Two camera tracks converge on one face | De-duplicated before matching (T4) |
| Camera flip, resolution change, resume | `resetSession` clears the tracks and the selection; 全部套用 stays as set (`AppState.cameraAll`) |
| More faces in front of the camera than `MAX_LIVE_FACES` | The camera tracks only `MAX_LIVE_FACES` faces. The others are invisible to it: not beautified, and not obstacles, so a beautified neighbour's cap ignores them. The editor sees them after the shot. |
| Camera tap on a face partly behind the floating slider row | The row swallows the tap as today; the face can be tapped above the row or after collapsing the panel |
| Front camera | Taps are un-mirrored (C1); the seed is mirrored exactly as the saved image (C2) |
| The seed lies in no face box in the editor (or outside the crop) | The primary by score; everyone starts from `template`, the photo part is kept (C2) |
| 基本模式 (no tracker), new photo | No face detection; `faceScans = []`; no boxes; the photo is "no face"; 美體 persons still come from bodies |
| 「Match GPUPixel」 debug | The mask stays off, so every skin pixel is smoothed with `S` (debug-only exception, `types.ts:270-271`) |
| A cache taken at 2048, reopened at 1440 (tier L) | Normalized coordinates; `cachedFits` checks only the aspect |

---

## 8. Testing

### 8.1 Unit (Vitest)

| Module | Tests |
|---|---|
| `tracker.ts` | `numFaces` is sent together with `runningMode` in one `setOptions`; no call when neither changes; the first instance and every replacement are built with the last requested count, and the call after `replace()` makes no extra `setOptions`; `maxFaces` required and clamped; `toLandmarksAll` keeps every valid entry, `[]` for none; `detectVideo` returns `null` on its early returns and `[]` for a completed inference without a face |
| `detect/faces.ts` | Dedupe before the size filter; size filter at `MIN_FACE_FRAC`; cap keeps the largest; order by x with the y tie-break; ids; obstacles = the too-small and over-cap faces, duplicates excluded; the recorded `group_faces.landmarks.json` gives A, B, C, and D as an obstacle |
| `detect/persons.ts` | Pairing on synthetic poses and on the recorded fixture JSON; side-matched eyes (a mirrored face B still pairs); visibility < 3 points → no pair; greedy 1:1; one face + one pose (A14); face-only and body-only persons; ids unchanged when bodies arrive and when faces arrive after 基本模式; appended numbering; `p0` hand-over; primary scoring equals `selectPerson`'s; `seedPrimary` (padded-box containment, nearest centre among several, no box → `p0` discarded); `hitPerson` (display → source through a band field, the 44 pt expansion at zoom 1 and 3, faces before bodies, equal mask values → the smaller mask) |
| `detect/cache.ts` | `cachedFits`; `normalizeDetect` drops only the corrupt part; the no-face cache with `p0` is valid and reopens without detection; obstacles validated; a cache with more faces than the tier cap is not truncated; `withFaces`; `rematchByIoU` + `renamePersons` (`legsAnchor` follows) |
| `edit/*` | RM §8.1 step-1 list (scope table, `splitLegacy`/`legacyProjection` round trip, lens routing for `person`, `all`, the no-face exception and `legsAnchor`, the preset link, 重置, fuzzed `sanitizeEditState`, undo `{clone: false}` and `rebase`). Under 全部: `selected` and the no-op checks mean "every target matches" (primary 自然, person 2 精緻, 全部 + 自然 → person 2 自然; the same for 無 and for a lip shade); 程度 hidden when presets differ; mixed by display value (0.3451 and 0.3549 are not mixed). ⊘ with a person selected leaves the photo items and the other persons; ⊘ under 全部 resets the photo items. `p0`: unsure → 大眼 0.8 → a re-detect finds 2 faces → the primary has 0.8, the other `template`. `buildFrame` (neutral persons listed, obstacles passed, `globalSkin` only without faces). |
| `edit/migrate.ts` | Every row of §5.3 with fake-indexeddb records, including b0 paired with no face (b0's person keeps the 9 local `body.*` values, the face-score primary gets the face part), v2 `edit` without `detect`, a dropped cache rematched (ids renamed, `legsAnchor` follows), an unusable `edit` → the v1 path, and a `paramsKey` mismatch |
| `store/history.ts` | v2 round trip with typed arrays; the `touch` default (today's rule); `touch: false` keeps `updatedAt` even with `edit` and a thumbnail; `paramsKey` stored; v1 tests unchanged |
| `editorModel.ts` | `stampIs` with `editKey`; a rebase while saved moves the stamp (no autosave); reopening a v1 entry, then assigning persons and adding bodies, leaves the `listEntries` order and `updatedAt` unchanged (fake-indexeddb) |
| `engine` packing | Face-table layout (offsets, `EMPTY_BOX`, yaw × weight, texel 73 = −1 without a neighbour, texel 74 window); `S`/`R`/`k` maxima; mask clear values; `capsFor` (no cap for one face, obstacles count, presence easing divides the distance, the box clipped to the cap disc's AABB) |
| `reshapeCpu.ts` | The N-face port, with `reshapeMapCpu(face, u, aspect, body, protect)` kept as a one-face wrapper, so `faceProtect.test.ts`, the straightness tests and the harness stay unchanged; one face bit-exact versus the frozen v0.3 port (`reshapeCpuV03.ts`, a test-only copy of today's file, since `reshapeCpu.ts` is rewritten); a two-face sum equals each face alone **with its cap**; the fold and strength sweep of §4.4; a 7-face case where the dropped face (an obstacle) is the nearest neighbour, and the cap uses it |
| `body/field.ts` | One person ≡ the v0.3 builder (byte-equal field); two persons: person 2's 細腰 leaves person 1's mask texels at 0 displacement; two touching persons, every local item at max: `min det J ≥ MIN_DET` and `lambdaGlobal === 1`; person 2 at max leaves λ_1 = 1; the budget is 0 inside the other masks; a draft reuses the other persons' `L_p` |
| `faceProtect.ts` | Single face ≡ today; two faces: budget ≤ 0 inside the other oval, an obstacle oval and the other mask; Lipschitz check on the grid; Voronoi clip; a two-face scene keeps `sharpestTurn ≤ free + 1°` (as `faceProtect.test.ts:174`); scenes with FW = 0.05 and 0.1 of the photo width, in their 128² windows, keep the slope, stretch and crease bounds of `faceProtect.test.ts:170-176` |
| `faceProtectModel.ts` | Per-face memo: switching the selection rebuilds nothing; a contour edit on person 2 builds only f1's limit; at most one build per animation frame; the request flag stays photo-level |
| `mask.ts` | Geometry order fans → rings → holes with `[count, base, fanEnd]`; the two existing tests unchanged |
| `bodyTracker.ts` | A fake `MPMask` that counts live arrays never sees more than one; `result.segmentationMasks` is emptied before `result.close()`; every mask is closed exactly once, also after a throw |
| `app/oneEuro.ts` | A constant input converges; ≤ 10 ms lag at a speed of 1 face size per second; the same behaviour at twice the resolution (scale invariance); one filter per landmark coordinate |
| `app/faceTracks.ts` | IoU and centre matching; converged detections de-duplicated; `update(null)` keeps tracks and selection; a lost track held 1 s; auto hysteresis; crossfade weights; the presence easer; `anyFaceEaser` equals today's easer for one face (live parity); `MAX_LIVE_FACES = 1` → the shown landmarks equal the raw ones (bypass); every row of the `cameraTapAction` table (§2.5) |
| `ui/panelModel.ts` | Notes per §2.4, the 美體 order included; per-item gating of 磨皮 and 紅潤; dots per selection and under 全部; the slider key and aria labels |
| seed mapping | Crop + mirror, no clamping, the last raw box, `'all'`, null |
| `updateModel` | Unchanged in step 1 (the 0.4.0 case lands with the release, RM §1.3) |

### 8.2 Shader ports and hash pins

- `RESHAPE_FS` is pinned again (`reshapeCpu.test.ts:32`), with `reshapeCpu.ts` ported to the face table, the loop, `budgetScale` for both the limit and the cap, the protect windows and the single-face shortcut. `reshapeCpuV03.ts` anchors the bit-exact single-face test.
- `mask.test.ts` gains per-face channel values and a two-face case: rasterized on the CPU, a neutral face's cheek border stays 0 next to a beautified neighbour.
- `tests/e2e/reshape.spec.ts` keeps its test as it is (`reshape.spec.ts:11` still expects 3 cases). A separate test, `runReshapePinMulti`, adds the two-face, capped-pair and obstacle cases, for both table carriers (`?faceTable=ubo`); GPU equals the CPU port within 0.05 px. `faceProtect.spec.ts` gains a two-face case and a small-face window case.
- `tests/e2e/pages/engine.ts` gains an N-face harness that reads back M (the two-face mask of §4.2) and checks that an earlier face's lip survives a later face's mesh (§4.3).
- The reshape pin harness also runs in `/bench.html` (row RP, §6.2), so the port is checked on Metal.

### 8.3 Fixtures

The fixtures follow RM §8.3: synthesized from Apache-2.0 images already in the repository, and recorded in `LICENSES/NOTICE.txt` with the §4(b) change notice.

| Fixture | Script | Use |
|---|---|---|
| `tests/fixtures/group_faces.png` | `scripts/gen-group-fixture.mjs` | 1800 × 1200. `sample_face.png` (1000 × 1500) copies: A scale 0.42 at x 0.22; B mirrored, scale 0.34, at x 0.55; C scale 0.22 at x 0.82; D scale 0.05 bottom right. |
| `tests/fixtures/group6_faces.png` | `scripts/gen-group-fixture.mjs` | 2048 × 1536. Six copies of `sample_face.png` at equal scale in a 3 × 2 grid, 1.3 FW apart (alternate copies mirrored). Bench rows F, PE and R, and the clustered e2e cap case. |
| `group_faces.landmarks.json`, `group_faces.pose.json` | `record-landmarks.mjs`, `record-pose.mjs` (extended to every face and pose, `numFaces` 8, `numPoses` 4) | Unit tests |
| `tests/fixtures/group_people.jpg` (+ `.pose.json`) | `gen-group-fixture.mjs` | `fullbody.jpg` and `fullbody_yoga.jpg` side by side at equal height |
| `tests/fixtures/group.y4m` (gitignored) | `gen-y4m.mjs --src group_faces.png` | 1280 × 720 with A, B and C visible, 30 frames |
| `tests/fixtures/group_noise.y4m`, `group_pan.y4m` (gitignored) | `gen-y4m.mjs --src group_faces.png --noise <seed>` / `--pan 0.5` | Bench rows J (seeded per-frame sub-pixel shifts and noise) and J2 (the faces translate 0.5 FW per second) |
| `tests/fixtures/parity-v03/*.png` | `scripts/record-parity.mjs` on `892ea61` | `sample_face.png` with 自然; 精緻 with every 美型 item at max; lip and blush shades; `fullbody.jpg` with 細腰 + 長腿 + 增高. Max channel diff ≤ 1/255, mean < 0.02/255. |

### 8.4 E2E (Playwright, Chromium)

- **`parity.spec.ts`** runs every parity golden after each sub-step.
- **`persons.spec.ts`** (new), on `group_faces.png`:
  - three faces bracketed and the strip 「全部｜1｜2｜3」; no box for D; `__meiyan.faces === 3`, `selected === 'f0'` (A is the primary by score; the `persons.ts` unit test checks this on the recorded fixture JSON);
  - a tap on face B on the photo selects 2;
  - at 3× zoom on A: a one-finger drag that starts on A pans; a double tap on A fits; a tap on B selects B;
  - select 2, 大眼 at max: `regionDiff` changes inside B's influence box and is ≤ 1/255 outside it;
  - 全部, then 瘦臉: A, B and C all change; A's other items keep their values;
  - A at 自然 and B at 精緻, then 全部 + 自然: B becomes 自然;
  - 美白 with person 2 selected changes the whole photo; the slider label reads 「美白 · 整張照片」 and the chips are `aria-disabled` while 美白 is active;
  - ⊘ in 美膚 with person 2 selected leaves 美白 unchanged;
  - ↶ restores B's 大眼 and the selection stays on 2; B's bracket and chip get `.changed`; with person 1 selected, ↶ of a B edit toasts 「已復原人物 2 的變更」;
  - close and reopen: `detectCalls` is unchanged, an export matches the pre-close export, and opening and closing without an edit leaves the 最近編輯 order and `updatedAt` unchanged;
  - a seeded v0.3 record (`seedHistory`, RM §8.4) opens with its look on A only;
  - the no-face note shows for a body-only person (seeded cache with one body-only person);
  - a no-face photo (`noFacePng`, `editor.spec.ts:5`) reopens with `detectCalls` unchanged and no toast;
  - a 2-face lose/restore cycle (`WEBGL_lose_context`) renders the same pixels before and after.
- **`body.spec.ts`** gains cases on `group_people.jpg`:
  - two persons; a tap on the right body selects person 2;
  - 細腰 on person 2 leaves person 1's mask region unchanged (≤ 1/255), with `bodyFieldCacheStats.lambdaGlobal === 1`;
  - the bands note shows only while 增高 or 長腿 is active, and the old multi-person note is gone.
- **`camera-group.spec.ts`** (new Playwright project `chromium-group`, the same settings with `--use-file-for-fake-video-capture=tests/fixtures/group.y4m`, `testMatch: camera-group.spec.ts`):
  - `__meiyan.faces === 3`; the largest face (A) is beautified by default;
  - a tap at B's box (`__meiyan.boxes`, mapped through the cover transform) → B beautified and A unchanged (`regionDiff` against 按住對比);
  - 全部套用 → all three change; a tap on C then turns 全部套用 off and selects C;
  - shutter → 編輯 → the editor's `selected` is B's person (with 全部套用 off).
- **Unchanged projects:** the existing `chromium` project keeps `face.y4m`. The existing specs keep their assertions (`editor.spec.ts:29, 148` still read `face`; `camera.spec.ts:71-73`, one face, still collapses the panel), except the ones listed in §8.5.

### 8.5 Existing tests whose assertions change on purpose

1. `bodyTracker.test.ts:206-212`: `numPoses` 2 → 4.
2. `bodyTracker.test.ts:185-194`: `toDetection` → `toDetections` (every body, every mask).
3. `panelModel.test.ts:264, 334`: `BODY_MULTI_NOTE` → the bands note (shown only while 增高 or 長腿 is active).
4. `reshapeCpu.test.ts:32`: the hash pin.
5. `tests/e2e/camera.spec.ts:58-61`: the persisted live look is polled from `meiyan.look.v1` (`photo.values['skin.whiten']`) instead of `meiyan.params.v1`, which 0.4 no longer writes (C3).

Every other change is a mechanical signature port in the same commit: `face` → `faces`, `BeautyParams` → `EditState`, `detectImage` returning an array, `measureSafe` taking the paired face.

---

## 9. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| BlazeFace short-range misses small or distant faces (MediaPipe #4698) | A face the user cannot select | `MIN_FACE_FRAC` and the toast; PD2 measured; re-detect is out of scope |
| Camera cost, jitter or lag with `numFaces` 3 (no MediaPipe smoothing) | Lower fps or a shaky or trailing warp, including for a lone selfie | MediaPipe's own smoother replicated; PL1, PL2, PJ1 and PJ2 fall back to 1 face (v0.3, smoother bypassed) |
| The `BeautyParams` → `EditState` port through the 881-line `Editor.tsx` | Regressions in autosave, the 瘦臉 limit or 美體 timing | 1b lands alone, behaviour unchanged, with parity goldens and every existing e2e |
| The summed displacements of close faces fold | Visible artefacts between faces | Disjoint cap discs; the cap is the 瘦臉 limit's slope-bounded budget; the fold sweep; the editor's λ_f safety net |
| The radius cap weakens 下巴 and 額頭 in tight group shots | Less effect than the user expects | Measured by the strength sweep; §11 Q5 offers the cell-shaped cap |
| The multi-person field bleeds into or folds next to a neighbour | A distorted bystander | Other persons as a slope-bounded budget, per-person λ_p, relax with every person held, unit tests with touching persons |
| A wrong pairing (hugging persons) | Face and body edits on different people | Side-matched cost with an IOD threshold, nose-in-box, mask coverage; a tap in 美體 lets the user pick the body explicitly |
| iOS Safari quirks with RGBA32F `texelFetch`, the UBO or R16F arrays | Wrong warps on iPhone | PG1 precision probe, PG2, and the GPU-vs-CPU pin on the phone (RP) |
| Memory on SE-class phones with 4 poses and 4 masks | Page killed | One mask array alive at a time (P2); the M kill test; PM1 caps tier L |
| An iPhone measurement needs a preview deploy | Phase 0 waits for the user's go-ahead | The §3.5 defaults ship until the numbers exist |

---

## 10. Out of scope (step 1)

- Approved as out of scope: long-press re-detect of missed small faces; per-person filters; per-person camera settings.
- Per-person 美白 or 銳化; a per-person 背景保護 switch (RM §10).
- 美體 in the camera; camera tap-to-select on bodies.
- Detection on rotated views (step 3 adds `faceScans` for that).
- Showing faces beyond the cap or below `MIN_FACE_FRAC` as selectable.
- Moving the face boxes with the local 美體 fields (only the row bands are followed, §2.1).

---

## 11. Open questions for the user

Each one has a default that ships if the user does not answer.

1. **Person numbers when 美體 finds a body without a face:** append the new person at the end so numbers never change, or renumber everyone from left to right (person 2 may become 3)? *Default: append (§2.1). Renumbering would break 「人物 {n}」 in notes, labels and toasts, and the numbers the user has already matched to people.*
2. **Importing a group photo:** everyone gets the current camera look (自然 by default), or only the primary person, as v0.3 effectively did? *Default: everyone (RM §3.7).*
3. **A shot taken with 全部套用:** should the editor open with 「全部」 selected? *Default: no. The primary person is selected (the approved default), and everyone already carries the look.*
4. **背景保護 in a group photo:** one switch for the whole photo, with the protection computed per person, or a switch per person? *Default: one switch for the whole photo (A8; a per-person switch is out of scope in RM §10).*
5. **Shape of the influence cap:** the approved rule is a radius, half the distance to the nearest other face. For faces side by side, it also cuts 下巴 and 額頭 below and above the face, where there is no neighbour (closer than about 2 face widths, §4.4). The alternative is a cell: each face's influence ends at the line halfway to each neighbour, so 下巴 and 額頭 stay at full strength for side-by-side faces. It uses the same budget and costs the same. *Default: the radius, as approved.*
6. **Tiny faces that cannot be selected** (below 3 % of the short edge, or beyond the 6-face cap) are obstacles: a big face's cap shrinks to half the distance to them, so a small background face beside a cheek weakens that face's 瘦臉. Keep that, or let only selectable faces limit the cap (the tiny face may then be distorted)? *Default: keep, the literal rule.*
