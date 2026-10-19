// The camera session (camera per-person spec §3.11, §5.1): the one LivePersons of the open camera, made on first use.
// The live loop gets it through LiveDeps.persons, so a loop rebuilt on a new stream, an interruption or a bundle
// change keeps everyone; Review, 編輯 and 相簿 leave it alone. ✕ and a flip end it (endCameraSession, before the
// stream stops, so the stopping loop's releases are dropped: Review Focus #1); a reload starts a new one.
import { LivePersons } from '../app/livePersons';
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
