# MonaLisa 美顏（v0.3.0，branch feat/meiyan-pwa @ 5edc4e1）現有功能盤點

> 本筆記是程式碼盤點，不是網路研究。所有「來源」都是 repo 內的檔案與行號（相對於 repo 根目錄 `D:/GitSource/MonaLisa`）。文件與程式碼不一致時，以程式碼為準並註明。
> 注意：盤點過程中，工作目錄裡有另一個同時進行的改名（`git status` 顯示 index.html、vite.config.ts、app.tsx、Home.tsx、Settings.tsx 等檔案已被修改，app.tsx:46 已變成「Mona Misa 美顏」）。下面的品牌位置以 HEAD 5edc4e1 為準。

## 1. 畫面與操作流程（Home、Camera、Review、Editor、Settings、紀錄、匯出、更新提示）

### Takeaway
App 只有 4 個畫面：首頁、拍攝、預覽、編輯，加上設定面板（sheet）和幾個全域浮層。沒有路由。流程有兩條：「拍攝 → 預覽 → 儲存或編輯」和「匯入照片／最近編輯 → 編輯 → 儲存」。

### Cited Findings
- 根元件一次只顯示一個畫面（home / camera / review / editor），全域浮層有 UpdateBanner、SettingsSheet、Busy、Toast、SaveFallback — [src/ui/app.tsx:51-63](../../src/ui/app.tsx)
- 畫面狀態只有 4 種，沒有 router 或 pushState — [src/ui/state.ts:1, 42-46](../../src/ui/state.ts)
- **首頁**的內容：
  - 字標「MonaLisa 美顏」、副標「即時美顏 · 專業修圖 · 全程在裝置上」、引擎狀態 chip — [src/ui/screens/Home.tsx:124-133](../../src/ui/screens/Home.tsx)
  - 兩個大按鈕：「拍攝／即時美顏相機」和「匯入照片／從相簿精修」 — [Home.tsx:135-156](../../src/ui/screens/Home.tsx)
  - 「最近編輯」縮圖列：點一下重新開啟，按「編輯」進入刪除模式，刪除前要再確認一次 — [Home.tsx:158-221](../../src/ui/screens/Home.tsx)
  - iOS 未安裝時的「加入主畫面」提示 — [Home.tsx:223-234](../../src/ui/screens/Home.tsx)
  - 頁尾隱私說明 — [Home.tsx:236-239](../../src/ui/screens/Home.tsx)
- **拍攝（即時相機）**的控制項：
  - 頂列有回首頁、比例（3:4 / 1:1 / 9:16 循環切換）、計時（關 / 3s / 10s）、切換前後鏡頭 — [src/ui/screens/Camera.tsx:325-339](../../src/ui/screens/Camera.tsx)、[src/ui/state.ts:9-15](../../src/ui/state.ts)
  - 畫面上的狀態標籤：原圖、基本模式、未偵測到臉部、臉部偵測重新啟動中 — [Camera.tsx:344-353](../../src/ui/screens/Camera.tsx)
  - 倒數動畫和快門閃光 — [Camera.tsx:354-361](../../src/ui/screens/Camera.tsx)
  - 點預覽畫面可以收合美顏面板，收合後用「美顏」按鈕叫回來 — [Camera.tsx:260-264, 372-388](../../src/ui/screens/Camera.tsx)
  - 底列有「相簿」（匯入）、快門（倒數中按下會取消）、「按住對比」 — [Camera.tsx:402-431](../../src/ui/screens/Camera.tsx)
- **預覽（Review）**：標題「預覽」，按鈕有「重拍 / 儲存 / 編輯」。按「編輯」會把**未處理的原始畫面**和拍攝當下的參數交給編輯器，避免效果被套兩次 — [src/ui/screens/Review.tsx:84-92, 96-126](../../src/ui/screens/Review.tsx)
- **編輯（Editor）**：
  - 頂列有「關閉」、「復原 / 重做」、「儲存」（處理中顯示「準備中」） — [src/ui/screens/Editor.tsx:819-828](../../src/ui/screens/Editor.tsx)
  - 畫布可以雙指縮放（最大 5 倍）、平移、雙擊回到全圖 — [Editor.tsx:832](../../src/ui/screens/Editor.tsx)、[src/ui/screens/zoomPan.ts:1, 11-12](../../src/ui/screens/zoomPan.ts)
  - 畫布上有「重置」（第二次按顯示「確定重置？」才執行，3 秒後自動取消）和「按住對比」 — [Editor.tsx:756-769, 843-858](../../src/ui/screens/Editor.tsx)
  - 底部是滑桿加美顏面板 — [Editor.tsx:863-877](../../src/ui/screens/Editor.tsx)
- 「重置」會套用「自然」預設（`applyPreset('natural', 1)`），不是回到原圖。這次重置也會把美體歸零、清掉增高帶（applyPreset 沒傳 keep 參數） — [Editor.tsx:768](../../src/ui/screens/Editor.tsx)、[src/engine/params.ts:163-181](../../src/engine/params.ts)
- 復原／重做只在編輯器裡有，最多 50 步 — [Editor.tsx:152-156](../../src/ui/screens/Editor.tsx)、[src/store/undo.ts:12-13](../../src/store/undo.ts)。相機畫面沒有復原鈕（Camera.tsx 沒有 undo）
- 滑桿：拖動時顯示數值泡泡，雙擊回到建議預設值，軌道上用一個點標出預設值 — [src/ui/components/Slider.tsx:3, 126-127, 172](../../src/ui/components/Slider.tsx)
- **設定**有 5 組：
  - 拍攝：「儲存時鏡像」（預設開）
  - 效能：「畫質」（自動 / 高 / 中 / 低）、「偵測器」（自動（GPU）/ CPU）
  - 進階：「對齊 GPUPixel 原始效果」、「顯示臉部特徵點」
  - 關於：「關於與授權」、隱私說明
  - 頁尾：「MonaLisa 美顏 · 版本」
  - 來源：[src/ui/screens/Settings.tsx:14-25, 86-161](../../src/ui/screens/Settings.tsx)、[src/store/settings.ts:13-20](../../src/store/settings.ts)
- **更新提示**：卡片「有新版本」，顯示目前版本，有「稍後 / 更新」兩個按鈕，只出現在首頁或設定。Service worker 用 prompt 模式，不會自動重新載入 — [src/ui/components/UpdateBanner.tsx:16-41](../../src/ui/components/UpdateBanner.tsx)、[src/ui/updateModel.ts:1-40](../../src/ui/updateModel.ts)、[vite.config.ts:88, 118](../../vite.config.ts)
- **儲存備援**：系統分享選單不能用時，全螢幕顯示圖片，提示「長按圖片 → 儲存到照片」 — [src/ui/app.tsx:86-113](../../src/ui/app.tsx)
- 介面只支援直式。橫放時顯示「請將手機轉為直向使用」 — [index.html:19-27](../../index.html)、[vite.config.ts:100](../../vite.config.ts)
- 另外有開發者用的效能測試頁 `/bench.html`（標題 MonaLisa Bench） — [bench.html:7](../../bench.html)、[src/bench/main.ts:164-170](../../src/bench/main.ts)

### Inferences
- 相機和編輯器共用同一套 6 分頁面板（BeautyPanel）。和醒圖比，這是一個「美顏相機加人像精修」的小型 App，沒有「修圖首頁工具格」那種多工具入口。
- 「最近編輯」只是一個 12 筆的縮圖列（見第 5 節），不是相簿或作品庫。

### Gaps
- 沒有實機跑 UI。版面、動畫、文字截斷等視覺細節沒有確認。

---

## 2. 每個工具與滑桿（UI 上的名稱）

### Takeaway
6 個分頁：**一鍵 · 美膚 · 美型 · 美體 · 濾鏡 · 美妝**。共 25 個滑桿參數：美膚 4、美型 9、美體 10、濾鏡強度 1、美妝 2。另外有 4 個預設、8 個濾鏡、口紅 5 色加原色、腮紅 4 色加原色，以及「增高」帶和「背景保護」開關。

### Cited Findings
- 分頁順序：一鍵、美膚、美型、美體、濾鏡、美妝 — [src/ui/panelModel.ts:27-34](../../src/ui/panelModel.ts)
  - 文件不一致：spec 寫的是 5 個分頁（沒有美體），程式碼後來加了美體 — [docs/superpowers/specs/2026-10-07-meiyan-pwa-design.md:136](../../docs/superpowers/specs/2026-10-07-meiyan-pwa-design.md)
- **一鍵（預設）**：
  - 4 個預設：原圖、自然、精緻、氣色。手動改過參數後，會多出一個選取中的「自訂」項目 — [src/engine/params.ts:98-143](../../src/engine/params.ts)、[panelModel.ts:303-325](../../src/ui/panelModel.ts)
  - 選了預設（原圖除外）後，有「程度」滑桿，可以整體縮放效果 — [panelModel.ts:482-493](../../src/ui/panelModel.ts)、[params.ts:187-191](../../src/engine/params.ts)
  - 「精緻」的內容是柔光濾鏡加較強的美型；「氣色」是暖調濾鏡、豆沙口紅加蜜桃腮紅 — [params.ts:101-142](../../src/engine/params.ts)
  - 預設不包含美體 — [params.ts:20, 158-181](../../src/engine/params.ts)
- **美膚**：磨皮（預設 55）、美白（25）、紅潤（25）、銳化（20），都是 0–100 的單向滑桿 — [params.ts:5-9](../../src/engine/params.ts)
- **美型**：
  - 單向（0–100）：大眼、瘦臉、V臉、窄臉、瘦鼻
  - 雙向（−50…+50）：下巴、額頭、嘴型、眼距
  - 來源：[params.ts:10-19](../../src/engine/params.ts)、[params.ts:258-262](../../src/engine/params.ts)
  - 列表第一項都是「原圖」（⊘），按了會把該組歸零 — [panelModel.ts:326-341](../../src/ui/panelModel.ts)
- **美體**：
  - 項目順序：原圖、**增高**、長腿、瘦身、細腰、腰臀比、美臀（雙向）、瘦腿、瘦手臂、直角肩、天鵝頸、小頭、**背景保護**（開關）。美體預設全部是 0（中性） — [params.ts:20-31](../../src/engine/params.ts)、[panelModel.ts:257-299](../../src/ui/panelModel.ts)
  - 「增高」是可以在畫面上拖動上下邊界的水平帶。帶內垂直拉伸，倍率 S = 1 + min(0.15·amount, 0.08/(bottom−top))，畫面尺寸不變，最多 8% 內容被推出畫面底部。不需要偵測到人也能用。預設位置 top 0.52、bottom 0.86；有偵測結果時改從臀部到腳踝 — [src/types.ts:97-107](../../src/types.ts)、[panelModel.ts:88-89, 109-110, 468-478](../../src/ui/panelModel.ts)、[Editor.tsx:834-840](../../src/ui/screens/Editor.tsx)
  - 「背景保護」預設開。開啟時把身體變形限制在人像遮罩內，背景變形的範圍較小。切換時的提示：「背景保護已開啟：背景變形範圍較小」／「…已關閉：背景變形範圍較大但較平緩」 — [types.ts:88-92](../../src/types.ts)、[panelModel.ts:435-445](../../src/ui/panelModel.ts)
  - 每個美體滑桿會依照片內容啟用或停用，停用時顯示原因，例如「拍攝全身照可使用長腿／瘦腿」、「需要拍到肩膀到臀部，才能使用瘦身／細腰／腰臀比／美臀」、「手臂抬至肩高或更高時無法使用直角肩」、「人物太小…」 — [src/body/measure.ts:29-38](../../src/body/measure.ts)
- **濾鏡**：無、自然、柔光、奶茶、暖調、冷調、日系、膠片、黑白，共 **8 個 LUT 濾鏡**加「無」，各有縮圖。選了濾鏡後有「濾鏡強度」滑桿 — [params.ts:51-61](../../src/engine/params.ts)、[panelModel.ts:344-353, 519-530](../../src/ui/panelModel.ts)、`public/luts/filters/*.png`
- **美妝**只有口紅和腮紅兩種：
  - 口紅：無、原色、珊瑚、豆沙、玫瑰、正紅、蜜橘
  - 腮紅：無、原色、蜜桃、粉紅、杏橘、玫瑰
  - 各有一條強度滑桿
  - 來源：[params.ts:63-80](../../src/engine/params.ts)、[panelModel.ts:36-39, 354-382, 531-542](../../src/ui/panelModel.ts)
- **對比**：相機和編輯器都是「按住對比」（按住時顯示原圖並標示「原圖」） — [Camera.tsx:425-430](../../src/ui/screens/Camera.tsx)、[Editor.tsx:851-856](../../src/ui/screens/Editor.tsx)
- **瘦臉背景限制**：使用者在編輯器裡第一次動了臉型輪廓滑桿（瘦臉 / V臉 / 窄臉 / 下巴 / 額頭）後自動啟用，用人像遮罩限制臉部輪廓變形不要拉扯背景。它不是 UI 開關。必要時會下載 selfie_segmenter — [Editor.tsx:7-13, 771-778](../../src/ui/screens/Editor.tsx)、[Settings.tsx:212](../../src/ui/screens/Settings.tsx)、[types.ts:182-193](../../src/types.ts)
- **基本模式**：臉部模型下載失敗時可以改用基本模式，只剩美膚和濾鏡，美型和美妝停用，顯示「基本模式不支援臉型與美妝」 — [src/ui/components/EngineStatus.tsx:26](../../src/ui/components/EngineStatus.tsx)、[Camera.tsx:270](../../src/ui/screens/Camera.tsx)、[src/ui/components/BeautyPanel.tsx:43](../../src/ui/components/BeautyPanel.tsx)

### Inferences
- 和醒圖這類 App 比，MonaLisa 的臉部工具集中在「基礎美顏 + 9 項臉型 + 2 項美妝」，沒有細分五官（眉、眼型細項、鼻翼、人中、蘋果肌等）。美妝也沒有眼部妝和修容、高光（見第 6 節）。
- 美體 10 項加增高，覆蓋了主流美體 App 的基本項目，但只能用在照片編輯。

### Gaps
- 每個美型滑桿的實際變形幅度（shader 係數）沒有逐一記錄，比較時只能比「有沒有」，不能比「強度」。

---

## 3. 即時相機和照片編輯器各能用哪些功能

### Takeaway
即時相機能用一鍵、美膚、美型、濾鏡、美妝。**美體整個分頁在相機裡停用**，顯示「美體目前僅支援照片編輯」，旁邊有「匯入照片」按鈕。美體、增高、背景保護、瘦臉背景限制、復原／重做、縮放、重置都只在編輯器裡有。

### Cited Findings
- 相機的美體 context 是 `status: 'unsupported'`，每個項目都停用，原因是「美體目前僅支援照片編輯」。分頁還在，但全部灰掉 — [panelModel.ts:92, 102-107](../../src/ui/panelModel.ts)、[Camera.tsx:3, 27-31](../../src/ui/screens/Camera.tsx)
- 相機上「增高」帶的浮層不會出現（showsHeightBand 遇到 unsupported 回傳 false） — [panelModel.ts:174-177](../../src/ui/panelModel.ts)
- 瘦臉背景限制只在照片編輯器裡作用，即時相機用的是沒有限制的變形 — [types.ts:287-291](../../src/types.ts)、[src/engine/pipeline.ts:7-8](../../src/engine/pipeline.ts)
- 相機的美顏參數會記住（localStorage），下次開相機沿用。編輯器每張照片有自己的參數 — [state.ts:53-54](../../src/ui/state.ts)、[src/store/settings.ts:10-11](../../src/store/settings.ts)
- 新匯入的照片會用相機目前的參數開始編輯：`opts.params ?? app.get().params` — [src/ui/flows.ts:32](../../src/ui/flows.ts)
- 相機只在拍攝時裁成選定比例（3:4 / 1:1 / 9:16）。前鏡頭照片依「儲存時鏡像」設定決定要不要鏡像 — [Camera.tsx:196-208](../../src/ui/screens/Camera.tsx)
- 相機請求的解析度是 1920×1080、30 fps（ideal 值）。預覽依畫質等級處理：H 1080 / M 720 / L 540 短邊。拍照時用來源全解析度另外算一次 — [src/media/camera.ts:22](../../src/media/camera.ts)、[types.ts:315-322](../../src/types.ts)、[src/app/live.ts:20-21, 323-335](../../src/app/live.ts)
- spec 明確把「即時相機的美體」列為 v1 不做 — [docs/superpowers/specs/2026-10-07-meiyan-pwa-design.md:48](../../docs/superpowers/specs/2026-10-07-meiyan-pwa-design.md)

### Inferences
- 醒圖本身以修圖為主。如果要做功能對照，MonaLisa 的「即時美顏相機」算是加分項，但即時相機裡沒有美體。

### Gaps
- 實機上即時預覽的 fps 和畫質等級，本次沒有量測（repo 有 bench 頁，但沒有讀取結果）。

---

## 4. 偵測上限：能處理幾張臉、幾個人，團體照現在會怎樣

### Takeaway
**臉部只偵測 1 張**（`numFaces: 1`，取 MediaPipe 回傳的第一張臉）。**身體最多偵測 2 人**（`numPoses: 2`），自動選「面積 × 置中程度」分數最高的人，**使用者不能自己選臉或選人**。團體照裡，臉部效果和身體效果可能落在不同的人身上。美白、銳化、濾鏡則會套到整張圖、所有人。

### Cited Findings
- FaceLandmarker 設定 `numFaces: 1` — [src/tracking/tracker.ts:119](../../src/tracking/tracker.ts)；spec 也寫 `numFaces: 1` — [spec:38](../../docs/superpowers/specs/2026-10-07-meiyan-pwa-design.md)
- 只取 `faces[0]`，程式碼沒有任何選臉邏輯 — [tracker.ts:46-48](../../src/tracking/tracker.ts)
- spec 的 v1 不做清單裡有「multi-face」 — [spec:48](../../docs/superpowers/specs/2026-10-07-meiyan-pwa-design.md)
- PoseLandmarker 設定 `numPoses: 2` — [src/tracking/bodyTracker.ts:4-5, 292](../../src/tracking/bodyTracker.ts)
- `selectPerson` 選要編輯的人：取各人 landmark 外框面積，乘上置中折扣 `(1 − 0.5·d)`（d 是外框中心離畫面中心的距離，0 = 中心，1 = 角落） — [bodyTracker.ts:154-179](../../src/tracking/bodyTracker.ts)
- 偵測結果只保留被選中那個人的 pose 和遮罩，`people` = 有效 pose 數 — [bodyTracker.ts:239-252](../../src/tracking/bodyTracker.ts)
- `people ≥ 2` 時，美體分頁顯示「偵測到多人，僅調整畫面中央的主要人物」 — [panelModel.ts:93-94, 144-145](../../src/ui/panelModel.ts)、[types.ts:154-155](../../src/types.ts)
- 程式碼註解已經承認，美體的 pose 選「最大、最置中」的人，臉部 tracker 選「它自己的第一張臉」，**團體照裡兩者可能不同**。所以瘦臉背景限制會先檢查遮罩是否覆蓋這張臉（至少 50%），不覆蓋就不用 — [src/ui/faceProtectModel.ts:53-57](../../src/ui/faceProtectModel.ts)
- 各效果在團體照裡的作用範圍（依 shader 判讀）：
  - **磨皮**：偵測到臉時，P0 臉部遮罩（臉部輪廓內 = 1，外圈羽化）會限制磨皮範圍，**只有被偵測的那張臉會磨皮** — [src/engine/passes/mask.ts:1-2](../../src/engine/passes/mask.ts)、[src/engine/shaders/composite.ts:166-171](../../src/engine/shaders/composite.ts)、[pipeline.ts:102-107](../../src/engine/pipeline.ts)
  - **紅潤**：乘上同一個膚色權重 p，所以也只作用在那張臉 — [composite.ts:191-194](../../src/engine/shaders/composite.ts)
  - **美白、銳化、濾鏡**：沒有遮罩，作用在整張圖 — [composite.ts:173-189, 196-199](../../src/engine/shaders/composite.ts)
  - **沒偵測到臉，或開了「對齊 GPUPixel」**：不跑遮罩 pass，磨皮改成作用在全圖所有膚色像素 — [pipeline.ts:102-107](../../src/engine/pipeline.ts)
- 美型（變形）和美妝都只依這一張臉的 111 點 landmark 繪製 — [types.ts:116-130, 276-284](../../src/types.ts)
- 增高帶是對整張圖的某段橫列做拉伸，同一高度的所有人、背景都會被拉長 — [types.ts:97-107](../../src/types.ts)
- 編輯器沒偵測到臉時顯示「未偵測到臉部，僅套用美膚與濾鏡」 — [Editor.tsx:250, 789-796](../../src/ui/screens/Editor.tsx)

### Inferences
- 依上面的作用範圍推論，三人以上的團體照會變成：只有一個人有磨皮、紅潤、臉型、美妝，其他人只吃到美白、銳化、濾鏡，所以膚質不一致。美體最多只「看到」2 個人，第 3 人以後連 people 計數都不會反映（上限 2）。
- 要做「選臉／選人」，至少要改：
  - tracker.ts 的 `numFaces`，以及 `toLandmarks` 只取 `faces[0]` 的寫法
  - bodyTracker.ts 的 `numPoses` 和 `selectPerson`（改成讓使用者選 index）
  - 臉部遮罩、變形、美妝 pass 改成可以處理多張臉，或處理「被選中的那張」
  - `BodyDetection` 和 `HistoryEntry` 的快取欄位，加上被選中的人或臉
  - UI 加上點選畫面中的人或臉的互動（panelModel 已經有 people 欄位可以沿用）
- 臉部和身體各自選人的不一致（faceProtectModel.ts:56）正好是「選人」功能可以一併解決的問題。

### Gaps
- MediaPipe 在 `numFaces: 1` 時回傳的是哪張臉（信心分數最高？面積最大？），程式碼和 repo 文件都沒有說明，本次沒有用團體照實測。
- 沒有確認 PoseLandmarker 在 numPoses 2 下對 3 人以上團體照的實際行為。

---

## 5. 儲存、匯出、離線與隱私

### Takeaway
- **匯出格式**：JPEG，品質 0.92，不帶 EXIF，檔名 `meiyan-YYYYMMDD-HHMMSS.jpg`
- **儲存方式**：透過 iOS 分享選單；不能用時改成長按圖片儲存
- **匯出解析度**：編輯器的匯入長邊上限 2048（畫質等級 L 時 1440），匯出就是這個解析度
- **最近編輯**：存在 IndexedDB，最多 12 筆，可以重新開啟並繼續調整參數（非破壞式）
- **離線**：引擎和模型第一次下載後可以離線使用
- **隱私**：所有處理都在裝置上完成，CSP 只允許連線到自己的網域

### Cited Findings
- 匯出格式、檔名、不帶 EXIF — [src/media/exporter.ts:5-26](../../src/media/exporter.ts)
- 用 `navigator.share({files})` 儲存，失敗時回傳 fallback，畫面改顯示長按儲存 — [exporter.ts:67-86](../../src/media/exporter.ts)、[app.tsx:86-113](../../src/ui/app.tsx)
- 匯入長邊上限：2048，畫質等級 L 時 1440 — [src/ui/flows.ts:7-13](../../src/ui/flows.ts)
- 匯入只能選單張（`accept="image/*"`，沒有 `multiple`），支援 JPEG / PNG / HEIC，並依 EXIF 方向校正 — [flows.ts:50-70](../../src/ui/flows.ts)、[src/media/importer.ts:1-13](../../src/media/importer.ts)
- 編輯器匯出依來源全解析度重新算一次，不受預覽畫質等級影響 — [types.ts:321-322](../../src/types.ts)
- 每次編輯後 400 ms 重新編碼，所以按「儲存」可以立刻開分享選單 — [Editor.tsx:1-3, 58](../../src/ui/screens/Editor.tsx)
- 最近編輯的儲存方式：
  - IndexedDB，資料庫名 `meiyan`，最多 12 筆，超過時刪掉最舊的 — [src/store/history.ts:1, 11-19, 26-63](../../src/store/history.ts)
  - 每筆存原圖（長邊 2048、JPEG 0.9）、縮圖（長邊 360）、參數、美體偵測快取、瘦臉背景限制的遮罩 — [types.ts:379-405](../../src/types.ts)、[Editor.tsx:59-60, 207, 301-306](../../src/ui/screens/Editor.tsx)
  - 重新開啟時用存下的參數還原，可以繼續調整 — [Home.tsx:85-105](../../src/ui/screens/Home.tsx)
- 離線支援：
  - Service worker 預先快取 js/css/html/png/svg — [vite.config.ts:110](../../vite.config.ts)
  - `/mediapipe/` 和 `/models/` 用 CacheFirst 存進 `meiyan-engine-v1` — [vite.config.ts:120-126](../../vite.config.ts)、[src/engine/assets.ts:15](../../src/engine/assets.ts)
  - 美體模型（Pose full）在第一次打開美體分頁時才下載 — [src/ui/services.ts:440-445](../../src/ui/services.ts)、[Editor.tsx:470-477](../../src/ui/screens/Editor.tsx)
  - selfie_segmenter 在第一次調整臉型輪廓、而且還沒有美體遮罩時才下載 — [Settings.tsx:212](../../src/ui/screens/Settings.tsx)
- 隱私：
  - 首頁和設定都寫「所有影像處理都在你的裝置上完成，照片不會上傳。」 — [Home.tsx:236-239](../../src/ui/screens/Home.tsx)、[Settings.tsx:25](../../src/ui/screens/Settings.tsx)
  - CSP 設定 `connect-src 'self'`，沒有第三方連線 — [vercel.json](../../vercel.json)
  - MediaPipe 固定用 0.10.35，因為 1.x 有無法關閉的遙測 — [spec:38](../../docs/superpowers/specs/2026-10-07-meiyan-pwa-design.md)
- 沒有帳號、沒有雲端同步（spec v1 不做） — [spec:48](../../docs/superpowers/specs/2026-10-07-meiyan-pwa-design.md)

### Inferences
- 相機拍照的實際輸出大小，推算約為 1080×1440（直式 1080 寬、裁成 3:4）。這是依 ideal 1920×1080 和比例裁切推算的，iPhone 實際給的串流尺寸可能不同。
- 「最近編輯」只有 12 筆，而且存在瀏覽器裡，清除網站資料或換網域（例如改 Vercel 網址）就會消失。

### Gaps
- iPhone 實機的相機串流尺寸和匯出檔大小，沒有實測。

---

## 6. 明確不支援的功能（依程式碼搜尋確認）

### Takeaway
目前**沒有**這些功能：
- 裁切 / 旋轉工具
- 貼紙、文字、馬賽克
- 祛痘 / 祛瑕疵、黑眼圈、法令紋、白牙、亮眼
- 眼妝、眉、睫毛、修容、高光
- 亮度、對比、飽和、色溫、曝光、暗角、顆粒等基本調整
- 背景虛化或替換
- 拼圖 / 模板
- 錄影
- 多臉
- 批次匯入
- 液化 / 手動筆刷
- 橫式介面
- 帳號 / 雲端

### Cited Findings
- spec 的 v1 刻意不做清單：
  - video recording、stickers
  - live-camera body reshaping、green screen
  - 亮眼 / 祛法令紋 / 祛黑眼圈 / 白牙 / AI 祛瑕疵
  - eye-shadow / brow / liner makeup
  - landscape layout、multi-face
  - Web Worker、WebGPU
  - accounts / cloud sync
  - 來源：[spec:48](../../docs/superpowers/specs/2026-10-07-meiyan-pwa-design.md)
- 用 `git grep -i` 搜尋 `src/`（不含測試檔），以下關鍵字**0 筆**：
  - sticker、貼紙、文字、mosaic、馬賽克
  - 祛痘、痘、acne、blemish、牙、黑眼圈、法令、頭髮
  - collage、拼圖、模板、錄影、MediaRecorder
  - brightness、亮度、contrast、對比度、saturation、飽和、exposure、曝光、temperature、色溫、vignette、暗角、grain、顆粒
  - eyeliner、眼線、eyeshadow、眼影、修容、高光、睫毛
  - selectFace
  - 來源：本次搜尋（指令見筆記作者紀錄）
- 有命中、但不是對應功能的關鍵字：
  - crop：只有增高帶的 `HEIGHT_MAX_CROP` 和測試用的 synthetic 資料 — [src/body/bands.ts:83](../../src/body/bands.ts)
  - rotate：只有幾何函式和匯入時的 EXIF 方向處理 — [src/body/geom.ts:27](../../src/body/geom.ts)、[importer.ts:74-75](../../src/media/importer.ts)
  - teeth：是設定齒輪圖示的程式碼 — [src/ui/icons.tsx:4-7](../../src/ui/icons.tsx)
  - eyebrow：是 GPUPixel 臉部 mesh 的三角形註解 — [src/engine/passes/faceMesh.ts:64](../../src/engine/passes/faceMesh.ts)
- 相機的比例（3:4 / 1:1 / 9:16）只在拍攝時裁切，編輯器沒有裁切工具 — [Camera.tsx:196-197](../../src/ui/screens/Camera.tsx)；Editor.tsx 裡沒有 crop 相關程式碼（見上方搜尋）
- 匯入一次只能選一張 — [flows.ts:50-63](../../src/ui/flows.ts)
- 研究報告把「液化與 Restore 筆刷」、multiclass 遮罩（衣物、長髮）列為之後的 P3 品質項目，目前沒有實作 — [reports/全身美體修圖 PWA 實作.md:147](../../reports/全身美體修圖%20PWA%20實作.md)
- 介面只支援直式 — [index.html:19-27](../../index.html)

### Inferences
- 跟醒圖比較時，以上每一項都可以直接標成「MonaLisa 沒有」。研究其他功能的人應該特別留意醒圖在「五官細項、祛瑕疵類、基本調整、貼紙文字、背景、模板」這幾類的覆蓋範圍。

### Gaps
- 搜尋是關鍵字比對，理論上可能漏掉命名不同的實作。不過 ParamId 型別（[types.ts:8-34](../../src/types.ts)）已經完整列出所有可調參數，可以當作權威清單。

---

## 7. 名稱與品牌出現的位置（之後改名用）

### Takeaway
「MonaLisa」對使用者可見的位置大約 8 處：
- HTML title 和 apple-web-app-title
- PWA manifest 的 name / short_name
- 首頁字標
- WebGL2 錯誤訊息
- 設定頁尾
- NOTICE 和 bench 頁

另外內部識別名稱用的是 `meiyan`：IndexedDB、localStorage、Cache 名稱、匯出檔名前綴。改內部名稱會讓已安裝使用者的紀錄和設定消失，要分開處理。

### Cited Findings（以 HEAD 5edc4e1 為準）
- 使用者可見：
  - `index.html:10` `apple-mobile-web-app-title` = "MonaLisa"
  - `index.html:15` `<title>MonaLisa 美顏</title>` — [index.html](../../index.html)
  - `vite.config.ts:92-93` manifest `name: 'MonaLisa 美顏'`、`short_name: 'MonaLisa'` — [vite.config.ts](../../vite.config.ts)
  - `src/ui/screens/Home.tsx:126` 字標 `MonaLisa<em>美顏</em>` — [Home.tsx](../../src/ui/screens/Home.tsx)
  - `src/ui/app.tsx:46` 「MonaLisa 美顏需要 WebGL2…」（工作目錄裡已改成「Mona Misa 美顏」） — [app.tsx](../../src/ui/app.tsx)
  - `src/ui/screens/Settings.tsx:161` 頁尾「MonaLisa 美顏 · 版本」 — [Settings.tsx](../../src/ui/screens/Settings.tsx)
  - `LICENSES/NOTICE.txt:1`（會隨 build 輸出到 `/licenses/`，[vite.config.ts:69-74](../../vite.config.ts)）
  - `bench.html:7`、`src/bench/main.ts:170`「MonaLisa Bench」
- 只出現在註解或測試：
  - `src/ui/theme.css:1`
  - `tests/e2e/home.spec.ts:5`
  - `tests/e2e/update.spec.ts:121, 190, 204, 230, 257, 294`：斷言頁尾文字「MonaLisa 美顏 · 版本」，改名時必須一起改
- 內部識別名稱 `meiyan`：
  - `package.json` name `meiyan-pwa`
  - IndexedDB `DB_NAME = 'meiyan'` — [history.ts:15](../../src/store/history.ts)
  - localStorage `meiyan.params.v1` / `meiyan.prefs.v1` / `meiyan.version.v1` — [settings.ts:10-11, 86](../../src/store/settings.ts)
  - Cache `meiyan-engine-v1` — [assets.ts:15](../../src/engine/assets.ts)、[vite.config.ts:126](../../vite.config.ts)
  - 匯出檔名 `meiyan-YYYYMMDD-HHMMSS.jpg`（使用者在相簿裡看得到） — [exporter.ts:8-14](../../src/media/exporter.ts)
  - `window.__meiyan` debug 狀態 — [types.ts:423-426](../../src/types.ts)
  - console 前綴 `[meiyan]`、vite plugin 名稱 `meiyan-*` — [vite.config.ts:25, 55, 69](../../vite.config.ts)
- App 圖示是蛋形臉部線條，沒有文字或字母，改名不用重畫 — [scripts/gen-icons.mjs:3](../../scripts/gen-icons.mjs)
- 「美顏」二字也出現在一般文案中，不屬於品牌名，例如「美顏引擎已就緒」、相機面板的「美顏」叫回按鈕 — [src/ui/format.ts:12-17](../../src/ui/format.ts)、[Camera.tsx:385](../../src/ui/screens/Camera.tsx)
- docs/、reports/、research_notes/ 裡也有大量「MonaLisa」，屬於開發文件

### Inferences
- 只改使用者可見的名稱（title、manifest、字標、頁尾、NOTICE、e2e 斷言）風險低。
- 不要改 `meiyan` 這組儲存鍵和 Cache 名稱，否則已安裝使用者的「最近編輯」和設定會讀不到。
- manifest 的 name 改了以後，iOS 上已安裝的主畫面圖示名稱不會自動更新，需要使用者重新加入主畫面。這是一般 iOS PWA 的行為，本次沒有實測。
- 使用者的 Vercel 正式網址是 `mona-lisa-jeff-s-projects7.vercel.app`（來自使用者的記憶檔，不在 repo 內）。如果改名時一併改 Vercel 專案名稱，網址會變，IndexedDB 和 localStorage 都綁定網域，舊紀錄會留在舊網址。

### Gaps
- 不確定使用者要的新名稱是否包含「美顏」副名（例如「Mona Misa 美顏」或只用「Mona Misa」）。工作目錄裡正在進行的改動用的是「Mona Misa 美顏」。
