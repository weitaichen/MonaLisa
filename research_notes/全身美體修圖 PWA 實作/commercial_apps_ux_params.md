# How commercial apps and SDKs do full-body retouching (美體): features, parameters and UX

Research date: 2026-10-07. Scope: features, parameter lists, auto vs manual tools, photo vs real-time support, quality pitfalls, and UX patterns in commercial apps and SDKs. Facts and sources only. No proprietary assets were downloaded or reused.

Source-quality legend:
- **[primary]**: official docs, official GitHub, or official product pages.
- **[3rd-party]**: download-site changelog mirrors, tutorials or reviews.
- **[snippet]**: seen only in search-result summaries, not fetched in full. Treat [snippet] items as unverified.

---

## Q1. Which body features do consumer apps offer, and how are they presented?

### Takeaway
Consumer apps use two ways of working:
- **Automatic.** One-tap auto body (一鍵美體), plus per-part sliders driven by body keypoints. Typical parts: slim, waist, legs longer/thinner, head, shoulders, chest, hips, arms, neck.
- **Manual.** A push/liquify finger tool (手動瘦身), plus a "增高" stretch band that the user places with two draggable horizontal handles.

美圖秀秀 / 美顏相機 (Meitu) and 醒圖 (ByteDance) offer both ways. Western apps such as Facetune lean on generic manual Reshape/liquify. B612 and FaceApp offer only a coarse whole-body slider.

### Cited Findings

**美圖秀秀 Meitu**
- **Android v12.13.0 changelog** (via a download-site mirror) [3rd-party]:
  - Adds 「一鍵美體」 under 【美容】.
  - Adds 「手動瘦身」 for **video/Live**, so manual body slimming also works on video and Live Photos. — [jb51 mirror](https://www.jb51.net/softs/56367.html)
- **Manual slimming and background protection** [snippet]:
  - The manual slim tool is described as "push wherever you want slimmer" (手指輕輕一推，哪裡想瘦推哪裡).
  - Marketing copy claims face and body slimming "protect the background" (保護背景). — [pc.qq.com listing](https://pc.qq.com/detail/6/detail_26166.html); [Meitu App Store](https://apps.apple.com/cn/app/%E7%BE%8E%E5%9B%BE%E7%A7%80%E7%A7%80-%E8%A7%86%E9%A2%91-%E5%9B%BE%E7%89%87-live%E4%BA%BA%E5%83%8F%E7%B2%BE%E4%BF%AE%E5%B7%A5%E5%85%B7/id416048305)
- **「增高塑型」 copy** lists 天鵝頸 (swan neck), 直角肩 (square shoulders) and 超模腿 (model legs) as the head-to-toe set [snippet]. — [Meitu App Store](https://apps.apple.com/cn/app/%E7%BE%8E%E5%9B%BE%E7%A7%80%E7%A7%80-%E8%A7%86%E9%A2%91-%E5%9B%BE%E7%89%87-live%E4%BA%BA%E5%83%8F%E7%B2%BE%E4%BF%AE%E5%B7%A5%E5%85%B7/id416048305)
- **增高 (height) tool** [3rd-party]:
  - On mobile: 瘦身塑形 → 增高 → height slider.
  - On PC: the image shows **two draggable up/down bars**. The user places them around the leg section to stretch, then sets the amount with a side slider.
  - Mechanism: 增高 is a **local vertical stretch** of the selected band, so the band has to be framed accurately.
  - The tutorial recommends **5–15%** stretch. Over-stretching distorts the background. — [automazin tutorial](https://www.automazin.com/Blogs/%E7%BE%8E%E5%9B%BE%E7%A7%80%E7%A7%80%E5%A2%9E%E9%AB%98%E5%8A%9F%E8%83%BD%E4%BD%BF%E7%94%A8%E6%95%99%E7%A8%8B.html)
- **Placement and controls (2026 review)** [3rd-party]:
  - The body tools sit under 人像美容 → 美體.
  - There are separate controls for face, legs, waist and leg length.
  - The reviewer rated Meitu (with FaceApp) the most natural slimming. — [FlowPix test, Feb 2026, updated Jun 2026](https://www.flowpixai.com/tutorials/ai-photo-slimming.html)
- **Meitu PC help page** (updated 2024-08-06) only says 瘦身/瘦臉 tools "easily adjust body and face lines". It gives no parameter detail [primary]. — [Meitu help center](https://pc.meitu.com/pchelp/photoedit/pt20240806)

**美顏相機 BeautyCam (Meitu)**
- **Real-time camera body editing** [3rd-party]:
  - The 【美型美體】 feature ("easy long legs, adjust slim body and waist at will") is in the camera.
  - "Three body presets (三款美體套裝) for different body types".
  - 【視頻精修】 offers 視頻身材美型 (video body reshape).
  - 【AI人像精修】 offers 一鍵減肥 (one-tap slimming) and 一鍵增肌 (one-tap muscle). — [ddooo iOS mirror v13.3.40](https://www.ddooo.com/softdown/81999.htm); [App Store](https://apps.apple.com/us/app/%E7%BE%8E%E9%A2%9C%E7%9B%B8%E6%9C%BA/id592331499?l=zh-Hans-CN)
- **Suggested settings** [snippet]: a 2024 tutorial suggests tapping 【美體】 in the camera and setting 瘦身, 長腿, 瘦腰 and 瘦手臂 to **about 50%**. — [search summary; source among results above, unverified]

**醒圖 Hypic / RetouchPics (ByteDance)**
- **Store copy** (via mirrors) [3rd-party]:
  - **Automatic body**: one-tap whole-body proportion with longer legs, 收腰 (waist), 瘦肩 (shoulders) and 提臀 (hip lift).
  - **Manual body**: local slimming, height stretch and proportion adjustment, with a user-defined range and strength. — [ddooo iOS mirror](https://www.ddooo.com/softdown/166858.htm)
- **v15.5.2 changelog** [3rd-party]: 【美體】 adds 「體態管理」 (posture management), "one tap to fix bad posture". — [ddooo iOS mirror](https://www.ddooo.com/softdown/166858.htm)
- **Background protection** [3rd-party, unverified version numbers]: around v5.8.0/5.9.0, 【瘦臉瘦身】 gained **背景保護**, "no more worrying about a crooked picture". — reported in changelog mirrors surfaced by search ([gameggg](https://www.gameggg.com/app/3095.html), [beihangsoft](https://www.beihangsoft.cn/app/2190.html))
- **Precision (2026 review)** [3rd-party]: 醒圖 has the most granular controls (head, shoulders, chest, waist, hips, leg length and thickness) and the best strength controllability. — [FlowPix test](https://www.flowpixai.com/tutorials/ai-photo-slimming.html)
- **Manual workflow** [3rd-party]: brush-select a region (for example the left or right waist), then use 拉伸 (stretch) or 縮小 (shrink) on the selection. Zoom in to check the edges. — [eyun.baidu article](https://eyun.baidu.com/content/565631/)

**Facetune (Lightricks)**
- **No dedicated auto-body slider in the sources checked.** Body edits go through the generic **Reshape** tool [primary]:
  - Sub-tools: **Reshape** (drag or push pixels), **Refine** (smooth angles), **Resize** (proportions) and **Restore** (paint back to the original).
  - Use pinch to zoom for precision.
  - The tips say to under-do it and build up in light passes.
  - The tips also say to check straight background lines (door frames, walls) along the pushed edge. — [Facetune reshape feature page](https://www.facetuneapp.com/features/reshape-photo); [How to use Facetune 2025](https://www.facetuneapp.com/blog/how-to-use-facetune)
- **Help center**: the article returned HTTP 403 and was not read. — [Lightricks help](https://lightricks.zendesk.com/hc/en-us/articles/14799399876882-How-to-use-the-Reshape-tool-in-Facetune)
- **2026 review** [3rd-party]: Facetune's manual finger-push method gives high freedom but is unintuitive. — [FlowPix test](https://www.flowpixai.com/tutorials/ai-photo-slimming.html)

**Bodytune (a separate app, not Lightricks)** [3rd-party]
- It has dedicated **Waist** and **Hips** tools that you pinch with two fingers, plus a Refine swipe tool.
- A user review complains the waist and hip tools **cannot be repositioned along X/Y**, so they misalign on bent or leaning bodies. — [Bodytune Google Play](https://play.google.com/store/apps/details?id=net.braincake.bodytune&hl=en_IE)

**BeautyPlus (Meitu, web body editor)** [primary marketing]
- **Parts**: waist slimming, leg lengthening, arm toning, buttock lift and "muscle generator".
- **Flow**: the user selects the body area, sets intensity on a slider, then clicks Apply.
- **Claim**: "no background warping or object distortions".
- **Video**: no video support is mentioned. — [BeautyPlus body editor](https://www.beautyplus.com/body-editor)

**B612 and FaceApp** [3rd-party]
- B612: whole-body slimming only, with poor precision.
- FaceApp: a single "slimming" slider. — [FlowPix test](https://www.flowpixai.com/tutorials/ai-photo-slimming.html)

**影像之匠 PixPretty (desktop AI retoucher, a useful reference for parameters)** [vendor tutorial]
- **Detection**: about 30 body keypoints, with **0–100% sliders**.
- **Recommended values**:

| Tool | Recommended |
|---|---|
| Slim body | start at 30% |
| Height (legs stretched hip→ankle, head and torso kept) | 5–15%; each 10% ≈ 2–3 cm visual |
| Swan neck | 5–20% |
| Square shoulders | 30–50%; more looks stiff |
| Slim arms | 20–40% |
| Slim legs | thigh and calf adjusted separately |

- **Suggested order**: height first, then body and limbs, then neck and shoulders.
- **Claim**: "background stays rigid; only the body contour deforms". — [PixPretty reshaping guide](https://www.pixpretty.com/portrait-retouching-tips/reshaping.html)

### Inferences
- **Canonical feature set.** The "commercial standard" list, from the overlap of Meitu, 醒圖, the SDKs and PixPretty, is:
  - auto body (一鍵美體)
  - 瘦身 (overall slimming)
  - 細腰/瘦腰 (waist)
  - 長腿 / 增高 (longer legs, height)
  - 瘦腿 (slim legs)
  - 小頭 (smaller head)
  - 美肩/直角肩 (shoulders)
  - 天鵝頸 (swan neck)
  - 瘦手臂 (slim arms)
  - 美臀/提臀 (hips)
  - 胸部 (chest)
  - plus a manual push tool and a manual 增高 band

  An explicit 腰臀比 (waist-hip ratio) slider was not found in any consumer app. PixelFree's 沙漏腰 (hourglass waist) and 曲線 (curves) are the closest named equivalents (see Q2).
- **Two-tier UI.** Apps put AI auto sliders first and offer manual tools as a fallback for misdetection or fine control.
- **增高 as a separate tool.** 增高 is almost always a separate "vertical stretch of a user-chosen band" with two handles, not a skeleton-driven warp. That makes it the cheapest feature to implement: it needs no pose model.

### Gaps
- No primary-source detail was found for **Ulike, SNOW, Faceu (激萌), or the BeautyCam/Meitu in-app slider ranges and defaults**. App stores and help centers do not publish slider numbers.
- The Facetune help center returned 403, so I could not confirm whether Facetune currently has a dedicated body or waist auto tool. Its marketing pages describe generic Reshape only.
- **Snapseed**: no source checked. My unverified understanding is that it has no body-reshape tool, only perspective/expand, so it is not a useful reference.
- Most consumer-app version claims come from third-party download-site mirrors, not official release notes.

---

## Q2. What body parameters do beauty SDKs expose (names, ranges, defaults, one-way vs bidirectional, real-time vs photo)?

### Takeaway
Every major Chinese beauty SDK exposes a real-time, video-capable body module driven by 2D body keypoints. The keypoint counts are:

| Vendor | Body keypoints |
|---|---|
| FaceUnity | 25 |
| Tencent | 42 |
| BytePlus | 18 |
| PixPretty | ~30 |

They have converged on about 7–8 sliders: slim, legs long, legs thin, waist, shoulders, head, chest, arms, sometimes neck. Ranges split into two kinds:
- **One-way (0..1 or 0..100)** for slimming, legs, waist and head.
- **Bidirectional** for shoulders, chest and arms: −100..100, −1..1, or a 0.5-neutral scale.

PixelFree has the richest list. It includes hourglass waist, curves, hip lift and per-limb left/right control, all on a 0..1 scale with 0.5 neutral.

### Cited Findings

**FaceUnity 相芯 (Nama SDK; BodySlim.bundle)** [primary]

| Param (fuItemSetParamd) | Feature | Range | Default | Direction |
|---|---|---|---|---|
| `BodySlimStrength` | 瘦身 | 0.0–1.0 | 0.0 | one-way |
| `LegSlimStrength` | 長腿 (leg lengthening, despite the name) | 0.0–1.0 | 0.0 | one-way |
| `WaistSlimStrength` | 瘦腰 | 0.0–1.0 | 0.0 | one-way |
| `ShoulderSlimStrength` | 美肩 | 0.0–1.0 | **0.5** | **bidirectional**: 0.5 = neutral, >0.5 widens, <0.5 narrows |
| `HipSlimStrength` | 美臀 | 0.0–1.0 | 0.0 | one-way |
| `HeadSlim` | 小頭 | 0.0–1.0 | 0.0 | one-way |
| `LegSlim` | 瘦腿 | 0.0–1.0 | 0.0 | one-way |

- **Control parameters**: `clearSlim`=1 resets all; `Debug` 0/1 draws keypoints.
- **Combining**: when several features are on, their effects add linearly (線性疊加). — [FULiveDemo 美體道具功能文檔](https://github.com/Faceunity/FULiveDemo/blob/master/docs/%E7%BE%8E%E4%BD%93%E9%81%93%E5%85%B7%E5%8A%9F%E8%83%BD%E6%96%87%E6%A1%A3.md); English version listed in the [docs folder](https://github.com/Faceunity/FULiveDemo/tree/master/docs) as `Body_Beautification_Prop_Function_Documentation.md`
- **Marketing** [snippet]:
  - "seven beauty dimensions": 瘦身、長腿、細腰、美肩、美臀、小頭、瘦腿.
  - "25 human body points". — [FaceUnity effects (CN)](https://www.faceunity.com/effects.html); [FaceUnity effects (EN)](https://www.faceunity.com/en/effects.html)
- **Version history** [snippet, not verified line by line]:
  - Nama **6.4.0** introduced body slimming (瘦身, 長腿, 美臀, 細腰, shoulder) as a one-tap feature, **single person only**.
  - A later release added 小頭 and 瘦腿, reduced how much the frame is deformed, and improved stability.
  - A further release reduced **deformation of objects near the head and shoulders during large motions**, smoothed the transition when a person enters or leaves the frame, and improved behaviour under occlusion. — [FULiveDemoMac releases](https://github.com/Faceunity/FULiveDemoMac/releases); [jianshu integration notes](https://www.jianshu.com/p/6dbb16c02afc)
- **Newer demos** [snippet]: body parameters are managed through a `BodyBeautyDataFactory`. — [jianshu integration notes](https://www.jianshu.com/p/6dbb16c02afc)
- **FURenderKit property names**: the search summary offered names such as `bodySlimIntensity` and `legStretchIntensity`, but explicitly labelled them as from memory. **Unverified; do not rely on them.**

**Tencent Effect 騰訊特效 SDK (XMagic)** [primary]
- **New parameter table (after V3.3.0)**, set through `setEffect`. Constants are in `XmagicConstant.java` / `XmagicConstant.h`. None needs a resource path.

| Constant | Effect value | Feature | Range |
|---|---|---|---|
| `BODY_AUTOTHIN_BODY_STRENGTH` | `body.autothinBodyStrength` | 一鍵瘦身 | 0~100 |
| `BODY_LEG_STRETCH` | `body.legStretch` | 長腿 | 0~100 |
| `BODY_SLIM_LEG_STRENGTH` | `body.slimLegStrength` | 瘦腿 | 0~100 |
| `BODY_WAIST_STRENGTH` | `body.waistStrength` | 瘦腰 | 0~100 |
| `BODY_THIN_SHOULDER_STRENGTH` | | 瘦肩 | 0~100 |
| `BODY_ENLARGE_CHEST_STRENGTH` | | 胸部 | **−100~100** (bidirectional) |
| `BODY_SLIM_HEAD_STRENGTH` | | 小頭 | 0~100 |
| `BODY_SLIM_ARM_STRENGTH` | | 瘦手臂 | **−100~100** (bidirectional) |

  — [Tencent Effect param table (Android & iOS)](https://cloud.tencent.com/document/product/616/103616)
- **Old interface (≤ V3.3.0)**: 一鍵瘦身, 長腿, 瘦腿, 瘦腰, 瘦肩, 小頭, and 豐胸 (added in V3.0.0).
  - It uses `XmagicProperty` with `Category.BODY_BEAUTY`.
  - Default values are configured in the demo's `assets/beauty_panel/beauty_body.json`. — [Tencent old Android table](https://cloud.tencent.com/document/product/616/78792); [Tencent Android API](https://cloud.tencent.com/document/product/616/65896)
- **Callback**: `onBodyDataUpdated` fires **only when a body property is set and a body is detected**. — [Tencent Android API](https://cloud.tencent.com/document/product/616/65896)
- **Packaging** [snippet]:
  - Body is an "expandable feature" only in the top S-series tier.
  - It is also sold as an atomic capability, "X1-07 高級美體", which covers 一鍵瘦身, 長腿, 瘦腿, 瘦腰, 瘦肩, 瘦胳膊, 小頭 and 胸部.
  - That capability comes with **人體42點位** (42-point body landmarks). — [Tencent feature description](https://cloud.tencent.com/document/product/616/67043)
- **uni-app plugin** [snippet]: app-level strengths are clamped to 0..1 or −1..1 unless "enhanced mode" is on. — [DCloud plugin](https://ext.dcloud.net.cn/plugin?id=17646)

**Alibaba Cloud Queen SDK 美顏特效SDK** [primary]
- **Eight effects**: 瘦身, 長腿, 小頭, 瘦腿, 豐胸, 手臂, 脖子 (neck), 瘦腰.
  - Positioned for live streaming and panorama shooting.
  - V1.7.0 (2022-01-05) added four body features; V2.0.0 (2022-04-15) added four more. — [Queen SDK overview](https://help.aliyun.com/zh/vod/developer-reference/queen-sdk-overview-new); [Queen effects showcase](https://help.aliyun.com/zh/live/developer-reference/experience-beauty-effects-sdk)
- **Android API**:
  - Enable with `engine.enableBeautyType(BeautyFilterType.kBodyShape, true /*on*/, false /*debug*/)`.
  - Set each effect with `engine.updateBodyShape(BodyShapeType.X, value)`. Values for X: `kFullBody`, `kSmallHead`, `kThinLeg`, `kLongLeg`, `kLongNeck`, `kThinWaist`, `kEnhanceBreast`, `kThinArm`.
  - **All eight take −1..1** (bidirectional).
  - Frames must be fed with `updateInputTextureBufferAndRunAlg`. — [Queen Android feature doc](https://www.alibabacloud.com/help/en/live/developer-reference/feature-descriptions-for-android). This doc is older; check enum names against the current headers.
- **iOS API**: `setBodyShape:(kQueenBeautyBodyShapeType)value:`, after enabling `kQueenBeautyTypeBodyShape`. — [QueenEngine iOS reference 6.1.0](https://alivc-demo-cms.alicdn.com/versionProduct/doc/queen/6.1.0/ios_en/Classes/QueenEngine.html)
- **Web SDK** (npm `aliyun-queen-engine`):
  - `setBodyShape(bodyShapeType, value)`.
  - Body is available only in the **Pro and Full** builds.
  - Models load on demand (`kQueenModelShapeType`).
  - This is notable as a **browser-side real-time body-reshape** reference, but it is a licensed, proprietary product. — [Queen Web integration](https://help.aliyun.com/zh/live/developer-reference/integrate-the-queen-sdk-for-web); [npm aliyun-queen-engine](https://www.npmjs.com/package/aliyun-queen-engine)
- **Release** [snippet]: Android 6.8.1 shipped on 2024-08-27. — [Queen SDK download](https://help.aliyun.com/document_detail/211050.html)

**ByteDance / BytePlus Effects (CV SDK)** [primary]
- **Body shaping**:
  - Body shaping is a composer-node effect in `ComposeMakeup.bundle`, alongside beauty, reshape and makeup.
  - Intensity is set with `updateComposerNodes`. `setReshape` is only for v2.6 and earlier.
  - Real-time effects work in video and photos. — [BytePlus Effects Java API](https://docs.byteplus.com/en/docs/effects/docs-java-api); [Beauty docs](https://docs.byteplus.com/en/docs/effects/docs-beauty)
- **Skeleton detection**:
  - **18 keypoints** in real time.
  - Multi-person, with ≤3 recommended.
  - Handles half-body, side and back views, and partial occlusion.
  - "<6 ms on iPhone 7". — [BytePlus Body Keypoints](https://docs.byteplus.com/en/docs/effects/docs-body-sdk)
- **Public docs do not list the body slider names or ranges.**

**PixelFree 望圖 (github.com/uu-code007/PixelFreeEffects)** [primary README]
- **`PFBodyBeautyType`** covers:
  - 瘦身, 瘦肚子 (belly), 瘦腰, **沙漏腰** (hourglass waist), **曲線** (curves), 全身瘦 (whole-body)
  - **提跨** (hip lift), **豐臀** (fuller hips), 豐胸, 長腿, 天鵝頸
  - 瘦肩膀, 直角肩, 手臂 (overall)
  - **left/right upper arm, left/right forearm, left/right thigh, left/right calf**
- **Scale**: every item uses **0~1 with 0.5 as the neutral default**, which makes all of them bidirectional.
- **Platforms**: iOS, Android, HarmonyOS, Windows, macOS and Linux; aimed at live streaming, short video, cameras and photo processing. — [PixelFreeEffects README](https://github.com/uu-code007/PixelFreeEffects); [iOS doc](https://github.com/uu-code007/PixelFreeEffects/blob/master/doc/doc_iOS.md)
- **pub.dev changelog** (2.4.9–2.4.17): no body-specific entries. — [pixelfree changelog](https://pub.dev/packages/pixelfree/versions/2.4.17/changelog)

### Inferences
- **Real-time vs photo-only.** All five SDKs (FaceUnity, Tencent, Alibaba Queen, BytePlus, PixelFree) are real-time, video-first. Body reshape is evidently feasible per-frame on mobile GPUs from about 18–42 2D keypoints. Consumer "photo-only" features are the AI 一鍵減肥/增肌 (likely generative) and manual liquify.
- **Parameter design worth copying in spirit** (not names):
  - One-way 0..1, default 0, for 瘦身 / 細腰 / 長腿 / 瘦腿 / 小頭 / 天鵝頸.
  - Bidirectional for 美肩 / 胸部 / 手臂 / 臀, as either −1..1 or 0.5-neutral. FaceUnity, Tencent and Alibaba agree on this.
  - A per-side (left/right) limb option, as PixelFree does, helps with asymmetric poses.
  - A debug keypoint overlay (FaceUnity `Debug`, Queen's `debug` flag) is a standard developer aid.
- **Effects add up.** FaceUnity's note that effects "add linearly" suggests each part is a separate displacement field and the fields are summed. That maps naturally onto a backward-warp shader that accumulates per-part offsets, like our existing `reshape.ts` curveWarp/scaleAround/shiftAround design.
- **腰臀比.** It can be modelled as a combination of 細腰 (waist in) and 美臀/豐臀 (hips out). PixelFree's separate 沙漏腰 and 提跨/豐臀 items support exposing it as one composite slider over two underlying fields.
- **Keypoints for our app.** For our app the keypoint source would be MediaPipe Pose Landmarker (33 landmarks). That count is from general knowledge and was not verified in this pass. It is in the same range as the SDKs' 18–42.

### Gaps
- No public numeric **defaults** for Tencent body items were found (they sit in the demo `beauty_body.json`, which was not read) and none for Alibaba (only ranges).
- Not found: **SenseTime** (商湯) body-param docs or **Banuba** body reshape. They were not searched, given the budget.
- The PixelFree enum **identifier names and header file** were not verified. Only the README feature list and the 0..1 / 0.5 rule were.
- Not verified: FaceUnity FURenderKit (new API) property names, and the exact release versions for 小頭/瘦腿.

---

## Q3. Typical intensities, quality pitfalls, and how apps mitigate them

### Takeaway
The dominant failure is **background warping**: bent door frames, walls, windows, tables and striped patterns next to the body. Others are proportion imbalance (thin legs with unchanged feet, a narrowed waist without matching chest), smeared liquify edges, and, in video, deformation of objects near the head and shoulders during large motion or when a person enters or leaves the frame.

Mitigations seen in the wild:
- a **背景保護 (protect background) toggle** (醒圖, Meitu)
- person-mask "rigid background" approaches (PixPretty and BeautyPlus claims)
- conservative defaults
- a Restore brush (Facetune)
- user guidance to zoom and inspect

Practical "safe" intensities cluster around **20–30% for slimming** and **5–15% for leg stretch**.

### Cited Findings
- **Pitfalls documented in a 6-app test** (Meitu, FaceApp, 醒圖, 輕顏, Facetune, B612):
  - Background distortion: walls, door frames and stripes bend.
  - Proportion imbalance: legs thinned but feet unchanged; waist reduced without chest adjustment.
  - Liquify artifacts: blurred or twisted edges.
  - "A light touch already looks exaggerated."
  - Recommended max **20–30%**. Advice: shoot against plain backgrounds, adjust incrementally, and zoom to inspect. — [FlowPix test (2026-02-08, updated 2026-06-21)](https://www.flowpixai.com/tutorials/ai-photo-slimming.html)
- **醒圖 背景保護**: added to 瘦臉瘦身 around v5.8/5.9. Users are advised to turn it on for photos with many straight lines and to stay at or below about 30% [3rd-party, version unverified]. — [gameggg mirror](https://www.gameggg.com/app/3095.html); [FlowPix test](https://www.flowpixai.com/tutorials/ai-photo-slimming.html)
- **Meitu 增高**: recommended 5–15%. Over-stretching makes background distortion obvious, so frame the stretch band accurately [3rd-party]. — [automazin tutorial](https://www.automazin.com/Blogs/%E7%BE%8E%E5%9B%BE%E7%A7%80%E7%A7%80%E5%A2%9E%E9%AB%98%E5%8A%9F%E8%83%BD%E4%BD%BF%E7%94%A8%E6%95%99%E7%A8%8B.html)
- **Facetune guidance**: under-reshape, build up in light passes, zoom in, and watch straight lines such as door frames and walls along the pushed edge. **Restore** paints back to the original. — [Facetune reshape page](https://www.facetuneapp.com/features/reshape-photo); [How to use Facetune](https://www.facetuneapp.com/blog/how-to-use-facetune)
- **PixPretty**:
  - Claims "background stays rigid; only the human contour deforms".
  - Recommended ranges: slim 30% start, height 5–15%, neck 5–20%, shoulders 30–50% (more looks stiff), arms 20–40%. — [PixPretty guide](https://www.pixpretty.com/portrait-retouching-tips/reshaping.html)
- **BeautyPlus** claims "no background warping or object distortions" [marketing claim, unverified]. — [BeautyPlus body editor](https://www.beautyplus.com/body-editor)
- **FaceUnity release notes** [snippet]: fixes for **large deformation of objects near the head and shoulders during large motion**, smoother transitions when a person enters or leaves the frame, and more stable results under occlusion. Body was **single-person only** at launch. — [FULiveDemoMac releases](https://github.com/Faceunity/FULiveDemoMac/releases)
- **Bodytune review**: fixed-position waist and hip tools misalign on bent or leaning bodies. — [Bodytune Google Play](https://play.google.com/store/apps/details?id=net.braincake.bodytune&hl=en_IE)
- **Starting values** [snippet]: a BeautyCam 2024 tutorial suggests about 50% for 瘦身/長腿/瘦腰/瘦手臂 in the live camera. That is higher than photo-editor advice, and real-time SDK curves are probably tuned so that 50% is mild (inference).

### Inferences
- **How "背景保護" probably works.** The implementation is not documented anywhere I found. The likely approach is a person segmentation mask that confines the displacement field to the body plus a feathered margin, with the background inpainted or stretched into the vacated gap. The marketing phrase "background stays rigid" supports this. For our PWA, MediaPipe's selfie/multiclass segmenter could supply the mask on-device, at a memory cost.
- **Straight lines.** Automatic straight-line detection (keep detected lines straight) was **not found** in any source. The only mitigation documented is the mask-based "protect background" approach. Treat line detection as a possible differentiator, not a standard feature.
- **Our defaults.** Defaults should be 0 (off) for one-way items. The max should be capped so that 100% on the slider corresponds roughly to the "20–30% safe" region apps describe. Real-time camera mode should be gentler than the photo editor.
- **Video stability.** Smooth keypoints over time, and fade the effect in and out when the body enters, leaves or is occluded. FaceUnity had to fix exactly this.

### Gaps
- No source reported pitfalls with **hands, props or clothing patterns** specifically, beyond "striped patterns bend". These are likely but not sourced.
- Did not find whether Meitu's or 醒圖's background protection uses segmentation, inpainting, or edge-preserving warps.
- No quantitative user-complaint data, such as review mining, was gathered.

---

## Q4. What does a good mobile body-retouch UI look like?

### Takeaway
The prevailing pattern is:
- a 美體 tab with a horizontally scrolling row of part icons (auto / 瘦身 / 腰 / 腿 / 頭 / 肩 / 胸 / 臀 / 手臂 / 頸)
- one slider per selected part, with 0-centred sliders for bidirectional items
- a press-and-hold before/after compare
- a one-tap auto option or presets (美體套裝)
- manual tools in a separate sub-mode: push/liquify with brush size, a 增高 band with two draggable handles, brush region-select for local stretch or shrink, and Restore
- a 背景保護 toggle

### Cited Findings
- **Automatic plus manual tiers** (醒圖): automatic body (legs, waist, shoulders, hips) plus manual (local slim, height stretch, proportion) with a user-defined range and strength. — [ddooo mirror](https://www.ddooo.com/softdown/166858.htm)
- **Manual region selection** (醒圖): brush-select a region, then 拉伸 (stretch) or 縮小 (shrink). — [eyun.baidu](https://eyun.baidu.com/content/565631/)
- **Two-handle stretch band** (Meitu 增高): two horizontal bars mark the band, and a slider sets the amount. — [automazin tutorial](https://www.automazin.com/Blogs/%E7%BE%8E%E5%9B%BE%E7%A7%80%E7%A7%80%E5%A2%9E%E9%AB%98%E5%8A%9F%E8%83%BD%E4%BD%BF%E7%94%A8%E6%95%99%E7%A8%8B.html)
- **Push tool** (Meitu 手動瘦身, also on video/Live): "push where you want slimmer". — [jb51 mirror](https://www.jb51.net/softs/56367.html)
- **Live camera with presets** (美顏相機): 美體 in the camera with sliders and three body presets. — [ddooo mirror](https://www.ddooo.com/softdown/81999.htm)
- **Facetune**: Reshape, Refine, Resize and Restore sub-tools, pinch-zoom, and a checkmark to commit. — [Facetune reshape page](https://www.facetuneapp.com/features/reshape-photo)
- **BeautyPlus web**: select area, set intensity on a slider, Apply. — [BeautyPlus body editor](https://www.beautyplus.com/body-editor)
- **Bodytune**: per-part tools (Waist, Hips) you pinch with two fingers, plus undo. The lack of repositioning was criticised, which argues for draggable or rotatable region handles. — [Bodytune Google Play](https://play.google.com/store/apps/details?id=net.braincake.bodytune&hl=en_IE)
- **PixPretty**: slider-only AI, so no manual dragging is needed. It recommends doing height first, then body and limbs, then neck and shoulders. — [PixPretty guide](https://www.pixpretty.com/portrait-retouching-tips/reshaping.html)

### Inferences (UI recommendations for MonaLisa 美顏)
- **Panel.** Add a 美體 panel next to the existing face panels.
  - First item is a 一鍵美體 auto preset.
  - Then per-part chips: 瘦身, 細腰, 腰臀比, 美臀, 長腿, 瘦腿, 瘦手臂, 美肩, 胸部, 小頭, 天鵝頸.
  - Bidirectional items get a centre-zero slider.
- **Manual sub-mode for photos.**
  - 增高 band with two drag handles, which needs no pose model.
  - Push tool with a brush-size control.
  - Restore brush.
- **背景保護 toggle.** Use a segmentation mask when memory allows. On low-RAM iPhones, default it off or reduce its resolution.
- **Live camera.** Expose fewer, gentler body sliders. Front-camera selfies rarely show the full body, so show a "need full body in frame" hint (an inference based on Tencent's callback firing only when a body is detected). Hide or disable sliders whose keypoints are not visible.
- **Before/after.** Use press-and-hold compare, the standard across apps. No single source documents it for body specifically.

### Gaps
- No UX teardown article specifically about body-retouch panels was found within the budget. The UI pattern is assembled from app-store copy and tutorials.
- No screenshots were inspected, and none should be reused as assets. Exact icon order and default slider positions in Meitu and 醒圖 are unknown.
