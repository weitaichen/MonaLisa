# 用姿態骨架驅動不彎背景的全身美體

MonaLisa 不需要新的 ML runtime，也不需要任何雲端服務，就能做出全身美體。骨架偵測用已經在 pinned `@mediapipe/tasks-vision` 0.10.35 裡的 **PoseLandmarker**（33 個關鍵點，Apache-2.0，相片用 full 模型 9.40 MB），它同時能輸出人像遮罩。變形本身用規則式的解析位移場：沿骨骼法線壓縮的 capsule field、只依賴 y 的全寬垂直拉伸帶，再加上現有的 `scaleAround` / `shiftAround`。這些位移寫進一張低解析度的 backward displacement texture，併入現有 P2 reshape pass 的同一次取樣。商用方案也是這條路：相芯、騰訊、阿里 Queen、BytePlus 都用 **18–42 個 2D 關鍵點驅動 7–8 個即時滑桿**。學術界的 learned flow（FBBR、AAGN）授權不允許商用，diffusion 方法（Odo）要 **約 23 GB GPU 記憶體、每張 18 秒**，兩者都無法出貨。自然度主要取決於幾何，而不是模型。條件有四個：位移方向垂直於肢體；強度停在商用建議的安全區（瘦身滑桿約 20–30%，增高 5–15%）；位移場被羽化後的人像遮罩約束；長腿用只隨 y 變化的全寬拉伸帶。做到這四點，門框和地平線就不會彎。建議第一階段只在相片編輯器上線，原因有三：前鏡頭自拍通常拍不到臀和腿；iPhone Safari 上沒有任何公開的 PoseLandmarker 效能數據；第二個 MediaPipe task 估計會多吃 40–70 MB，而 SE 級機種約 100 MB 就會被系統殺掉，這個風險是真的。即時相機、直線保護和液化筆刷都排在實機量測之後。

## 商用 App 只用 18–42 個關鍵點，就撐起 7–8 個美體滑桿

主流 App 的美體功能分成兩層。第一層是自動：一鍵美體，加上一排由身體關鍵點驅動的部位滑桿。第二層是手動：手指推擠的液化工具，以及用兩條可拖曳水平線框選區段的「增高」拉伸帶。美圖秀秀在 Android v12.13.0 把「一鍵美體」放進【美容】，並讓「手動瘦身」支援影片與 Live Photo ([jb51 鏡像](https://www.jb51.net/softs/56367.html))。醒圖同時提供自動（長腿、收腰、瘦肩、提臀）與手動（局部瘦身、增高、比例，範圍與強度由使用者決定）兩套 ([ddooo 鏡像](https://www.ddooo.com/softdown/166858.htm))。一份 2026 年的六款 App 實測認為醒圖的控制最細，頭、肩、胸、腰、臀、腿長、腿粗都能分開調；美圖和 FaceApp 的瘦身最自然 ([FlowPix](https://www.flowpixai.com/tutorials/ai-photo-slimming.html))。西方的 Facetune 沒有專屬的身體自動滑桿，只有通用的 Reshape／Refine／Resize／Restore 工具組 ([Facetune](https://www.facetuneapp.com/features/reshape-photo))。美圖的「增高」**不需要姿態模型**：它是對使用者框選區段做局部垂直拉伸，教學建議 **5–15%**，超過就會看出背景變形 ([automazin 教學](https://www.automazin.com/Blogs/%E7%BE%8E%E5%9B%BE%E7%A7%80%E7%A7%80%E5%A2%9E%E9%AB%98%E5%8A%9F%E8%83%BD%E4%BD%BF%E7%94%A8%E6%95%99%E7%A8%8B.html))。所以它是整個功能集裡成本最低、又能在偵測失敗時補位的一項。

SDK 文件是唯一公開具體參數的來源，各家的設計高度收斂。相芯 FaceUnity 的 BodySlim 有七個參數：瘦身、長腿、瘦腰、美肩、美臀、小頭、瘦腿，範圍都是 0–1，其中**只有美肩以 0.5 為中性、可雙向**；多項同時開啟時效果「線性疊加」 ([FULiveDemo 美體文件](https://github.com/Faceunity/FULiveDemo/blob/master/docs/%E7%BE%8E%E4%BD%93%E9%81%93%E5%85%B7%E5%8A%9F%E8%83%BD%E6%96%87%E6%A1%A3.md))。騰訊特效 SDK 的單向項目用 0–100，胸部和瘦手臂則是 −100–100 ([騰訊雲參數表](https://cloud.tencent.com/document/product/616/103616))，背後是 **42 點人體關鍵點** ([騰訊雲功能說明](https://cloud.tencent.com/document/product/616/67043))。阿里 Queen 的八項全部是 −1–1 雙向 ([Queen Android](https://www.alibabacloud.com/help/en/live/developer-reference/feature-descriptions-for-android))，用 18 個關鍵點 ([阿里雲](https://help.aliyun.com/document_detail/211049.html))。Queen 還有 Web 版 `aliyun-queen-engine`，在 Pro／Full 版本提供美體 ([Queen Web](https://help.aliyun.com/zh/live/developer-reference/integrate-the-queen-sdk-for-web))。這證明瀏覽器端即時美體在商業上已經有人做，只是閉源而且要授權。BytePlus 的骨架偵測是 18 點，原生「在 iPhone 7 上少於 6 ms」 ([BytePlus](https://docs.byteplus.com/en/docs/effects/docs-body-sdk))。

| 廠商 | 關鍵點 | 美體項目 | 範圍與方向 |
|---|---|---|---|
| 相芯 FaceUnity | 25 | 瘦身、長腿、瘦腰、美肩、美臀、小頭、瘦腿 | 0–1；美肩 0.5 中性雙向，其餘單向、預設 0 |
| 騰訊特效 | 42 | 一鍵瘦身、長腿、瘦腿、瘦腰、瘦肩、胸部、小頭、瘦手臂 | 0–100；胸部、瘦手臂 −100–100 |
| 阿里 Queen | 18 | 瘦身、長腿、小頭、瘦腿、豐胸、手臂、脖子、瘦腰 | 全部 −1–1 |
| PixelFree | 未公開 | 另含沙漏腰、曲線、提跨、豐臀、天鵝頸、直角肩，以及左右大臂、小臂、大腿、小腿分開調 | 全部 0–1，0.5 中性 |

使用者特別點名的「腰臀比」，**在任何消費級 App 裡都沒有看到獨立滑桿**。最接近的是 PixelFree 的「沙漏腰」「曲線」「提跨／豐臀」 ([PixelFree](https://github.com/uu-code007/PixelFreeEffects))。這表示腰臀比應該做成複合控制：同時驅動收腰和臀側外推兩個場。這是設計上的機會，下文會給出具體作法。

強度與失敗模式的證據也一致。六款 App 實測歸納出三種失敗：最常見的是背景變形（牆、門框、條紋彎曲），其次是比例失衡（腿瘦了腳沒變、腰細了胸沒跟上），以及液化邊緣模糊。測試者建議**上限 20–30%**，並且要放大檢查 ([FlowPix](https://www.flowpixai.com/tutorials/ai-photo-slimming.html))。影像之匠 PixPretty 偵測約 30 個身體點，建議值如下：瘦身從 30% 起；增高 5–15%，每 10% 約等於 2–3 cm 視覺身高；天鵝頸 5–20%；直角肩 30–50%，再多就僵硬；瘦手臂 20–40%。調整順序是先增高，再調身體四肢，最後肩頸 ([PixPretty](https://www.pixpretty.com/portrait-retouching-tips/reshaping.html))。醒圖大約在 v5.8／5.9 為瘦臉瘦身加上「背景保護」，版本號只來自下載站鏡像 ([gameggg 鏡像](https://www.gameggg.com/app/3095.html))。YouCam 說它把變形限制在分割出的人像輪廓內 ([Perfect Corp](https://yce.perfectcorp.com/products/body-reshape))，FaceApp 則有「Lock Background」 ([FaceApp](https://www.faceapp.com/blog/tips-and-tricks-reshape-tool/))。**沒有任何一家公開背景保護的實作方式**，「以人像遮罩約束位移場」是根據這些行銷說法做的推論。即時場景的難點也有記錄：相芯的 release notes 提到，後續版本降低了大動作時頭肩附近物體的變形，並讓人物進出畫面時的過渡更平滑 ([FULiveDemoMac releases](https://github.com/Faceunity/FULiveDemoMac/releases))。Bodytune 被使用者批評腰臀工具無法在 X/Y 方向移動，遇到彎腰或側身就會對不準 ([Google Play](https://play.google.com/store/apps/details?id=net.braincake.bodytune&hl=en_IE))。

## PoseLandmarker 已在 0.10.35 裡，替代方案全都更重或授權不合

讀過本機安裝的套件可以確認：`PoseLandmarker` 在 0.10.35 有完整型別，包含 `numPoses`、三個信心門檻、`outputSegmentationMasks`、world landmarks、IMAGE／VIDEO 模式與 `POSE_CONNECTIONS` ([vision.d.ts](../node_modules/@mediapipe/tasks-vision/vision.d.ts))。所以**不必升級到會回傳遙測的 1.x**。三個官方模型都是 float16，2023 年 4 月之後沒有更新，因此 pin 在舊版不會錯過任何更新的身體模型。model card 用 1,400 張後鏡頭手機照評估，PDJ@0.2 的平均準確度依序是 Lite 87.0%、Full 91.8%、Heavy 94.2%，東亞子集分別是 83.2／90.4／92.6 ([BlazePose GHUM model card](https://storage.googleapis.com/mediapipe-assets/Model%20Card%20BlazePose%20GHUM%203D.pdf))。Heavy 比 Full 多 21 MB，只換來 2.4 個百分點，相片模式選 Full 最划算。

| 模型 | 位元組數 | 建議用途 | 重點 |
|---|---|---|---|
| `pose_landmarker_lite.task` | 5,777,746 ([GCS](https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task)) | 即時相機（P2） | PDJ 87.0% |
| `pose_landmarker_full.task` | 9,398,198 ([GCS](https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task)) | 相片編輯器（P1） | PDJ 91.8% |
| `pose_landmarker_heavy.task` | 30,664,242 ([GCS](https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/latest/pose_landmarker_heavy.task)) | 不建議 | PDJ 94.2% |
| `selfie_segmenter.tflite` | 249,537 ([GCS](https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite)) | pose 遮罩不可用時的備援 | 256×256，人像／背景兩類 |
| `selfie_multiclass_256x256.tflite` | 16,371,837 ([GCS](https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite)) | P3：分離衣服、皮膚、頭髮，僅限 CPU | mIoU 77.23 |

用在自拍上有三個陷阱，三個都會直接影響設計。第一，model card 明列「**頭部不可見**」屬於適用範圍外，而且對看不到或難以標註的點，模型會「優雅退化為預測平均位置」 ([model card](https://storage.googleapis.com/mediapipe-assets/Model%20Card%20BlazePose%20GHUM%203D.pdf))。也就是說，前鏡頭自拍拍不到的膝蓋和腳踝**仍會拿到看起來合理的座標**。第二，原始模型輸出有 visibility 和 presence 兩個值，但 0.10.35 的 JS 型別**只暴露 `visibility`、沒有 `presence`** ([vision.d.ts](../node_modules/@mediapipe/tasks-vision/vision.d.ts))，而 0.10.0 曾被回報兩個值都沒有 ([MPI 4479](https://github.com/google-ai-edge/mediapipe/issues/4479))。因此每個部位的開關都要同時檢查兩件事：visibility 超過門檻，以及座標落在畫面內。後者用來代替缺少的 presence。第三，bundle 把 PoseLandmarker 的 region-of-interest 旗標設為 false，傳入 `regionOfInterest` 會直接丟例外 ([vision_bundle.mjs](../node_modules/@mediapipe/tasks-vision/vision_bundle.mjs))。要裁切只能自己畫到 canvas，再把座標換算回來。

記憶體是比 GPU 時間更硬的限制。在 0.10.35，每次 `createFromOptions` 都會重新注入 loader script 並呼叫 `ModuleFactory()`。所以 FaceLandmarker 和 PoseLandmarker 雖然共用同一份 wasm **檔案**，卻各有一份 Emscripten 模組。解析 wasm 二進位得到的初始線性記憶體是 **18.125 MB**，可成長到 2 GB ([vision_bundle.mjs](../node_modules/@mediapipe/tasks-vision/vision_bundle.mjs)；[vision_wasm_internal.wasm](../public/mediapipe/0.10.35/vision_wasm_internal.wasm))。這個 heap，加上複製進 heap 的模型權重、留在 JS 端的 model buffer、tensor 與中間貼圖，**粗估總共再增加 40–70 MB**。這個數字還沒量測，必須用 Safari Web Inspector 在實機確認。對照的平台事實是：iPhone SE 3 約 100 MB、iPad 8 約 200 MB 就被殺頁，而且無法攔截 ([研究簡報 §1](../docs/superpowers/specs/2026-10-07-meiyan-research-brief.md))。WebKit 在每張相片都建立再關閉 instance 時會漏記憶體 ([tracker.ts](../src/tracking/tracker.ts))，所以 pose instance 也要延遲建立、整個 session 只建一次，不能每張相片重建。首次載入也要預留時間：有人回報在 iOS webview 中用 `Promise.all` 同時建立 PoseLandmarker 與 GestureRecognizer，第一次要 30 秒以上 ([MPI 5171](https://github.com/google-ai-edge/mediapipe/issues/5171))。

速度方面**沒有任何 iPhone Safari 的公開數據**。最接近的參考是 BlazePose GHUM Holistic 論文：Lite／Full／Heavy 在 Pixel 4 GPU 上是 8／9／22 ms，在 MacBook Pro 2017 的 Chrome 上是 13／15／29 ms ([arXiv 2206.11678](https://arxiv.org/pdf/2206.11678))。原生 iOS 的第三方部落格則提到，GPU delegate 跑約 8 分鐘後會因過熱從 30 fps 掉到 18 fps ([dev.to](https://dev.to/diyoraharshit52/mediapipe-on-ios-what-the-docs-leave-out-22bl))。人像遮罩有兩條路，都有 iOS 地雷。PoseLandmarker 本身的 `outputSegmentationMasks` 曾在 GPU delegate 下回傳全零，CPU 正常 ([MPI 4757](https://github.com/google-ai-edge/mediapipe/issues/4757))。ImageSegmenter 的 multiclass 模型在 iOS Safari + GPU 下類別錯亂，這個 issue 從 2025-11-09 開到現在還沒修 ([MPI 6142](https://github.com/google-ai-edge/mediapipe/issues/6142))。兩者的結論相同：**相片模式的 pose 一律用 CPU delegate**。這同時省下第三個 WebGL context。

替代方案逐一排除。MoveNet 只有 17 個 COCO 點，沒有腳跟、腳尖，也沒有遮罩。它有唯一一筆 iPhone 瀏覽器數據（iPhone 12 WebGL：Lightning 51 fps、Thunder 43 fps），但那是 2021 年的數字，套件從 2023 年起就沒有更新 ([tfjs-models](https://github.com/tensorflow/tfjs-models/blob/master/pose-detection/src/movenet/README.md))。RTMPose 走 ONNX Runtime Web，光是 wasm 就要 14.2 MB（CPU）或 28.3 MB（WebGPU） ([npm onnxruntime-web](https://www.npmjs.com/package/onnxruntime-web))，而且 Safari 26 上還有尚未修復的崩潰與記憶體問題 ([ORT #27584](https://github.com/microsoft/onnxruntime/issues/27584)；[ORT #26827](https://github.com/microsoft/onnxruntime/issues/26827))。DWPose 的模型是 134 MB ([HF](https://huggingface.co/yzd-v/DWPose))。Sapiens v1 是 CC BY-NC，不可商用 ([HF](https://huggingface.co/facebook/sapiens))。HolisticLandmarker 也在 0.10.35 裡，一個 task 就涵蓋臉和身體，理論上能省掉一個 runtime。但有使用者回報它的 pose 明顯不如 `pose_landmarker_heavy` 準 ([MPI 5569](https://github.com/google-ai-edge/mediapipe/issues/5569))，它的體積和 Safari 延遲也都沒有查證，所以只列為 P2 的備選。

## 垂直於骨骼的位移場，加上遮罩約束，才能不彎門框

業界的美體流程都是規則式：先偵測關鍵點或輪廓點，算出目標點或參數化的場，再用 inverse（backward）映射取樣。這樣影像連續、不會有破洞。一篇 2018 年的 CSDN 工程文用輪廓點加 MLS 做瘦腿、瘦腰，作者直說輪廓點偵測「比人臉特徵點更加複雜」 ([CSDN Trent1985](https://blog.csdn.net/Trent1985/article/details/80667611))。字節的長腿用「預先設定好的形變函數」，結果發現水泥路被拉彎了，只好再加一道最佳化，確保「直線仍然是直線」 ([騰訊新聞](https://news.qq.com/rain/a/20220313A03FNH00))。

說明「好的身體位移場長什麼樣」，最強的證據來自 Ren 等人的 CVPR 2022 論文。他們的 learned flow 只調整肢體寬度，長度和方向不變，「**位移方向與對應肢體趨於垂直**」。flow 在 **256×256** 預測，雙線性上採樣後就足以處理 4K 影像，因為它局部平滑。一個係數 µ ∈ [−1, 1] 可以連續縮放胖瘦。身高則交給「沿身長方向的非均勻縮放」 ([Ren et al. 2022](https://arxiv.org/abs/2203.04670))。這幾點直接撐起本報告的 GPU 設計：位移場用少數解析的、沿骨骼方向的壓縮函數構成，在低解析度算好，全解析度只取樣一次。

| 技術 | 局部性 | 摺疊風險 | 在 MonaLisa 的角色 |
|---|---|---|---|
| 徑向局部場（現有 `curveWarp`／`scaleAround`／`shiftAround`） | 半徑外為零 | 有解析界線 | 小頭、直角肩、美臀；圓盤是等向的，不適合細長肢體 |
| 沿骨骼的 capsule 場（新增，同一家族但非等向） | 半徑外為零 | k·a < 1.25 保證不摺 | 腰、手臂、腿、整體瘦身的主力 |
| 全寬一維垂直帶 | 整列 | 構造上單調 | 長腿、手動增高、天鵝頸的主力 |
| MLS rigid／similarity | 全域（權重永不為零） | 大位移會 fold-back ([Schaefer 2006](https://www.cs.rice.edu/~jwarren/research/mls.pdf)) | 要加錨點釘住背景；留給 P3 手動工具 |
| 液化筆刷（累積位移貼圖） | 筆刷半徑 | 重複塗抹會摺 | P3 編輯器手動模式 |
| TPS／ARAP | 全域，要解線性系統 | TPS 會剪切、非均勻縮放 | 不採用；WebGL2 沒有 compute shader，解算得放在 JS |

capsule 場的數學很短，而且能保證不摺疊（以下是本報告的推導）。在 iso 空間，`iso(p) = (x, y/aspect)`，取骨骼 A→B。v 是到骨軸的有號距離，R = ρ·W，其中 W 是由遮罩量出的肢體半寬，ρ ≈ 1.7–2.0。令 r = |v|/R、φ(r) = (1−r²)²，backward 映射為 v_src = v·(1 + k·a(t)·φ(r))，a(t) 是在關節附近淡出的窗函數。對 v 微分得 1 + k·a·(1−r²)(1−5r²)。後一項在 r² = 0.6 時有最小值 −0.8，所以**只要 k·a < 1.25 就保證不摺疊**。代價是：肢體核心被壓到 1/(1+k)，r ≈ 0.77 那圈背景被拉伸到最多 1/(1−0.8k) 倍。取 k = 0.25 時，核心縮 20%，外圈背景拉伸 25%。若 ρ = 2，輪廓邊緣落在 r ≈ 0.43，解出的可見寬度約**縮小 14%**，正好落在商用建議的安全區內。外圈那 25% 的拉伸，就是背景會出問題的地方。

為什麼線會彎，可以精確描述：一條直線會彎，當且僅當**垂直於該線的位移分量沿著線變化**。只有 x 分量的位移（例如手臂、軀幹近乎垂直時的瘦腰）**永遠不會彎水平線**，只會彎門框這類垂直線。只依賴 y 的全寬垂直帶，則讓所有水平線和垂直線都保持筆直，只有斜線（地磚、透視的路緣）在過渡帶有輕微彎曲。這就是全寬增高看起來自然、只拉腿部局部卻把路拉彎的幾何原因，也正是字節遇到的問題。長腿帶的 backward 映射可以寫成 C¹ 連續且單調，在過渡帶上斜率從 1 平滑變到 1/S：

```glsl
float legBand(float y, float h, float b, float S) {   // 傳回來源 y；y 向下增加
  float tau = clamp((y - (h - b)) / (2.0 * b), 0.0, 1.0);
  float I = tau*tau*tau - 0.5*tau*tau*tau*tau;         // smoothstep 的積分
  return y + (1.0/S - 1.0) * (2.0*b*I + max(0.0, y - (h + b)));
}   // y >= h+b 時等於 h + (y-h)/S
```

背景保護的核心是把位移場乘上一個遮罩 M_f，M_f 是人像遮罩先膨脹 δ、再羽化 f。人像收縮後空出來的區域，必須由輪廓外那一圈背景拉伸填補。若邊緣移動 Δ，那圈背景大約被拉伸 1 + Δ/(δ+f) 倍。經驗法則是**帶寬至少 4Δ，拉伸就不超過 25%**，與 capsule 推導的上限一致。在輪廓處硬切而不填補，會產生撕裂，所以羽化是必要的。學界承認同樣的限制：FBBR 說 flow 會扭曲重疊區域的背景，解法是背景 matting 加上修補過的乾淨背景，但完整背景很難取得 ([Ren et al. 2022](https://arxiv.org/abs/2203.04670))。NeuralReshaper 指出，全圖三角化的方法會把人體變形「傳播到整張圖」 ([arXiv 2203.10496](https://arxiv.org/pdf/2203.10496))。手機端可行的進階手段有兩種。一種是對露出的細縫做 push-pull mip 金字塔填補，適合寬度在畫面 1–2% 以內的細縫。另一種是線段感知的網格最佳化，Shih 等人的 content-aware mesh 已經在 Pixel 3 上以互動速率出貨 ([ACM TOG 2019](https://dl.acm.org/doi/10.1145/3306346.3322948))，但後續評估指出仍有部分背景結構會彎 ([arXiv 2104.12464](https://arxiv.org/pdf/2104.12464))。兩者都屬於編輯器專用的 P3。

部位之間的衝突是第二大失敗來源，目前沒有任何來源記錄 App 怎麼處理，以下對策都是本報告的提案。手臂垂在腰旁時，腰的場會拖動手臂；手叉腰時手會被壓扁；兩腿相貼時，每條腿的壓縮會取樣到另一條腿，紋理會重複。對策有三。一是用其他部位的 capsule 權重做排除，把該部位的場乘上 (1 − w_other)。二是沿骨骼法線取樣遮罩，判斷相鄰部位之間有沒有背景縫隙；沒有縫隙時改用單側 falloff，只壓縮朝向背景的外輪廓。三是多人合照時，把其他人遮罩內的場歸零。

## 開源界沒有可出貨的美體模型，只有可重用的數學

學術方法沒有一個能出貨。FBBR（Alibaba DAMO，CVPR 2022）的程式碼標明「For academic and non-commercial use only」，BR-5K 資料集要簽協議、用機構信箱申請 ([GitHub FBBR](https://github.com/JianqiangRen/FlowBasedBodyReshaping))。AAGN（WACV 2025）在 BR-5K 上把 PSNR 從 24.79 提到 26.41、LPIPS 從 0.0777 降到 0.0643 ([arXiv 2404.13983](https://arxiv.org/abs/2404.13983))，但它的 repo 沒有授權檔 ([GitHub AGGN](https://github.com/Randle-Github/AGGN))，依法預設保留所有權利。Odo（2025）用 SMPL 深度圖加 ControlNet，需要**約 23 GB GPU 記憶體、每張 18 秒**，程式碼仍是「coming soon」 ([arXiv 2508.13065](https://arxiv.org/pdf/2508.13065))。DiffBody（WACV 2024）同樣是 diffusion 路線 ([arXiv 2401.02804](https://arxiv.org/pdf/2401.02804))。Zhou 等人 2010 年的 3D 參數化方法，按 FBBR 的說法需要「十幾分鐘的使用者協助」 ([Ren et al. 2022](https://arxiv.org/abs/2203.04670))。

技術上，小型 flow 網路在瀏覽器裡並非不可能。FBBR／AAGN 的 generator 約 6.7–6.9M 參數 ([ar5iv AAGN](https://ar5iv.labs.arxiv.org/html/2404.13983))，換算 fp16 約 13.5 MB，在 256×256 推論一次對編輯器來說負擔得起。真正擋住的是三件事：沒有授權乾淨的權重，沒有授權乾淨的成對修圖資料，還得在 iOS 上跑第二個 ML runtime。所以 learned flow 只能列為遠期選項，而且前提是出現可商用的模型。

可以合法重用的是積木。`cxcxcxcx/imgwarp-opencv` 是 MIT 授權的 MLS 與分段仿射實作 ([GitHub](https://github.com/cxcxcxcx/imgwarp-opencv))，可以當 P3 手動工具的數學參考。`ctbot000/face-beautifier` 是 MIT 授權的 WebGL2 + MediaPipe 臉部專案，它用 One Euro filter 平滑關鍵點，因為幾何變形會把 1–2 px 的抖動放大到看得見；它也指出 smoothstep falloff 在位移不超過半徑 0.45 倍時不會摺 ([GitHub](https://github.com/ctbot000/face-beautifier))。OpenGL ES「大長腿」教學把畫面切成 8 頂點、6 三角形的條帶，只拉伸中段 ([CSDN](https://blog.csdn.net/lin1109221208/article/details/108047624))，原理就是上一節的一維帶。專案現有的 GPUPixel 衍生 shader 原語是 Apache-2.0，可以沿用並註明出處。網路搜尋找不到任何開源的即時網頁美體專案，所以 MonaLisa 的位移場要自己寫。好在數學夠短，需要的工作量很清楚。

## MonaLisa 的落地設計：把美體位移場併進 P2，先做相片編輯器

### 管線：一次 backward map，零新增 FBO

不要新增獨立的美體 pass。正確的放法是把美體位移變成現有 reshape shader 的**最外層 backward 映射**：先算 `tc = vUv + texture(uBodyDisp, vUv).xy`，再跑原本的 `uBox` 判斷與臉部鏈，最後只做一次 `texture(uSrc, tc)`。現有 shader 本來就是 `tc = vUv` 之後才對 `tc` 做 `uBox` 檢查 ([reshape.ts](../src/engine/passes/reshape.ts))，所以臉部判斷會自然作用在位移後的座標上。換成正向的說法，就是「先修臉，再動身體」，好處有四個。第一，臉部鏈仍在原圖座標運作，111 點不必做任何轉換。第二，臉部場在 `uBox` 外嚴格等於恆等映射，所以肩、髖、膝、踝等 pose 錨點也不受影響。只有頭頸錨點會偏一點，偏移量是臉部位移本身，最大滑桿下估計不超過臉寬的 10%，對小頭和天鵝頸可以忽略。第三，P1 的妝容先畫進 A，會跟著變形一起移動。第四，skin mask 本來就透過 `maskWarp` 跑同一個 pass ([pipeline.ts](../src/engine/pipeline.ts))，會自動跟著身體變形。相對地，如果另開一個 pass，在 2048×1536 下要多一張 12.6 MB 的 FBO，還要多一次雙線性重取樣造成的模糊。

需要的程式改動很具體。`planPasses` 的條件改成 `reshape: (faceOn && reshapeActive) || (bodyOn && bodyActive)`。`ReshapePass.draw` 改為接受 `face: Face | null` 加上 body field，沒有臉時把 `uBox` 設為空。`yawAttenuation` 只乘在臉部 uniform 上，絕不乘在身體場上。

位移場的資料契約是一張 **RG16F 貼圖**，每個 texel 存 UV 單位的 backward 位移，用 LINEAR 取樣。16F 格式在 WebGL2 核心規格中可以過濾，iOS 上 `EXT_color_buffer_float` 的覆蓋率是 100% ([研究簡報 §1](../docs/superpowers/specs/2026-10-07-meiyan-research-brief.md))。這個契約不佔任何 fragment uniform。這點很重要，因為光是 `uPts[111]` 就已經吃掉大約一半的最低保證 uniform 槽位。同一個契約也讓規則式場、MLS、手動液化，以及未來的 learned flow 都能接進同一個 pass，GLSL 不用改。解析度方面，研究筆記曾建議 64×64 到 96×128。本報告認為**長邊應該取約 256**（例如 192×256），理由是 Ren 等人的 256×256 有直接證據支持；而在全身照裡，手臂寬度只占畫面寬 3–4%，64 寬的場只分得到 2–3 個 texel，φ 曲線會被雙線性插值壓成折線。P1 在 CPU 上建場：49k 個 texel，每個 primitive 只算自己的 bounding box，估計數毫秒，只在參數或偵測結果改變時重建。位移以 UV 為單位，與解析度無關，所以**預覽和匯出完全一致**。建場時做三道防護：每個 capsule 的 k·a 硬上限 0.8；重疊區的總和低於 1.25；debug build 用有限差分算 det(J)，標出低於 0.3 的 texel。

### 偵測：一個延遲建立、CPU delegate 的 PoseLandmarker

新增 `src/tracking/bodyTracker.ts`，沿用 `tracker.ts` 的 self-healing 模式。規則如下：使用者第一次進入美體分頁時才建立，而且排在臉部 tracker 之後，不要用 `Promise.all` 一起建；整個 session 只建一次；給它自己的 `OffscreenCanvas`；沿用同一個 `wasmBase`。相片模式的設定是 full 模型、IMAGE 模式、`delegate: 'CPU'`、`numPoses: 2`（用來偵測多人並提示）、`outputSegmentationMasks: true`，輸入是長邊不超過 1280 的縮圖，與現有的 `CPU_FRAME_MAX_EDGE` 一致。遮罩用 `getAsFloat32Array()` 讀出，降採樣成約 256 長邊的 R8，上傳到引擎自己的 context，然後立刻 `result.close()`。不能用 `getAsWebGLTexture()`，因為它綁在 MediaPipe 自己的 context 上 ([vision.d.ts](../node_modules/@mediapipe/tasks-vision/vision.d.ts))。pose 座標和 `Face` 一樣是未鏡像、左上原點的正規化座標，可以直接當 UV 用。模型放在 `/models/pose_landmarker/full-float16-1/`，由 `fetch-assets.mjs` 鎖定 md5，用現有的進度提示按需下載。`/models/` 已經有 CacheFirst 規則。`HistoryEntry` 快取 `Body`（66 + 33 個 float，加上約 64 KB 的遮罩），重開歷史紀錄時就不必再載入 pose 模型。

> **實作註記（2026-10-08）**：上面的 CPU delegate 建議已被實測推翻。tasks-vision 0.10.35 在 CPU delegate 加 `outputSegmentationMasks` 時，每次偵測都會讓 wasm 模組中止（image_frame.cc 的 ChannelSize 檢查；`tests/harness/b3/probe.mjs`）。因此實作在需要遮罩時改用 GPU graph 並同步 `detect` 後 `close()`；GPU graph 建不起來時才退回不帶遮罩的 CPU（`mask = null`）。見 `src/tracking/bodyTracker.ts` 的 `resolveDelegate` 與實作計畫的 Implementation deviations D1。

### 量測與閘控：寬度取自遮罩，不取自關鍵點間距

BlazePose 只給關節，沒有腰、胸或頸根的點。而且 PCK@0.2 的定義表示，誤差在軀幹直徑 20% 以內都算「正確」 ([model card](https://storage.googleapis.com/mediapipe-assets/Model%20Card%20BlazePose%20GHUM%203D.pdf))。所以**所有寬度都必須從遮罩量**。以下流程是本報告的工程推導，需要用實拍照片調校。先轉成像素座標，再建立軀幹座標系：S 是 11 與 12 的中點，H 是 23 與 24 的中點，軸向 u 是 S−H 的單位向量，長度 L = |S−H|。腰線沿 u 在 H 上方 0.35–0.75 L 之間搜尋，每個位置沿 ±v 對遮罩打掃描線，取寬度最小的位置；輪廓太平時固定取約 0.45 L。打掃描線時要排除落在軀幹帶內的手臂像素。臀線取 H，或 H 稍下方寬度最大的位置。注意遮罩量到的臀寬一定大於 |p23 − p24|，因為後者是關節中心。腰臀比 WHR 就是這兩個遮罩寬度的 2D 代理值。四肢的半寬 W 在每段骨骼的 3–5 個位置沿法線量取，取中位數。

| 區域 | 必要條件 | 驅動的滑桿 |
|---|---|---|
| 頭頸 | 偵測到臉（FaceLandmarker），且 11、12 可見 | 小頭、天鵝頸 |
| 肩 | 11、12 | 直角肩 |
| 手臂 | 11–16 | 瘦手臂 |
| 軀幹 | 11、12、23、24，且有遮罩 | 瘦身、細腰、腰臀比、美臀 |
| 腿 | 23–28，而且腳在畫面內 | 長腿、瘦腿 |

> **實作註記（2026-10-08）**：沒有遮罩時，軀幹的瘦身、細腰、美臀改用關鍵點比例推估的寬度並乘上保守係數（`NO_MASK_GAIN` 0.7）；只有腰臀比一定要有遮罩。

每個依賴的點都要同時滿足三個條件：visibility > 0.6；座標在畫面內並留邊距；L 超過畫面高度的 15%。任一條件不成立，滑桿就灰掉並顯示原因。每一項位移的增益再乘上它所依賴錨點的最小 visibility，這樣在 P2 即時模式下效果會淡入淡出，不會突然跳出來。騰訊的 SDK 也是只在偵測到身體時才觸發身體回呼 ([騰訊雲 API](https://cloud.tencent.com/document/product/616/65896))。

### 參數：十個滑桿，滿格只到商用安全區

參數沿用現有模型：數值存成 0..1 的 float，單向以 0 為中性，雙向以 0.5 為中性，介面顯示 0–100 或 −50…+50。下表的增益是起始值，全部需要在實機上調校。它們的選法是讓滑桿拉滿時，可見變化剛好落在前面引用的商用安全區：寬度變化不超過約 15%，拉伸 5–15%，天鵝頸 5–20%。

| id | 名稱 | 型 | 原語 | 滿格增益（起始值） | 滿格的大約視覺量 |
|---|---|---|---|---|---|
| `body.slim` | 瘦身 | 單向 | 軀幹與四肢 capsule，ρ 2.0／1.7，關節淡出 e≈0.15 | k = 0.18 | 輪廓寬度約 −10% |
| `body.waist` | 細腰 | 單向 | 軀幹 capsule，沿軸凸起 a(t)，峰值在腰線，σ≈0.3 L | k = 0.25 | 腰寬約 −14% |
| `body.whr` | 腰臀比 | 單向（複合） | 腰部凸起（k_w>0）加臀側凸起（k_h<0），70% 收腰、30% 外擴 | 由目標 WHR 反推 k_w、k_h | WHR 約 −12% |
| `body.hip` | 美臀 | 雙向 | 臀側 capsule 凸起 ±；側面或背面時加 `shiftAround` 提臀 | \|k\| ≤ 0.2；提臀 0.04·L | 臀寬 ±約 10% |
| `body.legs` | 長腿 | 單向 | 自臀線以下的全寬 `legBand`，b≈0.03–0.05 | S = 1.12 | 腿段 +12% |
| `body.legSlim` | 瘦腿 | 單向 | 大腿與小腿 capsule，e≈0.12 避免膝蓋被捏細 | k = 0.22／0.15 | 腿寬約 −12% |
| `body.arms` | 瘦手臂 | 單向 | 上臂與前臂 capsule，避開手掌 | k = 0.25／0.10 | 上臂約 −12% |
| `body.shoulder` | 直角肩 | 單向 | 11、12 處向上的非等向 `shiftAround`，falloff 停在腋下以上 | 0.25·(y_肩 − y_頸根) | 肩斜明顯變平 |
| `body.head` | 小頭 | 單向 | `scaleAround`，d<0，R≈1.5 倍臉高（含頭髮），下巴以下淡出 | d = −0.12 | 頭約 −11% |
| `body.neck` | 天鵝頸 | 單向 | 只做垂直位移的頭部橢圓，從下巴到肩線用 smoothstep 淡出 | Δ = 0.03·臉高 | 頸長約 +5–10% |

腰臀比是唯一需要在 CPU 上「反推」的項目。用量到的 W_w、W_h 和目標比例 WHR' = WHR·(1 − 0.12·s)，解出腰部的 k_w 和臀部的 k_h。臀部外擴是蓋住背景而不是露出背景，所以不會產生破洞；負 k 的摺疊界線是中心斜率 1 + k > 0。它和細腰、美臀寫進同一組場，依相芯「線性疊加」的慣例相加，然後再套用總和上限。長腿的畫面高度不變：預設把 S 夾在 S ≤ (1 − h)/(y_腳 + m − h)，m ≈ 0.02，讓腳留在畫面內；畫面下方地板或上方頭頂有空間時，自動加一段反向壓縮帶來吸收。加高畫布會牽動 `processingSize`、匯出與歷史紀錄，應該另案決定。

倫理預設同樣是設計的一部分。FBBR 作者明確警告資料集被濫用的倫理風險 ([GitHub FBBR](https://github.com/JianqiangRen/FlowBasedBodyReshaping))。所以：所有 `body.*` 預設中性；美體不進入全域「一鍵」預設和「程度」，臉部預設的 `matchesPreset` 仍成立，舊的歷史紀錄由 `sanitizeParams` 自動補上中性值；不提供「理想比例」這類自動目標；**胸部延後**，它既敏感，從正面骨架推估也不可靠。

### UI：美體分頁、灰階禁用與手動增高帶

在美型後面加一個 `{ id: 'body', label: '美體' }` 分頁，順序變成 一鍵 · 美膚 · 美型 · 美體 · 濾鏡 · 美妝，六個兩字分頁在 375 pt 寬度放得下。項目列沿用 `PanelItem`，第一項是 ⊘ 原圖，作用是 `resetGroup(params, 'body')`。之後依 PixPretty 建議的順序排列：長腿、瘦身、細腰、腰臀比、美臀、瘦腿、瘦手臂、直角肩、天鵝頸、小頭。`PanelItem` 要新增 `disabled` 與 `reason` 欄位，例如長腿灰掉時顯示「拍攝全身照可使用長腿／瘦腿」。美臀用中心歸零的雙向滑桿，其餘用單向。長按比較沿用現有功能。「背景保護」做成預設開啟的單一開關，開啟就是遮罩約束；關閉時位移場不受限，身體邊緣更圓滑，但背景會彎。偵測到兩人以上時，只作用在最大或最靠中央的那位，並顯示提示。

P1 還要附一個**手動增高帶**：兩條可拖曳的水平線加一個強度滑桿。它直接重用 `legBand`，不需要 pose，所以 pose 偵測失敗或拍不到腳時，使用者仍然能修。液化推擠筆刷和 Restore 筆刷排在 P3，同樣寫進位移貼圖，合成方式是 D_new(x) = D_brush(x) + D_old(x + D_brush(x))。

### 分階段：P0 量測先於一切

| 階段 | 範圍 | 退出條件 |
|---|---|---|
| P0 量測（`bench.html`） | PoseLandmarker lite／full × IMAGE／VIDEO × CPU／GPU，在 SE 級與當代 iPhone 上量偵測毫秒數、首次載入時間與 Web Inspector 記憶體曲線；確認 `visibility` 有值、遮罩實際解析度、GPU 遮罩是否正確 | SE 級機種載入 pose 後不被殺頁；決定 full 或 lite |
| P1 編輯器美體 | full + CPU + 遮罩；RG16F 位移場併入 P2；表中九項（不含胸部）加手動增高帶；背景保護開關；區域閘控；`Body` 存進歷史紀錄 | 格線貼圖上沒有摺疊；門框、地磚測試照通過目視；匯出與預覽一致 |
| P2 即時相機 | 先做後鏡頭與倒數拍照；lite VIDEO，以 10–15 Hz 或每 2–3 幀偵測一次；對導出量（端點、W、臀線）做 One Euro 加死區；即時不跑遮罩；`bodyWeight` 比照 `faceWeight` 緩動；前鏡頭只開放直角肩、天鵝頸、小頭、瘦手臂；body 項目啟用時鎖在 tier M | 目標機上穩定 30 fps，長時間不降頻 |
| P3 品質 | push-pull 細縫填補；線段偵測加網格最小平方的直線保護；液化與 Restore 筆刷；multiclass 遮罩（CPU，僅相片）判斷寬鬆衣物與長髮；用調校後的數值做「一鍵美體」項目，只放在美體分頁內 | 有直線背景的測試集明顯改善 |
| P4（不建議） | learned flow | 出現可商用的權重與資料才重新評估 |

> **實作註記（2026-10-08）**：P1 實際出貨為 full + GPU graph + 遮罩，GPU 不可用時退回 CPU 且無遮罩（理由見 §偵測的註記）；手動增高的拉伸另有上限，S = 1 + min(0.15·amount, 0.08／帶長)。

即時模式的預算是本報告的估計：臉部約 9–15 ms，加上 pose lite 約 10–20 ms，已經超過 33 ms。每 3 幀偵測一次，pose 平均約 4–7 ms 一幀，再加上不到 1 ms 的建場時間。兩次偵測之間要內插，否則移動中的身體會抖。

## Conclusion

這個功能的難點不在偵測模型，而在幾何和閘控。PoseLandmarker 早就在套件裡，真正決定成敗的是兩件事：位移是否垂直於肢體、是否只隨單一軸變化、是否被遮罩約束；以及看不到的部位是否誠實地被關掉。「低解析度 backward 位移貼圖」這個契約價值最高：它讓規則場、手動增高、液化筆刷，甚至未來的 learned flow 都能共用同一次取樣，美體從此只是 CPU 上的資料問題，不再是 shader 問題。第二個新認識是：約束 MonaLisa 的是記憶體，不是 GPU。每多一個 MediaPipe task 就多一份獨立的 wasm heap，所以 P0 在 SE 級機種上的量測結果，會直接決定 full 或 lite、相片限定或即時都可行。

腰臀比是值得做的差異化功能。目前沒有消費級 App 把它做成獨立滑桿，而 MonaLisa 的遮罩寬度量測讓它可以用「相對改變量」來表達，不必假設任何「理想比例」。這讓同一個功能同時成為產品賣點，也守住倫理底線。反過來說，最常被高估的是 learned 方法。FBBR 和 AAGN 的分數優勢建立在不可商用的資料上，只要授權局面不變，規則式位移場加上好的閘控與背景保護，就是可出貨品質的上限，也是最佳路線。
