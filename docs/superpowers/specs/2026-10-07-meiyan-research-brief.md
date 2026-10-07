> **Status:** research appendix to `2026-10-07-meiyan-pwa-design.md`. Where this brief and the design spec disagree, **the design spec wins** — in particular §0 "UI" and §6 "Recommendation" (Night Glass) are superseded: the user chose **Option C, Darkroom Pro**.

# 美顏 PWA: Design-Ready Brief (v1)

**Snapshot date:** 2026-10-07.

**Pinned sources:**
- **GP** = `github.com/pixpark/gpupixel` at `ef552bf8ce2d0d41fa9b979bfb5c7cf79374ca88`. This is main HEAD, pushed 2026-09-26. Latest release is v1.3.1 (2025-06-27). License Apache-2.0.
- **PF** = `github.com/uu-code007/PixelFreeEffects` at `156325c2a1a570683a63774b9ef623abdac25549` (2026-07-21). Used as a reference spec only.
- **MP** = `@mediapipe/tasks-vision` on npm, plus `github.com/google-ai-edge/mediapipe` (master).
- **WK n** = `bugs.webkit.org/show_bug.cgi?id=n`.
- **MPI n** = `github.com/google-ai-edge/mediapipe/issues/n`.

**Confidence labels:** facts are verified unless tagged LIKELY or UNVERIFIED. **[corrected]** marks a statement that was changed or narrowed by the adversarial verification pass. Refuted researcher claims have been removed.

---

## 0. Decisions at a glance

| Area | Decision |
|---|---|
| Engine | Port GPUPixel's GLSL by hand to WebGL2 / GLSL ES 3.00. GPUPixel uses 11 draws; the port uses 5 passes, plus 1 optional mask pass. Do not compile GPUPixel to WASM (see §1 #1). |
| Face tracking | MediaPipe FaceLandmarker. Pin `@mediapipe/tasks-vision@0.10.35` exactly, because it has no telemetry. Use the GPU delegate, fall back to CPU, run on the main thread in v1, and set `numFaces: 1`. An adapter turns the 478 MediaPipe points into GPUPixel's 111 points. |
| App | Vite 8 + TypeScript + Preact for the UI. The engine is plain TypeScript. Add vite-plugin-pwa 2.0.0. One page, no router, static deploy on Vercel. |
| Targets | Safari and Home Screen web app on iOS 18.x, 26.x and 27. Only the iPhone portrait layout is supported. |
| UI | "Night Glass" (dark frosted) for the camera, and the same tokens without transparency for the editor. One pink accent. Themes are CSS custom properties. |
| Parameters | Stored as 0..1 floats. One-way sliders are neutral at 0; bidirectional sliders are neutral at 0.5 (PixelFree model). UI shows 0–100 or −50…+50. |

---

## 1. Key constraints (hard platform limits that shape the design)

| # | Constraint | Design consequence | Source |
|---|---|---|---|
| 1 | **Neither SDK has a web build.** mars_vision exists only as prebuilt android/ios/macos libraries. GPUPixel's Emscripten plumbing (GPUPIXEL_WASM, a WebGL2 context on `#gpupixel_canvas`) links only with `-DGPUPIXEL_ENABLE_FACE_DETECTOR=OFF`. With the default ON setting, `src/CMakeLists.txt:452-453` references an undefined `marsface::marsface`. It also needs `-sMAX_WEBGL_VERSION=2`, and `~GPUPixelContext` dereferences null under WASM **[corrected]**. The maintainer has declined WASM support ("不准备支持了", issue #91). Web-SDK PR #138 was merged on 2025-02-25 and reverted by #139. In #203 the maintainer tried MediaPipe inside WASM and gave up as too slow and too large. PixelFree needs `pixelfreeAuth.lic` at runtime. | Hand-port the shaders. Use a browser face model. | GP `third_party/mars-face-kit/`; `github.com/pixpark/gpupixel/issues/91`, `/pull/138`, `/pull/139`, `/issues/203`; PF `SMPixelFree.h` |
| 2 | iOS 27 / Safari 27 shipped 2026-09-14 and supports the same devices as iOS 26 (A13 and later). iPhone XS/XR stop at iOS 18. Wasm SIMD has been available since Safari 16.4, WebGL in OffscreenCanvas since 17, and VideoFrame since 16.4. | Support Safari 18/26/27. Ship only the SIMD wasm. | Safari 27 release notes JSON; macrumors.com 2026/06/08; webkit.org/blog/13966 |
| 3 | WebGL2 has shipped since Safari 15 and runs on Metal. WebGPU ships only in Safari 26 and later. MediaPipe vision tasks expose only `"CPU" \| "GPU"`, and GPU means WebGL. | Renderer is WebGL2 only. WebGPU is a later option behind `navigator.gpu`. | webkit.org/blog/17333; MP `vision.d.ts`; MPI 5826 |
| 4 | In GLSL ES 3.00 fragment shaders there is no default float precision. `highp` is IEEE fp32. `mediump` can be fp16 on iPhone; how ANGLE-on-Metal maps it is UNVERIFIED. | Start every shader with `precision highp float;`. Replace GPUPixel's `lowp vec4 sum` blur accumulator. | Khronos GLSL ES 3.00 spec; GP `src/filter/box_mono_blur_filter.cc` |
| 5 | iOS WebGL2 limits: MAX_TEXTURE_SIZE is at least 8192 on 100% of devices and at least 16384 on 98%. EXT_color_buffer_float is on 100%. OES_texture_float_linear is on only about 51%. | Use RGBA8 FBOs by default, which matches GPUPixel. RGBA16F is allowed for intermediates. Never depend on linear filtering of fp32 textures. | web3dsurvey.com (MAX_TEXTURE_SIZE, EXT_color_buffer_float, OES_texture_float_linear) |
| 6 | **Memory.** A page was killed at about 100 MB on an iPhone SE 3 and about 200 MB on an 8th-gen iPad (both iOS 26.2). The kill cannot be caught **[corrected: SE 3 = 100 MB, iPad 8 = 200 MB]**. There is no published per-page limit. The "about 1.5 GB" figure comes from an Apple engineer's comment on WK 268816 and is not documentation **[corrected: "documented" refuted]**. Typed arrays and Wasm are capped at 2 GB (Gigacage). The 2D canvas area cap is 8192² on current WebKit (276145@main). It was 4096² before; the iOS version that shipped the raise is UNVERIFIED. A 48 MP import is 195 MB per RGBA8 copy. | Downscale imports when decoding. Reuse FBOs in a ping-pong. Never allocate at camera-sensor or 48 MP resolution. Measure on an SE-class device. Implemented: the import probe reads the oriented size from the header only (detached `<img>` load, no `decode()`), then makes exactly one `createImageBitmap` call with `resizeWidth/resizeHeight`. WebKit's `createImageBitmap(Blob)` still decodes the full frame once internally (about 98 MB for 24 MP, about 195 MB for 48 MP), so the peak is halved, not removed; the import still needs measuring on an SE-class device. | lapcatsoftware.com/articles/2026/1/7.html; WK 268816; WebKit `CanvasBase.cpp` |
| 7 | **Camera.** Only one capture can run at a time. An unconstrained stream defaults to 640×480. Front-camera pixels are **not** mirrored; a CSS flip affects display only. In the background WebKit mutes the track. The automatic unmute is skipped while an OS interruption (such as a call) is active, and recovery may **require a user gesture** **[corrected]**. | Keep one long-lived stream. Pass explicit constraints. Mirror in the present pass. Recovery UI must have a tap-to-resume button. | webkit.org/blog/7763; WK 179363; WK 269846; WebKit `Document.cpp` |
| 8 | **Standalone-mode camera hazards.** (a) Permission is not guaranteed to persist across cold launches (STRICH KB, updated 2026-08-27). The "iOS 18.5 regression" is anecdotal and UNVERIFIED **[corrected]**. (b) WebKit re-prompts about 1 minute after capture stops. (c) WK 252465 gives a black stream in standalone mode only, with reports through iOS 18.5. There is no reliable user-side fix; rebooting only sometimes helps **[corrected: "only reboot fixes" refuted]**. (d) WK 323550: `getSettings()` reports sensor dimensions. (e) Apple forum 801146 reports a home-screen camera rotated 90° on iOS 26 (UNVERIFIED). (f) iOS 26 opens every Home Screen site as a web app by default, so a "use Safari instead" fallback needs explicit instructions. | Show a "tap to start camera" gate on each launch. Keep the stream alive across in-app screens. Read frame size from `video.videoWidth/Height`. Check rotation. Provide a Safari-tab fallback with steps. | WK 215884, 252465, 323550; kb.strich.io/article/29-camera-access-issues-in-ios-pwa; Safari 17.2 notes |
| 9 | Hash navigation (fixed in 14.5) and `pushState` (fixed in 17.5) used to kill camera capture. | One page, in-memory UI state, no router. | WK 215884, 269846 |
| 10 | **Saving.** There is no Photos API. `navigator.share({files})` offers "Save Image". It needs transient activation, which lasts 5 s. `<a download>` in standalone mode traps the user in Quick Look. | Encode the JPEG right after the shutter. Call share synchronously inside the Save tap handler. Fall back to an `<img>` the user long-presses. | WebKit `LocalDOMWindow.cpp` (`defaultTransientActivationDuration{5_s}`); WK 255641, 236943, 275288 |
| 11 | **Install.** There is no `beforeinstallprompt`; WebKit opposes it. The manifest `orientation` and `display: fullscreen` are unsupported. `apple-touch-icon` takes precedence over manifest icons. iOS 27 moved Share again (Apple Support: "Page Menu button"); this is backed by MacStories #517, Firtman and PR kotoba_line #263 **[corrected: multi-sourced]**. | Generic install hint text. Portrait-only layout. Provide both icon kinds. | MDN BCD; webkit.org/blog/16993; Apple Support iOS 27 |
| 12 | **Storage.** Home Screen app storage is isolated from Safari: cookies, localStorage and IDB by design. Whether CacheStorage/SW are shared is UNVERIFIED. Quota is up to 60% of disk. The 7-day cap uses a separate counter for Home Screen apps. `persist()` is heuristic. Lockdown Mode disables Service Workers and the Cache API. | Expect a second engine download after install. The app must work without a SW. | WK 181849; webkit.org/blog/14403, /10218; Safari 16.4 notes |
| 13 | **MediaPipe on the web.** RunningMode is only IMAGE or VIDEO. `detect`/`detectForVideo` are synchronous and block the thread. One-Euro smoothing applies only when `numFaces==1` in VIDEO mode. The wasm is single-threaded (no SAB), so COOP/COEP is not needed. Versions 1.0.0 and later POST usage metrics to `https://odml.pa.googleapis.com/v1/log` every 60 s with no API opt-out. 0.10.35 has no telemetry. | Set `numFaces: 1`, pin 0.10.35, send no isolation headers, and add CSP `connect-src 'self'`. | MP `vision.d.ts`; `face_landmarker_graph.cc` L448-459; `task_runner.ts`; package README "Privacy Notice" |
| 14 | **Sizes.** 0.10.35 SIMD wasm is 11,153,617 B raw. For 1.1.0 it is 12,997,248 B raw and about 2.65 MB (local brotli) or 3.50 MB (jsDelivr brotli). Each loader `.js` is about 335 KB (1.1.0 figure). `face_landmarker.task` is 3,758,596 B (float16/1, last-modified 2023-05-03). Vercel does not compress octet-stream, and gzip only reaches 3.33 MB anyway. | First-run download is roughly 6–8 MB over the wire. Needs a progress UI. | npm tarballs; storage.googleapis.com/mediapipe-models/...; vercel.com/docs/compression |
| 15 | **Vercel.** Default static Cache-Control is `public, max-age=0, must-revalidate`. `headers` go in `vercel.json`. `application/wasm` is compressed automatically. Hobby limits: 100 MB CLI upload, 100 GB/month transfer. Workbox's default precache limit is 2 MiB per file. | Explicit immutable headers on versioned paths. Ship one wasm variant. Raise the precache limit or use a runtime cache. | vercel.com/docs/caching/cache-control-headers, /limits; workbox-build `types.ts` |
| 16 | A Next.js static export cannot set `headers`/rewrites, and there is nothing to server-render. | Use Vite. | nextjs.org/docs/app/guides/static-exports |
| 17 | **HEIC.** Decoding is supported since Safari 17. `accept="image/*"` returns HEIC originals (275726@main). Putting `image/heic` in `accept` reportedly converts JPEG/PNG to HEIC. `createImageBitmap(..., {imageOrientation:'from-image'})` works since Safari 16. `createImageBitmap(heicBlob)` is LIKELY to work but UNVERIFIED. | Use `accept="image/*"` with no `capture` attribute. Decode with createImageBitmap and fall back to `img.decode()`. | WK 267277; developer.apple.com/forums/thread/743049; MDN BCD |
| 18 | **Haptics.** iOS has no `navigator.vibrate`. The hidden `<input type=checkbox switch>` trick (Safari 17.4+) fires only on a real tap since iOS 26.5 (WebKit 309082). | Haptics on taps only. No haptic detents on sliders. | github.com/mxerf/tappt README; ionic-framework issue 29942 |
| 19 | **Layout regressions.** WK 301108 (viewport-fit=cover, iOS 26) is still NEW; its reporter said on 2026-01-20 that the main symptom was partly fixed. `black-translucent` plus the Liquid Glass scroll-edge blur in iOS 26/27 standalone mode has **contested** fixes: remove the meta tag, add an opaque fixed top box, or add padding. Removing the meta tag makes `env(safe-area-inset-top)` 0. iOS reads the setting at install time **[corrected]**. | Test on real devices after every iOS update. Design the top bar to tolerate both variants. | WK 301108; github.com/amir20/dozzle/pull/5222; ItHasU/eurekai #16; xdoubleu/tools.xdoubleu.com #1987 |

---

## 2. Engine port plan (GPUPixel to WebGL2)

### 2.1 Conventions (apply to every pass)

- **GLSL ES 3.00 conversion.** GPUPixel's GLES shaders are GLSL ES 1.00 with no `#version`. For each one:
  - Add `#version 300 es`.
  - Change `attribute`/`varying` to `in`/`out`, `texture2D` to `texture`, and `gl_FragColor` to `out vec4`.
  - Change `float facePoints[212]` to `vec2 uPts[111]`. Dynamic indexing is legal in ES 3.00. The minimum fragment uniform vectors in GLES3 is 224 (from memory, not re-fetched).
  - Replace client-side vertex and index arrays with VBO/IBO/VAO, which WebGL requires.
  - Use `Uint16` indices.
  - Source: GP `src/filter/*.cc`. GPUPIXEL_GLES_SHADER covers iOS, Android and WASM (`include/gpupixel/gpupixel_define.h:55-59`).
- **Coordinates.** Keep GPUPixel's convention that **texture v=0 is the image's top row** through the whole FBO chain.
  - Upload frames with `UNPACK_FLIP_Y_WEBGL=false`.
  - Landmarks are normalized with a top-left origin, as in `face_detector.cc:58-70`. They map to UV directly, and to NDC as `2·p−1` with no flip (`face_makeup_filter.cc:214`).
  - Flip Y once, in the final present. Mirror X there too for the front-camera preview.
  - For capture, render into an FBO with the internal convention. `readPixels` then returns rows top-first, which matches `ImageData` order (LIKELY; check on device).
- **Isotropy.** All warp distances use `iso(p) = vec2(p.x, p.y / aspect)` with `aspect = W/H` (`face_reshape_filter.cc`).
- **Static textures.**
  - Upload with `UNPACK_COLORSPACE_CONVERSION_WEBGL=NONE`, `UNPACK_PREMULTIPLY_ALPHA_WEBGL=false`, `FLIP_Y=false`, or with `createImageBitmap(..., {colorSpaceConversion:'none', premultiplyAlpha:'none'})`.
  - Better: strip sRGB/gAMA/cHRM/iDOT chunks at build time. They are present on lookup_gray, lookup_light, lookup_custom and blusher.
  - Use LINEAR filtering, CLAMP_TO_EDGE, and no mipmaps. This matches `gpupixel_framebuffer.cc:19-30`.
  - Add a runtime self-test that reads back one LUT texel. How Safari handles the unpack flag is UNVERIFIED.
- **Render resolution.** Never render at devicePixelRatio. Render at the video's processing resolution (§2.6) and scale with CSS.

### 2.2 Pipeline: GPUPixel vs port

GPUPixel demo order is source → LipstickFilter (2 draws) → BlusherFilter (2) → FaceReshapeFilter (1) → BeautyFaceFilter (6) → sink, 11 draws in total (`demo/ios/demo/VideoFilter/VideoFilterController.mm:132-138`). Makeup is drawn **before** reshape so it moves with the warp.

| Pass | Input | Output | Resolution | Draws | Skip when |
|---|---|---|---|---|---|
| P0 face mask (new, optional) | landmarks | M (R8) | ¼ | 1 | no face, or "match GPUPixel" mode |
| P1 makeup | T_src | A | full | blit + 1 mesh | lip = blush = 0, or no face |
| P2 reshape | A (or T_src) | B | full | 1 | all reshape params neutral, or no face |
| P2′ mask warp (`maskWarp`) | M | N (R8) | ¼ | 1 | no mask (P0 skipped), or P2 skipped |
| P3 mean H | B | C | full or ½ | 1 | smooth = 0 (mean unused) |
| P4 mean V | C | D | same as P3 | 1 | smooth = 0 |
| P5 composite (skin + sharpen + whiten + rosy + LUT + present) | B, D, M, LUTs | canvas (flip Y, mirror X) or capture FBO (reuses A) | full | 1 | never |

P2′ runs M through the same ReshapePass (same uniforms, yaw attenuation and the processing size's aspect) into N, so the skin mask P5 reads follows the reshaped face instead of the unwarped landmarks. Buffers are A, B full-size and C, D full or half, plus the ¼-res R8 masks M and N. At 720×1280 RGBA8 each buffer is 3.7 MB. At 2048×1536 each is 12.6 MB, so about 63 MB with full-resolution means and about 44 MB with half-resolution means.

### 2.3 Skin (美膚): BeautyFaceFilter to P3, P4, P5

GPUPixel sources: `beauty_face_filter.cc:26-56`, `box_blur_filter.cc`, `box_mono_blur_filter.cc:56-203`, `gaussian_blur_mono_filter.cc:87-117`, `box_high_pass_filter.cc`, `box_difference_filter.cc:31-52,82`, `beauty_face_unit_filter.cc:14-158,317-386`.

**GPUPixel structure.** Six full-resolution passes:
- BoxBlur H and V produce the mean.
- BoxHighPass runs its own **identical** BoxBlur H and V (radius 4, texelSpacing 4), then a difference pass.
- BeautyFaceUnit does the composite.
- The mean is computed twice. The port computes it once.

**P3/P4 mean (sparse kernel, reproduce exactly to match the look).**
- Five taps per axis at offsets `{0, ±1.5, ±3.5} × spacing 4` texels, which is `{0, ±6, ±14}` px.
- Weights are 1/9 (center) and 2/9 (each of the other four).
- Taps land on texel centers, so the bilinear pair trick does nothing. The result is a 25-point sparse 2D grid over 29×29 px, not a true box.
- Frequency response per axis is H(f) = 1/9 + 4/9·cos(12πf) + 4/9·cos(28πf): +1.00 at a 2 px period, −0.78 at 4 px, +0.83 at 7 px. Expect ringing or ghosting on fine texture. This is analytic; visual artifacts are UNVERIFIED.
- Uniform: `uStep` = (spacing / W, 0) or (0, spacing / H).
- **Port decision:** GPUPixel's offsets are fixed in pixels, so the effect shrinks as resolution grows. Define the offsets at a 720 px short edge and multiply by `shortEdge/720`, so the preview and the full-resolution capture look the same. The half-resolution mean option halves the offsets in half-res texels. It changes the look slightly and should be A/B tested.

**P5 composite, part 1: smoothing and sharpen.** GLES semantics: the gate is `>= 0`, so sharpen applies even when smoothing is 0, and output alpha is `I.a`. Source: `beauty_face_unit_filter.cc:64-93`.

```glsl
vec3 I = texture(uSrc, vUv).rgb, Mn = texture(uMean, vUv).rgb;
vec3 dv = (I - Mn) * 7.07;  vec3 V = min(dv * dv, 1.0);          // BoxDifference folded in (delta 7.07)
float p  = clamp((min(I.r, Mn.r - 0.1) - 0.2) * 4.0, 0.0, 1.0);   // red-channel "skin" ramp
p *= mix(1.0, texture(uMask, vUv).r, uMaskOn);                     // PORT ADDITION (P0 mask)
float mv = (V.r + V.g + V.b) / 3.0;
float k  = clamp((1.0 - mv / (mv + 0.1)) * p * uSmooth, 0.0, 1.0); // uSmooth = GPUPixel blurAlpha
vec3 c = mix(I, Mn, k);
vec3 s = 0.25*I + 0.125*(4 axial ±1px taps) + 0.0625*(4 diagonal taps);
c += uSharpen * (I - s) * 2.0;
```

- The `p` ramp starts at `min(I.r, mean.r−0.1) = 0.2` and reaches full strength at I.r ≥ 0.45 and mean.r ≥ 0.55. Light, brown or dyed hair and reddish or bright backgrounds get smoothed. Black hair does not **[corrected nuance]**.
- This is why the P0 mask is on by default.
- The intermediate is computed in fp32 inline, whereas GPUPixel stores the variance quantized to RGBA8. The difference is expected to be negligible (UNVERIFIED).

**P5 composite, part 2: whitening chain.** Runs only when `whiten > 0`. Source: `beauty_face_unit_filter.cc:95-158`. Constants: levelBlack = 0.0258820, levelRangeInv = 1.02657.

Steps:
1. Levels.
2. Per-channel `lookup_gray` curve (256×1). Mix with the input at 0.5, then mix with the smoothed color at 0.7.
3. `lookup_origin`, a 16³ LUT stored as 64×64 in 4×4 tiles, sampled with `texPos = rg·0.234375 + 0.0078125 + quad·0.25`.
4. Mix that with the leveled color at 0.7.
5. `lookup_skin`, a 16³ LUT.
6. `lookup_light`, a 64³ LUT stored as 512×512 in 8×8 tiles (GPUImage layout).
7. `mix(color, light, whiten)`.

Problems with the original:
- Steps 1–5 apply at **full strength for any whiten > 0**. Simulated skin (150,100,80) goes to (160,115,93) at whiten = 0.01 and to (173,135,121) at 0.5. That is a visible jump.
- At whiten = 1.0, white (255) becomes (212,229,246), dimmer and bluer, and (200,150,130) becomes (209,184,196), pinker.

**Port fix:** `c = mix(c, whitenChain(c, w), smoothstep(0.0, 0.1, w))` with `w = 0.5·v`. This caps at the iOS/desktop demo maximum of 0.5. The Android demo goes to 1.0, and macOS divides by another 10 inside `SetWhite` **[corrected]**. The chain is global, not skin-gated, as in GPUPixel.

**P5 composite, part 3: additions.** Rosy (§2.5) and the LUT filter (§2.5) follow.

**Samplers:** src, mean, mask, lookup_gray, lookup_origin, lookup_skin, lookup_light, filter LUT. That is 8, within the WebGL2 minimum of 16.

**Uniforms:** `uSmooth, uSharpen, uWhiten, uRosy, uFilterAmt, uTexel((shortEdge/720)/W, (shortEdge/720)/H), uMaskOn, uOut(flipY, mirrorX)`. The sharpen taps scale with resolution like the mean (`sharpenTexel` in `src/engine/uniforms.ts`, no clamp), so a full-resolution capture sharpens with the same footprint as the preview tier.

**Cost:** about 10 image fetches, 9 whitening LUT fetches, 2 filter LUT fetches and 1 mask fetch per pixel. Throughput on iPhone is UNVERIFIED.

### 2.4 Reshape (美型): FaceReshapeFilter to P2

GPUPixel source: `face_reshape_filter.cc:12-110, 256-271`. It is one backward-warp pass, and only thin-face and big-eye exist. GPUPixel has no V-chin, narrow-nose or other reshape items.

Its uniforms are `hasFace`, `facePoints[106*2]`, `aspectRatio = W/H`, `thinFaceDelta`, `bigEyeDelta`. The host uploads 222 floats into a 212-float uniform, and the extras are silently ignored. Do not copy that.

```glsl
uniform vec2 uPts[111]; uniform vec2 uExt[8];  // uExt = MediaPipe-only anchors (§2.7)
uniform float uAspect, uFace;                  // uFace: 0..1, eased ~150 ms on face gain/loss
vec2 iso(vec2 p){ return vec2(p.x, p.y / uAspect); }
vec2 curveWarp(vec2 tc, vec2 o, vec2 t, float d){          // GPUPixel verbatim logic
  vec2 dir = (t - o) * d;
  float r = distance(iso(t), iso(o));
  float k = clamp(1.0 - distance(iso(tc), iso(o)) / r, 0.0, 1.0);
  return tc - dir * k;                                      // content moves toward t for d>0
}
vec2 enlargeEye(vec2 tc, vec2 c, float R, float d){         // GPUPixel: magnify ONLY (w clamped)
  float w = distance(iso(tc), iso(c)) / R;
  w = clamp(1.0 - (1.0 - w*w) * d, 0.0, 1.0);
  return c + (tc - c) * w;
}
vec2 scaleAround(vec2 tc, vec2 c, float R, float d){        // PORT: bidirectional, |d|<=0.5 (monotonic, no fold)
  float w = distance(iso(tc), iso(c)) / R;
  return w >= 1.0 ? tc : c + (tc - c) * (1.0 - (1.0 - w*w) * d);
}
vec2 shiftAround(vec2 tc, vec2 c, float R, vec2 disp){      // PORT: local translate
  float w = distance(iso(tc), iso(c)) / R;  float k = clamp(1.0 - w*w, 0.0, 1.0);
  return tc - disp * k * k;
}
const ivec2 SLIM[9] = ivec2[9](ivec2(3,44),ivec2(29,44),ivec2(7,45),ivec2(25,45),
                               ivec2(10,46),ivec2(22,46),ivec2(14,49),ivec2(18,49),ivec2(16,49));
```

`enlargeEye` clamps `w` to [0,1], so a negative `d` does nothing. Every bidirectional scale needs `scaleAround`. With `d ≥ −0.5`, the mapping's derivative (1 − d + 3dw²) stays ≥ 0.

**Warp list, applied in this order in one pass.** GPUPixel does thinFace, then bigEye. Constants marked tune are placeholders to tune on device. Everything other than the first and last rows is a design choice of ours, not GPUPixel code (UNVERIFIED visual quality).

| Param | Primitive | Anchors (GPUPixel 111 indices unless marked ext) | Delta |
|---|---|---|---|
| 瘦臉 faceSlim | 9× curveWarp | `SLIM` pairs (3,29→44; 7,25→45; 10,22→46; 14,18,16→49) | `0.1·v` (iOS demo max 0.1; desktop 0.05; Android 0.0625) |
| V臉 faceV | 6× curveWarp | jaw 8,10,12 and 24,22,20, each pulled toward its projection on the midline (line p43→p16) | `0.25·v` (tune) |
| 窄臉 faceNarrow | 4× curveWarp | 2,4 and 30,28 toward their midline projections | `0.15·v` (tune) |
| 下巴 chin (bi) | curveWarp | o = p16, t = p16 + (p16 − p49) | `0.1·s`; + makes the chin longer |
| 額頭 forehead (bi) | curveWarp | o = ext MP 10, t = ext MP 168 | `−0.1·s`; + makes the forehead taller |
| 瘦鼻 noseSlim | 4× curveWarp | (80→46), (81→46), (82→49), (83→49) | `0.3·v` (tune) |
| 嘴型 mouthSize (bi) | scaleAround | c = p106, R = 0.7·\|iso(p84) − iso(p90)\| | `0.3·s` |
| 眼距 eyeDistance (bi) | 2× shiftAround | c = p74 and p77; disp = ∓s·0.08·IOD·û, where û = unit(p77 − p74) | — |
| 大眼 eyeEnlarge | 2× enlargeEye | c = p74 and p77. GPUPixel uses R = 5·\|p74 − p72\|, which **pulses on blinks**. Port: R = κ·\|p52 − p55\| (eye width), with κ calibrated so the result equals 5·\|p74 − p72\| on the GPUPixel template. | `0.2·v` (iOS demo max 0.2; desktop 0.1; Android 0.25; code comment says [0, 0.15]) |

In the table, `v` is the one-way value in 0..1 and `s = (v − 0.5)·2` is the bidirectional value in −1..1.

**Yaw attenuation (port addition).** Compute `y = (|p74−p46| − |p77−p46|)/(|p74−p46| + |p77−p46|)` and multiply all deltas by `smoothstep(0.35, 0.15, |y|)` (thresholds to tune). The reason: MediaPipe's FACE_OVAL is made of 3D mesh vertices and does not follow the 2D silhouette at large yaw. Contour error was 0.23 IOD on a turned face.

### 2.5 Makeup (美妝), LUT filter (濾鏡) and rosy (紅潤)

**Makeup: FaceMakeupFilter (lipstick + blusher) to P1.** Sources: `face_makeup_filter.cc:14-93, 209-386`, `lipstick_filter.cc:30`, `blusher_filter.cc:30`.

GPUPixel behavior:
- Each filter does 2 draws: a full-screen copy, then a mesh with 111 vertices, 176 triangles and 528 `GL_UNSIGNED_INT` indices from a client pointer.
- `pos = landmark·2 − 1`.
- `uv = (template·1280 − bounds.xy)/bounds.wh`. Lipstick bounds are `{502.5, 710, 262.5, 167.5}` (mouth.png 105×67 scaled ×2.5). Blusher bounds are `{395, 520, 489, 209}` (1:1).
- Blend mode 15 is multiply at `intensity`. The PNGs are opaque with white meaning "no effect", so the result is `out = bg·(1 − i + i·tex)`.

Port design:
- **One mesh draw for both.** `out = base · mix(1, lipMul, iLip) · mix(1, blushMul, iBlush)`. Multiply commutes, so this equals the two sequential GPUPixel filters exactly.
- **VAO.** `aPos` is a dynamic VBO of 111 vec2, updated per frame with `bufferSubData`. `aUvLip` and `aUvBlush` are static. The IBO is a static Uint16 array of 528 indices copied from `GetFaceIndexs()`.
- **Base color.** `texelFetch(uBase, ivec2(gl_FragCoord.xy), 0)`. Use a blit for the full-screen copy.
- **Shade choice (new).** Convert the PNGs to single-channel masks at build time:
  - Lip: `(1 − min(G,B)) / (1 − 40/255)`. mouth.png's darkest pixel is (255,40,47).
  - Blush: `(1 − min(G,B)) / (1 − 221/255)`. blusher.png's darkest pixel is (255,221,221), so only about 34 grey levels exist and banding is possible. Mitigation: keep the original texture for the default shade.
  - Tint with `lipMul = mix(vec3(1), shade, mask)`.
  - Blend is a per-part uniform. Multiply is the default. Soft-light is optional; GPUPixel defines `blendSoftLight` but `blendFunc` never reaches it.
- **Limits.** The mesh covers brows, eyes, cheeks, nose, mouth and chin, but not the forehead. With our adapter, registration is off by about 0.1–0.2 IOD at the nose base and lips. Four template triangles have zero area ([72,104,74], [74,104,73], [75,77,105], [77,105,76]) and flip harmlessly. In v2, author makeup in MediaPipe's canonical UV space (`canonical_face_model.obj`, 468 v / 898 f).

**LUT filter (濾鏡): new, merged into P5.** GPUPixel has **no** LUT filter class.
- Reuse the GPUImage 64³ lookup math from `beauty_face_unit_filter.cc:136-157` (512×512, 8×8 tiles).
- `c = mix(c, lut(c), uFilterAmt)`.
- `lookup_custom.png` is unused by GPUPixel and is close to identity (mean absolute difference 5.9), so it is useful only as a format test.
- We author our own LUTs.
- Do **not** use PixelFree's: they are bundled with unclear provenance, and its 256×256 external format is not n³, so its layout is unknown.

**Rosy (紅潤): new, in P5 after whitening.** Soft-light toward a rosy tint (about `#FFB8C2`), weighted by `p·mask`, at opacity `≤ 0.35·v`. Tune on device. This is not GPUPixel code.

**Face mask: P0, new.** R8 at ¼ resolution. Draw a triangle fan over MediaPipe FACE_OVAL (36 points) with a feathered outer ring (vertex alpha from 1 to 0). Optionally punch eye and lip holes with alpha 0. Used to gate `p` and rosy. A "match GPUPixel exactly" toggle turns it off.

### 2.6 Resolution tiers and timing

- **Camera:** request `{facingMode:'user', width:{ideal:1920}, height:{ideal:1080}, frameRate:{ideal:30}}`.
- **Processing resolution by tier:**
  - H: full camera resolution (1080 short edge), full-resolution mean.
  - M: 720 short edge.
  - L: 540 short edge, half-resolution mean, detection on every second frame.
- **Auto-tiering:** use a moving-average frame time over the first 3 s, then step down when needed.
- **Capture:** always re-render the current frame and landmarks at full video resolution into an FBO.
- **Throughput** on any iPhone is UNVERIFIED. See §7 risk 1.

### 2.7 MediaPipe 478 to GPUPixel 111 landmark mapping

**Index order and naming [corrected].**
- The **normative order is GPUPixel's template** (`face_makeup_filter.cc` `FaceTextureCoordinates()` with the `GetFaceIndexs()` comments). Its "left" means **image-left**.
- It does **not** follow the JD-106 order in arXiv:1905.03469 Fig. 2. The verifier extracted the figure: in JD order, 43–46 are right-brow points, while in GPUPixel 43–46 are the nose bridge. The two orders agree only on the contour (0–32), the upper left brow (33–37), the mouth (84–103) and the pupils (104–105).
- It matches CainCamera's `FaceLandmark.java` (a Face++ mobile-SDK wrapper).
- A second verifier labelled it "SenseTime/JD", which conflicts with the figure check. External naming is therefore **UNRESOLVED**. Never map from an external figure.

**Mirroring.** Always detect on **unmirrored** frames. GPUPixel's "left" points then come from MediaPipe's `RIGHT_*` indices (verified by detection: x(33) < x(468) < x(133) < x(362)). MP calls this out (MPI 6368).

Notation: `mid(a,b)` is the average of MediaPipe points a and b. `pN` is an already-adapted GPUPixel point.

| GPUPixel idx | Meaning (image-left first) | MediaPipe source |
|---|---|---|
| 0–16 | contour, image-left temple (slightly above eye level: y .384 vs eye corner .404) to chin 16 | 17-point arc-length resample, **each frame**, of `[mid(162,127), 127, 234, 93, 132, 58, 172, 136, 150, 149, 176, 148, 152]`. **[corrected]** Starting at 127 put the upper contour about 0.15 IOD too low. |
| 16–32 | chin to image-right temple | resample `[152, 377, 400, 378, 379, 365, 397, 288, 361, 323, 454, 356, mid(356,389)]` |
| sanity only | thin-face origins 3, 7, 10, 14 / 18, 22, 25, 29 | nearest vertices ≈ 93, 58, 136, 176 / 400, 365, 288, 323. Do not hard-code the lerp fractions; they vary by face. |
| 33–37 | brow upper, image-left, outer to inner | 70, 63, 105, 66, 107 |
| 38–42 | brow upper, image-right, inner to outer | 336, 296, 334, 293, 300 |
| 43–46 | nose bridge, top to tip | 6, 195, 5, 1 (alternative: 4, the most forward point) |
| 47–51 | nose base, image-left to right (49 = subnasale) | 98, 97, 2, 326, 327 |
| 52–57 | image-left eye: 52 outer, 53–54 upper, 55 inner, 56–57 lower | 33, 160, 157, 133, 154, 144 |
| 58–63 | image-right eye: 58 inner, 59–60 upper, 61 outer, 62–63 lower | 362, 384, 387, 263, 373, 381 |
| 64–67 | brow lower, image-left | 46, 52, 65, 55 |
| 68–71 | brow lower, image-right | 285, 295, 282, 276 |
| 72 / 73 / 74 | image-left eye: upper-mid / lower-mid / center | 159 / 145 / mid(33,133). Not the iris; it is gaze-dependent. |
| 75 / 76 / 77 | image-right eye | 386 / 374 / mid(362,263) |
| 78 / 79 | nose-bridge sides at canthus height | 245 / 465 |
| 80 / 81 | nose wings | 48 / 278 |
| 82 / 83 | outer alar base | 64 / 294. Alternatives 129/358 or 203/423 may match better (UNVERIFIED). |
| 84, 90 | mouth corners | 61, 291 |
| 85–89 | upper lip top | **39**, 37, 0, 267, **269** **[corrected from 40/270]** |
| 91–95 | lower lip bottom, right to left | 321, 314, 17, 84, 91 |
| 96, 100 | inner lip corners | 78, 308 |
| 97–99 / 101–103 | upper inner / lower inner (right to left) | 81, 13, 311 / 402, 14, 178 |
| 104 / 105 | pupils (template coordinates equal 74/77) | 468 / 473 |
| 106 | mouth center = mid(p98, p102) | mid(13,14) |
| 107 / 108 | brow centers = mid(p35, p65) / mid(p40, p70) | mid(105,52) / mid(334,282) |
| 109 / 110 | cheek centers = mid(p5, p80) / mid(p27, p81) | compute from the **adapted** p5/p80 and p27/p81 (template rule). The researcher's mid(50,205) is about 0.02 IOD off. |

- The template-midpoint rules for 106–110 come from the verifier, who found them exact in the template. CainCamera's `LandmarkEngine.java` uses the same formulas. Whether mars_vision computes them the same way at runtime is UNVERIFIED.
- **Extension anchors (`uExt`, MediaPipe only)** for warps not covered by the 111 points: forehead top 10, 151; glabella ≈ 9 **[corrected: 168 is the nasion, not the glabella]**; nasion 168; menton 152; chin 175/199; jaw angle 172/397; cheekbone 234/454; cheek apple 50/280 and 205/425; philtrum 164→0.
- **Index usage:** reshape reads 3, 7, 10, 14, 16, 18, 22, 25, 29, 44, 45, 46, 49, 72, 74, 75, 77, plus our new anchors. Makeup reads all 111. Points 104–110 are used only by makeup.
- **Validation** (mediapipe 1.1.0 on MP `portrait.jpg` and GP `sample_face.png`):
  - All 30 left/right pairs are exact canonical mirror pairs.
  - Mean residual against the similarity-fitted template is 0.08–0.23 IOD, with a maximum of 0.34.
  - Frontal face: only the 4 zero-area triangles flip.
  - Turned face: 2 more flip, [33,52,64] and [5,109,4].
  - Validation script, from the researcher scratchpad: `.../scratchpad/fl/final_map.py`.

### 2.8 GPUPixel quirks not to copy

- RegisterProperty text says "−1 to 1", which is wrong.
- `SetWhite` divides by 10 only on macOS.
- 222 floats are uploaded into a 212-float uniform.
- The desktop-GL beauty shader has a stray `float;` token and gates with `> 0`.
- Demo ranges are inconsistent across platforms (whiten 0.5 vs 1.0).
- The unused `SetHighPassDelta` is never called.

---

## 3. Face tracking

| Item | Decision |
|---|---|
| Library | MediaPipe Tasks Vision **FaceLandmarker**. It is the only maintained candidate. Package, repo and Face Mesh V2 model card are all Apache-2.0. |
| Version | **Pin `0.10.35` exactly** (2026-04-27). No telemetry. FaceLandmarker `.d.ts` is identical to 1.1.0 (diffed). It has the `vision_wasm_module_internal.*` files and the `import()` fallback, which first appear in 0.10.35 and are needed for module workers in v2 **[corrected]**. The alternative, 1.1.0 (2026-10-06), POSTs telemetry with no opt-out and requires an in-app privacy notice and consent. A CSP `connect-src 'self'` should block it, and the logger stops on failure; Safari behavior is UNVERIFIED. |
| Model | `face_landmarker.task` float16/1, 3,758,596 B, md5 `sOcnSQehZEQE/vZrKN1thQ==`. Contains BlazeFace 192×192, Face Mesh V2 256×256 and blendshapes. Outputs 478 points (468 mesh + 10 iris). Self-hosted. |
| Options | `runningMode:'VIDEO'`, `numFaces:1` (turns on the built-in One-Euro filter: min_cutoff 0.05, beta 80, derivate_cutoff 1.0), `outputFaceBlendshapes:false`, `outputFacialTransformationMatrixes:false` (yaw uses the landmark proxy in §2.4), confidences at the 0.5 defaults, `delegate:'GPU'`. Also pass `canvas: new OffscreenCanvas(1,1)` explicitly, for two reasons. First, it lets us listen for `webglcontextlost`. Second, the Safari ≥ 17 UA check fails for CriOS/FxiOS/EdgiOS, and in a worker the fallback `document.createElement` throws **[corrected]**. |
| Threading v1 | Main thread, inside `requestVideoFrameCallback` (Safari 15.4+): upload the video texture, call `detectForVideo(video, ts)`, run the adapter, render. This pins detection and render to the same frame (LIKELY; Safari not advancing the frame between calls is UNVERIFIED). Guards: `readyState ≥ 2`, `videoWidth > 0`, strictly increasing timestamps (MPI 5152 "ROI width and height must be > 0"). |
| Threading v2 | Module Worker with OffscreenCanvas (Safari 17+, tasks-vision ≥ 0.10.35, `useModule=true`, SIMD required since there is no non-SIMD module build). Transfer a VideoFrame or ImageBitmap, or use MediaStreamTrackProcessor (Safari 18+), and render that exact frame. Not tested on a physical iPhone. |
| Photo mode | Use the same instance: `setOptions({runningMode:'IMAGE'})`, `detect(downscaledBitmap)`, then switch back to VIDEO. **Never** create and close an instance per photo, because WebKit leaks memory (MPI 5036, still open). Normalized coordinates apply directly to the full-resolution texture. |
| Expected FPS | **One published iPhone Safari data point [corrected: "none published" refuted]:** iPhone 16 Pro, iOS 18, tasks-vision 0.10.18, GPU, 640×480, 1 face, no blendshapes: about 9 ms per inference, 60 FPS (`github.com/svenflow/micro-facemesh` README; third party, not reproduced, and its "WebGPU" label is wrong because tasks use WebGL per MPI 5826). M4 Max **Chrome** with 1.0.1: GPU 5.0 ms / CPU 8.2 ms back-to-back, about 9.3–12 ms at camera cadence. The native iPhone 12 throttling (30 to 18 fps) was PoseLandmarker in a native app, not this stack **[corrected]**. **A13–A16 Safari numbers are UNVERIFIED.** Working budget: detection ≤ 15 ms + render ≤ 12 ms for 30 fps at tier M, to be measured in the week-0 spike. |
| Fallbacks | (1) GPU to CPU delegate if `createFromOptions` throws, or if a debug GPU-vs-CPU comparison diverges (precedent: MPI 6142, Segmenter GPU output wrong on iOS 18.7.1). (2) Detect on every second frame, holding the last landmarks. (3) No face: fade landmark effects out over about 150 ms while skin and LUT keep running. (4) Engine fails to load: "基本模式" with skin and filter only. (5) Context loss or return from background: recreate the single instance (MPI 4720 guidance; MPI 5122 concerned legacy holistic and was closed as stale **[corrected]**). Implemented in `src/tracking/tracker.ts`: the GPU graph's OffscreenCanvas context is watched (event plus an `isContextLost()` poll, since WebKit may not fire the event on OffscreenCanvas); a lost or repeatedly failing graph is replaced in place (backoff, never while hidden, 'auto' may fall back to CPU) and reported through `TrackerOptions.onStateChange`, which `src/ui/services.ts` mirrors into a camera badge. (6) Camera failure: route to photo import. |
| Rejected | `@tensorflow-models/face-landmarks-detection` 1.0.6 (stale since 2024), `@vladmandic/human` 3.3.6 (tfjs, Safari is secondary), `face-api.js` 0.22.2 (68 points, 2020). TF.js and human use the same 468/478 topology, so the adapter would carry over. micro-facemesh was not evaluated; its license and quality are UNVERIFIED. |

---

## 4. PWA / iOS / Vercel specifics

**Framework**
- Vite 8.x (8.3.3 latest), TypeScript, Preact for the UI.
- `vite-plugin-pwa` 2.0.0, which uses workbox-build ^7.4.1.
- The engine (`src/engine/{gl,passes,shaders,adapter111,landmarker}.ts`) has no framework dependency.
- A small param store; no router.
- Vercel Vite preset. No SPA rewrites are needed, because there is a single `index.html`.

**Static layout**
```
public/mediapipe/0.10.35/vision_wasm_internal.{js,wasm}      (SIMD only; add *_module_* in v2)
public/models/face_landmarker/float16-1/face_landmarker.task
public/luts/gp/lookup_{gray,origin,skin,light}.png            (GPUPixel, color chunks stripped)
public/luts/filters/<id>.png                                  (ours, 512×512 64³)
public/makeup/gp/{lip,blush}{,_mask}.png
```

**Camera handling**
- Show a start screen with a "點擊開啟相機" button before calling `getUserMedia`, on every cold launch.
- Use `<video autoplay muted playsinline>`. Keep it in the DOM at 1×1 or `opacity: 0` behind the canvas rather than `display: none`; whether a hidden video keeps updating is UNVERIFIED.
- Attach the stream once and keep it alive across editor and settings screens. The re-prompt fires after about 1 minute with no capture. Whether `track.enabled = false` counts as capturing is UNVERIFIED.
- Read actual frame dimensions from `video.videoWidth/Height`, not `getSettings()` (WK 323550). If the video is landscape while the UI is portrait, rotate in the shader (Apple forum 801146, UNVERIFIED symptom).
- **Recovery:** listen for `visibilitychange` and the track's `mute`, `unmute` and `ended` events. On return to the foreground, wait about 0.7–1 s. If the track is still muted or has ended, stop it and show "恢復相機" (needs a gesture), which calls `getUserMedia` again.
- On repeated black frames (WK 252465), show "在 Safari 開啟" with step-by-step instructions.
- Switching cameras means stopping the old track first.
- Use the Wake Lock API while the camera is active. It works in standalone mode on 18.4+ and is broken on 16.4–18.3.

**Capture and save**
- When the shutter is pressed:
  1. Render at full video resolution into FBO A.
  2. `readPixels`.
  3. Put into an `ImageData` on an `OffscreenCanvas`.
  4. `convertToBlob({type:'image/jpeg', quality:0.92})`.
  5. Wrap it in a `File` immediately, named e.g. `meiyan-YYYYMMDD-HHMMSS.jpg`.
- EXIF is stripped, which is good for privacy.
- In the Save tap handler, check `navigator.canShare({files})` and then call `navigator.share({files:[f]})` with no title or text, so "Save Image" shows. Treat `AbortError` as a cancel.
- Fallback: a full-screen `<img src=blobURL>` with "長按 → 儲存到照片". Never use `<a download>`.
- Mirroring: by default save what the user saw (mirrored), with a setting to change it. This is a design choice; the claim that Chinese apps do this is UNVERIFIED.
- v2: `ImageCapture.takePhoto()` (Safari 18.4+) for higher-resolution stills, followed by IMAGE-mode detection. Its resolution is UNVERIFIED.

**Photo import**
- `<input type=file accept="image/*">` with no `capture` attribute and no `image/heic`.
- Decode with `createImageBitmap(file, {imageOrientation:'from-image', resizeWidth/resizeHeight})`, with a long edge of 2048 on tier H and 1440 on tier L. Fall back to `img.decode()`.
- Call `bitmap.close()` and delete textures promptly.

**Model and asset caching**
- Self-host everything on the same origin under versioned paths.
- Precache the app shell and LUT/makeup PNGs.
- Engine binaries get a Workbox **runtime CacheFirst** route for `^/mediapipe/` and `^/models/`. The alternative is precaching with `maximumFileSizeToCacheInBytes` set to about 16 MiB.
- First camera start runs an "engine download" step that fetches with progress into Cache Storage. While no SW controls the page (first session before `clientsClaim`, Lockdown Mode, a SW that failed to install) the page writes the validated model, wasm and wasm loader into `meiyan-engine-v1` itself (`ENGINE_CACHE` in `src/engine/assets.ts`, the same name as the CacheFirst route) and prunes entries of older engine versions. Progress is approximate, because brotli responses may not carry a usable Content-Length.
- Pass the model as `modelAssetBuffer` from that fetch. The wasm is fetched by MediaPipe itself from `FilesetResolver.forVisionTasks('/mediapipe/0.10.35')` and served from the SW cache.
- Call `navigator.storage.persist()` when running standalone.
- Tell users that installing downloads the engine again, because storage is isolated.
- The app must still work with no SW (Lockdown Mode).

**Manifest and head**
- `manifest.webmanifest`: `name`, `short_name`, `id`, `start_url`, `scope`, `display:'standalone'`, `background_color`, `theme_color`, and icons at 192, 512 and 512 maskable.
- `<link rel="apple-touch-icon" sizes="180x180">` with matching art.
- `<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">`, laid out with `max(env(safe-area-inset-*), Npx)`.
- Status bar: test two variants on real devices, reinstalling between them.
  - (a) `black-translucent` plus a solid (no `backdrop-filter`) fixed top box at least 10 px tall and at least 90% wide.
  - (b) The default style with no meta tag. In this case `inset-top = 0` and the camera starts below the status bar.
- Lock to portrait in CSS. Implemented: a static `.rotate-hint` overlay (請將手機轉為直向使用) shows under `(orientation: landscape) and (max-height: 500px) and (pointer: coarse)`; `#app`, the stage and the canvas stay mounted. The manifest also declares `orientation:'portrait'` for platforms that honour it (iOS ignores it, §1 #11).

**Install hint**
- In a Safari tab (`!matchMedia('(display-mode: standalone)').matches && !navigator.standalone`), show a one-time generic hint: "分享 → 加入主畫面".
- Do not name button positions; they moved in iOS 26 and again in 27.

**`vercel.json` sketch** (verify the path-pattern syntax on deploy; the shipped `vercel.json` is authoritative). LUTs (`/luts/`) and makeup PNGs are unversioned, so they get no immutable rule and keep the default revalidation (spec §9):
```json
{ "headers": [
  { "source": "/assets/(.*)",    "headers": [{ "key": "Cache-Control", "value": "public, max-age=31536000, immutable" }] },
  { "source": "/mediapipe/(.*)", "headers": [{ "key": "Cache-Control", "value": "public, max-age=31536000, immutable" }] },
  { "source": "/models/(.*)",    "headers": [{ "key": "Cache-Control", "value": "public, max-age=31536000, immutable" }] },
  { "source": "/(.*)\\.wasm",    "headers": [{ "key": "Content-Type",  "value": "application/wasm" }] },
  { "source": "/sw.js",          "headers": [{ "key": "Cache-Control", "value": "public, max-age=0, must-revalidate" }] },
  { "source": "/(.*)", "headers": [
    { "key": "Content-Security-Policy", "value": "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'; img-src 'self' blob: data:; media-src 'self' blob: mediastream:; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; manifest-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'; object-src 'none'" },
    { "key": "Permissions-Policy", "value": "camera=(self)" },
    { "key": "X-Content-Type-Options", "value": "nosniff" },
    { "key": "Referrer-Policy", "value": "no-referrer" } ] } ] }
```
- **No COOP/COEP.**
- Whether Safari honors `'wasm-unsafe-eval'`, and whether the MediaPipe loader works under this CSP, is UNVERIFIED. If it breaks, drop `script-src` but keep `connect-src 'self'`.
- Vercel reportedly sets `application/wasm` automatically (2020 maintainer comment, not re-tested). The explicit header is a safeguard.

---

## 5. Parameter model

**Storage**
```ts
{ id, label, group, bidirectional, default /* 0..1 */, pf /* PixelFree enum ref */ }
```
- Neutral is 0 for one-way and 0.5 for bidirectional.
- Display: one-way shows `round(v·100)` (0–100). Bidirectional shows `round(v·100 − 50)` (−50…+50) with a center tick and fill growing from the center. This matches PF `PFSlider.m` type 101 and Android `CenterSeekBar.kt`.
- Shader value for bidirectional: `s = (v − 0.5)·2`.
- "Has value" (for the dot badge): `|v − 0.5| > 0.01` for bidirectional, `v > 0.01` for one-way (PF `PFBeautyView.m`).
- Persist to localStorage per viewer, as a convenience. BeautyCam also remembers the last settings (jianshu.com/p/703b155e338f, 2018).

**The default column is the first-launch value, which equals the 自然 preset.** All defaults need re-tuning on device, because PixelFree and FaceUnity numbers are calibrated for their own algorithms.

| id | 中文 | Group | UI range | Default | Bi? | Prio | Engine mapping | PF reference (pixelFree_c.hpp) / basis |
|---|---|---|---|---|---|---|---|---|
| skin.smooth | 磨皮 | 美膚 | 0–100 | 0.55 | no | P1 | blurAlpha = v | FaceBlurStrength(15). PF iOS demo 0.4, Android 0.7; FaceUnity 0.7 |
| skin.whiten | 美白 | 美膚 | 0–100 | 0.25 | no | P1 | whiten = 0.5·v, with chain fade-in | FaceM_newWhitenStrength(19), which the demo's 美白 uses (not 16). PF 0.6 / 0.2; FaceUnity 0.3 |
| skin.rosy | 紅潤 | 美膚 | 0–100 | 0.25 | no | P1 | new soft-light tint × p × mask | FaceRuddyStrength(17). PF 0.6; FaceUnity 0.3 |
| skin.sharpen | 銳化 | 美膚 | 0–100 | 0.20 | no | P1 | sharpen = 2·v (GPUPixel iOS demo range 0..2) | FaceSharpenStrength(18). PF 0.6 / 0.2 |
| shape.eyeEnlarge | 大眼 | 美型 | 0–100 | 0.20 | no | P1 | bigEyeDelta = 0.2·v | Face_EyeStrength(0). PF 0.2; FaceUnity 0.4 |
| shape.eyeDistance | 眼距 | 美型 | −50…+50 | 0.50 | yes | P2 | shiftAround (§2.4) | Face_eye_space(11), bidirectional |
| shape.faceSlim | 瘦臉 | 美型 | 0–100 | 0.15 | no | P1 | thinFaceDelta = 0.1·v | Face_thinning(1). PF 0.2 |
| shape.faceV | V臉 | 美型 | 0–100 | 0.10 | no | P1 | new jaw curveWarps | Face_V(4), labelled 瘦下颔 in PF demo. PF 0.2 |
| shape.faceNarrow | 窄臉 | 美型 | 0–100 | 0.00 | no | P2 | new cheekbone curveWarps | Face_narrow(2), labelled 瘦颧骨 in demo. PF 0.2 |
| shape.chin | 下巴 | 美型 | −50…+50 | 0.50 | yes | P1 | curveWarp, + = longer | Face_chin(3), 下巴长短, bidirectional |
| shape.forehead | 額頭 | 美型 | −50…+50 | 0.50 | yes | P2 | curveWarp on ext MP 10 → 168, + = taller | Face_forehead(7), bidirectional |
| shape.noseSlim | 瘦鼻 | 美型 | 0–100 | 0.10 | no | P1 | new nose-wing curveWarps | Face_nose(6), labelled 鼻翼 in demo. PF 0.2 |
| shape.mouthSize | 嘴型 | 美型 | −50…+50 | 0.50 | yes | P2 | scaleAround at p106 | Face_mouth(8), 嘴巴大小, bidirectional |
| filter.id | 濾鏡 | 濾鏡 | selector | `none` | — | P1 | 512×512 LUT bound in P5 | FilterName(22). Our own LUTs, e.g. 自然 / 柔光 / 奶茶 / 暖調 / 冷調 / 日系 / 膠片 / 黑白 |
| filter.amount | 濾鏡強度 | 濾鏡 | 0–100 | 0.50 (per-LUT override) | no | P1 | mix(c, lut(c), v) | FilterStrength(23). PF 0.5, Flutter 0.8; FaceUnity 0.4 |
| makeup.lip | 口紅 | 美妝 | 0–100 | 0.00 (0.5 when a shade is picked) | no | P1 | iLip = v (cap 0.8 if mouth.png reads too strong) | PFMakeupPart Lip(5). GPUPixel SetBlendLevel 0..1 |
| makeup.lipShade | 口紅色號 | 美妝 | swatch | none | — | P1 | tint × mask | own swatches: 珊瑚 #F06A5B, 豆沙 #C9767A, 玫瑰 #D8456B, 正紅 #D21F3C, 蜜橘 #F08A4B |
| makeup.blush | 腮紅 | 美妝 | 0–100 | 0.00 (0.4 when picked) | no | P1 | iBlush = v | PFMakeupPart Blusher(1) |
| makeup.blushShade | 腮紅色號 | 美妝 | swatch | none | — | P1 | tint × mask | own swatches: 蜜桃 #FF9E8A, 粉紅 #FF8FB1, 杏橘 #FFB07A, 玫瑰 #E77A93 |
| preset.id | 一鍵美顏 | presets | selector | 自然 | — | P1 | writes all values above | PF TypeOneKey(26) and `PFDateHandle setFaceType`. Ours are data, not an enum |
| preset.amount | 程度 | presets | 0–100 | 1.0 | no | P2 | scales each param's distance from neutral | BeautyCam "Fine-tune" pattern |

**Presets** (stored 0..1; "—" means neutral):

| Preset | smooth | whiten | rosy | sharpen | eye | slim | V | narrow | chin | forehead | noseSlim | mouth | filter | lip / blush |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 原圖 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — | — | 0 | — | none | 0 / 0 |
| 自然 (first launch) | .55 | .25 | .25 | .20 | .20 | .15 | .10 | 0 | — | — | .10 | — | none | 0 / 0 |
| 精緻 (≈ moderated FaceUnity recommended table) | .70 | .30 | .30 | .20 | .40 | .25 | .30 | .10 | .40 | .40 | .30 | .45 | 柔光 .4 | 0 / 0 |
| 氣色 | .55 | .25 | .45 | .20 | .20 | .15 | .10 | 0 | — | — | .10 | — | 暖調 .4 | .30 豆沙 / .30 蜜桃 |

- Editing any slider flips the preset to "自訂". This replaces PF's "一键美颜已关闭" toast.
- The bidirectional direction semantics in FaceUnity's table (e.g. chin 0.3) are UNVERIFIED.

**PixelFree parameters out of scope for v1** (enum numbers from `pixelFree_c.hpp` lines 223–356, the authoritative source, since `doc_iOS.md` numbering is stale):
- **Skin extras** (need ML or segmentation, or extra assets): FaceEyeBrighten(21) 亮眼, Nasolabial(29) 祛法令紋, BlackEye(30) 祛黑眼圈, WhitenTeeth(31) 白牙, FleckFlawClean(48) AI祛瑕疵, SkinDetail Texture / Clarity / Highlight / WaterGlow / Matte (49–53). Also FaceWhitenStrength(16), the legacy whitening; we expose one 美白. FaceH_qualityStrength(20) is deprecated.
- **Reshape, deferred:** Face_small(5) 小頭, Face_philtrum(9) 人中, Face_long_nose(10) 長鼻, Face_smile(12) 微笑, Face_eye_rotate(13) 眼傾斜, Face_canthus(14) 開眼角. For canthus the header and iOS demo say 0.5 bidirectional, while `doc_c.md` and Android say 0.0 one-way, a conflict. Also Face_eye_y(32), eye_height(33), nose_size / height / y / tip / bridge (34–38), brow thickness / length / lift / distance / tilt (39–43), upper / lower lip thickness (44/45), lip_fullness(46), mouth_width(47).
- **Other:** Lvmu(24) green screen, Sticker2DFilter(25), Watermark(27), Extend(28); 膚色 skin tone (PFSkinToneType 0–4 plus coldWarm); color grading and global HLS; 美體 body; 貼紙 stickers.
- **Makeup:** parts Brow, EyeShadow, EyeLiner, EyeLash, Highlight, Shadow, Foundation, Pupil; the 10 full-look bundles (大气 … 知性); the external 256×256 LUT API (iOS-only, never wired up in the demo).

---

## 6. UI direction options

**Shared layout grammar** (measured from App Store composites; JPEG error about ±4, flat fills about ±1 **[corrected]**; sizes assume a 393 pt device and scale ×1.094 if the mockup is 430 pt):

**Camera screen**
- Full-bleed viewfinder.
- Top bar over a dark scrim: close/menu, ratio chip (3:4 / 9:16 / 1:1), screen-flash, timer, and flip-camera at the far right.
- Bottom row: [gallery thumb] [一鍵] [shutter] [美顏] [濾鏡], with 拍照 / 錄影 tabs above it and a dot under the active tab.
- Swiping sideways on the preview changes the LUT and briefly shows its name (Ulike 2019, B612).

**Sizes**
- Shutter about 81 pt outer: white disc plus ring.
- Icons 25–27.5 pt.
- Icon labels about 12.5–13.5 pt font, and mode tabs about 16–17 pt **[corrected: the researcher's 11–12 / 15 pt were ink heights]**.

**Panel**
- Four tabs: 美膚 / 美型 / 濾鏡 / 美妝, with a 一鍵 entry before them.
- A horizontal list of items, each 44×74 pt with line icons. Item 1 is always ⊘ 原圖.
- Four item states, following PF's -0/-1/-2/-3 icon convention (draw our own SVG): {default, has-value} × {selected, unselected}. "Has value" shows a 4 px accent dot, as BeautyCam, 醒圖, 美圖秀秀 and Faceu do.
- Panel height 220–280 pt (PF uses 280 pt), so the face stays in the upper 60%.
- Tapping the preview hides the panel (0.35 s in PF).

**Slider**
- One slider at a time, floating over the photo above the panel, with a 56 pt side inset (PF).
- Value bubble while dragging; fades about 600 ms after release.
- A recommended-default dot on the track (BeautyCam).
- Bidirectional sliders snap to 0 within ±3 with a visual pulse. Double-tap resets.

**Compare and editor controls**
- A press-and-hold compare button (44×44 pt), with a "原圖" corner label while held. Press-and-hold is confirmed only for Facetune; for B612, 醒圖 and 美圖 it is inferred.
- The editor adds undo/redo to the left of the slider, an optional split line, pinch-zoom, and a bottom bar of ✕ / title / ✓.
- 重置 restores defaults (not "off") behind an inline confirm, because `confirm()` is blocked. BeautyCam's reset-all is LIKELY. For Ulike, the international listing shows Reset at the **bottom-right** with a confirm dialog reported **[corrected]**.

**Haptics and motion**
- Haptics only on shutter, tab and preset taps.
- Panel slides up over 220–280 ms with ease-out; shutter scales to 0.92 on press; selected item scales to 1.08. These are our design choices, not reverse-engineered from the apps **[corrected]**.

**Other**
- System fonts: `-apple-system, "PingFang TC", "Noto Sans TC", sans-serif`.
- Our own 1.5–2 px stroke icons.
- No VIP or crown badges.

### Option A: 粉霧 Pastel Bloom (light)

- **References:**
  - BeautyCam CN: accent ≈ `#FC6ACD`, shutter ring gradient `#F5B0C8`→`#FF9BE9`, tab pill `#F0F0F0`, icon stroke `#404040`.
  - 美圖秀秀: white panel, crimson `#EA1541`, near-black slider fill `#101018`.
  - Faceu: white panel, mint `#3AC9AB`.
- **Tokens:**
  - Panel `#FFFFFF`, surface-2 `#F4F4F6`.
  - Text `#1F1F24`, secondary text `#8E8E96`, icon `#45454D`.
  - Accent `#F25DB4`; gradient `#F4A6F2`→`#FFB49E` (shutter ring, selected pill).
  - Slider rest track `#E9E9EF`; change dot uses the accent; success `#3CC9A8`.
- **Traits:** a white rounded card (16 pt top radius); pill category tabs; underlined sub-tabs.
- **Fit:** a cute, approachable demo.
- **Cost:** the opaque panel covers more of the preview.

### Option B: 夜玻璃 Night Glass (dark translucent). Recommended for the camera.

- **References:**
  - B612/SNOW: panel `#000000`, teal `#0BD3D3`, inactive track `#606060`, VIP `#FFD500`; white pill with black text for the selected tab; left vertical rail.
  - BeautyCam global: frosted dark panel over the live image.
- **Tokens:**
  - Panel `rgba(14,14,18,0.62)` with `backdrop-filter: blur(28px) saturate(150%)`, falling back to solid `#000`.
  - Text `#FFFFFF`; secondary `rgba(255,255,255,.62)`; disabled `rgba(255,255,255,.35)`.
  - Slider active `#FFFFFF`; rest `rgba(255,255,255,.28)`.
  - Accent `#FF6FCF`, with teal `#2ED3C6` as an alternative theme. Keep accents distinct from brand hex values.
  - Top pills `rgba(0,0,0,.35)`.
- **Traits:** works under any lighting and skin tone; controls float; the preview stays visible.
- **Risk:** `backdrop-filter` over live WebGL costs GPU on older iPhones. Switch to the solid fallback automatically at tier L.

### Option C: 暗房 Darkroom Pro (opaque dark editor)

- **References:**
  - 醒圖: `#1C1C1A` panels, lime ≈ `#9ECB34`, selection drawn as a 1 px outline box, undo/redo plus compare around the slider.
  - Hypic: black, lime `#BCF125`–`#C9F653`, inactive `#8F8E94`, elevated `#202020`.
  - Light-pro variant, Facetune: sheet `#FFFFFF`, text `#3B4252`, cyan `#1BC0E8`.
- **Tokens:**
  - Background `#000000`, panel `#1C1C1E`, elevated `#262628`.
  - Text `#FFFFFF`, inactive `#8E8E93`, dim `#4A4A4C`.
  - Accent `#B8F02A`.
  - Selected item: 1 px accent outline with 8 px radius. Tab underline 3×20 px.
- **Traits:** a "pro retouch" feel suited to the import editor.

**Recommendation.** Use B for the camera, B's tokens without transparency (or C's structure) for the editor, and a single pink accent `#FF6FCF` for identity. Define all three themes as CSS custom properties.

**Screen inventory**
1. Start / permission screen, with install hint and engine download progress.
2. Camera.
3. Post-shot review: 儲存 / 重拍 / 編輯.
4. Editor, for imported or captured photos.
5. Settings sheet:
   - mirror-on-save
   - quality tier
   - "match GPUPixel" toggle
   - GPU/CPU delegate debug
   - landmark overlay
   - credits and licenses
   - privacy

**Ethics.** Keep modest defaults and an always-visible 原圖 toggle. Reviewers may read strong default slimming as dated (the 2021 "snake-face" trend).

---

## 7. Open risks and unknowns, ranked

| Rank | Risk | Likelihood / impact | Mitigation | How to retire |
|---|---|---|---|---|
| 1 | **Performance on iPhone Safari** of MediaPipe GPU detection, our 5-pass pipeline and `backdrop-filter`, using two WebGL2 contexts that compete for the GPU. Only one third-party data point exists (16 Pro). A13–A16 and long-session thermals are UNVERIFIED. | High / High | Tiers H/M/L, auto step-down, pass skipping, half-resolution mean, detection on alternate frames | Week-0 spike: benchmark harness on iPhone 11 / SE 2 (A13), A15 and A17/A18, on iOS 18, 26 and 27, logging detect ms, render ms and fps over 10 minutes |
| 2 | **Standalone camera reliability**: black stream (WK 252465), no permission persistence, a muted track that needs a gesture, rotation reports (forum 801146), dimension bugs (WK 323550) | High / High | Start gate, recovery button, Safari-tab fallback, rotation check, dimensions from the `video` element | Device matrix testing. This cannot be fully retired. |
| 3 | **Memory kills** on low-RAM devices (about 100 MB on SE 3). Whether WebGL allocations count toward the WebContent jetsam limit is UNVERIFIED. | Med / High | Downscale on decode (header-only size probe, one resized `createImageBitmap`; WebKit still decodes the full frame once internally), ping-pong FBOs, one landmarker instance, `close()` bitmaps | Import a 48 MP HEIC on an SE-class device |
| 4 | **Adapter fidelity**: contour error at yaw, makeup registration (0.1–0.2 IOD), jitter amplified by warp radii, possible triangle folds. The mars 111 semantics are inferred (±1 index ambiguity at 53/54/56/57, 64–67, 78–83). | Med / High | Per-frame resampling, template-rule extras, eye-width radius, yaw attenuation, landmark-overlay debug view | Recorded test clips (frontal, turned, smiling, blinking) with automatic triangle-flip detection |
| 5 | **GPU delegate correctness on iOS** (MPI 6142 precedent). Safari 27 fixed WebGL state reset on context loss; older versions may not recover cleanly. | Med / Med | CPU fallback, debug comparison, recreate on context loss | Diff GPU vs CPU landmarks on a real iPhone |
| 6 | **Look fidelity of the skin port**: red-only mask, sparse-kernel ringing (analytic), whitening's pink/blue cast, how Safari applies color management to LUT PNGs (UNVERIFIED), kernel scaling across resolutions | Med / Med | Face mask, fade-in fix, stripped PNGs and a self-test, resolution-normalized offsets, "match GPUPixel" toggle | Golden images from the GPUPixel desktop demo on macOS (remember macOS `SetWhite` /10) compared against port output |
| 7 | **New warps** (V, narrow, chin, forehead, nose, mouth, eye distance) are our own design, untuned, and could fold or swim | Med / Med | Mark P1 vs P2, cap \|d\| ≤ 0.5, monotonic primitives | Visual tuning pass; folding check on a grid texture |
| 8 | **iOS 26/27 layout**: WK 301108 and the contested Liquid Glass status-bar fixes; settings read at install | Med / Low–Med | Two variants tested with reinstalls | Devices, after each iOS update |
| 9 | **Save flow**: "Save Image" regressed once before (iOS 16), and the 5 s activation window | Low–Med / Med | Pre-encode before the tap; `<img>` fallback | Test on iOS 18, 26 and 27 |
| 10 | **Version and privacy**: 0.10.35 misses later fixes; 1.x adds telemetry with a consent duty | Low / Med | Pin 0.10.35 plus CSP; revisit at v2 | — |
| 11 | **Download and storage**: about 6–8 MB first run, downloaded again after install; Lockdown Mode disables the SW; Hobby has 100 MB upload and 100 GB/month | Low / Low | Ship one wasm variant, progress UI, `persist()` | — |
| 12 | **Licensing provenance**: GPUPixel headers dropped the GPUImage/GPUImage-x notices; CainCamera lineage; PNG assets assumed Apache-2.0 | Low / Low (portfolio) | Restore notices; credits page (§8) | — |
| 13 | **Install UX text going stale** as iOS moves Share again | Low / Low | Generic wording | — |

**Explicitly UNVERIFIED items to resolve:**
- A13–A16 Safari FPS for FaceLandmarker.
- Whether Safari honors `UNPACK_COLORSPACE_CONVERSION_WEBGL` and `colorSpaceConversion:'none'`.
- Whether `createImageBitmap` decodes HEIC.
- Whether CacheStorage is shared between Safari and the Home Screen app.
- `takePhoto` resolution.
- How ANGLE-on-Metal implements `mediump`.
- Whether `track.enabled=false` keeps the permission alive.
- CSP `'wasm-unsafe-eval'` support in Safari, and whether MediaPipe loads under that CSP.
- Whether the frame stays the same between texture upload and `detectForVideo` in one rVFC callback.
- The 醒圖 two-way reshape slider (centered thumb measured, two-way only inferred).
- The FaceUnity bidirectional direction semantics.
- Whether the GPUPixel PNG assets are Apache-2.0.

---

## 8. Licensing and attribution

| Component | How we use it | License | Obligations |
|---|---|---|---|
| GPUPixel shaders (ported) + `src/res/*.png` (lookup_gray / origin / skin / light, mouth, blusher) + our `lip_mask.png` / `blush_mask.png` (modified derivatives of mouth / blusher, generated by `scripts/gen-makeup.mjs`) | Derived code, bundled assets and modified derivative masks (Apache §4(b) change notice in `LICENSES/NOTICE.txt`) | Apache-2.0 (GP `LICENSE`) | Ship the license text (e.g. `LICENSES/GPUPixel-Apache-2.0.txt`). Keep each file's header "GPUPixel / Created by PixPark on 2021/6/24. / Copyright © 2021 PixPark. All rights reserved." Add a prominent change notice to every ported file (§4b), e.g. "Derived from GPUPixel src/filter/<file>.cc; modified: GLSL ES 3.00, passes merged, …". GP has no NOTICE file, so nothing to propagate. No use of the GPUPixel or PixPark names as marks (§6). Asset provenance is not stated separately, so Apache-2.0 for the PNGs is assumed (UNVERIFIED). |
| GPUImage (Brad Larson) | Box-blur offset generator. `box_mono_blur_filter.cc` is a near-verbatim port of `GPUImageBoxBlurFilter.m`. | BSD-3-Clause | Keep the copyright, conditions and disclaimer in the ported blur source and on the credits page. GPUPixel's header dropped this notice; restore it. |
| GPUImage-x (Copyright (C) 2017 Yijin Wang, Yiqian Wang) | Lineage of the `GaussianBlurMonoFilter` base | Apache-2.0 (LICENSE text; GitHub API reports NOASSERTION) | Keep the notice; credit it. |
| CainCamera | Ancestor of the beauty, reshape and makeup scheme (curveWarp/enlargeEye, 111-point extension). Whether GPUPixel copied it directly is UNVERIFIED. | **Apache-2.0, declared in its README** (Copyright 2018 cain.huang@outlook.com). There is no LICENSE file, which is why the GitHub API shows null **[corrected: not unlicensed]**. | Credit it on the credits page. |
| MediaPipe tasks-vision 0.10.35 + `face_landmarker.task` | Runtime, self-hosted | Apache-2.0 (package, repo, Face Mesh V2 model card) | Ship the license text and model card attribution. If we move to ≥ 1.0, add a privacy notice and consent for telemetry. |
| PixelFree | **Reference only**: parameter names and semantics, 0..1 and 0.5-neutral model, defaults, tab order, interaction patterns | **Conflicting**: MIT (`LICENSE`, pub.dev), Apache-2.0 (`pixbuffer.podspec`, CocoaPods trunk), "proprietary" (Flutter README). The runtime needs a `.lic`. Demo assets are self-declared as internet-sourced. | Reuse no code. If any demo code is ever copied verbatim, keep the MIT notice; the recommendation is to copy none. |
| Commercial apps (BeautyCam, 美圖秀秀, B612, SNOW, 醒圖, Hypic, Faceu, Facetune, Ulike) | Layout and interaction reference | Proprietary and trademarked | No icons, screenshots, app names, branded preset names (骨相, Elegance), VIP or crown motifs, or a brand gradient paired with a brand name. |
| Our LUTs, tints (shade colours), icons | Original | Our choice, e.g. MIT or CC0 | — |

**PixelFree do-not-reuse list.** The reason is unclear provenance plus contradictory licensing and license gating, not encryption **[corrected]**. The `sunmu`-header bundles are only partially obfuscated ZIPs: about 90 filter-like PNG names are readable from their plaintext central directory. They were deliberately not extracted.
- Any `.framework`, `.a` or `.aar` binary.
- Every `*.bundle`: filter_model, face_detect, skin_src, body_model, makeup/*, stickers. They include tflite face models of unknown origin.
- `pixelfreeAuth.lic`, committed in at least 14 places; `SMUpdateService/test_license.lic`.
- `SMUpdateService/keys/private_key.pem`, `public_key.pem`; `certs/key.pem`, `cert.pem`; `.env.production`; the `smbeauty-license-api` server code.
- The v-beauty four-state icon PNGs; filter, makeup and one-key thumbnails.
- Demo face photos. `face_kh.jpg` / `face2.png` show an identifiable real person.
- `qiniu_logo.png`; the pixelFree / 望图 branding.
- The remote effects API `https://pixelfreesdk.cn/effects-api/v1/effects`. Never call or proxy it.

**Credits page must list:**
- GPUPixel (Apache-2.0) and its PNG assets by name.
- GPUImage (BSD-3).
- GPUImage-x (Apache-2.0).
- CainCamera (Apache-2.0, lineage).
- MediaPipe and Face Mesh V2 (Apache-2.0).
- A note that the parameter design was informed by public SDK documentation (PixelFree, FaceUnity FULiveDemo docs, Alibaba Cloud Queen SDK), with no code or assets used.