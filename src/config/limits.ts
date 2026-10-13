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
/** obstacles kept in a detection cache (validation bound) */
export const MAX_OBSTACLES = 8;
/** the face table's carrier (§4.4): the faster of the two on the test iPhone; a PG1 failure forces 'ubo' */
export const FACE_TABLE_CARRIER: 'texture' | 'ubo' = 'texture';
