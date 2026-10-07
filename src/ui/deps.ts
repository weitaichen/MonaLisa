// Every non-UI module the UI talks to, gathered in one mutable object. Production uses the real
// implementations; the visual harness (tests/harness/t7) swaps in fakes so screens can be verified
// before / independently of the engine, tracker and camera modules.
import { startLiveLoop } from '../app/live';
import { createStillSession } from '../app/still';
import { ENGINE_PATHS, loadEngineAssets } from '../engine/assets';
import { createEngine, isWebGL2Supported } from '../engine/index';
import { createCamera } from '../media/camera';
import { encodeJpeg, saveFile, toJpegBlob } from '../media/exporter';
import { importPhoto } from '../media/importer';
import { addEntry, deleteEntry, getEntry, listEntries, updateEntry } from '../store/history';
import { loadParams, loadPrefs, saveParams, savePrefs } from '../store/settings';
import { UndoStack } from '../store/undo';
import type { Tracker, TrackerOptions } from '../types';

/** tasks-vision is ~200 kB: fetch it alongside the model download instead of before first paint. */
const createTracker = (opts: TrackerOptions): Promise<Tracker> =>
  import('../tracking/tracker').then((m) => m.createTracker(opts));

/** public surface of store/undo's UndoStack (so fakes need not be the class) */
export interface UndoLike<T> {
  reset(initial: T): void;
  push(state: T): void;
  undo(): T | null;
  redo(): T | null;
  readonly current: T | null;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
}

export const deps = {
  createEngine,
  isWebGL2Supported,
  loadEngineAssets,
  wasmBase: ENGINE_PATHS.wasmBase as string,
  createTracker,
  createCamera,
  importPhoto,
  encodeJpeg,
  toJpegBlob,
  saveFile,
  addEntry,
  updateEntry,
  listEntries,
  getEntry,
  deleteEntry,
  loadParams,
  saveParams,
  loadPrefs,
  savePrefs,
  createUndo: <T>(limit?: number): UndoLike<T> => new UndoStack<T>(limit),
  startLiveLoop,
  createStillSession,
};

export type Deps = typeof deps;
