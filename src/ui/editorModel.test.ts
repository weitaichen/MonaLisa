// editorModel.ts: when the editor trusts a "no face", how often it re-detects, and 儲存 surviving a session swap.
import { describe, expect, it, vi } from 'vitest';
import type { Face, TrackerState } from '../types';
import { detectSession, exportOnLatest, MAX_REDETECTS, RedetectBudget } from './editorModel';

const FACE = {} as Face;
const session = (face: Face | null, faceKnown = true) => ({ face, faceKnown });

describe('detectSession', () => {
  it('a healthy tracker that found nothing is a definite "no face"', () => {
    expect(detectSession(true, () => true, () => session(null)).unsure).toBe(false);
  });

  it('a face is always an answer, even from a tracker reported unhealthy', () => {
    expect(detectSession(true, () => false, () => session(FACE)).unsure).toBe(false);
  });

  it('unsure when the tracker was unhealthy before the call, or the call threw', () => {
    expect(detectSession(true, () => false, () => session(null)).unsure).toBe(true);
    expect(detectSession(true, () => true, () => session(null, false)).unsure).toBe(true);
  });

  it('unsure when the detect call itself found the tracker lost (it reports "lost" before returning null)', () => {
    let health: TrackerState = 'ok';
    const r = detectSession(
      true,
      () => health === 'ok',
      () => {
        health = 'lost'; // tracker.ts usable() → retire() → onStateChange('lost'), synchronously
        return session(null);
      },
    );
    expect(r.unsure).toBe(true);
  });

  it('基本模式 (no tracker) is never unsure', () => {
    expect(detectSession(false, () => false, () => session(null, false)).unsure).toBe(false);
  });
});

describe('RedetectBudget', () => {
  it('detects again while answers stay unsure and the tracker is ok, up to MAX_REDETECTS', () => {
    const b = new RedetectBudget('ok');
    for (let i = 0; i < MAX_REDETECTS; i++) expect(b.next(true, 'ok')).toBe(true);
    expect(b.next(true, 'ok')).toBe(false);
  });

  it('two throwing detects then a success: the third re-detect still runs', () => {
    const b = new RedetectBudget('ok');
    expect(b.next(true, 'ok')).toBe(true); // first detect threw
    expect(b.next(true, 'ok')).toBe(true); // re-detect 1 threw
    expect(b.next(true, 'ok')).toBe(true); // re-detect 2 threw → re-detect 3 (finds the face)
    expect(b.next(false, 'ok')).toBe(false); // a definite answer: no more
  });

  it('waits while the tracker is not ok and never re-detects a definite answer', () => {
    const b = new RedetectBudget('lost');
    expect(b.next(true, 'lost')).toBe(false);
    expect(b.next(true, 'failed')).toBe(false);
    expect(b.next(false, 'ok')).toBe(false);
  });

  it('a tracker flapping ok → lost inside the re-detect gets another try once it is ok again', () => {
    const b = new RedetectBudget('lost');
    expect(b.next(true, 'ok')).toBe(true); // recovered: re-detect
    expect(b.next(true, 'lost')).toBe(false); // lost again during it: unsure, wait
    expect(b.next(true, 'ok')).toBe(true); // back: try again
  });

  it('a recovery refills a spent budget', () => {
    const b = new RedetectBudget('ok');
    for (let i = 0; i < MAX_REDETECTS; i++) b.next(true, 'ok');
    expect(b.next(true, 'ok')).toBe(false);
    expect(b.next(true, 'lost')).toBe(false); // 3rd throw escalated: the tracker replaces its instance
    expect(b.next(true, 'ok')).toBe(true);
  });
});

describe('exportOnLatest', () => {
  interface Fake {
    id: string;
    disposed: boolean;
  }
  const make = (id: string): Fake => ({ id, disposed: false });
  const run = async (s: Fake) => {
    await Promise.resolve(); // prepareExport (the LUT download)
    if (s.disposed) throw new Error('StillSession: disposed');
    return `file from ${s.id}`;
  };

  it('a session replaced while preparing: the export comes from the replacement', async () => {
    const old = make('old');
    let current = old;
    const p = exportOnLatest(old, run, (failed) => (current !== failed ? current : null));
    // the re-detect swaps sessions while the export waits
    old.disposed = true;
    current = make('new');
    const r = await p;
    expect(r.result).toBe('file from new');
    expect(r.s).toBe(current);
  });

  it('a failure on the still-current session stands', async () => {
    const s = make('a');
    const failing = vi.fn(async () => {
      throw new Error('encode failed');
    });
    await expect(exportOnLatest(s, failing, (f) => (f !== s ? s : null))).rejects.toThrow('encode failed');
    expect(failing).toHaveBeenCalledTimes(1);
  });

  it('retries are capped', async () => {
    let n = 0;
    const failing = vi.fn(async () => {
      throw new Error('disposed');
    });
    await expect(exportOnLatest(make('0'), failing, () => make(String(++n)), 2)).rejects.toThrow('disposed');
    expect(failing).toHaveBeenCalledTimes(3);
  });
});
