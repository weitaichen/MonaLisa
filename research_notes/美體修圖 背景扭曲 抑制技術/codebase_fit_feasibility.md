# Background-distortion reduction for MonaLisa 美體 / 瘦臉: codebase fit, feasibility, phased plan

Research date 2026-10-08. Scope: which background-distortion techniques are worth building **in this codebase**, how they plug into `buildBodyField` and the P2 reshape pass, what they cost on an iPhone in Safari, and how to test them. I did not repeat the earlier report (`reports/全身美體修圖 PWA 實作.md`, §「垂直於骨骼的位移場，加上遮罩約束，才能不彎門框」). This note measures and extends it.

**How the numbers below were made (scratch only, nothing in the repo was changed).** I wrote three scratch modules: `exp.ts`, `solve.ts`, and `fieldmod.ts` (a copy of `field.ts` with the dilate and feather multipliers exposed). They lived in a temporary session scratch folder (not committed), and they load the real `src/` modules through Vite's SSR loader, the same way `tests/harness/b1/run.mjs` does. The scenes are the B1 synthetic figure (`synth` with arms away from the body, `synth_armsdown`) and the two recorded PoseLandmarker fixtures (`pose_fullbody`, `fullbody_yoga`). Each scene is analysed on a grid with a 900 px long edge, and every pixel value is quoted **at a 4032 px long edge (a 12 MP iPhone photo)**. The metrics are:
- **Line bend.** Dense virtual straight background lines: verticals and horizontals every 4 px, and diagonals at ±45°. Each line is forward-mapped through the field using the fixed point p = s − D(p). Only background points more than 2 px from the person are kept. Bend is the maximum residual to the total-least-squares line through the line's visible points, so a pure shift or rotation scores 0. This is the "max deviation of a detected line, before vs after" metric, but it needs no line detector, because the field is known.
- **Ring stretch.** At each background output pixel, 1/σ_min(J) − 1, where J is the Jacobian of the backward map (local background magnification). Also the ring extent: the farthest background pixel, measured from the original silhouette, that moves more than 0.5 px.
- **Gap stretch.** The same stretch, restricted to background pixels that have the person within 4.5 % of H on both the left and the right of the same row.
- min det J (`fieldMinJacobian`), and build time measured in Node/V8 on the dev PC.

---

## Q1. Where does the current approach still distort the background, and how much?

### Takeaway
背景保護 limits **how far** the distortion reaches. It does not limit **how strongly** lines bend next to the silhouette. With background protection on or off, a straight background line near a slimmed silhouette bends by about the silhouette's own displacement Δ: about 46–78 px at 4032 for 瘦身+細腰 at maximum, and about 26 px for 瘦手臂. Lines that emerge from behind a silhouette moving perpendicular to them (T-junctions) cannot be straightened by any continuous fold-free warp. Ring magnification near limbs reaches 2× (arms), 1.6–1.8× in arm–torso and leg gaps, and up to 2.7× with every slider at maximum. 瘦臉 has **no** background protection at all. Its contour warps reach 48–60 % of the face width beyond the face oval. The 128 draft is a faithful preview: its background differs from the 256 commit by at most 3.7 px (9.6 px for 小頭).

### Cited Findings
**How the current protection works (code).**
- 背景保護 multiplies the summed local field by M. Δ is the **largest** local displacement found on any silhouette-boundary texel of the whole figure. M is 1 on the person, dilated by max(Δ, 2 texels), and falls to 0 over a feather of max(4Δ, 3 texels). Then come two 3×3 box blurs, after which M is forced back to 1 inside the person. One global Δ therefore sets the band width for every body part. — [field.ts L231–249](../../src/body/field.ts); [mask.ts protectWeights L129–145](../../src/body/mask.ts)
- The local primitives already have compact support. The trunk ring radius is R = ρ·W with ρ = TRUNK_RHO = 2.0, and it is clipped by a measured "reach" toward neighbouring parts. Limb capsules use ρ = 1.7. The capsule ring's own background stretch is bounded by 1/(1 − 0.8·k·a). — [measure.ts L174–180, trunkReach L524–549](../../src/body/measure.ts); [prims.ts header](../../src/body/prims.ts); [field.ts RHO_LIMB](../../src/body/field.ts)
- 長腿 and 增高 are full-width bands that depend only on y (D_y = g(y) − y). Hands inside a band are held rigid by a local term whose lost stretch "moves into the blend ring around it … slope stays ≳ 0.4". — [bands.ts header](../../src/body/bands.ts); [field.ts handsRigidInBands L618–637](../../src/body/field.ts)
- The face chain (curveWarp / scaleAround / shiftAround) runs in the shader after the body map. It takes no mask input: each curveWarp is a disc of radius |t − o| around the contour point o, which reaches outward as far as inward. — [reshape.ts RESHAPE_FS L202–265](../../src/engine/passes/reshape.ts)
- The draft field is built at BODY_DRAFT_LONG_EDGE = 128 during a drag and rebuilt at 256 on commit. The draft also runs a coarser fold-guard bisection (4 steps against 12). — [editorModel.ts L225–267](../../src/ui/editorModel.ts); [field.ts L72–77](../../src/body/field.ts)
- The person mask is stored at a 256 px long edge (MASK_LONG_EDGE), which is 1 texel ≈ 16 px at 4032. — [bodyTracker.ts L87–88](../../src/tracking/bodyTracker.ts)

**What existing tests cover.** The e2e test checks that the far corners stay bit-identical under 細腰 and 腰臀比 (`cornerMax == 0`), and that the torso changes. B1 reports min det, max displacement, and displacement beyond 15 % of H from the person. Neither measures straightness or stretch near the silhouette. — [body.spec.ts L155–198](../../tests/e2e/body.spec.ts); [b1/render.ts farBackgroundMax, Row](../../tests/harness/b1/render.ts)

**Measured: background protection on vs off** (瘦身+細腰 at maximum; scratch `exp.ts` bodyRuns):

| scene | 背景保護 | ring extent | vertical-line bend | diagonal bend | max stretch |
|---|---|---|---|---|---|
| synth | on | 210 px | 46.0 px | 38.6 px | 66.6 % |
| synth | off | 281 px | 46.1 px | 38.8 px | 67.8 % |
| pose_fullbody (real mask) | on | 300 px | 78.5 px | 55.6 px | 88.4 % |
| pose_fullbody | off | 316 px | 78.4 px | 55.6 px | 88.4 % |

In the real photo, Δ ≈ 86 px, so the protect band is about 5Δ ≈ 430 px. That is wider than the trunk ring itself (about one half-width beyond the edge), so M ≈ 1 wherever the field is non-zero. — scratch `exp.ts` (bodyRuns, `out_bodyRuns_full.json`)

**Measured per slider at maximum** (synth / pose_fullbody, 256 field, px at 4032):

| slider | ring extent | max stretch | p99 stretch | vertical bend | horizontal bend | diagonal bend | min det |
|---|---|---|---|---|---|---|---|
| 細腰 | 99 / 214 | 19 / 42 % | 18 / 38 % | 27.7 / 41.0 | 0 / 2.3 | 19.9 / 32.7 | 0.84 / 0.71 |
| 瘦身 | 172 / 197 | 62.5 / 84 % | 52 / 51 % | 33.6 / 41.5 | 4.3 / 5.3 | 31.1 / 31.0 | 0.62 / 0.53 |
| 腰臀比 | 115 / 161 | 23 / 39 % | — | 21.3 / 30.6 | 0 / 1.7 | 13.5 / 23.4 | 0.82 / 0.72 |
| 美臀 + | 124 / 148 | 6 / 36 % | — | 16.4 / 22.2 | 0 / 1.4 | 14.2 / 18.6 | 0.85 / 0.74 |
| 瘦腿 | 103 / 91 | 77 / 41 % | 77 / 36 % | 28.6 / 14.5 | 0.7 / 1.6 | 27 / 13.2 | 0.56 / 0.71 |
| 瘦手臂 | 68 / 86 | 101 / 105 % | 99 / 102 % | 26.1 / 25.8 | 9 / 11 | 24.9 / 25.5 | 0.50 / 0.48 |
| 直角肩 | 78 / 143 | 10 / 35 % | — | 0 / 1.4 | 8.8 / 26.2 | 6.8 / 20.4 | 0.84 / 0.69 |
| 小頭 (synth only; head gated off on the fixtures) | 177 | 69 % | 58 % | 15.4 | 30.5 | 26.4 | 0.63 |
| 天鵝頸 (synth) | 125 | 32 % | — | 0 | 19.6 | 13.3 | 0.79 |
| 長腿 | whole lower frame | 35 / 76 % (around hands) | 16 / 15 % | **0 / 0** | 12.3 / 19.6 | **27.4 / 27.6** | 0.74 / 0.57 |
| 增高 band | whole band | 43 / 58 % (around hands) | 18 / 15 % | **0 / 0** | 9 / 12.4 | **35.8 / 34.4** | 0.70 / 0.63 |
| all at maximum | — | 155 / 115 % | 73 / 53 % | 47.6 / 75.7 | 45.6 / 26 | 51.6 / 63.6 | 0.39 / 0.44 |

— scratch `exp.ts` (`out_bodyRuns_synth.json`, `out_bodyRuns_full.json`)

- **長腿 / 增高 transition bands.** As designed, vertical lines stay perfectly straight (bend 0 in every scene). Diagonals kink in the ramps: 24.6–27.6 px for 長腿 and 34.4–53.7 px for 增高 (53.2 px in `synth_armsdown`, 53.7 px in `fullbody_yoga`). The horizontal bends (9–42 px) and the largest stretches (35–106 %) come from the hand-rigid term. Its blend ring around a hand at the hip is background, and in `synth_armsdown` the stretch there reaches 106 %. — scratch `exp.ts` bodyRuns
- **Narrow gaps.** In the arm–torso gap of `synth` (arms clear of the body), 瘦身 magnifies the background by 62.5 % about 13 px from the silhouette, and 瘦腿 magnifies the gap between the legs by 77 %. On the real fixtures the gap stretch is 12–35 % (pose_fullbody) and 13–35 % (yoga). The "reach" clipping keeps gaps from stacking two rings but does not stop the stretch. — scratch `exp.ts` bodyRuns (gap columns)
- **Where the worst stretch sits.** The maximum is 13–117 px from the silhouette: inside Δ + 4Δ, but mostly in the capsules' own r ≈ 0.77 ring, not in the feather. 瘦手臂 reaches 2× magnification about 40 px outside the upper arm, near the shoulder, in every scene. — scratch `exp.ts` (maxAt / gapAt columns)
- **Feather sweep** (dilate ×0.5–2, feather ×4–8): line bend does not change (for example 瘦腿 28.6 → 28.5 px, 瘦身+細腰 46.0 → 46.1 px). Peak stretch drops modestly (pose_fullbody 瘦腿 40.6 → 29.3 % at 8Δ, 瘦手臂 105 → 98 %), and the ring gets wider (synth 瘦身+細腰 210 → 268 px). — scratch `fieldmod.ts` + `exp.ts` featherSweep (`out_featherSweep.json`)
- **瘦臉 / face reshape** (sample_face fixture, 1000×1500, face width FW = 589 px; JS port of the shader's contour warps; scratch `exp.ts` faceRun):

| setting (max) | displacement within 5 % FW outside the oval | reach of > 0.5 % FW displacement beyond the oval | background (pose mask) max displacement | background reach beyond the person | vertical-line bend in the background |
|---|---|---|---|---|---|
| faceSlim | 14.2 % FW | 60 % FW | 2.9 % FW | 13 % FW | 0.71 % FW |
| faceV | 10.3 % FW | 52 % FW | 0.5 % FW | 9 % FW | 0.10 % FW |
| faceNarrow | 10.1 % FW | 48 % FW | 3.8 % FW | 16 % FW | 1.0 % FW |
| slim + V + narrow | 22.5 % FW | 60 % FW | 6.0 % FW | 16 % FW | 1.65 % FW |

  On this fixture the hair surrounds the face. Whatever lies right next to the jaw (hair, ears, collar, or a wall when the hair is short or tied back) moves almost as much as the jaw itself. — scratch `exp.ts` faceRun (`out_faceRun.json`)
- **128 draft vs 256 commit.** The largest background difference in the field is ≤ 1.5–3.7 px for 瘦身+細腰, 瘦手臂, 瘦腿 and all-max, and **9.6 px for 小頭**. The draft's line bends match the commit's within about 1–3 px. The draft's minimum dilate and feather are 2 and 3 texels of the coarser grid, which makes its ring about 5–30 % wider (小頭 226 vs 177 px). The draft min det is equal or higher. — scratch `exp.ts` draftDiff / bodyRuns
- **Build cost today** (V8 on the dev PC, median of 10; cold means a new measure, so the mask grid is a cache miss): at 256, 長腿 5–10 ms, 瘦身+細腰 14–19 ms, all-max 36–57 ms. At 128, 1.3–2.6, 3.6–4.8 and 10–15 ms. — scratch `exp.ts` timing (`out_timing.json`)

### Inferences
- The remaining distortion is a **near-silhouette** problem, not a far-field one. Bend is about Δ⊥(y), the silhouette displacement perpendicular to the line, varying along the line. Spreading it over a wider feather only trades peak stretch for extent. The earlier report's 4Δ rule keeps the *ring* stretch at or below 25 % only for the protect multiplication. The capsules' own rings (up to 1/(1 − 0.8k), with k up to 0.62 for one-sided arms) and the hand-rigid rings dominate the measured peaks.
- **Visibility.** On a phone the photo is shown at roughly 0.3–0.4× of 4032 (about 1179 px wide screens). A 46–78 px bend is therefore about 15–30 physical px on screen, clearly visible. 25 px is about 8–10 px, visible on a door frame. Below about 8 px at 4032 (about 3 px on screen) should pass a casual look. Treat 8 px at 4032 as a working "invisible" target, to be validated against real viewers.
- **T-junctions are the fundamental limit.** Where a background line comes out from behind a silhouette that moves perpendicular to it (door frame or stripe behind the waist, horizon behind the head), the background exposed by slimming must come from somewhere. A continuous fold-free map can only bend the line (today), smear it, or move it as a whole. Only layering plus fill removes it (Q2).
- Single-global-Δ protection is effectively a no-op for the trunk in real photos, though it does clip long tails (小頭's falloff, edge cases). The 背景保護 toggle overpromises. Either make it do something measurable (Phase 1) or relabel it.

### Gaps
- No iPhone or JavaScriptCore timing of `buildBodyField`. The V8 numbers come from the dev PC and could be 1–2× off on older iPhones (unverified).
- The virtual-line metric covers 0°, 90° and ±45° only. Shallow perspective lines (10–30°) are not sampled yet.
- No human-visibility threshold study. The 8 px at 4032 target is my inference.
- Only one portrait fixture for 瘦臉, and its hair hides the background. A short-hair or tied-hair portrait is needed to measure the worst case directly.

---

## Q2. Candidate techniques: cost, fit, and expected gain

### Takeaway
Ranked by value per effort: **(1)** a local membrane (harmonic) relaxation of the ring on the existing 256 grid. It is cheap (2–38 ms V8), cuts p99 ring stretch by 35–60 % and raises min det, but does little for bends. **(2)** A mask-limited 瘦臉. **(3)** Line detection used to *cap gains* at T-junctions and to add line constraints in the local solve (15–55 % bend reduction with perfect detection). **(4)** Layered "rigid background + fill" as the only real fix for T-junction bends. It has a large effort and memory cost and belongs to the editor/export path only. A global line-constrained mesh solve is too slow in JS on a 256 grid (1.7–7 s) and spreads motion into the far background. Depth models are not worth it: a new runtime, 19–99 MB of weights, and they address the wrong problem. tasks-vision 0.10.35 already ships ImageSegmenter (selfie 249 KB, hair 782 KB, multiclass 16.4 MB, DeepLab-v3 2.8 MB) and InteractiveSegmenter (MagicTouch 6.2 MB), so better masks need no new runtime.

### Cited Findings
**A. Line-constrained least-squares solve on the field grid** (prototype in scratch `solve.ts`: matrix-free Jacobi-preconditioned CG on the 171×256 grid. Unknowns are the background texels near moving texels; person texels are fixed to the current field. Energy = membrane + α·|E − D|² + λ·Σ (n·ΔE)² over consecutive samples along the oracle-"detected" lines of the synthetic room: door frames, wall pin-stripes, horizontal rules, baseboard, floor diagonals. A fold guard blends back toward the original until det ≥ 0.35.)

| case (synth) | variant | V8 ms | unknowns | min det | max stretch | vertical-stripe bend (px at 4032) |
|---|---|---|---|---|---|---|
| 瘦身+細腰 | current | — | — | 0.60 | 66.6 % | 42.9 |
| | membrane only (α 0.02) | 38 | 11,212 | 0.69 | 46.4 % | 35.7 |
| | straight-line λ 30 | 106–139 | 11,212 | 0.69 | 46.4 % | 35.7 |
| | rigid-line λ 300 (guard t = 0.5) | 87 | 11,212 | 0.35 | 198 % | 37.8 |
| | **global** domain, straight λ 300 | **5,252** | 69,188 | 0.69 | 46.4 % | 33.6 (door frames 0 → 4.8, far background moves 3.2) |
| | **global**, rigid λ 300 | 1,971 | 69,188 | 0.35 | 202 % | 30.6 |
| 瘦身+細腰 armsdown | current / rigid λ 300 local / rigid global | 0 / 62 / 1,878 | | 0.50 / 0.58 / 0.63 | 100 / 71 / 59 % | 19.3 / 9.3 / 8.7 |
| 小頭 | current / straight λ 30 | 0 / 37–43 | 4,098 | 0.63 / 0.66 | 69 / 40 % | vertical 14.4 / 11.6, **horizontal 24.4 / 24.5** |
| 瘦手臂 | current / membrane | 0 / 5 | 3,156 | 0.50 / 0.67 | 101 / 46 % | 25.8 / 25.0 |

— scratch `solve.ts` (lineSolveRuns, globalRuns, membraneRuns; `out_lineSolveRuns.json`, `out_globalRuns.json`, `out_membraneRuns.json`)
- **Membrane-only relaxation across all four scenes** (α 0.02, local domain, V8 2–38 ms). Max stretch: 瘦手臂 100.6 → 46.1 % (synth), 105 → 43 % (pose_fullbody), 72.9 → 21.5 % (yoga); 瘦腿 77 → 48 % (synth), 40.6 → 22.1 % (pose_fullbody); 小頭 69 → 40 %; all local sliders 155 → 64 % with min det 0.39 → 0.58. The ring extent grows 1.4–2× (for example 68 → 135 px for 瘦手臂). **Regression:** pose_fullbody 瘦身+細腰 got worse (max stretch 88 → 147 %, min det 0.50 → 0.43). A narrow arm–torso gap has both sides pinned to different motions, so this needs gap-aware boundaries. With α 0.2 it stays at 96 % and 0.50. — scratch `solve.ts` membraneRuns
- For comparison, a published mesh method with a line term: the wide-angle face-correction follow-up to Shih et al. uses a 33×25 mesh, LSD-detected lines with a line energy weight λ_l = 64, and SciPy LSMR. Mesh optimisation takes 642 ms of an 841 ms frame (1024×768) on a desktop Xeon W-2135 CPU, unoptimised. — [Lai et al., arXiv 2111.09950](https://ar5iv.labs.arxiv.org/html/2111.09950). Shih et al. 2019 say only that the method runs "at an interactive rate on the mobile platform". I found no per-stage Pixel 3 timing. — [Shih et al. project page / search summary](https://people.csail.mit.edu/yichangshih/wide_angle_portrait)

**B. Per-line local correction and reducing gains where lines are detected.** The prototype shows why a pure field-side correction is capped. For lines that touch a silhouette moving perpendicular to them, forcing n·D = 0 pushes the whole stretch into the texel next to the silhouette. The fold guard then rejects about 50 % of the correction (guard t = 0.50–0.62, stretch about 200 %). For lines that do not touch the silhouette, or whose junction motion is tangential (horizontal lines beside a vertical waist: bend only 0–5 px today), little correction is needed. — scratch `solve.ts`. Capping the per-side k at a station where a detected line meets the silhouette reduces the bend in proportion (bend ≈ Δ⊥). That makes it the only field-side lever that reliably meets a fixed bend budget, at the cost of locally weaker slimming. This is my inference from the measured bend ≈ Δ relation (Q1).

**C. Line detection on device.**
- OpenCV's LSD implementation was removed from 3.4.6–3.4.15 and 4.1.0–4.5.3 "due original code license conflict". It was restored in 4.5.4+ after an MIT-licensed NFA reimplementation. — [OpenCV 4.13 LineSegmentDetector docs (via search summary)](https://docs.opencv.org/4.13.0/javadoc/org/opencv/imgproc/LineSegmentDetector.html). The original LSD C source is AGPL-3, as wrapped by a CRAN package. — [CRAN image.LineSegmentDetector](https://archive.linux.duke.edu/cran/web/packages/image.LineSegmentDetector/index.html) (secondary; verify before copying any code).
- A default opencv.js build is about 8–9 MB. Custom builds with unused modules and functions stripped get to about 3–4 MB, and `--disable_single_file` gives a separate .wasm. — [OpenCV.js build docs](https://docs.opencv.org/4.x/d4/da1/tutorial_js_setup.html); [webml-polyfill #1348](https://github.com/intel/webml-polyfill/issues/1348); [OpenCV Q&A](https://answers.opencv.org/question/209264/opencvjs-smaller-package/)
- M-LSD (learned, NAVER) runs at 56.8 FPS (Android) and 48.6 FPS (iPhone) natively, at "2.5 % of model size" of TP-LSD-Lite. Code is Apache-2.0, TFLite models are provided, and the weights' licence is not stated. — [arXiv 2106.00186](https://arxiv.org/abs/2106.00186); [GitHub navervision/mlsd](https://github.com/navervision/mlsd). tasks-vision has no generic TFLite runner. Its exports are DrawingUtils, FaceDetector, FaceLandmarker, GestureRecognizer, HandLandmarker, HolisticLandmarker, ImageClassifier, ImageEmbedder, ImageSegmenter, InteractiveSegmenter, ObjectDetector and PoseLandmarker. Running M-LSD would therefore need a new runtime. — [node_modules/@mediapipe/tasks-vision/vision.d.ts (0.10.35)](../../node_modules/@mediapipe/tasks-vision/vision.d.ts)

**D. Better masks and matting from tasks-vision 0.10.35 (no new runtime).**

| model (ImageSegmenter unless noted) | input | bytes (GCS HEAD, 2026-10-08) | classes | Pixel latency CPU / GPU | licence |
|---|---|---|---|---|---|
| selfie_segmenter (f16) | 256×256 | 249,537 | background, person | 33.5 / 35.2 ms (Pixel 6) | model card linked; Apache-2.0 not verified here |
| hair_segmenter (f32) | 512×512 | 781,618 | background, hair | 57.9 / 52.1 ms | model card linked |
| selfie_multiclass_256x256 (f32) | 256×256 | 16,371,837 | background, hair, body-skin, face-skin, clothes, others | 217.8 / 71.2 ms | **Apache-2.0** (model card) |
| deeplab_v3 (f32) | 257×257 | 2,780,176 | PASCAL classes incl. person | 123.9 / 103.3 ms | TF Hub reference |
| InteractiveSegmenter MagicTouch | 768×768 (page says int8; the GCS path is float32) | 6,227,884 | object at a tap or scribble ROI | 208.2 / 580.6 ms (Pixel 10) | not stated |

— [MediaPipe Image Segmenter](https://developers.google.com/edge/mediapipe/solutions/vision/image_segmenter); [MediaPipe Interactive Segmenter](https://developers.google.com/edge/mediapipe/solutions/vision/interactive_segmenter); sizes from HTTP HEAD on `storage.googleapis.com/mediapipe-models/...`; tasks-vision exposes `scribble?: NormalizedKeypoint[]` as the interactive ROI ([vision.d.ts L2650–2651](../../node_modules/@mediapipe/tasks-vision/vision.d.ts))
- The multiclass model card says it is a Vision Transformer with a customised decoder. It supports "single or multiple people … selfies and full body images" and lists 256 and 512 inputs. Its stated limitation is that it "may not provide pixel perfect masks". It is "LICENSED UNDER Apache License, Version 2.0", dated May 10, 2023. — [Model Card Multiclass Segmentation (PDF)](https://storage.googleapis.com/mediapipe-assets/Model%20Card%20Multiclass%20Segmentation.pdf)
- Edge refinement without a model: the Fast Guided Filter runs in O(N/s²) instead of O(N) for subsampling ratio s, ">10x with almost no visible degradation". It is built from box filters, so it fits WebGL2 fragment passes. — [He & Sun, arXiv 1505.00996](https://arxiv.org/abs/1505.00996)
- The repo already found that tasks-vision 0.10.35 aborts on CPU delegate plus segmentation masks for PoseLandmarker ("Check failed: 1 == ChannelSize()"), and that GPU masks read in the callback come back zero. ImageSegmenter has not been probed. — [bodyTracker.ts header L7–15](../../src/tracking/bodyTracker.ts)

**E. Layered "rigid background + fill" in the engine.**
- Still and capture processing runs at source size, capped at maxSize = 4096 on the long edge. One extra RGBA8 texture at 4096×3072 is about 50 MB and an R8 alpha is about 12.6 MB. — [uniforms.ts processingSize](../../src/engine/uniforms.ts); [engine/index.ts maxSize = 4096](../../src/engine/index.ts)
- The band to synthesise is the original person area not covered by the warped person. Its width is about Δ (measured background displacement next to the silhouette: 41–86 px at 4032 for 瘦身+細腰, 8–29 px for 瘦手臂, 16–39 px for 瘦腿), plus the mask's uncertainty: the stored mask is 256 long edge, so 1 texel ≈ 16 px at 4096. — scratch `exp.ts` (maxBgDispPx); [bodyTracker.ts MASK_LONG_EDGE](../../src/tracking/bodyTracker.ts)
- Learned inpainting needs a new runtime. MI-GAN code is MIT, the weights fall under a separate LICENSE-WEIGHTS file (terms not read), and models exist at 256 and 512 with an ONNX pipeline. — [GitHub Picsart-AI-Research/MI-GAN](https://github.com/Picsart-AI-Research/MI-GAN). The ONNX Runtime Web wasm is 11.9 MB (CPU) to 23.8–27.8 MB (JSEP/WebGPU) uncompressed, and about 6 MB gzipped. — [web search summary of unpkg / onnxruntime discussions](https://github.com/microsoft/onnxruntime/discussions/24161)

**F. Depth-aware weighting.**
- Depth Anything V2 Small has 24.8M parameters and is **Apache-2.0**. Base, Large and Giant are CC-BY-NC-4.0. — [GitHub DepthAnything/Depth-Anything-V2](https://github.com/DepthAnything/Depth-Anything-V2)
- ONNX files (onnx-community/depth-anything-v2-small): fp32 99.1 MB, fp16 49.6 MB, int8/uint8/quantized 27.3 MB, q4 27.4 MB, bnb4 26.1 MB, q4f16 19.1 MB. — [HF API tree](https://huggingface.co/onnx-community/depth-anything-v2-small) (sizes via `huggingface.co/api/models/.../tree/main/onnx`)
- Apple's Core ML build (F16, 49.8 MB) runs in 31.1 ms on an iPhone 12 Pro Max and 33.9 ms on an iPhone 15 Pro Max on the Neural Engine. That is native only; Safari cannot use Core ML. — [HF apple/coreml-depth-anything-v2-small](https://huggingface.co/apple/coreml-depth-anything-v2-small)

### Inferences
**Cost and fit table (my estimates unless a cell cites a measurement above; ms at 256 field, V8):**

| candidate | where it plugs in | effort | CPU / GPU cost | memory | download | licence | expected visual gain |
|---|---|---|---|---|---|---|---|
| **Membrane ring relaxation** | new step in `localField` after the protect multiply and before `keepInFrame`; reuse MaskGrid's `inside`; guard via the existing bisection | 2–4 days | 2–38 ms measured (local PCG); run at 128 for drafts (about ¼) | +2 Float64 arrays of about 2×N (< 1 MB) | 0 | own code | **p99 stretch −35–60 %, min det up; bends −2–22 %**; needs gap handling (pose_fullbody regression) |
| **Mask-limited 瘦臉** | shader: tc = tc₀ + (tc_face − tc₀)·P(vUv), with P a 256-px protect texture on a free unit (as uBodyDisp); P from PersonMask if 美體 ran, else selfie_segmenter | 3–5 days | 1 extra texture fetch per pixel in the face box; segmenter about 33 ms/photo (Pixel 6 class) | 64 KB texture | 0 or 249 KB | Apache-2.0 (tasks-vision); selfie model card licence to verify | reach 48–60 % FW → about 15–20 % FW; near-cheek bend unchanged (same limit as the body) |
| **Line detection** (editor, commit only) | new `src/body/lines.ts` on a ≤ 1024 px luma copy; cache per photo like the measure | own LSD-style TS port 1–2 weeks; or opencv.js custom build (3–4 MB) | about 10–40 ms/photo in JS (unverified) | < 5 MB | 0 or 3–4 MB | own code / Apache-2.0 (OpenCV ≥ 4.5.4); **avoid original LSD AGPL code** | enables C and D |
| **Gain cap at T-junction lines** | per-side, per-station k clamp in `localTerms` (trunk kSide, capsule reach) where a detected line meets the silhouette | 3–5 days after detection | negligible | 0 | 0 | own | guaranteed bend ≤ budget (for example 8 px at 4032) on detected lines; slimming locally weaker or asymmetric |
| **Line-constrained local solve** | same as membrane, plus a λ term on detected lines | +3–5 days over membrane | 10–150 ms measured | small | 0 | own | 15–55 % bend reduction on free lines (oracle detection); none at T-junctions |
| Global mesh solve | whole-grid PCG | 1–2 weeks + multigrid | 1.7–7 s measured (naive) | 70k unknowns | 0 | own | ≤ 30–55 %; moves far background (breaks the `cornerMax == 0` invariant) — **reject** |
| **Layered rigid background + fill** | new compositing in P2 or a P2b pass: out = mix(fill(vUv), src(tc), α(tc)); refined α (fast guided filter of PersonMask + hair segmenter); push-pull fill + line continuation in the uncovered band | 3–6 weeks | about 10–20 full-res-equivalent GPU passes per export (guided filter + push-pull pyramid) (unverified ms) | **+50–60 MB at 4096²** unless scissored or tiled to the band | 0–0.8 MB (hair) | own / Apache-2.0 | **only fix for T-junction bends**; risk of halos and smeared texture when the fill is wrong |
| Better matte (multiclass) | ImageSegmenter, photo only | 1 week | about 218 ms CPU / 71 ms GPU (Pixel 6) | ViT activations (unmeasured) | 16.4 MB | Apache-2.0 | needed only for layering (hair, loose clothes) |
| Interactive "keep straight here" brush | InteractiveSegmenter scribble → rigid region in the solve | 1–2 weeks | 208 ms CPU (Pixel 10) | — | 6.2 MB | not stated | user-driven rescue for pillars and door frames |
| Depth weighting (Depth Anything V2 S / MiDaS) | new ORT-web runtime + model | 2+ weeks | ~unknown on Safari (CPU wasm slow; WebGPU only on Safari 26+) | 100+ MB peak (unverified) | 19–99 MB + 12–28 MB wasm | Apache-2.0 (Small) | small: depth does not tell which lines touch the silhouette; segmentation already separates person and background — **reject** |

- Depth weighting fails on fit: it adds a second runtime, its download is 2–10× the pose model, and its likely peak memory is near the 100–200 MB kill threshold. Its benefit (protect "far" more than "near" background) duplicates what the person mask already gives.
- The cheapest high-value line feature is not a solver. It is detection plus gain capping at junctions, plus honest UI ("背景有直線，已降低強度").

### Gaps
- MiDaS v2.1 small: licence, TFLite size and web runtime not researched (deprioritised after the Depth Anything assessment).
- Licence terms in the selfie and hair segmenter model cards were not extracted (only multiclass was). MI-GAN LICENSE-WEIGHTS was not read.
- Not probed: whether ImageSegmenter in 0.10.35 hits the same CPU-delegate mask abort as PoseLandmarker.
- No iPhone GPU timings for guided-filter or push-pull passes at 12 MP. JS LSD timing on iPhone not measured.
- The solve prototype used oracle lines and untuned weights (α, λ, IRLS, coarse-to-fine). Real-detector false positives (for example stripes on clothing near the edge) are not modelled.

---

## Q3. How to test it objectively

### Takeaway
Use the field itself as ground truth. Probe it with dense virtual straight lines (TLS residual, px at 4032) and with σ_min-based ring stretch. Both are deterministic and need no image analysis, so they can go into Vitest next to `field.test.ts` and into the B1 table. Add an image-based e2e check on a fixture with painted straight lines behind the real fullbody person, and keep the existing far-corner invariant.

### Cited Findings
- B1 already builds fields for every slider case on the synthetic figure (room / stripes / checker backgrounds with door frames, pin-stripes, a baseboard and diagonal floor seams) and on recorded fixtures. It writes before | after | grid PNGs and a table of minDet, maxDispPx and farBgDispPx. — [b1/render.ts](../../tests/harness/b1/render.ts); [synthetic.ts background()](../../src/body/synthetic.ts)
- `cpuWarp.ts` is the CPU reference of the shader's body sampling (bilinear field, clamp-to-edge), so a field-based metric matches what the engine shows. — [cpuWarp.ts](../../src/body/cpuWarp.ts)
- The e2e test uses real PoseLandmarker on SwiftShader with `fullbody.jpg`, compares frame grabs (`mad`, `maxDiff`), and asserts that the far corners are identical. — [body.spec.ts](../../tests/e2e/body.spec.ts)
- The scratch implementations of both metrics (virtual lines with forward fixed-point mapping and a TLS fit; 1/σ_min of the finite-difference Jacobian; gap mask by row scans) run all 14 cases on 4 scenes in about 9 s in Node. — scratch `exp.ts` (bodyRuns: "8.7 s" for two synthetic scenes)

### Inferences
**Metrics** (all px at a 4032 long edge; report per slider at maximum and for all-max):
1. `bendV / bendH / bendD45 / bendD30`: maximum TLS residual over virtual lines (spacing 4 px at 900). `bent4` is the count of lines with residual above 4 px. Restricting to points more than 2.5 field texels from the person isolates the junction effect.
2. `stretchMax / stretchP99`: 1/σ_min(J) − 1 over displaced background. `gapStretchMax` uses the row-scan gap mask.
3. `ringPx`: farthest background pixel displaced more than 0.5 px. `farMovePx`: maximum displacement beyond 15 % H (must stay 0 and keeps the e2e invariant).
4. `minDet`, and the draft-vs-commit pop: max |D128 − D256| over the background.
5. Face: displacement within 5 % FW outside the face oval, reach beyond the oval, and background bend, all in % FW.

**New synthetic scenes** (extend `syntheticFigure`'s `background()` kinds):
- `doorClose`: verticals at 0.25W, 0.5W, 1W and 2W outside the waist silhouette. This separates free lines from T-junctions.
- `tiles30`: floor seams at 30° and 60°.
- `blinds`: horizontal stripes behind the head, for 小頭 / 天鵝頸 / 直角肩.
- `brick`: horizontal courses with staggered verticals behind the legs, for 長腿 / 增高 ramps.
- A portrait variant with a wall right at the cheek, for 瘦臉 (synthetic face mask = oval, no hair).

**Real-photo e2e scene:** take `fullbody.jpg` and paint 1–2 px dark straight lines (vertical, horizontal, 30°, 45°) only on pixels where the recorded `pose_fullbody.json` mask is below 0.1. Save it as a new fixture. In e2e, after each slider at maximum, find each painted line in the rendered frame grab (darkest pixel per row or column in a ±20 px window around the original line), fit a line, and assert the maximum residual (scaled to 4032) under the phase's budget. Images with real people for extra tests must come from the user with consent (the repo has two full-body fixtures today).

**Integration:**
- Add the metric module as test-only code next to `cpuWarp.ts`, for example `src/body/straightness.ts`, mirroring `fixtures.node.ts`.
- Add the columns to the B1 `Row` and `console.table`, and add a "lines" overlay PNG: diagonal virtual lines drawn warped, like `gridOverlay`.
- Add Vitest ratchets in `field.test.ts`, for example "synth 瘦身+細腰: bendV ≤ baseline 46 px, stretchP99 ≤ baseline 59 %; after Phase 1, stretchP99 ≤ 40 %, minDet ≥ 0.5".
- Keep each metric run under about 1 s per case by evaluating at 600×900.

### Gaps
- No ground truth on real photos for *which* lines users care about. An LSD-based before/after matcher would be needed to score arbitrary photos; it is not prototyped.
- The perceptual budget (8 px at 4032) is unvalidated.

---

## Q4. Phased recommendation with acceptance criteria

### Takeaway
Build measurement first. Then, with no new models, add ring relaxation and a mask-limited 瘦臉. Then add on-device line detection used to cap gains at T-junctions, with soft line constraints in the same local solve. Leave layered "rigid background + fill" as an editor-only, export-time phase with an explicit memory budget. Do not pursue depth models or a global mesh solve.

### Cited Findings
- Baselines, the feather sweep, solve costs and the face reach are as measured in Q1 and Q2. — scratch `exp.ts`, `solve.ts` outputs listed above
- The earlier plan already slots "線段偵測加網格最小平方的直線保護" and "push-pull 細縫填補" into P3 "品質", with the acceptance criterion "有直線背景的測試集明顯改善". — [reports/全身美體修圖 PWA 實作.md, P3 row](../../reports/全身美體修圖%20PWA%20實作.md)

### Inferences
**Phase 0 — Measurement (2–3 days).** Add the Q3 metrics to B1 and Vitest, add the new synthetic scenes, and add the painted-lines e2e fixture. Record the baselines from this note as ratchets.
*Accept:* the metrics reproduce the Q1 numbers within ±5 % (for example synth 瘦身+細腰 bendV 46 px, stretchMax 66.6 %, ring 210 px; pose_fullbody 瘦手臂 stretchMax 105 %); `npm test` adds under 10 s.

**Phase 1 — Quick wins, no new models (1–1.5 weeks).**
1. *Ring relaxation:* local membrane PCG on the 256 grid at commit and the 128 grid for drafts. Person texels fixed; α ≈ 0.05–0.2. Narrow gaps (gap < 2W from the measure's reach data) are handled by keeping the original field there or pinning the gap's medial axis. The existing fold-guard bisection runs on the blend.
   *Accept* on all scenes: stretchP99 ≤ 0.6 × baseline; stretchMax ≤ 70 % for single sliders (today up to 105 %); minDet ≥ max(baseline, 0.45); no bend increase above 1 px; `farMovePx` = 0 (e2e `cornerMax == 0` still passes); extra cost ≤ 25 ms at 256 for 瘦身+細腰 in V8 (the prototype took 13–38 ms with 400-iteration PCG; warm-start or multigrid should cut it) and ≤ 40 ms for all-max; ≤ 6 ms at 128.
2. *瘦臉 background limit:* protect texture P on the contour warps only (slim / V / narrow / chin / forehead; eyes, nose and mouth untouched). The source is PersonMask when available, otherwise selfie_segmenter (249 KB, editor only, loaded on first 瘦臉 use; its runtime is already shipped). The camera stays as today.
   *Accept* on the cheek-wall portrait: reach beyond the person silhouette at slim+V+narrow maximum ≤ 15 % FW (today about 48–60 % FW beyond the oval when no hair shields it); face-interior displacement within 2 % of today's; no new console errors; the offline engine is unaffected when the model is missing (fall back to today's warp).
3. *Honest 背景保護:* use a per-part Δ (each primitive's own silhouette displacement) instead of the global maximum, or relabel the toggle. *Accept:* with 背景保護 on, ring extent is at most 0.8 × off in every B1 case (today 0.69–0.95 for 瘦身+細腰: synth 210/281, armsdown 157/228, yoga 148/189, pose_fullbody 300/316).

**Phase 2 — Line-aware 美體 (2–3 weeks, editor only, commit-time).** Line detection on a ≤ 1024 px luma copy: an own LSD-style TS port, or an opencv.js custom build (3–4 MB) — **not** the AGPL original. Results are cached with the measure. Lines inside a person's dilated mask are dropped (clothing stripes). Then:
- (a) *T-junction gain cap:* for each detected line that meets the silhouette where the local motion is perpendicular to it, clamp that side's k at that station so the predicted bend Δ⊥ ≤ budget. A per-side clamp with smooth blending along t keeps det J bounds intact, because R(t) and k(t) variations along the bone are fold-free by construction.
- (b) *Free lines:* add the straight-line λ term to the Phase 1 solve.
- Show a small note when the cap engaged.

*Accept:* on the painted-lines fixture and the `doorClose` / `tiles30` scenes at single-slider maximum, every detected line has bend ≤ 8 px at 4032 (today 26–78 px). Visible slimming (B1 maxDispPx inside the person) is lost only on capped stations, and the overall torso mad in e2e stays > 0.5. Detection plus solve ≤ 150 ms V8 at commit, with no new work per drag frame (drafts reuse the last caps). Line detection costs at most +5 MB of peak memory.

**Phase 3 — Layered rigid background + fill (3–6 weeks, export path first, optional).** Matte: PersonMask upsampled and refined with a fast guided filter (WebGL2 box-filter passes) plus hair_segmenter (782 KB) around the head. Compose the warped person over an *unwarped* background. Fill the uncovered band (Δ + about 2 mask texels) with push-pull, plus continuation of detected lines across it. Fall back to the continuous warp (Phases 1–2) where the band crosses texture the fill cannot handle (high gradient energy) or the matte confidence is low. Restrict the work to a scissored band or tiles so peak extra memory stays ≤ 20 MB at 4096².
*Accept:* T-junction lines in the painted-lines fixture bend ≤ 2 px at 4032; in the band, no halo (luminance step at the old silhouette ≤ 3 levels mean on the synthetic scenes); export peak memory increase ≤ 20 MB (Web Inspector on an SE-class device); export time increase ≤ 300 ms at 12 MP; manual review on 10 user-provided real photos.

**Not recommended now:** depth-aware weighting (new runtime, 19–99 MB weights, little benefit for lines); a global mesh solve (1.7–7 s V8 at 256, moves the far background); the multiclass segmenter (16.4 MB) unless Phase 3 shows the hair or clothes matte is the bottleneck; changing the 長腿 / 增高 bands (verticals and horizontals are already exact). The band diagonal kinks (25–54 px) are best handled by Phase 2's gain cap or a wider ramp r when a diagonal is detected near the hip or ankle row.

### Gaps
- Phase 2(a)'s claim that a per-side, per-station k clamp keeps the fold bound rests on prims.ts's argument for R(t) and k·a(t) variation, which is a bound on det J. Its interaction with the protect multiply and the new membrane step has to be re-verified numerically (`fieldMinJacobian`) in tests.
- Phase 3 memory and time budgets are targets, not measurements.
- All V8 timings come from the dev PC. The iPhone Safari JavaScriptCore factor is unknown and should be measured with the existing bench page before the budgets are fixed.
