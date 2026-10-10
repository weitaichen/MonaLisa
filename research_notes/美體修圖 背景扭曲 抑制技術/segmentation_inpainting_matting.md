# Warp only the person, keep the background rigid, fill the revealed gap: segmentation/matting + inpainting for MonaLisa 美體

Scope: on-device options for (a) person alpha mattes, including hair, and (b) filling the background strip that appears when a body is slimmed, for an iPhone-first, all-on-device PWA (WebGL2, CSP `connect-src 'self'`, ~100–200 MB page-kill budget). Research date 2026-10-08. The earlier report already covers: the dilate-Δ/feather-4Δ field protection and its `1 + Δ/(δ+f)` ring-stretch rule; FBBR/NeuralReshaper statements that matting plus a clean background fixes background distortion; push-pull fill for slivers ≤1–2 % of width; MediaPipe segmenter sizes; ORT-Web Safari bugs. Those points are not repeated here. File sizes were measured on 2026-10-08 with the Hugging Face tree API and the GitHub releases API (bytes, exact). Licences come from the GitHub API `license.spdx_id` or the HF card, unless stated otherwise.

## Q1. Compositing pipeline: rigid background layer, warped person layer, filled revealed pixels; seams, alpha and halo avoidance

### Takeaway
The layered pipeline is: estimate the alpha α and the foreground colour F, build a background plate B with the person region filled, warp only F and α with the existing backward field, then composite `out = α'·F' + (1−α')·B`. This removes background bending completely, but only where B is plausible. Commercial-grade edges come from three cheap steps, none of which needs a heavy model: refine the low-res mask edge against the image (joint-bilateral or guided filter), re-estimate the foreground colour in the soft edge so the old background does not travel with the person (Blur-Fusion), and soften the edge where the new background differs (light wrapping).

### Cited Findings
- **Production web reference (Google Meet, 2020).** Segmentation runs at 256×144 or 160×96. The model is about 400 KB and 193K params, with float16 export halving the size. Inference is TFLite+XNNPACK on WebAssembly SIMD. The low-res mask is smoothed with a **joint bilateral filter**, and further boundary refinement is skipped on low-end devices. Background blur uses mask-weighted, CoC-like per-pixel radii so "foreground pixels don't bleed into the background", and separable filters instead of a Gaussian pyramid "removes halo artifacts". Background replacement uses **light wrapping**: background light spills onto foreground edges, which softens edges and reduces halos when foreground and new background contrast strongly. At 720p, a MacBook Pro 2018 took 8.3 ms inference and 14.3 ms end-to-end; a Celeron Chromebook took 16.1 / 30 ms. IoU was 93.58 % (256×144) and 90.79 % (160×96) — [Google Research blog, 2020-10-30](https://research.google/blog/background-features-in-google-meet-powered-by-web-ml/)
- **Foreground colour estimation (the halo fix).** Compositing needs both α and the foreground's colours in the semi-transparent pixels. Without that colour estimate, the original background bleeds through. Forte's "Blur-Fusion" approximates Germer et al.'s multi-level estimator in about 11 lines. It box-blurs α, F·α and B·(1−α), normalises them, and updates `F = F̄ + α·(I − α·F̄ − (1−α)·B̄)`. One variant uses a single pass with r = 90. Another adds a second pass with r = 6. The paper won Best Industry Paper at ICIP 2021, and Photoroom applies it by default in its background-removal API — [Forte, ICIP 2021 (IEEE)](https://ieeexplore.ieee.org/document/9506164/); [Photoroom/fast-foreground-estimation](https://github.com/Photoroom/fast-foreground-estimation) (the GitHub API reports **no licence file**, so treat the code as all-rights-reserved and re-implement from the paper); predecessor: [Germer et al., Fast Multi-Level Foreground Estimation, arXiv 2006.14970](https://arxiv.org/pdf/2006.14970) (implemented in [pymatting](https://github.com/pymatting/pymatting), **MIT**)
- **Research systems identify the same fix.** FBBR says flow-based reshaping "will also affect the overlapped areas in the background", and proposes background matting plus blending onto an intact or inpainted background. It notes that the intact background "is hard to obtain" and that high-res matting is difficult — [Ren et al. 2022, arXiv 2203.04670](https://arxiv.org/abs/2203.04670) (already in the earlier notes; restated only because it motivates this pipeline)
- **Commercial "lock background" wording.** YouCam says the warp is constrained to the segmented silhouette. FaceApp's "Lock Background" fixes the background before editing — [Perfect Corp](https://yce.perfectcorp.com/products/body-reshape), [FaceApp blog](https://www.faceapp.com/blog/tips-and-tricks-reshape-tool/) (from the earlier notes; neither says whether it inpaints or stretches)

### Inferences
- **Concrete pipeline for MonaLisa (editor path; my design, not taken from any source):**
  1. **α.** Upsample the existing PoseLandmarker person mask, refined with a guided filter using the full-res luminance as guide (see Q3). Optionally use MODNet for hair-quality α.
  2. **F.** Run Blur-Fusion on the GPU, only inside the edge band `0.02 < α < 0.98`. The r = 90 box blur is separable and can run at ½–¼ resolution.
  3. **Hole H** = `dilate(α_old > 0.02, 2–3 px) ∩ (α_new < 0.98)`, where α_new = α warped by the field. B only needs to be valid inside H. Elsewhere B = I. Dilating H by a few pixels removes edge pixels contaminated by the person before filling. Without this, the fill copies the person's colour fringe into the background (the classic "ghost outline").
  4. **Fill H** with one of the Q2 methods.
  5. **Warp the person layer.** `F' = F(x + D(x))` and `α' = α(x + D(x))`, using the same low-res backward field D the engine already builds. Because the background is a separate rigid layer, the person-layer field no longer needs the 背景保護 multiplier. Keeping a narrow feather is still wise so that α' and F' stay consistent.
  6. **Composite** premultiplied: `out = α'·F' + (1−α')·B`. Add an optional 1–2 px light wrap (blend a blurred B into F' where α' ≈ 0.5–0.9) only when B was synthesised.
- **This removes the root cause of background bending:** background pixels are never moved. Error moves from geometry (bent lines) to texture (an implausible fill). A wrong fill is usually less noticeable than a bent door frame, but it can look smeared on strong textures.
- **Things the layered pipeline does NOT fix, and that need guards:**
  - Cast and contact shadows of the person stay in place (the feet's floor shadow no longer matches a slimmer leg).
  - Objects that occlude the person (a bag strap, a chair arm) are in the person mask and get warped.
  - People touching other people.
  - Hair or loose clothing outside a coarse mask. The pose-model mask is coarse at hair; see Q3.
  Keep the field-stretch path as the fallback, and use it when H touches another person or when the matte confidence is low.
- **Hybrid that limits the fill width.** Let the existing feathered stretch absorb part of Δ (for example ≤ 1 % of frame, where the ring stretch is invisible), and let the layered fill take the rest. This roughly halves the strip the fill must handle and avoids a visible seam where fill meets untouched background.

### Gaps
- No source describes how Meitu, 醒圖 or BeautyPlus actually build the background behind a slimmed body (inpainting vs stretch). This was already a gap in the earlier notes and is still unresolved.
- No published measurement of Blur-Fusion cost on a phone GPU. The method is two box blurs plus per-pixel arithmetic, so it should be cheap (inferred).

## Q2. Fill methods by cost: push-pull, Telea/NS (OpenCV.js), PatchMatch, edge/direction-aware stretching, learned inpainting (LaMa, MI-GAN, MAT, SD); browser feasibility, iPhone memory/latency, CSP

### Takeaway
For MonaLisa, the only learned inpainter that is permissively licensed (**MIT code and MIT weights**), small enough (**28,079,181 B** ONNX pipeline, 5.98 M params) and already proven in browsers is **MI-GAN**. It should be lazy-loaded in the photo editor only and run through ONNX Runtime Web: WASM on iOS 18, WebGPU on Safari 26+. LaMa is Apache-2.0 but **~208 MB fp32 with a fixed 512×512 input**, which exceeds the low-RAM iPhone budget. MAT is **CC BY-NC 4.0** and must not be used. SD-class inpainting is far too large. Below the learned tier: GPU push-pull (live-capable, blurry); Telea/NS through OpenCV.js (a ~11 MB library, sharp only up to ~10–15 px); and a hand-written WebGL2 directional or "mirror" fill (my proposal, not sourced). No ready WebGL PatchMatch exists, and the GIMP Resynthesizer is **GPL-3.0**.

### Cited Findings
**Learned inpainting**
- **MI-GAN (Picsart, ICCV 2023).** Authors' claim: "to the best of our knowledge, there is no image inpainting model designed to run on mobile devices". MI-GAN is "one order of magnitude" cheaper and smaller than SOTA. It is trained by distilling Co-Mod-GAN, with re-parametrization — [ICCV 2023 paper](https://openaccess.thecvf.com/content/ICCV2023/papers/Sargsyan_MI-GAN_A_Simple_Baseline_for_Image_Inpainting_on_Mobile_Devices_ICCV_2023_paper.pdf)
  - Paper Table 1 (256, Places2): MI-GAN has **5.95 M params** and **11.19 GFLOPs**, FID 11.83 and LPIPS 0.394. LaMa has 27.05 M params and 32.05 GFLOPs, FID 22.00 and LPIPS 0.378. MAT has 59.78 M / 140.74 GFLOPs, and LDM has 387.25 M / 6,896 GFLOPs (the PDF text was re-extracted by word position to keep the columns aligned) — [paper](https://openaccess.thecvf.com/content/ICCV2023/papers/Sargsyan_MI-GAN_A_Simple_Baseline_for_Image_Inpainting_on_Mobile_Devices_ICCV_2023_paper.pdf)
  - Paper Table 2 (512, Places2): MI-GAN has **5.98 M params**, **15.69 GFLOPs**, FID **10.00** and LPIPS **0.345**. LaMa (27.05 M, 128.06 GFLOPs) scores FID 12.36 and LPIPS 0.314. MAT (61.56 M, 288.78 GFLOPs) scores FID 8.67 and LPIPS 0.339. The text says that at 512, MI-GAN "performs similarly to LaMa and ZITS in terms of FID and slightly underperforms Co-Mod-GAN, SH-GAN, LDM and MAT" — [paper](https://openaccess.thecvf.com/content/ICCV2023/papers/Sargsyan_MI-GAN_A_Simple_Baseline_for_Image_Inpainting_on_Mobile_Devices_ICCV_2023_paper.pdf)
  - Paper Table 3 (256 resolution, **native ONNX on the device CPU, no optimisation**), MI-GAN vs Co-Mod-GAN, mean ms:

    | Device | MI-GAN | Co-Mod-GAN |
    |---|---|---|
    | iPhone 7 | 1030.25 | 4475.33 |
    | iPhone X | 630.80 | 2746.00 |
    | iPad mini 5 | 552.40 | 2686.17 |
    | **iPhone 14 Pro Max** | **296.00** | 1374.40 |
    | Galaxy S8 | 1476.40 | out of memory |

    The 512 timings are only in the supplement, which was not read — [paper](https://openaccess.thecvf.com/content/ICCV2023/papers/Sargsyan_MI-GAN_A_Simple_Baseline_for_Image_Inpainting_on_Mobile_Devices_ICCV_2023_paper.pdf)
  - Stated limitation: it "sometimes meets difficulties when reconstructing complex 3D structures" — [paper](https://openaccess.thecvf.com/content/ICCV2023/papers/Sargsyan_MI-GAN_A_Simple_Baseline_for_Image_Inpainting_on_Mobile_Devices_ICCV_2023_paper.pdf)
  - Training data: Places365-Standard (~1.8 M images) and FFHQ — [paper](https://openaccess.thecvf.com/content/ICCV2023/papers/Sargsyan_MI-GAN_A_Simple_Baseline_for_Image_Inpainting_on_Mobile_Devices_ICCV_2023_paper.pdf)
  - **Licence:** repo **MIT**, plus a separate `LICENSE-WEIGHTS` that is also **MIT** (© 2024 Picsart AI Research) — [GitHub](https://github.com/Picsart-AI-Research/MI-GAN), [LICENSE-WEIGHTS](https://github.com/Picsart-AI-Research/MI-GAN/blob/main/LICENSE-WEIGHTS)
  - **ONNX pipeline:** `migan_pipeline_v2.onnx` = **28,079,181 B**. Inputs are `image` uint8 [1,3,H,W] and `mask` uint8 [1,1,H,W]. H and W are dynamic. Mask polarity: **0 = hole, 255 = keep**. Output is the already-composited uint8 image. HF card licence MIT; the file is a verbatim mirror of andraniksargsyan/migan — [edgetools/migan](https://huggingface.co/edgetools/migan)
  - The pipeline internally converts uint8 to float, **crops around the mask, resizes to 512×512**, normalises, resizes back and blends. The authors advise that for large high-res areas, "the best results can be achieved with small, incremental brush strokes". Their paper timings exclude this pre/post-processing — [MI-GAN README, For Developers](https://github.com/Picsart-AI-Research/MI-GAN#for-developers)
  - **Browser evidence:** lxfater/inpaint-web runs MI-GAN with WebGPU/WASM (**GPL-3.0**, so do not copy its code). It has an open issue "chrome可用，safari报错" (#61, 2024-01-29), which is not diagnosed — [inpaint-web](https://github.com/lxfater/inpaint-web), [#61](https://github.com/lxfater/inpaint-web/issues/61)
  - sathwikbairaboina2/inpaint-web (**MIT**) benchmarks a 512×512 image with a 128×128 hole: WebGPU on an NVIDIA Lovelace GPU, median **39.7 ms**; 16-thread WASM on a Ryzen 9 7900X, median **1,543.3 ms**; session creation 869 ms (WebGPU) and 357 ms (WASM). Multi-threaded WASM needs cross-origin-isolation headers. It notes the 29.5 MB model exceeds Cloudflare Pages' 25 MiB per-file limit — [README](https://github.com/sathwikbairaboina2/inpaint-web)
- **LaMa (Samsung AI, WACV 2022).** Built on fast Fourier convolutions with image-wide receptive fields, a high-receptive-field perceptual loss and **large training masks**. It "generalizes well to resolutions above those seen in training" and handles periodic structures — [arXiv 2109.07161](https://arxiv.org/abs/2109.07161)
  - The README says it generalises "to much higher resolutions (~2k❗️) than it saw during training (256x256)". The paper figure lists LaMa-Fourier at **27 M** params and Big LaMa-Fourier at **51 M**. Big-LaMa is trained on Places2 — [advimman/lama](https://github.com/advimman/lama), [paper PDF](https://arxiv.org/pdf/2109.07161v2)
  - **Licence:** repo **Apache-2.0** (GitHub API). Training data is Places365. Whether Places' own terms constrain commercial use of the weights is not addressed by the repo (flag) — [GitHub](https://github.com/advimman/lama)
  - **ONNX:** `lama_fp32.onnx` = **208,044,816 B** and `lama.onnx` = 207,479,252 B. Both have a **fixed 512×512 input**, opset 17/18, and a custom FourierUnitJIT. The card calls the dynamo export slow ("NOT RECOMMENDED"). Licence apache-2.0 — [Carve/LaMa-ONNX](https://huggingface.co/Carve/LaMa-ONNX)
  - OpenCV Zoo ships `inpainting_lama_2025jan.onnx` = **92,591,623 B** (Apache, source listed as the Carve fp32 model; requires OpenCV ≥ 5.0). Why it is ~45 % of the Carve size was not verified; it may be fp16 or pruned — [opencv/inpainting_lama](https://huggingface.co/opencv/inpainting_lama)
  - An in-browser LaMa demo (webai.show) uses Carve/LaMa-ONNX on the plain WASM EP. next-lama says it does a good job "at least for small patches and homogenous backgrounds" — [webai.show](https://webai.show/models/lama-image-inpainting/), [Medium: next-lama](https://medium.com/@geronimo7/client-side-image-inpainting-with-onnx-and-next-js-3d9508dfd059) (both via search summary; the webai.show page failed to fetch)
- **MAT (CVPR 2022):** the repo licence file is **Creative Commons Attribution-NonCommercial 4.0** (GitHub API reports NOASSERTION; the LICENSE text was read) → **non-commercial, exclude** — [fenglinglwb/MAT](https://github.com/fenglinglwb/MAT). MI-GAN's table lists it at 61.56 M params and 288.78 GFLOPs at 512.
- **SD / LDM class:** LDM is 387.25 M params and 6,896 GFLOPs at 256 (MI-GAN Table 1). A WebGPU SD-style inpainting demo (Moebius) triggers a **1.27 GB** download on first run — [simonw Moebius demo](https://simonw.github.io/moebius-web/) (via search summary). This is not viable within the iPhone memory budget.

**Classical / GPU fills**
- **Push-pull (pull-push) pyramid interpolation.** It originates in the Lumigraph (Gortler et al. 1996) and is used for hole filling in point rendering. Kraus (GRAPP 2009) gives GPU-friendly variants and stresses correct filter normalisation. Earlier GPU versions inpainted texture-map gaps (Lefebvre 2005) and ran in linear time (Strengert 2006) — [Kraus 2009 PDF](https://www.cs.cit.tum.de/fileadmin/w00cfj/cg/Research/Publications/2009/Pull-Push_Algorithm/grapp09.pdf)
- **Telea (FMM) / Navier-Stokes.** Telea names the main limitation as blurring "when inpainting regions thicker than 10–15 pixels", especially where sharp isophotes meet the boundary tangentially. It uses ε ≈ 6 px for thin regions and 12 px for thicker ones — [Telea 2004, J. Graphics Tools](https://www.olivier-augereau.com/docs/2004JGraphToolsTelea.pdf)
  - pyheal: with larger masks or textured images, the "half-blurring half-stretching effect" becomes apparent — [olvb/pyheal](https://github.com/olvb/pyheal)
  - LearnOpenCV found INPAINT_NS somewhat better than TELEA in its tests — [LearnOpenCV](https://learnopencv.com/image-inpainting-with-opencv-c-python/)
- **OpenCV.js includes `cv.inpaint`.** The JS build whitelist's `photo` module lists `'inpaint'` — [opencv_js.config.py](https://raw.githubusercontent.com/opencv/opencv/4.x/platforms/js/opencv_js.config.py)
  - The prebuilt single-file `opencv.js` from docs.opencv.org/4.x (now 4.13.0) is **10,964,323 B** (measured download). The npm `@techstark/opencv-js` 5.0.0-release.1 is Apache-2.0, 14.7 MB unpacked. OpenCV itself is **Apache-2.0** — [docs.opencv.org/4.x/opencv.js](https://docs.opencv.org/4.x/opencv.js), [npm](https://www.npmjs.com/package/@techstark/opencv-js), [opencv/opencv](https://github.com/opencv/opencv)
- **inpaint.js** (antimatter15) is a pure-JS Telea port from scikit-image, about 2 KB of logic. The GitHub API reports **no licence** and it was last pushed in 2014 — [antimatter15/inpaint.js](https://github.com/antimatter15/inpaint.js/)
- **PatchMatch.** No maintained WebGL or JS PatchMatch inpainting library was found.
  - The parallel propagation problem is solved by jump flooding, reported at "5 times faster than the GPU implementation of Barnes's algorithm" — [Parallel-Friendly PatchMatch Based on Jump Flooding](https://www.researchgate.net/publication/278703228_Parallel-Friendly_Patch_Match_Based_on_Jump_Flooding) (via search summary)
  - A Unity compute-shader PatchMatch exists — [sotanmochi/PatchMatch-Unity](https://github.com/sotanmochi/PatchMatch-Unity)
  - A CMU project uses jump flooding for content-aware fill, with no licence per the GitHub API — [micahreich/patch-match](https://github.com/micahreich/patch-match)
  - The GIMP Resynthesizer (texture-synthesis fill) is **GPL-3.0** — [bootchk/resynthesizer](https://github.com/bootchk/resynthesizer)
  - Adobe holds patents on content-aware fill and patch synthesis, e.g. [US 10706509](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/10706509) and [US 8861868](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/8861868) (titles only seen; claims not analysed)

**Browser runtime / CSP facts relevant to MonaLisa**
- ORT-Web multi-threading only works when the browser supports wasm threads "and `crossOriginIsolated` mode is enabled". The default thread count is min(hardwareConcurrency/2, 4).
  - `env.wasm.wasmPaths` must point at same-build wasm files, which allows self-hosting.
  - The proxy worker "cannot be used with WebGPU EP" and cannot run in a CSP-restricted environment, because it creates the worker from a Blob — [ORT env flags](https://onnxruntime.ai/docs/tutorials/web/env-flags-and-session-options.html)
  - MonaLisa's `vercel.json` sets **no COOP/COEP headers** (checked locally), so ORT-Web would currently run **single-threaded** WASM. Its CSP does allow `'wasm-unsafe-eval'` and `worker-src 'self' blob:`.
- ORT-Web's WebGL backend is being deprecated: issue and PR "[Web] Deprecate the onnxruntime-web WebGL backend", opened 2026-08-24 and still open — [#32241](https://github.com/microsoft/onnxruntime/issues/32241), [PR #32246](https://github.com/microsoft/onnxruntime/pull/32246). On iOS 18 (no WebGPU), the practical ORT path is WASM.
- From the earlier notes, not re-researched:
  - ORT-Web 1.30.0 is MIT. `ort-wasm-simd-threaded.wasm` is 14,239,897 B and the JSEP/WebGPU wasm is 28,312,028 B — [npm onnxruntime-web](https://www.npmjs.com/package/onnxruntime-web)
  - There are open Safari 26 ORT bugs: memory above 1 GB / CPU 400 % with JSEP — [#26827](https://github.com/microsoft/onnxruntime/issues/26827); and a crash after ~500 WebGPU runs — [#27584](https://github.com/microsoft/onnxruntime/issues/27584)

### Inferences
- **Cost/quality ladder for MonaLisa (my ranking):**

  | Tier | Method | Extra download | Where | Fill quality on a 2–4 % strip | Licence risk |
  |---|---|---|---|---|---|
  | 0 | Current field stretch (ring) | 0 | live + editor | lines bend in a 4Δ ring | none |
  | 1 | GPU push-pull + grain | 0 (≈log₂N tiny passes) | live + editor | smooth, textureless; good on walls/sky/bokeh, smeared on texture | none |
  | 2 | WebGL2 directional / mirror fill (below) | 0 | live + editor | keeps texture and lines perpendicular to the edge; duplicates lines parallel to it | none |
  | 3 | Telea/NS (OpenCV.js `cv.inpaint`) | ~11 MB js+wasm | editor | sharp ≤ ~10–15 px, blurry beyond | Apache-2.0 |
  | 4 | MI-GAN 512 via ORT-Web | 28.1 MB model + 14.2 MB wasm | editor, lazy | plausible texture; weak on complex 3D structure | MIT/MIT (+Places/FFHQ data caveat) |
  | 5 | Big-LaMa via ORT-Web | 208 MB (or 92.6 MB OpenCV variant) | not on iPhone | best on wide/periodic holes | Apache-2.0 (+Places caveat) |
  | ✗ | MAT, SD/LDM inpainting | — | — | — | MAT CC BY-NC; SD too heavy |

  For PatchMatch, porting a jump-flooding PatchMatch to WebGL2 fragment passes is possible but is a project in its own right. Check the Adobe patents first. It gives sharp texture, with no model download.
- **Tier 2 proposal (unsourced design).** For a pixel p in the hole H, take the outward normal n and the distance t to the old silhouette edge (an SDF from a jump-flood pass on the mask), then sample B at `p + 2t·n` (mirror) or at `p + (t + w)·n` (translate by the strip width w).
  - Lines crossing the edge at right angles (floor lines meeting a vertical leg, horizon lines) continue exactly.
  - Lines parallel to the edge (a door frame next to the arm) get mirrored or duplicated.
  - Oblique lines get a chevron (mirror) or a step (translate).
  - Blending mirror and translate by a smooth weight, then adding push-pull at low frequency, reduces visible seams.
  - It is one fragment pass plus an SDF and runs in real time. Its failure mode is local (texture repetition), unlike the current method, which bends lines over a 4Δ band.
- **MI-GAN on iPhone Safari: expected latency** (inferred, not measured). Native ONNX CPU on an iPhone 14 Pro Max takes 296 ms at 256 (11.19 GFLOPs). At 512 the model needs 15.69 GFLOPs, about 1.4×. Single-threaded WASM-SIMD in Safari is typically several times slower than native multi-threaded CPU. **Expect roughly 1–4 s per 512 crop on recent iPhones on iOS 18, faster with WebGPU on Safari 26+.** That fits an editor "apply" step with a spinner, but not a live slider.
  - Memory: about 28 MB of weights in the wasm heap, plus 512×512 activations, plus ORT's ~14 MB wasm. A rough guess is 100 MB or less of peak extra memory, which still needs measuring.
  - Load the model only on first use, run it in a dedicated Worker (not ORT's proxy), dispose the session afterwards, and run it after the MediaPipe session has been released if memory is tight.
- **How the MI-GAN pipeline's crop-and-resize interacts with body slimming.** The hole H is a tall, thin strip along the body. Its bounding box is roughly the whole person (for example 2,400 px tall in a 12 MP portrait), so the pipeline would shrink it about 4.7× to 512, run, and upsample. The fill would then be soft (≈4.7× upsample) next to sharp background.
  - Better: tile H into overlapping crops of at most 1024 px (≤2× down), one inference each, and process per body part (each side of the waist, each leg edge). Or run the pipeline at a lower working resolution and add matched grain.
  - Feeding the full image with the pipeline's own crop is the simplest option, but the lowest quality.
- **Why LaMa does not fit:** a 208 MB fp32 file means at least 208 MB of weights resident in the wasm heap (or 92.6 MB for the OpenCV variant). That alone reaches or exceeds the 100–200 MB page-kill threshold recorded for low-RAM iPhones. It also has a fixed 512 input. Revisit only if a verified fp16 or int8 web build under about 50 MB appears.
- **Self-hosting checklist for any ORT model** (from the CSP facts above):
  - Serve `.onnx` and the ORT `.wasm` from `/models/` and `/ort/`, which `vercel.json` already makes immutable-cached.
  - Set `env.wasm.wasmPaths` to the same-origin path.
  - Add the model to the Service Worker cache only after the user opts in (28 MB).
  - Adding COOP `same-origin` + COEP `require-corp` would unlock threads (about 2–4× on CPU, inferred), but first check that MediaPipe, the camera, blob workers and any third-party embeds still work.

### Gaps
- No measured MI-GAN or LaMa latency or peak memory in **iOS Safari** (WASM or WebGPU) was found. The only iPhone numbers are native ONNX at 256.
- The MI-GAN 512 on-device timings are in the supplementary PDF, which was not read.
- The lxfater Safari error (#61) is undiagnosed. It may be WebGPU-specific or about memory.
- Vercel's static-file size limit for a 28 MB asset was not verified. Cloudflare Pages' 25 MiB limit is documented only in the sathwik README.
- Whether Places365 dataset terms affect commercial use of LaMa or MI-GAN weights was not researched (legal question).
- What exactly the OpenCV Zoo 92.6 MB LaMa file is, and whether it runs in ORT-Web, was not verified.
- Patent scope for PatchMatch/content-aware fill was not analysed.

## Q3. Matting: MediaPipe segmenters, MODNet, RVM, BiRefNet-lite, PP-Matting; size, licence, browser feasibility; refining a coarse mask to alpha on the GPU

### Takeaway
For MonaLisa, the cheapest good path is the **existing PoseLandmarker / selfie mask plus a GPU guided filter (or joint bilateral) refined against the photo**, with MediaPipe's hair segmenter added where hair crosses the strip. If true hair-level α is needed, **MODNet** (Apache-2.0 code and models; ONNX 25.9 MB fp32 / 13.0 MB fp16 / 6.6 MB uint8) is the right learned option. **RVM is GPL-3.0**, RMBG-1.4/2.0 use Bria's restrictive licences, and the ISNet ONNX is tagged AGPL-3.0, so all three must be avoided. BiRefNet-lite is MIT but its ONNX is 224 MB fp32 / 115 MB fp16, too heavy for iPhone. PP-MattingV2 is Apache-2.0 and more accurate than MODNet-MobileNetV2, but ships in Paddle format.

### Cited Findings
- **MediaPipe (already in the earlier notes; sizes only):**
  - `selfie_segmenter` 249,537 B
  - `hair_segmenter` 781,618 B (512×512)
  - `selfie_multiclass_256x256` 16,371,837 B
  - All Apache-2.0. On iOS Safari, multiclass needs the CPU delegate because of issue #6142 — see `research_notes/全身美體修圖 PWA 實作/browser_body_models.md` and [GitHub #6142](https://github.com/google-ai-edge/mediapipe/issues/6142)
- **MODNet (AAAI 2022).** "Real-time trimap-free portrait matting" from RGB only. Licence statement: "The code, models, and demos in this repository … are released under the Apache License 2.0". ONNX export is supported — [ZHKKKe/MODNet](https://github.com/ZHKKKe/MODNet)
  - HF `Xenova/modnet` (apache-2.0, a Transformers.js `background-removal` pipeline) measured sizes: `model.onnx` **25,888,640 B**, `model_fp16.onnx` **12,984,781 B**, `model_quantized.onnx` **6,632,188 B**, `model_uint8.onnx` 6,627,048 B, `model_q4f16.onnx` 11,801,931 B — [Xenova/modnet](https://huggingface.co/Xenova/modnet)
  - PaddleSeg's benchmark (512×512, Tesla V100, Paddle Inference):

    | Model | Params | GFLOPs | FPS | SAD |
    |---|---|---|---|---|
    | MODNet-MobileNetV2 | 6.5 M | 15.7 | 68.4 | 50.07 |
    | MODNet-HRNet_W18 | 10.2 M | 28.5 | — | 35.55 |

    — [PaddleSeg Matting README](https://raw.githubusercontent.com/PaddlePaddle/PaddleSeg/release/2.9/Matting/README.md)
- **PP-Matting family (PaddleSeg, Apache-2.0):**

  | Model | Params | GFLOPs | V100 FPS | SAD |
  |---|---|---|---|---|
  | PP-MattingV2-512 | 8.95 M | 7.51 | 98.89 | 40.59 |
  | PP-Matting-512 (HRNet-W18) | 24.5 M | 91.28 | 28.9 | 31.56 |
  | PP-HumanMatting | 63.9 M | 135.8 @2048² | — | 53.15 |

  The README claims PP-MattingV2 is 44.6 % faster than MODNet with 17.91 % lower error. The models are distributed as Paddle `.pdparams` or inference zips. FastDeploy (Apache-2.0) supports deploying them — [PaddleSeg Matting](https://raw.githubusercontent.com/PaddlePaddle/PaddleSeg/release/2.9/Matting/README.md), [PaddleSeg licence](https://github.com/PaddlePaddle/PaddleSeg), [FastDeploy](https://github.com/PaddlePaddle/FastDeploy)
- **RVM (Robust Video Matting)** repo licence is **GPL-3.0** (GitHub API). Release assets measured:
  - `rvm_mobilenetv3_fp32.onnx` **14,975,696 B**
  - `rvm_mobilenetv3_fp16.onnx` **7,503,483 B**
  - `rvm_mobilenetv3_tfjs_int8.zip` **2,704,179 B**
  - CoreML int8 3,902,475 B
  - `rvm_resnet50_fp32.onnx` 107,479,165 B

  — [PeterL1n/RobustVideoMatting](https://github.com/PeterL1n/RobustVideoMatting), [releases](https://github.com/PeterL1n/RobustVideoMatting/releases)
- **BiRefNet** repo is **MIT**. `onnx-community/BiRefNet_lite-ONNX` (mit): `model.onnx` **224,005,088 B**, `model_fp16.onnx` **114,538,221 B**. Full BiRefNet-ONNX: 972,666,916 B fp32 / 489,666,272 B fp16 — [ZhengPeng7/BiRefNet](https://github.com/ZhengPeng7/BiRefNet), [BiRefNet_lite-ONNX](https://huggingface.co/onnx-community/BiRefNet_lite-ONNX), [BiRefNet-ONNX](https://huggingface.co/onnx-community/BiRefNet-ONNX)
- **Licences to avoid:**
  - `briaai/RMBG-1.4` uses licence "other / bria-rmbg-1.4", and `briaai/RMBG-2.0` uses "other / bria-rmbg-2.0" (gated) — [RMBG-1.4](https://huggingface.co/briaai/RMBG-1.4), [RMBG-2.0](https://huggingface.co/briaai/RMBG-2.0). These are Bria's custom licences. The commercial-use terms were not read here; they are widely described as non-commercial without a Bria agreement (unverified).
  - `onnx-community/ISNet-ONNX` card licence is **agpl-3.0** — [ISNet-ONNX](https://huggingface.co/onnx-community/ISNet-ONNX)
- **Coarse-to-fine mask refinement on the GPU:**
  - Fast Guided Filter: subsample the input and guide by s, compute the linear coefficients (a, b), upsample a and b, and apply them to the full-res guide. This takes O(N/s²) time, ">10× speedup with almost no visible degradation" — [He & Sun, arXiv 1505.00996](https://arxiv.org/abs/1505.00996)
  - A trainable variant exists (Deep Guided Filter) — [Wu et al., arXiv 1803.05619](https://arxiv.org/pdf/1803.05619)
  - Ultralytics applied a guided filter (gray guide, radius = ½ low-res mask cell, eps = 1e-4) to upsampled SAM-3 mask logits. On Cityscapes, mIoU rose 79.66 → 79.79 and 3-px Boundary IoU rose 24.98 → 25.83 — [ultralytics PR #26363](https://github.com/ultralytics/ultralytics/pull/26363)
  - Google Meet refines its low-res web mask with a joint bilateral filter — [Google Research blog](https://research.google/blog/background-features-in-google-meet-powered-by-web-ml/)
  - No ready GLSL implementation of the fast guided filter was found (search came up empty).

### Inferences
- **Recommended α source for MonaLisa (my recommendation):**
  1. **Default (zero download):** the PoseLandmarker segmentation mask MonaLisa already computes, at ¼ res. Refine it with a fast guided filter in WebGL2:
     - Box-filter I, p, I·p and I² at ¼ res using separable passes on RGBA16F.
     - Compute a and b, box-filter them, then do one full-res pass `q = a·I + b` with hardware bilinear sampling of a and b.
     - Use a radius of about 4–8 full-res px and eps ≈ 1e-4 to 1e-3.

     This is about 6–8 cheap passes, fine both live and in the editor (inferred). It snaps the soft edge to real image edges but cannot recover individual hair strands.
  2. **Hair crossing the fill strip:** run `hair_segmenter` (781 KB, Apache-2.0, already a MediaPipe task) on a crop. Treat hair pixels as person, so they are warped with the head and not filled over. Mark them as low-confidence, so the strip next to long hair falls back to field-stretch.
  3. **Editor "high-quality edges" (optional download):** MODNet fp16 (13.0 MB) or uint8 (6.6 MB) via ORT-Web, at 512 on the person crop. Then fast guided upsample to full res. Licence is clean (Apache-2.0).
     - PP-MattingV2 is more accurate per PaddleSeg's own numbers, but needs a paddle2onnx conversion and verification, which was not done here.
     - MODNet is trained for portraits. Its full-body behaviour on legs and feet was not verified, so evaluate before adopting.
- **Do not use RVM** (GPL-3.0) unless the whole app is GPL-compatible. Its tfjs int8 build (2.7 MB) is otherwise attractive. Also avoid RMBG and ISNet (AGPL/Bria terms).
- **BiRefNet-lite** (MIT) is a quality reference for offline testing on a desktop. It is not deployable on iPhone at 115–224 MB.
- **For the fill pipeline, α does not need to be perfect everywhere.** It must be accurate only along the part of the silhouette that moves (the slimmed side of the waist, thighs, arms). Restrict refinement and matting to bands around the capsule regions that actually have a non-zero field. This cuts cost by roughly the fraction of the perimeter that is edited (inferred).

### Gaps
- No iPhone Safari latency or memory measurement was found for MODNet, PP-MattingV2, RVM or BiRefNet-lite in ORT-Web or TF.js.
- No ONNX build of PP-MattingV2 was located or size-measured.
- Bria's licence text was not read directly.
- How well MODNet or PP-Matting handle full-body shots (legs, feet, loose clothing) rather than portraits was not found.
- MatAnyone and ViTMatte were not examined. MatAnyone's repository path could not be resolved through the GitHub API.

## Q4. How wide a revealed strip each fill method can handle, and how to hide the fill

### Takeaway
Slimming moves edges by about 2–4 % of the frame. That is ~60–120 px on a 3024-px-wide photo, ~22–43 px on a 1080-px export, and ~5–10 px at the 256-px field resolution. Telea is sharp only up to about 10–15 px, so at full resolution it blurs. Push-pull has no texture at any width and only passes on flat or out-of-focus backgrounds. MI-GAN and LaMa are trained on wide free-form masks, so a strip this narrow is easy for them, as long as the crop is not downscaled too much. Their remaining failure is complex 3D structure, such as a door-frame corner behind the waist. Hide any fill with grain matched to the surrounding noise, a narrow feathered blend into the untouched background, and a light wrap at the new silhouette edge.

### Cited Findings
- **Telea's limit:** blur appears "when inpainting regions thicker than 10–15 pixels", and the regions to inpaint are "usually less than 15 pixels thick" — [Telea 2004](https://www.olivier-augereau.com/docs/2004JGraphToolsTelea.pdf)
- **Telea on larger masks or textures:** a visible "half-blurring half-stretching effect" — [pyheal](https://github.com/olvb/pyheal)
- **LaMa** targets "large missing areas" and uses aggressive wide-mask training. The authors report gains are "especially noticeable for wide masks", and that it generalises from 256 training to ~2k — [arXiv 2109.07161](https://arxiv.org/abs/2109.07161), [advimman/lama README](https://github.com/advimman/lama)
- **MI-GAN** is evaluated with free-form masks at 256 and 512. It struggles with "complex 3D structures". For large high-res areas, the authors recommend small incremental strokes — [paper](https://openaccess.thecvf.com/content/ICCV2023/papers/Sargsyan_MI-GAN_A_Simple_Baseline_for_Image_Inpainting_on_Mobile_Devices_ICCV_2023_paper.pdf), [README](https://github.com/Picsart-AI-Research/MI-GAN#for-developers)
- **next-lama** observes that browser LaMa is good "for small patches and homogenous backgrounds" — [Medium](https://medium.com/@geronimo7/client-side-image-inpainting-with-onnx-and-next-js-3d9508dfd059) (via search summary)
- **Halo and edge hiding in production:** Meet uses light wrapping and mask-aware separable blur to avoid halos — [Google Research blog](https://research.google/blog/background-features-in-google-meet-powered-by-web-ml/). Foreground colour re-estimation (Blur-Fusion) removes background bleed in soft edges — [Forte 2021](https://ieeexplore.ieee.org/document/9506164/)
- **Earlier MonaLisa research** placed push-pull at "a few pixels to about 1–2 % of image width". It also proposed matched grain — `research_notes/全身美體修圖 PWA 實作/warp_algorithms_papers.md` (no new source found to tighten this).

### Inferences
- **Usable strip width per method** (my synthesis; "frame" = image width):

  | Method | Comfortable | Marginal | Fails |
  |---|---|---|---|
  | Field stretch (current, band 4Δ) | Δ ≤ ~1 % on line-rich backgrounds; ≤ 3–4 % on plain ones | — | visible bent lines when straight lines cross the band |
  | Push-pull + grain | ≤ ~1 % on any background; ≤ 4 % on flat walls, sky, bokeh | 1–2 % on texture | > 2 % on texture / lines (smear) |
  | Mirror / translate fill (tier 2) | lines perpendicular to edge at any width | parallel lines within ~2Δ of the edge | strong repeated patterns (visible echo) |
  | Telea / NS | ≤ 10–15 px at the processing res (≈ ≤ 1 % at 1080 px) | 15–30 px | > 30 px (blurry band) |
  | MI-GAN (crop ≤ 2× down) | 2–4 % easily on natural backgrounds | strong perspective lines / 3D corners | heavy downscale of a full-body crop → soft fill |
  | LaMa | widest; best on periodic patterns | — | too large for iPhone |

- **Hiding the fill:**
  1. Fill at a resolution close to the output: tile the strip, or run push-pull and Telea at full res inside the band only.
  2. Re-add grain. Estimate the noise σ from a high-pass of the nearby untouched background and add matched noise inside H. This matters most for push-pull and Telea, which output noise-free, plastic-looking strips.
  3. Feather the fill into the real background over 2–4 px at H's outer boundary. The outer boundary of H lies on real background, so a seam would be visible.
  4. Apply a 1–2 px light wrap or edge blend on the new silhouette, so the person edge does not look cut out.
  5. Guard by risk. When a line detector finds straight lines in H, or H's surroundings have high texture energy, choose MI-GAN (editor) or keep a share of the field stretch, never push-pull alone.
  6. Never fill across another person or a shadow boundary. Shrink the slimming locally instead.
- **Live preview vs export:** live/camera uses tier 0–2, which is zero-download and one or two extra GPU passes. The editor's export can upgrade to MI-GAN after an explicit user action ("高品質背景修補", with the download size shown). The preview should then be recomputed with the same fill, so that export matches preview.

### Gaps
- No published side-by-side test of fill methods on body-slimming strips (thin, tall, edge-adjacent holes) was found. All width thresholds above, except Telea's 10–15 px, are inferences that need a test set (door frames, tiles, foliage, bokeh, sky).
- No source quantifies how much grain matching or light wrapping improves perceived quality in this setting.
