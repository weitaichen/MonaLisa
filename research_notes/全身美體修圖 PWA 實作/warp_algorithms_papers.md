# Image-warping algorithms and papers for natural full-body reshaping (美體), aimed at a WebGL2 GPU implementation

Research date 2026-10-07. Scope: warp techniques, artifacts and how to avoid them, key papers, and GPU recipes for MonaLisa 美顏 (WebGL2, iPhone PWA, everything on-device). Codebase context I checked: `src/engine/passes/reshape.ts` is a single-pass **backward** warp. It chains `curveWarp` / `scaleAround` / `shiftAround` / `enlargeEye` in an aspect-corrected "iso" space (x, y/aspect) and has a UV bounding-box early-out. Its header says it comes from GPUPixel (Apache-2.0). `src/` has **no pose landmarker and no person segmentation** yet (a grep for segment/PoseLandmarker/ImageSegmenter/selfie found nothing relevant), so body work needs both as new inputs.

A note on two mix-ups in the brief. "FBBR" is the GitHub repo name of Ren et al. CVPR 2022; the dataset is called **BR-5K**. "Deep Shapely Portraits" (ACM MM 2020) is a **face** reshaping paper, not a body paper.

## Techniques: local fields, mesh warps, MLS, liquify, skeleton-driven fields, 1D stretch bands, TPS, ARAP — pros/cons, cost, smoothness, fold-overs, temporal stability

### Takeaway
Industry 美體 pipelines are rule-based. They detect body keypoints or contour points, compute target points or a parametric field, then warp with an inverse (backward) map. The usual warp is MLS, local translate/scale fields, or a triangle mesh. The best evidence on *what a good body flow looks like* comes from Ren et al. 2022. Their learned flow is smooth enough to predict at 256×256 and upsample bilinearly to 4K, and for slimming it is mostly **perpendicular to the limbs**. That justifies a simple GPU design: evaluate a few analytic, bone-aligned ("capsule") compression fields into a low-res displacement texture, then do one full-res backward-sampling pass. MLS works but has global support and can fold back. ARAP and TPS need solves and gain little for this use.

### Cited Findings
- **Inverse mapping is standard.** Chinese engineering write-ups describe three basic local deformations: local scaling (big eyes), local translation (slim face) and local rotation. They compute the inverse map (output → source coordinate) and interpolate, which keeps the image continuous with no holes. — [CSDN 图像变形算法_局部平移](https://blog.csdn.net/u010281924/article/details/105946889) (per search-result summary; page not fetched in full)
- **Industrial body-slimming pipeline (Trent1985, CSDN, 2018).** It has two modules: a body *contour* keypoint detector and a deformation module. Plain pose keypoints are not enough: "人体轮廓特征点检测模块好比人脸特征点检测…技术上比人脸特征点更加复杂". The candidate warps are MLS, IDW (inverse distance weighting) and MLSR. The author uses MLS (rigid and similarity variants). Steps: detect keypoints → compute slim-leg target points → compute slim-waist target points → MLS from source to target points. No background handling and no performance figures are given; real-time is dismissed as "代码优化和算法优化的事情". — [CSDN Trent1985](https://blog.csdn.net/Trent1985/article/details/80667611)
- **ByteDance / 火山引擎 long legs.** The pipeline gets body keypoints, including joints, locates the leg "长腿中心点" and the region to deform, then maps source to target regions "根据预先设定好的形变函数". They state the problem plainly: after beautification "背景被扭曲了", e.g. "水泥路已经变弯曲" after leg stretching. Their correction "保证美型后图片中的直线仍然是直线" by optimising to keep line slopes consistent. — [腾讯新闻 (Volcano Engine / Kuaishou / Alibaba talk write-up, 2022-03)](https://news.qq.com/rain/a/20220313A03FNH00)
- **Other vendors.** A related webinar promotion mentions only "关键点检测、人体分割、GAN等基础CV技术" for 美体, with no deformation specifics. — [腾讯云开发者社区](https://cloud.tencent.com/developer/article/1951209)
- **MLS (Schaefer, McPhail, Warren, SIGGRAPH 2006), checked against the PDF text:**
  - Weights are w_i = 1/|p_i − v|^(2α). Affine, similarity and rigid variants all have closed forms. For rigid, the paper avoids the non-linear problem: "we showed how these solutions could be computed directly from the closed-form deformation using similarity transformations". fr(v) = |v − p*|·f⃗r(v)/|f⃗r(v)| + q*. — [Schaefer et al. 2006 PDF](https://www.cs.rice.edu/~jwarren/research/mls.pdf)
  - Each point solves a 2×2 system, so "we can create very fast deformations of grids consisting of tens of thousands of vertices in real-time". In contrast, Igarashi et al.'s ARAP must triangulate and solve a system sized to the vertex count, and "slows at 300 vertices on a 1 GHz machine". — [Schaefer et al. 2006](https://www.cs.rice.edu/~jwarren/research/mls.pdf)
  - Implementation: "we approximate the image with a grid and apply the deformation function to each vertex… then fill the resulting quads using bilinear interpolation". This is "indistinguishable from… applying the deformation to every pixel". They used ~500×500 images with ~100×100 grids, and cost is linear in grid vertices. Affine with precomputation runs ">500 times per second". Rigid is slowest because of the square root. — [Schaefer et al. 2006](https://www.cs.rice.edu/~jwarren/research/mls.pdf)
  - Affine MLS and thin-plate splines both cause "local non-uniform scaling and shearing, which is undesirable", which is why similarity and rigid variants exist. — [Schaefer et al. 2006](https://www.cs.rice.edu/~jwarren/research/mls.pdf)
  - **Fold-backs:** "our method may suffer from fold-backs like most other space warping approaches. These situations occur when the sign of the Jacobian of f changes… extreme deformations will certainly cause such fold-backs". A generic fix is Tiddeman et al. 2001, which composes a second warp so the product has a non-negative Jacobian. — [Schaefer et al. 2006](https://www.cs.rice.edu/~jwarren/research/mls.pdf)
  - (Correction: a WebFetch summary of this PDF claimed rigid MLS uses an SVD and a "typical 5–10 px grid spacing". Neither appears in the extracted text, so ignore both claims.)
- **MLS for body proportions in video (patents).** US 10586570 / 11651797, "Real time video processing for changing proportions of an object in the video", use rigid MLS with α = 0.9. — [US 10586570](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/10586570) (search snippet only; patent text not read)
- **CPU MLS timing reference.** The MATLAB implementation cuixing158/Moving-Least-Squares-Image-Deformation (affine, similarity, rigid, precomputed weights) reports 8.8 ms for 512×512 with 10 control points and 15.1 ms for 2000×2000 with 60 points. — [GitHub cuixing158](https://github.com/cuixing158/Moving-Least-Squares-Image-Deformation) (search snippet; licence not checked)
- **GPU MLS precedent.** "Sketching MLS image deformations on the GPU" (Weng et al. 2008) accelerates the fitting and deformation on the GPU for real-time use. — [ResearchGate](https://www.researchgate.net/publication/220507114_Sketching_MLS_image_deformations_on_the_GPU)
- **Liquify is the professional baseline.** Retouchers "rely on Liquify tool… adjust the distortion brush frequently, and manually edit through every single part of body areas". Rule-based methods (non-rigid deformation from body contour keypoints with hand-crafted rules, citing MLS [16] and moving regularised LS [12]) "can only work under standard poses and garments, and body contour detection is not robust enough". — [Ren et al. CVPR 2022, arXiv 2203.04670](https://arxiv.org/abs/2203.04670)
- **Skeleton-aligned flow is the right prior.** Ren et al.'s method "will adjust each limb's width but keep length and direction unchanged, the orientation of deformation flow and corresponding limb tend to be perpendicular to each other". They add an orthogonality loss between the flow and the PAF limb directions. Skeleton maps "indicate opposite boundaries of deformation flow", and PAFs "highlight where should be manipulated". — [Ren et al. 2022](https://arxiv.org/abs/2203.04670)
- **Smooth fields tolerate low-res evaluation.** Ren et al. predict flow at 256×256, upsample it with bilinear interpolation and warp the original image. "The upsampled deformation flows are good enough to achieve compelling reshaping results on even 4K-resolution images, owing to the local smoothness of the generated flows". — [Ren et al. 2022](https://arxiv.org/abs/2203.04670)
- **Length changes are simple.** Ren et al.: "reshaping body height can be easily achieved by non-uniform image scaling on body length direction". — [Ren et al. 2022](https://arxiv.org/abs/2203.04670). Zhou et al. 2010 §5.2 starts from the observation that effects like height changes "directly exhibit length changes". — [SIGGRAPH history page](https://history.siggraph.org/learning/parametric-reshaping-of-human-bodies-in-images-by-zhou-fu-liu-cohen-or-and-han/) (via search summary)
- **1D stretch-band 大长腿 tutorials (iOS / Android OpenGL ES).** The image is split into a strip mesh of 8 vertices / 6 triangles, and the middle rectangle (V2–V5) is stretched or compressed by changing its vertex positions while keeping texture coordinates. Bilinear texture filtering does the resampling, and the result is rendered to an FBO to be saved or reused. — [简书 OpenGL ES：大长腿效果](https://www.jianshu.com/p/e7fd02e1924e) (403 on fetch; from search summary), [CSDN lin1109221208](https://blog.csdn.net/lin1109221208/article/details/108047624). Another tutorial does it with texture mapping and bilinear interpolation, with the full code behind a paywall. — [CSDN Kennethdroid](https://blog.csdn.net/Kennethdroid/article/details/104546234)
- **Temporal stability in a shipping mobile system (patent).** A point-stabilisation algorithm "may eliminate a prediction error of points… reduces a jitter". The body detector plus keypoint model total 3 MB and "may support 30 fps real-time body beautification on the mobile side". — [US 11450080](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/11450080) (search snippet)
- **Temporal terms for mesh warps.** Lai et al.'s wide-angle *video* correction tracks line endpoints with pyramidal Lucas–Kanade and adds a temporal smoothness term to the mesh energy. — [arXiv 2111.09950](https://arxiv.org/pdf/2111.09950)

### Inferences
- **Comparison for this app** (cost figures are my estimates for a 1080×1920 frame):

| Technique | Per-pixel / per-vertex cost | Locality | Fold risk | Fit for MonaLisa |
|---|---|---|---|---|
| Radial local fields (`curveWarp`, `scaleAround`, `shiftAround`; already ported) | O(#primitives) per pixel, closed form | Compact (zero outside R) | Analytic bounds (below) | Good for head, chest, shoulders. Poor for long limbs, because discs are isotropic |
| **Bone-aligned capsule fields** (new; same family, anisotropic) | O(#bones ≈ 10–16) per *field texel* | Compact | Analytic bound | **Primary choice** for waist, arms, legs, overall slimming |
| 1D vertical stretch band (長腿, 天鵝頸) | O(1) per pixel | Full-width rows | Monotonic by construction | **Primary choice** for long legs |
| Forward mesh (vertex displacement, grid 64×64 – 100×100) | O(#vertices) | Depends on driver | Triangle flips are easy to detect (signed area) | Good for MLS, or when optimising a mesh on the CPU |
| MLS rigid/similarity from keypoints | O(n_ctrl) per vertex, plus sqrt for rigid | **Global** (w never 0) | Fold-backs with large moves | Usable, but needs anchor points to pin the background; harder to bound |
| Liquify brush (accumulated displacement texture) | O(1) per brush dab | Brush radius | Can fold with repeated strokes | Manual mode in the photo editor |
| TPS | Global n×n solve per change, O(n) per pixel | Global | Shear and non-uniform scale (Schaefer) | Not worth it |
| ARAP (Igarashi) | Sparse solve on a triangulation | Global | Low | WebGL2 has no compute shaders, so the solve would run in JS/WASM; overkill for parametric sliders |

- **Monotonicity (no fold-over) of the existing primitives, derived from the shader code:**
  - `scaleAround` in 1D radial form is r_src = r(1−d) + d·r³/R². Its derivative is (1−d) + 3d(r/R)², whose minimum is 1−2|d| for d < 0 (at r = R) and 1−d for d > 0. That matches the code comment "monotonic for |d| ≤ 0.5".
  - `curveWarp` has Jacobian I − dir⊗∇k with |dir| = d·r and |∇k| = 1/r, so it is fold-free for d < 1. But the linear cone falloff is only C0: it creases at the centre and at the rim. Body fields should use C1/C2 falloffs such as (1−w²)², as `shiftAround` already does.
- **Capsule field math.** Work in iso space. For a bone A→B, let û = unit(B−A), n̂ = ⊥û, t = along-bone parameter, v = signed distance across the bone, R = ρ·W (W = half-width of the limb, ρ ≈ 1.5–2.5), r = |v|/R and φ(r) = (1−r²)².
  - Backward map: v_src = v·(1 + k·a(t)·φ(r)), with k > 0 for slimming and a(t) a smooth window that fades near the joints.
  - Its across-bone derivative is 1 + k·a·(1−r²)(1−5r²). The minimum of (1−r²)(1−5r²) is −0.8 at r² = 0.6, so the field is **fold-free iff k·a < 1.25**.
  - The body core is compressed to 1/(1+k). The background ring around r ≈ 0.77 is stretched by up to 1/(1−0.8k), e.g. **k = 0.25 → 20% compression of the core, 25% stretch of the ring**. That ring stretch is exactly where background distortion appears (next question).
  - Keep a(t) slowly varying, with fade length ≥ W, so the shear term v·k·φ·a′(t) stays small.
- **Use a low-res displacement texture instead of per-pixel evaluation.** Render the summed backward displacement D(x) into an RG16F target at about ¼ resolution (270×480 is about 0.5 MB). Then one full-res pass does `out = texture(src, uv + texture(field, uv).xy)`. This mirrors Ren et al.'s 256×256 flow plus bilinear upsample. It also gives a single place to (a) multiply by masks, (b) clamp the Jacobian, (c) apply temporal smoothing, and (d) compose with a liquify brush layer.
- **MLS on a GPU backward pipeline.** MLS is defined forward (p → q). For a fragment-shader or field-texture backward warp, run MLS with the handle roles swapped (q → p). This is an approximation of the inverse, not an exact inverse, but both are smooth interpolants and the difference is negligible for small moves.
  - Because MLS weights never reach zero, add fixed anchors (p = q) on the image border and on a ring around a dilated person mask, or the whole background drifts.
  - If MLS is used at all, the rigid variant with α ≈ 0.9–1 (as in the patent) on a ~64×64 field texture is cheap: 4k texels × ~30 control points.
- **Composition order.** Chaining backward maps in one shader (`tc = f2(f1(uv))`, as reshape.ts does) samples src at f2∘f1, so the forward effects apply in reverse order. Summing small displacements is an acceptable approximation when the fields barely overlap. Liquify strokes on a stored backward field D compose as D_new(x) = D_brush(x) + D_old(x + D_brush(x)) (one texture read per update).
- **Temporal stability for the live camera:**
  - Filter *derived parameters* such as bone endpoints, widths W, the hip line and amounts, not just raw landmarks. Add hysteresis or dead-zones on W, which jitters when estimated from a segmentation mask.
  - Fade the effect amount in and out with landmark visibility or confidence, the way `yawAttenuation` does for faces.
  - Optionally EMA the field texture itself (ping-pong RG16F, D_t = lerp(D_{t−1}, D_new, α)). That costs one extra low-res pass.

### Gaps
- No primary source found for Meitu or ByteDance internal 美體 deformation equations, beyond the talk write-up and blog posts above. Zhihu/CSDN posts are second-hand.
- Exact MLS GPU timings on iPhone-class GPUs were not found. The cost estimates above are my own.
- The 简书 long-leg tutorial returned 403. Its details come from a search-result summary.

## Background preservation: why walls/door frames bend, how apps avoid it, background fill (edge-stretching vs inpainting), seams, real-time feasibility on a phone GPU

### Takeaway
Slimming *compresses* the person, so something must expand to fill the gap. Either the background next to the body is stretched, which bends lines crossing that band, or the revealed strip is filled from a clean background plate or by inpainting. Commercial apps confine the warp to the segmented silhouette ("lock background"). ByteDance additionally runs a straight-line-preserving correction. Research systems (FBBR limitation section, NeuralReshaper, Odo) separate foreground from background and inpaint or generate. On a phone in real time, the practical options are mask-confined fields with a feathered band and full-width 1D stretches. Fills are feasible only when cheap and blurry; heavier fills or line-aware mesh optimisation belong in the photo editor only.

### Cited Findings
- **Flow-based reshaping distorts background (FBBR limitation).** "The predicted flow will also affect the overlapped areas in the background, which may bring some unexpected distortions, such as twisted lines or deformed objects. One possible solution is to combine background matting… segment the reshaped foreground human body and blend it into an identical and intact background image". But "background matting requires an intact background image which is hard to obtain, and predicting accurate matting results on high-resolution images is difficult". Their Fig. 9 shows matting plus composition over a background "either captured in advance or recovered by inpainting". — [Ren et al. 2022](https://arxiv.org/abs/2203.04670)
- **Whole-image triangulation propagates deformation (NeuralReshaper).** Warping-based methods (Zhou et al. style) "first conduct delaunay triangulation on the full image and deform these triangles according to the 3d human model. Thus, the deformations of human model are propagated to the whole image". Unfitted areas such as hair also get distorted because they are treated as background. Zhou et al.'s mitigation, manually adjusting a saliency map, "involves lots of human intervention". NeuralReshaper instead uses a two-headed generator with foreground and background branches that inpaints missing areas. It preserves regular occluded patterns such as wire fences instead of distorting them. — [NeuralReshaper arXiv 2203.10496](https://arxiv.org/pdf/2203.10496); authors Chen, Shen, Fu, Chen, Zhou, Zheng; v1 2022-03, final 2023-08 — [abs](https://arxiv.org/abs/2203.10496)
- **Diffusion approaches name the same problems.** Odo (2025) says current methods "often introduc[e] unrealistic body proportions, texture distortions, and background inconsistencies due to alignment errors and deformations". It uses a frozen UNet plus a ControlNet driven by target SMPL depth maps. — [Odo arXiv 2508.13065](https://arxiv.org/abs/2508.13065)
- **Commercial "no background warp".** YouCam (Perfect Corp) says the warp is constrained inside the segmented silhouette, so doorframes, tile lines and other people stay untouched, and that it works best on a clean, unobstructed silhouette. — [Perfect Corp body reshape](https://yce.perfectcorp.com/products/body-reshape). FaceApp "Lock Background" fixes the background before editing and recommends it for scenes with architecture or straight lines. — [FaceApp blog](https://www.faceapp.com/blog/tips-and-tricks-reshape-tool/). Fotor advises smaller brush adjustments near railings, mirrors or strong lines. — [Fotor](https://www.fotor.com/features/reshape.html) (all three via search summary)
- **ByteDance line preservation.** Detected straight lines are kept straight after 美型 by an optimisation that keeps line slopes consistent. It was introduced because leg stretching curved a cement road. — [腾讯新闻](https://news.qq.com/rain/a/20220313A03FNH00)
- **Content-aware mesh warps run on phones (Shih et al. 2019).** A content-aware warping mesh follows the stereographic projection on faces (via a face/portrait mask) and blends smoothly into the perspective projection over the background. It runs "at an interactive rate on mobile" and shipped on Pixel 3. — [ACM DL 10.1145/3306346.3322948](https://dl.acm.org/doi/10.1145/3306346.3322948), [Google Research](https://research.google/pubs/distortion-free-wide-angle-portrait-on-camera-phone/)
  - Energy terms (as restated by Lai et al.): face (similarity-transform freedom per face), spatial smoothness, grid edge-bending, boundary. Lai et al. add an explicit line-preservation term with a line detector, LK tracking of line endpoints, and a temporal term for video. — [arXiv 2111.09950](https://arxiv.org/pdf/2111.09950)
  - Even so, Tan et al. (CVPR 2021) found "some background structures still bend" with Shih's method (LineAcc 66.143, ShapeAcc 97.253 on their test set). — [arXiv 2104.12464](https://arxiv.org/pdf/2104.12464) (via search summary)
- **Per-layer warps (patent).** Images are split into segmentation layers. People get a correction that keeps the human shape pleasing, buildings get one that keeps lines straight, and the layers are merged. — [US 11475546](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/11475546) (search snippet)
- **FBBR's structure priors reduce background spill.** Without the full model "the background is affected redundantly". The full model makes "a succinct but effective flow… while avoiding disturbing background too much". — [Ren et al. 2022](https://arxiv.org/abs/2203.04670)

### Inferences
- **Why lines bend, precisely.** Take a backward field D. A straight line bends wherever the component of D *perpendicular to the line* varies *along* the line.
  - **Horizontal-only fields (pure x-displacement, e.g. waist slimming) never bend horizontal lines.** Points just slide along them. They bend vertical lines (door frames, wall edges) wherever d_x changes with y.
  - **Vertical-only fields that depend only on y (a full-width 長腿 band) keep every horizontal and vertical line straight.** Only slanted lines (floor tiles, perspective road edges) get a gentle bend at the transition band, and C1 transitions turn the kink into a curve.
  - That is the geometric reason full-width non-uniform vertical scaling looks natural, while local leg-only stretching bends the road (the ByteDance example).
- **The mask band trade-off.** With a mask-confined field D·M_f, where M_f is the person mask dilated by δ and feathered by f, all of the needed expansion happens in the strip just outside the silhouette. If the body edge moves by Δ, the strip is stretched by about 1 + Δ/(δ+f).
  - A narrow band confines the damage but smears the texture in it.
  - A wide band is gentle but bends more of the scene.
  - Rule of thumb: band ≥ 4Δ keeps stretch ≤ 25%. The capsule formula gives the same limit (k = 0.25 → 1.25× ring stretch).
  - A *hard* cut at the silhouette with no fill creates a tear, because pixels just inside the old edge would sample background from farther out while pixels outside are identity.
- **Background-fill options, ranked by cost:**
  1. **Edge-stretching (default, real-time).** Let the feathered ring absorb the expansion, with ρ and band width tuned per part. Zero extra passes.
  2. **Cheap GPU hole fill for the revealed sliver.** Composite the warped person (using the warped mask as alpha) over a background estimate. Fill the hole with a push-pull / mip-pyramid fill from surrounding background pixels, then add matched grain. This works in real time for slivers a few pixels to about 1–2% of image width, which is what moderate slimming produces. It is blurry for large changes and textured backgrounds.
  3. **Learned inpainting (photo editor only).** Better quality, but costs model download, memory and time. See the gaps.
  4. **Clean plate from video.** Accumulate background pixels from earlier frames where the person had moved. This is mostly useless for a static selfie.
- **Line-aware correction in the editor.** Detect line segments (an LSD-style detector on the CPU at low res) inside the distortion band. Then solve a small mesh least-squares problem (e.g. 40×60 vertices) that matches the body field inside the mask and keeps detected lines straight outside, in the style of Shih and Lai. A sparse CG solve in JS/WASM is plausible for the editor, but no timing source was found; estimated tens of ms.
- **Seams and part conflicts.** These are the main failure cases:
  - Arm hanging next to the waist (the waist field drags or bends the arm).
  - Hand on hip (the hand gets squashed).
  - Legs touching (each leg's compression samples the *other* leg, so its texture is duplicated).
  - Hair over the shoulders, loose clothing.
  Mitigations:
  - Build exclusion weights from pose capsules: multiply a part's field by (1 − capsule weight of other parts) for arms, hands and the face.
  - Use one-sided falloff (compress only the outer contour) when the mask shows no background gap between adjacent parts.
  - Detect the gap by sampling the mask along the bone normal.
- **What is affordable in real time on iPhone in WebGL2:**
  - Pose landmarks plus a low-res person mask (other researchers cover model choice).
  - A ¼-res RG16F field pass with about 10–16 capsules plus a few radial primitives.
  - One full-res apply pass.
  - Optionally one mask-warp pass, a push-pull fill (log₂ levels, very small) and a field EMA.
  Memory cost is negligible next to the 100–200 MB kill threshold. Learned inpainting, line optimisation and NN flow should stay editor-only.

### Gaps
- No public, verified description of how Meitu or ByteDance implement their line-preserving correction (energy terms, solver, runtime). Only the talk summary exists.
- No measured on-device runtime for Shih et al.'s mesh optimisation in ms. Sources only say "interactive rate".
- I did not verify that small mobile inpainting models (e.g. MI-GAN, LaMa variants) exist with permissive licences and suitable sizes for browser use. This should be checked separately.
- Not verified here: whether iOS Safari's WebGL2 exposes `EXT_color_buffer_float` / `EXT_color_buffer_half_float`, which make RG16F colour-renderable. If not, fall back to RGBA8 with two 8-bit halves per component (filtering would then need to be done manually).

## Papers: Zhou 2010, Ren CVPR 2022 (BR-5K), Deep Shapely Portraits, 2023–2026 work, and what they imply for on-device

### Takeaway
The literature has moved from 3D-model-driven warps (Zhou 2010; minutes of user interaction) to learned 2D flow fields (Ren 2022 FBBR; Deng 2024/WACV 2025 AAGN; ~7M-parameter generators at 256×256) to diffusion (Diff-Body WACV 2024, Odo 2025). None of these can be shipped in MonaLisa. FBBR's code, weights and BR-5K are academic/non-commercial only, AAGN's licence is unknown, and diffusion is far too heavy. What *can* be reused are the ideas:
- smooth low-res flow, upsampled;
- flow perpendicular to the limbs;
- a single scalar µ that scales the flow for continuous sliders;
- height handled separately by non-uniform vertical scaling;
- matting plus background fill to fix background distortion.

A small flow network (~6.7M params, ~13 MB fp16) is technically plausible in a browser. But there is no licence-clean model or dataset, so rule-based analytic fields are the realistic v1.

### Cited Findings
- **Zhou, Fu, Liu, Cohen-Or, Han, "Parametric Reshaping of Human Bodies in Images", ACM TOG 29(4) Art. 126, SIGGRAPH 2010.**
  - Fits a 3D whole-body morphable model so editing is globally consistent. Users adjust semantic sliders such as height, weight and waist girth.
  - A "body-aware image warping" transfers the model's reshaping to the image "even under moderate fitting errors".
  - The image shape is deformed so "its changes with respect to its skeleton, especially on the body contours, are as similar as possible to the corresponding changes at the 3D human model". The paper compares against body-oblivious RBF and MLS warps.
  - — [ACM DL](https://dl.acm.org/doi/10.1145/1778765.1778863), [SIGGRAPH history](https://history.siggraph.org/learning/parametric-reshaping-of-human-bodies-in-images-by-zhou-fu-liu-cohen-or-and-han/), [project page](https://hongbofu.people.ust.hk/projects/ParametricBodyReshaping/index.html)
  - FBBR notes such 3D model-based methods "usually need a dozen minutes of user assistance [39]" (ref 39 = Zhou et al.), or extra sensors/depth. — [Ren et al. 2022](https://arxiv.org/abs/2203.04670)
  - No code licence is stated on the project page. — [project page](https://hongbofu.people.ust.hk/projects/ParametricBodyReshaping/index.html)
- **Ren, Yao, Lei, Cui, Xie (Alibaba DAMO), "Structure-Aware Flow Generation for Human Body Reshaping", CVPR 2022, pp. 7754–7763.** — [arXiv 2203.04670](https://arxiv.org/abs/2203.04670), [CVF](https://openaccess.thecvf.com/content/CVPR2022/html/Ren_Structure-Aware_Flow_Generation_for_Human_Body_Reshaping_CVPR_2022_paper.html)
  - **Pipeline.** Downsample the input. A pose estimator based on OpenPose predicts 12 skeleton maps and 10 PAF channels. The Flow Generator takes RGB concatenated with the skeletons at **256×256** and has a Structure Affinity Self-Attention (SASA) bottleneck guided by the PAFs. Its output flow F_l is the same size as the input. F_l is **bilinearly upsampled** to full res and warps the original image: O_h = W(I_h; µF_h).
  - **Losses.** L1 image loss, L1 flow loss against PWC-Net flow computed between original and retouched images, and a PAF orthogonality loss (λ_img = 15, λ_flow = 15, λ_orth = 2). Trained with Adam, lr 2e-5, batch 32.
  - **Continuous control.** µ ∈ [−1, 1] rescales the same flow (sign = lose or gain weight), so sliders only need to redo the warp.
  - **Speed.** About 5 s for a 4K photo on a 16 GB Tesla P100, including pose, flow and warp.
  - **Scope.** It edits weight only; height is left to non-uniform scaling.
  - **Background.** Distortion on the background is an acknowledged limitation.
  - **BR-5K.** 5,000 2K portraits from Unsplash, faces obfuscated, mostly female. Ethnicity split African:Asian:Caucasian = 0.33:0.35:0.32. Three professional retouchers worked in Photoshop and the best edit is the target. Split 4,500 train / 500 test.
  - **Metrics.** The paper reports SSIM 0.8354, PSNR 24.7924, LPIPS 0.0777. The repo, using a newer OpenPose, reports 0.8394 / 25.5801 / 0.0684. — [GitHub](https://github.com/JianqiangRen/FlowBasedBodyReshaping)
  - **Licence.** Code is "© Alibaba, 2022. For academic and non-commercial use only". BR-5K is academic and non-commercial only, with a signed agreement and an institutional email required. Weights are distributed via Google Drive / Baidu. — [GitHub JianqiangRen/FlowBasedBodyReshaping](https://github.com/JianqiangRen/FlowBasedBodyReshaping)
- **Deng, Liu, Li, Wang, "Structure-Aware Human Body Reshaping with Adaptive Affinity-Graph Network" (AAGN), arXiv 2404.13983 (v1 2024-04, v3 2025-01), WACV 2025.**
  - Builds a fully connected body-part affinity graph and a Body Shape Discriminator with SRM high-frequency filters, then upsamples and warps the low-res flow as FBBR does.
  - On BR-5K: SSIM 0.8427 / PSNR 26.4100 / LPIPS 0.0643, vs FBBR 0.8354 / 24.7924 / 0.0777. User preference 51.8% vs 32.1%.
  - Parameters: **AAGN 6.9M vs FBBR 6.7M**. Reported runtime is 3.54 ms vs 3.75 ms (the extracted summary garbled which is faster, and the hardware is unspecified).
  - Code: github.com/Randle-Github/AGGN.
  - — [arXiv abs](https://arxiv.org/abs/2404.13983), [ar5iv HTML](https://ar5iv.labs.arxiv.org/html/2404.13983), [WACV PDF](https://openaccess.thecvf.com/content/WACV2025/papers/Deng_Structure-Aware_Human_Body_Reshaping_with_Adaptive_Affinity-Graph_Network_WACV_2025_paper.pdf)
- **NeuralReshaper (Chen, Shen, Fu, Chen, Zhou, Zheng; arXiv 2203.10496, final 2023-08).** Fits a parametric 3D model, reshapes it, then a conditional GAN with separate foreground and background branches and feature-space warping generates the result. It uses self-supervised training because paired data is lacking. — [arXiv](https://arxiv.org/abs/2203.10496)
- **Odo (Khandelwal, Kamath, Jain; arXiv 2508.13065, Aug/Sep 2025).** Diffusion with a frozen UNet plus a ControlNet on target SMPL depth. New dataset of 18,573 images of 1,523 subjects. Per-vertex error 7.5 mm vs 13.6 mm for baselines. The arXiv listing shows CC BY 4.0, which is the *paper* licence and not necessarily the code's. It also cites Diff-Body (WACV 2024, diffusion-based pose and shape editing). — [arXiv 2508.13065](https://arxiv.org/abs/2508.13065)
- **Deep Shapely Portraits (Xiao, Tang, Wu, Jin, Yang, Jin; ACM MM 2020, pp. 1800–1808).** *Face* reshaping. A network estimates the best "shapely degree", which then drives reshaping of a 3D face reconstructed with a dense 3DMM rather than sparse landmarks. — [ACM DL](https://dl.acm.org/doi/abs/10.1145/3394171.3413873), [project page](http://www.cad.zju.edu.cn/home/jin/mm2020/acmmm2020.htm). Its follow-up, "Parametric Reshaping of Portraits in Videos" (ACM MM 2021), extends the warping to whole video sequences. — [arXiv 2205.02538](https://arxiv.org/pdf/2205.02538)
- **Real-time reshaping with depth (Richter et al., MPI, 3DIMPVT 2012).** A virtual mirror that changes height, muscularity, weight, waist girth and leg length. It fits a 3DMM to depth data and runs tracking, segmentation, deformation and image warping in real time. — [PDF](https://vcai.mpi-inf.mpg.de/files/3DimPVT/human_reshape.pdf) (search snippet)
- **Small flow networks can run on iOS.** A 2023 CGF paper deploys a small optical-flow network on iPhone/iPad at interactive rates (24 FPS on iPad Pro 2020) for temporal consistency. This is evidence that ~MB-scale flow CNNs are feasible on Apple GPUs natively; it is not a body-reshaping model. — [Shekhar et al., CGF 2023](https://onlinelibrary.wiley.com/doi/10.1111/cgf.14891) (search snippet)
- **Mobile body-beautification model sizes from industry.** The patent reports a 3 MB total for detection plus keypoints at 30 fps. — [US 11450080](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/11450080)

### Inferences
- **Browser feasibility of a learned flow:**
  - Weights: an FBBR/AAGN-sized generator is ~6.7–6.9M params, so ≈27 MB fp32, ≈13.5 MB fp16, ≈7 MB int8, plus a pose prior. The app's MediaPipe pose landmarks could be rasterised into skeleton maps and PAFs instead of running OpenPose.
  - Compute: 256×256 inference per photo is plausible in the editor via WebGPU or WASM with self-hosted runtimes (CSP `connect-src 'self'`).
  - Blockers: **(a) licences.** FBBR code, weights and BR-5K are all non-commercial; AAGN's licence is unverified. **(b)** Collecting your own retoucher-paired dataset is costly. **(c)** Runtime memory for an ONNX/TF.js session on iOS Safari is unknown and risky near the 100–200 MB kill limit.
  - Recommendation: v1 should use rule-based analytic fields. Treat a learned flow as an optional editor-only "auto 美體" later, only if a permissively licensed model appears.
- **Ideas to borrow without code:**
  - Flow perpendicular to the limbs (capsule fields).
  - Evaluate at low res and upsample bilinearly.
  - One global multiplier µ per slider; note that negative µ means "gain".
  - Height handled separately with 1D scaling.
  - Matting plus background fill as the fix for background distortion.
  - From Zhou: drive changes *relative to the skeleton*, especially at the contours. Measure W from the person mask along each bone's normal, rather than guessing from keypoints alone.
- **Reuse and licences:**
  - GPUPixel-derived shader primitives are Apache-2.0 (per the reshape.ts header), so they can be reused with attribution.
  - The Schaefer MLS *algorithm* is free to implement from the paper.
  - No reference code from FBBR or AAGN may be copied into a commercial app, and AAGN's licence is unverified.
  - The cuixing158 MLS repo licence was not checked.

### Gaps
- FBBR weight file sizes are not documented on GitHub. The 6.7M-parameter figure comes from AAGN's comparison table as extracted by a summariser, and the runtime hardware is unspecified.
- Could not read the Zhou 2010 full text (the project-page PDFs could not be downloaded here). The exact body-aware warp energy and terms are unverified, and NeuralReshaper's description (full-image Delaunay plus saliency map) is second-hand.
- AAGN repo licence not checked. Diff-Body (WACV 2024) known only from Odo's references.
- I found no 2025–2026 paper on *lightweight / on-device / real-time video* body reshaping. A search for it returned only patents and general temporal-consistency work.
- Not verified here: whether iOS 26/27 Safari WebGPU is stable enough for ONNX Runtime Web inside a Home Screen web app.

## Concrete GPU-implementable recipes (waist, waist-hip ratio, long legs, slim legs/arms, shoulders, chest, small head, swan neck; frame size handling)

### Takeaway
Implement one new **BodyWarp** stage made of two passes.
1. A ¼-res RG16F *backward displacement field* built from analytic primitives in iso space: bone capsules, radial `scaleAround`/`shiftAround`, and 1D vertical bands. It is multiplied by a feathered, dilated person mask and by part-exclusion weights, with an analytic strength clamp so it cannot fold.
2. A full-res apply pass `src(uv + D(uv))`, with optional composite over a cheap background fill.

Each slider maps to the gain of one or two primitives. 長腿 and 天鵝頸 use full-width vertical bands, which keeps horizontal and vertical lines straight. Lost frame height is handled by crop, by compensating in head-room or floor bands, or by clamping the gain.

### Cited Findings
- Ren et al. predict flow at 256×256, upsample bilinearly and warp the full-res image, so a low-res field is enough. A single multiplier µ gives continuous control, and height is handled by non-uniform scaling along the body length direction. — [Ren et al. 2022](https://arxiv.org/abs/2203.04670)
- Limb-width edits produce flow perpendicular to the limb, and length and direction are unchanged. — [Ren et al. 2022](https://arxiv.org/abs/2203.04670)
- Industrial 美體 computes target points for slim-leg and slim-waist from keypoints and warps with MLS. — [CSDN Trent1985](https://blog.csdn.net/Trent1985/article/details/80667611). ByteDance's long-leg feature uses a preset deformation function over a region located from leg keypoints, followed by line-straightening correction. — [腾讯新闻](https://news.qq.com/rain/a/20220313A03FNH00)
- Strip-mesh 大长腿: stretch the middle rectangle of an 8-vertex / 6-triangle strip and let bilinear filtering resample. — [CSDN lin1109221208](https://blog.csdn.net/lin1109221208/article/details/108047624), [简书](https://www.jianshu.com/p/e7fd02e1924e) (search summary)
- The existing engine already has `scaleAround` (fold-free for |d| ≤ 0.5), `shiftAround` with a (1−w²)² falloff, iso-space distances, and a box early-out. — local file `D:/GitSource/MonaLisa/src/engine/passes/reshape.ts` (read in this session)

### Inferences
All recipes below are **my design proposals**. They are derived from the sources and the existing shader, but untested. Coordinates: UV with y increasing *downward* (adapt if the engine's UV y points up). Iso space is (x, y/aspect), as in reshape.ts.

- **Field pass (¼ res, RG16F), per texel:**
  ```glsl
  // backward displacement in UV; k>0 = slimmer (sample farther from the bone axis)
  vec2 capsule(vec2 x, vec2 A, vec2 B, float W, float rho, float k, float e /*joint fade, >0*/) {
    vec2 a = iso(A), p = iso(x), ab = iso(B) - a;
    float L = max(length(ab), 1e-6); vec2 u = ab / L, n = vec2(-u.y, u.x);
    float t = dot(p - a, u) / L, v = dot(p - a, n), r = abs(v) / (W * rho);
    if (r >= 1.0 || t <= -e || t >= 1.0 + e) return vec2(0.0);
    float along = smoothstep(-e, e, t) * (1.0 - smoothstep(1.0 - e, 1.0 + e, t));
    float phi = (1.0 - r * r); phi *= phi;
    vec2 d = n * (v * k * along * phi);            // iso units
    return vec2(d.x, d.y * uAspect);               // back to UV
  }
  // D = Σ capsules + Σ radial prims + band(y); D *= Mf(x) * (1 - excl(x)); outD = D;
  ```
  - Strength guard: on the CPU, clamp each k·a ≤ 0.8, which keeps the ring stretch ≤ 1/(1−0.64) ≈ 2.8× in the worst case. The UI should cap it far lower, around k ≤ 0.3.
  - Where capsules overlap, clamp the sum of k·a below 1.25.
  - Optionally, in debug builds, compute det(J) of the field with finite differences and visualise any texels where det(J) < 0.3.
- **Apply pass (full res):** `vec2 d = texture(uField, vUv).xy; outColor = texture(uSrc, vUv + d);`. Optionally composite: `mix(fill, warped, warpedMaskAlpha)` with a push-pull background fill (photo editor, or live when a slider is high).
- **Pipeline order:** run BodyWarp **after** the face passes (skin, makeup, face reshape). The face landmarks those passes use then stay valid, and any body motion of the head (小頭, 天鵝頸) carries the finished face along rigidly. Exclude the face disc from torso and arm capsules via the exclusion weight.
- **Per-part width W:** on the CPU, read the low-res person mask along each bone's normal at 3–5 stations and take the median half-width. Smooth it over time with hysteresis. Fall back to keypoint-ratio defaults when the mask is unavailable, e.g. upper arm W ≈ 0.12–0.15 × shoulder width (a tuning guess, not from a source).

**Per-slider recipes** (amount s ∈ [0,1] from the UI). k_max values are starting points for tuning:

- **瘦身 overall slimming:** apply capsules to torso (mid-shoulder → mid-hip, W = torso half-width), both upper arms, forearms, thighs and calves, all with the same k = 0.18·s. ρ ≈ 2.0 for the torso and 1.7 for limbs; joint fade e ≈ 0.15. This approximates the FBBR-style perpendicular flow.
- **細腰 waist:**
  - Torso capsule with an along-axis bump instead of a flat window: a(t) = (1 − ((t − t_w)/σ)²)², with t_w ≈ 0.62–0.7 from the shoulders toward the hips and σ ≈ 0.3 (tuning guesses).
  - k = 0.25·s. W comes from the mask at the waist station.
  - Exclude the arm capsules (arms beside the waist) and hands (hand-on-hip). When the mask shows no gap between arm and torso, compress only the side that faces background (one-sided φ).
- **腰臀比 waist-hip ratio:**
  - Pair the waist bump (k_w > 0) with a hip bump at t_h ≈ 1.0–1.1 (just below the hip line) of *negative* k_h. Negative k samples closer to the axis, so the hips get wider.
  - From a target ratio WHR' and the measured W_w and W_h, solve for k_w and k_h on the CPU, splitting the change about 70% waist / 30% hips.
  - Widening covers background instead of revealing it, so it causes no holes. For a negative k the fold bound is the centre slope 1 + k > 0, i.e. |k| < 1.
- **美臀 / 提臀 hip lift:** mainly for back or side poses. An anisotropic `shiftAround` centred on each buttock (hip keypoint, shifted down by ~0.15 torso length), with an elliptical radius (wider than tall). Displacement is upward along the torso axis, ≈ 0.04·torsoLen·s. Optionally a small `scaleAround` (d ≤ 0.15). Gate it off for frontal selfies, judged by the shoulder/hip z-order or visibility.
- **長腿 long legs:** a **full-width** vertical band. Hip line h is the mean hip-keypoint y, optionally moved up by α·(knee − hip) to start above the hips. Transition half-width b ≈ 0.03–0.05. Stretch factor S = 1 + 0.12·s.
  - Backward map (C1-continuous, monotonic for S > 0):
    ```glsl
    float legBand(float y, float h, float b, float S) {   // returns source y
      float tau = clamp((y - (h - b)) / (2.0 * b), 0.0, 1.0);
      float I = tau*tau*tau - 0.5*tau*tau*tau*tau;         // ∫ smoothstep
      return y + (1.0/S - 1.0) * (2.0*b*I + max(0.0, y - (h + b)));
    }   // for y >= h+b this equals h + (y-h)/S, i.e. pure scaling about h
    ```
  - Because D_y depends only on y, verticals stay vertical and horizontals stay horizontal. This avoids the bent-road problem that ByteDance had to correct.
  - Disable or fade it when knees or ankles are not visible (typical front-camera selfie).
- **Keeping the frame size for 長腿** (output row 1 samples source row f(1) = h + (1−h)/S < 1, so the bottom is lost):
  - **(a) Crop (simplest):** clamp S so the feet stay inside: S ≤ (1 − h)/(y_feet + m − h), with margin m ≈ 0.02.
  - **(b) Compensate in background bands:** add a second band that *compresses* empty floor below the feet, or head-room above the head (slope > 1 there). Size it so ∫f′ = 1, which keeps the full frame without cropping. This needs room in the frame, and those bands are usually walls, floor or sky where compression is invisible.
  - **(c) Uniform rescale:** do not use. Rescaling everything vertically squashes the upper body.
  - Expose (a) by default with (b) automatic when there is room. The photo editor can also offer canvas extension (output taller than input), which is only acceptable for stills.
- **瘦腿 slim legs:** thigh (hip → knee) and calf (knee → ankle) capsules. k = 0.22·s for thighs and 0.15·s for calves; ρ ≈ 1.7; e ≈ 0.12 so knees are not pinched.
  - If the mask has no background between the legs (they touch), use one-sided φ that compresses only the outer contour. Otherwise each leg samples texture from the other.
- **瘦手臂 slim arms:** upper-arm capsule (shoulder → elbow), k = 0.25·s; forearm 0.1·s. Arms beside the torso get one-sided compression on the outer side only. Exclude the hands.
- **直角肩 / 美肩 shoulders:** at each shoulder keypoint, an anisotropic `shiftAround` lifts the outer shoulder and flattens the neck–shoulder slope. Displacement is upward by ≈ 0.25·(y_shoulder − y_neckbase)·s, with radius ≈ 0.5 × the shoulder-to-neck distance, and the falloff kept above the armpit.
  - Optional widening for 美肩: a small outward `shiftAround`.
  - Risk: it can bend the neck or hair. Use a C2 falloff and exclude the face.
- **胸部 chest:** two `scaleAround` (magnify, d ≤ 0.2·s) at centres estimated from the shoulders: down ~0.25–0.3 torso length, laterally ±0.2 shoulder width (tuning guesses). Radius ≈ 0.22 shoulder width. Keep the default low and gate it by frontal pose. Landmarks under clothing are unreliable. FBBR's authors explicitly flag ethical concerns about body-editing misuse. — ethics mention: [Ren et al. 2022](https://arxiv.org/abs/2203.04670)
- **小頭 head size:** `scaleAround` with **d < 0** (factor > 1 means sample farther away, i.e. shrink). d = −0.12·s, within |d| ≤ 0.5.
  - Centre: about midway between the face centre and the crown.
  - R ≈ 1.4–1.7 × the forehead-to-chin height, so hair is included.
  - Multiply by a downward fade below the chin, so the shoulders are not pulled up.
  - Shrinking lifts the chin slightly, so the neck lengthens. That combines naturally with 天鵝頸.
  - The ring around the head is stretched, which is visible on textured backgrounds. Keep R generous.
- **天鵝頸 swan neck:** do not stretch the neck band horizontally-locally. Translate the whole head up instead: a vertical-only displacement Δ = 0.03·faceHeight·s. Its weight is 1 above the chin and falls smoothly (smoothstep) to 0 at the shoulder line, inside an ellipse covering head, hair and neck plus a margin.
  - Since the displacement is vertical only and varies mainly with y, nearby horizontals stay straight, and verticals bend only at the ellipse rim.
  - It moves the already-retouched face rigidly, which is the reason BodyWarp runs after the face passes.
- **Temporal (live camera):**
  - Smooth the landmark-derived quantities (h, W per part, bone endpoints, head centre and R) with a One-Euro or EMA filter, adding a dead-zone on W.
  - Fade the per-part gain with landmark visibility.
  - Optionally EMA the field texture (α ≈ 0.5). Reset it on scene cuts or person loss.
- **Budget check:** field pass at ¼ res with about 16 capsules plus 6 radial primitives plus 1 band is about 130k texels × ~25 primitives. The apply pass is 1 texture read plus 1 dependent read per pixel. Both are trivial next to the existing skin and makeup passes. Memory is under 1 MB for field and mask.

### Gaps
- None of the numeric gains, ratios or anatomical offsets above (t_w, σ, k_max, radii) come from a source. They are starting points to tune visually against reference retouches.
- I found no published per-part parameter tables from Meitu, Snow or ByteDance.
- The one-sided-falloff and part-exclusion heuristics are my proposals. I found no source that documents how apps handle touching legs or arms against the torso.
- How pose landmarks and the person mask get to the GPU (which models, sizes, iOS memory) is outside this note. Another research thread covers it.
