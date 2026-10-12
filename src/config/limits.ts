// Every number Phase 0 can change (step-1 spec §3.5, §6.3). A fallback is a one-line change here, committed together
// with the measurements (spec §6.4). iPhone numbers need a preview deploy, which only happens with the user's go-ahead:
// until then these defaults ship (RM §12 decision).

/** selectable faces per photo (§6.3 PD1, PR1, PE1, PM1) */
export const MAX_EDIT_FACES = 6;
/** numFaces of the editor's IMAGE detection: two spare so dropped.overCap is real and tiny faces take no slot (A1) */
export const EDIT_DETECT_FACES = MAX_EDIT_FACES + 2;
/** shader loop bound and face-table height (compile time) */
export const MAX_RENDER_FACES = 6;
/** numPoses of the 美體 detection (§6.3 PB1, PM1) */
export const MAX_EDIT_BODIES = 4;
/** faces the camera tracks; 1 hides the camera's 選臉 and bypasses the smoother (§6.3 PL1, PL2, PJ1) */
export const MAX_LIVE_FACES = 3;
/** numFaces the camera requests: every live instance is built with it and the camera never toggles it (T1) */
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
/** obstacles kept in a detection cache (validation bound) */
export const MAX_OBSTACLES = 8;
/** the face table's carrier (§4.4): the faster of the two on the test iPhone; a PG1 failure forces 'ubo' */
export const FACE_TABLE_CARRIER: 'texture' | 'ubo' = 'texture';
