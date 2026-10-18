// Every number Phase 0 can change (step-1 spec §3.5, §6.3). A fallback is a one-line change here, committed together
// with the measurements (spec §6.4). iPhone numbers need a preview deploy, which only happens with the user's go-ahead:
// until then these defaults ship (RM §12 decision).

/**
 * selectable faces per photo (§6.3 PD1, PR1, PE1, PM1). 10 since 2026-10-18 (S §6.7, the user's cap: at most ten
 * people); 8 from §6.6, 6 before (which kept the largest six of a seven-person photo)
 */
export const MAX_EDIT_FACES = 10;
/**
 * numFaces of the editor's IMAGE detection: two spare so dropped.overCap is real and tiny faces take no slot (A1), and
 * a duplicate the CPU graph returns (S §6.5) still leaves room for a face over the cap. 12 since S §6.7
 */
export const EDIT_DETECT_FACES = MAX_EDIT_FACES + 2;
/**
 * shader loop bound and face-table height (compile time). Face ids are f0…f{MAX_RENDER_FACES − 1} (one digit:
 * cache.ts FACE_ID, state.ts PERSON_ID) and RESHAPE_FS's uDetail has one bit per face, so it stays ≤ 10; the UBO
 * carrier's block is MAX_RENDER_FACES × 96 vec4 = 15,360 B at 10, within the 16,384 B WebGL2 guarantees (S §6.7)
 */
export const MAX_RENDER_FACES = 10;
/** numPoses of the 美體 detection (§6.3 PB1, PM1) */
export const MAX_EDIT_BODIES = 4;
/**
 * faces the camera tracks; 1 hides the camera's 選臉 and bypasses the smoother (§6.3 PL1, PL2, PJ1). Desktop 2026-10-13
 * (S §6.4, bench L): with one face in view, numFaces 3 adds 3.5–4.2 ms per detection on the GPU delegate (p50 about
 * 12.4 → 16.3 ms, +28–35 %) and 1.9–2.1 ms on CPU, within PL2's 5 ms. With three faces in view p50 is about 31 ms
 * (numFaces 2: about 22 ms), over PL1's 20 ms on that desktop. §6.3 applies both rows to the slowest iPhone, so this
 * default ships until the iPhone rows exist (RM §12); the bench prints the PL1 / PL2 verdicts (bench/report.ts liveRows).
 */
export const MAX_LIVE_FACES = 3;
/**
 * numFaces the camera requests: every live instance is built with it and the camera never toggles it (T1). A count
 * switch rebuilds the graph, and its first inference took 145–165 ms on the desktop's GPU delegate (33–49 ms on CPU),
 * a visible hitch each time a second face came or went. Nor does a lone selfie at numFaces 1 give a cheap sign of a
 * second face: in VIDEO mode MediaPipe runs its face detector only while it tracks fewer faces than numFaces (its
 * documented tracking; not checked in the 0.10.35 source), which is also where PL2's cost comes from (bench L agrees:
 * with one face in view numFaces 2 and 3 cost the same).
 */
export const LIVE_DETECT_FACES = MAX_LIVE_FACES;
/** a face box narrower than this fraction of the short edge is not selectable and gets no face effects */
export const MIN_FACE_FRAC = 0.03;
/** camera: a missing track is held this long, then dropped */
export const LOST_HOLD_MS = 1000;
/** camera smoothing: MediaPipe's own LandmarksSmoothingCalculator values (Hz; values scaled by 1 / face size) */
export const ONE_EURO = { minCutoff: 0.05, beta: 80, dCutoff: 1.0 } as const;
/** seed → face match: the face box padded by this fraction must contain the seed */
export const SEED_BOX_PAD = 0.25;
/** 瘦臉 limit layer edge with ≥ 2 selectable faces (§4.7) */
export const PROTECT_WINDOW = 128;
/**
 * obstacles kept in a detection cache (validation bound): one per face a detection returns, so every face it drops is
 * an obstacle (A1), also when it kept only one. 12 since S §6.7 (was 8: with 12 requested, a photo of two or three
 * people and a crowd of tiny faces lost some of them)
 */
export const MAX_OBSTACLES = EDIT_DETECT_FACES;
/**
 * the face table's carrier (§4.4): the faster of the two ships (PR1); a PG1 failure forces 'ubo'. 'ubo' since
 * 2026-10-18 (S §6.4, bench R on the desktop GPU): 8 clustered faces at 2048 cost 4.4–4.8 ms through the UBO and
 * 11.8–12.3 ms through the texture (one face 5.5 vs 10.4 ms); 10 clustered faces 4.9–6.0 vs 13.3–14.9 ms (S §6.7).
 * Both stay behind RESHAPE_FS's F(f, i); the iPhone rows can flip it, and a software rasterizer gets the texture
 * (engine/faceTableCarrier.ts).
 */
export const FACE_TABLE_CARRIER: 'texture' | 'ubo' = 'ubo';

// ── step 3: crop and full-resolution export (step-3 spec §3.8) ──
/** long edge of a 原始解析度 export (C §11 Q4: capped at 4096) */
export const FULL_EXPORT_MAX_EDGE = 4096;
/** the tile edge expected at 4096 × 3072 (the planner picks the largest of 2048/1024/512/256 within GL_TILE_BUDGET_MB) */
export const TILE_DEFAULT = 1024;
/** GL buffer budget of the worst tile, MiB */
export const GL_TILE_BUDGET_MB = 40;
/** the picked file is kept as HistoryEntry.source only up to this size, MiB */
export const SOURCE_MAX_MB = 30;
/** an export slower than this from the tap shares on a second tap (transient activation lasts 5 s) */
export const SHARE_WINDOW_MS = 4000;
/** a working-size export that meets a lost context (the tiled fallback after a loss) waits this long for the restore (C §7) */
export const EXPORT_RESTORE_WAIT_MS = 10_000;
/** smallest crop: this fraction of each E dimension… */
export const MIN_CROP_FRAC = 0.05;
/** …and at least this many working-resolution pixels per axis */
export const MIN_CROP_PX = 64;

// ── step 4: 膚質 tools (skin-cleanup spec §3.3) ──
/** 祛痘: spots per photo (C §5.3); measured fallback 50 (skin-cleanup spec §6) */
export const SPOT_CAP = 100;
/** 祛痘: ring samples per spot (skin-cleanup spec §4.5); measured fallback 24 (spacing 0.34 r) */
export const HEAL_RING_SAMPLES = 32;

// ── 推臉筆 (push-brush spec §3.3) ──
/** liquify field long edge in texels (RM §4.4, §4.7) */
export const LIQUIFY_LONG_EDGE = 512;
/** brush radius on screen, CSS px, per size */
export const BRUSH_PX = { s: 16, m: 28, l: 44 } as const;
/** largest brush radius in S units (fractions of the frame's short edge) */
export const R_MAX = 0.25;
/** stamp spacing, × radius */
export const STAMP_SPACING = 0.25;
/** content at the brush centre moves ¾ of a short drag */
export const PUSH_GAIN = 0.75;
/** per-stamp restore factor at the centre */
export const RESTORE_GAIN = 0.5;
/** a restored texel below this |L| (O UV) becomes exactly 0 */
export const SNAP = 2e-5;
/** fold-guard floor for strokes (the body field's MIN_DET in src/body/field.ts is 0.35) */
export const LIQUIFY_MIN_DET = 0.2;
/** per-stamp bisection steps */
export const GUARD_STEPS = 6;
/** points per stroke record */
export const MAX_STROKE_POINTS = 256;
/** records per photo (RM §5.3) */
export const MAX_STROKES = 120;
/** replay work cap, texel-stamps (≈ 1 s of replay on the test iPhone; Phase 0 rescales it) */
export const LIQUIFY_WORK_CAP = 12_000_000;
/** a rebuild above this many texel-stamps runs in slices */
export const LIQUIFY_SYNC_WORK = 1_500_000;
/** one slice of a chunked rebuild, ms */
export const LIQUIFY_SLICE_MS = 24;
/** undo patch ring, bytes */
export const PATCH_BUDGET = 1 << 20;
/** copy-on-write tile edge, texels */
export const PATCH_TILE = 32;
/** a second finger within this many ms cancels the stroke */
export const PINCH_GRACE_MS = 200;
/** stamps applied per animation frame while drawing, ms */
export const STAMP_FRAME_MS = 6;
/**
 * stamps applied synchronously at finger up, ms (push-brush spec §6.1 "Commit ≤ 5 ms", with the commit itself): a
 * longer backlog drains STAMP_FRAME_MS per frame after the finger is up, and the stroke commits when it is empty
 */
export const STAMP_COMMIT_MS = 4;
