// Shared contracts. Every module depends on these types, never on another module's internals.
// See docs/superpowers/specs/2026-10-07-meiyan-pwa-design.md (spec) and the research brief (RB).

// ───────────────────────── Parameters ─────────────────────────

export type ParamGroup = 'skin' | 'shape' | 'body' | 'filter' | 'makeup';

export type ParamId =
  | 'skin.smooth'
  | 'skin.whiten'
  | 'skin.rosy'
  | 'skin.sharpen'
  | 'shape.eyeEnlarge'
  | 'shape.eyeDistance'
  | 'shape.faceSlim'
  | 'shape.faceV'
  | 'shape.faceNarrow'
  | 'shape.chin'
  | 'shape.forehead'
  | 'shape.noseSlim'
  | 'shape.mouthSize'
  | 'body.legs'
  | 'body.slim'
  | 'body.waist'
  | 'body.whr'
  | 'body.hip'
  | 'body.legSlim'
  | 'body.arms'
  | 'body.shoulder'
  | 'body.neck'
  | 'body.head'
  | 'filter.amount'
  | 'makeup.lip'
  | 'makeup.blush';

export interface ParamDef {
  id: ParamId;
  /** 繁體中文 UI label, e.g. 磨皮 */
  label: string;
  group: ParamGroup;
  /** true → neutral at 0.5, UI shows −50…+50 */
  bidirectional: boolean;
  /** first-launch value (= 自然 preset), 0..1 */
  default: number;
  /** icon key for ui/icons.tsx */
  icon: string;
}

export type PresetId = 'original' | 'natural' | 'refined' | 'glow';

export interface PresetDef {
  id: PresetId;
  /** 原圖 / 自然 / 精緻 / 氣色 */
  label: string;
  values: Record<ParamId, number>;
  filterId: string;
  lipShade: string | null;
  blushShade: string | null;
}

export interface FilterDef {
  /** 'none' or a LUT id; LUT at /luts/filters/<id>.png, thumbnail at /luts/filters/<id>_thumb.png */
  id: string;
  label: string;
  /** filter.amount applied when this filter is picked, 0..1 */
  defaultAmount: number;
}

export interface ShadeDef {
  id: string;
  label: string;
  /** '#RRGGBB'; null = keep GPUPixel's original texture colour (原色) */
  color: string | null;
}

export interface BeautyParams {
  /** every ParamId present; 0..1 */
  values: Record<ParamId, number>;
  /** 'none' or FilterDef.id */
  filterId: string;
  /** ShadeDef.id or null (= 原色 GPUPixel texture) */
  lipShade: string | null;
  blushShade: string | null;
  /** preset the values came from, or 'custom' after any manual edit */
  presetId: PresetId | 'custom';
  /** 程度: scales each param's distance from neutral, 0..1 */
  presetAmount: number;
  /** 背景保護: constrain body displacement to the feathered person mask (default true) */
  bodyProtect: boolean;
  /** manual 增高 band (works without pose detection); null = off */
  heightBand: HeightBand | null;
}

/**
 * Manual height band: vertical stretch of the image rows between top and bottom (normalized y, top-left origin).
 * top/bottom are SOURCE rows: in the output the band runs from top to top + (bottom − top)·S, and the content
 * below moves down (the frame size is unchanged, so up to 8 % is pushed off the bottom edge).
 */
export interface HeightBand {
  top: number;
  bottom: number;
  /** 0..1 → stretch S = 1 + min(0.15·amount, 0.08 / (bottom − top)) inside the band (src/body/bands.ts heightBandStretch) */
  amount: number;
}

// ───────────────────────── Tracking ─────────────────────────

/** Raw MediaPipe output for one face: 478 × (x, y, z); x,y normalized, top-left origin, UNMIRRORED frame. */
export interface Landmarks478 {
  points: Float32Array; // length 478 * 3
}

/** Adapted face, ready for the engine. All coordinates normalized [0,1], top-left origin (= texture UV). */
export interface Face {
  /** GPUPixel 111-point layout (RB §2.7), length 222 */
  pts111: Float32Array;
  /**
   * Extension anchors (MediaPipe-only), length 16 = 8 × vec2, fixed order:
   * 0 forehead-top(10) 1 forehead(151) 2 glabella(9) 3 nasion(168) 4 menton(152)
   * 5 chin(199) 6 cheekbone-L(234) 7 cheekbone-R(454)
   */
  ext: Float32Array;
  /** FACE_OVAL polygon (36 points, MediaPipe order), length 72 */
  oval: Float32Array;
  /** yaw proxy in −1..1 (0 = frontal), RB §2.4 */
  yaw: number;
}

export type Delegate = 'GPU' | 'CPU';

// ───────────────────────── Body (美體) ─────────────────────────

/** MediaPipe PoseLandmarker output for one person: 33 × (x, y, z, visibility); x,y normalized, top-left, UNMIRRORED. */
export interface Pose33 {
  points: Float32Array; // length 33 * 4
}

/** Person segmentation of the selected person, downscaled (≈256 long edge). */
export interface PersonMask {
  width: number;
  height: number;
  /** 0..255 person confidence, row-major, row 0 = image top */
  data: Uint8Array;
}

/** One body detection on a still image (cached in history so reopening needs no pose model). */
export interface BodyDetection {
  pose: Pose33;
  /** null when segmentation was unavailable */
  mask: PersonMask | null;
  /** people detected (≥ 2 → only the largest / most central is edited, UI shows a hint) */
  people: number;
  /** pixel size of the image the normalized coordinates refer to (for aspect) */
  width: number;
  height: number;
}

export type BodyRegion = 'head' | 'shoulder' | 'arms' | 'torso' | 'legs';

export interface RegionStatus {
  ok: boolean;
  /** 繁體中文 reason shown when disabled (e.g. 拍攝全身照可使用長腿／瘦腿) */
  reason: string | null;
}

/**
 * Low-resolution BACKWARD displacement field in UV units (RG): the engine samples
 * src at uv + field(uv) as the outermost mapping of the P2 reshape pass (body research report).
 */
export interface BodyField {
  width: number;
  height: number;
  /** width*height*2 floats, row 0 = image top */
  data: Float32Array;
  /** increment whenever data changes (engine re-uploads on change) */
  version: number;
}

export interface BodyTracker {
  readonly variant: 'full' | 'lite';
  readonly delegate: Delegate;
  /**
   * IMAGE mode (photo editor). Returns null when no person. Throws BodyTrackerRecovering (retry shortly) while a
   * lost, aborted or failing graph is being replaced; throws BodyTrackerUnavailable (not a recovering error: show it)
   * while there is no replacement (creating one failed, or the replacement cap since the last completed detection
   * was reached) and the retry backoff (5 s, doubling to 60 s) has not elapsed — a 重試 after that makes one new
   * attempt, so detection comes back once memory does. After any other throw the graph is rebuilt on the next call.
   */
  detect(image: ImageBitmap | HTMLCanvasElement): BodyDetection | null;
  /** VIDEO mode (bench / future live): tsMs strictly increasing */
  detectVideo(video: HTMLVideoElement, tsMs: number): BodyDetection | null;
  close(): void;
}

export interface BodyTrackerOptions {
  modelBuffer: Uint8Array;
  /** e.g. '/mediapipe/0.10.35' */
  wasmBase: string;
  variant: 'full' | 'lite';
  /**
   * default 'CPU'; only honoured when outputMask is false. In tasks-vision 0.10.35 the CPU graph aborts the wasm
   * when segmentation masks are on, so with masks the tracker runs the GPU graph (read synchronously — masks read
   * inside the callback come back empty, MPI 4757) and falls back to CPU without masks. BodyTracker.delegate
   * reports what actually runs.
   */
  delegate?: Delegate;
  runningMode?: 'IMAGE' | 'VIDEO';
  /** default true */
  outputMask?: boolean;
}

export interface Tracker {
  /** Delegate of the current graph; re-read it on onStateChange('ok'): a rebuild under 'auto' may fall back to CPU. */
  readonly delegate: Delegate;
  /**
   * VIDEO mode; tsMs must be strictly increasing. Returns null when no face, and also while the
   * tracker is recovering (lost GL context / rebuild throttle). Throws on inference failure: the
   * tracker rebuilds its graph on the next call.
   */
  detectVideo(video: HTMLVideoElement, tsMs: number): Landmarks478 | null;
  /**
   * IMAGE mode on the same instance; the next detectVideo call switches back to VIDEO (one graph
   * rebuild per switch). Null / throw semantics as detectVideo.
   */
  detectImage(image: ImageBitmap | HTMLCanvasElement | HTMLImageElement): Landmarks478 | null;
  close(): void;
}

/**
 * Self-healing tracker state (RB §3 Fallbacks 5): 'lost' = the graph is dead (GL context lost or
 * repeated inference failures) and a new instance is being created; 'ok' = a new instance took
 * over; 'failed' = automatic retries gave up (a later detect call or return to foreground retries).
 */
export type TrackerState = 'lost' | 'ok' | 'failed';

export interface TrackerOptions {
  /** face_landmarker.task bytes */
  modelBuffer: Uint8Array;
  /** e.g. '/mediapipe/0.10.35' */
  wasmBase: string;
  /** 'auto' tries GPU then CPU */
  delegate: 'auto' | Delegate;
  /** Called on recovery state transitions (never for the initial creation). */
  onStateChange?: (state: TrackerState) => void;
}

// ───────────────────────── Engine ─────────────────────────

export type Tier = 'H' | 'M' | 'L';

export interface EngineOptions {
  /** mirror X on present (front-camera preview) */
  mirror: boolean;
  /** true → disable the P0 face mask so skin matches GPUPixel exactly */
  matchGpupixel: boolean;
  /** debug: draw the 111 adapted points over the output */
  showLandmarks: boolean;
}

export interface RenderInput {
  source: TexImageSource;
  /** source pixel size (video.videoWidth/Height or bitmap size) */
  width: number;
  height: number;
  face: Face | null;
  /** 0..1, scales all landmark-driven effects (eased by caller on face gain/loss) */
  faceWeight: number;
  params: BeautyParams;
  /** body displacement field (美體); null/undefined = none */
  body?: BodyField | null;
}

export interface RenderStats {
  /** CPU-side time spent issuing the frame, ms */
  cpuMs: number;
  /** processing resolution actually used */
  width: number;
  height: number;
  passes: string[];
}

export interface Engine {
  readonly canvas: HTMLCanvasElement;
  /**
   * Resolves when static textures (GPUPixel LUTs, makeup) are uploaded; a makeup load failure only disables makeup.
   * Replaced by a new promise when a lost context is restored, so re-read it after webglcontextrestored.
   */
  readonly ready: Promise<void>;
  setTier(tier: Tier): void;
  readonly tier: Tier;
  setOptions(opts: Partial<EngineOptions>): void;
  /** Make a filter LUT available (lazy-loaded on first use); resolves when uploaded. */
  loadFilter(filterId: string): Promise<void>;
  /**
   * Render to the display canvas at processing resolution.
   * Live: processing short edge = tier (H 1080 / M 720 / L 540, never above source).
   * Still (opts.still): processing size = source size.
   */
  render(input: RenderInput, opts?: { still?: boolean }): RenderStats;
  /** Render offscreen at full source resolution (ignores tier) and read back. Mirror per `mirror`. */
  renderToImageData(input: RenderInput, opts: { mirror: boolean }): ImageData;
  /** Draw the unprocessed source to the display canvas (hold-to-compare). */
  renderOriginal(input: Pick<RenderInput, 'source' | 'width' | 'height'>, opts?: { still?: boolean }): void;
  /** true after webglcontextlost until recreated */
  readonly lost: boolean;
  dispose(): void;
}

export interface EngineAssetsProgress {
  loaded: number;
  /** may be 0 when unknown */
  total: number;
  phase: 'model' | 'wasm' | 'done';
}

// ───────────────────────── Media ─────────────────────────

export type Facing = 'user' | 'environment';

export type CameraState = 'idle' | 'starting' | 'live' | 'interrupted' | 'error';

export type CameraErrorKind = 'denied' | 'notfound' | 'insecure' | 'inuse' | 'black' | 'unknown';

export interface CameraSnapshot {
  state: CameraState;
  facing: Facing;
  error: CameraErrorKind | null;
  width: number;
  height: number;
}

export interface CameraController {
  /** hidden-but-rendered <video playsinline muted autoplay> owned by the controller */
  readonly video: HTMLVideoElement;
  readonly snapshot: CameraSnapshot;
  /** must be called from a user gesture on iOS */
  start(facing?: Facing): Promise<void>;
  /** user gesture: recover from 'interrupted' */
  resume(): Promise<void>;
  flip(): Promise<void>;
  stop(): void;
  subscribe(cb: (s: CameraSnapshot) => void): () => void;
}

export type SaveResult = 'shared' | 'cancelled' | 'fallback';

// ───────────────────────── Store ─────────────────────────

export interface Prefs {
  mirrorOnSave: boolean;
  tier: 'auto' | Tier;
  matchGpupixel: boolean;
  showLandmarks: boolean;
  delegate: 'auto' | 'CPU';
  installHintDismissed: boolean;
}

export interface HistoryEntry {
  id: string;
  createdAt: number;
  updatedAt: number;
  /** downscaled original, JPEG */
  original: Blob;
  /** small JPEG thumbnail of the edited result */
  thumb: Blob;
  params: BeautyParams;
  width: number;
  height: number;
  /**
   * cached 美體 detection for this photo: null = checked, nobody in the photo; absent = never checked (older
   * entries too). A body-only updateEntry leaves updatedAt alone, so caching it does not reorder 最近編輯.
   */
  body?: BodyDetection | null;
}

// ───────────────────────── Debug ─────────────────────────

export interface DebugState {
  fps: number;
  detectMs: number;
  renderMs: number;
  tier: Tier;
  delegate: Delegate | null;
  face: boolean;
  screen: string;
  cameraState: CameraState;
  lastError: string | null;
  /** 有新版本 state (ui/updateModel.ts); absent until a service worker reports one */
  update?: 'idle' | 'available' | 'applying';
}

declare global {
  interface Window {
    __meiyan?: DebugState;
  }
}
