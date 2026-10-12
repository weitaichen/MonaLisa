# 選臉 / 選人：商業修圖 App 的做法，以及在瀏覽器裡用 MediaPipe 實作

範圍：靜態照片編輯，即時相機只簡短帶過。目標環境是 iPhone PWA（WebGL2 + MediaPipe Tasks Vision 0.10.35）。目前美顏、美型、美妝只作用在一張自動選出的臉，美體只作用在一個自動選出的人。

研究時間：2026-10-11。下面的教學和評測大多是 2021–2023 年的，App 介面可能已經改版，引用時請留意日期。

---

## 一、商業 App 的選臉 UX：會自動偵測所有臉嗎？用什麼方式選？每張臉能各自設定嗎？有沒有「套用到全部」？

### Takeaway
主流做法是「自動偵測所有臉，再點臉上的框來選」。醒圖用「面部識別框」，Facetune 在偵測到的臉兩側畫括號，美圖秀秀在底部提示「識別到多人，請選擇一位」。進階的做法是每張臉保存獨立參數，另外提供多選或同步修改。美圖秀秀 2026 年的版本陸續加入「多選人臉」、「多人同步」和「皮膚美化分人臉」。比較舊或比較簡單的 App（2021 年的輕顏、美顏相機的一鍵美顏）則是全員套用，或只修其中一人，不能選。

### Cited Findings

**醒圖**
- 合照的單人修臉步驟：導入照片 →「面部重塑」→ 系統自動識別合照中所有臉 → 點某人的「面部識別框」，該臉會放大並被選中 → 用「小臉」等工具調整，其他人的臉不會一起變。要換人時，捏合縮小畫面，再點第二個面部識別框，最後按「√」保存。文章日期 2021-06-15。— [完美教程資訊](https://tech.wmzhe.com/article/28815.html)
- 百度經驗的同類教學說，如果沒有先點選面部識別框就調整，合照裡所有人的臉都會被調整。也就是說，預設是全員，點框之後才是單人。— [百度經驗：醒圖怎麼只P一個人](https://jingyan.baidu.com/article/5d6edee23dc6b7d8ebdeec0a.html)
- 2021-10-22 的競品分析寫道：「導入多人合照，醒圖並不能選擇人物進行單獨美顏，只能全部一鍵美顏，可以在一級菜單中進行針對性的修臉」。換句話說，一鍵美顏是全員套用，面部重塑之類的手動工具才可以選人。— [人人都是產品經理 競品分析](https://www.woshipm.com/evaluating/5183886.html)

**美圖秀秀**
- 舊版流程：在「人像美容」點「面部重塑」，系統自動識別人臉，底部提示「識別到多人，請選擇一位進行美容」，點一下要修的人即可。妝容也是相同操作。— [知乎問答](https://www.zhihu.com/question/357352714)（只看到搜尋摘要，全文未讀）
- 2021 年的評測：美圖秀秀能識別多人和每個人的性別，但「只能一個一個切換人物進行美顏」。如果每個人都使用一鍵美容，「濾鏡可能會產生疊加問題，需要手動調整濾鏡為 0」。— [人人都是產品經理](https://www.woshipm.com/evaluating/5183886.html)
- App Store 版本紀錄（最舊到最新；12.x 的日期沒寫年份，排在 11.28.0「2025/12/26」之後，推定為 2026 年）：
  - 12.6.0（3/19）：「「多選人臉」模式上線！一鍵多選，同時為多人臉部重塑」
  - 12.7.0（4/4）：「「多選人臉」2.0 駕到！支持多人同步精修小頭、大眼等」
  - 12.8.0（4/16）：「新增眼部精修、祛皺「多人同步」」
  - 12.13.0（7/2）：「皮膚美化支持分人臉精修，還能一鍵復用歷史膚色」
  - 12.15.0（7/17）：「皮膚美化支持分人臉！合照各美各的，不再互相將就」
  - 12.17.0（8/17）：「馬賽克升級「框選」框一圈，人臉自動打碼，手抖黨終於不用一個個戳了」
  — [App Store：美图秀秀 版本紀錄](https://apps.apple.com/us/app/%E7%BE%8E%E5%9B%BE%E7%A7%80%E7%A7%80-%E8%A7%86%E9%A2%91-%E5%9B%BE%E7%89%87-live%E4%BA%BA%E5%83%8F%E7%B2%BE%E4%BF%AE%E5%B7%A5%E5%85%B7/id416048305?l=zh-Hans-CN&platform=mac)
- 另外，2022 年美圖秀秀推出「多人共享修圖」，讓幾個人各自連線修自己的臉，最多 5 人同時在線。這是協作功能，不是選臉 UI。— [中國日報網 2022-08](https://cn.chinadaily.com.cn/a/202208/16/WS62fb605aa3101c3ee7ae40b2.html)

**美顏相機、輕顏（Ulike 是輕顏的國際版）**
- 美顏相機（2021）：「一鍵美顏後，所有人都會被美顏，不能單獨選擇進行一鍵美顏，可以自由選擇人物，使用其他美顏功能」，而且「無法單獨來調整每個人的程度」。— [人人都是產品經理](https://www.woshipm.com/evaluating/5183886.html)
- 輕顏（2021）：「每個人都可以添加妝容，但不能每個人都自動瘦臉，會自動瘦臉其中一位」，「在手動美顏功能中，無法自主選擇人物進行美容，會全部進行美顏」。— [同上](https://www.woshipm.com/evaluating/5183886.html)

**Facetune（Lightricks）**
- 官方說明：Facetune 可以編輯照片裡的多張臉。選了 Face 工具後，偵測到的每張臉兩側會出現括號（brackets），用來辨識和選擇要編輯的臉。— [Lightricks Help Center](https://lightricks.zendesk.com/hc/en-us/articles/12020310462610-Can-I-edit-multiple-faces-in-a-photo)（只看到搜尋摘要；直接抓取時伺服器回 403）
- 官方部落格：多臉照片可以「長按來偵測臉」（tap and hold to detect a face），再在臉之間切換，分別編輯。— [Facetune blog：How to touch up photos](https://www.facetuneapp.com/blog/how-to-touch-up-photos)（只看到搜尋摘要；直接抓取失敗）
- Faceblur 的 Multi-Face 偵測會一次找出所有臉，可以全部套用相同強度，也可以逐臉調整。— [Facetune blog：How to blur faces](https://www.facetuneapp.com/blog/how-to-blur-faces-in-photos-guide)（搜尋摘要）

**FaceApp**
- 直接點畫面上的臉來選擇要編輯哪一張；要切換時，點左下角的 multiface 按鈕。— [FaceApp blog](https://www.faceapp.com/blog/editing-group-photos-without-losing-anyone/)（搜尋摘要）

**YouCam Perfect（Perfect Corp）**
- 換臉功能會自動偵測照片裡所有的臉，再點每張臉來操作。— [Perfect Corp blog：Multiple Face Swap](https://www.perfectcorp.com/consumer/blog/photo-editing/multiple-face-swap)
- 臉沒有極端角度、沒有被部分遮擋時，偵測效果最好。— [YouCam Online Editor：Face Swap](https://yce.perfectcorp.com/face-swap)（搜尋摘要）
- 臉部重塑怎麼選臉，沒有找到官方步驟說明，見 Gaps。

**PicsArt**
- 官方 FAQ 說 AI Retouch 不能用在合照：「the face will not be detected in a group photo」，必須使用單人照。— [Picsart Help Center](https://support.picsart.com/hc/en-us/articles/36107321591581-How-to-use-Retouch-in-Picsart)
- 網頁版 Face Editor 標榜「不需要選取或描出臉」，會自動辨識並套用。多人時怎麼處理，頁面沒有說明。— [Picsart Face Editor](https://picsart.com/face-editor/)

**黃油相機**
- 隱私協議提到基於臉部的自動美顏，入口在【導入圖片-編輯-人像-美顏】，臉部資訊只在本機處理。合照怎麼選臉，沒有找到說明。— [黃油相機隱私協議](https://agreement.bybutter.com/protocol/butter-privacy-policy.html)

### Inferences
- 業界有三種模式：
  - **A. 全員套用**：一鍵美顏（醒圖、美顏相機的一鍵功能）。
  - **B. 點框選一人，逐人修**：醒圖面部重塑、舊版美圖、Facetune、FaceApp。
  - **C. 多選或同步修改，加上分人臉的獨立參數**：美圖秀秀 2026 年的方向。

  2026 年的領先者（美圖）把「多選同步」和「分人臉獨立」兩條路都做了，連膚色都可以分人臉。對 Mona Misa 來說，B 是最小可行版本，C 是加分項。
- 選擇方式最常見的是「在畫面上點臉框」，搭配「縮放畫面以點到下一張臉」（醒圖）。FaceApp 另外有一顆 multiface 切換鈕，但沒有看到任何 App 用「縮圖列」或「編號標記」的明確證據。建議 iPhone 上兩者並用：畫面上顯示每張臉的框（或圓點），加一個小型「人臉切換列」（縮圖 chip，含「全部」選項）。小臉在手機上不好點，縮圖列可以解決這個問題。
- 預設行為最好是「已選中一張臉」（和目前自動挑一張的行為相容），而不是醒圖那種「沒選就套用全員」。醒圖的做法容易讓使用者誤改到別人；教學文章特別提醒要先點框，可見這是常見困擾。
- 美圖 2021 年的「濾鏡疊加」問題提醒我們：全域效果（濾鏡、調色）和每張臉的效果必須分層。每張臉只保存美顏、美型、美妝的參數，全域濾鏡只套一次。
- Facetune 的「長按來偵測臉」暗示了一個補救流程：自動偵測漏掉的臉（太小或側臉），可以讓使用者在該位置長按，在那個區域裁切放大後再偵測一次。這是推論，Facetune 的內部做法沒有公開。

### Gaps
- 醒圖目前版本（2026）的選臉 UI 有沒有改成縮圖列，或有沒有「套用到全部」的開關：沒有找到 2024 年以後的教學。
- YouCam Perfect 的臉部重塑、美顏怎麼選臉，沒有找到官方說明，只有換臉的說明。
- 各 App 最多支援幾張臉：沒有找到任何官方數字。美圖「多人共享修圖」的 5 人上限是協作人數，不是臉數。
- B612：一則下載站摘要聲稱「即使畫面中有多人，也能精準選中目標人物進行美體」，但我抓取的下載頁面上找不到這句話，未經證實。
- 小臉、背景臉在這些 App 裡怎麼處理（會不會顯示框、有沒有最小尺寸）：沒有找到資料。

---

## 二、美體（全身）怎麼選人？

### Takeaway
公開資料很少。唯一找到明確說明的是美圖旗下的 Wink：它用「區分人像」加「局部調整」，只修單一個人，不影響畫面中的其他人。醒圖的美體在多人照片中怎麼選人，沒有找到任何資料。美圖秀秀 2026 年加了「一鍵美體」，但版本說明沒有提到選人。

### Cited Findings
- Wink FAQ：「Wink 有"區分人像"功能使用"局部調整"功能，即可實現針對單人的個性化美體，不影響畫面中的其他人。」頁面另外提到 AI「智能區分人物與場景」，可以做背景保護。— [Wink 身材美型](https://wink.cn/ai-body-editor)
- 美圖秀秀 12.12.0（6/20，推定 2026）：「新增「一鍵美體」」；12.10.0：「身材塑形新增「瘦斜方肌」與「纖細」體型」。版本說明沒有提到多人選人。— [App Store：美图秀秀](https://apps.apple.com/us/app/%E7%BE%8E%E5%9B%BE%E7%A7%80%E7%A7%80-%E8%A7%86%E9%A2%91-%E5%9B%BE%E7%89%87-live%E4%BA%BA%E5%83%8F%E7%B2%BE%E4%BF%AE%E5%B7%A5%E5%85%B7/id416048305?l=zh-Hans-CN&platform=mac)
- 本專案目前的行為：偵測到 2 人以上時，只修「最大且最靠近畫面中央」的人。做法是用 landmark 的外框面積（先裁到畫面內），再依離中心的距離打折。UI 會顯示「偵測到多人，僅調整畫面中央的主要人物」。— [src/tracking/bodyTracker.ts `selectPerson`](D:/GitSource/MonaLisa/src/tracking/bodyTracker.ts)；[src/body/measure.ts](D:/GitSource/MonaLisa/src/body/measure.ts)
- 本專案的程式註解已經指出：美體挑的人和臉部追蹤挑的「第一張臉」在合照中可能不是同一個人，這時別人的 mask 會把這張臉的限制裁小。— [src/ui/faceProtectModel.ts](D:/GitSource/MonaLisa/src/ui/faceProtectModel.ts)

### Inferences
- 美體選人最自然的 UI 是「點身體」：用每個 pose 的 segmentation mask 做 hit-test，點在誰的 mask 上就選誰。mask 重疊時，選信心值高的那個。退而求其次，可以點臉來選，再透過臉和身體的配對（見第四節）找到身體。
- 「選臉」和「選人」應該共用一個「人物」實體（person = 臉 + 身體）。使用者在美顏分頁選了 A，切到美體時預設也是 A。這樣就能解決目前美體和臉各自挑人、彼此不一致的問題。

### Gaps
- 醒圖、B612、YouCam 的美體在多人照片中怎麼選人：沒有找到可信來源。
- Wink 的「區分人像」實際上是點選、框選還是縮圖：頁面沒有說明。

---

## 三、MediaPipe 技術面：numFaces / numPoses、每多一張臉的成本、分割 mask

### Takeaway
FaceLandmarker 和 PoseLandmarker 都可以把 `numFaces`、`numPoses` 調大（預設都是 1）。結果是「每人一組」的陣列，PoseLandmarker 的 `segmentationMasks[i]` 也是每人一張。成本大致是「偵測器跑一次，加上每張臉或每個人各跑一次 landmark 模型」，而 landmark 模型是比較貴的那一段。官方沒有公布多臉的延遲數字。FaceLandmarker 內建的偵測器是 BlazeFace short-range，針對前鏡頭自拍距離最佳化，合照裡的小臉、遠處的臉容易漏掉。

### Cited Findings
**FaceLandmarker**
- `numFaces`：整數，大於 0，預設 1，意思是「最多偵測幾張臉」。`minFaceDetectionConfidence`、`minFacePresenceConfidence`、`minTrackingConfidence` 預設都是 0.5。結果是每張臉一組 478 點的 mesh；blendshapes（52 個）和 transformation matrix 是選用輸出。`detect()` 和 `detectForVideo()` 是同步呼叫，會卡住 UI thread。— [Face Landmarker Web guide](https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker/web_js)
- 模型套件包含 face detection（「BlazeFace short-range model … optimized for mobile GPU inference」）、FaceMesh-V2（256×256）和 blendshape 模型。這一頁寫的偵測器輸入是 192×192。「Smoothing is only applied when num_faces is set to 1」。官方沒有延遲 benchmark。— [Face Landmarker guide](https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker)
- Face Detector 頁面：BlazeFace short-range「optimized for front-facing phone camera images at short range」，輸入 128×128。另外列出 BlazeFace full-range（針對後鏡頭的全距離照片）和 Sparse full-range（約小 60%）。— [Face Detector guide](https://developers.google.com/edge/mediapipe/solutions/vision/face_detector)。**注意**：兩頁寫的偵測器輸入尺寸不一樣（192 和 128），而且 FaceLandmarker 能不能換成 full-range 偵測器，官方沒有說明。
- 兩段式的成本參考：Pixel 9 Pro 用 TFLite benchmark 跑 GPU，face detector 約 3.6 ms，face landmarker 約 11.4 ms（合計約 15 ms）；CPU 合計約 88 ms；在 Android App 內實測 30–70 ms。— [GitHub #5872](https://github.com/google-ai-edge/mediapipe/issues/5872)
- 多臉的準確度問題：Python 0.10.3 的回報，照片有 4 張臉，即使把信心門檻降到 0.02，也只偵測到 1 張；`num_faces=2` 時也只回 1 張。— [GitHub #4698](https://github.com/google/mediapipe/issues/4698)
- 舊版 Face Mesh 文件說明追蹤機制：偵測滿 `max_num_faces` 張臉之後就只做追蹤，直到追丟才重新跑偵測器。所以影片模式下，若 numFaces 大於實際人數，可能每一幀都會跑偵測器。— [legacy face_mesh.md](https://github.com/google-ai-edge/mediapipe/blob/master/docs/solutions/face_mesh.md)（搜尋摘要）

**PoseLandmarker**
- `num_poses` 預設 1；`output_segmentation_masks` 預設 False；三個信心門檻預設都是 0.5。33 個點裡，0 是鼻子，1–3 是左眼（內、中、外），4–6 是右眼，7、8 是左右耳，9、10 是嘴角。管線是先跑人體偵測，再跑 landmark 模型。偵測器輸入 224×224，landmark 輸入 256×256，有 lite、full、heavy 三種，沒有延遲數字。— [Pose Landmarker guide](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker)
- JS 的 `PoseLandmarkerResult` 有 `landmarks: NormalizedLandmark[][]` 和 `segmentationMasks?: MPMask[]`，每個元素對應一個偵測到的人；`close()` 會釋放 mask 資源。— [PoseLandmarkerResult (JS)](https://developers.google.com/mediapipe/api/solutions/js/tasks-vision.poselandmarkerresult)；[Pose Landmarker Web guide](https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker/web_js)
- 本專案的實測：tasks-vision 0.10.35 在 CPU delegate 加上 `outputSegmentationMasks` 時，每次偵測 wasm 都會中止，所以要 mask 時改用 GPU graph。— [reports/全身美體修圖 PWA 實作.md](D:/GitSource/MonaLisa/reports/全身美體修圖%20PWA%20實作.md)；本專案先前的筆記也記錄了：`numPoses > 1` 時結果的排序方式（依大小或依分數）沒有文件說明。— [research_notes/全身美體修圖 PWA 實作/open_source_and_integration.md](D:/GitSource/MonaLisa/research_notes/全身美體修圖%20PWA%20實作/open_source_and_integration.md)

**多人分割**
- ImageSegmenter 的 SelfieSegmenter（背景和人兩類）與 SelfieMulticlass（背景、頭髮、身體皮膚、臉部皮膚、衣服、其他）都是「類別 mask」，**不分個體**。官方模型裡沒有實例分割。Pixel 6 上的整條管線延遲：SelfieSegmenter 約 33–35 ms；SelfieMulticlass CPU 217.76 ms、GPU 71.24 ms。— [Image Segmenter guide](https://developers.google.com/edge/mediapipe/solutions/vision/image_segmenter)
- SelfieMulticlass 在 iOS Safari 的 GPU delegate 上類別會錯亂（例如 category 1 回傳的是脖子或身體，而不是頭髮），回報時尚未修復。— [GitHub #6142](https://github.com/google-ai-edge/mediapipe/issues/6142)（本專案先前的筆記已收錄）

### Inferences
- 靜態照片只偵測一次（IMAGE mode），所以 numFaces 和 numPoses 的成本是一次性的。依 #5872 的比例，每多一張臉大約多一次 landmark 推論，GPU 上約 10 ms 級，在 iPhone WebGL 上可能更慢，但一次性付出可以接受。建議上限：`numFaces` 5–8，`numPoses` 3–5。
- 要「依人區分」的 mask，唯一的內建來源是 PoseLandmarker 的 per-pose `segmentationMasks`。SelfieMulticlass 不分人，只能和 per-pose mask 相交（例如「A 的 mask ∩ 臉部皮膚」）。但 SelfieMulticlass 在 iOS GPU 上有類別錯亂的 bug，CPU 又要約 218 ms（Pixel 6 數據），不建議作為選人的主要依據。
- 即時相機：smoothing 只在 `numFaces=1` 時生效，多臉時 landmark 會抖動。所以相機預覽可以維持單臉，多臉只在編輯照片時開啟。這和輕顏「只自動瘦其中一位」的取捨類似。

### Gaps
- iPhone Safari（WebGL2 / WebGPU delegate）上 FaceLandmarker 每多一張臉的實際毫秒數：沒有找到公開 benchmark，需要在本專案的 bench 裡自己量。
- FaceLandmarker 能不能改用 full-range 偵測器來偵測小臉：官方沒有說明。
- `numFaces > 1` 時結果的排序（依信心、面積或位置）：沒有找到文件，應該視為無序。

---

## 四、臉和身體的配對，以及一次 render 多張臉的獨立變形和妝容

### Takeaway
沒有找到專門談「臉和身體配對」或「多臉美顏 shader」的公開文章或論文。下面的做法是根據官方 landmark 定義和本專案現有架構推出來的，屬於推論，需要實測驗證。

### Cited Findings
- Pose 的 0–10 號點（鼻、雙眼內中外、雙耳、嘴角）和 FaceMesh 的臉部點落在同一區域，可以拿來做幾何配對。— [Pose Landmarker guide](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker)
- 本專案已經有 `maskCoversFace(face, mask, minFrac=0.5)`：臉部橢圓內部至少一半的取樣點，person 信心值 ≥ 0.5，才算「這張臉屬於這個人」。— [src/ui/faceProtectModel.ts](D:/GitSource/MonaLisa/src/ui/faceProtectModel.ts)
- 本專案的臉部追蹤目前設定 `numFaces: 1`。— [docs/superpowers/specs/2026-10-07-meiyan-pwa-design.md](D:/GitSource/MonaLisa/docs/superpowers/specs/2026-10-07-meiyan-pwa-design.md)

### Inferences
- **配對演算法（建議）**：對每一組（臉 i、pose j）計算一個成本。
  - 成本：臉部 mesh 鼻尖和眼角，與 pose 0–6 號點的距離，用臉寬正規化。
  - 加分：臉部橢圓落在 pose j 的 mask 內（沿用 `maskCoversFace`）。
  - 用匈牙利法，或人數少時用貪婪法，做一對一指派。
  - 成本超過門檻就不配對，例如臉清楚但身體被裁掉（只修臉），或背對鏡頭（只有身體）。
- **每臉獨立參數的資料模型**：`faces: Array<{ id, bbox, params }>` 加上一個 `activeFaceId`；「全部」只是把同一份 params 寫進所有 face。全域濾鏡、調色放在臉部參數之外，避免美圖 2021 年那種濾鏡疊加。
- **單次 render 的兩種做法**：
  1. 在 shader 裡宣告 uniform 陣列（例如 `uniform vec4 uFace[MAX_FACES*K]`），每個 fragment 迴圈累加每張臉的位移。所有位移都在**原圖座標**計算後再相加，不要依序套用；依序套用時，前一張臉的變形會移動下一張臉的錨點。
  2. 每張臉各畫一個 pass 做 ping-pong，簡單但 pass 數會隨臉數增加，而且會遇到上面說的錨點偏移。

  在 iPhone 上，方案 1 用一個迴圈加 early-out（fragment 不在某臉的影響半徑內就跳過）通常比較划算。妝容可以把每張臉的 UV 或 mesh 用 instancing 或多次 draw call 疊上去，因為妝容是局部的。
- **相鄰臉的變形互相干擾**：每張臉的變形衰減半徑，應該限制在「到最近另一張臉中心距離的一半」以內，像 Voronoi 分區那樣。或者讓每張臉的位移在另一張臉的橢圓內強制歸零。本專案的美體已經有背景保護的位移帶（`src/body/field.ts`），可以沿用同樣的概念，把「其他人的臉和身體」當作保護區。

### Gaps
- iPhone WebGL2 的 uniform 上限（`MAX_FRAGMENT_UNIFORM_VECTORS`）和多臉迴圈的實際 fps 或毫秒：沒有找到可信來源，需要在裝置上實測。
- 商業 App（美圖、醒圖）的多臉 render 架構：完全沒有公開資料。

---

## 五、常見陷阱：重疊、被畫面裁切、小臉、側臉、重新開檔時的身分一致性、鄰臉干擾

### Takeaway
官方和實測資料能證實的有幾點：側臉和遮擋會降低偵測率（Perfect Corp），近距離偵測器對遠處小臉不友善（BlazeFace short-range），多臉偵測可能漏臉（#4698），ImageSegmenter 不分個體。重新開檔時的身分一致性，沒有找到任何資料，只能靠自己設計比對。

### Cited Findings
- 臉沒有極端角度、沒有被部分遮擋時，偵測效果最好。— [YouCam Online Editor：Face Swap](https://yce.perfectcorp.com/face-swap)（搜尋摘要）
- BlazeFace short-range 是針對「front-facing phone camera images at short range」最佳化的。— [Face Detector guide](https://developers.google.com/edge/mediapipe/solutions/vision/face_detector)；FaceLandmarker 使用的正是 short-range 偵測器。— [Face Landmarker guide](https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker)
- 有 4 張臉卻只偵測到 1 張，降低門檻也沒用（Python 0.10.3）。— [GitHub #4698](https://github.com/google/mediapipe/issues/4698)
- PicsArt 官方直接不支援合照的 AI Retouch，因為偵測不到臉。— [Picsart Help Center](https://support.picsart.com/hc/en-us/articles/36107321591581-How-to-use-Retouch-in-Picsart)
- 本專案的 `selectPerson` 會先把超出畫面的 landmark 裁掉，再計算外框面積，避免「半身在畫面外的大人物」因為虛擬的外框範圍而勝出。— [src/tracking/bodyTracker.ts](D:/GitSource/MonaLisa/src/tracking/bodyTracker.ts)

### Inferences
- **小臉、遠處的臉**：可以做兩段偵測。第一次全圖偵測；如果使用者長按某處（學 Facetune），就以該點為中心裁切放大，例如裁成臉約占 1/3 的區域，再偵測一次，把座標換算回全圖。也可以設最小臉寬門檻，例如低於短邊的 3–4%，就不顯示框，或標成「太小，無法精修」。
- **被畫面邊緣裁切的臉**：FaceMesh 仍會輸出 478 點，但畫面外的點是外插出來的。變形時要把畫面外的點夾到邊界，或降低強度；瘦臉的錨點如果在畫面外，可能把畫面邊緣的像素拉進來。
- **側臉**：一側的輪廓點會被遮住，左右對稱的瘦臉或大眼會不自然。可以用 transformation matrix 或 yaw 估計，對側臉降低遮住那一側的強度。
- **重疊的人**：兩人的 pose mask 重疊時，hit-test 選信心值高的；身體變形的位移，在另一個人的 mask 內應該歸零或衰減，否則會拉扯前景的人。
- **重新開檔時的身分一致性**：MediaPipe 結果的排序沒有文件保證，所以存檔時不能只存索引，要存每張臉在原圖正規化座標下的 bbox 或中心點，加上幾個關鍵點。重新偵測後，用 IoU 或中心距離做匹配，超過門檻就視為新臉，參數歸零並提示。同一張原圖、同一個模型版本，理論上偵測結果會很接近，但官方沒有保證是確定性的。
- **鄰臉變形干擾**：見第四節。衰減半徑以「到最近鄰臉距離的一半」為上限，位移在原圖座標中一次加總。

### Gaps
- MediaPipe IMAGE mode 對同一張圖是否完全確定（同樣的輸入，同樣的輸出和排序）：沒有找到文件。
- 商業 App 遇到臉被畫面裁切或側臉時，會不會隱藏框或降低強度：沒有找到資料。
- 多人重疊時各 App 的美體行為：沒有找到資料。
