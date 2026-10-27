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
6. 動工前先量測（Phase 0）：多臉偵測時間、相機幀率、延遲與抖動、GPU 上限與記憶體。量測不理想時依 §6.3 降級，例如編輯器臉數上限 10 → 8 → 6 → 4 → 2、相機 3 → 2 → 1。
7. 照片偵測臉部改用 BlazeFace full-range 偵測模型（2026-10-17，§6.5）：團體照裡只占畫面寬約 6% 的小臉也找得到。這個模型在裝置上換進 Face Landmarker 的模型套件，只多下載 1.1 MB；相機仍用原本的 short-range，速度不變。2026-10-18 起：臉太近、額頭或側邊被畫面切掉時 full-range 會漏掉，這時改用 short-range 再偵測一次；相機拍完按「編輯」時，若 full-range 沒找到相機選的那張臉，也會再問 short-range 一次並補上那張臉。偵測器另外下載，相機不必等它，下載失敗下一張照片會重試；照片最多只等偵測器第一次下載 3 秒（每次開啟 App 只等一次，重試不等），等不到就先用 short-range：之後偵測器一到（重新開啟這張照片時，或照片還開著時剛好下載完成），就補上漏掉的臉，已調整的人物不變；補臉前照片先照舊顯示，不必等。兩個模型套件都拿掉用不到的 blendshape 模型，記憶體回到 v0.4 的水準。
8. 新照片一律從原圖開始（2026-10-18，使用者決定「全部都原圖，包括相機拍的」）：匯入的合照不再讓每個人套上相機效果，相機拍完按「編輯」也只帶過去「選好同一個人」，不帶效果。沒存過相機效果的人，相機也是原圖（全新安裝，以及從沒調過相機的升級使用者）。
9. 編輯器最多可選 10 張臉（2026-10-18，使用者決定「人數上限改到10人以下」，§6.7）：十人以內的合照每個人都能單獨調整，下方人物列是「全部」加 10 個人物，在每支手機上都可左右捲動。照片最多偵測 12 張臉（偵測器信心最高的 12 張，不一定是最大的）；其中超過 10 張時保留最大的 10 張，其餘的不套臉部效果，但仍是鄰近臉的邊界，並顯示「偵測到超過 10 張臉，只會美化最大的 10 張」；第 13 張以後的臉不會被偵測到，既不美化，也不是邊界（§7）。相機仍最多 3 張臉。

---

## 0. Inputs

### 0.1 Approved decisions (binding)

| Topic | Decision |
|---|---|
| Scope | Photo editor **and** live camera |
| Editor detection | Up to 10 faces (6 until §6.6, 8 until §6.7) and up to 4 bodies, paired into **persons**. A person may be face-only or body-only. Pairing compares pose head points with face landmarks, checks mask coverage, and takes pairs greedily 1:1 under a threshold. |
| Default selection | The largest, most central person (as today) |
| Editor UI | A tappable box on each face over the photo, plus a bottom strip 「全部｜1｜2｜3…」. In the 美體 tab, tapping a body also selects. A tab that does not apply to the selected person (no face, or no body) says why. |
| Per person | 磨皮, 紅潤, all 9 美型, 美妝, the local 美體 items |
| Per photo | 美白, 銳化, 濾鏡 and its strength, 增高 band, 長腿. Row bands stretch whole rows, so they are photo-level by construction. They are labelled 「整張照片」 with the reason. |
| 全部 | A slider drag writes that item's value to every person; other items keep each person's value. A preset tapped under 全部 applies to everyone. |
| Undo | Covers per-person param changes. Changing the selection is **not** an undo step. |
| Persistence | Detection results (faces and persons) and per-person params are cached in the history entry. A reopen needs no detection and always maps edits to the same person. Old entries (no cache) give their params to the default-selected person. |
| Engine | One pass for all faces. Every face's displacement is computed in original-image coordinates and the displacements are **summed**, never chained face after face. Each face's influence is capped at half the distance to the nearest other face. 磨皮 and 紅潤 strengths are per face, carried in the skin mask. Makeup is drawn per face. The source is still resampled once. |
| Multi-person 美體 | Each person's local field is computed and the fields are combined into **one** field. Other persons are protected zones. 背景保護 and the 瘦臉 background limit are computed per person. |
| Camera | Track up to 3 faces; default = the largest face; tap a face to switch; 「全部」 gives every face the same params (shown as the chip 「全部套用」, A10); no per-face settings in the camera; app-side landmark smoothing (MediaPipe smoothing is off when `numFaces > 1`), e.g. One-Euro; capture → 編輯 hands the selected face to the editor. **Superseded in v0.6 by [2026-10-19-camera-per-person-design.md](2026-10-19-camera-per-person-design.md)** (per-person camera settings, up to 10 faces). |
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
| A15 | 基本模式 writes `faceScans = []` (RM §3.6) | A later open with a working tracker detects faces once, merges them into the cache (bodies kept) and re-pairs (§5.3). The same form is written when 美體 runs before a face answer that may not come (§7). When the cache's primary body person (which holds `p0`'s look) pairs with no face, A13's hand-over applies to it | Otherwise a cache written in 基本模式 blocks face detection forever |
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

1. **Open.** On a new photo the editor shows 「正在分析臉部…」 (`Editor.tsx:812`) while one face detection runs. It finds up to 10 selectable faces (§6.7); a face whose box is narrower than 3 % of the short edge is not selectable and gets no face effects.
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
4. There is one look for every face; there are no per-face settings in the camera. (Superseded in v0.6 by [2026-10-19-camera-per-person-design.md](2026-10-19-camera-per-person-design.md): each face keeps its own settings.)
5. **Hand-over.** Shutter → 預覽 → 編輯 opens the photo with the same person selected. Since 2026-10-18 it opens at 原圖, as an import does (RM §3.7): the camera look stays in the camera. Under 全部套用 the primary person is selected (§11 Q3); until then everyone in the editor carried the look.
6. VoiceOver users cannot pick a face by tapping; 全部套用 is their way to beautify everyone.

### 1.3 What does not change

- **Single-person parity:** a photo with one person, edited with v0.3 items, exports within 1/255 per channel of v0.3 (RM §1.1; checked by the parity goldens, §8.3).
- The IndexedDB database `meiyan` (`DB_VERSION` 1, store `edits`), every `meiyan.*` localStorage key, the cache names and the Vercel URL. New keys `meiyan.look.v1` (RM §3.7) and `meiyan.hint.persons.v1` are added; none is renamed.
- MediaPipe 0.10.35, one FaceLandmarker instance (`tracker.ts:3-5`), on-device only. Since 2026-10-17 photos run it with the BlazeFace full-range detector swapped into the bundle, and the camera keeps the shipped short-range one (§6.5).

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
  - **Size:** chips 44 × 44 pt, 4 pt gaps, 12 pt side padding. 「全部」 plus six faces is 7 chips = 332 pt, which fits a 375 pt screen; 「全部」 plus the face cap of 10 (§6.7) is 11 chips = 524 pt (548 pt with the padding), wider than any phone (320–430 pt). The row scrolls horizontally when seven or more faces, or body-only persons, push it past the width; then a 16 pt fade at the right edge shows that there is more, and every selection change calls `scrollIntoView({inline: 'nearest'})` on the selected chip.
  - **Content:** the first chip is the text 「全部」. Each further chip is a square thumbnail with the person's number in the corner. The thumbnail is the face box padded by 30 %. For a body-only person it is the box of the visible pose head points 0–10 padded by 60 %; with fewer than 3 visible head points (a back view) it is the top 30 % of the mask bounding box, or of the pose bounding box without a mask.
  - Thumbnails are drawn once per person from the working bitmap into 132 × 132 px canvases (44 pt at 3×), about 0.7 MB for 10 persons.
  - **Accessibility:** the row is `role="radiogroup"` with aria-label 「選擇人物」; each chip is `role="radio"` with `aria-checked`. Chip labels are 「全部」 and 「人物 {n}」; a body-only person is 「人物 {n}（未偵測到臉部）」, and after body detection a face-only person is 「人物 {n}（未偵測到身體）」.
  - **Selected chip:** 1 px `--accent` outline.
  - **Photo scope (A11):** while the tab is photo-level (濾鏡 in step 1) or the active item is photo-level, the chips are dimmed (`--dim`), `aria-disabled="true"` and not selectable, and the caption 「整張照片」 sits at the start of the row, before 「全部」, as the group's `aria-describedby`. The chips stay focusable, so VoiceOver still reads them. The selection is kept and applies again as soon as a person-level item is active.
  - **Late appearance:** a one-face photo becomes a two-person photo when 美體 finds a body-only person. The strip then mounts mid-session and the canvas loses 52 pt (on an iPhone SE the stage goes from about 405 to 353 pt), through the existing 260 ms `.frame` size transition (`theme.css:264-266`).
- **Numbering.** A person's number is its position in `DetectionCache.persons` plus 1. The list is written left to right by the centre x of the face box (y breaks ties within 0.01), or of the body box for a body-only person, **when it is first built**. Persons found later (body-only persons from 美體, faces merged after 基本模式) are **appended**, so a number shown once never changes for that photo, and a reopen shows the same numbers (§11 Q1). Numbers never derive from person ids.
- **FaceBoxes** (`src/ui/components/FaceBoxes.tsx`, new) are drawn inside `.zoom-layer` (`Editor.tsx:832-841`), so they follow pinch and pan. They are **not** buttons: `pointer-events: none` and `aria-hidden="true"`. Every tap on the photo, a face included, reaches zoomPan (§2.3), so pinch, pan and double-tap work on faces at any zoom. The chips are the accessible control.
  - **Position:** box `{x, y, w, h}` in normalized image coordinates becomes `left/top/width/height` in %. The editor draws with `mirror: false` (`Editor.tsx:199`), so image UV is screen UV in step 1. When the body field has row bands (增高, 長腿), the box's top and bottom go through `forwardY(bands, y)` (`bands.ts:50`) of the current field, so a face in a stretched row keeps its box. Local 美體 fields move faces far less than the bracket padding and are ignored.
  - **Look:** four corner brackets (each 22 % of the box side) on the box padded by 15 % outward, so the jaw and chin that 瘦臉, V臉 and 下巴 move stay uncovered. Unselected: `--text-2` at 60 % opacity with a 1 px dark outer shadow (`0 0 0 1px rgb(0 0 0 / 0.5)`), so they show on light photos. Selected: `--accent`. Under 全部 every face looks selected. An 18 pt number badge sits outside the top-left bracket; it is hidden on boxes narrower than 24 pt on screen (the number stays in the chip). The CSS decides it from the box width at zoom 1 and the zoom (`--zs`, which zoomPan writes without a render), so a pinch shows or hides it at once.
  - **Zoom-invariant strokes:** `zoomPan.apply` also writes `layer.style.setProperty('--zs', String(s))`. Brackets use `border-width: calc(2px / var(--zs, 1))`; the badge uses `transform: scale(calc(1 / var(--zs, 1)))` with `transform-origin: top left`.
  - **Fading:** the brackets are at full opacity when a person-level tab opens, when the selection changes, and for 1.5 s after any photo tap; after that they fade to 30 % (200 ms). The `.changed` highlight (§1.1 item 8) is drawn at full opacity.
  - **Visibility:** on person-level tabs (一鍵, 美膚, 美型, 美體, 美妝) when ≥ 2 persons exist. Hidden while a slider is dragged, while 按住對比 is held, and while the 增高 tool is active (`showsHeightBand`, `Editor.tsx:834`). Dimmed together with the chips under A11.
  - **Body-only persons** get dashed brackets around their pose bounding box, in the 美體 tab only, also `pointer-events: none`.

### 2.2 Selecting

| Event | Result |
|---|---|
| Detection finishes (first open, or reopen from cache) | `{kind: 'person', id: primary}`. A later answer (a sideways re-scan, a 基本模式 merge) keeps the selection while that person still exists; a selection on the old primary follows the new primary (§3.3 item 4.4) |
| A tap on a face on the photo (§2.3), or on a person chip | That person |
| Tap 「全部」 | `{kind: 'all'}` |
| 美體 tab: a tap that hits no face but hits a body | That body's person (§2.3) |
| A chip or photo tap while a slider drag is active | Ignored |
| ↶ ↷, preset, 重置 | Selection unchanged |
| The selected person disappears (`p0` hands over when the first persons become known, §3.3) | The new primary person |
| Camera hand-over with a point seed | The person whose face box, padded by 25 %, contains the seed (the nearest box centre if several do); that person **is** the primary. If no box contains it: the primary as for an import, and `p0` (only the user's own edits) goes to it as an import's does; with no face found at all, `p0` keeps its params (§3.4 C2, C6). The shot itself opens at 原圖 (2026-10-18), so the seed only picks who is selected. |

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
2. **Faces** (every person-level tab). Each face box, padded by 15 % as drawn, is expanded to at least 44 pt on screen: a 44 × 44 pt square at the tap (`44 / (s · layerWidthPt)` × `44 / (s · layerHeightPt)` in V at zoom `s`) is taken to O through the linear part of `vToO` (crop, 拉直, quarter turns, 翻轉), and its O extents are the minimum, since the boxes are O-normalized. Among the boxes that contain `src`, the smallest normalized centre distance `|Δx|/w + |Δy|/h` wins.
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
  - The first 全部 write in an editor session shows 「已套用到全部人物」. When the tap that made it showed a notice of its own (左右分開 on or off), the one toast slot carries both lines, the notice first.
  - The first touch of each photo-level item in a session with ≥ 2 persons shows 「{label}套用於整張照片」.
- **Availability under 全部:** a body item is enabled when it is available for at least one person (`paramAvailability` per person's measure, `measure.ts`). The write goes only to those persons.
- **A selected body person the item refuses** reads its own measure's reason (`BodyContext.personGate`, `editorModel.personBodyGate`); a body person with no measure (`measureBody` threw) reads 「無法量測人物輪廓，美體調整暫不可用」 (`BODY_UNMEASURED_REASON`, as v0.3), never the lens's generic 「此照片無法使用這個效果」 (step-1 review). A notice that fails after a 美體 answer was merged is reported on its own and is not 美體偵測失敗 (`settleBodyAnswer`).

### 2.5 Camera

> **Superseded in v0.6** by [2026-10-19-camera-per-person-design.md](2026-10-19-camera-per-person-design.md): 全部套用 copies the selected person's settings (K10), every face renders its own person, faint brackets mark each face (K12); the chip, tap and marker rules below are v0.4–v0.5.

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
| `src/detect/faces.ts` | `prepareFaces`: adapt, box, size filter, dedupe, cap, order, ids, obstacles. `faceBox`, `personScore`. Since 2026-10-18 (§6.5): `sameHead`, one head across the two photo detectors (landmarks that coincide, round 5), and `prepareWith`, the camera seed's union. |
| `src/detect/persons.ts` | `pairPersons`, `primaryOf`, `appendPersons`, `seedPrimary`, `hitPerson` (§2.3) |
| `src/detect/cache.ts` | `DetectionCache` build, `cachedFits`, `normalizeDetect`, `withBodies`, `withFaces` (§5.3), `rematchByIoU`, `renamePersons` |
| `src/edit/state.ts`, `lens.ts`, `legacy.ts` | RM §3.2–3.4 (the step-1 subset, §3.2) |
| `src/edit/migrate.ts` | `openState(entry, size)`: a stored entry → `{edit, detect, rematch, v1Body, cacheDropped}` (§5.3); `firstAnswer` and `bodyAnswer`, the answer-time halves (§3.3) |
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
  /**
   * step 1 writes [{quarter: 0, flipH: false}] after a definite answer, [] in 基本模式. `detector: 'short-range'` (only on
   * a cache `photoDetector` marks): that up-frame's answer is the short-range one, still owed its full-range look (§6.5,
   * round 4); a marked cache whose records carry no flag reads with every record flagged
   */
  faceScans: { quarter: 0 | 1 | 2 | 3; flipH: boolean; detector?: 'short-range' }[];
  faces: CachedFace[];
  /** every face dropped after the dedupe (overCap and tooSmall): no effects, but it bounds its neighbours' caps (§4.1) */
  obstacles: CachedObstacle[];
  bodies: CachedBody[] | null;
  bodiesComplete: boolean;
  /** display order: left to right when first built, later persons appended (§2.1 numbering) */
  persons: PersonInfoCached[];
  primary: PersonId;
  dropped: { tooSmall: number; overCap: number };
  /** a dropped cache's face boxes still to be rematched (§5.3 R1–R3), carried by a cache 美體 wrote before the first face answer (§7); {} too */
  rematch?: Record<PersonId, Rect>;
  /** 'short-range': a face answer ran on the camera's detector because the full-range one was not there; the first open with that detector in completes it (§6.5, 2026-10-18) */
  photoDetector?: 'short-range';
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

1. `EditorSource` (`state.ts:27-40`) becomes `{bitmap, edit, historyId, detect?, rematch?, v1Body?, cacheDropped, faceSeed?, faceProtect?, faceMask?, returnTo}`. `params` and `body` are removed: `openState` (§5.3), called in `openInEditor` right after the decode (`flows.ts:29`), has turned them into `edit` and `detect`.
2. **`p0`, the person before any person is known** (RM §3.2, §3.6, r2). Whenever no detected person exists, `edit.persons` holds exactly `p0`, created by `openState` or `importEdit` (a new photo: an import or, since 2026-10-18, a camera shot; `cameraShotEdit` before) as `primaryInit ?? template`. Every person-level read and write then goes to `p0`: while the first answer is unsure, after a definite "no face" (where `p0` is the all-skin person), and in 基本模式. No edit made in that time is lost.
3. **Session** (`Editor.tsx:191-256`):
   - If `detect` exists, `cachedFits` passes and it holds an upright answer (`sessionPlan`, `editorModel.ts`: `faceScans` has `{quarter: 0, flipH: false}`, or there is no tracker), or the faces are already known from an engine swap (`knownFaces` ref, formerly `knownFace`, `Editor.tsx:87`), the session is created with `faces` and **no detection runs**. This also holds without a tracker: cached faces are render inputs, and only detection needs the tracker (today `Editor.tsx:224` passes a face only with a tracker).
   - Otherwise, with a tracker, `still.ts` runs `tracker.detectImage(bitmap, {maxFaces: EDIT_DETECT_FACES})` once and then `prepareFaces`.
   - `detectSession` (`editorModel.ts:15-24`) decides `unsure` as today, with `faces.length === 0` in place of `!s.face`.
4. **First definite answer:**
   1. `buildCache(faces, obstacles, bodies = detect?.bodies ?? null)`, or `withFaces(detect, faces, obstacles)` for a 基本模式 cache (§5.3) or one 美體 wrote before this answer (item 6), gives the persons in display order, the primary and `dropped`. The primary is the seed's person for a camera shot (§2.2), b0's person for a migrated v1 entry with a body (§5.3, A13), else the best score. In a cache without faces whose primary is a body person, that person holds `p0`'s look and its body is b0: it is the primary when it pairs with a face (or none was found), else the face score decides, and A13's split applies.
   2. `assignPersons(edit, persons, primary)`: the primary gets `persons.p0`, which carries `primaryInit` plus every edit made meanwhile; everyone else gets `template`; `p0` is removed unless the list is `[p0]` (nobody found); `primaryInit` becomes null. With a `rematch` from a dropped cache (§5.3), `renamePersons(map)` runs instead.
   3. `undo.rebase(...)` applies the same mapping to every stored state, so ↶ across the answer gives the primary its earlier values and never brings `p0` back.
   4. The cache is written to history with `touch: false` (§5.2). The photo's first face answer sets the selection to the primary (§2.2). It is the first face answer of a session that opened without a usable stored cache (none, or one dropped as corrupt or not fitting). A 美體 cache written before it in this session (item 6) does not make it a later answer; a stored cache the session opened with does. A later answer (a re-scan in a new up-frame, a 基本模式 merge, the merge into a stored 美體 cache included) keeps the selection, 全部 too, with two exceptions that move it to the new primary: a selected person the answer removed, and a selection on the cache's primary from before the answer. The second is for A13's hand-over, which moves the primary from a body person that pairs with no face to the face-score person (`applyAnswer`, `Editor.tsx`). The over-cap or too-small toast shows once (only while the strip shows), and on the first group photo ever the hint toast shows (§1.1 item 11). A later answer that brings the photo's first faces (a 基本模式 merge, A15; a re-detect or a sideways scan after a faceless output) shows the same notices and owes the saved thumbnail (§5.2).
5. **Render:** `frame = buildFrame(edit, adaptedFaces, obstacleCentres, protects)` → `session.render(frame)` on every change of `edit`, the cache or the protect map (`Editor.tsx:602-609`). The selection is not an input.
6. **美體:**
   - Detection stays lazy (`Editor.tsx:470-477`). `BodyTracker.detect` returns every body (P1–P3). It waits for the first face answer, unless the tracker could not give one (the session is unsure, §7): then it runs anyway, as in v0.3, and its bodies build the photo's cache in the 基本模式 form (`preAnswerCache`, `migrate.ts`: no face scan, nobody known), exactly as a 基本模式 photo's 美體 detection does: `p0` hands over to the primary body person (the best score, v0.3's `selectPerson`), the other bodies are persons too (the strip shows with ≥ 2). A v1 entry's own body cache is merged the same way, without a detection (the 基本模式 first answer: `firstAnswer` without faces). The cache is written like any cache (`touch: false`), so the 美體 edits made meanwhile are stored with the bodies they are drawn on, a reopen uses them, and a "nobody" there is tried again in a new up-frame (`bodyScans`). The source's one-shot inputs (`faceSeed`, `rematch`) stay for the first face answer, which merges its faces into this cache (`withFaces`, A15) with A13's hand-over on the primary body person: it keeps the nine local 美體 values whenever another person gets the face part (a person a camera seed names included; a seed in no face box names nobody, so the hand-over is an import's, C6). A dropped cache's rematch rides in the cache (`DetectionCache.rematch`) together with the persons it names, which stay in the edit, so the first face answer rematches them also after a reopen. Three rules (§5.3 R1–R3) decide what happens to persons in that time: which ids a new body may take, how the hand-over merges into a person's own params, and how the pending rematch survives a reopen.
   - `withBodies(cache, bodies)` pairs them (P4) and **appends** the body-only persons, with the lowest free `b<j>` ids. The rebase adds them from `template`. In a photo without faces, `p0` hands its params to the primary body person, then disappears. The pairing reads the cache's own faces, adapted at the photo's size (`bodyAnswer`, `migrate.ts`): that is what a session built from the cache holds, and during an engine recovery there is no session to read, so pairing against it would split every body off as a body-only person for good.
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

- `FaceProtectSource.updateAll(faces: ProtectRequest[], requested): ReadonlyMap<string, FaceProtect>`, with `ProtectRequest = {id, face, contour: boolean, pose, others}`; one face is the same call with one request (the one-face `update` / `protect` forms were removed in the step-1 follow-up), and `record` takes the drawn limits by face id.
- One memo entry per face id, keyed on the face object, its own mask and the other regions. Switching or adding faces never rebuilds a limit that is still valid.
- A limit is built only for a face whose person draws a contour warp (`contourActiveValues` of the person's values), and at most one limit is built per animation frame (§6.1); a face whose limit is still pending renders without it for those frames, as a single face does today before its limit exists.
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
| C2 | `Shot` `state.ts:17-25`; `Camera.tsx:218`; `Review.tsx:84-92`; crop `imaging.ts:12-23, 50-65` | `Shot` gains `faceSeed: FaceSeed` and loses `params`. The mapping is listed below this table. Review's 編輯 passes `{edit: importEdit(), faceSeed}`: the shot opens at 原圖 (2026-10-18; until then `Shot.look` and `{edit: cameraShotEdit(look, seed)}`). Landmarks are never handed over: the pts111 sides are image-sided (`adapter111.ts:3-4`). | 1e |
| C3 | `AppState.params` `state.ts:53-54, 77`; `settings.ts:10, 25-31, 106-111` | `AppState.look`, key `meiyan.look.v1`; first load migrates `meiyan.params.v1` through `splitLegacy` and leaves the old key alone; `hasSavedSettings` checks both. No per-face camera params (approved). | 1b |

C1 mapping:

1. Canvas rect `r`, video size `(vw, vh)`, scale `s = max(r.w/vw, r.h/vh)`.
2. `u = (x − r.left − (r.w − vw·s)/2) / (vw·s)`, and `v` likewise.
3. For `facing === 'user'`, `u = 1 − u` (the preview is mirrored).
4. `loop.hitTest(u, v)` tests the shown track boxes, each expanded to at least 44 × 44 pt (half-width `22 / (s·vw)` in u, and likewise in v); among several hits, the nearest box centre wins.
5. `cameraTapAction` (§2.5) decides: select (haptic, ring), turn 全部套用 off and select, or toggle the collapse as today.
6. The floating slider row, `.status` and buttons are excluded as today (`Camera.tsx:261`).

C2 seed mapping: `rect = centerCropRect(vw, vh, ratio)`, `x' = (x·vw − rect.x)/rect.width`, `y' = (y·vh − rect.y)/rect.height`, **not clamped** (a seed outside the crop must not match an edge face). Then `x' = 1 − x'` when the shot is saved mirrored (`Camera.tsx:205`). The seed is the centre of the track's last raw detected box, `'all'` under 全部套用, and null when no face was tracked. The edit is `importEdit()`, the 原圖 a new photo opens with (2026-10-18, the user's 「全部都原圖，包括相機拍的」; RM §3.7): the camera look drew the preview and the capture and is not handed over. Until then `cameraShotEdit` set:
- `photo` from `look.photo`, plus the editor defaults for editor-only fields;
- `primaryInit = look.person`, and `persons = {p0: look.person}` (§3.3 item 2);
- `template = neutralPerson()` for a point seed (the other faces were not beautified in the shot), or `look.person` for `'all'` or null (RM §3.7).

Seed matching in the editor (`seedPrimary`): the seed matches the face whose box, padded by 25 %, contains it (the nearest box centre if several do). 0.25 of the short edge, the earlier radius, is about the spacing of neighbouring faces in a group selfie, so a missed face would have matched its neighbour. The matched person is the primary and gets `p0`. Since the shot opens at 原圖 (2026-10-18), `p0` holds only what the user set before the first answer, and the seed's only job is to name the selected person. If no box contains a point seed (a face near the crop edge, boxed otherwise by the photo detector, or cropped away), it names nobody: the primary is chosen as for an import (A13, then the score) and gets `p0`, exactly as the same edit on an import would (v0.5 review C6). With **no face at all** in the editor's answer, `p0` is no face but the all-skin person and keeps its params, wherever the seed lies. Until the v0.5 review a seed in no box **discarded `p0`** (everyone started from `template`), and so did a seed outside the frame with no face: that kept the camera look `cameraShotEdit` put in `p0` off a face the camera had not beautified, but once the shot carried no look it dropped only the user's own edits, from every undo state (`rebaseOnDetect`), against item 2's "no edit made in that time is lost".

**Tests**

| # | Anchor | Decided approach | Sub-step |
|---|---|---|---|
| X1 | `fakeTracker` `testFakes.ts:190-212`; `makeBodyDetection` `testFakes.ts:221-236`; t7 fakes `tests/harness/t7/fakes.ts:179-241`; one-face fixtures only; `playwright.config.ts:7, 33-46` | Multi-face fakes: `fakeTracker(clock, faces = 1)` returns `faces` copies of `makeLandmarks()`, shifted 0.3 apart in x and scaled 0.6, and `null` from `detectVideo` while it is marked unusable. `makeBodyDetections(n)`. A fake `MPMask` that counts live arrays (P2). Group fixtures, parity goldens and the `chromium-group` project (§8). The harness typecheck (`tsconfig.json:20`) covers the new fakes. | 1a, 1c, 1e |

### 3.5 Limits (`src/config/limits.ts`)

| Constant | Default | Meaning | Set by |
|---|---|---|---|
| `MAX_EDIT_FACES` | 10 (6 until §6.6, 8 until §6.7) | Selectable faces per photo | §6.3 PD1, PR1, PE1, PM1 |
| `EDIT_DETECT_FACES` | `MAX_EDIT_FACES + 2` | `numFaces` of the editor's IMAGE detection (A1) | follows |
| `MAX_RENDER_FACES` | 10 (6 until §6.6, 8 until §6.7) | Shader loop bound and face-table height (compile-time); face ids f0…f9 (one digit, so at most 10) | fixed |
| `MAX_EDIT_BODIES` | 4 | `numPoses` | §6.3 PB1, PM1 |
| `MAX_LIVE_FACES` | 3 | Camera `numFaces`; 1 hides the camera's 選臉 | §6.3 PL1, PL2, PJ1 |
| `MIN_FACE_FRAC` | 0.03 | Minimum face box width / short edge | fixed |
| `LOST_HOLD_MS` | 1000 | Camera: a missing track is kept this long | fixed |
| `ONE_EURO` | `{minCutoff: 0.05, beta: 80, dCutoff: 1.0}` (Hz; values scaled by 1 / face size) | Camera smoothing, MediaPipe's own values (T4) | §6.3 PJ1, J2 |
| `SEED_BOX_PAD` | 0.25 | Seed → face match: the face box padded by this fraction must contain the seed | fixed |
| `PROTECT_WINDOW` | 128 | Protect layer edge with ≥ 2 selectable faces (§4.7) | fixed |
| `MAX_OBSTACLES` | `EDIT_DETECT_FACES` = 12 (8 until §6.7) | Obstacles kept in a cache (validation bound): one per face a detection returns, so every face it drops is an obstacle (A1) | follows |
| `FACE_TABLE_CARRIER` | `'ubo'` (`'texture'` until §6.6) | The face table's carrier on a GPU; a software rasterizer gets the texture (`faceTableCarrier.ts`, §6.4 2026-10-18) | §6.3 PR1, PG1 |

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

One copy of `src` into A, then per face with active makeup (`makeupActive(makeupUniformsFor(person, w))`): upload pts111, set the face's intensities and shades, draw the mesh (`makeup.ts:200-223`). The uniform builder takes `(values, shades, weight)` instead of `BeautyParams`.

`MESH_FS` (`makeup.ts:89-96`) writes `base · mul` on every fragment of the mesh, reading `src`. A later face's mesh would therefore erase an earlier face's lip or blush wherever the meshes overlap, even where the later face has no makeup. So the shader gains one line:

```glsl
vec3 m = mix(vec3(1.0), lipMul, uLipI) * mix(vec3(1.0), blushMul, uBlushI * vBlushFade);
if (all(greaterThanEqual(m, vec3(0.999)))) discard;   // keeps A's copy (= src) bit for bit
outColor = vec4(base * m, 1.0);
```

With one face the change is below 1/255 (a discarded fragment keeps `src`, where `src · m` differed by at most 0.001). "Last wins" (approved) now applies only where both faces have makeup.

### 4.4 P2 reshape: face table, summed displacements, cap

**Face table.** One packed `Float32Array` of `96 × MAX_RENDER_FACES` vec4 (15,360 B at 10 faces), read through one accessor `F(f, i)`. Two carriers share it, chosen at compile time by `#define FACE_TABLE_UBO`:
- **Texture:** `RGBA32F`, width 96, height `MAX_RENDER_FACES`, `NEAREST` and `CLAMP_TO_EDGE` (`createTexture` defaults to LINEAR, `gl.ts:108`, and a LINEAR float texture is incomplete), read only with `texelFetch`, re-uploaded with `texSubImage2D` when the packed key changed.
- **UBO:** a std140 block `vec4 uFaceTab[960]` (15,360 B, within the 16,384 B every WebGL2 context guarantees; `reshape.spec.ts` reads the size the driver lays out, §6.7), updated with `bufferSubData` when the packed key changed. The indices are dynamically uniform, so Apple GPUs can serve them from constant memory.

Phase 0 benches both (PR1, §6.3) and the faster ships; a PG1 failure forces the UBO. Since 2026-10-18 the UBO ships on GPUs and a software rasterizer gets the texture, picked from the WebGL renderer when the engine is built (`faceTableCarrier.ts`, §6.4).

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
const int MAX_RENDER_FACES = 10;          // §6.7 (6 until §6.6, 8 until §6.7)
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
  - where `B ≥ |d| + κ_f` the warp is exactly the face's own. Near the centre that holds for the eyes, the nose and the mouth's own items (嘴型 alone, and 下巴 alone, keep ≥ 0.99 at 1.2 FW spacing), but not for what 瘦臉 / V臉 / 窄臉 at their maximum carry into the mouth region: about 0.10 FW, against a budget of about 0.08 FW there at 1.2 FW spacing (cap 0.6 FW; the mouth sits about 0.33 FW from the box centre, so `t` ≈ 0.27 FW and `B = 0.45 · (0.27 − 0.3 · 0.6) ≈ 0.081 FW`). The strengths that are kept are measured by the sweep below (accepted 2026-10-13);
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
  - Fold: `min det J ≥ MIN_DET` (0.35, `field.ts:70`), by forward differences on a grid of step 0.02 FW (0.0024 UV at FW 0.12; about as fine as `faceProtect.test.ts` `measure()`'s half-resolution grid) over every face's influence box, where the map is not the identity (the first sweep used 41 points over the whole layout, steps up to 0.24 FW, and could miss a narrow fold). The worst value is logged: 0.503 (3 faces 1.0 FW apart at 0°); a one-off run at 0.0125 FW found 0.478 (2 faces 1.0 FW apart at 0°). The bound is never relaxed.
  - Strength (**accepted 2026-10-13**, the radius-cap trade-off measured at Task 16; the cap is unchanged). The binding measure is the plan's: the mean displacement of 8 `pts111` landmarks (72, 73, 75, 76 on the eyes, 46, 47 on the nose, 98, 102 on the mouth) with the neighbours over the same face alone. It keeps **≥ 0.9 from 1.3 FW** (0.918 at 1.3, 0.969 at 1.4) and **≥ 0.8 at 1.2 FW** (0.838; the mouth landmarks keep 0.61–0.71 there, because of the 瘦臉 / V臉 / 窄臉 shortfall above). 額頭 (at `ext[0]`) keeps ≥ 0.9 from 2.0 FW (≥ 0.998 from 1.8 FW). 下巴 (at the chin point, `pts111[16]`) keeps **≥ 0.9 from 2.2 FW** and **≥ 0.7 at 2.0–2.1 FW** (0.708 at 2.0, 0.837 at 2.1, 0.939 at 2.2): the contour items carry the chin point about 0.15 FW, more than the budget holds there; the 下巴 slider alone keeps ≥ 0.995 from 1.8 FW. The test pins these numbers, so the trade cannot get worse unnoticed. For reference only (not asserted): the mean over the `featurePolys` interiors (`faceProtect.test.ts`, pooled) keeps 0.722 at 1.2 FW, 0.805 at 1.3, 0.875 at 1.4 and 0.932 at 1.5, and the mouth polygon alone 0.564 at 1.2. Why accepted: meeting ≥ 0.9 at 1.2 FW needs a different cap (the cell of §11 Q5, or a steeper cap-only ramp or slope, which also changes `RESHAPE_FS`), and faces whose centres are 1.2–1.3 FW apart nearly touch. Closer than these spacings the approved radius rule cuts the effects (§7, §11 Q5).
  - Editor safety net: on a slider commit with ≥ 2 capped faces, the CPU port checks `min det J` on a 65 × 65 grid over each capped face's box. Below `MIN_DET` (it should never be), a per-face strength scale `λ_f` is bisected in 6 steps, as `buildBodyField` does (`field.ts:148-160`), and multiplies that face's strengths in the table until the next change. The cap shape is never changed for this. The check runs before the commit renders (run later, a frame it would scale would be shown first), so it is kept within the §6.1 commit budget (`warpGuard.ts`): the caps keep the supports disjoint, so inside face f's cap disc the summed map is f's own map bit for bit, and each face is checked on its own map, with its chain run only inside its disc (the identity outside it) and each grid point mapped once. `λ_f` then depends only on that face's table entry and limit, so it is memoized per face: a commit re-checks only the faces whose warp changed. The grid stays 65 × 65: on the fixture face at 0.6–2.6 FW spacing with every 美型 item at either end, the worst own-map `min det J` reads 0.417 at 65, 0.491 at 33 and 0.381 at 257 points, so a coarser grid would see much less of a narrow dip. The cost is cut in the map instead (2026-10-18, v0.5 review C9): `reshapeCpu.ts` computes each chain step's constants once per face rather than once per point (a curveWarp's `dir` and `r`, a disc's centre and radius), and a disc step (curveWarp, shiftAround, scaleAround, 大眼) skips its `Math.hypot` for a point beyond its radius along either iso axis, where the step's result is known exactly (`Math.hypot` is never below its largest argument). The map is the same doubles (2 million random points over 1–4 faces, with and without caps, limits and 左右分開: no bit differs), and a mapped point costs 12 `Math.hypot` instead of 92 at ten faces with every item on (`warpGuard.test.ts`), plus one for a face with a 瘦臉 limit (`protectContour`). A 全部 commit at ten faces, every face with its limit as after a contour drag, takes 18 ms on the desktop instead of 80–83 ms (15 ms instead of 79 ms without limits; bench row PC, §6.1).

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
8. **Memo:** `BodyFieldMemo` (`editorModel.ts:235`) keys on every person's local values and measure identity, the band, 長腿 with its anchor, and `bodyProtect`. A drag rebuilds only the dragged person's budgeted, guarded `L_p` (cached per `(person, values, measure, others, grid size)`, keeping only the latest full and the latest draft per person, about 0.5 MB each: a drag gives the dragged person a new key at every step), then reruns steps 5–7 at draft size.

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
| Face table | — | RGBA32F 96 × 10 (or a 15.4 KB UBO) | 15.4 KB |
| Protect | one R16F 2D, ≤ 256 edge | R16F 2D array: one ≤ 256-edge layer (one face) or ≤ 10 layers of 128² | ≤ 0.33 MB |
| **Total** | | | **≤ 1.92 MB** |

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
| A detection-driven change: the first definite face answer (new detection, v1 reopen, 基本模式 merge, rematch), body detection, the `p0` hand-over, a short-range answer completed by full-range (§6.5) | `updateEntry(…, {touch: false})` (U2) | `detect`; plus `schema: 2`, `edit`, `params`, `paramsKey` when the rebase changed `edit`; plus a thumbnail when the rendered frame changed | **no** (like today's body cache, `history.ts:69-74`) |

The Editor also moves its `saved` stamp across such a rebase (U2), so autosave does not fire for it. No cache is written while the answer is unsure (tracker recovering, detect threw). Viewing an entry, whatever detection it triggers, never reorders 最近編輯.

### 5.3 Reading and migration (`src/edit/migrate.ts`, lazy, at open)

`openState(entry, size): {edit, detect, rematch, v1Body, cacheDropped}` runs in `openInEditor` right after the decode (`flows.ts:29`), with the decoded bitmap's size; Home's `openEntry` (`Home.tsx:85-105`) passes the raw entry through. It holds the only `cachedFits` call.

| Stored | Opened as |
|---|---|
| v1, no `body`, no `detect` | `edit = {photo, persons: {p0: person}, template: neutralPerson(), primaryInit: person}` from `splitLegacy(params)`; no cache, so the editor detects once (`sessionPlan`). At the answer, the primary gets `p0` (the v0.3 look, plus any edit made meanwhile) and everyone else `neutralPerson()`, since v0.3 left the other faces untouched. The cache and the rebased `edit` are written at once (`touch: false`). |
| v1 with `body` (people = 1) | As above, plus `detect.bodies = [b0 = body]` and `bodiesComplete = true`, so the pose model is not needed. Pairing runs on the detected faces and b0 (with A14). **The primary is the person that owns b0** (the body v0.3 edited), so the body edits stay on that body and the face edits join it (A13). If faces exist but b0 pairs with none: the face-score person is the primary and gets `p0`'s face part (skin, shape, makeup, shades, preset) with neutral local 美體 items, and b0's body-only person gets `neutralPerson()` plus `p0`'s nine local `body.*` values, so v0.3's body edits keep rendering on the body v0.3 edited. Without faces, b0's person is the primary and gets `p0`. |
| v1 with `body` (people ≥ 2) | `bodies = [b0 = body]` and `bodiesComplete = false`; the same primary rules. The first opening of 美體 runs body detection again and matches the old pose to the new list (mean distance of the keypoints visible in both < 0.05). The matched body keeps the id `b0` and its person; the other bodies get the lowest free `b<j>` and become appended persons from `template`. |
| v1 with `body: null` | `bodies = []`, `bodiesComplete = true` |
| v1 with a `detect` cache (defensive: 0.4 writes `edit` together with `detect`) | `edit` from `splitLegacy`, assigned at once to `detect.primary` through `p0` and `assignPersons`; no detection |
| v2 with `detect` and `cachedFits` (aspect within 1 %, as `editorModel.ts:148-152`) | Used as is. **No detector runs** (`detectCalls` stays 0), also without a tracker (§3.3). |
| v2 whose `detect` came from 基本模式 (`faceScans` without `{quarter: 0, flipH: false}`), opened with a tracker | The editor detects when `tracker && !detect.faceScans.some(s => s.quarter === 0 && !s.flipH)` (`sessionPlan`). One detection; `withFaces` merges the faces into the cache and keeps `bodies`. A face that pairs with an existing body person links to it (the person keeps its id and params); the other faces are appended as persons from `template`, except that `p0`, if present, hands over to the primary. The primary is kept, unless it is a body person that pairs with no face while faces were found: it holds `p0`'s look, so A13's hand-over applies (the face-score person becomes the primary and gets the face part, the body person keeps its nine local 美體 values, each merged over the person's own params: R2 below). Written with `touch: false` (A15). Without a tracker the cache is used as is. A cache 美體 wrote while the tracker could not answer (§7) is this form too; a `rematch` it carries keeps the persons it names in `edit` (they are not in `persons` yet), and this detection rematches them as for a dropped cache (row below). |
| v2 with `edit` and no `detect` (closed before a definite answer, 美體 not used; with 美體 the record has a 基本模式-form cache, the row above, §7) | `edit` as stored, its `p0` included; no cache, so the editor detects once (`sessionPlan`) |
| v2 whose `detect` is corrupt or does not fit | `detect` is dropped. `normalizeEntry` keeps `edit.persons` **unfiltered** (values sanitized) and returns `staleBoxes: Record<PersonId, Rect>`, the face box of every person that still has a readable face in the raw record. `openState` returns `{edit, detect: null, rematch: staleBoxes}`. After the detection, `rematchByIoU(staleBoxes, faces)` (box IoU ≥ 0.5, greedy) gives an old → new id map, and `rebase(renamePersons(map))` renames the persons, `photo.legsAnchor` and, from step 4, every spot's `owner` (an unmatched owner becomes null). New persons without a match get `template`; old persons without a match are dropped. Toast 「已重新偵測臉部，部分人物的設定已重設」. |
| v2 whose `edit` is not an object, or has `v !== 2` | Opened as v1, from `params` (and `body`) |
| v2 whose `paramsKey` ≠ `stableKey(params)` of the params **as stored** (edited in 0.3 after a rollback; `normalizeEntry` → `legacyEdited`). Never the sanitized params (v0.4 step 4 follow-up): `sanitizeParams` fills in every param a later build adds and re-derives the preset id, so every entry saved by an earlier build read as a 0.3 edit | The photo part and the primary person's part take what 0.3 stored (`mergeLegacy`): the values of the param ids its record holds, the filter, the preset and its link, 背景保護, the 增高 band and the lip / blush shades. 0.3 draws the band in O rows, so under a quarter turn the projection carries none (`legacyProjection`): there a band 0.3 drew is dropped, and none (or, from an earlier build's projection, the band left as it was) keeps the band of `edit`. A 左右分開 item 0.3 changed takes that value on both halves (0.3 draws one value on the whole face); the split items it left as projected keep `right`, and `right` becomes null when no item's halves differ any more. What 0.3 can neither show nor write stays from `edit`: 調節, 膚質 and any later param, 質感, the geometry, the spots, the 長腿 anchor. A preset or link the merged values no longer match becomes `'custom'` / null; every other person is kept from `edit` |
| `meiyan.params.v1` without `meiyan.look.v1` (camera) | `splitLegacy` → `meiyan.look.v1` on the first load |

**Persons before the first face answer** (`migrate.ts` `firstAnswer`, `bodyAnswer`; `cache.ts` `withBodies`, `normalizeDetect`). A dropped cache, a tracker that cannot answer and 美體 used before the answer can all happen to one photo. Three rules cover that combination, and they apply to every merge, not to that case alone:

- **R1, ids.** A merge (a 美體 answer or a face answer) maps only `p0`, the persons of the cache it merges into, and the stored persons a pending rematch names. Any other person in the edit belongs to a dropped cache and has no face box, so no answer can match it. It is dropped before the merge hands out ids (old persons without a match are dropped, as above), so no new person reads its params, and its 長腿 anchor and spot owners go with it. The ids a pending rematch names are reserved until the first face answer resolves them. No new body takes one, not even to stay within b0–b3. When the free ids run out, the extra bodies with the lowest score (selectPerson's) are dropped.
- **R2, the A13 hand-over.** When someone other than b0's person is the primary, `p0`'s look is merged in two parts. Its face part goes over the primary's own params, and the primary keeps its own nine local 美體 values (say a 細腰 set before the answer). Its nine local 美體 values go over b0's person's params, and that person keeps its face values. "Own" means the params the person had before this answer, or `template` for a person new to the edit. Only a person the rematch renamed (a non-null target) is exempt: it holds a stored person's params and takes neither part. Those stored params also replace whatever this session gave that id, because the rematch renames them first.
- **R3, the pending state.** The rematch stays pending in the editor's source and, once 美體 has written the cache, in `DetectionCache.rematch`. That includes `{}`: an empty rematch still means a cache was dropped. The face answer that resolves it shows 「已重新偵測臉部，部分人物的設定已重設」, in this session or after any reopen. A pending cache that is itself dropped hands its rematch on together with its own persons' face boxes (`staleBoxes`, or both merged for a cache that does not fit).

The first write after any migration writes the v2 record (`schema: 2`). Nothing is rewritten in bulk. The face and body caps apply only to **new** detections (A16): a cache is used as stored, validated against `MAX_RENDER_FACES`, the body cap 4 and `MAX_OBSTACLES`, and never truncated, even when this device's tier lowers `MAX_EDIT_FACES` (PM1).

### 5.4 Validation (`normalizeDetect`, `sanitizeEditState`)

- **Cache:**
  - `v === 1`; finite positive `width` and `height`;
  - each face has `lm.length === 1434` with finite values, a finite box within [−0.1, 1.1], and a unique id matching `/^f[0-9]$/` (f0…f{`MAX_RENDER_FACES` − 1}, built from the constant; §6.7);
  - each obstacle has a 72-float finite oval and a finite box; at most `MAX_OBSTACLES`; a bad obstacle is dropped silently;
  - each body has 132 finite pose floats, a mask of `w·h` bytes or null, and a unique id matching `/^b[0-3]$/`;
  - persons have unique ids matching `/^(f[0-9]|b[0-3]|p0)$/` (a person's id need not equal its face or body id, §3.2); each link names an existing face or body, and no face or body is linked twice; `primary` is a listed person;
  - **a cache without faces and bodies** (`faces = []`, `bodies` null or `[]`) is valid with exactly `persons = [{id: 'p0', face: null, body: null}]` and `primary = 'p0'`. `p0` is valid only in that form;
  - a corrupt face or body drops only that part and its link. A person other than `p0` left with neither face nor body is dropped, and the cache-dropped toast shows;
  - a pending `rematch` (§7) keeps each readable box under a valid person id other than `p0` that none of the cache's own persons uses, and stays when none is left (`{}`, §5.3 R3); a cache that is dropped hands its boxes on with the stale ones (`staleBoxes`).
- **Edit:** `sanitizeEditState(raw, personIds | null)` (RM §3.4). It clamps every value to 0..1 and validates `filterId`, the shades and the preset ids. With a person list it drops persons not in it and adds missing persons from `template`; with `null` (the cache was dropped) it keeps every person for the rematch.

### 5.5 Sizes

Ten faces × 5.7 KB, twelve obstacles × 300 B, and four bodies × (528 B pose + ≤ 64 KB mask): about 320 KB per entry at the caps. `edit` for ten persons is about 6.6 KB; `paramsKey` about 1 KB. `HISTORY_LIMIT` stays 12.

---

## 6. Performance budget and Phase 0

### 6.1 Budget (targets on the user's iPhone)

| Path | Budget |
|---|---|
| Editor first open of a group photo (detect at `EDIT_DETECT_FACES`, session, cache write) | ≤ 1.5 s after the model is warm |
| The session's first photo, cold (GPU delegate: the switch to the photo bundle and the full-range graph's one-time program compile, §6.5; bench row D `app GPU 2048 first photo`) | ≤ 3 s, inside the editor's 「正在分析臉部…」 (PD3). Desktop D3D11 2026-10-18: 2.97–2.98 s photo-first, 1.38 s after the camera ran; CPU 0.10 s |
| Reopen from cache | 0 detector calls; first frame ≤ 300 ms |
| Changing the selection | No render, no rebuild; UI only (≤ 1 frame) |
| Slider frame at 2048, 10 faces, every face item on | ≤ v0.3's single-face drag on the same phone + 12 ms, and ≤ 33 ms where v0.3 already meets it |
| Slider commit (also a preset, ↶, ↷): the fold safety net (§4.4), 10 faces, every 美型 item on | ≤ 66 ms (2 frames) when every face's warp changed (全部); only the changed faces are checked, none when no face warp changed. Not yet timed on the phone; Node on the workspace desktop (2026-10-17, median of 5, `warpGuard.ts`): 6 faces 48 ms, 3 faces (`group_faces`) 26 ms, 2 faces 15 ms, and 8 ms when one person changed (176, 91 and 60 ms before the per-face check); 2026-10-18 (§6.4): 8 faces 60 ms, 6 faces 45 ms; 10 faces 75–78 ms (§6.7), **over** on this desktop for a 全部 commit. Since the per-face constants and the hypot gate (§4.4, v0.5 review C9; bench row PC as shipped, PC1: median of 5, every face with its 瘦臉 limit as after a contour drag, v0.5 review D6, D7; Node, four runs): 10 faces 18.1–18.5 ms, 8 faces 14.6–14.8 ms, 6 faces 10.7–11.1 ms, one person's change 1.8–2.0 ms; without limits 14.9–15.8, 12.0–12.1 and 8.9–9.4 ms. Before (`5b857a9`'s map in the same row, two runs): 79.6–83.1, 64.8–65.5, 47.8–48.5 and 7.8–8.3 ms; without limits 79.0–79.1, 59.9–64.0 and 45.7–46.5 ms |
| Reshape program compile + link | ≤ 300 ms |
| Body detection (`numPoses` 4 and 4 mask readbacks) | ≤ 1.5 s, once; one cached mask array plus one transient readback buffer alive at a time (P2) |
| Body field, 4 persons | full ≤ 120 ms; draft ≤ 16 ms |
| 瘦臉 limits, 10 faces | ≤ 8 ms per face, at most one limit built per animation frame (never 80 ms in one task) |
| Camera, 3 faces, skin + reshape + makeup | ≥ 24 fps (target 30) at tier H; detection p50 ≤ 20 ms |
| Camera smoothing | jitter and lag within 1.25 × MediaPipe's own smoothing at `numFaces` 1 (PJ1, PJ2) |
| Smoothing + matching, 3 faces | ≤ 0.3 ms per frame |
| New GPU memory at working resolution | ≤ 2 MB (§4.8: ≤ 1.92 MB at 2048 × 2048) |

### 6.2 Phase 0 procedure (sub-step 1a, before any feature code)

1. **Fixtures** (§8.3): `group_faces.png` with its recorded landmark JSON, `group6_faces.png`, `group_people.jpg` with its pose JSON, `group.y4m`, `group_noise.y4m`, `group_pan.y4m`, and the v0.3 parity goldens recorded from `892ea61`.
2. **GL limits and probes.**
   - Limits are read in `engine/index.ts` `build()` (next to `index.ts:58-62`), logged once and stored on `window.__meiyan.gl`: `MAX_FRAGMENT_UNIFORM_VECTORS`, `MAX_UNIFORM_BLOCK_SIZE`, `MAX_TEXTURE_SIZE`, `MAX_TEXTURE_IMAGE_UNITS`, `MAX_ARRAY_TEXTURE_LAYERS`, `EXT_color_buffer_float`, `OES_texture_float_linear`. These are `getParameter` calls and cost nothing.
   - The probes run **only in `/bench.html` and dev builds** (`import.meta.env.DEV`). In production they would add a `readPixels` stall to every engine build and context restore, and there would be nothing to switch to: the table carrier is a build-time choice (§4.4).
   - **PG1 (precision):** a 96 × 2 RGBA32F NEAREST texture, and the same values through the UBO carrier, holding 0.123456789, 0.999999, 1e9 and −1e9. Each is fetched in a draw into RGBA8 that outputs `0.5 + (fetched − expected) · 2^16`; the probe passes only at 128 ± 1 for every value. A 1/255 tolerance after an 8-bit encode would pass an fp16 or mediump path (relative error about 5e-4, roughly 1 px on landmark UVs at 2048), and `EMPTY_BOX = ±1e9` (`reshape.ts:322`) overflows fp16. With `EXT_color_buffer_float` the probe also renders into RGBA32F and compares the FLOAT readback within 2^-20 relative.
   - **PG2:** a 2-layer R16F `TEXTURE_2D_ARRAY` with LINEAR filtering, sampled with `textureLod` at the midpoint between texels of layer 1.
3. **Bench rows** (`src/bench/main.ts`, a new 「多臉」 section; results also go to the copy-results report, `bench/report.ts`). `/bench.html` deliberately has no fixed photo URL (`bench/main.ts:410-411`), so the procedure is: save `group_faces.png`, `group6_faces.png` and `group_people.jpg` to the phone's Photos and pick them; for the camera rows, show `group_faces.png` full screen on a second screen and point the phone at it.
   - **D:** `detectImage` on `group_faces.png` at decodes 2048 and 1440, with `numFaces` 1/4/6/8/10 and `EDIT_DETECT_FACES` (12 since §6.7), on GPU and CPU. Columns: first call, median of 5 warm calls, faces found, whether the order matches across the two decodes. First, since 2026-10-18, the app rows (`app GPU|CPU 2048 first photo`, PD3): a tracker built as `services.ts` builds it, its first `detectImage` at 2048 (`first_ms`, the session's cold first photo when `cold` is true: tap D first after opening `/bench.html`), then a warm one (`next_ms`), the short-range retry (`retry_ms`, §6.5) and the photo bundle again (`back_ms`).
   - **L:** `detectForVideo` on the camera at `numFaces` 1, 2 and 3, with 1 and with 3 faces in view, at tier H, on the GPU and the CPU delegate. One tracker per delegate switches its count in place (as the camera's single instance would), warms up 2 s after each switch, and is timed for 5 s per count in two rounds, 1 2 3 then 3 2 1. Columns: detection p50/p95, fps (the detection-only frame rate), faces found, frames, and `switch_ms` (the slowest first inference after a switch to that count). The bench then prints the verdict rows (`bench/report.ts` `liveRows`): **PL2** per delegate when one face was in view, **PL1** per count ≥ 2 when three were.
   - **J (jitter):** a static scene, on the device (phone on a stand) or on `group_noise.y4m` (seeded per-frame landmark-scale noise; today's y4m repeats one identical frame, `gen-y4m.mjs:165-170`, so raw jitter there is about 0 and the comparison means nothing). The RMS over 2 s of every `pts111` point's deviation from its mean, in px scaled to a 1080-px frame height. Variants: `numFaces` 1 (MediaPipe smoothing), `numFaces` 3 raw, `numFaces` 3 with the app smoother.
   - **J2 (lag):** a panning clip (the phone panned slowly across the second screen, or `group_pan.y4m`, whose faces translate 0.5 face widths per second). The mean delay of the `pts111` centroid behind the raw detections, time-aligned, for `numFaces` 1 (MediaPipe smoothing) and `numFaces` 3 with the app smoother.
   - **B:** body detection on `group_people.jpg` with `numPoses` 2 and 4. Columns: detection time, readback and downscale time per person, persons found, and the peak JS heap during the readback (`performance.memory` where available).
   - **BF:** `buildBodyField` with 4 persons (`group_people.jpg`'s two measures plus their mirrored copies), full and draft.
   - **F:** `buildFaceProtect` for each of the 6 faces of `group6_faces.png` at 2048, with the selfie mask.
   - **R:** a reshape microbench with the `MAX_RENDER_FACES` loop, every item at maximum and the caps on, at 1080 and 2048, for both table carriers. Layouts (`bench/reshapeLayouts.ts`): N = 1…`MAX_RENDER_FACES` (10 since §6.7) spread across the frame, 6, 8 and 10 faces in a row at 1.2 FW spacing (FW 0.1; the row of ten at FW 0.081, the widest that fits the square frame), and 2 × 3, 2 × 4 and 2 × 5 grids at 1.3 FW. Timing: 30 warm-up draws, then batches of 10 draws per 1-px `readPixels` (iOS has no timer query, and one `readPixels` per draw lets the GPU idle and down-clock), divided by 10; the median of 10 batches, minus the N = 0 baseline.
   - **RC:** reshape compile + link time (the first draw), per carrier.
   - **RP:** the reshape pin harness (`tests/e2e/pages/reshape.ts`, with the two-face and capped cases of §8.2) run in `/bench.html`: max |GPU − CPU| in px on the phone's GPU. The e2e check runs only on Chromium (SwiftShader or ANGLE), never on Metal.
   - **PE:** an editor drag on `group6_faces.png` at 2048 (every face item + 磨皮 on every person), p50 of the frame time, and the same drag at `892ea61` on a one-face photo.
   - **PC (2026-10-18, v0.5 review C9):** the slider commit's fold check (§4.4, `warpGuard` through `createWarpGuard`, as the editor runs it; `bench/foldGuardBench.ts`) on the fixture face in R's 2 × 3, 2 × 4 and 2 × 5 grids at 1.3 FW (6, 8 and 10 faces), every 美型 item at maximum, square frame, CPU only. Every face carries its 瘦臉 limit, built as the editor builds it once a contour slider moved with ≥ 2 faces (`protectRequests`: a selfie mask, here the whole frame as in F, clipped to the face's cell, the other faces infinitely far, a `PROTECT_WINDOW`² window; v0.5 review D6): with a limit the check runs `protectContour` on every mapped point, whatever the limit holds. `all_ms`: a 全部 commit (every face's warp changed, every face checked); `one_ms`: one person's change (that face checked, the rest from the memo); `all_ms_unlimited`: the same 全部 commit without limits (before any contour drag: a preset or a default look never asks for them). One warm-up commit per variant, then the median of 5, the value alternating between 1 and 0.95; `lambda_min` 1 when the guard acted in no commit. It needs the dev server's `/tests/fixtures` like R.
   - **M (memory):** the flow "open `group_people.jpg` → open 美體 → wait for persons". With a Mac and Safari Web Inspector: the peak of the memory timeline, against the same flow at `892ea61`. Without a Mac (this workspace is Windows): a kill test on the SE-class phone, running the flow 3 times with a localStorage breadcrumb set at the start and cleared at the end; pass = no reload and no stale breadcrumb.
4. **Where:**
   - Desktop: Chromium through Playwright for correctness, and GPU-enabled desktop Chrome on `npm run dev` for timings.
   - iPhone: `/bench.html`. It needs a secure-context preview deploy, **which happens only after the user's go-ahead**.
   - Until the iPhone numbers exist, the §3.5 defaults ship.

### 6.3 Thresholds and fallbacks

Each row is applied to the **slowest iPhone measured**. A change is one line in `limits.ts` (or the stated code path), committed together with the numbers.

| ID | Measured | Keep default if | Fallback |
|---|---|---|---|
| PD1 | `detectImage` warm median at `EDIT_DETECT_FACES` (12), 2048 | ≤ 400 ms | ≤ 800 ms → `MAX_EDIT_FACES = 4` (request 6); > 800 ms → `2` (request 4) |
| PD3 | Row D's `app GPU 2048 first photo` `first_ms` with `cold true` (the session's first photo, §6.5) | ≤ 3 s | Over → no `limits.ts` line: §6.5 *Mitigations considered* (the camera bundle for a camera hand-over whose live tracks held ≤ 1 face, at the cost of full-range on those shots), the user's call with the number |
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
| PR1 | Reshape microbench (R), N = `MAX_EDIT_FACES` (10), the clustered layouts, 2048 | ≤ 8 ms with the faster carrier | The faster carrier ships either way. N = 8 ≤ 8 ms → `MAX_EDIT_FACES = 8`; N = 6 → `6`; N = 4 → `4`; else `2` |
| PRC | Reshape compile + link (RC) | ≤ 300 ms | Compile in `build()` instead of lazily (`pipeline.ts:401`); still over → `MAX_RENDER_FACES = 4` |
| PRP | GPU vs CPU port on the phone (RP) | max < 0.05 px | Treated as a PG1 failure (UBO carrier); still failing → a port or driver bug: step 1 does not ship until it is understood |
| PE1 | Editor drag (PE), p50 at 2048 | ≤ v0.3's one-face drag on the same phone + 12 ms | `MAX_EDIT_FACES = 4` |
| PC1 | The slider commit's fold check (PC), `all_ms` at 10 faces (a 全部 commit, §6.1) | ≤ 66 ms | Over → no `limits.ts` line and no coarser grid: the cap of ten is the user's (§6.7), and a coarser grid sees less of a narrow dip (§4.4), so an unchecked fold could be shown. The number goes to the user with the options (`MAX_EDIT_FACES = 8`, or the check split across frames while the commit's frame waits). Desktop 2026-10-18 (median of 5, with the limits): Node 18.1–18.5 ms, headless Chromium 17.4–17.6 ms |
| PM1 | Memory (M) | Kill test passes 3 of 3 (or, with Web Inspector, peak Δ vs v0.3 ≤ 20 MB) | On tier L devices only: `MAX_EDIT_FACES = 4`, `MAX_EDIT_BODIES = 2` |

`MAX_FRAGMENT_UNIFORM_VECTORS` and `MAX_UNIFORM_BLOCK_SIZE` are recorded. The design does not depend on them: the reshape program needs fewer than 32 vectors outside the table, and the UBO carrier needs 15,360 B of the guaranteed 16,384 B (§6.7).

### 6.4 Recording the results

Sub-step 1a appends a dated table to this section, with device, OS, browser, row ID, value and the decision taken. The `limits.ts` change and the one-line update of RM §6.2 go in the same commit. Later iPhone runs append rows the same way.

#### Results

First run, `node scripts/bench-multiface.mjs D B GL` (the workspace desktop: Windows 11 Pro 10.0.22631, Chrome 154.0.8037.57 headed with the GPU, `npm run dev` build of `/bench.html?fixtures=1`). `group_faces.png` is 1800 × 1200, so the D rows labelled 2048 run on the undecoded 1800 × 1200 (`decode` column). B's `numPoses 2` time is the first PoseLandmarker detection on the page (wasm graph start-up included; `numPoses 4` ran second, warm).

#### 2026-10-12 desktop Chrome (GPU) — ANGLE (Intel, Intel(R) UHD Graphics 770 (0x0000A780) Direct3D11 vs_5_0 ps_5_0, D3D11)

| Row | Config | Values |
|---|---|---|
| D | GPU 2048 n1 | decode 1800x1200, first_ms 232.3, median_ms 21, faces 1, centres 0.22 |
| D | GPU 2048 n4 | decode 1800x1200, first_ms 153.3, median_ms 34.3, faces 3, centres 0.22 0.55 0.82 |
| D | GPU 2048 n6 | decode 1800x1200, first_ms 156.7, median_ms 33.6, faces 3, centres 0.22 0.55 0.82 |
| D | GPU 2048 n8 | decode 1800x1200, first_ms 155.9, median_ms 34.6, faces 3, centres 0.22 0.55 0.82 |
| D | GPU 1440 n1 | decode 1440x960, first_ms 135, median_ms 15.5, faces 1, centres 0.22 |
| D | GPU 1440 n4 | decode 1440x960, first_ms 152.8, median_ms 32.1, faces 3, centres 0.22 0.55 0.82 |
| D | GPU 1440 n6 | decode 1440x960, first_ms 142, median_ms 28.4, faces 3, centres 0.22 0.55 0.82 |
| D | GPU 1440 n8 | decode 1440x960, first_ms 140.5, median_ms 29.9, faces 3, centres 0.22 0.55 0.82 |
| D | GPU order 2048 vs 1440 (n8) | same true |
| D | CPU 2048 n1 | decode 1800x1200, first_ms 42.1, median_ms 20.2, faces 1, centres 0.22 |
| D | CPU 2048 n4 | decode 1800x1200, first_ms 46.3, median_ms 39.6, faces 3, centres 0.22 0.55 0.82 |
| D | CPU 2048 n6 | decode 1800x1200, first_ms 50.8, median_ms 40.6, faces 3, centres 0.22 0.55 0.82 |
| D | CPU 2048 n8 | decode 1800x1200, first_ms 49.2, median_ms 39.2, faces 3, centres 0.22 0.55 0.82 |
| D | CPU 1440 n1 | decode 1440x960, first_ms 34.1, median_ms 18.2, faces 1, centres 0.22 |
| D | CPU 1440 n4 | decode 1440x960, first_ms 46.1, median_ms 37.1, faces 3, centres 0.22 0.55 0.82 |
| D | CPU 1440 n6 | decode 1440x960, first_ms 44.3, median_ms 38.5, faces 3, centres 0.22 0.55 0.82 |
| D | CPU 1440 n8 | decode 1440x960, first_ms 44.1, median_ms 35.7, faces 3, centres 0.22 0.55 0.82 |
| D | CPU order 2048 vs 1440 (n8) | same true |
| B | numPoses 2 | detect_ms 2511.7, readback_ms_per_person 10.4, persons 2, peak_heap_mb 59.9 |
| B | numPoses 4 | detect_ms 279.2, readback_ms_per_person 7.3, persons 2, peak_heap_mb 84.6 |
| GL | limits | MAX_FRAGMENT_UNIFORM_VECTORS 1024, MAX_UNIFORM_BLOCK_SIZE 65536, MAX_TEXTURE_SIZE 16384, MAX_TEXTURE_IMAGE_UNITS 16, MAX_ARRAY_TEXTURE_LAYERS 2048, EXT_color_buffer_float true, OES_texture_float_linear true |
| GL | probes | PG1_texture true, PG1_ubo true, PG1_float32 true, PG2 true |

Decisions: none taken (desktop only; the §3.5 defaults ship until iPhone rows exist, RM §12). PG1/PG2 on desktop: `PG1_texture true, PG1_ubo true, PG1_float32 true, PG2 true` (`FACE_TABLE_CARRIER` stays `'texture'`). PD2 on desktop Chromium: A, B and C are found at both decodes (centres 0.22 / 0.55 / 0.82), D is not returned. The same four probes also pass inside the engine context of a dev build (`window.__meiyan.gl` on `tests/e2e/pages/engine.html`, headless Chrome SwiftShader), with `getError()` 0 afterwards.

ONE_EURO: LandmarksSmoothingCalculator is compiled into `node_modules/@mediapipe/tasks-vision/wasm/vision_wasm_internal.wasm` (0.10.35) and its graph options are not stored as text, but the code holds them as constants. At two sites (most likely the face and the pose landmarker graphs; the binary has no symbols to tell which is which) one `i64.store` writes the adjacent OneEuroFilter fields `min_cutoff` 0.05 and `beta` 80 (`i64.const 0x42A000003D4CCCCD`), and the next `i32.store` writes `derivate_cutoff` 1.0 (`0x3F800000`), at consecutive field offsets (212 / 216 / 220 and 56 / 60 / 64). The §3.5 values {minCutoff 0.05, beta 80, dCutoff 1.0} therefore match the 0.10.35 binary. This was not checked against the C++ source, and neither was the graph's `numFaces` 1 condition for smoothing.

#### 2026-10-12 desktop Chrome (GPU), rows R / RC — ANGLE (Intel, Intel(R) UHD Graphics 770 (0x0000A780) Direct3D11 vs_5_0 ps_5_0, D3D11)

`node scripts/bench-multiface.mjs R` (sub-step 1c, Task 17: the face-table `RESHAPE_FS`), same desktop and Chrome as above. Every 美型 item at maximum, caps on (`capsFor` of the layout, no obstacles), square frame. `spread n`: n faces of FW 0.35 / n across the middle row (2.8 FW apart); `row 6 @1.2FW` and `grid 2×3 @1.3FW`: FW 0.1 at 0.12 / 0.13 spacing. `ms` = the median batch time per draw minus the N = 0 baseline (S §6.2). RC = program compile + link + the first draw; the 2048 RC of each carrier reuses the program the 1080 run had just built (ANGLE's program cache), so only the 1080 RC is a cold compile.

| Row | Config | Values |
|---|---|---|
| RC | texture 1080 | compile_ms 190 |
| R | texture 1080 spread 1 | ms 1.34 |
| R | texture 1080 spread 2 | ms 1.04 |
| R | texture 1080 spread 3 | ms 1.08 |
| R | texture 1080 spread 4 | ms 1.21 |
| R | texture 1080 spread 5 | ms 1.43 |
| R | texture 1080 spread 6 | ms 1.67 |
| R | texture 1080 row 6 @1.2FW | ms 1.63 |
| R | texture 1080 grid 2×3 @1.3FW | ms 1.7 |
| RC | texture 2048 | compile_ms 8 |
| R | texture 2048 spread 1 | ms 6.5 |
| R | texture 2048 spread 2 | ms 4.91 |
| R | texture 2048 spread 3 | ms 5.3 |
| R | texture 2048 spread 4 | ms 6.12 |
| R | texture 2048 spread 5 | ms 7.12 |
| R | texture 2048 spread 6 | ms 8.09 |
| R | texture 2048 row 6 @1.2FW | ms 8.37 |
| R | texture 2048 grid 2×3 @1.3FW | ms 8.39 |
| RC | ubo 1080 | compile_ms 215 |
| R | ubo 1080 spread 1 | ms 0.91 |
| R | ubo 1080 spread 2 | ms 0.63 |
| R | ubo 1080 spread 3 | ms 0.62 |
| R | ubo 1080 spread 4 | ms 0.7 |
| R | ubo 1080 spread 5 | ms 0.6 |
| R | ubo 1080 spread 6 | ms 0.74 |
| R | ubo 1080 row 6 @1.2FW | ms 0.83 |
| R | ubo 1080 grid 2×3 @1.3FW | ms 0.91 |
| RC | ubo 2048 | compile_ms 9 |
| R | ubo 2048 spread 1 | ms 3.2 |
| R | ubo 2048 spread 2 | ms 2.1 |
| R | ubo 2048 spread 3 | ms 1.86 |
| R | ubo 2048 spread 4 | ms 2.02 |
| R | ubo 2048 spread 5 | ms 2.26 |
| R | ubo 2048 spread 6 | ms 2.46 |
| R | ubo 2048 row 6 @1.2FW | ms 2.54 |
| R | ubo 2048 grid 2×3 @1.3FW | ms 2.69 |

PR1/PRC (desktop): the UBO carrier is the faster one, N = 6 at 2048 2.46 ms spread, 2.54 ms in the 1.2 FW row and 2.69 ms in the 1.3 FW grid (the texture carrier: 8.09 / 8.37 / 8.39 ms); cold compile + link 215 ms (UBO) and 190 ms (texture), both within PRC's 300 ms. FACE_TABLE_CARRIER stays 'texture' unless the UBO is faster on the slowest iPhone (pending a deploy).

RP: on desktop Chromium (headless SwiftShader, `tests/e2e/reshape.spec.ts`), `runReshapePinMulti` gives max |GPU − CPU| 0.0001 px (two faces, every warp), 0.0001 px (capped pair, one neutral) and 0.0000 px (an obstacle bounding the cap) with both carriers, and the three one-face pins are unchanged (0.0001 / 0.0001 / 0.0014 px). On the phone, RP is the same page, `/tests/e2e/pages/reshape.html`, and the bench's R button fetches `/tests/fixtures/landmarks_sample_face.json`: neither path is in a production build (`dist/`), so both are recorded from a dev server the phone can reach (`npm run dev`, `server.host`), not from a preview deploy alone.

#### 2026-10-12 desktop Chrome (GPU), rows L / J / J2 / F / BF / PE / M — ANGLE (Intel, Intel(R) UHD Graphics 770 (0x0000A780) Direct3D11 vs_5_0 ps_5_0, D3D11)

Sub-step 1e (Task 25), same desktop and Chrome as above (the heading date is the driver's UTC date; local time was the morning of 2026-10-13): `node scripts/bench-multiface.mjs --video tests/fixtures/group.y4m L`, `--video tests/fixtures/group_noise.y4m J`, `--video tests/fixtures/group_pan.y4m J2`, then `F BF PE M`. The camera rows read Chrome's fake camera fed by the 1280 × 720, 30 fps clip (A, B and C in view; `group_pan` pans them); L measured 25 fps at both counts, so on this desktop its fps does not separate them (p50 / p95 do). J and J2 warm both graphs up for 1.5 s first, and all three runs follow the face MediaPipe's numFaces-1 graph picks (the raw face with the nearest pts111 centroid). A first J / J2 run without either change had only 9 frames in J (the first GPU inferences ate the 2 s window) and a J2 `mediapipe` lag of −1089 ms (numFaces 1 had followed a different face from the raw largest).

| Row | Config | Values |
|---|---|---|
| L | numFaces 1 | p50_ms 12.3, p95_ms 17.8, fps 25.1, faces 1 |
| L | numFaces 3 | p50_ms 30.3, p95_ms 37, fps 25.2, faces 3 |
| J | mediapipe | rms_px1080 0.3, frames 50 |
| J | raw | rms_px1080 0.7, frames 50 |
| J | app | rms_px1080 0.3, frames 50 |
| J2 | mediapipe | lag_ms 16.3, samples 92 |
| J2 | app | lag_ms 4, samples 92 |
| F | f0 | ms 16.6 |
| F | f1 | ms 9.6 |
| F | f2 | ms 8.1 |
| F | f3 | ms 6.6 |
| F | f4 | ms 8 |
| F | f5 | ms 6.7 |
| BF | 4 persons | full_ms 88, draft_ms 15, drag_ms 5 |
| PE | 6 faces 2048 | p50_ms 29.5 |
| M | run 1 | persons 2, heapMB 55 |
| M | run 2 | persons 2, heapMB 65 |
| M | run 3 | persons 2, heapMB 63 |

Desktop readings against §6.3, for orientation only:
- PJ1: app 0.3 px ≤ max(0.4, 1.25 × 0.3). PJ2: app 4 ms ≤ 1.25 × 16.3 ms.
- PBF: full 88 ≤ 120 ms and draft 15 ≤ 16 ms. PM1: 3 of 3 runs completed.
- PL1: p50 30.3 ms at 3 faces is above the 20 ms target on this desktop's GPU delegate. PL2 needs a one-face scene and was not measured here (it was on 2026-10-13, below).
- PF: f0, the first call, is 16.6 ms; the other faces are 6.6 to 9.6 ms.
- PE1: there is no v0.3 one-face drag baseline in this run.

Decisions: none taken (desktop only; PL1/PL2/PJ1/PJ2/PB1/PBF/PF/PE1/PM1 need the iPhone rows, RM §12: the §3.5 defaults ship).

#### 2026-10-13 desktop Chrome (GPU), rows L / PL2 / PL1 — ANGLE (Intel, Intel(R) UHD Graphics 770 (0x0000A780) Direct3D11 vs_5_0 ps_5_0, D3D11)

Step-1 follow-up (the whole-step review's `limits.ts` P3). Same desktop: Windows 11 Pro 10.0.22631, Intel Core i7-14700, 32 GB, Chrome 154.0.8037.57 headed with the GPU, `npm run dev` build of `/bench.html?fixtures=1`. Row L as now described in §6.2 (GPU and CPU delegates, `numFaces` 1 / 2 / 3, interleaved rounds). `node scripts/bench-multiface.mjs --video tests/fixtures/face.y4m L` (one face in view: PL2), then `--video tests/fixtures/group.y4m L` (A, B and C in view: PL1). Chrome's fake camera plays each 1280 × 720 clip at 30 fps. The bench times `detectForVideo` alone, with no render, so its fps is the detection-only frame rate and not the camera's.

One face in view (`face.y4m`):

| Row | Config | Values |
|---|---|---|
| L | GPU numFaces 1 | p50_ms 12.1, p95_ms 16.8, fps 30, faces 1, frames 301, switch_ms 146.5 |
| L | GPU numFaces 2 | p50_ms 16.4, p95_ms 21.4, fps 28.7, faces 1, frames 287, switch_ms 146.9 |
| L | GPU numFaces 3 | p50_ms 16.4, p95_ms 21.4, fps 29.7, faces 1, frames 298, switch_ms 144.6 |
| L | CPU numFaces 1 | p50_ms 13.7, p95_ms 17.3, fps 30, faces 1, frames 301, switch_ms 36.5 |
| L | CPU numFaces 2 | p50_ms 15.8, p95_ms 19.2, fps 29.4, faces 1, frames 294, switch_ms 34.5 |
| L | CPU numFaces 3 | p50_ms 15.8, p95_ms 18.8, fps 29.6, faces 1, frames 297, switch_ms 32.7 |
| PL2 | GPU | delta_p50_ms 4.2, delta_p95_ms 4.6, delta_pct 35.1, limit_ms 5, verdict pass |
| PL2 | CPU | delta_p50_ms 2.1, delta_p95_ms 1.5, delta_pct 15.3, limit_ms 5, verdict pass |

Three earlier runs of the same one-face scene, timed the same way: PL2 GPU Δp50 3.9 / 3.5 / 3.9 ms (+31.5 / +27.6 / +32 %), CPU 2.1 / 1.9 / 1.9 ms (+15.2 / +13.8 / +13.8 %). In those runs `switch_ms` either was not yet measured or still included the tracker's first inference ever (1583 ms on the GPU), which the bench now runs untimed during a 2 s warm-up.

Three faces in view (`group.y4m`):

| Row | Config | Values |
|---|---|---|
| L | GPU numFaces 1 | p50_ms 12.6, p95_ms 17.7, fps 30, faces 1, frames 301, switch_ms 162.6 |
| L | GPU numFaces 2 | p50_ms 21.5, p95_ms 26.2, fps 28.3, faces 2, frames 283, switch_ms 165 |
| L | GPU numFaces 3 | p50_ms 30.7, p95_ms 36.4, fps 22.9, faces 3, frames 230, switch_ms 165.1 |
| L | CPU numFaces 1 | p50_ms 13.6, p95_ms 18.4, fps 29.9, faces 1, frames 300, switch_ms 37.4 |
| L | CPU numFaces 2 | p50_ms 22.4, p95_ms 24.8, fps 29.9, faces 2, frames 300, switch_ms 42.9 |
| L | CPU numFaces 3 | p50_ms 31.6, p95_ms 35.7, fps 20.6, faces 3, frames 208, switch_ms 49.3 |
| PL1 | GPU numFaces 2 | p50_ms 21.5, fps 28.3, limit p50 ≤ 20 ms, fps ≥ 24, verdict fail |
| PL1 | GPU numFaces 3 | p50_ms 30.7, fps 22.9, limit p50 ≤ 20 ms, fps ≥ 24, verdict fail |
| PL1 | CPU numFaces 2 | p50_ms 22.4, fps 29.9, limit p50 ≤ 20 ms, fps ≥ 24, verdict fail |
| PL1 | CPU numFaces 3 | p50_ms 31.6, fps 20.6, limit p50 ≤ 20 ms, fps ≥ 24, verdict fail |

Two earlier three-face runs gave GPU p50 21.3 / 21.5 ms (n2) and 30.8 / 30.5 ms (n3), CPU 22.1 / 22.2 ms and 31.5 / 31.6 ms.

Readings:
- PL2 passes on this desktop in all four runs. A lone selfie pays 3.5–4.2 ms more per detection at `numFaces` 3 on the GPU delegate (+28–35 % of v0.3's `numFaces` 1 p50) and 1.9–2.1 ms on CPU, against the 5 ms tolerance. With one face, `numFaces` 2 costs the same as 3. That fits MediaPipe's documented VIDEO-mode tracking, where the face detector runs only while fewer faces than `numFaces` are tracked (not checked in the 0.10.35 source).
- The cheaper alternative was not adopted: run `numFaces` 1 until a second face appears. At `numFaces` 1 the graph stops detecting once it tracks the face, so its output gives no sign of a second face. Raising the count when one appears needs a graph rebuild, whose first inference took 145–165 ms on the GPU (33–49 ms on CPU): a visible hitch each time a second face came or went. A second detector instance would break the single-instance rule (`tracker.ts:3-5`). T1 therefore stands: the camera keeps `LIVE_DETECT_FACES = MAX_LIVE_FACES` and never toggles the count. Instead, PL2 is pinned as a bench verdict (`PL2_MAX_DELTA_MS = 5` in `bench/report.ts`, unit-tested), so the iPhone run prints pass or fail directly.
- PL1 fails on this desktop at `numFaces` 3 (p50 about 31 ms, detection-only fps 20.6–23.9 across the three runs). It also fails at `numFaces` 2 (p50 21.3–22.4 ms, just over the 20 ms limit), on both delegates. If this desktop were the deciding device, §6.3 would fall back to `MAX_LIVE_FACES = 1`.

Decisions: none taken. §6.3 applies PL1 and PL2 to the slowest iPhone measured, and under RM §12 the §3.5 defaults ship until those rows exist, so `MAX_LIVE_FACES` stays 3. The iPhone L rows decide (pointed at one face for PL2, at `group_faces.png` on a second screen for PL1). PL2 fail → 1. PL1 fail at 3 → the bench's `numFaces` 2 verdict picks 2 or 1.

#### 2026-10-18 desktop Chrome (GPU), rows R / RC / D at eight faces — ANGLE (Intel, Intel(R) UHD Graphics 770 (0x0000A780) Direct3D11 vs_5_0 ps_5_0, D3D11)

For §6.6 (the face cap 6 → 8). Same desktop, now Chrome 155.0.8059.80 headed with the GPU (the rows above ran 154), `npm run dev` build of `/bench.html?fixtures=1`. `node scripts/bench-multiface.mjs R`, three runs (the bench prints the UTC date, 2026-10-17). Row R now also has N = 7 and 8 spread, 8 in a row at 1.2 FW and a 2 × 4 grid at 1.3 FW; every clustered layout is centred on the frame. `ms` as on 2026-10-12: the median batch per draw minus the N = 0 baseline. First run:

| Row | Config | Values |
|---|---|---|
| RC | texture 1080 | compile_ms 390 |
| R | texture 1080 spread 1 | ms 2.72 |
| R | texture 1080 spread 2 | ms 1.86 |
| R | texture 1080 spread 3 | ms 1.8 |
| R | texture 1080 spread 4 | ms 1.77 |
| R | texture 1080 spread 5 | ms 2.04 |
| R | texture 1080 spread 6 | ms 2.25 |
| R | texture 1080 spread 7 | ms 2.6 |
| R | texture 1080 spread 8 | ms 2.84 |
| R | texture 1080 row 6 @1.2FW | ms 2.4 |
| R | texture 1080 grid 2×3 @1.3FW | ms 2.38 |
| R | texture 1080 row 8 @1.2FW | ms 2.92 |
| R | texture 1080 grid 2×4 @1.3FW | ms 3.19 |
| RC | texture 2048 | compile_ms 12 |
| R | texture 2048 spread 1 | ms 10.45 |
| R | texture 2048 spread 2 | ms 6.98 |
| R | texture 2048 spread 3 | ms 6.8 |
| R | texture 2048 spread 4 | ms 7.15 |
| R | texture 2048 spread 5 | ms 8.02 |
| R | texture 2048 spread 6 | ms 8.81 |
| R | texture 2048 spread 7 | ms 9.7 |
| R | texture 2048 spread 8 | ms 10.67 |
| R | texture 2048 row 6 @1.2FW | ms 9.05 |
| R | texture 2048 grid 2×3 @1.3FW | ms 9.17 |
| R | texture 2048 row 8 @1.2FW | ms 11.85 |
| R | texture 2048 grid 2×4 @1.3FW | ms 12.14 |
| RC | ubo 1080 | compile_ms 391 |
| R | ubo 1080 spread 1 | ms 1.43 |
| R | ubo 1080 spread 2 | ms 0.75 |
| R | ubo 1080 spread 3 | ms 0.73 |
| R | ubo 1080 spread 4 | ms 0.68 |
| R | ubo 1080 spread 5 | ms 0.69 |
| R | ubo 1080 spread 6 | ms 0.93 |
| R | ubo 1080 spread 7 | ms 1.1 |
| R | ubo 1080 spread 8 | ms 0.96 |
| R | ubo 1080 row 6 @1.2FW | ms 1.05 |
| R | ubo 1080 grid 2×3 @1.3FW | ms 0.78 |
| R | ubo 1080 row 8 @1.2FW | ms 1.33 |
| R | ubo 1080 grid 2×4 @1.3FW | ms 1.48 |
| RC | ubo 2048 | compile_ms 12 |
| R | ubo 2048 spread 1 | ms 5.54 |
| R | ubo 2048 spread 2 | ms 3.34 |
| R | ubo 2048 spread 3 | ms 2.83 |
| R | ubo 2048 spread 4 | ms 2.86 |
| R | ubo 2048 spread 5 | ms 2.86 |
| R | ubo 2048 spread 6 | ms 3.16 |
| R | ubo 2048 spread 7 | ms 3.49 |
| R | ubo 2048 spread 8 | ms 3.82 |
| R | ubo 2048 row 6 @1.2FW | ms 3.35 |
| R | ubo 2048 grid 2×3 @1.3FW | ms 3.49 |
| R | ubo 2048 row 8 @1.2FW | ms 4.42 |
| R | ubo 2048 grid 2×4 @1.3FW | ms 4.78 |

The three runs at 2048, and the same bench on a build with `MAX_RENDER_FACES = 6` (two runs), which isolates the loop bound:

| Config (2048) | texture, cap 8 | texture, cap 6 | UBO, cap 8 | UBO, cap 6 |
|---|---|---|---|---|
| spread 1 | 10.36–10.45 | 10.32–10.37 | 5.54–5.58 | 5.55–5.60 |
| spread 6 | 8.80–8.82 | 8.72–8.79 | 3.10–3.18 | 3.11–3.13 |
| row 6 @1.2FW | 9.02–9.05 | 9.00–9.02 | 3.18–3.35 | 3.37–3.39 |
| grid 2×3 @1.3FW | 9.17–9.41 | 9.30–9.36 | 3.42–3.49 | 3.38–3.50 |
| spread 8 | 10.67–10.77 | — | 3.58–3.82 | — |
| row 8 @1.2FW | 11.84–11.87 | — | 4.42–4.53 | — |
| grid 2×4 @1.3FW | 12.08–12.26 | — | 4.64–4.78 | — |
| RC 1080 (cold compile + link + first draw) | 334–390 | 334–345 | 341–391 | 332–400 |

Row D on `small_faces.jpg` (seven faces, in its layout before 2026-10-19: *Re-check on the new layout* below the ten-face rows; `/bench.html`'s row D reads `group_faces.png`, so a scratch driver called the bench's `rowD` with the 7-face fixture), the photo model, median of 5 warm calls in ms (first call):

| Delegate | 2048 n8 | 2048 n10 | 1440 n8 | 1440 n10 | Faces at n8 / n10 |
|---|---|---|---|---|---|
| GPU | 76.5 (201) | 80.8 (226) | 70.6 (202) | 80.7 (219) | 7 / 7 |
| CPU | 82.6 (89) | 81.5 (90) | 76.7 (86) | 77.7 (86) | 7 / 7 |

The slider commit's fold check (`warpGuard`, Node on the same desktop, every 美型 item at max, faces 0.12 of the width 1.3 FW apart in rows of 2, 3, 3 and 4, median of 5, two runs): 2 faces 15.2–15.6 ms, 3 faces 23.3–23.5 ms, 6 faces 45.4–45.7 ms, 8 faces 60.0–60.1 ms.

Software rasterizer: headless Chromium 153 on SwiftShader (the e2e renderer), a scratch probe with the bench's draws at 1080 (3 warm-up draws, then the median of 5 batches of 3): the texture carrier's baseline (no face) 18.7 ms, then +42.4 / +56.2 / +111.5 ms for 1 / 3 / 8 spread faces, first draw 91 ms; the UBO's baseline 59.8 ms, then +80.2 / +178.4 / +393.1 ms, first draw 192 ms. In the app on SwiftShader the persons spec's 全部 + 瘦臉 test ran past its 120 s timeout with the UBO and in 43 s with the texture.

Readings and decisions:
- **PR1** at N = 8, 2048: the UBO is the faster carrier, 3.6–4.8 ms over the spread, row and grid layouts against 10.7–12.3 ms for the texture (2.5–3×); the texture is over PR1's 8 ms already at N = 6 (8.8–9.4 ms). **Decision:** `FACE_TABLE_CARRIER = 'ubo'` (§6.3 PR1: the faster carrier ships) and `MAX_EDIT_FACES = MAX_RENDER_FACES = 8` (`EDIT_DETECT_FACES` 10). The iPhone rows can still flip either (RM §12).
- **The loop bound alone** changes nothing for N ≤ 6 (the cap 6 columns agree within run-to-run noise): the loop stops at `uCount`. Every row is higher than on 2026-10-12 (texture spread 6 8.09 → 8.8 ms, UBO 2.46 → 3.16 ms) on both builds, so that is the browser update or driver, not the cap.
- **PRC:** the cold compile + link is 332–400 ms on both builds and both carriers, over PRC's 300 ms on this desktop (190 / 215 ms on 2026-10-12, Chrome 154). It does not depend on the cap; the iPhone row decides (the fallback compiles in `build()`).
- **Software rasterizers:** on SwiftShader the UBO program is 2–3.5× slower than the texture, 3.2× even with no face listed. `src/engine/faceTableCarrier.ts` therefore builds the reshape pass with the texture when the WebGL renderer is a software rasterizer (SwiftShader, llvmpipe or softpipe, Microsoft Basic Render Driver) and with `FACE_TABLE_CARRIER` otherwise; `window.__meiyan.gl.FACE_TABLE_UBO` says which. Since the v0.5 review (C11) it reports the reshape pass the pipeline built (`ReshapePass.carrier` through `Pipeline.faceTableCarrier()`, set after the first frame that draws a face warp, since the pass is built on first use), not the selector's pick. `persons.spec.ts` checks `false` after 大眼, which catches a pick that stops reaching the pass only when the pass then builds `FACE_TABLE_CARRIER`, the UBO (`index.ts` not handing it to `createPipeline`, or `pipeline.ts` dropping `opts.faceTable`). A hop that stops passing a carrier at all (`createReshapePass(gl)`, or the pass ignoring `opts.carrier`) builds the pass's default, the texture: on SwiftShader that is the right answer, so the e2e passes, while every GPU would silently run the texture (12.5–14.9 ms at ten faces, over PR1's 8 ms). `carrierWiring.test.ts` (v0.5 review D5) runs the real engine → pipeline → pass chain on a recording fake context and catches both: a GPU renderer string compiles and draws `RESHAPE_FS` with `FACE_TABLE_CARRIER` (the UBO) and sets the flag `true`, SwiftShader's with the texture and `false`, and `createPipeline` builds exactly the carrier it is given. The e2e app flows therefore run the texture, and `reshape.spec.ts` pins both carriers against the CPU port, the one-face, view and 推臉筆 pins included.
- **PD1:** `detectImage` at `EDIT_DETECT_FACES` (10) on seven faces at 2048: 80.8 ms (GPU) and 81.5 ms (CPU), well within 400 ms; n10 finds the same seven as n8 (`small_faces.jpg`'s layout before 2026-10-19; the new one times alike, *Re-check on the new layout* below).
- **Slider commit:** 8 faces take 60 ms here, inside §6.1's 66 ms; the check is linear in the capped faces that changed, so on a phone slower than this desktop a 全部 commit at 8 faces is likely over (one person's change stays about 8 ms). Not yet timed on the phone.

#### 2026-10-18 desktop Chrome (GPU), rows R / RC / D at ten faces — ANGLE (Intel, Intel(R) UHD Graphics 770 (0x0000A780) Direct3D11 vs_5_0 ps_5_0, D3D11)

For §6.7 (the face cap 8 → 10). Same desktop and Chrome 155.0.8059.80 as the eight-face rows, `npm run dev` build of `/bench.html?fixtures=1`, `node scripts/bench-multiface.mjs R`, three runs (the bench prints the UTC date, 2026-10-17). Row R now has N = 9 and 10 spread, a row of ten at 1.2 FW and a 2 × 5 grid at 1.3 FW. Ten faces 1.2 FW apart do not fit the square frame at FW 0.1 (11.8 FW), so that row uses FW 0.081 (it spans 0.95 of the frame); every other clustered layout keeps FW 0.1. `ms` as before: the median batch per draw minus the N = 0 baseline. The range over the three runs:

| Layout | texture 1080 | texture 2048 | UBO 1080 | UBO 2048 |
|---|---|---|---|---|
| RC (cold compile + link + first draw, then warm) | 329–402 | 10–12 | 341–391 | 12–17 |
| spread 1 | 2.45–2.74 | 10.32–10.40 | 1.56–2.17 | 5.54–5.55 |
| spread 6 | 1.74–2.37 | 8.74–8.82 | 0.91–1.11 | 3.02–3.17 |
| spread 8 | 2.16–2.55 | 10.51–10.64 | 1.04–1.16 | 3.56–3.61 |
| spread 9 | 2.73–3.11 | 11.56–11.63 | 0.92–1.51 | 4.07–4.10 |
| spread 10 | 2.94–3.50 | 12.51–12.54 | 1.41–1.68 | 4.26–4.47 |
| row 6 @1.2FW | 1.91–2.29 | 8.93–9.05 | 0.99–1.23 | 3.28–3.32 |
| grid 2×3 @1.3FW | 2.14–2.45 | 9.27–9.35 | 0.92–1.27 | 3.32–3.42 |
| row 8 @1.2FW | 2.76–2.90 | 11.66–11.79 | 1.39–1.63 | 4.51–4.53 |
| grid 2×4 @1.3FW | 2.72–3.08 | 11.95–12.11 | 1.14–1.41 | 4.71–4.78 |
| row 10 @1.2FW (FW 0.081) | 3.22–3.63 | 13.33–13.48 | 1.28–1.81 | 4.85–4.93 |
| grid 2×5 @1.3FW | 3.32–3.83 | 14.60–14.86 | 1.82–2.14 | 5.81–6.01 |

Row D (the bench's `rowD`, the photo model, a scratch driver as on 2026-10-18 for eight faces), median of 5 warm calls in ms (first call); the fixtures are 2000 × 1500, so the "2048" decode is the photo itself:

| Fixture | Delegate | 2000 × 1500 n10 | 2000 × 1500 n12 | 1440 n10 | 1440 n12 | Faces at n12 |
|---|---|---|---|---|---|---|
| `small_faces.jpg` (7, layout before 2026-10-19) | GPU | 84.5 (221) | 78.9 (216) | 69.0 (208) | 78.3 (196) | 7 |
| `small_faces.jpg` (7, layout before 2026-10-19) | CPU | 82.7 (104) | 80.9 (89) | 74.8 (83) | 77.0 (84) | 7 |
| `ten_faces.jpg` | GPU | 101.4 (242) | 103.1 (244) | 115.2 (252) | 110.3 (248) | 10 |
| `ten_faces.jpg` | CPU | 109.9 (115) | 109.1 (116) | 104.5 (114) | 101.5 (111) | 10 |
| `eleven_faces.jpg` | GPU | 93.7 (226) | 102.7 (233) | 92.2 (233) | 103.5 (244) | 11 (10 at n10) |
| `eleven_faces.jpg` | CPU | 110.0 (120) | 116.2 (130) | 102.0 (116) | 110.5 (116) | 11 (10 at n10) |

The cost follows the faces found (MediaPipe runs the landmark model per detection), not `numFaces`: on `small_faces.jpg` n8, n10 and n12 agree within noise (n8: 81.1 GPU, 83.0 CPU at 2000 × 1500).

*Re-check on the new layout (2026-10-19).* `small_faces.jpg` was laid out anew (§8.3's fixture table): an independent synthetic layout of seven faces in the same 6–14 % range, three large ones along the top and four small ones below. The `small_faces.jpg` rows above, and the eight-face rows before them, are the earlier layout's; they were not re-run in headed Chrome 155. Both layouts through one other harness instead (headless Chromium 153 on this desktop's D3D11, the bench's `rowD` through the dev server, a fresh browser per run), median of 5 warm calls in ms. The new layout, three runs: GPU 2000 × 1500 n8 / n10 / n12 59.2–68.2 / 58.8–67.8 / 60.0–61.8, 1440 55.4–59.2 / 57.4–59.9 / 56.6–58.9; CPU 2000 × 1500 71.5–73.0 / 72.3–74.0 / 71.3–74.0, 1440 66.0–67.5 / 65.6–67.4 / 66.5–66.8; seven faces at every `numFaces`. The earlier layout in the same harness: GPU 60.7 / 62.0 / 61.3 and 61.6 / 61.2 / 62.0, CPU 71.5 / 71.5 / 71.3 and 65.5 / 65.5 / 65.2. The layout does not move the cost (seven faces found either way), so PD1's reading stands; this harness times below the headed Chrome 155 rows (headless Chrome 155 was too noisy to use: CPU 99–144 ms).

The UBO as the drivers lay it out (`reshape.spec.ts`, `window.reshapeUboLayout`: `UNIFORM_BLOCK_DATA_SIZE` of `FaceTab`, the array's `UNIFORM_ARRAY_STRIDE` and `UNIFORM_SIZE`): 15,360 B, stride 16, 960 entries, on SwiftShader (`MAX_UNIFORM_BLOCK_SIZE` 65,536) and on this desktop's D3D11 through headed Chrome 155 (`MAX_UNIFORM_BLOCK_SIZE` 65,536, `MAX_FRAGMENT_UNIFORM_VECTORS` 1024). There the pins of `runReshapePinMulti` match the CPU port within 0.0028 px on both carriers, the ten-face and tenth-face-only cases included.

The slider commit's fold check (`warpGuard`, Node, as on 2026-10-18; ten faces in two rows of five, two runs): 2 faces 15.5 ms, 3 faces 22.4–22.7 ms, 6 faces 44.7–45.4 ms, 8 faces 60.0–61.2 ms, 10 faces 75.0–77.6 ms. λ stays 1 for every face.

Readings and decisions:
- **PR1** at N = 10, 2048, with the UBO (the carrier GPUs run): 4.26–4.47 ms spread, 4.85–4.93 ms for the row and 5.81–6.01 ms for the 2 × 5 grid, within 8 ms. **Decision:** `MAX_EDIT_FACES = MAX_RENDER_FACES = 10` (the user's cap). The texture is 12.5–14.9 ms at ten faces; only software rasterizers run it (faceTableCarrier.ts).
- **The loop bound alone** changes nothing for N ≤ 8: the eight-face rows match the §6.6 build (UBO row 8 4.51–4.53 vs 4.42–4.53 ms, grid 2 × 4 4.71–4.78 vs 4.64–4.78 ms, one face 5.54–5.55 vs 5.54–5.58 ms).
- **PRC** is unchanged by the cap (329–402 ms cold, 332–400 ms on the §6.6 build): the iPhone row decides, as before.
- **PD1:** 79–81 ms on `small_faces.jpg` (its earlier layout; the new one times alike, *Re-check* above) at `EDIT_DETECT_FACES` (12), 101–116 ms with ten or eleven faces, within 400 ms on both delegates.
- **Slider commit:** a 全部 commit with every face's warp changed takes 75–78 ms at ten faces here, over §6.1's 66 ms (60 ms at eight); one person's change is still about 8 ms. Recorded, not changed here (§9): the phone row decides, and the fallbacks are a coarser fold grid for ≥ 9 changed faces or `MAX_EDIT_FACES = 8`. **Follow-up (2026-10-18, v0.5 review C9):** neither fallback ships. A coarser grid sees less of a narrow dip (§4.4), so it could show a fold the 65 grid catches, and the cap of ten is the user's. The map got cheaper instead, with the same doubles (§4.4: per-face step constants, the hypot gate). Bench row PC (§6.2) as shipped, median of 5, every face with its 瘦臉 limit (v0.5 review D6, D7; the figures first given here, a median of 7 without limits, agree with `all_ms_unlimited` within run-to-run noise), on the same desktop in Node, four runs, `all_ms` / `one_ms` / `all_ms_unlimited`: 6 faces 10.7–11.1 / 1.8–2.0 / 8.9–9.4 ms, 8 faces 14.6–14.8 / 1.8–2.0 / 12.0–12.1 ms, 10 faces 18.1–18.5 / 1.9 / 14.9–15.8 ms. With `5b857a9`'s map swapped into the same row (two runs): 47.8–48.5 / 8.0–8.2 / 45.7–46.5, 64.8–65.5 / 8.2–8.3 / 59.9–64.0 and 79.6–83.1 / 7.8–8.2 / 79.0–79.1 ms (10 faces OVER). In headless Chromium (`bench.spec.ts`, the dev server's `/bench.html`, two runs): 11.1–11.2, 14.1–14.2 and 17.4–17.6 ms `all_ms`, 1.8–1.9 ms `one_ms`, 9.1–9.3, 11.5 and 14.1 ms `all_ms_unlimited`; with `5b857a9`'s map 36.2–36.6, 48.2–49.0 and 58.7–59.6 / 5.9–6.2 / 34.5–34.6, 45.1–45.4 and 55.5–55.8 ms. The limits add about a fifth to the cheaper map (one hypot, a 4-tap lookup and the budget per mapped point) and a few percent to the old one. λ stays 1. PC1 passes here; the phone's PC row decides (§6.3).

### 6.5 Photo detection with BlazeFace full-range (2026-10-17)

**Why.** A user's photo of seven people (2016 × 1512) showed two faces. The `face_detector.tflite` inside `face_landmarker.task` is BlazeFace short-range: input 128 × 128, 896 anchors, byte-identical to `blaze_face_short_range.tflite`. `detectImage` shrinks the whole photo into it, so a face is found only from about 10–15 % of the photo's edge, and the user's faces were 6–19 % wide (about 9–24 px to the detector). Lower detection or presence thresholds and other decode sizes recovered at most 3 of 7. MediaPipe's full-range detector (`blaze_face_full_range.tflite`, input 192 × 192, 2304 anchors) in place of the short-range file finds 7 of 7 at every decode from 640 to 2048, on both delegates, with no false positive (desktop).

**Design.**
- **Asset:** `public/models/face_detector/full-range-float16-1/blaze_face_full_range.tflite`, 1,083,786 B, md5 `XeN2/MhVJzxccgdm02UjoA==`, Apache-2.0 (model card). `scripts/fetch-assets.mjs` fetches it from the versioned GCS path (`mediapipe-models/face_detector/blaze_face_full_range/float16/1/`) and checks the md5 before writing.
- **The photo model is assembled in the browser** (`src/engine/faceBundle.ts` `withFaceDetector`), not shipped as a second bundle: the camera bundle with its `face_detector.tflite` entry replaced, the other entries (`face_landmarks_detector.tflite`, `geometry_pipeline_metadata_landmarks.binarypb`) byte-identical. A `.task` is a zip of stored entries that MediaPipe reads in place, so the swap is one copy plus one CRC-32: 3,657,199 B in 3–4 ms on the desktop (4,612,636 B in about 6 ms until 2026-10-18, with `face_blendshapes.tflite`; see *Memory* below). The writer pads each entry so its data starts on a 4-byte boundary, as Google's packer does; rewriting the shipped bundle unchanged reproduces it byte for byte (unit test), and Python's `zipfile.testzip()` accepts the result. Download cost: +1.08 MB on the first launch, against +4.6 MB for a repacked `.task` built at prebuild (and precached or cached). Since 2026-10-18 the tracker assembles it right before each switch to it and keeps no reference (MediaPipe copies every buffer it is given, *Memory*); nothing builds it on a launch that never opens a photo.
- **Download and fallback** (since 2026-10-18): `loadPhotoDetector` (`assets.ts`) is the detector's own memoised download. The engine download starts it right after the model request, and its bytes join the model phase's progress bar (the first launch downloads 7.5–8.2 MB, 7.2–7.8 MiB in the unit the progress text shows: 「首次使用需下載約 7–8 MB」, RB row 14), but `loadEngineAssets` never waits for it: the camera does not use it, so a slow or stalled detector holds neither `done` nor the camera start (before, the engine waited up to `STALL_TIMEOUT_MS` for it on every first launch after the upgrade). A failure (missing, HTML fallback, truncated, stalled past `STALL_TIMEOUT_MS`, not a TFLite model) is logged and clears the memo, so it is fetched again: `services.ts` `ensurePhotoDetector` asks again whenever a photo switches the tracker to its photo model while the detector is missing (and when the editor opens a photo, which reads `Tracker.photoDetector`). Photos detect on the camera bundle meanwhile, and nothing else fails; a camera bundle that is not a stored zip leaves photos on it as well.
- **The editor's wait for the detector** (2026-10-18, round 2): a session about to detect (a new photo, a re-scan) first waits for the detector's *first* download of the session, and for at most `DETECTOR_WAIT_MS` (3 s, `services.ts` `photoDetectorPending`). The first download is the request the engine download starts: `prefetchAssets` joins it (`ensurePhotoDetector`) as it starts the engine download, so when that request fails before `done`, the one `done` starts is a retry (round 3; round 2 counted only the requests `services.ts` itself started, so after a fast failure, a connection reset or a 5xx, the first photo waited the whole 3 s on the retry `done` started, which on lie-fi hangs). The budget starts with the first wait and is shared: a photo opened later waits only for what is left of it, and once it is spent, or the first download has failed, nothing waits (a retry is never waited for). The stall timeout is no bound for a wait: it re-arms on every chunk, so a trickling 1.08 MB download (about 55 s at 20 KB/s) or a request that hangs (30 s) would hold every photo on 「正在分析臉部…」, as the first version of this wait did (it waited for any download in flight, retries included). Why 3 s: the download starts beside the model when the engine starts, well before a photo is picked, so a link that brings 1.08 MB within 3 s more (about 3 Mbit/s or better) still gets the first photo full-range; the first full-range photo already spends about 1.4–3 s in the GPU compile behind the same spinner (above), so the wait at most doubles that once; on a slower link the photo detects short-range at once and is completed later. An offline fetch fails at once, so offline nothing waits. A session drawn from the cache never waits, a short-range one included (round 3): its faces are there, and its completion (below) runs after it is bound, when the detector is in; round 2 held such a reopen on 「正在分析臉部…」 for the rest of the 3 s on the very link that had caused the mark, and then drew the cache anyway.
- **A short-range answer is completed later** (2026-10-18, rounds 2–4): an answer from the camera bundle because the full-range detector was not there (offline, a failed or slow download) records it in the cache, `DetectionCache.photoDetector: 'short-range'` (`StillSession.detector` → `firstAnswer`), and on its up-frame's scan record (`FaceScanRecord.detector: 'short-range'`, round 4; only on a marked cache, and a marked cache whose records carry no flag reads with every record flagged). A full-range answer for an up-frame replaces that record, flag and all (moved last, as the newest answer), and the mark stands for the flagged records: it lifts only when none is left, or when the answer found faces (a cache with faces is never scanned again), and the flags go with it. A full-range "nobody" beside a short-range record keeps it, because that up-frame is still owed its full-range look. (Round 2 cleared the mark on any full-range answer: a sideways photo's upright short-range "nobody", or its turned one, then stood for good.)
  - *Drawn at once.* A marked cache is used like any cache (`sessionPlan`), faceless or not. It is a definite answer whatever the tracker's health, so a faceless one reopened while the tracker is lost or failed gates no 膚質 tool (祛痘 included), and its session waits for no download.
  - *When.* The completion runs once per open, after the cached session is bound, as soon as the full-range detector is in and the tracker takes it (`completionDue`; `Tracker.photoDetector`). The editor asks for the detector while it holds a marked cache (`ensurePhotoDetector`, which joins a download in flight or retries a failed one, and again on the window's `online` event and on a return to the app, `visibilitychange`: a captive portal signed in elsewhere fires no `online`), and it hears the detector land through any request, not only its own: `services.ts` sets `svc.photoDetector` when a download brings the bytes, whoever started it (the engine download, a photo's tracker switch through `fullRangeDetector`, or the editor; round 4: the editor heard only its own asks, so after a 5xx or a stalled request the bytes a scan's retry brought completed nothing in that open). So it runs at once on a reopen, or when the detector lands while the photo is open, including a photo detected short-range a moment ago. It waits while something holds it (`completionHeld`): no bound session with a definite answer, a tracker that is not `ok` (a probe could not answer and would spend the open's one try), a face scan pending, or 裁切, a stroke, a slider drag, an export (a tiled one, or a working-size 儲存 in 準備中) or a lost display, which its synchronous detection would freeze. (Round 4: a working-size 儲存 held nothing, so a detector landing during 準備中 ran the detection there, delaying the file past the share window, and the new persons' rebase made the file look edited: dropped.) The hold is checked again as the detection is about to start, after its paint: a 儲存 tapped in that paint hands the open's try back, and the completion runs once the export is done. A face scan of a new up-frame waits for a due completion, and while it runs: the completion asks upright first, which may find the faces (no scan then). The scan is checked again once the completion has run, whatever it found (round 5: a completion whose detection threw or answered short-range changed nothing else, so nothing checked the scan again, and a photo turned upright in 裁切 while the detector landed kept its face tools gated, 「未偵測到臉部」, until it was turned again or reopened). It runs behind 「正在重新偵測臉部…」 on a scrim, the cached faces still in view.
  - *Where and what.* One full-range detection (`completionOf`): for a cache with faces, in its last face scan's up-frame, where they were found; for a faceless one, where a short-range record is owed: upright when that one is (or no record says), else the last one owed. `completeAnswer` merges a definite full-range answer, and only adds. A cache with faces keeps every face (id, box, landmarks), every person (id, links, params), the obstacles that are not a face now, the primary and its scan records (`cache.ts` `withMoreFaces`). A found face that is a cached one, on a cached face's head (`sameHead`, as for the camera seed's union below: their landmarks nearly coincide), is skipped, so a face full-range misses stays too, and a head full-range boxes apart from the short-range box is not added twice. Every cached obstacle stays, unless a new face is it, boxed as it (IoU > 0.6: an obstacle keeps no landmarks; round 4: round 3 dropped one on a face's head by the ellipse test, so a tiny face beside a cached face's jaw stopped bounding its 瘦臉, and a completion that added nobody changed the render); the detection's obstacles join, except one on a face's head. The others take the free ids f0…f9, largest first, up to `MAX_EDIT_FACES`, and the rest become obstacles; one that pairs with a body-only person links to it (A15's rule). So a completion that adds nobody can still bring an obstacle, and change the render: a face short-range missed that is below `MIN_FACE_FRAC`, or past the cap (an eleventh beside ten cached ones), bounds the cap of each face it is nearer to than any other (§4.1). The edit gains the new persons from the template (`assignPersons`, at 原圖): nothing is renamed, and no selection, spot owner or 長腿 anchor moves. A faceless cache takes the answer as a 基本模式 cache does (A15, `firstAnswer`: `p0`'s look goes to the primary), and the answer replaces the record of the up-frame it ran in. Another up-frame's short-range "nobody" stays owed: the scan asks it again, full-range (`needsFaceScan` with full-range in), when the photo is shown in it, in the same open or a later one, and says nothing when it finds nobody again (`rescanOf`: that "nobody" said 「未偵測到臉部」 when it was fresh). An up-frame a full-range scan answered keeps its record and is not scanned again. (Round 3 replaced every scan record with the upright one: a turned up-frame the scan had answered full-range, the detector landing as the photo was turned, was scanned once more, and a sideways "nobody" reopened with the detector in showed 「未偵測到臉部」 again.) A sideways photo's faces are therefore found where full-range would have found them on its first open.
  - The new persons, the group-photo notices and the thumbnail follow as for an A15 merge, without the 「未偵測到臉部」 toast. A completion into a cache with faces that adds nobody but an obstacle owes the thumbnail too, and says what the cache says now and did not before (an eleventh face: 「偵測到超過 10 張臉」), never the first group photo's hint (`editorModel.ts` `completionShows`; round 5: round 4 owed the thumbnail and showed the notices only when a face was added, so the stored thumbnail kept the render from before the new obstacle bounded a cap, and the over-cap notice never showed). The cache is written without the mark (`touch: false`); the session is rebuilt from it only when faces were added (the frame reads the obstacles and the persons from the cache). The detection runs without a session (`still.ts` `detectStill`): nothing is drawn, the debug state keeps describing the photo on screen, and the bound session keeps its 美體 and 推臉筆 field textures. (Round 4: the detection ran in a probe session whose dispose released the engine's field textures while the bound session drew with them, and every completion rebuilt the session to restore what the probe overwrote, so both fields were uploaded twice more, the pre-encode was redone and a held 按住對比 snapped back.) An answer that is not definite, or not full-range, keeps the cache and its mark for a later open. 0.4's caches carry no mark and stay as they are.
- **Offline:** the detector is a `/models/` path, so the service worker's CacheFirst route keeps it once it has downloaded (an uncontrolled page stashes it in `ENGINE_CACHE`), and `pruneStale` keeps the current path; it is not precached. So photo detection is full-range offline only after the detector's own first download, which the engine's `done` does not wait for: the camera and the editor work offline after the first engine download, but until the detector is in (for example a 0.4 user whose 0.5 worker installed while online and who first opens 0.5 offline) photos detect short-range, a group photo's small faces missing (on `small_faces.jpg` short-range finds 3 of 7, the large ones), and each such photo gains them in the first open the detector is in, also when it lands while the photo is open.
- **Tracker (`tracker.ts`):** still one FaceLandmarker. IMAGE mode runs the photo bundle, VIDEO the camera bundle. The tracker reads the detector through `TrackerOptions.fullRangeDetector` at each switch to a photo (so one that arrives late is used from the next photo on) and reports what a photo runs as `Tracker.photoDetector` (`'full-range'`, or `'short-range'` while there is none or its bundle could not be assembled). The model travels in the mode switch's own `setOptions` (`baseOptions.modelAssetBuffer`, `runningMode`, `numFaces`; no `delegate`, which is sticky), only when it changes, so a switch costs no extra rebuild; with a `Uint8Array` the call stays synchronous. Every instance, the first and each replacement after a lost context or failures, is built on the camera model, and the tracker records which bundle its graph holds (camera or photo), so the next photo switches it. A photo can also ask for the camera bundle in IMAGE mode (`detector: 'camera'`): the short-range retry below. `services.ts` passes the camera bundle and the detector getter to every tracker build; the bench's row D times the photo model (its `detector` column), so PD1 measures what photos run, and its trackers get the same inputs as the app's.

**Measurements**, desktop only: Windows 11, Intel UHD 770 (ANGLE D3D11), headless Chromium, the app's own tracker through the dev server, the fake camera playing `face.y4m` (one face), the user's photo read from a scratch folder (never committed) and `small_faces.jpg`; a fresh browser per column (cold GPU program cache). Times in ms.

| | GPU before | GPU after | CPU before | CPU after |
|---|---|---|---|---|
| Faces on the user's photo (MediaPipe's raw result) | 2 | 7 | 1 | 8: a duplicate of one face at IoU 0.97, which `prepareFaces` removes |
| Faces on `small_faces.jpg` (new layout, 2026-10-19: re-run; the layout before found 4 / 7 / 2 / 7) | 3 | 7 | 3 | 7 |
| First photo detection, after the camera ran | 178 | 1383 (once per browser session) | 65 | 143 |
| Next photo after the camera again (first call) | 168 | 238 | 64 | 135 |
| Steady photo detection (median of 5; user's photo / fixture, the fixture's layout before 2026-10-19) | 45 / 47 | 93 / 76 | 39 / 32 | 104 / 84 |
| Camera, one face, `numFaces` 3, p50 | 17.1 | 16.9 | 16.1 | 15.8 |
| Camera, one face, `numFaces` 1, p50 | 13.8 | 13.6 | 15.9 | 14.1 |
| PL2 Δp50 (limit 5) | 3.3 | 3.3 | 0.2 | 1.7 |
| Camera after a photo: first frame / p50 | 140 / 16.9 | 137 / 16.1 | 39 / 15.9 | 39 / 15.7 |

The fixture's steady detection on its new layout (2026-10-19; headless Chromium 153, the same desktop and tracker; three runs of the new layout, two of the earlier): short-range 34.3–35.3 ms GPU and 37.4–38.2 ms CPU, full-range 61.2–68.6 and 72.5–73.3 ms; the earlier layout there 42.2–42.7 and 30.0–30.3 ms short-range, 68.0–68.5 and 73.4–74.1 ms full-range. Short-range follows the faces it finds (3 on both delegates now, 4 and 2 before); full-range, seven faces either way, does not move. The camera graph is the same in both columns (VIDEO never carries the photo model), so its frame time and PL2 do not change; the CPU PL2 spread is run-to-run noise. Wasm heap with the swap (the 2026-10-17 investigation, same desktop): GPU 45.3 → 54.3 MB, CPU 54.3 → 65.2 MB, flat over five switch cycles; the JS heap holds the 4.6 MB photo bundle beside the 3.76 MB model. (These are 0.5.0's numbers: since 2026-10-18 both bundles leave out the blendshape model, which brings the heap back to 45.3 and 54.3 MB, and the app keeps no photo bundle; *Memory* below.)

**The one-time GPU hitch and the creation order.** Raw MediaPipe on the same desktop and photo, a fresh browser per row:

| Instance built on | Camera first | Photo first |
|---|---|---|
| Shipped model, no photo model (before) | camera start 1.69 s; first photo 0.17 s | first `setOptions` 1.66 s + photo 0.17 s = 1.84 s |
| Camera model (chosen) | camera start 1.69 s; first photo 1.38 s | 1.66 s + 1.38 s = 3.04 s |
| Photo model | first `setOptions` 2.75 s + first frame 0.22 s = 2.97 s; first photo 0.23 s | 2.73 s + 0.25 s = 2.99 s |
| Photo model, plus a warm-up inference on a blank 256² image | 2.73 s + 0.16 s, first frame 0.21 s; first photo 0.24 s | (as above) |

The full-range graph compiles its GPU programs once per browser session, about 1.2 s here, wherever its first inference happens; a replacement instance built after `close()` paid 0.24 s for its first photo. Building on the photo model, with or without a warm-up, only moves that cost to the camera start (+1.28 s) to save it on the first photo, and a photo-first session pays the same either way. The camera start matters more, so instances are built on the camera model and the hitch stays on the first photo of a session, inside the editor's loading. The CPU delegate has no such hitch. The iPhone (Metal) compile cost is not measured yet. Since 2026-10-18 the bench's row D measures it the app's way: its `app GPU 2048 first photo` row builds a tracker as `services.ts` does (the camera bundle, the detector getter) and times its first `detectImage` (`first_ms`, valid with `cold true`: tap D first after opening `/bench.html`), against PD3 (§6.3). Row D's other rows build an instance on the photo bundle in IMAGE mode, whose compile lands in the creation, so their `first_ms` (about 160–250 ms here) never saw the hitch and is not this measurement. Desktop D3D11, three fresh headless browsers, `group_faces.png` (1800 × 1200), 2026-10-18: `app GPU 2048 first photo` `tracker_ms` 106–114, `first_ms` 2,969–2,981 (photo-first: MediaPipe's first GPU inference plus the full-range compile), `next_ms` 41.5–42, `retry_ms` 155–159, `back_ms` 184–186; `app CPU` `first_ms` 97–100, `next_ms` 41–43, `retry_ms` 52–61; the same run's `GPU 2048 n12` `first_ms` 162–166.

**Mitigations considered (2026-10-18).** The hitch is a synchronous main-thread block (MediaPipe compiles and runs the graph on the page's thread). The editor's spinner paints first and turns on the compositor, so the screen shows loading, not a freeze, but taps wait. None of the options removes the block without a cost, so none ships:
- *A warm-up* (a blank 256² `detectImage` on the photo bundle: the first photo then takes 0.24 s, table above) only moves the block to wherever it runs: after Review's first paint (Review is interactive: 編輯, 儲存 and 重拍 would wait 1.2 s there instead of behind the editor's spinner), on Home at idle (the same), or at the camera start (+1.28 s before the first frame). A photo-first session pays it in full either way.
- *The camera bundle for a hand-over whose live tracks held ≤ 1 face* skips the compile for the core 拍照 → 編輯 flow (about 0.18 s instead of 1.38 s after the camera), but gives those shots 0.4's short-range recall: a group shot in which the camera tracked one face would lose the small faces full-range finds, and the same photo imported later would show more persons. It is PD3's fallback, for the user to decide with the iPhone number.
- *Building on the photo bundle* moves it to the camera start (table above).
The cost stays where it is, inside the editor's 「正在分析臉部…」, once per browser session on the GPU delegate, and PD3 (§6.3) holds it to ≤ 3 s on the slowest iPhone.

**The short-range retry (2026-10-18).** BlazeFace full-range is built for faces at a distance: it misses a face that fills the frame or is cut off by the frame's edge, which short-range (the camera's detector, and 0.4's photo detector) finds. A close-up portrait, a selfie the camera was beautifying live, or a forehead cut at the brows then opened with no face in 0.5.0, every face tool off. Desktop, one instance driven as `tracker.ts` drives it (the camera bundle in VIDEO, then IMAGE at `numFaces` 12), `sample_face.png` composed at 2048 on grey (`f` = the face's height over the photo's):

| Photo | Full-range: D3D11 / SwiftShader / CPU | Short-range: D3D11 / SwiftShader / CPU |
|---|---|---|
| 3:4 close-up, `f` 1.05 and 1.1 | 0 / 0 / 0 | 1 / 1 / 1 |
| 9:16 close-up, `f` 1.0 | 0 / 0 / 0 | 1 / 1 / 1 |
| 3:4, `f` 0.55, the face's top 35 % above the frame | 0 / 0 / 0 | 1 / 1 / 1 |
| 4:3, `f` 0.3, 35 % of the face past the left edge | 0 / 0 / 0 | 1 / 1 / 1 |
| 4:3, two faces at `f` 0.3, the right one 35 % past the edge | 1 / 1 / 1 | 2 / 2 / 2 |
| 4:3, two whole faces at `f` 0.4 and 0.38 | 2 / 2 / 2 | 2 / 2 / 2 |
| The 3:4 close-up turned 90° | 0 / 0 / 0 | 0 / 0 / 0 |
| `sample_face.png` itself | 1 / 1 / 1 | 1 / 1 / 1 |
| `small_faces.jpg` (seven faces; the layout of 2026-10-19, the one before 4 / 4 / 2 short-range) | 7 / 7 / 7 | 3 / 3 / 3 |

So a face answer whose full-range detection has no usable face (none `prepareFaces` keeps) asks once more with `detector: 'camera'` and takes that answer when it has a face; otherwise the first answer stands, a definite no-face with its obstacles (`app/still.ts` `detectFaces`; a camera shot whose seed lies in no full-range face asks too, *The camera seed's face* below). The tracker skips nothing itself: the retry is the caller's, and only while `photoDetector` is `'full-range'` (a short-range photo would repeat the same detection). `__meiyan.detectCalls` still counts answers, `detectRetries` the retries. The sideways scan (§3.6) goes through the same function with `upTracker`'s U image (which forwards the choice), so the turned close-up of the table is found by the scan of its upright frame. Cost, paid only by a photo without a usable full-range face, faceless photos included: one graph rebuild and one inference, after the full-range one (warm program cache, 2048): `setOptions` 12.8 ms + 121 ms on D3D11 GPU, 8.8 + 24.7 ms on CPU, 10.3 + 859 ms on SwiftShader. The graph is then on the camera bundle, so the camera's next frame needs a mode change only, as after a 0.4 photo.

**No union of the two detectors.** Merging a short-range pass into every answer (through `prepareFaces`' IoU dedupe) would also find the cut-off second face of the table's two-face row, which 0.4 found and 0.5 misses. But it costs every photo that second rebuild and inference (+134 ms on D3D11 GPU, +33 ms on CPU, more on a phone), most of them single-face selfies where it finds nothing new, and nothing in the full-range answer tells such a photo apart from a selfie (its one face is large either way). Not done for imports: in a close-up of two, a face cut off by the edge stays unselectable, like any face the detector misses; to be revisited if users meet it.

**The camera seed's face (2026-10-18, round 2).** A camera hand-over does carry that sign: the seed of the face the camera was beautifying (`EditorSource.faceSeed`, which `createStillSession` gets with the photo's first answer). When the full-range answer has faces but none whose box padded by `SEED_BOX_PAD` holds the seed (`seedPrimary`, the rule `firstAnswer` selects by), full-range has missed the camera's face, so the short-range detector is asked once as well and the faces of its answer that hold the seed are added: each takes the place of every full-range face on its head, and the union goes through `prepareFaces`, numbered afresh, this being the first answer (`faces.ts` `prepareWith`). One head is one face across the two detectors when their landmarks nearly coincide (`sameHead`, round 5). Measured over the larger face's eye span (the 3D distance of the outer eye corners 33 and 263, z as MediaPipe scales it), ten landmarks both meshes of one head agree on (the eye corners 33, 133, 362 and 263, the nose 1 and 4, the nostrils 98 and 327, the mouth corners 61 and 291) lie under 0.18 apart on average, the nose tips under 0.3 and the eye spans within 1.5 of each other; or, boxed as one face (IoU > 0.6, which `prepareFaces` merges within one answer), the ten under 0.3 apart. A face without landmarks, an obstacle (its box and ring), is one head with a face or another obstacle only at IoU > 0.6. `prepareWith` also lets a full-range face boxed as a duplicate of a held one (IoU > 0.6) give way though its landmarks are elsewhere: `prepareFaces` would keep one of the two whatever, and the seed's is the one kept. A completion (`withMoreFaces`) keeps both as faces. *Why landmarks (round 5).* Rounds 3 and 4 took a point of the ring for the nose: the smaller face's ring-bounds centre inside the larger one's box ellipse (round 3) or ring (round 4), and each centre inside the other's for faces within 0.7 of one size. The nose is not there: on the measured faces it lies 0.19 of the ring's width from that centre (up to 0.72), on a 3/4 view 0.3–0.5. So a neighbour of one size behind a cheek with its nose, an eye and its mouth showing merged (G1), as did neighbours turned 30–45° behind a temple or cheek, and a child's face in front of a parent's cheek, taken to be behind it for being smaller (G2); each was lost from the union as a face and as an obstacle, and the completion never added it. *Measured (2026-10-18).* The repo's tracker in IMAGE mode with both bundles, GPU (ANGLE D3D11) and CPU, 2,720 scenes per delegate composed from the repo's own photos only (`tests/fixtures`, LICENSES/NOTICE.txt): `sample_face.png`, the group fixtures, `group_people.jpg`'s yoga face (from `fullbody_yoga.jpg`, a blurry 50 px near-profile) and `fullbody.jpg`'s masked man. Close-ups, every frame cut, two faces with one cut, neighbours, overlaps with 0–80 % of the face behind hidden at 0.6–1.25× its size, a smaller face in front, finer grids of a child in front of a parent's nose and of faces of about one size overlapping by 35–45 %, and the group fixtures at 2048 and 1440. One head's two meshes put the ten marks 0.10 eye spans apart at p99 (0.21 at most), their eye spans within 1.27 and their boxes at IoU 0.63 or more when no other face covers it; 0.19 at p99 (0.35 at most) when one does. Different heads that do not overlap lie 1.44 eye spans apart or more. Where faces overlap, no nose distance tells them apart: a child's face in front of a parent's nose puts the noses 0.015–0.12 eye spans apart (the eye spans 1.56–2.6 apart), a face of one size behind another is meshed with its nose 0.18 eye spans from that face's (0.12 where the two are boxed as one), and one head 30–50 % hidden is meshed up to 0.27 apart by the two detectors. Of 1,580 overlapping different-head pairs the rule merges 14, every one boxed as one face (IoU 0.61–0.73, which `prepareFaces` merges within one answer anyway): faces of one size 43–73 % hidden behind each other, their marks 0.17–0.30 apart, 11 of them on the finer grid; round 4's ring centres merged 750. Of 4,968 same-head pairs it keeps 21 apart: 16 in scenes with the masked man or the near-profile, five of a child in front of the sample's face. The nose test costs no measured pair (the same-head noses it sees lie 0.24 eye spans apart at most) and keeps apart two 3/4 views turned towards each other, whose other marks can lie closer than one head's. Round 3's premise, one head boxed so far apart by the two detectors that their IoU stays under 0.6 (a cut-off face meshed small to one side), never showed: one head's boxes are at IoU 0.63 or more with no face over it, and a mesh 0.4× a face's size inside its oval is a smaller person. Not measured: real 3/4 views (the sample is turned about 19°, and full-range found the near-profile alone in 3 of 96 scenes), so the tests turn the sample's 3D mesh 30–45°. No rule can be right for a mesh that straddles two faces (452 of 11,841, 324 of them short-range, all but one in overlaps) or for two heads whose landmarks coincide because the one behind is hidden, its nose or both eyes covered. No repo photo put two heads boxed apart closer than 0.239 with the nose and size tests passing, so the tests' closest pair of different heads (0.197) is constructed from the sample's mesh. On the sample's mesh at its real aspect, turned 0–45°, a different head 0.4–1.25× a face's size never merges while the one behind shows its nose and an eye; one cheek to cheek stays two. The seed then selects the added face. No face of the short-range answer holds it: the full-range answer stands (and the seed routes as an import's, C6). So it does when this retry throws (the camera bundle's rebuild in IMAGE mode failing): it is an extra pass over an answer that has faces, which stays a definite one (round 2 lost it, the photo opening unsure, with no faces until a re-detect). The zero-face retry is unchanged, and no seed (an import, 全部套用, a later answer) or a short-range photo asks nothing more. Only camera shots whose selected face full-range missed pay the second rebuild and inference. Composed through the camera (`detector.spec.ts`, D2): two of `sample_face.png`'s faces in the 3:4 window, A whole and B, 200 px wide, with the top 35 % of its face above the frame. In the shot full-range finds A only and short-range both, on SwiftShader and on CPU; B 160 px wide with 30 % off behaves the same, while with 30 % off at 200 px full-range still finds B, with 40 % off short-range misses it too, and a face 35–55 % past a side edge of this shot full-range still finds.

**Memory (2026-10-18).** Both bundles leave out `face_blendshapes.tflite` (955,312 B): the camera bundle (`withoutBlendshapes`, 2,803,159 B) and the photo bundle (3,657,199 B). The tracker never turns `outputFaceBlendshapes` on, FaceLandmarker loads the blendshape model only when its bundle has one (it also stops logging "Sets FaceBlendshapesGraph acceleration to xnnpack by default"), and the landmarks are bit-identical without it: max |Δ| 0 over 6,214 points of five camera frames, `small_faces.jpg` and `sample_face.png`, in VIDEO and IMAGE, on D3D11, SwiftShader and CPU (`small_faces.jpg`'s new layout of 2026-10-19 checked again in IMAGE on all three: seven faces, 3,346 points, max |Δ| 0). Every graph rebuild copies the whole bundle into the wasm heap, so the entry cost one growth step of its high-water mark. The wasm heap (`HEAPU8.byteLength`; a fresh page per row, one instance, ten camera frames, then three cycles of a photo (`small_faces.jpg`, in its layout before 2026-10-19, and `sample_face.png`) and ten camera frames; flat over the cycles; the camera finds its face in every frame of every row):

| | GPU (D3D11): camera / after a photo | CPU: camera / after a photo |
|---|---|---|
| 0.4.0 (the shipped bundle for both) | 31.4 / 45.3 MB | 37.7 / 54.3 MB |
| 0.5.0 (shipped camera bundle; photo bundle with the blendshape model) | 31.4 / 54.3 MB | 37.7 / 65.2 MB |
| The photo bundle without it, the camera's as shipped | 31.4 / 45.3 MB | 37.7 / 54.3 MB |
| Both without it (ships) | 26.1 / 45.3 MB | 31.4 / 54.3 MB |

A session with the camera alone peaks 5.3 MB (GPU) and 6.3 MB (CPU) lower than 0.4.0 and 0.5.0; with photos, at 0.4.0's peak again, 9.0 and 10.9 MB below 0.5.0's. The JS heap: tasks-vision 0.10.35 copies every model buffer it is given (`setOptions` → a `Uint8Array` of its own in the task's options, which every rebuild serializes into the wasm heap), so the app's references come on top of MediaPipe's copy of the current model. 0.5.0 held the shipped model (3.76 MB) and the photo bundle (4.61 MB, assembled on every launch, camera-only ones included) beside it: 12.1–13.0 MB. Now the camera bundle (2.80 MB) and the detector (1.08 MB) beside MediaPipe's copy (2.80 MB in VIDEO, 3.66 MB in IMAGE): 6.7–7.5 MB by buffer accounting (not a heap snapshot), against 0.4.0's 7.5 MB; the photo bundle is built for a switch and dropped. PM1 (the kill test on an SE-class phone, with camera ↔ editor switches) is still to be run on the device.

**Masked face (美體 fixture).** In `fullbody.jpg` the man wears a black face mask. The full-range detector finds that face on desktop Chromium's CPU delegate and misses it on the GPU delegate (D3D11 and SwiftShader); it is a real face. `body.spec.ts` now checks the rule rather than the detector's recall on it: without a face, 小頭 stays off with the face reason; with one, it is available. The 美體 spec passes on the e2e GPU path, and its full-body test also passes in a build whose default delegate is CPU (one face found; 細腰, 長腿 with the head still, 腰臀比, 增高 and the reopen unchanged). The three tests that kill the face tracker's WebGL context fail on CPU with and without this change: they need the GPU delegate.

**Not changed by this section.** The camera's model and costs; `MAX_EDIT_FACES` (6 here: a photo with seven faces kept the largest six and showed 「偵測到超過 6 張臉」, until §6.6 raised it to 8 and §6.7 to 10); saved 最近編輯 entries, which keep their stored detection and are not detected again (0.4's included), except one whose answer 0.5 took short-range while the detector was missing, which the first open with the detector in completes (*A short-range answer is completed later*, above).

**Risk.** A detector swapped inside the bundle, and bundles without the blendshape model, are not combinations Google ships. They are pinned (tasks-vision 0.10.35, both float16/1 files), covered by the photo and camera e2e on both delegates (`detector.spec.ts`, `persons.spec.ts`, `camera.spec.ts`), and fall back to the shipped model when the swap fails.

### 6.6 Eight selectable faces (2026-10-18)

(Superseded the same day by §6.7: the cap is 10. This section records the step from 6 to 8.)

**Why.** With §6.5 the user's photo of seven people returns all seven faces, but the editor kept the six largest (`MAX_EDIT_FACES = 6`): the seventh became an obstacle with no face effects, and 「偵測到超過 6 張臉」 showed. A group of seven or eight is now selectable whole: the strip shows 全部 plus every person.

**What changed.**
- `limits.ts`: `MAX_EDIT_FACES` 6 → 8, `MAX_RENDER_FACES` 6 → 8, so `EDIT_DETECT_FACES` = 10 (two spare, A1). `FACE_TABLE_CARRIER` 'texture' → 'ubo', and `faceTableCarrier.ts` gives a software rasterizer the texture (§6.4, 2026-10-18).
- Face ids are f0…f7: `cache.ts` `FACE_ID` / `PERSON_ID` and `state.ts` `PERSON_ID` are built from `MAX_RENDER_FACES`. The ids stay one digit, so `MAX_RENDER_FACES` ≤ 10 (pinned in `limits.test.ts`). `normalizeDetect` keeps up to 8 stored faces.
- Shaders. `RESHAPE_FS`: the loop bound 8, the UBO block 8 × 96 vec4 = 12,288 B (within the guaranteed 16 KB; a 128-texel row would still fit: 8 × 128 × 16 B = 16 KB exactly), the texture 96 × 8, and `uDetail` 8 bits (`allDetail` sets `(1 << 8) − 1`). Tone: `MAX_FOLDS` 16 (`uFold`), `MAX_MOUTHS` 8 (`uMouth[64]`, `uMouthW[8]`), at most about 80 uniform vectors in `RETOUCH_FS`, against WebGL2's minimum of 224. The CPU ports read the same constants. The hash pins change (`RESHAPE_FS` `b1f84417`, the tone shaders `821c420d`); only these sizes and the loop bound differ in the text.
- Memory: up to 8 protect layers of 128² (0.26 MB), the procedural makeup VBO 8 × 768 × 44 B = 270 KB, at most 1.9 MB of new GPU memory at 2048² (§4.8), and about 310 KB per cache entry at the caps (§5.5).
- Strip: 全部 plus 8 is 9 chips, 428 pt plus padding. From seven faces the row scrolls, with the fade at the right edge, and the selected chip is scrolled into view (§2.1).
- Bench: row R adds N = 7 and 8, an 8-face row and a 2 × 4 grid; row D adds n10; the step-5 rows (face-detail spec §6.2) add N = 8.

**Not changed.** Photos with up to six faces: the shaders differ only in the loop bound and the array sizes, and the output is the same. The v0.3 parity goldens, the one-face GPU pins and the bit-exact one-face CPU test pass, on both carriers. Also unchanged: the camera (`MAX_LIVE_FACES` 3), `MAX_OBSTACLES` 8, and saved 最近編輯 entries (a seven-person photo saved with six faces keeps its stored detection, §6.5).

**An earlier 0.4 build** reading an entry with seven or eight faces validates it against f0…f5 and six faces: it drops f6 and f7 with their persons and shows the cache-dropped toast. No migration is needed. (The version stayed 0.4.0 at this step; the larger cap ships in 0.5.0, RM §14.)

**Tests whose assertions change on purpose:** `limits.test.ts` (8, 10, 8, 'ubo', the id bound), `tracker.test.ts` (the clamp at 10), `editorModel.test.ts` (「偵測到超過 8 張臉，只會美化最大的 8 張」), `reshapeCpu.test.ts` (the hash, the obstacle case with nine faces, bit 7 of the detail mask), `toneCpu.test.ts` (the hash; eight mouths and sixteen fold chords reach the CPU port), `cache.test.ts`, `faces.test.ts` and `state.test.ts` (f0…f7), `faceDetailBench.test.ts` (N = 8), `persons.spec.ts` on `small_faces.jpg` (all seven persons, 全部 + 7, each chip selects its person, no over-cap toast, 大眼 on the smallest face changes only its region, the texture carrier on SwiftShader) and `reshape.spec.ts` (an eight-face case on both carriers; the one-face pins on both carriers). New: `faceTableCarrier.test.ts`.

### 6.7 Ten selectable faces (2026-10-18)

**Why.** The user set the editor's person cap to ten (「人數上限改到10人以下」: at most ten). A group photo of up to ten people is selectable whole: the strip shows 全部 plus every person. Faces over the cap are dropped as before (§7): of the at most `EDIT_DETECT_FACES` (12) faces detected, the largest ten are kept, the rest are obstacles, and 「偵測到超過 10 張臉，只會美化最大的 10 張」 shows (the copy is built from `MAX_EDIT_FACES`); a face beyond the twelve detected is not detected at all, so it is neither kept nor an obstacle. The camera keeps `MAX_LIVE_FACES = 3`, and 美體 keeps `MAX_EDIT_BODIES = 4`.

**What changed.**
- `limits.ts`: `MAX_EDIT_FACES` 8 → 10, `MAX_RENDER_FACES` 8 → 10, so `EDIT_DETECT_FACES` = 12: two spare, so `dropped.overCap` stays real and a duplicate the CPU graph returns (§6.5) still leaves room for a face over the cap. `MAX_OBSTACLES` 8 → `EDIT_DETECT_FACES` (12): with 12 requested, a photo that kept one to three faces could drop up to 11 tiny faces, and a bound of 8 cut some of them from the obstacles (A1 says every dropped face is one). An older build reads such a cache's first 8 obstacles, without a toast. `limits.test.ts` pins `MAX_OBSTACLES ≥ EDIT_DETECT_FACES − 1`.
- Face ids are f0…f9 (`cache.ts` `FACE_ID` / `PERSON_ID`, `state.ts` `PERSON_ID`, built from `MAX_RENDER_FACES`; the history normalizers go through them). Ten is the most one-digit ids allow (`limits.test.ts` pins `MAX_RENDER_FACES ≤ 10`); `f10` is no id.
- Shaders. `RESHAPE_FS`: the loop bound 10, the UBO block 10 × 96 vec4 = 15,360 B (std140: a vec4 array's stride is 16 B; the size the drivers report, §6.4), the texture 96 × 10, and `uDetail` 10 bits (`allDetail` sets `0x3ff`). At ten faces the guaranteed 16,384 B holds a row of at most 102 texels: a wider row (RM §4.3) would need the texture carrier or a `MAX_UNIFORM_BLOCK_SIZE` check. Tone: `MAX_FOLDS` 20 (`uFold[20]`), `MAX_MOUTHS` 10 (`uMouth[80]`, `uMouthW[10]`), at most 95 uniform vectors in `RETOUCH_FS` (counting every array element as a whole vector) against WebGL2's minimum of 224. The CPU ports read the same constants. The hash pins change (`RESHAPE_FS` `bd89e096`, the tone shaders `085ca0a9`); with the 8-face sizes put back into the new text, both hash to the §6.6 pins (`b1f84417`, `821c420d`), so only the sizes and the loop bounds differ.
- Memory: up to 10 protect layers of 128² (0.33 MB), the procedural makeup VBO 10 × 768 × 44 B = 338 KB, at most 1.92 MB of new GPU memory at 2048² (§4.8), about 320 KB per cache entry at the caps (§5.5), and 0.7 MB of chip thumbnails.
- Strip: 全部 plus 10 is 11 chips, 524 pt plus padding: it scrolls on every phone, with the fade at the right edge, and a selection made on the photo scrolls its chip into view (§2.1). The e2e chip helper matches 「人物 1」 without matching 「人物 10」 (`personChip`).
- Bench: row R's layouts live in `bench/reshapeLayouts.ts` (unit-tested: every face inside the frame), with N = 9 and 10, a row of ten and a 2 × 5 grid; row D adds n12; the step-5 rows (face-detail spec §6.2) run N = 10.
- Debug: `window.__meiyan.obstacles` (the cache's obstacle boxes, V-normalized like `boxes`) and `dropped`.
- Fixtures: `ten_faces.jpg` and `eleven_faces.jpg` (§8.3), from the same generator, byte for byte. A first ten-face layout with faces of 7.5–11 % of the width lost one or two back-row faces of 7.5–8 % on both delegates whatever `numFaces` was (10 to 20): BlazeFace full-range's recall, not the cap. The committed layout (9–13 %, the eleventh 8 %) is found whole on SwiftShader, the desktop GPU and CPU, at decodes 2048 and 1440, also with every face moved by 0.01 of the width or shrunk by 0.006.

**Not changed.** Photos with up to eight faces: the shaders differ only in the loop bound and the array sizes, the loop stops at `uCount`, and the output is the same. The v0.3 parity goldens, the one-face GPU pins and the bit-exact one-face CPU test pass on both carriers. Also unchanged: the camera (3 faces), the bodies (4), the carriers' choice (§6.4), and saved 最近編輯 entries (a photo saved with eight faces keeps its stored detection).

**An earlier 0.4 build** reading an entry with nine or ten faces validates it against its own ids (f0…f7 at the cap of 8, f0…f5 before §6.6): it drops the faces past them with their persons and shows the cache-dropped toast, and it reads the first 8 obstacles. No migration is needed.

**Measurements** (§6.4, 2026-10-18 at ten faces): PR1 passes with the UBO (4.3–6.0 ms at 2048); PD1 passes (79–116 ms); the slider commit's fold check at ten changed faces, 75–78 ms on the desktop, is over §6.1's 66 ms (§9); since the v0.5 review (C9, §4.4) it takes 18.1–18.5 ms there with every face's 瘦臉 limit, 14.9–15.8 ms without (bench row PC, median of 5), within PC1.

**Tests whose assertions change on purpose:** `limits.test.ts` (10, 12, 10, `MAX_OBSTACLES` 12 and the A1 bound), `tracker.test.ts` (the clamp at 12), `editorModel.test.ts` (「偵測到超過 10 張臉，只會美化最大的 10 張」), `reshapeCpu.test.ts` (the hash, the loop bound and the 15,360 B block, the obstacle case with eleven faces, bits 8 and 9 of the detail mask), `toneCpu.test.ts` (the hash; ten mouths and twenty fold chords reach the CPU port), `cache.test.ts` (f0…f9 kept, `f10` dropped, 12 obstacles, the pending rematch keeps `f9`), `faces.test.ts` (eleven faces keep ten; one kept face and eleven too small leave eleven obstacles), `state.test.ts` (f0…f9, the 長腿 anchor on f9), `faceDetailBench.test.ts` (N = 10), `group-fixtures.test.mjs` (the new fixtures), `reshape.spec.ts` (ten-face and tenth-face-only cases on both carriers; the UBO layout), and `persons.spec.ts` (`small_faces.jpg` comments; new: `ten_faces.jpg` and `eleven_faces.jpg` on both delegates, §8.4). New: `reshapeLayouts.test.ts`.

---

## 7. Error and edge cases

| Case | Handling |
|---|---|
| More faces than `MAX_EDIT_FACES` | The largest are kept; the toast shows once (while the strip shows). A dropped face gets no face effects (mask 0, not in the table), even under 全部, but it stays an **obstacle**: its neighbours' caps and 瘦臉 limits respect it (§4.1, §4.7). Only detected faces are kept or dropped: the editor requests `EDIT_DETECT_FACES` (12), and MediaPipe returns its highest-scoring detections, not its largest. A face beyond those (a 13th person, or a large face that scores low, a profile or sunglasses, while smaller ones fill the 12) is not detected at all, so it is neither beautified nor an obstacle and a neighbour's cap does not respect it, like a face past `MAX_LIVE_FACES` in the camera (v0.5 review C13; 0.4.0 had the same structure at 6 and 8). |
| Faces below `MIN_FACE_FRAC` | Not selectable, no effects, obstacles. The too-small toast shows once, only while the strip shows; the over-cap toast wins when both apply. |
| A tiny unselectable face right next to a big one | It shrinks the big face's cap, as the approved rule says (half the distance to the nearest other face). §11 Q6 asks whether that should change. |
| Side-by-side faces closer than about 2 FW | The cap is a radius, so 下巴 and 額頭 (and the lowest jaw points of 瘦臉 and V臉) weaken although the neighbour is beside the face, not below it: 下巴 keeps ≥ 0.9 of its effect from 2.2 FW and ≥ 0.7 at 2.0 FW, 額頭 ≥ 0.9 from 2.0 FW. Eyes, nose and mouth keep ≥ 0.9 from 1.3 FW and ≥ 0.8 at 1.2 FW (the 8-landmark measure, accepted 2026-10-13, §4.4). §11 Q5 asks whether a cell-shaped cap should replace the radius. |
| A duplicate detection of one face | IoU > 0.6 dedupe (T3 in the editor, T4 in the camera); a duplicate is not an obstacle. Across the two photo detectors (the camera seed's union, a completion), faces whose landmarks nearly coincide (`sameHead`, §6.5: ten marks under 0.18 eye spans apart on average, the noses under 0.3, the eye spans within 1.5; or under 0.3 apart boxed at IoU > 0.6); an obstacle, which keeps no landmarks, only at IoU > 0.6 |
| A face without a pose, or a pose without a face | A face-only or body-only person; the notes of §2.4 |
| Overlapping or adjacent faces | Cap budget (§4.1, §4.4); protect regions (§4.7); rings take the max, fans write their own face, holes the min (§4.2); makeup: the last face wins only where both faces have makeup (§4.3) |
| A photo with no face | `globalSkin` from the primary person (`p0`, or the primary body person); today's notes and toast (`Editor.tsx:248-251, 789-797`) |
| Tracker recovering, or the detect call throws, on first open | As today (`RedetectBudget`, `editorModel.ts:27-48`). Edits meanwhile go to `p0` and pass to the primary at the first definite answer (§3.3). No cache is written until then, unless 美體 is used: it does not wait for that answer (v0.3 never did), and its bodies are written as the photo's cache in the 基本模式 form, `p0` handed to the primary body person (§3.3 item 6). The answer, in this session or after a reopen, merges its faces into that cache (A15 with A13's hand-over); no sideways face scan is forced before it (the session asks upright first). |
| The editor is closed before a definite answer | Without 美體, the record has `edit` (with `p0`) and no `detect`; the next open detects (§5.3). With 美體 used meanwhile (§3.3 item 6), the record also has that detection's cache in the 基本模式 form: `faceScans: []`, every body a person, and the primary body person (the best score; for a v1 entry's own body, b0's person) holding `p0`'s look, so `edit` has no `p0`. When 美體 found nobody, the cache's only person is `p0` and `edit` keeps it. A dropped cache's pending rematch rides in the cache, and the stored persons it names stay in `edit` (§5.3 R1, R3). The next open treats it as a 基本模式 cache (§5.3): with a tracker it detects once and merges the faces into it (A15 with A13's hand-over, R2; a pending rematch shows the reset toast); without one the cache is used as is. That answer is not the photo's first (a stored cache counts), so the selection stays, unless it was on the body primary that the hand-over moved to a face: then it follows the new primary (§3.3 item 4.4) |
| Engine swap or context loss | The new session gets `knownFaces` (or the cache) and does not detect again; the selection and the protect map are kept; the face table and the protect layers are re-uploaded, because their keys are reset in `dispose` (§4.4) |
| A detection that adds persons, then ↶ | `rebase` has injected them into every state, so they never disappear |
| 美體 adds a body-only person while 全部 is selected | The new person gets `template` and is appended to the numbering. The 全部 slider value and 「各人不同」 are recomputed. |
| 美體 adds the first body-only person to a one-face photo | The strip appears mid-session through the 260 ms frame transition (§2.1) |
| Body detection fails or finds nobody | Today's notes (`panelModel.ts:96-100`). Every person stays face-only; 增高 still works. |
| v1 `body` cannot be matched after re-detection (people ≥ 2) | The person that owned b0 keeps its params and loses b0. If that person was body-only, its params move to the new primary body person: the new primary when b0's person was the primary (a photo without faces), otherwise (the A13 split beside faces) the best-scoring body-only person the detection added (selectPerson's score). A person that already holds params never receives them (`renamePersons` keeps the first claim, so one person's values would replace the other's): when every new body paired with a face, b0's values are dropped. No toast: v0.3 edited the primary body by construction (`bodyTracker.ts:245`), which is the same choice the new primary makes. |
| v1 `body` pairs with no detected face | b0's person keeps v0.3's local 美體 values; the face-score primary gets the face look (§5.3, A13) |
| A cache with faces reopened in 基本模式 | The cached faces render with every person's face effects, and the boxes and strip show; only a new detection is unavailable (§3.3) |
| A 基本模式 cache reopened with a tracker | One detection, merged into the cache; ids and params kept (§5.3, A15) |
| A cache with more faces than this device's `MAX_EDIT_FACES` | Used as stored (A16) |
| An entry edited in 0.3 after a rollback | The stored `params` no longer give `paramsKey`: the photo and the primary take what 0.3 stored in them; what 0.3 cannot write stays (§5.3) |
| The camera loses the selected face | It fades out over 150 ms and is held for 1 s; if it is found again near its last centre, the selection resumes; otherwise the selection returns to `auto` (largest). A tracker "no answer" (`null`) never drops a track or the selection (T4). |
| Two camera tracks converge on one face | De-duplicated before matching (T4) |
| Camera flip, resolution change, resume | `resetSession` clears the tracks and the selection; 全部套用 stays as set (`AppState.cameraAll`) |
| More faces in front of the camera than `MAX_LIVE_FACES` | The camera tracks only `MAX_LIVE_FACES` faces. The others are invisible to it: not beautified, and not obstacles, so a beautified neighbour's cap ignores them. The editor sees them after the shot. |
| Camera tap on a face partly behind the floating slider row | The row swallows the tap as today; the face can be tapped above the row or after collapsing the panel |
| Front camera | Taps are un-mirrored (C1); the seed is mirrored exactly as the saved image (C2) |
| The seed lies in no face box in the editor (or outside the crop) | The primary as for an import (A13, then the score), and it gets `p0`, which holds only the user's own edits made before the answer; nothing is discarded (C2, C6). With no face found at all, `p0` keeps its params (the all-skin person). The shot opens at 原圖 either way (2026-10-18) |
| 基本模式 (no tracker), new photo | No face detection; `faceScans = []`; no boxes; the photo is "no face"; 美體 persons still come from bodies |
| 「Match GPUPixel」 debug | The mask stays off, so every skin pixel is smoothed with `S` (debug-only exception, `types.ts:270-271`) |
| A cache taken at 2048, reopened at 1440 (tier L) | Normalized coordinates; `cachedFits` checks only the aspect |

---

## 8. Testing

### 8.1 Unit (Vitest)

| Module | Tests |
|---|---|
| `tracker.ts` | `numFaces` is sent together with `runningMode` in one `setOptions`; no call when neither changes; the photo model (§6.5) goes in the same `setOptions` when the mode's model differs from the graph's, never with `delegate`, and without a photo model no call carries one; the photo bundle is assembled from the camera bundle and `fullRangeDetector` for each switch to it (a new buffer each time), the detector is read at every switch (none yet → the camera bundle; the photo after it arrives switches), `detector: 'camera'` runs the camera bundle in IMAGE, a detector or camera bundle the photo bundle cannot be built from is refused once, and `photoDetector` says which detector a photo runs; instances and replacements are built on the camera model, and an in-place rebuild keeps the graph's model; the first instance and every replacement are built with the last requested count, and the call after `replace()` makes no extra `setOptions`; `maxFaces` required and clamped; `toLandmarksAll` keeps every valid entry, `[]` for none; `detectVideo` returns `null` on its early returns and `[]` for a completed inference without a face |
| `detect/faces.ts` | Dedupe before the size filter; size filter at `MIN_FACE_FRAC`; cap keeps the largest; order by x with the y tie-break; ids; obstacles = the too-small and over-cap faces, duplicates excluded; the recorded `group_faces.landmarks.json` gives A, B, C, and D as an obstacle |
| `detect/persons.ts` | Pairing on synthetic poses and on the recorded fixture JSON; side-matched eyes (a mirrored face B still pairs); visibility < 3 points → no pair; greedy 1:1; one face + one pose (A14); face-only and body-only persons; ids unchanged when bodies arrive and when faces arrive after 基本模式; appended numbering; `p0` hand-over; primary scoring equals `selectPerson`'s; `seedPrimary` (padded-box containment, nearest centre among several, no box → no match: the import's primary, `p0` kept, C6); `hitPerson` (display → source through a band field, the 44 pt expansion at zoom 1 and 3, faces before bodies, equal mask values → the smaller mask) |
| `detect/cache.ts` | `cachedFits`; `normalizeDetect` drops only the corrupt part; the no-face cache with `p0` is valid and reopens without detection; obstacles validated; a cache with more faces than the tier cap is not truncated; `withFaces`; `rematchByIoU` + `renamePersons` (`legsAnchor` follows); a pending rematch kept when empty; `withBodies` never giving out a reserved id (the lowest-scoring extra bodies dropped instead) |
| `edit/*` | RM §8.1 step-1 list (scope table, `splitLegacy`/`legacyProjection` round trip, lens routing for `person`, `all`, the no-face exception and `legsAnchor`, the preset link, 重置, fuzzed `sanitizeEditState`, undo `{clone: false}` and `rebase`). Under 全部: `selected` and the no-op checks mean "every target matches" (primary 自然, person 2 精緻, 全部 + 自然 → person 2 自然; the same for 無 and for a lip shade); 程度 hidden when presets differ; mixed by display value (0.3451 and 0.3549 are not mixed). ⊘ with a person selected leaves the photo items and the other persons; ⊘ under 全部 resets the photo items. `p0`: unsure → 大眼 0.8 → a re-detect finds 2 faces → the primary has 0.8, the other `template`. `buildFrame` (neutral persons listed, obstacles passed, `globalSkin` only without faces). |
| `edit/migrate.ts` | Every row of §5.3 with fake-indexeddb records, including b0 paired with no face (b0's person keeps the 9 local `body.*` values, the face-score primary gets the face part), v2 `edit` without `detect`, a dropped cache rematched (ids renamed, `legsAnchor` follows), an unusable `edit` → the v1 path, and a `paramsKey` mismatch. The §5.3 R1–R3 cases: a stored person without a face box dropped at the 美體 merge and at a plain first answer; four bodies beside a reserved id; a seed on face A and a holder that pairs with no face, each with 細腰 on A's body person before the answer (A gets the face part and keeps 細腰); a stored person's face pairing with a body that does not hold the look (it keeps its stored params); `{}` and a no-longer-fitting 美體 cache keeping the rematch across a reopen |
| `store/history.ts` | v2 round trip with typed arrays; the `touch` default (today's rule); `touch: false` keeps `updatedAt` even with `edit` and a thumbnail; `paramsKey` stored; v1 tests unchanged |
| `editorModel.ts` | `stampIs` with `editKey`; a rebase while saved moves the stamp (no autosave); reopening a v1 entry, then assigning persons and adding bodies, leaves the `listEntries` order and `updatedAt` unchanged (fake-indexeddb) |
| `engine` packing | Face-table layout (offsets, `EMPTY_BOX`, yaw × weight, texel 73 = −1 without a neighbour, texel 74 window); `S`/`R`/`k` maxima; mask clear values; `capsFor` (no cap for one face, obstacles count, presence easing divides the distance, the box clipped to the cap disc's AABB) |
| `reshapeCpu.ts` | The N-face port, with `reshapeMapCpu(face, u, aspect, body, protect)` kept as a one-face wrapper, so `faceProtect.test.ts`, the straightness tests and the harness stay unchanged; one face bit-exact versus the frozen v0.3 port (`reshapeCpuV03.ts`, a test-only copy of today's file, since `reshapeCpu.ts` is rewritten); a two-face sum equals each face alone **with its cap**; the fold and strength sweep of §4.4; an 11-face case (`MAX_RENDER_FACES` + 1, §6.7) where the dropped face (an obstacle) is the nearest neighbour, and the cap uses it |
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
| Photo detector (§6.5, 2026-10-18) | `faceBundle.ts`: both bundles keep exactly the detector, landmark and geometry entries (no `face_blendshapes.tflite`), the camera bundle 2,803,159 B and the photo bundle 3,657,199 B from the pinned files, and either source gives the same photo bundle. `assets.ts`: the camera bundle has no blendshape entry; the detector and the model share the model phase's bar and `done` adds the detector; a stalled or failed detector holds neither `done` nor the camera, and leaves the bar; `loadPhotoDetector` is memoised, and a failure (404, not TFLite, HTML) is not kept. `services.ts`: the engine is ready without the detector, every tracker reads it through `fullRangeDetector`, a failed download is asked again at the next photo; `photoDetectorPending` waits for the first download while it lands within the cap, gives a hanging one up after `DETECTOR_WAIT_MS` (3 s) once per session, a later photo waits only for the rest, and nothing waits for a retry after a failure, the engine download's own request failing before `done` included (the request `done` starts is a retry; `detector.spec.ts` checks `detectorWaits` 0 for the first photo after it, 1 when the request hangs). `app/still.ts`: a full-range answer without a usable face retries once on short-range and takes its face; no retry with a face or on short-range; a retry that finds nobody keeps the definite no-face; cached faces ask nothing; a seed in no full-range face asks short-range once and adds only the faces that hold it (a duplicate keeps the larger box, the seed selects it; a full-range face on the seed's head boxed apart, IoU under 0.6, its landmarks on the short-range face's, gives way to the short-range face, while a neighbour cheek to cheek stays), nothing for a seed in a face, no seed or a short-range photo; a throw in that retry keeps the full-range answer, definite; the session reports the detector that answered. `faces.ts` (round 5): `sameHead` on 27 pairs of the two detectors' meshes (`testHeadPairs.ts`, rounded, the other landmarks NaN): 26 measured on scenes composed from the repo's own photos (`sample_face.png`, the group fixtures, `group_people.jpg`'s yoga face, `fullbody.jpg`'s masked man), one constructed from the sample's mesh. One head: close-ups, a face cut by each edge or a corner, the cut one of two faces, a group's face, a face 60 % hidden, one boxed apart (IoU 0.57), ones boxed alike with their marks 0.25–0.28 apart, the near-profile's lowest IoU and widest marks with no face over it. Two heads: G1's and G2's as round 4 merged them, a child before a nose with the noses 0.02–0.06 eye spans apart, a face of one size half behind another, the closest marks of two heads (0.197, the constructed pair: no repo photo gave two heads boxed apart closer than 0.239 with the nose and size tests passing), two heads boxed at IoU 0.73, F1's friend, neighbours, a group fixture's closest two; the rounding keeps what each scene measured, and the constructed pair is the sample mesh it names. With an IoU-only rule (round 4's first test, all it can apply without rings) both measured tests fail. An obstacle is one head only by IoU (a ring centre inside a face is no reason); one head meshed 1.3× larger about its nose (IoU under 0.6) or moved is one, 1.6× is not. On the sample's mesh, turned in 3D when asked (`testMeshes.ts` `yaw`, `retake`; mirrored as MediaPipe labels a mirrored face, its left and right landmarks swapped by the canonical face model's pairs, `MIRROR`, which `testMeshes.test.ts` checks against the detector on the flipped photo): G1's neighbour of one size behind a cheek, four 3/4 views 45 % behind a temple or cheek with the nose and an eye showing, G2's child before a parent's cheek or chin at eight placements, F1's friend, and two 3/4 views turned towards each other are two faces, through `prepareWith` and added by `withMoreFaces` (round 4 lost G1's and G2's). A sweep over different heads 0.4–1.25× a face's size, at front views or turned 30–45°, tilted ±20°, mirrored or not (about 760,000 placements), finds no merge while the face behind shows its nose and an eye clear of the front face's silhouette by a quarter of its eye span, nor through `prepareWith` and `withMoreFaces` at the most hidden such placement of each of 900 configurations (round 4 lost 170). A sweep over one head as the other detector meshes it (1.14× larger or smaller, moved 0.08 eye spans, tilted 3°), at front and 3/4 views, tilted, mirrored, whole or cut by the frame, square or 3:4, always merges: one face through `prepareWith`, nobody new through `withMoreFaces`. `prepareWith`: the seed's head meshed larger gives way; a full-range face boxed as a duplicate gives way to the seed's though its landmarks are elsewhere (a completion keeps it as a face). `cache.ts`: the short-range mark survives validation; `withMoreFaces` keeps every cached face, person, link and obstacle (a tiny face beside a cached face's jaw stays an obstacle, whatever the detection adds, until a new face boxed as it is it; one twice its size there leaves it), skips a found face on a cached face's head though boxed apart (meshed 1.3× larger about its nose), adds a friend beside its jaw and a mesh 0.4× its size inside it, adds the new faces under free ids in display order up to the cap (the rest obstacles, over the cap), pairs one with a body-only person, and clears the mark. `migrate.ts`: a short-range answer marks the cache, a full-range one clears it unless it leaves a short-range scan record beside it (a turned "nobody" keeps the mark of an upright short-range one; faces lift it); `completeAnswer` only adds persons to a cache with faces (every stored person, its params, the primary and the scan records kept; one that adds nobody leaves an edited photo's frame, caps and 瘦臉 limits' inputs as they were when it finds what the cache holds, a tiny face beside the jaw still bounding 瘦臉, round 4, and bounds the cap it left free when it brings a face below `MIN_FACE_FRAC` that short-range missed, the faces and their params unchanged, round 5). For a faceless one the answer replaces only the record of the up-frame it ran in, moved last (round 4; round 3 kept the upright answer as the only record): nobody there leaves another up-frame's short-range record owed and the mark on (`completionOf` then names that up-frame), a full-range record stays as it is, so an up-frame a scan answered full-range is not asked again, and faces lift the mark and every flag. `editorModel.ts` (rounds 3–5): `sessionPlan` draws a marked cache, faceless included, as a definite answer while the tracker is down; `completionOf` runs a cache with faces in its last scan's up-frame and a faceless one where a short-range record is owed (upright when that one is or no record says, else the last owed one); `completionDue` once per open, with a tracker and the detector in; `completionHeld` while no definite session is bound, the tracker is not `ok`, a scan is pending or the editor is busy; after a faceless completion that found nobody, `needsFaceScan` asks a turned up-frame again only while its record is short-range and full-range is in (never one a full-range scan answered), and `rescanOf` keeps that answer from saying 「未偵測到臉部」 again; `completionShows` (round 5): a completion that adds nobody but a tiny face's obstacle owes the thumbnail and says nothing with one person, an eleventh face past the cap owes it and says 「偵測到超過 10 張臉」 (a cache over the cap already says nothing again), nothing new redraws nothing and says nothing, and new faces say what an answer says, taking the first group photo's hint. `upFrame.ts`: `upTracker` forwards the detector choice. `downloadSize.test.ts`: 「首次使用需下載約 7–8 MB」 brackets the model, the detector, the wasm and its loader (brotli to gzip) |
| Fold check and carrier (v0.5 review C9, C11, 2026-10-18) | `warpGuard.test.ts`: a 全部 commit at ten faces with every 美型 item at max checks each face once, keeps λ = 1 and costs at most 16 `Math.hypot` per mapped point (12 now, 92 before the per-face constants, §4.4); the bit-exact `reshapeCpu.test.ts` cases are unchanged. `foldGuardBench.test.ts`: row PC's layouts, a 全部 commit checks every face and one person's change one face; `all_ms` and `one_ms` time commits whose every face carries its own `PROTECT_WINDOW`² limit, built once, and `all_ms_unlimited` the same 全部 commits without (D6). `reshapePass.test.ts`: `ReshapePass.carrier` is the carrier its `RESHAPE_FS` was compiled with. `index.test.ts`: `__meiyan.gl.FACE_TABLE_UBO` is unset until a frame built the reshape pass, then the pipeline's `faceTableCarrier()`, not the renderer selector's pick. `carrierWiring.test.ts` (D5): the real engine, pipeline and pass on a recording fake context; a GPU renderer compiles and draws `RESHAPE_FS` with `FACE_TABLE_CARRIER` and the flag says `true`, SwiftShader and the texture `false`, an unreadable renderer `FACE_TABLE_CARRIER`; `createPipeline({ faceTable })` builds that carrier, `FACE_TABLE_CARRIER` when omitted |

### 8.2 Shader ports and hash pins

- `RESHAPE_FS` is pinned again (`reshapeCpu.test.ts:32`), with `reshapeCpu.ts` ported to the face table, the loop, `budgetScale` for both the limit and the cap, the protect windows and the single-face shortcut. `reshapeCpuV03.ts` anchors the bit-exact single-face test.
- `mask.test.ts` gains per-face channel values and a two-face case: rasterized on the CPU, a neutral face's cheek border stays 0 next to a beautified neighbour.
- `tests/e2e/reshape.spec.ts` keeps its test as it is (`reshape.spec.ts:11` still expects 3 cases). A separate test, `runReshapePinMulti`, adds the two-face, capped-pair, obstacle, ten-face and tenth-face-only (§6.7) cases, for both table carriers (the pins take the carrier; since §6.6 the one-face, view and 推臉筆 pins run on both too); GPU equals the CPU port within 0.05 px. It also reads the UBO block's std140 size from the driver (15,360 B, §6.7). `faceProtect.spec.ts` gains a two-face case and a small-face window case.
- `tests/e2e/pages/engine.ts` gains an N-face harness that reads back M (the two-face mask of §4.2) and checks that an earlier face's lip survives a later face's mesh (§4.3).
- The reshape pin harness also runs in `/bench.html` (row RP, §6.2), so the port is checked on Metal.

### 8.3 Fixtures

The fixtures follow RM §8.3: synthesized from Apache-2.0 images already in the repository, and recorded in `LICENSES/NOTICE.txt` with the §4(b) change notice.

| Fixture | Script | Use |
|---|---|---|
| `tests/fixtures/group_faces.png` | `scripts/gen-group-fixture.mjs` | 1800 × 1200. `sample_face.png` (1000 × 1500) copies: A scale 0.42 at x 0.22; B mirrored, scale 0.34, at x 0.55; C scale 0.22 at x 0.82; D scale 0.05 bottom right. |
| `tests/fixtures/group6_faces.png` | `scripts/gen-group-fixture.mjs` | 2048 × 1536. Six copies of `sample_face.png` at equal scale in a 3 × 2 grid, 1.3 FW apart (alternate copies mirrored). Bench rows F, PE and R, and the clustered e2e cap case. |
| `tests/fixtures/small_faces.jpg` | `scripts/gen-group-fixture.mjs small_faces.jpg` (`SMALL_FACES`, `smallFaceCell`) | 2000 × 1500, JPEG q 0.92. Seven `group6_faces.png`-style cells of `sample_face.png` on the edge colour: three large faces of 14 %, 12.5 % and 10.5 % of the width along the top, four small ones of 6 %, 6.6 %, 7.2 % and 7.8 % below them, alternate cells mirrored. The small-face group photo of §6.5: the short-range detector finds the three large faces (D3D11, SwiftShader and CPU), the full-range one 7. A synthetic layout (2026-10-19, replacing an earlier one), placed by a seeded random search and hill-climb over BlazeFace's own scores: every face scores at least 0.67 full-range on SwiftShader and CPU, the small ones also with the large cells erased, and the 10.5 % face, kept alone with the small ones and turned 90°, is missed short-range until turned upright (`detector.spec.ts`), while the 14 % and 12.5 % faces are found turned too. A face moved by 0.01 can score 0.1–0.3 apart (the anchor grid), so a change to the layout needs those cases probed again. |
| `tests/fixtures/ten_faces.jpg`, `eleven_faces.jpg` | `scripts/gen-group-fixture.mjs` (`TEN_FACES`, `ELEVEN_FACES`) | 2000 × 1500, JPEG q 0.92, cells as `small_faces.jpg`. Ten faces 9–13 % of the width in two staggered rows of five (the cap, §6.7: 全部 + 10); `eleven_faces.jpg` adds an eleventh, the smallest (8 %), above them: the cap keeps the ten, the eleventh is an obstacle. Every centre x at least 0.03 from every other, so f0…f9 run left to right on any delegate. |
| `group_faces.landmarks.json`, `group_faces.pose.json` | `record-landmarks.mjs`, `record-pose.mjs` (extended to every face and pose, `numFaces` 8, `numPoses` 4) | Unit tests |
| `tests/fixtures/group_people.jpg` (+ `.pose.json`) | `gen-group-fixture.mjs` | `fullbody.jpg` and `fullbody_yoga.jpg` side by side at equal height |
| `tests/fixtures/group.y4m` (gitignored) | `gen-y4m.mjs --src group_faces.png` | 1280 × 720 with A, B and C visible, 30 frames |
| `tests/fixtures/group_noise.y4m`, `group_pan.y4m` (gitignored) | `gen-y4m.mjs --src group_faces.png --noise <seed>` / `--pan 0.5` | Bench rows J (seeded per-frame sub-pixel shifts and noise) and J2 (the faces translate 0.5 FW per second) |
| `tests/fixtures/parity-v03/*.png` | `scripts/record-parity.mjs` on `892ea61` (`face-body.png`, and the four cases of 2026-10-17, on `f877881`, whose `src` is identical, with those cases added to the page; the older goldens re-recorded byte-identical there) | `sample_face.png` with 自然; 精緻 with every 美型 item at max; lip and blush shades; `fullbody.jpg` with 細腰 + 長腿 + 增高; `sample_face.png` with its face and its body (`sample_face.pose.json`), 自然 + 天鵝頸 + 小頭; and, for the paths the B2 harness's check 1 no longer compares with v0.3: `sample_face.png` with 自然 and no face (the global skin), 自然 exported mirrored, and 精緻 + 美型 max at face weight 0.4 and at yaw 0.25 (half the yaw attenuation). Max channel diff ≤ 1/255, mean < 0.02/255. Today's side renders all but `face-body` through test adapters (`legacyFrame`, `buildBodyFieldV1`) and `face-body` through the editor's own path (`openState` → `firstAnswer` → `measurePersons` with the paired face → `fieldInputOf` → `BodyFieldMemo` / `buildBodyField`; `frameFacesOf` → `buildFrame`). |

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
- **`persons.spec.ts`**, on `small_faces.jpg` (§6.5), on the GPU path and with the CPU delegate: `__meiyan.faces` and the persons are 7 (`MAX_EDIT_FACES` 10, §6.7), the strip is 全部 + 7, every box is one of the fixture's faces, each once, no 「偵測到超過」 toast shows, each of the seven chips selects its person, and 大眼 on the smallest face changes only its region; the app renders with the texture carrier there (SwiftShader, §6.4). With the photo model disabled short-range finds 3 there, the large faces (GPU and CPU).
- **`detector.spec.ts`** (§6.5, 2026-10-18), on the GPU path and with the CPU delegate: three photos composed from `sample_face.png` at test time (a 3:4 close-up whose face is 1.1 × the frame's height, a 3:4 portrait with the face's top 35 % above the frame, a 4:3 landscape whose face, 0.3 of the height, is 35 % past the left edge) each open with one face where the fixture put it, `detectCalls` 1 and `detectRetries` 1, and no 「未偵測到臉部」; the close-up turned 90° finds nobody upright, and 裁切 › 旋轉 then scans the turned photo, which retries the same way and finds the face. With the service worker blocked: the camera goes live while the detector request hangs (0.5.0 waited for its 30 s stall). With the detector request hanging (round 2, D1), `small_faces.jpg` shows its short-range faces about 5 s after the pick (engine start, the 3 s wait, the detection), long before the request's 30 s abort, and a second photo waits for nothing (0.3 s); both entries carry the short-range mark. With the first request failing and the retries hanging, the first photo, that request being the engine download's own, draws its short-range faces 1.6–1.8 s after the engine is ready, the detection alone (its first IMAGE-mode graph build included), with `detectorWaits` 0 (round 2 counted the retry the engine's `done` started as the first download and waited 3 s more on it, 4.7 s; the test's bound is 3.5 s), and a photo opened then waits for nothing either (0.3 s; the first version of the wait took 17–19 s, the rest of the retry's stall); after a relaunch while the request still hangs, reopening the first entry draws its cached faces about 0.1 s after the engine is ready (round 2 waited 3.1 s first), and once the request is answered the same open completes it (D3, round 3): seven faces, one detection, the cached faces shown before the rest, every cached person and its 大眼 kept, the new persons at 原圖, the mark gone, and a further open detects nothing. With the detector failing at once (round 3), three photos built from `small_faces.jpg` at test time are saved short-range: its four small faces (nobody), the same turned 270° and turned upright in 裁切 (nobody either way), and the 10.5 % face kept with them, turned 90° and turned upright (that face alone). With the detector back: the first reopens with no 「未偵測到臉部」 toast and gains the four small faces upright (probed on SwiftShader; the test asks for at least two); the second is asked upright (nobody), which replaces its upright record alone, so its turned record is still owed and the turned photo is scanned again as shown, full-range, finding the small faces (round 2: no face, for good); the third draws its one face first and is completed where it was found, gaining the small faces (completed upright it gains none). The first of them reopened after a relaunch with the detector served and the face tracker's context lost at every build (`body.spec.ts`' kill, GPU path only) is still a definite "no face": 「未偵測到臉部，臉型與美妝不會套用」, no 「臉部偵測重新啟動中」, 祛痘 enabled, and nothing detected for 3 s; once the tracker lives, the completion runs once and gains the small faces (round 2 asked the dead tracker instead: unsure, all seven 膚質 tools gated). Through the camera (D2, a clip composed at test time): B selected, cut by the frame's top edge, the editor finds both faces with one short-range retry and selects B. Each of these fails on 0.5.0, the round-2 ones on the round-1 build as well, and the round-3 ones on the round-2 build. Round 5, GPU path: with the detector failing, then served with no `online` event, a hidden page asks nothing and a return to the app (`visibilitychange`) asks once, which completes the open photo (it fails with the listener deleted, and with its `visible` guard); the four small faces turned 270° and turned upright in 裁切 while the detector lands, whose completion's detection then throws once (the tracker's read of the photo's `ImageBitmap`), merge nothing, and the turned up-frame is scanned, full-range, in that open, finding the faces (round 4: no face in that open); and a group composed at test time, ten faces short-range finds and an eleventh, 0.1 of the width, below the front row's middle face that only full-range finds (probed: from 0.09 wide), with 下頜線 at the top on that face, is completed with nobody added and the eleventh an obstacle over the cap: 「偵測到超過 10 張臉」 shows and the stored thumbnail is rewritten (round 4: neither; a build that shows the notice but owes no thumbnail fails too). 下頜線, not 瘦臉: a 瘦臉 limit is built from the obstacles too (`protectRequests`), and a new limit re-arms the history write itself (`fieldGen`), which redraws the thumbnail anyway.
- **`persons.spec.ts`**, on `ten_faces.jpg` and `eleven_faces.jpg` (§6.7), on the GPU path and with the CPU delegate. Ten faces: the faces and persons are 10, no obstacle and nothing dropped, the strip is 全部 + 10, every box is one of the fixture's faces, each once, with f0…f9 left to right, no 「偵測到超過」 toast, each of the ten chips selects its person; at 320 × 568 and 430 × 932 pt the strip scrolls (scroll width ≥ 548 pt), and a tap on the tenth face, from the start of the row, selects it and scrolls chip 10 into view; 大眼 on person 10 (the table's last row) changes only its region. Eleven faces: the persons are the ten largest, the eleventh is the one obstacle (`__meiyan.obstacles`, where the fixture put it; `dropped.overCap` 1), 「偵測到超過 10 張臉，只會美化最大的 10 張」 shows, and 全部 + 大眼 changes every kept face and leaves the obstacle's face bit for bit. On a build with the cap at 8 both fail (8 faces).
- **`body.spec.ts`** gains cases on `group_people.jpg`:
  - two persons; a tap on the right body selects person 2;
  - 細腰 on person 2 leaves person 1's mask region unchanged (≤ 1/255), with `bodyFieldCacheStats.lambdaGlobal === 1`;
  - the bands note shows only while 增高 or 長腿 is active, and the old multi-person note is gone.
- **`camera-group.spec.ts`** (new Playwright project `chromium-group`, the same settings with `--use-file-for-fake-video-capture=tests/fixtures/group.y4m`, `testMatch: camera-group.spec.ts`):
  - `__meiyan.faces === 3`; the largest face (A) is beautified by default (with 一鍵 › 自然 tapped first: the camera starts at 原圖 since 2026-10-18);
  - a tap at B's box (`__meiyan.boxes`, mapped through the cover transform) → B beautified and A unchanged (`regionDiff` against 按住對比);
  - 全部套用 → all three change; a tap on C then turns 全部套用 off and selects C;
  - shutter → 編輯 → the editor's `selected` is B's person (with 全部套用 off), at 原圖.
- **`original.spec.ts`** (2026-10-18): on a 0.4.0 upgrader's profile with no saved camera look (its version and settings only) the camera starts at 原圖 and nothing is written. An import, with a styled camera look stored, and a camera shot (自然 + 美白 100 in the camera) both open at 原圖: the composite pass only, no segmenter or pose model, 一鍵 shows 原圖, and the PNG export equals the source (the shot's unprocessed frame) with MAD 0 and max 0; the camera look still draws the preview and the capture. After 一鍵 › 自然, 重置 returns to 原圖: the composite pass only again and the export equals the source (MAD 0).
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
| BlazeFace short-range misses small or distant faces (MediaPipe #4698) | A face the user cannot select | Photos detect with BlazeFace full-range since 2026-10-17 (§6.5): faces from about 6 % of the photo width (not every such face: a synthetic ten-face layout lost some of 7.5–8 %, §6.7). The camera keeps short-range (its cost and PL2). `MIN_FACE_FRAC` and the toast; PD2 measured; re-detect is out of scope |
| Camera cost, jitter or lag with `numFaces` 3 (no MediaPipe smoothing) | Lower fps or a shaky or trailing warp, including for a lone selfie | MediaPipe's own smoother replicated; PL1, PL2, PJ1 and PJ2 fall back to 1 face (v0.3, smoother bypassed). Desktop 2026-10-13 (§6.4): a lone selfie pays +3.5–4.2 ms per detection on the GPU delegate and +1.9–2.1 ms on CPU, so PL2 (≤ 5 ms) passes. Three faces miss PL1 (p50 about 31 ms; about 22 ms at `numFaces` 2). The count is not switched at run time: each switch is a graph rebuild whose first inference takes 145–165 ms on the GPU. The bench prints the PL1 and PL2 verdicts for the iPhone run that decides. |
| The slider commit's fold check with ten faces (§6.7) | A 全部 commit with every face's warp changed took 75–78 ms on the desktop (66 ms budget), more on a phone: a short hitch after the finger lifts | Only changed faces are checked and the result is memoized; since the v0.5 review (C9) the map computes each step's constants once per face and gates its hypot (§4.4, the same doubles): 18 ms at ten faces on the desktop with every face's 瘦臉 limit (15 ms without), one person 2 ms. The 65 grid stays (a coarser one could miss a fold). Bench row PC on the phone decides (PC1, §6.3) |
| The `BeautyParams` → `EditState` port through the 881-line `Editor.tsx` | Regressions in autosave, the 瘦臉 limit or 美體 timing | 1b lands alone, behaviour unchanged, with parity goldens and every existing e2e |
| The summed displacements of close faces fold | Visible artefacts between faces | Disjoint cap discs; the cap is the 瘦臉 limit's slope-bounded budget; the fold sweep; the editor's λ_f safety net |
| The radius cap weakens 下巴, 額頭 and, in very tight shots, the mouth in group shots | Less effect than the user expects | Measured and pinned by the strength sweep (§4.4, accepted 2026-10-13): eyes, nose and mouth ≥ 0.9 from 1.3 FW (≥ 0.8 at 1.2 FW, because 瘦臉 / V臉 / 窄臉 at max move the mouth about 0.10 FW against a budget of about 0.08 FW there); 額頭 ≥ 0.9 from 2.0 FW; 下巴 ≥ 0.9 from 2.2 FW (≥ 0.7 at 2.0 FW). §11 Q5 offers the cell-shaped cap |
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
2. **Importing a group photo:** everyone gets the current camera look (自然 by default), or only the primary person, as v0.3 effectively did? *Default: everyone (RM §3.7).* **Decided 2026-10-18:** neither; a new photo opens at 原圖 for everyone (RM §3.7).
3. **A shot taken with 全部套用:** should the editor open with 「全部」 selected? *Default: no. The primary person is selected (the approved default), and everyone already carries the look.* Since 2026-10-18 the shot opens at 原圖 and nobody carries the look; the selection rule stands (the primary, §2.2), and 「全部」 is one tap away.
4. **背景保護 in a group photo:** one switch for the whole photo, with the protection computed per person, or a switch per person? *Default: one switch for the whole photo (A8; a per-person switch is out of scope in RM §10).*
5. **Shape of the influence cap:** the approved rule is a radius, half the distance to the nearest other face. For faces side by side, it also cuts 下巴 and 額頭 below and above the face, where there is no neighbour: 下巴 keeps ≥ 0.9 of its effect only from 2.2 face widths apart (≥ 0.7 at 2.0), 額頭 from 2.0; and closer than 1.3 face widths the mouth also loses part of what 瘦臉 / V臉 / 窄臉 move there (the eyes, nose and mouth keep ≥ 0.8 at 1.2 face widths; §4.4, measured and accepted 2026-10-13). The alternative is a cell: each face's influence ends at the line halfway to each neighbour, so 下巴 and 額頭 stay at full strength for side-by-side faces. It uses the same budget and costs the same. *Default: the radius, as approved; its measured trade-off was accepted on 2026-10-13.*
6. **Tiny faces that cannot be selected** (below 3 % of the short edge, or beyond the 6-face cap) are obstacles: a big face's cap shrinks to half the distance to them, so a small background face beside a cheek weakens that face's 瘦臉. Keep that, or let only selectable faces limit the cap (the tiny face may then be distorted)? *Default: keep, the literal rule.*
