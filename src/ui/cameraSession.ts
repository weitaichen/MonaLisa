// The camera session (camera per-person spec §3.11, §5.1): the one LivePersons of the open camera, made on first use.
// The live loop gets it through LiveDeps.persons, so a loop rebuilt on a new stream, an interruption or a bundle
// change keeps everyone; Review, 編輯 and 相簿 leave it alone. ✕ and a flip end it (endCameraSession, before the
// stream stops, so the stopping loop's releases are dropped: Review Focus #1); a reload starts a new one.
import { LivePersons, type LivePersonId } from '../app/livePersons';
import { CAMERA_OFF_NOTE, type CameraLensInfo } from '../edit/lens';
import type { PersonParams } from '../types';
import { app } from './state';

let session: LivePersons | null = null;

/** the one camera session, made on first use */
export function cameraSession(): LivePersons {
  return (session ??= new LivePersons());
}

/** ✕ / a flip: everyone forgotten, the selection auto, 全部套用 off (the chip's store flag too) */
export function endCameraSession(): void {
  cameraSession().clear();
  app.set({ cameraAll: false });
}

/**
 * a slider drag in progress (§3.2: a drag keeps the target it started with until it commits): the persons it writes,
 * the person the panel shows, and the slider binding it started on
 */
export interface CameraDrag {
  ids: readonly LivePersonId[];
  lead: LivePersonId | null;
  key: string;
}

/** a drag's first change: it writes whoever the panel edits now (everyone in view under 全部套用, else the target) */
export function beginDrag(s: LivePersons, key: string): CameraDrag {
  return { ids: s.editTargets(), lead: s.target(), key };
}

/**
 * the drag while the slider row still shows the binding it started on (`shownKey`: the shown binding's key, null with no
 * slider shown); else null. SliderRow drops its drag without onCommit when its key changes or it unmounts, so a
 * dropped drag must never write again, nor carry into the next one (Review Focus #3)
 */
export function keepDrag(drag: CameraDrag | null, shownKey: string | null): CameraDrag | null {
  return drag && shownKey === drag.key ? drag : null;
}

/**
 * The camera lens's faces (camera per-person spec §3.2, §3.6). `noFace` whenever the session has no target to write,
 * with a tracker (working, restarting or still loading): no face shown, and before the stream is live (the gate,
 * 正在開啟相機…, 相機已暫停, a flip's restart, a context loss), so person items and 一鍵 presets are off with the note
 * instead of saving a preset's photo part and handing its person part to nobody (round-1 review C4); the note says to
 * open the camera while the stream is not live (`live`: the camera's stream state). 基本模式 edits the ambient person,
 * never off. `target`: a running drag's lead, fixed for the drag so its slider key never changes (C13), else the
 * session's target
 */
export function cameraLensInfo(s: LivePersons, drag: CameraDrag | null, o: { shown: number; all: boolean; basic: boolean; live: boolean }): CameraLensInfo {
  const noFace = !o.basic && s.target() === null;
  return { shown: o.shown, all: o.all, noFace, ...(noFace && !o.live ? { offNote: CAMERA_OFF_NOTE } : {}), target: drag ? drag.lead : s.target() };
}

/** the person params the panel shows: the drag's lead while it runs, else the target's (原圖 when untouched) */
export function panelPerson(s: LivePersons, drag: CameraDrag | null): PersonParams {
  return s.panelParams(drag?.lead ?? null);
}

/** a panel edit of the person part: to the drag's persons while it runs, else to the session's edit targets (K9 pin) */
export function writePerson(s: LivePersons, p: PersonParams, drag: CameraDrag | null): void {
  s.edit(p, drag?.ids);
}
