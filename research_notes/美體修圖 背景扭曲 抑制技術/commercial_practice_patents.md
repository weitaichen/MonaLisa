# Commercial practice and patents for suppressing background distortion in face and body reshaping

Scope: what shipping apps, SDKs and patents actually do so slimming does not bend the background. Research date 2026-10-08. This file builds on and does not repeat `reports/全身美體修圖 PWA 實作.md` and `research_notes/全身美體修圖 PWA 實作/`. Those already cover: 醒圖 背景保護 at v5.8/5.9, the YouCam / BeautyPlus / PixPretty "rigid background" claims, FaceApp Lock Background existing at all, ByteDance's long-leg "直線仍是直線" optimisation, FBBR / NeuralReshaper, Shih 2019, US 11475546, US 10586570 and US 11450080.

Evidence tags:
- **[verified-page]**: I fetched the primary page and read it.
- **[snippet]**: comes only from a search-result summary. Treat as unverified.
- **[inference]**: my own reasoning.

## Product features and UX: what background controls exist and how they behave

### Takeaway
Commercial apps use three controls:
1. An **automatic background-protection toggle**, or protection that is always on. Examples: Meitu 背景保護 / Background Repair, 醒圖 背景保護, FaceApp Lock Background, AirBrush Background Freeze.
2. A **manual "protect" brush or selection**. Examples: YouCam Protect brush, Meitu 「手動選區」 added in 12.5.0 (2026), Photoshop Liquify Freeze Mask.
3. Keeping **slider-driven warps local and modest**.

No app documents how its protection works. I also found no consumer app that exposes a "straight-line detection" control. Meitu has kept iterating on the feature: it extended protection to video body reshaping (Dec 2025 – Jan 2026), added manual selection (Mar 2026), and in a 2026 Play Store release claimed "more natural edges" for head slimming. That suggests the hard part is the **seam between the protected background and the warped person**, not the on/off logic.

### Cited Findings
- **Meitu (美圖秀秀), CN App Store** [verified-page]. The release notes below show no year. The years are inferred from the version order, given that 11.28.0 is dated 2025/12/26.
  - Store description: 「瘦臉瘦身」保護背景，自然修飾.
  - 11.28.0 (2025-12-26), 11.28.1 and 11.28.2: 【視頻】身材美型支持背景保護.
  - 12.1.0 (Jan 10): 【視頻】精修升級，背景保護功能助力修視頻無憂.
  - 12.5.0 (Mar 14): 【美容】瘦臉瘦身背景保護新增「手動選區」…不懼背景變形.
  - 12.12.0 (Jun 20): adds 「一鍵美體」.
  - The word 直線 (straight line) does not appear anywhere on the page.
  - Source: [Meitu CN App Store](https://apps.apple.com/cn/app/%E7%BE%8E%E5%9B%BE%E7%A7%80%E7%A7%80-%E8%A7%86%E9%A2%91-%E5%9B%BE%E7%89%87-live%E4%BA%BA%E5%83%8F%E7%B2%BE%E4%BF%AE%E5%B7%A5%E5%85%B7/id416048305)
- **Meitu press release, 2021-12-02** [verified-page]. The Meitu App added Quick Mode to Slimming and "a background repair function to prevent users from bending and deforming the background when adjusting their body", to fix "a deformed background caused by retouching". It gives no technical detail. — [Meitu media 353](https://www.meitu.com/en/media/353)
- **Meitu Google Play, latest release, about Aug 2026** [snippet]. "Face reshaping & head slimming, with improved Background Repair for more natural edges". The iOS global description reportedly says "Body Shape… with background locked". — [Google Play](https://play.google.com/store/apps/details?id=com.mt.mtxx.mtxx); [App Store](https://apps.apple.com/app/id416048305)
- **Meitu T9 phone review** [snippet]. The reviewer deliberately shot against a railing. In body-adjust mode the railing showed no obvious deformation. — [ifanr](https://www.ifanr.com/1056019)
- **FaceApp Lock Background** [snippet, official blog].
  - Usage: turn it on in Reshape before editing. It "freezes the scene behind your subject so only the selected area is affected", for face, body or silhouette.
  - The blog says it is most useful for architecture and full-body shots.
  - It is marked "Only on iOS".
  - The mechanism is not described.
  - Sources: [FaceApp tips: Reshape](https://www.faceapp.com/blog/tips-and-tricks-reshape-tool/); [FaceApp: Reshape, the edit nobody notices](https://www.faceapp.com/blog/reshape-the-edit-nobody-notices/)
- **YouCam Makeup / YouCam Perfect Body Tuner: a manual Protect brush** [verified-page].
  - The user brushes "around the area that you want to stay unchanged".
  - Then they adjust Enhancer / Slim / Waist / Arms / Legs sliders.
  - The article gives no mechanism and no publication date. Image paths suggest about Jan 2025.
  - Sources: [Perfect Corp blog](https://www.perfectcorp.com/consumer/blog/selfie-editing/edit-body-without-background-distortions); [Perfect Corp Body Tuner tips](https://www.perfectcorp.com/consumer/blog/photo-editing/three-tips-on-how-to-retouch-a-photo-with-the-body-tuner-tool)
  - Facetune's competitor roundup also lists YouCam's "protection tool to prevent background warping" [snippet]. — [Facetune blog](https://www.facetuneapp.com/blog/best-body-editing-app)
  - 2026 Perfect Corp articles reportedly mention "auto background protection" [snippet, not fetched].
- **AirBrush "Background Freeze"** [snippet].
  - AirBrush's body editor says you can "adjust your image while keeping the original background intact".
  - A third-party review says it "helps prevent warped walls and bent doorframes… but you still need a steady hand".
  - Sources: [AirBrush body editor](https://airbrush.com/body-editor); [Secta review](https://secta.ai/blog/p/body-photo-editor)
- **Facetune**: no background lock was found in official docs [snippet].
  - Reshape has Reshape / Refine / Resize, plus Restore.
  - Facetune even suggests using Reshape to warp backgrounds on purpose.
  - Source: [Lightricks help](https://lightricks.zendesk.com/hc/en-us/articles/14799399876882-How-to-use-the-Reshape-tool-in-Facetune)
- **Photoshop Liquify Freeze Mask** is the original "protect brush" pattern [snippet]. — [Secta review](https://secta.ai/blog/p/body-photo-editor)
- **醒圖 / Hypic**: no new verified facts beyond the earlier v5.8/5.9 changelog [snippet]. A 3DM guide says 推臉筆 behaves like Photoshop Liquify, so it pushes the whole local area, background included. — [3DM guide](https://shouyou.3dmgame.com/gl/503613.html)
- **Kuaishou products** [snippet].
  - StreamLake 人像美化 claims 長腿、瘦腰、天鵝頸、小頭 with 「畫面背景無扭曲、無抖動」.
  - Y-tech says its background correction shipped in 一甜相機 and 原片 (see the Engineering section).
  - Source: [StreamLake](https://www.streamlake.com/product/beautification)

### Inferences
- [inference] There are two families of UX:
  - **Silent / automatic.** Meitu, 醒圖, FaceApp, AirBrush and YouCam "auto" all take this route. A segmentation mask is the most plausible implementation, but no vendor confirms it.
  - **Manual protect brush.** Examples are YouCam Protect, Meitu 手動選區 and Photoshop Freeze Mask. The brush is a cheap way to cover the cases where the mask is wrong, such as a protected object that touches the body, loose clothing, or hair.
  - MonaLisa's model is "mask × feather, toggle default on". It matches the automatic family. A protect brush (field × (1 − brush mask)) is the missing low-cost piece. It has a precedent in at least two major apps.
- [inference] Meitu shipped background protection for *video* in late 2025. That implies a per-frame method cheap enough for video, likely mask-based or a coarse mesh solve, not heavy per-frame inpainting.
- [inference] Meitu's 2026 "more natural edges" wording points to the seam at the mask boundary as the residual artefact. That matches MonaLisa's own feather-band trade-off.

### Gaps
- No vendor documents its algorithm. Whether Meitu or 醒圖 uses mask-gating, mesh line-preservation or inpainting is **unverified**.
- I did not find 醒圖 / Hypic official version history beyond third-party mirrors. Snapchat / TikTok / CapCut real-time body lenses and PicsArt / BeautyPlus background controls were not researched in this pass, because I ran out of budget. No before/after measurements (line curvature) exist for any app.
- I found no YouTube or Bilibili tutorial evidence in this pass.

## SDK documentation: any parameters for background deformation

### Takeaway
None of the public SDK docs I found exposes a background-protection, straight-line or segmentation-gating parameter for **geometric** body or face reshaping. All of them expose only per-part intensity sliders. Background behaviour is internal. FaceUnity fixed it in SDK releases rather than adding a parameter. Alibaba Queen's 「背景保真」 applies only to **skin** effects, not to warps.

### Cited Findings
- **FaceUnity (相芯) BodyBeauty** [snippet, official CSDN blog].
  - Parameters: `bodySlimIntensity`, `legStretchIntensity`, `waistSlimIntensity`, `shoulderSlimIntensity` (0.5 = neutral), `hipSlimIntensity`, `headSlimIntensity` and `legSlimIntensity`, all in [0, 1], plus `enable` and `enableDebug`.
  - There is no background parameter.
  - The blog says the body module uses 2D body keypoints, together with body segmentation that separates the person from the background "以便在美體過程中對人體進行獨立處理".
  - Source: [Faceunity2023 CSDN](https://blog.csdn.net/Faceunity2023/article/details/131215134)
  - Head and shoulder object deformation during large motion was reduced in a later SDK release. This is already in the prior notes. — [FULiveDemoMac releases](https://github.com/Faceunity/FULiveDemoMac/releases)
- **Tencent Effect (騰訊特效 SDK)** [snippet].
  - Parameters include `body.legStretch`, `body.slimLegStrength` and `body.waistStrength` (0–100), sold as 「高級美體」 with 42 body points.
  - There is no background parameter.
  - Sources: [Tencent docs 616/103616](https://cloud.tencent.com/document/product/616/103616); [Tencent docs 616/67043](https://cloud.tencent.com/document/product/616/67043)
- **BytePlus Effects** [snippet].
  - Body shaping lives in `ComposeMakeup.bundle` and is set through `updateComposerNodes(path, key, value)`.
  - The skeleton SDK provides 18 keypoints.
  - I found no public list of body-shaping keys and no background parameter.
  - Sources: [BytePlus Beauty](https://docs.byteplus.com/en/docs/effects/docs-beauty); [BytePlus body keypoints](https://docs.byteplus.com/en/docs/effects/docs-human-body-keypoints)
- **Alibaba Queen** [snippet]. 「美白、紅潤、磨皮、銳化、整體美顏功能已默認開啟背景保真功能」. This applies to skin and colour effects only. — [Aliyun Queen docs](https://help.aliyun.com/zh/live/developer-reference/experience-beauty-effects-sdk)

### Inferences
- [inference] The SDK vendors treat background protection as an internal quality property, not a tunable. For MonaLisa this means there is no external parameter convention to copy. A single on/off toggle plus an internal falloff is consistent with the industry.

### Gaps
- I did not research SenseTime SDK docs or Banuba docs. Their background-protection docs are unknown, so check them in a later pass. SenseTime's *patents* are covered below.
- The FaceUnity release that reduced head/shoulder deformation has no published method.

## Patents: disclosed methods (2018–2024 priority)

### Takeaway
Five concrete method families are disclosed:
- **(A) Asymmetric distance-decaying displacement outside the body contour.** SenseTime: background displacement decays *exponentially* with distance from the contour, faster than inside. This is essentially MonaLisa's dilate-and-feather mask.
- **(B) Inpaint or replace the region vacated by slimming.** Kuaishou / 達佳 WO2022089185A1.
- **(C) A mesh optimisation with line-straightness costs plus a region-of-interest cost.** Google US 11922720 B2 (face perspective correction), using a Ceres solver.
- **(D) Region-wise constraints so that background lines passing *behind* the person stay continuous.** CN112529784B. Its prior art had line "breaks" (斷層).
- **(E) Waist-line-bounded vertical stretch for real-time long legs.** US 11461876 [snippet].

I found **no** patent from Meitu, ByteDance or Tencent that explicitly claims 「背景保護」 for body slimming, despite several targeted searches.

### Cited Findings
- **US 11288796 B2, SenseTime (Beijing Sensetime Technology Development Co Ltd)** [verified-page]
  - Title: "Image processing method, terminal device, and computer storage medium".
  - Priority: CN 201810553047.9, 2018-05-31. Granted 2022-03-29.
  - **Claim 1**: detects the leg region from leg contour points and/or keypoints, then deforms it, including shank stretching or compression along the knee-to-foot direction.
  - **Claim 5**: the leg's "first type of deformation parameters" varies with distance to the body contour edge.
  - **Claim 6**: deforms "at least part of a background region, except a region in which the target object is located", and merges it with the leg result.
  - **Claim 7**: the background's "second type of deformation parameters… varies exponentially with a distance" to the contour edge.
  - The description says the background parameter changes faster than the body parameter for the same distance change, "to reduce the impact on the background".
  - No numeric constants are given.
  - Source: [Google Patents US11288796B2](https://patents.google.com/patent/US11288796B2/en)
- **US 11216904 B2, SenseTime** [verified-page, description; claims not read]
  - Inventors: Wentao Liu, Chen Qian. Priority: CN 201810552993.1, 2018-05-31. Granted 2022-01-04. Google lists it as "expired – fee related".
  - Contour pixels of the selected body part ("first pixel points") move by a set amplitude, for example a waist pulled in by about 20 px.
  - Inside pixels ("third") move by an inverse-proportional falloff.
  - Outside / background pixels ("second") move in the **same direction**, with amplitude "smaller than the first" and "negatively correlated" with the distance to the nearest contour pixel. The falloff is exponential and decays faster than inside.
  - The outside displacement can come either from the nearest contour pixel or from the vector sum over several contour pixels.
  - Stated goal: the background is less deformed and joins the contour naturally.
  - Source: [Google Patents US11216904B2](https://patents.google.com/patent/US11216904B2/en)
- **WO2022089185A1, Beijing Dajia Internet (Kuaishou)** [verified-page]
  - Inventors: 趙明菲, 聞興. Priority: CN202011192273.2, 2020-10-30. Published 2022-05-05. The PCT status shows "Ceased", and the national-phase status is unknown.
  - **Claim 1**: identify face → slim → repair the deformed region to produce a third image.
  - **Claim 2**: the deformed region is the part of the predetermined area (face plus slimming triangle mesh) that lies outside the slimmed face.
  - **Claims 3–4**: fill it with background pixels by image inpainting from the *original* image.
  - **Claims 5–6**: or replace it from a pure background frame of the same scene.
  - Inpainting options named: patch-based, diffusion, or a CNN/GAN with a mask.
  - No blending or feathering step is described.
  - Source: [Google Patents WO2022089185A1](https://patents.google.com/patent/WO2022089185A1/zh)
- **US 2021/0110142 A1 → US 11922720 B2, Google LLC** [verified-page, description; claims not read]
  - Title: "Perspective Distortion Correction on Faces". Inventors: Yichang Shih, Chia-Kai Liang. Priority: 2018-05-07. Granted 2024-03-05.
  - Method: a warping mesh with:
    - face-related costs on mesh vertices selected by a combined face segmentation mask;
    - edge-related costs that keep detected lines and edges straight (line-detection algorithm);
    - boundary costs on border vertices, with the mesh extended by extra vertices;
    - a bending term.
  - The solver is Ceres with coarse-to-fine initialisation.
  - This is the patent behind Shih et al. 2019.
  - Source: [Google Patents US20210110142A1](https://patents.google.com/patent/US20210110142A1/en)
- **CN112529784B, 「圖像畸變校正方法及裝置」** [snippet; applicant not confirmed]
  - Background section: the prior art used a homography constraint on the person rectangle, a line-detection-based **直線性約束** on background lines, and compatibility constraints at the boundary. This "easily causes 斷層" in lines behind the person.
  - The invention splits the portrait into several body regions, each with its own constraint term, so lines passing behind the person stay continuous.
  - Source: [Google Patents CN112529784B](https://patents.google.com/patent/CN112529784B/zh)
- **US 11461876, "Video data processing method and apparatus"** [snippet; the USPTO PDF is image-only and the assignee is unverified]
  - Real-time long legs stretch only the body below a **waist line**.
  - The waist line is fixed for low-jitter frames and flexible for high-jitter frames.
  - Stated goal: keep background deformation "natural and smooth".
  - Source: [USPTO 11461876](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/11461876)
- **US 12175681** [snippet; assignee not seen]
  - Priority: CN 201910779341.6, 2019-08-22.
  - Its background section says a deformed foreground stitched back into the original image does not match the background.
  - Source: [USPTO 12175681](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/12175681)
- **US 9191579 B2 ("MovieReshape"-style video body reshaping)** [snippet]
  - Uses MLS image warping constrained by a reshaped 3D body model.
  - It admits that a very strong deformation bends straight edges, giving the example of a basketball-court line.
  - It argues that pasting a segmented, reshaped person over the background "often causes worse artifacts" such as a double arm or double legs.
  - In its user study only 2 of 30 participants noticed a background change.
  - Source: [Google Patents US9191579](https://patents.google.com/patent/US9191579)
- **Related US filings** [snippet]: US 11379520 and US 11409794, "Image deformation control method" (CN 201910073610.7, 2019-01-25). Their assignee and content are unverified.
- **Academic CN patent** [snippet]: CN 202010927633 (Harbin Institute of Technology, Weihai) segments the person with pose2seg only to stop the background from disturbing 3D fitting. It is not a background-protection method. — [xjishu](https://www.xjishu.com/zhuanli/55/202010927633.html)

### Inferences
- [inference] MonaLisa's current 背景保護 is very close to SenseTime family (A): the field is multiplied by the person mask dilated by Δ and feathered by 4Δ. SenseTime explicitly claims a background displacement that follows the contour direction and decays exponentially with distance. US 11216904 is listed as expired (fee-related). US 11288796's background claim (claim 7) depends on a leg-deformation claim 1 with shank stretching. The CN counterparts' status was not checked. This is **not legal advice**; flag it for an IP check before any commercial release in CN.
- [inference] Family (B), inpainting the vacated sliver, is what the earlier report calls push-pull fill. Kuaishou's own patent names only generic inpainting and no feathering, so a cheap GPU push-pull fill is on par with the disclosed method for thin slivers.
- [inference] Families (C) and (D) are the "line-protect" upgrade path. CN112529784B gives a concrete warning: per-region line constraints can *break* a line where it passes behind the person, unless the line is treated as one continuous constraint across the occluder.

### Gaps
- I found no Meitu, ByteDance (字節 / 字跳), Tencent, Alibaba, Apple or Adobe patent that explicitly claims background protection for body or face slimming. A direct CNIPA search by applicant (厦门美图之家 / 美图网, 北京字节跳动 / 字跳网络) with 背景 + 形變 + 瘦身 is needed. Search engines index CN patents poorly.
- The claims of US 11216904 and US 11922720 were not read, only the descriptions.
- The assignees of US 11461876, US 12175681, US 11379520 and CN112529784B are unverified.
- Legal status in CN was not checked for any family.

## Engineering blogs and talks: disclosed implementations

### Takeaway
The one detailed public implementation is **Kuaishou Y-tech's 「背景扭曲矫正」** (2021-09). It is a post-warp correction:
- a radial triangle mesh between the face contour and the image border;
- the contour points fixed to their warped positions;
- the other background vertices solved by nonlinear least squares, with a **line-slope-preservation** term (lines detected in the original background, lines inside the face dropped) and an **ARAP-style triangle-shape** term.

It claims real-time speed on all phones and coverage of all face and body reshaping. ByteDance describes the same idea for long legs (prior notes). No Meitu engineering write-up was found.

### Cited Findings
- **Kuaishou Y-tech, 「美顏空間不扭曲｜人像美化技術揭秘之『背景扭曲矯正』」, 2021-09-23** [verified-page; mirror of the original WeChat post].
  - Problem: users complain 「牆都P歪了」「門都不是直的」.
  - Key observation: if background line slopes are unchanged, users do not perceive distortion.
  - **Mesh**: pick image-border points equal in number to the face-contour keypoints, connect each to its contour point, and divide each segment into four. The example has about 150 points, with 30 known contour pairs. The background is triangulated from these points.
  - **Lines**: segment detection on the *original* background. Lines inside the face are discarded. The detector is not named, but the references include LSD.
  - **Energy**: Σ line-slope difference (m lines) plus Σ triangle-shape preservation (n triangles, As-Rigid-As-Possible). The shape term stabilises triangles that contain no line.
  - **Solver**: nonlinear least squares, with Gauss-Newton or Levenberg-Marquardt mentioned. Exactly which one is used is not stated.
  - **Render**: warp the original image piecewise by the old→new triangle mapping.
  - **Claims**: runs in real time on 「所有手機機型」. Supports all 美型 and 美體 operations, whereas a competitor supported only 小頭. Shipped in 一甜相機 and 原片. It is "to be extended to 美體瘦身", which reads as future work.
  - There are no timings, no weights and no quantitative evaluation.
  - Source: [qinglite mirror](https://www.qinglite.cn/doc/418264769cf6b8e5d)
- **Meitu MT Lab public statements** [verified-page]. They mention body keypoints plus contour points for 「全身美型」. Nothing is said about background handling. — [China Daily / 江西網絡台, 2021-03-22](https://cn.chinadaily.com.cn/a/202103/22/WS60583ab2a3101e7ce9745216.html)
  - A search summary claimed Meitu "models the background as a mesh to reduce warping" after 3D reconstruction and segmentation. I could **not** find a source for this, so **treat it as unverified**.
- **Industry framing of the trade-off** [verified-page]. QbitAI (2020-11-24) notes that the industry wants methods that 「既不會扭曲背景，又能讓人物恢復正常」 in the context of wide-angle portrait correction. — [QbitAI](https://www.qbitai.com/2020/11/20020.html)

### Inferences
- [inference] The Kuaishou method fits MonaLisa's architecture as an **editor-only post-pass on the displacement field**:
  1. Take the existing low-res backward field.
  2. Treat the displacement at the dilated-mask boundary as known, which plays the role of Kuaishou's contour points.
  3. Re-solve the background vertices of a coarse mesh (for example 16×16 to 32×32 outside the mask) with line-slope terms from lines detected once per photo at about 256 px, plus a Laplacian/ARAP smoothness term.
  4. Rasterise the result back into the field.

  With about 1k vertices and a few hundred line constraints, a sparse Gauss-Newton solve in JS or WASM on the CPU should take tens of ms (not measured). It needs no GPU compute and no extra model, so it respects the CSP and memory limits.
- [inference] The simplest safe version is a linear least-squares problem instead of a slope (nonlinear) term. Penalise the *perpendicular* displacement variation along each detected line, which is the geometric condition from the earlier report that a line bends iff the perpendicular displacement varies along it. This yields one sparse linear solve per edit.
- [inference] **Licences**: no code or model accompanies any of these write-ups or patents, so there is nothing to license from them. Any line detector shipped in MonaLisa should be self-written or permissively licensed.

### Gaps
- Line-detector licences were not checked in this pass. I recall, without having verified it here, that the original LSD C code is AGPL and that OpenCV's `LineSegmentDetector` was removed and later restored over licensing. Confirm both before choosing a detector.
- I did not find the original Kuaishou WeChat or 知乎 URL, only the mirror. The ByteDance long-leg optimisation details beyond the prior notes, any Meitu MT Lab talk on 背景保護, and CSDN or 掘金 implementations of line-preserving body warps were not found in this pass.
- No public runtime numbers exist for line-preserving background correction on phones.
