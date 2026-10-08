# Browser body perception models for full-body retouching (美體) on iPhone Safari

Scope: on-device body keypoint and segmentation options for a static PWA with self-hosted model files (CSP `connect-src 'self'`), checked against the project's pinned `@mediapipe/tasks-vision` 0.10.35. Research date 2026-10-07.

How the numbers were obtained (applies throughout):
- **Exact byte sizes of MediaPipe models** come from HTTP HEAD requests (`content-length`, `last-modified`) against the official `storage.googleapis.com/mediapipe-models/...` URLs, run on 2026-10-07. They are what `curl -I` returned. They are not copied from docs.
- **API facts about 0.10.35** come from reading the installed package at `D:/GitSource/MonaLisa/node_modules/@mediapipe/tasks-vision/` (`vision.d.ts`, `vision_bundle.mjs`, `wasm/*.wasm`).
- **Performance numbers.** I found **no published benchmark of MediaPipe PoseLandmarker in iPhone Safari**. Every FPS figure below comes from a different device or runtime, or from a non-primary blog, and is flagged as such.

---

## 1. MediaPipe Tasks Vision PoseLandmarker: models, 33 landmarks, outputs, modes, iOS behaviour, and presence in 0.10.35

### Takeaway
PoseLandmarker is present and fully typed in the installed 0.10.35. It has `numPoses`, three confidence options, `outputSegmentationMasks`, world landmarks, IMAGE/VIDEO modes and the `POSE_CONNECTIONS` list. The three official `.task` bundles are 5.78 MB (lite), 9.40 MB (full) and 30.66 MB (heavy). All are float16, Apache-2.0, and unchanged since April 2023. The JS API exposes only `visibility` per landmark, not `presence`. The model is designed for full-body crops with the head visible. In front-camera selfies, legs that are out of frame still get "best guess" coordinates, so app code must gate every body feature on visibility plus an in-frame check.

### Cited Findings
**Presence and API in 0.10.35 (local package inspection)**
- `@mediapipe/tasks-vision` installed version is `0.10.35`, licence `Apache-2.0` — [package.json](file:///D:/GitSource/MonaLisa/node_modules/@mediapipe/tasks-vision/package.json)
- `vision.d.ts` declares `export declare class PoseLandmarker extends VisionTaskRunner` with `static POSE_CONNECTIONS: Connection[]`, `createFromOptions / createFromModelBuffer / createFromModelPath`, `setOptions`, `detect(image[, imageProcessingOptions][, callback])` and `detectForVideo(videoFrame, timestamp[, imageProcessingOptions][, callback])` — [vision.d.ts L2387+](file:///D:/GitSource/MonaLisa/node_modules/@mediapipe/tasks-vision/vision.d.ts)
- `PoseLandmarkerOptions` contains `numPoses`, `minPoseDetectionConfidence`, `minPosePresenceConfidence`, `minTrackingConfidence`, `outputSegmentationMasks` (d.ts lines 2568–2585). `PoseLandmarkerResult` has `landmarks: NormalizedLandmark[][]`, `worldLandmarks: Landmark[][]` and `segmentationMasks?: MPMask[]` (lines 2592–2623) — [vision.d.ts](file:///D:/GitSource/MonaLisa/node_modules/@mediapipe/tasks-vision/vision.d.ts)
- `NormalizedLandmark` and `Landmark` in 0.10.35 have only `x, y, z, visibility`. There is **no `presence` field** in the JS types (d.ts lines ~2014–2023, ~2298–2308). `Landmark` (world) is documented as "in meters" — [vision.d.ts](file:///D:/GitSource/MonaLisa/node_modules/@mediapipe/tasks-vision/vision.d.ts)
- A 2023 issue reported that tasks-vision 0.10.0 pose landmarks returned neither visibility nor presence. The 0.10.35 types now include `visibility` but still not `presence` — [GitHub #4479](https://github.com/google-ai-edge/mediapipe/issues/4479)
- The callback overloads limit mask lifetime: masks are "only guaranteed for the duration of the callback". The synchronous overload "creates a copy of the resulting masks and should not be used in high-throughput applications" — [vision.d.ts](file:///D:/GitSource/MonaLisa/node_modules/@mediapipe/tasks-vision/vision.d.ts)
- In the bundled JS, the PoseLandmarker graph is constructed with the region-of-interest flag set to false (`"image_in","norm_rect",!1`). Passing `imageProcessingOptions.regionOfInterest` therefore throws `"This task doesn't support region-of-interest."` Only rotation is honoured. In the 0.10.35 bundle, only ImageClassifier and ImageEmbedder have the flag `!0` — [vision_bundle.mjs](file:///D:/GitSource/MonaLisa/node_modules/@mediapipe/tasks-vision/vision_bundle.mjs)
- Defaults set in the bundle: `numPoses` 1, all three confidences 0.5, `outputSegmentationMasks` false — [vision_bundle.mjs](file:///D:/GitSource/MonaLisa/node_modules/@mediapipe/tasks-vision/vision_bundle.mjs); the same defaults are documented in [MediaPipe Pose Landmarker guide](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker)

**Model files (exact bytes, HEAD on 2026-10-07; all `float16/latest`)**
- `pose_landmarker_lite.task` = **5,777,746 B** (5.51 MiB), last-modified 2023-04-27 — [GCS](https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task)
- `pose_landmarker_full.task` = **9,398,198 B** (8.96 MiB), last-modified 2023-04-28 — [GCS](https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task)
- `pose_landmarker_heavy.task` = **30,664,242 B** (29.24 MiB), last-modified 2023-04-28 — [GCS](https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/latest/pose_landmarker_heavy.task)
- For comparison, the app's current `face_landmarker.task` (float16/1) = 3,758,596 B, which matches the self-hosted copy at `public/models/face_landmarker/float16-1/` — [GCS](https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task)
- Each bundle has a pose detector with 224×224×3 input and a pose landmarker with 256×256×3 input, float16 — [Pose Landmarker guide](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker)
- The model card states licence **Apache License 2.0** and model date April 16, 2021. It quotes raw TFLite sizes of Lite 3 MB / Full 6 MB / Heavy 26 MB; the `.task` bundles are larger because they also contain the detector — [BlazePose GHUM 3D model card (PDF)](https://storage.googleapis.com/mediapipe-assets/Model%20Card%20BlazePose%20GHUM%203D.pdf)

**33 landmarks**
- Index map: 0 nose; 1–3 left eye inner/center/outer; 4–6 right eye inner/center/outer; 7 left ear; 8 right ear; 9 mouth left; 10 mouth right; **11 left shoulder; 12 right shoulder; 13 left elbow; 14 right elbow; 15 left wrist; 16 right wrist**; 17/18 pinky; 19/20 index; 21/22 thumb; **23 left hip; 24 right hip; 25 left knee; 26 right knee; 27 left ankle; 28 right ankle; 29 left heel; 30 right heel; 31 left foot index; 32 right foot index**. Odd indices are the subject's left — [Pose Landmarker guide](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker)
- Raw model output is 33×5 (x, y, z, visibility, presence). "Visibility … denotes the probability that a keypoint is located within the frame and not occluded". "Presence … denotes the probability that a keypoint is located within the frame". Z is relative to the hip plane, "not metric but up to scale", and derived from synthetic GHUM fits — [model card](https://storage.googleapis.com/mediapipe-assets/Model%20Card%20BlazePose%20GHUM%203D.pdf)
- For points that are present but hard to annotate, training labels used a "best guess" and default pose. The model "degrades gracefully by predicting average point location" — [model card](https://storage.googleapis.com/mediapipe-assets/Model%20Card%20BlazePose%20GHUM%203D.pdf)

**Pipeline, input assumptions and accuracy**
- Two-stage pipeline (detector, then tracker). In video, "the detector is invoked only as needed, i.e., for the very first frame and when the tracker could no longer identify body pose presence in the previous frame"; on other frames the ROI is derived from the previous frame's landmarks — [legacy MediaPipe Pose docs](https://github.com/google-ai-edge/mediapipe/blob/master/docs/solutions/pose.md)
- Expected landmark input is a 256×256 crop "with aligned human full body", centred on mid-hip, plus a 25% margin around the square circumscribing the full body. Tolerance is about 10% shift/scale and 8° roll — [model card](https://storage.googleapis.com/mediapipe-assets/Model%20Card%20BlazePose%20GHUM%203D.pdf)
- Listed out of scope: multiple people, subjects more than ~4 m away, "**Head is not visible**", and metric depth. The model is "sensitive to face position, scale and orientation" and tracks only one person — [model card](https://storage.googleapis.com/mediapipe-assets/Model%20Card%20BlazePose%20GHUM%203D.pdf)
- Accuracy is PDJ/PCK@0.2 of torso diameter on 1,400 back-camera smartphone photos: **Lite 87.0%, Full 91.8%, Heavy 94.2%** average. Eastern Asia scores Lite 83.2 / Full 90.4 / Heavy 92.6. Inter-annotator agreement is 97.5% — [model card](https://storage.googleapis.com/mediapipe-assets/Model%20Card%20BlazePose%20GHUM%203D.pdf)
- The training/eval data are mostly back-camera fitness and AR images: 85K fitness poses and 30K AR-app images. There is no selfie or front-camera evaluation — [model card](https://storage.googleapis.com/mediapipe-assets/Model%20Card%20BlazePose%20GHUM%203D.pdf)
- The pose segmentation mask "has the same width and height as the input image, and contains values in [0.0, 1.0]" (legacy solution docs; I assume the Tasks graph behaves the same) — [legacy Pose docs](https://github.com/google-ai-edge/mediapipe/blob/master/docs/solutions/pose.md)

**Performance (none of it measured in iPhone Safari; all flagged)**
- Model card (2021, Pixel 3, native TFLite): Lite ~44 FPS CPU / ~49 FPS GPU; Full ~18 / ~40; Heavy ~4 / ~19 — [model card](https://storage.googleapis.com/mediapipe-assets/Model%20Card%20BlazePose%20GHUM%203D.pdf)
- TF blog (May 2021) BlazePose FPS lite/full/heavy: Pixel 5 MediaPipe runtime 32/22/N/A, TF.js 13/11/5; **iPhone 11 TF.js 34/30/N/A**, with the MediaPipe runtime "N/A" on iPhone at that time. This is **old (2021)** and predates tasks-vision — [TF blog](https://blog.tensorflow.org/2021/05/high-fidelity-pose-tracking-with-mediapipe-blazepose-and-tfjs.html)
- A non-primary 2026 vendor guide says MediaPipe Pose reaches about 11–12 FPS in an Android (Pixel 5) browser. It also says iPhone browsers are "comfortable", without numbers. **Unverified** — [PoseTracker guide](https://www.posetracker.com/news/best-pose-estimation-model-in-2026-the-real-time-mobile-guide)
- A blog on **native** iOS (Swift, not web) reports lite ~30 FPS and full 20–25 FPS on iPhone 12 with the CPU delegate. It also reports that the GPU delegate thermally throttled from 30 to 18 FPS after ~8 minutes, while CPU stayed at ~28 FPS. **Unverified single source, native rather than web** — [diyoraharshit blog](https://www.diyoraharshit.com/blog/mediapipe-ios-swift)
- A 2025–26 open-source phone-browser game runs lite with GPU→CPU fallback, `runningMode:'VIDEO'`, `numPoses:1`, paced at a fixed 20 Hz — [sorchosky/airplane-game PR #45](https://github.com/sorchosky/airplane-game/pull/45)

**Known GPU/WebGL issues relevant to iOS**
- With `outputSegmentationMasks: true` on the GPU delegate, `getAsFloat32Array()` returned all zeros while landmarks were correct; the CPU delegate worked. This was Chrome with 0.10.4, now closed — [GitHub #4757](https://github.com/google-ai-edge/mediapipe/issues/4757)
- PoseLandmarker in iOS WKWebView failed to create a WebGL2 context ("emscripten_webgl_create_context() returned error 0"), even with `delegate:"CPU"` (0.10.0) — [GitHub #4499](https://github.com/google-ai-edge/mediapipe/issues/4499)
- On GPU-less environments, PoseLandmarker throws `"kGpuService" … was not provided` for both CPU and GPU delegates, because image preprocessing still needs WebGL — [GitHub #5970](https://github.com/google-ai-edge/mediapipe/issues/5970)
- On macOS, users reported identical CPU and GPU FPS for pose (~27 FPS, M1 Pro, 0.10.21). This was not on the web — [GitHub #6041](https://github.com/google-ai-edge/mediapipe/issues/6041)

### Inferences
- The project's existing tracker pattern (`src/tracking/tracker.ts`) carries over to PoseLandmarker unchanged: `modelAssetBuffer`, `runningMode:'VIDEO'`, GPU→CPU fallback, an explicit canvas, and `isContextLost` polling.
- **Selfie reality check.** Arm's-length front-camera selfies usually show head to waist. Hips (23/24) are often at or below the bottom edge, and knees, ankles and heels are out of frame. Because the model still returns coordinates for those points, a body feature must be enabled only when `visibility > ~0.5` **and** `0 ≤ x,y ≤ 1` (with a small margin) for every landmark it depends on. Since `presence` is not exposed, the in-frame check stands in for it. The model card's "best guess / average location" behaviour is the reason.
- **Model choice.** Live preview: lite (5.78 MB). Photo editor, one-shot IMAGE mode: full (9.40 MB) is the best accuracy-to-size trade-off; heavy at 30.66 MB is a large download and memory cost for a 2.4-point PDJ gain. For photos, rerunning pose on a horizontally flipped copy and averaging is a cheap accuracy boost. This is a standard TTA idea and has not been tested on this model.
- **ROI is not supported.** To crop a region manually, draw the crop into a canvas or `ImageBitmap`, run detection on it, and map landmarks back yourself.
- **Mask memory.** Pose masks are the size of the input image. A float mask is 8.3 MB at 1920×1080 and ~48.8 MB at 4032×3024 (arithmetic: W×H×4 B). Downscale photos (long edge ≈ 1280–1536) before `detect()`, and use the callback overload to avoid copies.

### Gaps
- I found no measured per-frame latency or FPS for tasks-vision PoseLandmarker (any model) in iOS 18/26 Safari or a Home Screen web app. It must be benchmarked on target devices, for example the oldest supported iPhone plus a current one.
- It is not confirmed whether the GPU-mask-zeros bug (#4757) still exists in 0.10.35 on iOS. Using `getAsWebGLTexture()` on the same canvas, or the CPU delegate, is the safe path.
- I found no official accuracy data for front-camera, upper-body-only, close-range selfies; the model card's evaluation set is back-camera photos.
- The 2021 model card's quoted raw sizes (3/6/26 MB) do not match today's `.task` bytes. That is consistent with the bundles also containing the detector, but the bundle contents were not unpacked to confirm.

---

## 2. MediaPipe ImageSegmenter models: sizes, classes, speed, quality, and usefulness for background protection and body contours

### Takeaway
`selfie_segmenter` (249,537 B, 256×256) is the cheap person/background mask. `selfie_multiclass_256x256` (16,371,837 B, a ViT with 6 classes: background, hair, body-skin, face-skin, clothes, others) is the only one that separates skin from clothes. Hair segmenter and DeepLab-v3 add little for body retouch. All are Apache-2.0 and from 2021–2023. On iOS Safari, run segmentation on the **CPU delegate**, because the GPU delegate scrambles multiclass categories (open bug #6142). Request a category mask, not six float confidence masks, to save memory.

### Cited Findings
**Exact sizes (HEAD on 2026-10-07)**
- `selfie_segmenter.tflite` (float16, square 256×256) = **249,537 B**, last-modified 2023-05-07 — [GCS](https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite)
- `selfie_segmenter_landscape.tflite` (float16, 144×256) = **250,177 B**, 2023-05-07 — [GCS](https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter_landscape/float16/latest/selfie_segmenter_landscape.tflite)
- `selfie_multiclass_256x256.tflite` (float32) = **16,371,837 B**, 2023-04-26 — [GCS](https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite)
- `hair_segmenter.tflite` (float32, 512×512) = **781,618 B**, 2023-04-26 — [GCS](https://storage.googleapis.com/mediapipe-models/image_segmenter/hair_segmenter/float32/latest/hair_segmenter.tflite)
- `deeplab_v3.tflite` (float32, 257×257) = **2,780,176 B**, 2023-04-26 — [GCS](https://storage.googleapis.com/mediapipe-models/image_segmenter/deeplab_v3/float32/latest/deeplab_v3.tflite)
- (InteractiveSegmenter) `magic_touch.tflite` = 6,227,884 B — [GCS](https://storage.googleapis.com/mediapipe-models/interactive_segmenter/magic_touch/float32/latest/magic_touch.tflite)

**Model cards**
- Selfie segmentation: MobileNetV3-like CNN; general input 256×256×3, landscape 144×256×3; output a 1-channel person probability in [0,1]; **Apache 2.0**; dated May 6, 2021. It "may segment multiple humans … if they are of similar size", and thin features such as fingers "might occasionally be missed" — [Selfie Segmentation model card (PDF)](https://storage.googleapis.com/mediapipe-assets/Model%20Card%20MediaPipe%20Selfie%20Segmentation.pdf)
- Multiclass selfie: **Vision Transformer** with a customized bottleneck/decoder; 256×256 (the shipped one) and a 512×512 variant (not on the public model list). Classes are background, hair, body-skin, face-skin, clothes, others (accessories). It handles "selfies and full body images" and single or multiple people, and accepts any aspect ratio. **Apache 2.0**, dated May 10, 2023. Mean IoU is **77.23** for the 256 model and 81.10 for the 512 model, with darkest skin tones (Monk 9–10) lowest at 68.25 and 71.86 — [Multiclass Segmentation model card (PDF)](https://storage.googleapis.com/mediapipe-assets/Model%20Card%20Multiclass%20Segmentation.pdf)
- Model list and inputs: selfie square 256×256, landscape 144×256, hair 512×512, multiclass 256×256 with six categories, DeepLab-v3 257×257. Outputs are a uint8 category mask and/or float32 confidence masks. Published Pixel 6 latency ranges ~33–218 ms CPU and ~33–103 ms GPU across models; this is **Android, not iOS web** — [Image Segmenter guide](https://developers.google.com/edge/mediapipe/solutions/vision/image_segmenter)

**API defaults in 0.10.35 (local bundle)**
- The ImageSegmenter constructor sets `outputCategoryMask = false` and `outputConfidenceMasks = true` by default. `getLabels()` is available, and like PoseLandmarker the segmenter does not support `regionOfInterest` — [vision_bundle.mjs](file:///D:/GitSource/MonaLisa/node_modules/@mediapipe/tasks-vision/vision_bundle.mjs), [vision.d.ts L1563–1745](file:///D:/GitSource/MonaLisa/node_modules/@mediapipe/tasks-vision/vision.d.ts)

**iOS/WebGL issues**
- **iOS Safari + GPU delegate + selfie_multiclass_256x256 gives scrambled categories.** For example, category 1 returns neck/body instead of hair. Reported on iPhone 12 Pro, iOS 18.7.1, tasks-vision 0.10.22-rc.20250304. CPU on iOS and GPU on desktop are correct. Opened 2025-11-09, still open with no maintainer fix when fetched — [GitHub #6142](https://github.com/google-ai-edge/mediapipe/issues/6142)
- In 0.10.35, ImageSegmenter **aborts** (RET_CHECK) when the browser lacks float/half-float render-target extensions (`EXT_color_buffer_float`, `EXT_color_buffer_half_float`, `OES_texture_float(_linear)`). The CPU delegate is also affected because mask postprocessing still goes through GL. Reported on an old Android Mali device — [GitHub #6296](https://github.com/google-ai-edge/mediapipe/issues/6296)

### Inferences
- **Background protection.** The selfie_segmenter mask (0.25 MB model) is enough to limit warps to the person and a narrow halo. Leave strong background structure (door frames, tiles) un-warped, or blend the warped image back toward the original outside the person by the soft mask. Slimming still pulls in background pixels next to the body, so straight lines adjacent to the waist bend. Use the mask to measure local background "line-ness" and cut strength there. This is a design idea, not sourced.
- **Contours.** The person mask gives the silhouette. Scanlines perpendicular to the torso axis give left/right edges, and therefore waist and hip widths. The multiclass mask adds two things the binary mask cannot: separating **body-skin** from **clothes** (detect loose clothing, where a waist warp looks wrong), and separating **hair** from shoulders (long hair over the shoulders breaks the 直角肩 contour). Its cost is 16.4 MB and ViT compute, so the inference is: use it only in photo mode.
- **Memory.** Six confidence masks at 1080×1920 float32 are about 50 MB. Set `outputCategoryMask: true, outputConfidenceMasks: false` (multiclass), or one confidence mask (selfie), and run on a downscaled image.
- On iOS, force `delegate:'CPU'` for ImageSegmenter, at least for multiclass. Optionally add a startup self-test: run a known image and check that the label order from `getLabels()` matches the pixels.
- PoseLandmarker's own `outputSegmentationMasks` gives a person mask for free with the pose. That mask is ROI-based around the tracked person, so it naturally ignores bystanders. It could replace a separate selfie_segmenter in live mode, provided GPU masks are not blank (#4757) on iOS.

### Gaps
- I found no published iOS Safari timings for any of these segmenters.
- Mask resolution returned by the Tasks ImageSegmenter: the legacy Pose docs say "same as input". For ImageSegmenter I did not confirm whether masks are always resized to the input or returned at model resolution in 0.10.35. Check `MPMask.width/height` at runtime.
- I found no quantitative boundary-accuracy (edge F-score) data, which matters more than IoU for waist-width measurement.

---

## 3. Alternatives: TF.js MoveNet, BlazePose via TF.js, BodyPix, ONNX Runtime Web (RTMPose, DWPose, Sapiens, SAM-family)

### Takeaway
None of the alternatives beats PoseLandmarker for this app. MoveNet (17 COCO keypoints, no heels or feet, no mask) has the only published iPhone browser FPS (iPhone 12 WebGL: Lightning 51, Thunder 43, from 2021). Its tfjs-models package has been stale since 2023, and it would add a second ML runtime. RTMPose-t/s via ONNX Runtime Web is the best modern, Apache-2.0 option. ORT's WebGPU path exists only on iOS 26+ and has open Safari crash and memory bugs, and its wasm binaries are 14–28 MB on top of MediaPipe's 11 MB. DWPose is 134 MB. Sapiens v1 is CC BY-NC (non-commercial). Both are unusable here.

### Cited Findings
**MoveNet (TF.js)**
- 17 keypoints. Benchmark FPS for WebGL Lightning / Thunder / MultiPose: **iPhone 12: 51 / 43 / 24**; Pixel 5: 34 / 12 / 8; MacBook Pro 2019: 104 / 77 / 54 (no iPhone WASM number). `modelUrl` lets you self-host. `enableSmoothing` defaults to true — [tfjs-models MoveNet README](https://github.com/tensorflow/tfjs-models/blob/master/pose-detection/src/movenet/README.md)
- TFLite sizes and accuracy (Aug 2021): Thunder FP16 12.6 MB (mAP 72.0), Thunder INT8 7.1 MB (68.9), Lightning FP16 4.8 MB (63.0), Lightning INT8 2.9 MB (57.4). Inputs are 192×192 (Lightning) and 256×256 (Thunder) — [TF blog Aug 2021](https://blog.tensorflow.org/2021/08/pose-estimation-and-classification-on-edge-devices-with-MoveNet-and-TensorFlow-Lite.html)
- Community ONNX conversions measured by HEAD: Lightning `model.onnx` = **9,413,268 B**, Thunder `model.onnx` = **25,067,197 B** — [Xenova/movenet-singlepose-lightning](https://huggingface.co/Xenova/movenet-singlepose-lightning), Xenova/movenet-singlepose-thunder (same HF org)
- The MoveNet model card targets fitness, and says Lightning runs ">50FPS on most modern laptops" and Thunder runs ">30FPS". No licence line was found in the PDF text — [MoveNet.SinglePose model card (PDF)](https://storage.googleapis.com/movenet/MoveNet.SinglePose%20Model%20Card.pdf)
- `@tensorflow-models/pose-detection` latest is 2.1.3, Apache-2.0, last modified 2023-10-17. `@tensorflow/tfjs` latest is 4.22.0, and `tfjs-backend-wasm` 4.22.0 unpacks to 13.2 MB (npm registry, queried 2026-10-07). The repo licence is Apache-2.0 — [tensorflow/tfjs-models](https://github.com/tensorflow/tfjs-models)

**BlazePose via TF.js runtime**
- These are the same BlazePose GHUM models with a TF.js WebGL runtime. Model sizes were Lite 10.4 MB, Full 13.8 MB, Heavy 34.7 MB (TF.js) versus 10.6/14/34.9 MB (MediaPipe runtime), with iPhone 11 TF.js at 34/30 FPS (lite/full). **2021 data** — [TF blog May 2021](https://blog.tensorflow.org/2021/05/high-fidelity-pose-tracking-with-mediapipe-blazepose-and-tfjs.html)

**BodyPix**
- BodyPix is the legacy TF.js person/part segmentation model, superseded by the pose-detection and body-segmentation packages. I did not research it further, because it is deprecated and was not improved after 2020–2021. Treat this as **not re-verified this session**.

**ONNX Runtime Web**
- `onnxruntime-web` latest is **1.30.0**, licence **MIT**, unpacked package 144.6 MB. Its wasm binaries measured from the 1.30.0 tarball: `ort-wasm-simd-threaded.wasm` **14,239,897 B** (CPU), `ort-wasm-simd-threaded.jsep.wasm` **28,312,028 B** (WebGPU/JSEP), `.asyncify.wasm` 26,781,914 B, `.jspi.wasm` 16,758,545 B — [npm onnxruntime-web](https://www.npmjs.com/package/onnxruntime-web); repo licence MIT ([microsoft/onnxruntime](https://github.com/microsoft/onnxruntime))
- **WebGPU ships on by default in Safari 26.0** (Sep 2025) on macOS, iOS, iPadOS and visionOS. WebKit lists ONNX Runtime and Transformers.js as working — [WebKit: Safari 26.0 features](https://webkit.org/blog/17333/webkit-features-in-safari-26-0/). iOS 18 Safari has no WebGPU by default, so iOS 18 users would get WASM only (inferred from the same announcement framing WebGPU as new in 26).
- Open bug: crash after ~500 WebGPU inferences of yolo26n on iOS 26.3 Safari, ORT 1.24.3 — [onnxruntime #27584](https://github.com/microsoft/onnxruntime/issues/27584)
- Open bug: in Safari/WebKit 26 with JSEP, CPU stays at 400%+ and memory at 1 GB+ after inference (WebGPU and WASM both), leading to iOS process crashes — [onnxruntime #26827](https://github.com/microsoft/onnxruntime/issues/26827)
- The npm README compatibility table still marks WebGPU on Safari as unsupported, which is out of date relative to Safari 26 — [npm onnxruntime-web](https://www.npmjs.com/package/onnxruntime-web)
- A 2026 paper states that iOS Safari tab memory is limited to under 500 MB. This is a single secondary claim and was not checked against WebKit sources — [arXiv 2605.20706](https://arxiv.org/html/2605.20706v1)

**RTMPose / RTMDet (MMPose, Apache-2.0)**
- Official ONNX SDK zips measured by HEAD: `rtmpose-t … body7 … 256x192` = **12,547,710 B**; `rtmpose-s` = **20,496,303 B**; `rtmpose-m` = **50,799,818 B**; person detector `rtmdet_nano` = **3,792,520 B** — [download.openmmlab.com (rtmpose-t zip)](https://download.openmmlab.com/mmpose/v1/projects/rtmposev1/onnx_sdk/rtmpose-t_simcc-body7_pt-body7_420e-256x192-026a1439_20230504.zip). These are 2023 releases.
- Halpe26 table: RTMPose-t 3.51M params / 0.37 GFLOPs; RTMPose-m 13.93M params / 1.95 GFLOPs, AUC 71.91 — [mmpose rtmpose_body8-halpe26.md](https://github.com/open-mmlab/mmpose/blob/main/configs/body_2d_keypoint/rtmpose/body8/rtmpose_body8-halpe26.md). Paper: RTMPose-t 68.4 AP, RTMPose-m 77.3 AP (GT boxes) — [RTMPose paper](https://arxiv.org/html/2303.07399v2)
- A browser deployment exists. Harvard's EZ-MMLA tool runs RTMPose-s with RTMDet-nano on ORT Web WASM, downloading ~22 MB + ~3 MB — [EZ-MMLA RTMPose](https://mmla.gse.harvard.edu/tools/rtmpose/)
- MMPose repo licence is **Apache-2.0** (GitHub API) — [open-mmlab/mmpose](https://github.com/open-mmlab/mmpose)

**DWPose**
- `dw-ll_ucoco_384.onnx` = **134,399,116 B**; its detector `yolox_l.onnx` = **216,746,733 B** (HEAD) — [yzd-v/DWPose on HF](https://huggingface.co/yzd-v/DWPose). The repo licence is Apache-2.0 — [IDEA-Research/DWPose](https://github.com/IDEA-Research/DWPose)

**Sapiens / Sapiens2 (Meta)**
- Sapiens v1 weights are **CC BY-NC 4.0** (non-commercial), including the Lite/TorchScript variants — [facebook/sapiens HF](https://huggingface.co/facebook/sapiens). The GitHub repo licence reports as "NOASSERTION" (custom) via the GitHub API — [facebookresearch/sapiens](https://github.com/facebookresearch/sapiens)
- Sapiens2 (April 2026) uses a custom "Sapiens2 License" with a prohibited-use list. Models are 0.4B parameters and up (e.g. `sapiens2-pose-0.8b`, `sapiens2-seg-1b`) — [sapiens2 LICENSE.md](https://github.com/facebookresearch/sapiens2/blob/main/LICENSE.md), [facebook/sapiens2-seg-1b](https://huggingface.co/facebook/sapiens2-seg-1b)

**SAM-family**
- MobileSAM repo licence is Apache-2.0 (GitHub API) — [ChaoningZhang/MobileSAM](https://github.com/ChaoningZhang/MobileSAM). I did not measure ONNX encoder sizes or iOS speeds this session.

### Inferences
- **Recommendation: stay on MediaPipe.** It is already loaded (11.15 MB wasm, CSP and self-hosting already solved), has the richest landmark set (heels, foot index, hands, face points), includes an optional person mask, and is Apache-2.0. MoveNet lacks heels and feet and has no mask. RTMPose's 17/26 keypoints add nothing for retouching that BlazePose's 33 lack.
- Adding ORT Web costs at least 14.2 MB (WASM) or 28.3 MB (WebGPU) of wasm, plus its own heap, plus open Safari 26 memory bugs. That is hard to fit beside MediaPipe within a 100–200 MB page budget. Consider it only for a later photo-only "HQ" model, and only if MediaPipe accuracy proves insufficient.
- Sapiens and DWPose are excluded on licence (Sapiens v1) and size (DWPose, Sapiens2).

### Gaps
- I found no 2024–2026 iPhone Safari benchmarks for MoveNet, RTMPose or any ORT Web pose model; the iPhone 12 MoveNet FPS is from 2021.
- MoveNet weights licence: the model card PDF text has no licence line. The tfjs-models code is Apache-2.0, and the TF Hub/Kaggle listing licence was not fetched.
- MobileSAM, EfficientSAM and SAM-2-tiny ONNX sizes and Safari behaviour were not researched in depth. SAM-class encoders typically need tens of MB and seconds per image (unverified).

---

## 4. Can FaceLandmarker + PoseLandmarker (+ segmenter) share one wasm runtime and run together on an iPhone within budget?

### Takeaway
They share the wasm **files** (one self-hosted `vision_wasm_internal.{js,wasm}`, one `FilesetResolver` result), but **not the runtime**. In 0.10.35, every `createFromOptions` loads the loader script and calls `ModuleFactory()` again. That gives each task its own Emscripten module, its own wasm heap (initial 18.1 MB, growable to 2 GB) and its own WebGL context (an `OffscreenCanvas(1,1)` unless you pass `canvas`). Running face + pose live every frame doubles the inference load. The budget-safe plan is:
- **Photo-only body mode first** (IMAGE mode, full model, run once per photo).
- In live mode, run pose lite every 2–3 frames with smoothing and interpolation.
- Create the pose task lazily, `close()` it when leaving body mode, and keep segmentation out of the live path.

### Cited Findings
- In the 0.10.35 bundle, task creation (`cc(TaskClass, fileset, options)`) calls `aa(...)`. That function injects the wasm loader `<script>` (`document.createElement("script")`), requires `self.ModuleFactory`, then calls `await self.ModuleFactory(self.Module||i)` and clears `self.ModuleFactory`. So a new module is created per task instance. The canvas is `options.canvas ?? new OffscreenCanvas(1,1)` — [vision_bundle.mjs](file:///D:/GitSource/MonaLisa/node_modules/@mediapipe/tasks-vision/vision_bundle.mjs)
- `vision_wasm_internal.wasm` (0.10.35) is 11,153,617 B. Its memory section declares min 290 pages (**18.125 MB**) and max 32,768 pages (**2,048 MB**), growable (parsed from the binary). The nosimd variant is 10,481,398 B — [local wasm files](file:///D:/GitSource/MonaLisa/node_modules/@mediapipe/tasks-vision/wasm/)
- The app already self-hosts `public/mediapipe/0.10.35/vision_wasm_internal.{js,wasm}` and `public/models/face_landmarker/float16-1/face_landmarker.task`. The tracker uses `FilesetResolver.forVisionTasks(opts.wasmBase)`, `modelAssetBuffer`, `runningMode:'VIDEO'` and GPU→CPU fallback — [src/tracking/tracker.ts](file:///D:/GitSource/MonaLisa/src/tracking/tracker.ts)
- `@mediapipe/tasks-vision` has moved on to 1.1.0, released 2026 (npm `versions` list, queried 2026-10-07). The pose and segmenter model files the app would use are all from April–May 2023 (HEAD `last-modified`), so pinning 0.10.35 does not lose any newer body model — [GCS model URLs above](https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task)
- In VIDEO mode the pose detector runs only on the first frame or after tracking is lost; other frames reuse the previous ROI. This makes the steady-state per-frame cost roughly the 256×256 landmark model alone — [legacy Pose docs](https://github.com/google-ai-edge/mediapipe/blob/master/docs/solutions/pose.md)
- Prior art for throttling: a phone-browser app paces PoseLandmarker lite at a fixed 20 Hz, independent of render FPS — [airplane-game PR #45](https://github.com/sorchosky/airplane-game/pull/45)
- A native iOS report says GPU-delegate pose throttles thermally after ~8 minutes while CPU stays stable (unverified, native) — [diyoraharshit blog](https://www.diyoraharshit.com/blog/mediapipe-ios-swift)
- A claimed iOS Safari tab memory ceiling is under 500 MB (secondary source) — [arXiv 2605.20706](https://arxiv.org/html/2605.20706v1). The project constraint states pages can be killed at ~100–200 MB on low-RAM iPhones (project brief, not externally verified).

### Inferences
**Memory estimate (unverified, to be measured)**

| Item | Size |
|---|---|
| Each extra task: wasm heap (initial) | ≥18 MB, grows with model and frame buffers |
| Each extra task: model bytes copied into the heap | lite 5.8 / full 9.4 / heavy 30.7 MB |
| Each extra task: tensors and intermediate textures | unknown |
| Each extra task: separate compiled wasm code | ~11 MB binary; compiled code is not shared across instances unless the engine caches it |
| Each extra task: a WebGL context | unknown |
| **Rough total: face + pose-lite** | probably +40–70 MB over face alone |
| Adding multiclass segmenter (16.4 MB float32 model + 6 confidence maps) | probably +50–100 MB |

The +40–70 MB and +50–100 MB totals are **guesses to be measured with Safari Web Inspector → Timelines → Memory on device**.

**Strategies, in priority order**
1. **Photo-only body mode (MVP).** Body edits happen in the editor on a still image, where pose (full model, IMAGE mode, downscaled to about 1280 px on the long edge) plus an optional segmenter run once. Dispose the pose and segmenter tasks (`close()`) after extracting the landmarks and mask into plain arrays or a small `R8` texture. Peak memory is then transient, and live camera FPS is untouched.
2. **Live body mode (later).** Run pose lite in VIDEO mode every Nth frame (N=2–3, or a fixed 10–15 Hz budget) on a downscaled frame (for example 480×640, which the 256×256 model doesn't need more than). Pass monotonically increasing timestamps, smooth with a One-Euro filter (the face path presumably already has one), and interpolate warp parameters between pose updates. Optionally run face only every other frame while body mode is active.
3. **Alternate inference.** Run face and pose on alternating frames, or run pose only when face motion is large, to keep total inference per frame roughly constant.
4. **ROI cropping.** Because 0.10.35 PoseLandmarker rejects `regionOfInterest`, manual cropping (drawImage into a smaller canvas around the last body box) is the only option. The model's own tracking already does this internally, so the gain is mainly a smaller input upload and preprocess, not inference.
5. **Use pose's own mask** (`outputSegmentationMasks`) instead of a second segmenter task in live mode, read through `getAsWebGLTexture()` on a shared canvas, or with the CPU delegate if GPU masks come back blank (#4757).
6. **Lazy creation and teardown.** Do not create the pose task at app start; create it on first entry to 美體. Give it its own canvas: two Emscripten modules sharing one WebGL context's state is risky (inferred, untested).

### Gaps
- I found no measured memory figures for two tasks-vision instances on iOS, and no per-frame cost of face + pose together in Safari.
- It is not established whether Safari caches compiled wasm across two `WebAssembly.instantiate` calls for the same URL within a page, which would reduce the per-instance code cost.
- I could not find an authoritative, current WebKit statement of per-tab memory limits by device RAM. The project's 100–200 MB figure and the paper's <500 MB are both unverified here.

---

## 5. Deriving the body measurements a retouch needs from 33 keypoints + a segmentation mask

### Takeaway
BlazePose gives joints, not body outlines. There is no waist, chest or neck-base landmark, and hip landmarks 23/24 are joint centres, narrower than the visible hip outline. The practical recipe has four steps:
1. Build a torso frame from shoulders (11/12) and hips (23/24).
2. Define limb axes from shoulder→elbow→wrist and hip→knee→ankle.
3. Find widths (waist, hip, thigh, arm) by casting scanlines perpendicular to these axes into the person mask.
4. Gate each feature on visibility, in-frame checks and mask availability.

These measurements then feed the existing warp primitives (`curveWarp`, `scaleAround`, `shiftAround` in `src/engine/passes/reshape.ts`) as body-space anchors.

### Cited Findings
- Landmark indices: shoulders 11/12, elbows 13/14, wrists 15/16, hips 23/24, knees 25/26, ankles 27/28, heels 29/30, foot index 31/32, ears 7/8, mouth corners 9/10, nose 0 — [Pose Landmarker guide](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker)
- Normalized landmark x and y are relative to image width and height. z is relative depth with "roughly the same scale as x". World landmarks are in metres with hip-centred origin; the model card warns that z is up to scale and not metric — [vision.d.ts](file:///D:/GitSource/MonaLisa/node_modules/@mediapipe/tasks-vision/vision.d.ts), [model card](https://storage.googleapis.com/mediapipe-assets/Model%20Card%20BlazePose%20GHUM%203D.pdf)
- Visibility is the probability that a point is in frame and not occluded. Hidden points are still predicted, as a best guess or average location — [model card](https://storage.googleapis.com/mediapipe-assets/Model%20Card%20BlazePose%20GHUM%203D.pdf)
- The pose segmentation mask has the same size as the input, with values in [0,1] — [legacy Pose docs](https://github.com/google-ai-edge/mediapipe/blob/master/docs/solutions/pose.md). The multiclass mask separates body-skin, clothes, hair and face-skin — [Multiclass model card](https://storage.googleapis.com/mediapipe-assets/Model%20Card%20Multiclass%20Segmentation.pdf)
- Landmark accuracy threshold: PCK@0.2 of torso diameter, so the Lite model's ~87% PDJ means errors of up to 20% of torso size count as "correct". Waist-width measurement must therefore rely on the mask, not on keypoint spacing — [model card](https://storage.googleapis.com/mediapipe-assets/Model%20Card%20BlazePose%20GHUM%203D.pdf)

### Inferences
All of these are engineering derivations. They are not sourced recipes and need tuning on real photos. Convert normalized coordinates to pixel space, multiplying x by W and y by H, before computing any angle or width, because the image is not square.

**Torso frame**
- S = midpoint(11, 12), H = midpoint(23, 24).
- Torso axis u = normalize(S − H); the perpendicular is v.
- Torso length L = |S − H|.
- Shoulder width = |p11 − p12|; hip-joint width = |p23 − p24|.

**Shoulder line (直角肩/美肩)**
- Shoulder slope = angle of (p12 − p11) relative to horizontal.
- 直角肩 also needs the trapezius contour between the neck and the shoulder point. Get it from the mask edge above the shoulder line, between the ear (7/8) x-range and the shoulder x. Use multiclass "hair" to exclude long hair.
- Warp: `shiftAround`/`curveWarp` that raises and squares the upper contour, anchored at the shoulder points.

**Neck (天鵝頸)**
- From the chin (FaceLandmarker point 152, already tracked) to S.
- Neck width comes from mask scanlines in that band.
- Lengthen by stretching the band vertically: shift the head up, or shoulders down.

**Head size (小頭)**
- Centre the scale on the face oval (FaceLandmarker silhouette) or on the ears and nose.
- Apply `scaleAround` with radial falloff ending above the neck band, so the shoulders don't move.

**Waist line (細腰)**
- No keypoint exists. Search t ∈ [≈0.35, 0.75] of L above H along u (heuristic).
- At each t, cast a scanline along ±v through the mask and record the left and right edges.
- Waist = the t with minimum width, or a fixed t ≈ 0.4–0.5 if the profile is flat.
- Exclude arm pixels. Detect them by checking whether the elbow and wrist (13–16) project inside the torso band, and by gaps (background) in the scanline; when arms touch the torso, cap the width by a body prior.
- Warp: two mirrored `curveWarp`s pushing the side contours inward, with peak at waist t and falloff to the ribs and hips.

**Hip line, waist-hip ratio and 美臀/提臀 (腰臀比)**
- Hip line = the scanline at H, or the maximum-width t slightly below H. Mask width there is the visible hip width. It is larger than |p23 − p24|, because those are joint centres.
- WHR = waist width / hip width (2D proxy). Retouching changes it by narrowing the waist and/or widening the hips.
- 提臀 (side or back views) = local upward `shiftAround` below H. Use z or the shoulder-width ratio to detect side view.

**Legs (長腿/瘦腿)**
- Axes: 23→25→27 and 24→26→28; feet 29/31, 30/32.
- 長腿 = vertical stretch of the region below roughly the hip or knee line. Distribute the stretch more toward the shins, and keep the feet's aspect ratio by stretching segments between the knees and ankles.
- Enable only if knees and ankles are visible and in frame; otherwise, at most stretch the visible lower edge of the image.
- 瘦腿: for each segment, a capsule around the axis whose radius comes from mask scanlines perpendicular to the segment; compress along the perpendicular.

**Arms (瘦手臂)**
- Axes 11→13→15 and 12→14→16.
- Capsule compression perpendicular to the upper arm, with the radius from mask scanlines.
- Skip when the arm overlaps the torso, so the waist doesn't move.

**Chest (胸部)**
- No landmarks. Place the region heuristically at t ≈ 0.7–0.85 of L above H, inset from the shoulders.
- Low confidence and clothing-dependent. Use multiclass clothes vs body-skin only to decide whether to allow it, and keep strength low.

**Overall slimming (瘦身)**
- Combine a mild horizontal compression toward the torso axis, weighted by the soft person mask, with the per-part warps.
- Attenuate where the mask edge is near strong background lines (see Q2).

**Gating and stability**
- Each feature declares its required landmarks: waist needs 11, 12, 23, 24 plus the mask; legs need 23–28.
- Require visibility > τ (≈0.5–0.6), in-frame position, and enough torso pixel size (for example L > 15% of the image height).
- In live mode, smooth landmarks and widths (One-Euro), and freeze measurements while the user holds still to avoid shimmering contours.

**Representation for the shader**
- Pass the derived anchors as uniforms in the same spirit as `ReshapeGeometry`: torso frame (S, H, u), per-part centres, radii and directions.
- Keep the mask as a low-res texture (for example 256 px) for background protection, rather than doing per-pixel CPU work.

### Gaps
- I found no published, validated recipe (paper or open-source) for deriving waist and hip lines from BlazePose plus a mask. Commercial apps (Meitu/美圖秀秀, BeautyPlus, FaceTune "Body") do not disclose their method. The scanline and torso-fraction heuristics above should be validated on a test set of selfies and full-body photos.
- I found no data on how well selfie and multiclass masks follow true body contours under loose clothing, where waist warps are most error-prone.
- Head-pose and side-view handling (3/4 body rotation changes apparent waist width) has not been quantified; using world landmarks or the shoulder-width/hip-width ratio as a rotation cue is untested.
