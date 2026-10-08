# Full-body retouching (美體) for MonaLisa 美顏: open-source landscape and codebase integration

Research date: 2026-10-07. Codebase state: branch `feat/meiyan-pwa`, commit 25d1768. Codebase facts below come from reading the files directly (local paths are cited as sources). Web facts are cited inline. Items marked UNVERIFIED or "inference" are not established facts.

## 1. Which open-source body-reshaping projects exist, and what can be reused (licence, tech, real-time, quality)?

### Takeaway
No permissively licensed project does pose-driven body slimming in real time on the web. The learned-flow research code (FBBR CVPR 2022, AAGN WACV 2025) is non-commercial or unlicensed PyTorch and cannot be shipped. The diffusion methods (Odo, DiffBody) need large GPUs. What we can reuse is techniques and permissive building blocks: MediaPipe PoseLandmarker (Apache-2.0, already in the pinned 0.10.35), MLS deformation math (MIT reference code), band-stretch 長腿 tutorials, and the "low-res flow field upsampled to full res" idea from FBBR. The warp itself should be our own code, in the style of the existing GPUPixel-derived reshape shader.

### Cited Findings
**Learned / research methods (not shippable)**
- **FlowBasedBodyReshaping (FBBR), "Structure-Aware Flow Generation for Human Body Reshaping", CVPR 2022, Alibaba DAMO Academy.**
  - Licence: "© Alibaba, 2022. For academic and non-commercial use only." About 183 stars.
  - Python ≥3.6, torch ≥1.2, numba. Needs pytorch-openpose's `body_pose_model.pth` as the pose estimator.
  - [GitHub](https://github.com/JianqiangRen/FlowBasedBodyReshaping)
- FBBR code and model were released 2022-09-28 (older than the 2024–2026 window). The method uses skeletons and Part Affinity Fields to guide a flow generator. For 4K images it predicts flow on a downscaled image and applies the upsampled flow to the original. [Search summary of the repo and paper](https://arxiv.org/abs/2203.04670)
- The BR-5K dataset (5,000 2K portraits from Unsplash, with professional retouched targets) is restricted: you must sign an agreement form and email it from a work address. The authors note that "misuse of the dataset may lead to ethical concerns". [GitHub](https://github.com/JianqiangRen/FlowBasedBodyReshaping)
- **AAGN, "Structure-Aware Human Body Reshaping with Adaptive Affinity-Graph Network", WACV 2025** (arXiv 2404.13983, v1 Apr 2024, revised Jan 2025).
  - Pipeline: skeleton, then affinity graph, then optical flow, then warp.
  - On BR-5K it reports PSNR 26.41 / LPIPS 0.0643, against FBBR's 24.79 / 0.0777.
  - [arXiv](https://arxiv.org/abs/2404.13983)
- AAGN code ([Randle-Github/AGGN](https://github.com/Randle-Github/AGGN)):
  - No licence file shown, so all rights are reserved by default.
  - About 17 stars. PyTorch plus MMPose / OpenMMLab detection and pose models.
  - Requires BR-5K. No speed figures.
- **Odo, "Depth-Guided Diffusion for Identity-Preserving Body Reshaping"** (arXiv 2508.13065, Aug 2025, listed as WACV 2026).
  - Pipeline: estimate SMPL, render a target depth map, then a diffusion ReshapeNet.
  - About 23 GB GPU memory and 18 s per image.
  - Code is "coming soon".
  - [arXiv](https://arxiv.org/pdf/2508.13065); [project](https://research.fastcode.ai/odo)
- **DiffBody** (WACV 2024, arXiv 2401.02804) is diffusion-based pose and shape editing, so it is slow and not on-device. [arXiv](https://arxiv.org/pdf/2401.02804)
- **Older classical work (flagged as old):** Zhou et al., "Parametric Reshaping of Human Bodies in Images" (ACM TOG 2010) fits a 3D morphable body and gives real-time slider feedback. Richter et al., "Real-time reshaping of humans" (3DIMPVT 2012). [ResearchGate](https://www.researchgate.net/publication/220184574_Parametric_Reshaping_of_Human_Bodies_in_Images)
- A curated list ("Human Body Reshaping" section) is in [weihaox/awesome-digital-human](https://github.com/weihaox/awesome-digital-human).

**Deformation building blocks (reusable as math or reference)**
- **cxcxcxcx/imgwarp-opencv:**
  - MIT, C++ / OpenCV, about 320 stars, 99 forks, 8 commits.
  - Implements MLS (for sparse control points) and piecewise-affine warping (for dense points), after Schaefer et al., SIGGRAPH 2006.
  - Has a JS demo at chenxing.name/fun/imgwarp-js; whether it renders with canvas or WebGL is not documented.
  - [GitHub](https://github.com/cxcxcxcx/imgwarp-opencv)
- **Jarvis73/Moving-Least-Squares:**
  - NumPy / PyTorch implementation of affine, similarity and rigid MLS. About 364 stars, 70 forks. Licence not confirmed in this pass.
  - **whpointz/MLSImage** (C++/OpenGL) computes MLS only at grid vertices and draws the image as a textured mesh. That is the approach that ports directly to WebGL.
  - **PooneetThaper/ImageDeformation** (MIT, Python) takes about 30 s per deformation, so it is not live.
  - [MLS search results](https://github.com/Jarvis73/Moving-Least-Squares); [whpointz/MLSImage](https://github.com/whpointz/MLSImage); [PooneetThaper](https://github.com/PooneetThaper/ImageDeformation)
- **ctbot000/face-beautifier:**
  - MIT. WebGL2 plus MediaPipe FaceLandmarker in the browser. Face only, no body. A brand-new repo (0 stars).
  - Smooths landmarks with a One Euro filter before they drive warps, because raw jitter of 1–2 px is very visible in geometric warps.
  - Uses the falloff `1.0 - t*t*(3.0-2.0*t)`, which is monotone (no fold) up to a displacement of 0.45× the handle radius. The author says Gustafsson's textbook falloff folds slightly and leaves rings.
  - [GitHub](https://github.com/ctbot000/face-beautifier)
- **Band-stretch 長腿 / 瘦身 tutorial (字節流動, CSDN).**
  - OpenGL ES texture-coordinate remapping with bilinear sampling. The image is split into strips (MFSpringView: 6 triangles) and only the middle rectangle is stretched or compressed.
  - No licence is stated. The page header shows 2026-07-18, but the article id (104546234) suggests an original post from about 2020 (inference).
  - [CSDN](https://blog.csdn.net/Kennethdroid/article/details/104546234); [Zhihu companion](https://zhuanlan.zhihu.com/p/111951761)

**Commercial SDKs (feature taxonomy only; no code or assets, matching the spec's PixelFree rule)**
- **PixelFree 美體 list:** 瘦身、瘦肚子、瘦腰、沙漏腰、曲線、全身瘦、提跨、豐臀、豐胸、長腿、天鵝頸、瘦肩膀、直角肩、手臂（整體）、左/右大臂與左/右小臂、左/右大腿與左/右小腿.
  - Parameters are `PFBodyBeautyType`, "默认 0.5 中性，范围 0~1".
  - The GitHub repo footer says MIT, but the SDK itself is a commercial binary.
  - Platforms: iOS, Android, HarmonyOS, Windows, macOS, Linux, Flutter. No Web/H5.
  - [GitHub](https://github.com/uu-code007/PixelFreeEffects)
- **Alibaba Cloud beauty SDK (commercial):** 8 body adjustments (瘦身、長腿、小頭、瘦腿、豐胸、手臂、脖子、瘦腰), driven by real-time detection of 18 body keypoints. [Aliyun help](https://help.aliyun.com/document_detail/211049.html)
- A web search for an open-source real-time 美體 camera project on GitHub found none. The practical pattern is MediaPipe Pose keypoints passed into a shader-based local warp. [Search summary](https://blog.csdn.net/Kennethdroid/article/details/104546234)

**Keypoint and mask sources (shippable)**
- **MediaPipe PoseLandmarker:**
  - 33 landmarks: nose 0, eyes 1–6, ears 7–8, mouth 9–10, shoulders 11/12, elbows 13/14, wrists 15/16, hand points 17–22, hips 23/24, knees 25/26, ankles 27/28, heels 29/30, foot index 31/32.
  - Pose detector input 224×224, landmarker input 256×256, float16.
  - Options: `num_poses` (default 1), `min_pose_detection_confidence`, `min_pose_presence_confidence`, `min_tracking_confidence` (all 0.5), `output_segmentation_masks` (default false).
  - Running modes: IMAGE, VIDEO, LIVE_STREAM.
  - [MediaPipe docs](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker)
- The pinned `@mediapipe/tasks-vision` 0.10.35 (Apache-2.0) already has `PoseLandmarker`, `PoseLandmarkerOptions.outputSegmentationMasks`, `PoseLandmarkerResult.segmentationMasks: MPMask[]` and `HolisticLandmarker`. No upgrade to the telemetry-bearing 1.x is needed. [node_modules/@mediapipe/tasks-vision/vision.d.ts](D:/GitSource/MonaLisa/node_modules/@mediapipe/tasks-vision/vision.d.ts) (lines 1032, 2387–2628)

### Inferences
- Nothing learned can be shipped:
  - FBBR is non-commercial.
  - AAGN has no licence.
  - Odo is not released and is far too large.
  - BR-5K is gated, and training our own flow net would need it or an equivalent.
  - So 美體 must be rule-based geometric warping driven by pose keypoints, optionally refined by a person mask. This is consistent with how the commercial SDKs (Aliyun: keypoint-driven) describe it.
- **Reusable ideas, ranked by value:**
  1. FBBR's "predict a low-res flow, upsample, warp the full-res image" becomes our data contract: a low-res backward displacement texture (see §2). It lets rule-based warps, MLS and a future learned model all plug into the same pass.
  2. MLS rigid deformation on a coarse grid (whpointz approach, imgwarp-opencv as MIT reference), for P3 mask-aware or manual 液化.
  3. Band-stretch for 長腿.
  4. One Euro smoothing plus smoothstep falloff (face-beautifier, MIT) for live stability.
- PixelFree's taxonomy maps well onto MediaPipe's 33 points. Arms and legs split per segment (大臂/小臂/大腿/小腿) match the landmark pairs 11–13–15 and 23–25–27. 腰 and 肚子 have no landmark and must be interpolated.

### Gaps
- Licence of Jarvis73/Moving-Least-Squares and whpointz/MLSImage not checked.
- Not checked whether GPUPixel (pinned ef552bf) or CainCamera contain any body filter. The search summary only says GPUPixel's description lists face features.
- No open-source mobile-web 美體 demo with measured iPhone performance was found.
- FBBR inference speed and resolution are not documented in its README.

## 2. How should a body warp be integrated into THIS codebase (placement, landmark transform, PoseLandmarker, contracts, UI, photo-first)?

### Takeaway
Do not add a separate body pass. Compose the body warp into the existing P2 reshape pass as the outermost op of a single backward map: `tc = vUv + bodyDisp(vUv)`, then the existing face chain, then one `texture()` fetch. This order (forward: Body ∘ Face) means face landmarks need no transformation at all. The face warp is exactly identity outside `uBox`, so pose anchors on the shoulders, hips and legs are unaffected. The makeup pass, skin mask and `maskWarp` stay consistent for free. Pass the body warp as a CPU-built low-res RG16F displacement texture, not as more uniforms. Add PoseLandmarker as a second, lazily created, never-recreated-per-photo instance that shares the FilesetResolver result. Ship photo-editor-only first.

### Cited Findings
**Current pipeline and warp, from the code**
- Pass order: `[P0 mask → R8 ¼-res M] → [P1 makeup → A] → [P2 reshape → B (+ mask M → N)] → P3 meanH → C → P4 meanV → D → P5 composite`. Face passes are built lazily. [src/engine/pipeline.ts](D:/GitSource/MonaLisa/src/engine/pipeline.ts) lines 1–4
- Reshape runs only when a face is present: `reshape: faceOn && i.reshapeActive` in `planPasses`. `reshapeUniforms(values, faceWeight)` is computed only when `faceOn`. [pipeline.ts](D:/GitSource/MonaLisa/src/engine/pipeline.ts) lines 92–101, 210–223
- The mask is pushed through the same backward map ("or 瘦臉/V臉 leave background inside the mask where the jaw moved in"): `reshape.draw(maskTex, n, face, ru, job.size.width / job.size.height)`. [pipeline.ts](D:/GitSource/MonaLisa/src/engine/pipeline.ts) lines 250–258
- The reshape shader is one backward-warp pass:
  - `tc = vUv`, chained `curveWarp` / `scaleAround` / `shiftAround` / `enlargeEye`, then `texture(uSrc, tc)`.
  - Everything is gated by `uBox`. The code states that "a coordinate outside all discs is never moved, so skipping it is exact".
  - [src/engine/passes/reshape.ts](D:/GitSource/MonaLisa/src/engine/passes/reshape.ts) lines 148–149, 230–258
- The primitives already exist: `scaleAround` ("Bidirectional scale; monotonic (no fold) for |d| <= 0.5") and `shiftAround` ("Local translate… smoothly fading to 0 at R"). [reshape.ts](D:/GitSource/MonaLisa/src/engine/passes/reshape.ts) lines 211–222
- `draw()` multiplies every `ReshapeUniforms` field by `yawAttenuation(face.yaw)`. The signature requires a non-null `Face`. [reshape.ts](D:/GitSource/MonaLisa/src/engine/passes/reshape.ts) lines 266, 276–281
- Shader uniform load today: `uniform vec2 uPts[111]; uniform vec2 uExt[8]; … uVT[6]; uNT[4]` plus scalars. The research brief notes the GLES3 minimum is 224 fragment uniform vectors ("from memory, not re-fetched"). [reshape.ts](D:/GitSource/MonaLisa/src/engine/passes/reshape.ts) lines 177–192; [research brief](D:/GitSource/MonaLisa/docs/superpowers/specs/2026-10-07-meiyan-research-brief.md) line 64

**Contracts, from the code**
- `ParamGroup = 'skin' | 'shape' | 'filter' | 'makeup'`. `ParamId` is a closed union, and `PresetDef.values` / `BeautyParams.values` are `Record<ParamId, number>`. [src/types.ts](D:/GitSource/MonaLisa/src/types.ts) lines 6–24, 45, 68
- `Face` is normalized, top-left origin (= texture UV), on the UNMIRRORED frame. `RenderInput` carries `face` and `faceWeight` only. [types.ts](D:/GitSource/MonaLisa/src/types.ts) lines 87–101, 153–162
- `sanitizeParams` starts from `defaultParams()` and overwrites only the keys present. Old localStorage and IndexedDB params without new keys therefore back-fill defaults. A stored `presetId` survives only if `matchesPreset` still holds over all `PARAM_DEFS`. [src/engine/params.ts](D:/GitSource/MonaLisa/src/engine/params.ts) lines 227–252
- Panel tabs: `TabId = 'preset' | 'skin' | 'shape' | 'filter' | 'makeup'`, labels 一鍵 · 美膚 · 美型 · 濾鏡 · 美妝. Reset is per group (`resetGroup(params, sel.tab)`). [src/ui/panelModel.ts](D:/GitSource/MonaLisa/src/ui/panelModel.ts) lines 20–28, 203
- The spec lists body reshaping as explicitly "Out of v1". [design spec](D:/GitSource/MonaLisa/docs/superpowers/specs/2026-10-07-meiyan-pwa-design.md) §3

**Tracker and editor, from the code**
- One FaceLandmarker instance serves VIDEO and IMAGE: "WebKit leaks memory when instances are created/closed per photo (MPI 5036)". Each instance gets its own `new OffscreenCanvas(1,1)`, and GPU context loss is watched on it. [src/tracking/tracker.ts](D:/GitSource/MonaLisa/src/tracking/tracker.ts) lines 3–5, 108–142
- `createTracker` calls `FilesetResolver.forVisionTasks(opts.wasmBase)` once per tracker. Self-healing (in-place rebuild, then replacement with backoff, GPU→CPU) is private to this module. [tracker.ts](D:/GitSource/MonaLisa/src/tracking/tracker.ts) lines 174–195
- The editor detects once per photo (`detectOnce` → `tracker.detectImage(bitmap)` → `adapt`). `faceWeight = face ? 1 : 0`. Renders are coalesced per rAF. [src/app/still.ts](D:/GitSource/MonaLisa/src/app/still.ts) lines 64–69, 245–259
- Model and wasm are self-hosted under versioned paths: `/mediapipe/0.10.35`, `/models/face_landmarker/float16-1/face_landmarker.task`. `scripts/fetch-assets.mjs` downloads the model once and checks its md5. [src/engine/assets.ts](D:/GitSource/MonaLisa/src/engine/assets.ts) lines 4–9; [scripts/fetch-assets.mjs](D:/GitSource/MonaLisa/scripts/fetch-assets.mjs) lines 15–19

**MediaPipe facts relevant to adding pose**
- Every `PoseLandmarker.createFromOptions(...)` "Initializes the Wasm runtime and creates a new `PoseLandmarker`". The `wasmFileset` is just a configuration object with the location of the binary and loader. [vision.d.ts](D:/GitSource/MonaLisa/node_modules/@mediapipe/tasks-vision/vision.d.ts) lines 2395–2405
- `FilesetResolver` only resolves paths (`{wasmLoaderPath, wasmBinaryPath}`), so sharing it does not share a runtime. Each task builds its own Emscripten module via `createMediaPipeLib`. Each task creation also appends another loader `<script>`. [task_runner.ts](https://github.com/google-ai-edge/mediapipe/blob/master/mediapipe/tasks/web/core/task_runner.ts); [MPI 5697](https://github.com/google-ai-edge/mediapipe/issues/5697)
- `MPMask.getAsWebGLTexture()`: "The returned texture is bound to the current canvas (see `.canvas`)", meaning MediaPipe's own context. `getAsFloat32Array()` is the CPU path. [vision.d.ts](D:/GitSource/MonaLisa/node_modules/@mediapipe/tasks-vision/vision.d.ts) lines 2125–2132, 2212–2222
- `PoseLandmarkerResult.close()` "Frees the resources held by the segmentation masks". [vision.d.ts](D:/GitSource/MonaLisa/node_modules/@mediapipe/tasks-vision/vision.d.ts) line 2628
- Known mask bugs:
  - PoseLandmarker masks were blank with the GPU delegate in 0.10.4 on Chrome, both via `getAsWebGLTexture` and `getAsFloat32Array`. CPU worked. The issue is closed. [MPI 4757](https://github.com/google-ai-edge/mediapipe/issues/4757)
  - On iOS 18.7.1 Safari with the GPU delegate, ImageSegmenter (selfie_multiclass_256x256) scrambles categories. CPU is correct. Open since 2025-11-09. [MPI 6142](https://github.com/google-ai-edge/mediapipe/issues/6142)
- **HolisticLandmarker** (one task: 478 face + 33 pose + hands) exists in 0.10.35. [vision.d.ts](D:/GitSource/MonaLisa/node_modules/@mediapipe/tasks-vision/vision.d.ts) line 1032. One user reports pose landmarks from `pose_landmarker_heavy.task` are "significantly more accurate" than Holistic's. [MPI 5569](https://github.com/google-ai-edge/mediapipe/issues/5569)
- **ImageSegmenter alternatives** (Pixel 6 CPU/GPU latency):
  - SelfieSegmenter 256×256, 2 classes: 33.46 / 35.15 ms.
  - SelfieMulticlass 256×256, 6 classes incl. body-skin and clothes: 217.76 / 71.24 ms.
  - [MediaPipe image segmenter](https://developers.google.com/edge/mediapipe/solutions/vision/image_segmenter)

### Inferences
**A. Pipeline placement: compose into P2 rather than add a pass (recommended)**

Derivation:
- Let F be the face backward chain (today's shader) and B the body backward map.
- The forward order "face first, then body" gives `I_out(o) = I(F(B(o)))`.
- In the shader: `vec2 tc = vUv + texture(uBodyDisp, vUv).xy;`, then the existing `if (inside uBox) { …face chain… }`, then `texture(uSrc, tc)`.

Consequences:
- **Face landmarks need no transform.** F still operates in original-image coordinates, exactly as today.
- **Pose anchors need no transform either.** B's anchors should strictly live in the face-warped image, but F is exactly identity outside `uBox`, so shoulder, hip, knee, ankle and arm landmarks are unchanged. Only head and neck anchors inside the face box are off by the face-warp displacement (≤10% of face size at max sliders). For 小頭 and 天鵝頸 this is negligible. If needed, forward-map those few points on the CPU with the same `reshapeGeometry` math.
- **Makeup stays correct.** It is drawn in original coordinates into A, before the warp.
- **Skin mask M stays correct.** `maskWarp` already re-runs the same pass, so it automatically follows the body warp.
- **One texture fetch, so no extra resampling blur.**
- **No new full-size FBO.** A separate pass at 2048×1536 RGBA8 would add one 12.6 MB buffer (per the brief's sizing) plus a second bilinear resample.

The rejected alternative (forward order body first, then face) would require forward-transforming all 111 + 8 + 36 face points through B every frame. It adds complexity and error for no visual benefit.

Required code changes:
- `planPasses` must allow `reshape: (faceOn && reshapeActive) || (bodyOn && bodyActive)`.
- `ReshapePass.draw` must accept `face: Face | null` plus a separate `BodyWarp` argument. Yaw attenuation must apply only to face uniforms, never to the body field.
- When the face is null, the shader's face block is skipped (zero uniforms already early-out per term; set `uBox` empty).

**B. Body warp data contract: a low-res backward displacement field**

The texture:
- `RG16F`, about 64×64 to 96×128, aspect-matched to the image.
- Each texel holds a UV-space backward displacement.
- Sampled with `LINEAR` (16F formats are filterable in GLES3/WebGL2 core; 32F needs `OES_texture_float_linear`. From spec knowledge, not re-fetched).

Why this shape:
- Zero extra fragment uniforms. Adding `uPose[33]` would push the shader toward the 224-vector minimum: each `vec2` array element typically occupies one vec4 slot, and `uPts[111]` alone takes about 111.
- It is the exact contract FBBR uses (low-res flow, upsampled).
- The CPU can build it with any algorithm (capsule or segment squeezes, band stretch, MLS, a mask-aware edge pull, a future 手動液化 brush) without touching GLSL.

Building and guarding it:
- Build on the CPU once per pose update. 64×64 is 4,096 texels; at about 20 ops per texel per warp term, a dozen terms is well under 1 ms of JS (estimate).
- Enforce fold-free output by clamping the field's Jacobian: |∂d/∂x| < about 0.5. This is the same idea as `scaleAround`'s "no fold for |d| ≤ 0.5".
- Add `bodyBox`-style early-out only if profiling demands it. A single bilinear fetch per pixel is cheap at 1080p.

**C. Per-slider warp recipes (MediaPipe indices)**

| Slider | Anchors | Warp |
|---|---|---|
| 瘦身 `body.slim` | torso axis from mid-shoulder (11, 12) to mid-hip (23, 24) | horizontal squeeze toward the axis, plus a light squeeze of thighs and arms |
| 細腰 `body.waist` | waist ≈ `lerp(midShoulder, midHip, ~0.62)`, no landmark | anisotropic squeeze across the torso; half-width from the person mask in P1, else ≈ 0.45 × hip width (23–24) |
| 美臀 / 腰臀比 `body.hip` (±) | outer hip contour beside 23 / 24 | outward push (mask edge needed for good results) |
| 長腿 `body.legs` | between hip line (23 / 24) and ankles (27 / 28) | 1-D vertical band stretch with C¹-smooth band edges (the 字節流動 / MFSpringView idea); see output-size note below |
| 瘦腿 `body.legSlim` | segments 23→25→27 and 24→26→28 | capsule squeeze |
| 瘦手臂 `body.arms` | segments 11→13→15 and 12→14→16 | capsule squeeze |
| 直角肩 / 美肩 `body.shoulder` | 11 / 12 | `shiftAround` up (直角肩) or inward (瘦肩) |
| 天鵝頸 `body.neck` | face menton `ext[4]` and shoulder line | vertical stretch, or shift the head up with falloff to the shoulders |
| 小頭 `body.head` | face-oval centroid, radius ≈ 1.3 × head radius; pose ears 7 / 8 as fallback | `scaleAround` |
| 胸部 | none recommended | defer (ethics, see §4) |

Output size for 長腿: processing size equals source size in still mode, and history stores width and height. So P1 should keep the size fixed. Stretch the [hip, ankle] band and compress the slack below the ankles and above the head. Disable the slider when there is no slack (feet at the bottom edge). Growing the image height (the 增高 style) would ripple into `processingSize`, `renderToImageData`, export and history, and is a separate decision.

**D. Pose detection beside FaceLandmarker**
- Add `src/tracking/bodyTracker.ts` (or generalise `tracker.ts`'s heal logic into a generic task healer). The rules:
  - One PoseLandmarker instance, created lazily the first time 美體 is used, and never created or closed per photo (MPI 5036).
  - Its own `OffscreenCanvas`.
  - Created after the face tracker, not in `Promise.all`.
  - Reuse the same `wasmBase` / `FilesetResolver` result.
- Pose landmarks are on unmirrored frames, the same space as `Face`. No conversion is needed: x,y normalized go straight to UV.
- Masks: use `getAsFloat32Array()` and upload into the engine's own context as an R8 or R16F texture at about ¼ resolution. `getAsWebGLTexture()` belongs to MediaPipe's context and cannot be sampled by our engine. Call `result.close()` right after copying.
- New asset: `/models/pose_landmarker/<variant>-float16-1/pose_landmarker_<variant>.task`, vendored and md5-pinned in `fetch-assets.mjs`. Downloaded on demand with the existing progress chip. Runtime CacheFirst is already configured for `/models/`.

**E. New contracts (sketch for `types.ts`)**
```ts
export type ParamGroup = 'skin' | 'shape' | 'body' | 'filter' | 'makeup';
// ParamId += 'body.slim' | 'body.waist' | 'body.hip' | 'body.legs' | 'body.legSlim'
//          | 'body.arms' | 'body.shoulder' | 'body.neck' | 'body.head'
export interface Body {
  /** MediaPipe 33 × (x, y), normalized, top-left, UNMIRRORED (same space as Face), length 66 */
  pts33: Float32Array;
  /** per-landmark min(visibility, presence), 0..1, length 33 */
  vis: Float32Array;
  /** which slider groups have reliable anchors (drives UI enable/disable and per-term weights) */
  regions: { head: boolean; shoulders: boolean; torso: boolean; arms: boolean; legs: boolean; feet: boolean };
  /** low-res person mask 0..255 (null when not requested / unavailable) */
  mask: { data: Uint8Array; width: number; height: number } | null;
  /** number of people detected (numPoses ≥ 2 in IMAGE mode, so >1 can be reported) */
  people: number;
}
// RenderInput += { body: Body | null; bodyWeight: number }   (eased like faceWeight)
// Engine-internal: BodyWarp = { field: Float32Array /* RG */, width, height } built by engine/passes/bodyWarp.ts
```
- Defaults for every `body.*` must be neutral. Then `matchesPreset` still holds for stored presets, and old history entries back-fill neutral via `sanitizeParams`.
- Keep body values out of 一鍵 presets (`refined` / `glow`), so 程度 never silently changes a body.
- `HistoryEntry` can cache `body` (66 + 33 floats, plus an optional 64 KB mask). Reopening an entry then renders without loading the pose model. Otherwise re-detect on reopen.

**F. UI**
- Add `{ id: 'body', label: '美體' }` after 美型: 一鍵 · 美膚 · 美型 · 美體 · 濾鏡 · 美妝. Six 2-character tabs fit a 375 pt width.
- The item strip reuses `PanelItem`, plus a new `disabled` / `reason` field. Example: 長腿 greyed with 「未偵測到雙腿」 when `regions.legs` is false. Item 1 is ⊘ 原圖, with `resetGroup(params, 'body')`.
- Bidirectional sliders (center-zero) for 美臀, 美肩 and 小頭; one-way for the rest.

**G. Photo-first recommendation**
- The editor already does one IMAGE-mode detect per photo with rAF-coalesced renders. Pose plus mask cost there is a one-off of hundreds of milliseconds at most, which the user does not notice.
- Photos are where full bodies appear: rear camera, other people's shots, the camera roll.
- Live front-camera selfies mostly show the head and shoulders.
- So P1 is editor-only. Live comes later, with the rear camera and the existing 3s/10s timer (`Facing = 'user' | 'environment'` is already in types).

### Gaps
- Whether PoseLandmarker's segmentation mask is returned at input-image resolution or at the 256² ROI (affects transient memory) is UNVERIFIED.
- Whether `NormalizedLandmark.visibility` and `presence` are populated in 0.10.35: [MPI 4479](https://github.com/google-ai-edge/mediapipe/issues/4479) reported both missing in 0.10.0, and the fix version was not checked.
- How `numPoses` > 1 orders results (by size or by score) is not documented in what was read.
- The exact iOS Safari cap on concurrent WebGL contexts is not sourced. The codebase only notes that "iOS caps the number of live WebGL contexts" ([src/engine/index.ts](D:/GitSource/MonaLisa/src/engine/index.ts) line 284). A GPU pose task adds a third context (engine, face, pose).
- HolisticLandmarker model size and Safari latency were not researched.

## 3. What does pose (+ optional segmentation) cost on iPhone 11–16 Safari, and what is a sensible phased plan?

### Takeaway
No first-party iPhone Safari numbers exist for PoseLandmarker. Published data:
- Lite: about 8 ms on a Pixel 4 GPU and about 13 ms in desktop Chrome. Full: 9 / 15 ms. Heavy: 22 / 29 ms.
- Model files are about 5.8 / 9.4 / 30.7 MB.
- Each extra MediaPipe task brings its own wasm runtime. The pinned binary declares 18.125 MB of initial linear memory, before the model loads.

Pose every frame on top of face (≈9–15 ms) would blow the 33 ms live budget. So: P1 is photo-only (pose full + mask, CPU delegate for the mask). P2 is live with pose lite every 2–3 frames, no mask, when the body is visible. Measure on the user's iPhone with `bench.html` before each phase.

### Cited Findings
**Model sizes**
- `pose_landmarker_lite.task` is 5,777,746 bytes (Hugging Face mirror LFS pointer). [HF](https://huggingface.co/AndorML/Public/blob/02ef083b988890f7444aa40afad3a2029d3b9faa/pose_landmarker_lite.task)
- A third-party listing gives lite / full / heavy `.task` sizes of 5.8 / 9.4 / 30.7 MB. [Search summary](https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker)
- The model card gives "Lite (3MB size), Full (6 MB size) and Heavy (26 MB size)". [Model card](https://storage.googleapis.com/mediapipe-assets/Model%20Card%20BlazePose%20GHUM%203D.pdf)

**Latency**

| Source | Lite | Full | Heavy |
|---|---|---|---|
| Model card, Pixel 3 (XNNPack CPU / TFLite GPU) | ~44 / ~49 FPS | ~18 / ~40 FPS | ~4 / ~19 FPS |
| MediaPipe docs, Pixel 3 GPU | 20 ms | 25 ms | 53 ms |
| MediaPipe docs, MacBook Pro 2017 | 25 ms | 27 ms | 38 ms |
| BlazePose GHUM Holistic paper, in-browser (Chrome on MacBook Pro 2017) | 13 ms | 15 ms | 29 ms |
| Same paper, Pixel 4 GPU | 8 ms | 9 ms | 22 ms |
| Same paper, Pixel 4 single-core CPU | 25 ms | 40 ms | 147 ms |

- The two MacBook figures conflict (docs 25 / 27 / 38 ms vs paper 13 / 15 / 29 ms), probably different builds.
- Sources: [model card](https://storage.googleapis.com/mediapipe-assets/Model%20Card%20BlazePose%20GHUM%203D.pdf); [MediaPipe legacy pose docs](https://github.com/google-ai-edge/mediapipe/blob/master/docs/solutions/pose.md); [arXiv 2206.11678](https://arxiv.org/pdf/2206.11678)
- Third-party native iPhone 12 (not web, unverified): lite ~18 ms, full ~35 ms, heavy ~55 ms on CPU. GPU is 20–30% faster but throttles from 30 to 18 fps after about 8 minutes. The CPU delegate holds 28 fps. [dev.to](https://dev.to/diyoraharshit52/mediapipe-on-ios-what-the-docs-leave-out-22bl). The research brief already flags this throttling as a native PoseLandmarker result, not this stack. [research brief](D:/GitSource/MonaLisa/docs/superpowers/specs/2026-10-07-meiyan-research-brief.md) line 326

**Load time and memory**
- "PoseLandmarker and GestureRecognizer can take 30+ seconds to load in the first time" (iOS webview, both created together via `Promise.all`). [MPI 5171](https://github.com/google-ai-edge/mediapipe/issues/5171)
- The pinned `vision_wasm_internal.wasm` (11,153,617 B) declares linear memory of initial 18.125 MB, max 2048 MB (growable). Measured by parsing the wasm memory section of `public/mediapipe/0.10.35/vision_wasm_internal.wasm`, 2026-10-07. Each task instantiates its own module ([vision.d.ts](D:/GitSource/MonaLisa/node_modules/@mediapipe/tasks-vision/vision.d.ts) line 2396), so a second task adds at least this much.
- The tracker keeps `modelBuffer` "by reference… re-read on every setOptions graph rebuild", so the JS copy of the model stays resident alongside the heap copy. [tracker.ts](D:/GitSource/MonaLisa/src/tracking/tracker.ts) lines 115–118

**Existing app budgets (research brief)**
- Pages were killed at about 100 MB on an iPhone SE 3 and about 200 MB on an iPad 8 (iOS 26.2).
- Pipeline buffers at 2048×1536: about 12.6 MB each, about 63 MB total with full-res means and about 44 MB with half-res.
- The live working budget is detection ≤ 15 ms plus render ≤ 12 ms, for 30 fps at tier M.
- Only one iPhone Safari face data point exists: iPhone 16 Pro, about 9 ms per FaceLandmarker inference, third party. A13–A16 Safari numbers are UNVERIFIED.
- [research brief](D:/GitSource/MonaLisa/docs/superpowers/specs/2026-10-07-meiyan-research-brief.md) lines 40, 95, 326
- Live tier L already detects every second frame and holds the last landmarks (`shouldDetect`). [src/app/liveCore.ts](D:/GitSource/MonaLisa/src/app/liveCore.ts) lines 140–143

**Segmentation cost**
- SelfieSegmenter 256² is about 33–35 ms on a Pixel 6 (CPU or GPU).
- Multiclass is 218 ms on CPU and 71 ms on GPU.
- iOS GPU segmentation has an open correctness bug (MPI 6142).
- [MediaPipe segmenter](https://developers.google.com/edge/mediapipe/solutions/vision/image_segmenter); [MPI 6142](https://github.com/google-ai-edge/mediapipe/issues/6142)

### Inferences
**Incremental memory for 美體 in the editor (estimates, to be measured)**

| Item | Size |
|---|---|
| Second wasm heap | ≥18 MB initial, plus model weights and tensors, growing to an UNKNOWN total (plausibly 30–50 MB) |
| JS-held model buffer | 5.8 MB (lite) or 9.4 MB (full) |
| Pose GPU context | UNKNOWN; zero extra context on the CPU delegate |
| Transient Float32 mask | up to 12.6 MB if returned at 2048×1536 (UNVERIFIED); about 0.25 MB once downsampled to R8 512² |
| Displacement field | about 30 KB, negligible |
| Pipeline FBOs | 0 extra with the composed-pass design (vs +12.6 MB for a separate pass) |

- Order of magnitude: +40–70 MB on top of a page that is already about 44–63 MB in GPU buffers, plus the face task.
- This is risky on SE-class (about 100 MB) devices and comfortable on 6–8 GB iPhones.
- Mitigations:
  - Load pose lazily, only when 美體 is opened.
  - Detect pose on a ≤1280 long-edge copy (landmarks are normalized; the model crops to 256² anyway, like `CPU_FRAME_MAX_EDGE`).
  - Run the photo-mode pose task on the CPU delegate (no third GL context; also sidesteps the iOS GPU mask bugs).
  - Copy the mask, then close the result immediately.

**Live latency (estimate)**
- Face about 9–15 ms plus pose lite about 10–20 ms per frame is over 33 ms.
- Pose every 3rd frame amortises to about 4–7 ms per frame, plus a CPU field rebuild under 1 ms.
- Skeleton motion between pose updates needs interpolation or extrapolation. A One Euro filter on the 33 points avoids wobble; an un-smoothed warp on a moving body jitters visibly, as face-beautifier notes for faces.

**Phased plan**
- **P0 spike (bench.html):**
  - Add PoseLandmarker lite and full in IMAGE and VIDEO modes, CPU and GPU, on the user's iPhone.
  - Record detect ms, first-load time, and the Safari Web Inspector memory timeline.
  - Check: visibility populated, mask resolution, mask correctness on GPU vs CPU.
- **P1 editor-only 美體:**
  - Model: pose full, IMAGE mode, `numPoses: 2` (to detect and warn on multiple people), `outputSegmentationMasks: true` on the CPU delegate.
  - Body field: CPU-built from capsule squeezes, band-stretch 長腿, `shiftAround` / `scaleAround` analogues; fold clamp.
  - Render: composed into P2; export identical to preview.
  - UI and storage: the 美體 tab with visibility gating; lazy model download with progress; `Body` cached in the history entry.
  - Out of scope: live, chest, auto-beautify presets.
- **P2 live (rear camera / timer full-body first):**
  - Pose lite VIDEO mode, GPU if P0 shows it is correct (else CPU), detected every 2–3 frames.
  - One Euro smoothing; `bodyWeight` easing like `FaceWeightEaser`; no mask.
  - Cap tier at M while body terms are active.
  - On the front camera, enable only 美肩 / 天鵝頸 / 小頭 / 瘦手臂 when shoulders are visible.
  - The spec's planned Web Worker migration becomes more valuable here (two models on the main thread).
- **P3 quality:**
  - Mask-aware edge pulls: the warp targets the silhouette edge, and background is protected by limiting displacement outside the mask plus a margin.
  - Straight-line protection for door frames and walls.
  - MLS-rigid grid warps (imgwarp-opencv MIT as reference).
  - A manual 液化 brush in the editor as a fallback where pose fails. It writes into the same displacement-field contract.
- **P4 (optional research):** a learned flow model. Blocked by licences (FBBR non-commercial, AAGN unlicensed, BR-5K gated), and it would need our own training data. Not recommended.

### Gaps
- No measured PoseLandmarker latency or memory on any iPhone in Safari was found; iPhone 11–16 numbers are UNVERIFIED and must come from P0.
- Actual heap growth after loading a pose model in 0.10.35 is unknown.
- Whether WebGL / GPU-process memory counts toward the WebContent jetsam limit is already UNVERIFIED in the brief (line 589).
- Thermal behaviour of running face + pose together in Safari is unknown. The only throttling data is native.

## 4. Risks: selfies rarely show a full body, multiple people, clothing, ethical defaults

### Takeaway
The biggest functional risk is that most front-camera frames contain no legs or hips. So 美體 must be visibility-gated per region, with sliders disabled and a hint shown, rather than warping guessed anchors. The biggest quality risk is spatial warps bending the background and neighbouring people. Ethically, ship neutral defaults, keep body edits out of one-tap presets, cap strengths, and defer 胸部.

### Cited Findings
- PoseLandmarker exposes per-landmark `visibility` (type field present in 0.10.35) and presence or tracking confidences (defaults 0.5). [vision.d.ts](D:/GitSource/MonaLisa/node_modules/@mediapipe/tasks-vision/vision.d.ts) lines 2022, 2568–2585; [MediaPipe docs](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker). Visibility was reported missing in 0.10.0. [MPI 4479](https://github.com/google-ai-edge/mediapipe/issues/4479)
- `num_poses` defaults to 1, and a larger value is allowed. [MediaPipe docs](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker)
- The app already has rear-camera support (`Facing = 'user' | 'environment'`) and a capture timer (`關 | 3s | 10s`). [types.ts](D:/GitSource/MonaLisa/src/types.ts) line 209; [design spec](D:/GitSource/MonaLisa/docs/superpowers/specs/2026-10-07-meiyan-pwa-design.md) §7.2
- FBBR uses skeleton and PAF priors precisely to handle "any pose or clothing", and its authors restrict BR-5K because "misuse of the dataset may lead to ethical concerns". [GitHub](https://github.com/JianqiangRen/FlowBasedBodyReshaping)
- SelfieMulticlass separates `body-skin` from `clothes`, at 218 ms CPU / 71 ms GPU on a Pixel 6. Its iOS GPU output is category-scrambled (MPI 6142). [Segmenter docs](https://developers.google.com/edge/mediapipe/solutions/vision/image_segmenter); [MPI 6142](https://github.com/google-ai-edge/mediapipe/issues/6142)
- face-beautifier warns that warps steeper than its smoothstep falloff fold over and leave rings. Its falloff is fold-free up to 0.45× the radius. [GitHub](https://github.com/ctbot000/face-beautifier)

### Inferences
**Visibility gating** (thresholds about 0.6 on `min(visibility, presence)`, landmark inside the frame with a margin):

| Region | Required landmarks |
|---|---|
| shoulders | 11, 12 |
| arms | 11–16 |
| torso | 11, 12, 23, 24 |
| legs | 23–28 |
| feet | 27–32 |

- Disable the sliders a region drives, and show 「拍攝全身照可使用長腿／瘦腿」.
- Weight each warp term by the minimum visibility of its anchors so terms fade instead of popping in live mode.
- On the front camera, typically only head, neck, shoulders and upper arms qualify.

**Multiple people.** Every warp is a spatial field, so slimming person A also bends person B standing next to them.
- In P1 use `numPoses: 2`.
- If two people are found, apply the warp to the larger or more central one only.
- Zero the field inside the other person's mask region, or disable 瘦身 / 細腰 with a notice.
- The live path keeps `numPoses: 1`.

**Clothing and occlusion:**
- Loose dresses and coats move the real silhouette away from the skeleton, so 細腰 from skeleton interpolation lands on fabric. The P1 person mask, which includes clothing, fixes the target edge, and clothes are what users expect to move anyway.
- Bags and arms crossing the torso break capsule squeezes. Lower the strength where arm segments overlap the torso (segment intersection test on the CPU).

**Background artifacts are the most visible tell:**
- Bent door frames and wavy floor lines.
- Mitigations:
  - Bounded displacement, with a falloff that stays mostly inside the mask plus a margin.
  - A C¹ band edge for 長腿.
  - The P3 straight-line protection.
  - Fold-free Jacobian clamping.

**Ethical defaults:**
- Every `body.*` slider defaults to neutral (0, or the 0.5 centre for bidirectional ones).
- Body edits are never part of 一鍵 presets or 程度.
- No automatic "ideal ratio" targets.
- Conservative maximums, e.g. ≤ 12–15% local width change (to be tuned by eye).
- Hold-to-compare already exists, and should work for body edits too.
- Defer 胸部 / 豐胸 (sensitive, and the warp is also unreliable from a frontal skeleton).
- Consider a small 「已修圖」 note in the export metadata or credits. That is an option, not a requirement found in any source.

**Performance risk in live mode:** two models on the main thread plus auto-tier step-down could drop the tier to L for everyone the moment 美體 is touched. P2 should run pose only when a body slider is non-neutral and the relevant region is visible.

### Gaps
- Regulatory labelling of retouched body images (e.g. advertising rules in some countries) was not researched in this pass. It is likely irrelevant for a personal or portfolio demo, but unverified.
- No user-research or prevalence data was found on how often front-camera selfies show hips or legs. The "rarely" premise is the task's assumption and was not measured.
- No quantitative study was found on acceptable maximum strengths for body warps before artifacts appear. They must be tuned on device.
