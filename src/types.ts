// Shared contracts. Every module depends on these types, never on another module's internals.
// See docs/superpowers/specs/2026-10-07-meiyan-pwa-design.md (spec) and the research brief (RB).

// ───────────────────────── Parameters ─────────────────────────

export type ParamGroup = 'skin' | 'shape' | 'body' | 'filter' | 'makeup' | 'adjust' | 'tone';

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
  | 'shape.jawline'
  | 'shape.temple'
  | 'shape.hairline'
  | 'shape.noseWing'
  | 'shape.noseBridge'
  | 'shape.mouthHeight'
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
  | 'makeup.blush'
  | 'makeup.brow'
  | 'makeup.eyeshadow'
  | 'makeup.liner'
  | 'makeup.lashes'
  | 'makeup.aegyo'
  | 'makeup.contour'
  | 'makeup.highlight'
  | 'makeup.lens'
  // 調節 (v0.4 step 2): photo-level, live, neutral by default, outside every beauty preset
  | 'adjust.brightness'
  | 'adjust.exposure'
  | 'adjust.contrast'
  | 'adjust.highlights'
  | 'adjust.shadows'
  | 'adjust.temperature'
  | 'adjust.tint'
  | 'adjust.saturation'
  | 'adjust.vibrance'
  | 'adjust.fade'
  | 'adjust.grain'
  | 'adjust.vignette'
  // 膚質 (v0.4 step 4): person-level face items, editor-only, neutral by default and in every beauty preset
  | 'tone.even'
  | 'tone.warmth'
  | 'tone.darkCircle'
  | 'tone.nasolabial'
  | 'tone.teeth'
  | 'tone.eyeBright';

export type ParamScope = 'photo' | 'person';

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
  /** which layer the value lives in (RM §3.1): the whole photo, or each person */
  scope: ParamScope;
  /** offered in the live camera */
  live: boolean;
  /** 左右分開: the item can be set per side of the face (face-detail spec §3.1); absent = both sides alike */
  split?: true;
}

/** the 12 調節 items (v0.4 step-2 spec §3.1) */
export type AdjustId = Extract<ParamId, `adjust.${string}`>;

/** 一鍵 › 質感 looks (v0.4 roadmap §3.2) */
export type LookId = 'film' | 'ccd' | 'flash' | 'blue' | 'cinema';

export interface LookDef {
  id: LookId;
  /** 膠片 · CCD · 直閃 · 藍調 · 電影感 */
  label: string;
  /** 程度 when the look is picked from 無 (0..1) */
  defaultAmount: number;
  /** at 程度 100, in display units (−50…+50 bidirectional, 0–100 one-way); scaled by 程度 in shader space */
  offsets: Readonly<Partial<Record<AdjustId, number>>>;
}

/** engine LUT kinds: 濾鏡 /luts/filters/<id>.png, 質感 /luts/looks/look_<id>.png */
export type LutKind = 'filter' | 'look';
/** none = not resident (never asked, or evicted / dropped with a lost context) */
export type LutState = 'none' | 'loading' | 'ready' | 'failed';

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
  /**
   * 背景保護: constrain body displacement to the feathered person mask (default true). Measured effect: a narrower
   * background deformation ring beside the person; line bend about the same as off (src/body/straightness.test.ts)
   */
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
/** 祛痘 spot (skin-cleanup spec §3.2; replaces C §3.2's Spot). Photo-level, stored in EditState.photo.spots. */
export interface Spot {
  /** O-space centre, normalized by W_O and H_O (top-left origin) */
  x: number;
  y: number;
  /** radius, fraction of the O short edge */
  r: number;
  /** donor offset, fraction of the O short edge (isotropic); dx = dy = 0 → fill mode (no donor found) */
  dx: number;
  dy: number;
  /** the person whose face region (else body mask) held the centre when it was tapped; null = elsewhere */
  owner: PersonId | null;
}
/** 祛痘 大小 小／中／大 */
export type SpotSize = 'S' | 'M' | 'L';

// ───────────────────────── v0.4 edit model (RM §3.2, step-1 subset) ─────────────────────────

export type PhotoParamId = Extract<ParamId, 'skin.whiten' | 'skin.sharpen' | 'filter.amount' | 'body.legs' | `adjust.${string}`>;
export type PersonParamId = Exclude<ParamId, PhotoParamId>;
export type SplitParamId = Extract<
  ParamId,
  'shape.eyeEnlarge' | 'shape.faceSlim' | 'shape.faceV' | 'shape.faceNarrow' | 'shape.jawline' | 'shape.temple'
>;
export type ShadePart = 'lip' | 'blush' | 'brow' | 'eyeshadow' | 'liner' | 'lens';
/** the ten 美妝 parts (face-detail spec §3.3); lives here (not in panelModel.ts) so engine code can use it */
export type MakeupPart = ShadePart | 'lashes' | 'aegyo' | 'contour' | 'highlight';
/**
 * 'f0'…'f5' a person first built from a face, 'b0'…'b3' from a body, 'p0' the implicit person while nobody is known,
 * 'live' the camera. Immutable once persisted (a person keeps its id when it gains a face or a body).
 */
export type PersonId = string;
export interface PresetRef {
  id: PresetId;
  amount: number;
}
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface Size {
  width: number;
  height: number;
}

/** step-3 spec §3.1. O → E is flipH, then `quarter` clockwise quarter turns; V is the crop of E straightened by θ. */
export interface Geometry {
  flipH: boolean;
  /** clockwise quarter turns, applied after flipH (旋轉 turns counter-clockwise: quarter' = (quarter + 3) % 4) */
  quarter: 0 | 1 | 2 | 3;
  /** degrees, −45…45, rounded to 0.1, about the E-frame centre; positive turns the picture clockwise on screen */
  straighten: number;
  /** in the straighten plane, normalized to the E frame; axis-aligned in the view; every corner inside the straightened image and inside [0,1]² */
  crop: Rect;
}

/** integer pixel rectangle (tile planner, readback) */
export type PxRect = Rect;
/** C §3.2 / push-brush spec §3.2. Immutable once committed. */
export interface Stroke {
  /** unique within the photo; also the stroke's equality key in editKey (C §3.4) */
  id: string;
  kind: 'push' | 'restore';
  /** brush radius, fraction of the frame's short edge (S units), clamped to [rMin(frame), R_MAX] */
  radius: number;
  /** per-stamp gain: PUSH_GAIN or RESTORE_GAIN when it was drawn, stored so retuning the constants never changes old photos */
  strength: number;
  /**
   * O-frame (x, y) pairs, 2…MAX_STROKE_POINTS pairs. Consecutive points are radius/4 apart in S units (to Float32
   * rounding), except the last gap, which is in [radius/8, radius/4). A continuation record starts with its
   * predecessor's last point.
   */
  points: Float32Array;
}
export type BrushKind = Stroke['kind'];
export type BrushSize = 's' | 'm' | 'l';
export interface PhotoParams {
  values: Record<PhotoParamId, number>;
  filterId: string;
  /** 一鍵 › 質感 (C §3.4): a look and its 程度, or null (無) */
  look: { id: LookId; amount: number } | null;
  /** the photo part of the last beauty preset, while 美白 / 銳化 / 濾鏡 are untouched since (RM §3.4) */
  presetLink: PresetRef | null;
  bodyProtect: boolean;
  heightBand: HeightBand | null;
  /** the person 長腿 is measured on; null = the primary person */
  legsAnchor: PersonId | null;
  /** crop, rotate, straighten, flip (step 3); photo-level, identity by default */
  geometry: Geometry;
  /** 祛痘 spots, at most SPOT_CAP (skin-cleanup spec §3.2, C §5.3) */
  spots: readonly Spot[];
  /** 推臉筆 records in replay order (push-brush spec §3.2); photo-level, one may cross several persons */
  strokes: readonly Stroke[];
}
export interface PersonParams {
  values: Record<PersonParamId, number>;
  /** 左右分開 (face-detail spec §3.4): GPUPixel-right values of the split items; null = both sides alike */
  right: Partial<Record<SplitParamId, number>> | null;
  /** ShadeDef ids, or null for 原色 (眼線: null reads as 黑) */
  shades: Record<ShadePart, string | null>;
  preset: PresetRef | 'custom';
}
/** The undoable, persisted edit of one photo. Immutable: every change returns a new object sharing unchanged parts. */
export interface EditState {
  v: 2;
  photo: PhotoParams;
  persons: Readonly<Record<PersonId, PersonParams>>;
  /** params for persons who first appear later */
  template: PersonParams;
  /** the look meant for the primary person; seeds `p0`, consumed by the first assignPersons, then null */
  primaryInit: PersonParams | null;
}
export type Selection = { kind: 'all' } | { kind: 'person'; id: PersonId };
/** what the camera keeps (persisted as meiyan.look.v1): only `live` items are meaningful */
export interface CameraLook {
  photo: PhotoParams;
  person: PersonParams;
}
/** camera → editor: the beautified face's centre in the saved image, 'all' under 全部套用, null = no face seen */
export type FaceSeed = { x: number; y: number } | 'all' | null;

/** raw 478×3 MediaPipe landmarks in O-space (adapt() derives Face on load); box = oval bbox */
export interface CachedFace {
  id: string;
  lm: Float32Array;
  box: Rect;
}
/** a face dropped by the size filter or the cap: no effects, but it bounds its neighbours' caps (≈ 300 B) */
export interface CachedObstacle {
  box: Rect;
  /** the 36-point FACE_OVAL, O-space, length 72 */
  oval: Float32Array;
}
export interface CachedBody {
  id: string;
  pose: Pose33;
  mask: PersonMask | null;
  /** selectPerson's area × centrality */
  score: number;
}
export interface PersonInfoCached {
  id: PersonId;
  face: string | null;
  body: string | null;
}
export interface DetectionCache {
  v: 1;
  /** pixel size of the image the normalized coordinates were taken on (aspect check) */
  width: number;
  height: number;
  /** step 1 writes [{quarter: 0, flipH: false}] after a definite answer, [] in 基本模式 */
  faceScans: { quarter: 0 | 1 | 2 | 3; flipH: boolean }[];
  /** O-space, sorted by box centre x then y */
  faces: CachedFace[];
  obstacles: CachedObstacle[];
  /** null = 美體 detection not run yet */
  bodies: CachedBody[] | null;
  /** false for a v0.3 cache with people ≥ 2: the others are unknown */
  bodiesComplete: boolean;
  /** quarters the 美體 detection ran in (step-3 spec §3.6, D5); absent = [0] */
  bodyScans?: (0 | 1 | 2 | 3)[];
  /** display order: left to right when first built, later persons appended */
  persons: PersonInfoCached[];
  primary: PersonId;
  dropped: { tooSmall: number; overCap: number };
}
/** BodyTracker.detect result: every person (BodyDetection stays the v1 storage shape) */
export interface BodyDetections {
  bodies: { pose: Pose33; mask: PersonMask | null; score: number }[];
  width: number;
  height: number;
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
  /** MediaPipe 468–477 (x, y): [0..9] = 468 centre + 469–472 (GPUPixel-left eye), [10..19] = 473 + 474–477 */
  iris: Float32Array;
  /**
   * MediaPipe eye contours (x, y), 16 points per eye: outer corner, 7 upper (outer → inner), inner corner, 7 lower
   * (outer → inner). [0..31] GPUPixel-left eye = MP 33, 246, 161, 160, 159, 158, 157, 173, 133, 7, 163, 144, 145, 153,
   * 154, 155; [32..63] GPUPixel-right eye = MP 263, 466, 388, 387, 386, 385, 384, 398, 362, 249, 390, 373, 374, 380,
   * 381, 382 (FaceLandmarker's RIGHT_EYE / LEFT_EYE contours; face-detail spec §3.3)
   */
  lids: Float32Array;
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
/** 推臉筆 field (push-brush spec §3.1): the BodyField layout, backward displacement in O UV units, row 0 = image top */
export type LiquifyField = BodyField;
/** the pixel size whose aspect and short edge the liquify grid is built on (push-brush spec §3.3) */
export interface LiquifyFrame {
  width: number;
  height: number;
}

/**
 * 瘦臉 background limit (src/tracking/faceProtect.ts): signed distance from each texel centre to the person (mask ∪ face
 * oval), in iso units (fractions of the image width), negative inside. The reshape pass turns it into a displacement budget for the face CONTOUR warps only. Immutable once built (a new one gets a new version).
 */
export interface FaceProtect {
  width: number;
  height: number;
  /** width*height floats, row 0 = image top */
  data: Float32Array;
  /** increment whenever data changes (engine re-uploads on change) */
  version: number;
  /** UV rect the grid covers (a per-face window with ≥ 2 faces, S §4.7); absent = the whole photo */
  window?: Rect;
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
   * Answers every person with ≥ 33 points (up to MAX_EDIT_BODIES), each with its own mask; null when nobody.
   */
  detect(image: ImageBitmap | HTMLCanvasElement): BodyDetections | null;
  /** VIDEO mode (bench / future live): tsMs strictly increasing; every person with ≥ 33 points, null when nobody */
  detectVideo(video: HTMLVideoElement, tsMs: number): BodyDetections | null;
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
   * VIDEO mode; tsMs must be strictly increasing. null = no answer (closed, frame not ready, tracker unusable, rebuild
   * throttled); [] = a completed inference without a face (A5). `maxFaces` is required (clamped to 1…EDIT_DETECT_FACES)
   * and travels with the mode in one setOptions: options are sticky, and every change rebuilds the graph. Throws on
   * inference failure: the tracker rebuilds its graph on the next call.
   */
  detectVideo(video: HTMLVideoElement, tsMs: number, opts: { maxFaces: number }): Landmarks478[] | null;
  /**
   * IMAGE mode on the same instance; the next detectVideo switches back. [] = no face, or not known (recovering /
   * unusable): callers keep the health check (editorModel.ts detectSession). Throws as detectVideo.
   */
  detectImage(image: ImageBitmap | HTMLCanvasElement | HTMLImageElement, opts: { maxFaces: number }): Landmarks478[];
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

/** One face of a frame (S §3.2, §4.1). */
export interface RenderFace {
  face: Face;
  /** 0..1, scales this face's landmark-driven effects: 1 in the editor; the track's eased weight in the camera (0 = listed for the caps only) */
  weight: number;
  /** this face's person: 磨皮／紅潤, 美型 and 美妝 (photo-level items come from RenderInput.photo) */
  person: PersonParams;
  /**
   * 瘦臉 background limit of this face's contour warps (photo editor); null = unlimited (today's warp, and the live
   * camera). Only read when the face's warp is drawn.
   */
  protect: FaceProtect | null;
  /** camera: the track's presence easer, scaling its part in its neighbours' caps (S §4.1); absent = 1 */
  presence?: number;
  /** λ_f of the editor's fold safety net (S §4.4): multiplies this face's warp strengths only; absent = 1 */
  warpScale?: number;
}

export interface RenderInput {
  source: TexImageSource;
  /** source pixel size (video.videoWidth/Height or bitmap size) */
  width: number;
  height: number;
  /**
   * ≤ MAX_RENDER_FACES, table order = cache face order, so packing is deterministic; a face whose person is neutral is
   * still listed so its skin mask writes 0 (others untouched) and it bounds its neighbours' caps
   */
  faces: readonly RenderFace[];
  /** box centres (UV) of faces that are not rendered but bound the caps (S §4.1): the editor's obstacles; [] in the camera */
  obstacles?: readonly [number, number][];
  /**
   * all-skin 磨皮／紅潤 at `weight`: the editor when the photo has no face (weight 1), the camera's "no face" fade
   * (A2: 1 − the face weight, so a fading camera face is v0.3's mask exactly); null = the faces only
   */
  globalSkin: { smooth: number; rosy: number; weight: number } | null;
  /** the photo layer: 美白, 銳化, 濾鏡 and the 美體 photo items */
  photo: PhotoParams;
  /** body displacement field (美體); null/undefined = none */
  body?: BodyField | null;
  /** O-space backward map of the 推臉筆 strokes, the outermost map of P2 (push-brush spec §4.1); null / absent = none */
  liquify?: LiquifyField | null;
  /** step 2: the picture rectangle (source UV) that vignette and grain treat as V — the camera's ratio crop; default the whole source */
  pictureFrame?: Rect;
  /** step 2: grain seed; 0 in the editor and exports, a frame counter in the camera */
  grainSeed?: number;
  /** crop / rotate / straighten / flip, applied as the final transform in P2 (step 3); default identity */
  geometry?: Geometry;
  /** O-normalized rect `source` covers (a tile's window); default [0,0,1,1] */
  sourceWindow?: Rect;
  /** a V tile at a given pixel size (renderTile); default: the whole V at the processing size */
  output?: RenderOutput;
  /** the working bitmap's width / height: the iso metric of every face warp; tiles pass it (never the decode's aspect) */
  oAspect?: number;
  /** step 4: the working-resolution image the tone field is built from when `source` is only a tile window */
  toneSource?: { source: TexImageSource; width: number; height: number };
}

/** the V tile a render writes (step 3, C §4.1): V-normalized rect, its pixel size, and the O short edge in output px */
export interface RenderOutput {
  tile: Rect;
  pixelSize: Size;
  /** kernel scale k = fullShortEdge / 720 (C §3.5); the same for the preview, a crop, a tile and the export */
  fullShortEdge: number;
}

/** What a still session renders: the frame without its source, size and body field (the session adds those, S1). */
export type StillFrame = Omit<RenderInput, 'source' | 'width' | 'height' | 'body'>;

export interface RenderStats {
  /** CPU-side time spent issuing the frame, ms */
  cpuMs: number;
  /** processing resolution actually used */
  width: number;
  height: number;
  passes: string[];
  /** the tone field (P0c) was rebuilt by this frame */
  toneBuilt?: boolean;
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
  /** Make a 濾鏡 or 質感 LUT resident (lazy-loaded on first use); resolves when uploaded. An explicit call retries a failed one. */
  loadLut(kind: LutKind, id: string): Promise<void>;
  /**
   * For export readiness ('ready' | 'failed' = settled). 'none' = not resident: never asked, evicted by the LRU cap,
   * or dropped with a lost context. A filter id 'none' (no filter) is 'ready'.
   */
  lutState(kind: LutKind, id: string): LutState;
  /** the 調節 program failed to compile on this context: 調節 and 質感 are not drawn until the context is rebuilt */
  readonly adjustUnavailable: boolean;
  /** true once the procedural makeup program failed to compile on this context (S5 §7): its eight parts are off */
  readonly procMakeupFailed: boolean;
  /**
   * Render to the display canvas at processing resolution.
   * Live: processing short edge = tier (H 1080 / M 720 / L 540, never above source).
   * Still (opts.still): processing size = source size.
   */
  render(input: RenderInput, opts?: { still?: boolean }): RenderStats;
  /** Render offscreen at full source resolution (ignores tier) and read back. Mirror per `mirror`. */
  renderToImageData(input: RenderInput, opts: { mirror: boolean }): ImageData;
  /** Draw the unprocessed source to the display canvas (hold-to-compare), through `geometry` for stills (step 3). */
  renderOriginal(input: Pick<RenderInput, 'source' | 'width' | 'height' | 'geometry'>, opts?: { still?: boolean }): void;
  /**
   * Render `input.output` (a V tile, at its pixelSize) offscreen from `input.source` (the window `sourceWindow`) and read
   * back `read` (buffer pixels, row 0 = top). Synchronous. Throws when the context is unavailable or `output` is missing.
   */
  renderTile(input: RenderInput, read: PxRect): ImageData;
  /** shrink every pipeline buffer and the source texture to 1 × 1 (after a tiled export, before encoding) */
  releaseBuffers(): void;
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

export type ExportFormat = 'jpeg' | 'png';
export type ExportSize = 'full' | 'standard';

export interface Prefs {
  mirrorOnSave: boolean;
  tier: 'auto' | Tier;
  matchGpupixel: boolean;
  showLandmarks: boolean;
  delegate: 'auto' | 'CPU';
  installHintDismissed: boolean;
  /** 設定 › 輸出格式 (step 3); every save, the camera's included */
  exportFormat: ExportFormat;
  /** 設定 › 輸出解析度 (step 3): the stored choice; a block shows 標準 without changing it */
  exportSize: ExportSize;
}

export interface HistoryEntry {
  id: string;
  createdAt: number;
  updatedAt: number;
  /** downscaled original, JPEG */
  original: Blob;
  /** small JPEG thumbnail of the edited result */
  thumb: Blob;
  /** v2: the legacy projection (photo + primary person); v1: the only params */
  params: BeautyParams;
  width: number;
  height: number;
  /**
   * cached 美體 detection for this photo: null = checked, nobody in the photo; absent = never checked (older
   * entries too). A body-only updateEntry leaves updatedAt alone, so caching it does not reorder 最近編輯.
   */
  body?: BodyDetection | null;
  /**
   * the 瘦臉 background limit is requested for this photo (src/ui/faceProtectModel.ts): reopening requests it again,
   * so the same entry renders and exports the same. Sticky: kept also by an edit made while the limit cannot act
   * (contour sliders neutral, no face found, 基本模式, a segmentation in flight). Absent / false = never requested,
   * or the limit settled as impossible for this photo (no segmenter, nobody found): drawn without it (older entries
   * too). Written with every params write; a body-only updateEntry leaves it alone.
   */
  faceProtect?: boolean;
  /** the selfie segmenter's person mask the limit was built from (reopening needs no model); absent = none / 美體's */
  faceMask?: PersonMask;
  /** the full-resolution file as picked (step 3, C §4.6): written once by the add that creates the entry, never patched */
  source?: Blob;
  /** oriented size of the picked file, recorded whenever it exceeded the working edge (also when the file was not kept) */
  sourceWidth?: number;
  sourceHeight?: number;
  /** 2 for entries written by 0.4; absent = v1 (RM §5.1) */
  schema?: 2;
  /** v2 edit (RM §3.2) */
  edit?: EditState;
  /**
   * v2: stableKey(params) as written by 0.4; a mismatch with the stored `params` means 0.3 edited them after a rollback
   * (S §5.3). Checked against the record as stored (normalizeEntry → legacyEdited), never against the sanitized `params`
   * (they gain every param a later build adds).
   */
  paramsKey?: string;
  /** v2 detection cache; written as soon as detection runs (no updatedAt bump) */
  detect?: DetectionCache;
  /** read side only (normalizeEntry), never written: face boxes of a dropped cache's persons, for the rematch */
  staleBoxes?: Record<PersonId, Rect>;
  /** read side only: normalization dropped persons from the cache (the cache-dropped toast) */
  detectLost?: boolean;
  /**
   * read side only: the stored `params` are not what 0.4 wrote with `paramsKey` (0.3 edited the entry after a rollback);
   * the param ids they store a value for, the only values openState takes from them (S §5.3)
   */
  legacyEdited?: readonly ParamId[];
}

// ───────────────────────── Debug ─────────────────────────

export interface DebugState {
  fps: number;
  detectMs: number;
  renderMs: number;
  tier: Tier;
  delegate: Delegate | null;
  face: boolean;
  /** selectable faces (editor) / shown tracks (camera) */
  faces: number;
  persons: number;
  /** selected person id, 'all', or null (no persons / camera) */
  selected: string | null;
  /** face detectImage calls in this page session */
  detectCalls: number;
  /** face boxes, normalized and unmirrored (editor: cache faces; camera: shown tracks) */
  boxes: { id: string; x: number; y: number; w: number; h: number }[];
  /** the last 美體 field's global fold-guard λ (1 = untouched; e2e) */
  lambdaGlobal?: number;
  /** Phase 0: GL limits (always) and probes (bench and dev builds only) */
  gl?: Record<string, number | boolean>;
  screen: string;
  cameraState: CameraState;
  lastError: string | null;
  /** 有新版本 state (ui/updateModel.ts); absent until a service worker reports one */
  update?: 'idle' | 'available' | 'applying';
  /** 推臉筆 (push-brush spec §3.2): written by the editor on commit, sync and rebuild end, not per stamp */
  liquify?: { strokes: number; version: number; work: number; maxDisp: number; pending: boolean };
  /** display frames the still session drew (engine FBO exports do not count): e2e checks 裁切 gestures draw none */
  renderCount?: number;
  /** the last export of the editor, or null while one runs / after an abort */
  export?: { mode: 'working' | 'tiled'; width: number; height: number; tiles: number; ms: number } | null;
  /** 祛痘 spots of the open photo (editor; skin-cleanup spec §3.2) */
  spots: number;
  /** the spot added last in this page session; null before the first */
  lastSpot: Spot | null;
  /** tone-field (P0c) rebuilds in this page session */
  toneBuilds: number;
  /** pass list of the last display frame */
  passes: string[];
}

declare global {
  interface Window {
    __meiyan?: DebugState;
  }
}
