import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CameraSnapshot } from '../types';
import {
  BLACK_CHECK_INTERVAL_MS,
  BLACK_FIRST_CHECK_MS,
  FOREGROUND_GRACE_MS,
  METADATA_TIMEOUT_MS,
  cameraConstraints,
  createCameraWith,
  mapCameraError,
  maxLuma,
  type CameraEnv,
} from './camera';

// ── minimal fakes (no jsdom): EventTarget-based stand-ins for the DOM pieces the controller touches ──

const log: string[] = [];

class FakeTrack extends EventTarget {
  readonly kind = 'video';
  muted = false;
  readyState: MediaStreamTrackState = 'live';
  constructor(readonly id: string) {
    super();
  }
  stop() {
    log.push(`stop:${this.id}`);
    this.readyState = 'ended';
  }
  end() {
    this.readyState = 'ended';
    this.dispatchEvent(new Event('ended'));
  }
  mute() {
    this.muted = true;
    this.dispatchEvent(new Event('mute'));
  }
  unmute() {
    this.muted = false;
    this.dispatchEvent(new Event('unmute'));
  }
}

class FakeStream {
  constructor(readonly tracks: FakeTrack[]) {}
  getTracks() {
    return this.tracks;
  }
  getVideoTracks() {
    return this.tracks;
  }
}

class FakeVideo extends EventTarget {
  videoWidth = 0;
  videoHeight = 0;
  readyState = 0;
  plays = 0;
  /** frame size the next attached stream reports; null = never reports metadata */
  nextSize: [number, number] | null = [1280, 720];
  private src: FakeStream | null = null;
  get srcObject() {
    return this.src;
  }
  set srcObject(s: FakeStream | null) {
    this.src = s;
    this.videoWidth = this.videoHeight = this.readyState = 0;
    const size = this.nextSize;
    if (s && size) {
      queueMicrotask(() => {
        if (this.src !== s) return;
        [this.videoWidth, this.videoHeight] = size;
        this.readyState = 4;
        this.dispatchEvent(new Event('loadedmetadata'));
      });
    }
  }
  play() {
    this.plays++;
    return Promise.resolve();
  }
  resizeTo(w: number, h: number) {
    this.videoWidth = w;
    this.videoHeight = h;
    this.dispatchEvent(new Event('resize'));
  }
}

class FakeDoc extends EventTarget {
  visibilityState: DocumentVisibilityState = 'visible';
  setVisible(v: boolean) {
    this.visibilityState = v ? 'visible' : 'hidden';
    this.dispatchEvent(new Event('visibilitychange'));
  }
}

class FakeSentinel extends EventTarget {
  released = false;
  readonly type = 'screen';
  release() {
    if (!this.released) {
      this.released = true;
      this.dispatchEvent(new Event('release'));
    }
    return Promise.resolve();
  }
}

function setup(overrides: Partial<CameraEnv> = {}) {
  const video = new FakeVideo();
  const doc = new FakeDoc();
  let n = 0;
  const tracks: FakeTrack[] = [];
  const getUserMedia = vi.fn(async (_c?: MediaStreamConstraints) => {
    log.push('gum');
    const t = new FakeTrack(`t${++n}`);
    tracks.push(t);
    return new FakeStream([t]) as unknown as MediaStream;
  });
  const sentinels: FakeSentinel[] = [];
  const wakeLock = {
    request: vi.fn(async () => {
      const s = new FakeSentinel();
      sentinels.push(s);
      return s as unknown as WakeLockSentinel;
    }),
  };
  const sampleMaxLuma = vi.fn((_v: HTMLVideoElement): number | null => 128);
  const env: CameraEnv = {
    video: video as unknown as HTMLVideoElement,
    mediaDevices: { getUserMedia },
    isSecureContext: true,
    doc: doc as unknown as CameraEnv['doc'],
    wakeLock,
    sampleMaxLuma,
    ...overrides,
  };
  const cam = createCameraWith(env);
  const seen: CameraSnapshot[] = [];
  cam.subscribe((s) => seen.push(s));
  return { cam, video, doc, getUserMedia, tracks, wakeLock, sentinels, sampleMaxLuma, seen };
}

/** let queued promise continuations run (timers are faked, setImmediate is real) */
async function flush() {
  for (let i = 0; i < 5; i++) await new Promise<void>((r) => setImmediate(r));
}

beforeEach(() => {
  log.length = 0;
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
});
afterEach(() => {
  vi.useRealTimers();
});

describe('mapCameraError', () => {
  const err = (name: string) => new DOMException('x', name);
  it.each([
    ['NotAllowedError', 'denied'],
    ['PermissionDeniedError', 'denied'],
    ['SecurityError', 'denied'],
    ['NotFoundError', 'notfound'],
    ['DevicesNotFoundError', 'notfound'],
    ['OverconstrainedError', 'notfound'],
    ['NotReadableError', 'inuse'],
    ['TrackStartError', 'inuse'],
    ['AbortError', 'inuse'],
    ['TypeError', 'unknown'],
  ])('%s → %s', (name, kind) => {
    expect(mapCameraError(err(name), true)).toBe(kind);
  });
  it('insecure context wins over the error name', () => {
    expect(mapCameraError(err('NotAllowedError'), false)).toBe('insecure');
  });
  it('tolerates non-errors', () => {
    expect(mapCameraError(undefined, true)).toBe('unknown');
    expect(mapCameraError('boom', true)).toBe('unknown');
    expect(mapCameraError({ name: 'NotFoundError' }, true)).toBe('notfound');
  });
});

describe('helpers', () => {
  it('constraints follow the plan exactly', () => {
    expect(cameraConstraints('environment')).toEqual({
      audio: false,
      video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } },
    });
  });
  it('maxLuma takes the brightest pixel and ignores alpha', () => {
    const px = new Uint8ClampedArray([0, 0, 0, 255, 10, 20, 30, 0, 1, 1, 1, 255]);
    expect(maxLuma(px)).toBeCloseTo(0.299 * 10 + 0.587 * 20 + 0.114 * 30, 6);
    expect(maxLuma(new Uint8ClampedArray(16 * 16 * 4))).toBe(0);
  });
});

describe('camera controller', () => {
  it('start → starting → live with dimensions from the video element', async () => {
    const { cam, video, getUserMedia, seen } = setup();
    expect(cam.snapshot).toEqual({ state: 'idle', facing: 'user', error: null, width: 0, height: 0 });
    const p = cam.start();
    // getUserMedia must be issued synchronously (user gesture still active)
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(getUserMedia).toHaveBeenCalledWith(cameraConstraints('user'));
    expect(cam.snapshot.state).toBe('starting');
    await p;
    expect(cam.snapshot).toEqual({ state: 'live', facing: 'user', error: null, width: 1280, height: 720 });
    expect(video.srcObject).not.toBeNull();
    expect(video.plays).toBe(1);
    expect(seen.map((s) => s.state)).toEqual(['idle', 'starting', 'live']);
    expect(Object.isFrozen(cam.snapshot)).toBe(true);
  });

  it('start while live with the same facing is a no-op; concurrent starts share one request', async () => {
    const { cam, getUserMedia } = setup();
    const a = cam.start();
    const b = cam.start('user');
    expect(b).toBe(a);
    await a;
    await cam.start();
    expect(getUserMedia).toHaveBeenCalledTimes(1);
  });

  it('insecure context → error insecure without calling getUserMedia', async () => {
    const { cam, getUserMedia } = setup({ isSecureContext: false });
    await cam.start();
    expect(cam.snapshot).toMatchObject({ state: 'error', error: 'insecure' });
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it('no mediaDevices → error notfound', async () => {
    const { cam } = setup({ mediaDevices: undefined });
    await cam.start();
    expect(cam.snapshot).toMatchObject({ state: 'error', error: 'notfound' });
  });

  it.each([
    ['NotAllowedError', 'denied'],
    ['NotFoundError', 'notfound'],
    ['OverconstrainedError', 'notfound'],
    ['NotReadableError', 'inuse'],
    ['WeirdError', 'unknown'],
  ])('getUserMedia %s → error %s, and start() resolves', async (name, kind) => {
    const getUserMedia = vi.fn(() => Promise.reject(new DOMException('no', name)));
    const { cam } = setup({ mediaDevices: { getUserMedia } });
    await expect(cam.start()).resolves.toBeUndefined();
    expect(cam.snapshot).toEqual({ state: 'error', facing: 'user', error: kind, width: 0, height: 0 });
  });

  it('flip stops the old track before requesting the other camera', async () => {
    const { cam, getUserMedia, tracks } = setup();
    await cam.start('user');
    log.length = 0;
    await cam.flip();
    expect(log.slice(0, 2)).toEqual(['stop:t1', 'gum']);
    expect(getUserMedia).toHaveBeenLastCalledWith(cameraConstraints('environment'));
    expect(cam.snapshot).toMatchObject({ state: 'live', facing: 'environment' });
    expect(tracks[0].readyState).toBe('ended');
    expect(tracks[1].readyState).toBe('live');
  });

  it('flip while idle only changes the facing', async () => {
    const { cam, getUserMedia } = setup();
    await cam.flip();
    expect(cam.snapshot).toMatchObject({ state: 'idle', facing: 'environment' });
    expect(getUserMedia).not.toHaveBeenCalled();
    await cam.start();
    expect(getUserMedia).toHaveBeenCalledWith(cameraConstraints('environment'));
  });

  it('stop releases everything and returns to idle', async () => {
    const { cam, video, tracks, sentinels } = setup();
    await cam.start();
    await flush();
    expect(sentinels).toHaveLength(1);
    cam.stop();
    expect(cam.snapshot).toEqual({ state: 'idle', facing: 'user', error: null, width: 0, height: 0 });
    expect(tracks[0].readyState).toBe('ended');
    expect(video.srcObject).toBeNull();
    expect(sentinels[0].released).toBe(true);
  });

  it('stop during a pending getUserMedia discards the late stream', async () => {
    let resolve!: (s: MediaStream) => void;
    const getUserMedia = vi.fn(() => new Promise<MediaStream>((r) => (resolve = r)));
    const { cam, video } = setup({ mediaDevices: { getUserMedia } });
    const p = cam.start();
    cam.stop();
    const late = new FakeTrack('late');
    resolve(new FakeStream([late]) as unknown as MediaStream);
    await p;
    expect(cam.snapshot.state).toBe('idle');
    expect(late.readyState).toBe('ended');
    expect(video.srcObject).toBeNull();
  });

  it('subscribe emits immediately, then only on change; unsubscribe stops delivery', async () => {
    const { cam } = setup();
    const got: string[] = [];
    const off = cam.subscribe((s) => got.push(s.state));
    expect(got).toEqual(['idle']);
    await cam.start();
    off();
    cam.stop();
    expect(got).toEqual(['idle', 'starting', 'live']);
  });

  it('video resize while live updates the snapshot size', async () => {
    const { cam, video } = setup();
    await cam.start();
    video.resizeTo(720, 1280);
    expect(cam.snapshot).toMatchObject({ width: 720, height: 1280 });
  });

  it('metadata never arrives → error unknown after the timeout', async () => {
    const { cam, video } = setup();
    video.nextSize = null;
    const p = cam.start();
    await flush();
    expect(cam.snapshot.state).toBe('starting');
    await vi.advanceTimersByTimeAsync(METADATA_TIMEOUT_MS);
    await p;
    expect(cam.snapshot).toMatchObject({ state: 'error', error: 'unknown' });
  });

  describe('recovery', () => {
    it('foreground: still muted after the grace period → interrupted; resume restarts', async () => {
      const { cam, doc, tracks, getUserMedia } = setup();
      await cam.start();
      doc.setVisible(false);
      tracks[0].mute(); // WebKit mutes capture in the background
      doc.setVisible(true);
      await vi.advanceTimersByTimeAsync(FOREGROUND_GRACE_MS - 1);
      expect(cam.snapshot.state).toBe('live');
      await vi.advanceTimersByTimeAsync(1);
      expect(cam.snapshot).toMatchObject({ state: 'interrupted', error: null, width: 1280, height: 720 });
      expect(tracks[0].readyState).toBe('ended'); // stopped, a fresh getUserMedia is needed
      await cam.resume();
      expect(getUserMedia).toHaveBeenCalledTimes(2);
      expect(cam.snapshot.state).toBe('live');
    });

    it('foreground: auto-unmute within the grace period keeps it live', async () => {
      const { cam, doc, tracks } = setup();
      await cam.start();
      doc.setVisible(false);
      tracks[0].mute();
      doc.setVisible(true);
      await vi.advanceTimersByTimeAsync(300);
      tracks[0].unmute();
      await vi.advanceTimersByTimeAsync(2000);
      expect(cam.snapshot.state).toBe('live');
    });

    it('track ended while hidden is detected on return', async () => {
      const { cam, doc, tracks } = setup();
      await cam.start();
      doc.setVisible(false);
      tracks[0].end();
      expect(cam.snapshot.state).toBe('live');
      doc.setVisible(true);
      await vi.advanceTimersByTimeAsync(FOREGROUND_GRACE_MS);
      expect(cam.snapshot.state).toBe('interrupted');
    });

    it('track ended while visible → interrupted immediately', async () => {
      const { cam, tracks } = setup();
      await cam.start();
      tracks[0].end();
      expect(cam.snapshot.state).toBe('interrupted');
    });

    it('mute while visible (e.g. a call) → interrupted after the grace period', async () => {
      const { cam, tracks } = setup();
      await cam.start();
      tracks[0].mute();
      await vi.advanceTimersByTimeAsync(FOREGROUND_GRACE_MS);
      expect(cam.snapshot.state).toBe('interrupted');
    });

    it('healthy return to foreground stays live and re-acquires the wake lock', async () => {
      const { cam, doc, wakeLock, sentinels } = setup();
      await cam.start();
      await flush();
      expect(wakeLock.request).toHaveBeenCalledTimes(1);
      doc.setVisible(false);
      sentinels[0].release(); // the browser drops the lock when hidden
      doc.setVisible(true);
      await flush();
      expect(wakeLock.request).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(FOREGROUND_GRACE_MS);
      expect(cam.snapshot.state).toBe('live');
    });

    it('wake lock failures are non-fatal', async () => {
      const wakeLock = { request: vi.fn(() => Promise.reject(new DOMException('no', 'NotAllowedError'))) };
      const { cam } = setup({ wakeLock });
      await cam.start();
      await flush();
      expect(cam.snapshot.state).toBe('live');
    });
  });

  describe('black-frame detector', () => {
    it('3 consecutive black samples starting 2 s after live → error black', async () => {
      const { cam, sampleMaxLuma, tracks } = setup();
      sampleMaxLuma.mockReturnValue(1);
      await cam.start();
      const last = BLACK_FIRST_CHECK_MS + 2 * BLACK_CHECK_INTERVAL_MS;
      await vi.advanceTimersByTimeAsync(last - 1);
      expect(sampleMaxLuma).toHaveBeenCalledTimes(2);
      expect(cam.snapshot.state).toBe('live');
      await vi.advanceTimersByTimeAsync(1);
      expect(sampleMaxLuma).toHaveBeenCalledTimes(3);
      expect(cam.snapshot).toMatchObject({ state: 'error', error: 'black', width: 0, height: 0 });
      expect(tracks[0].readyState).toBe('ended');
    });

    it('a real frame stops the detector', async () => {
      const { cam, sampleMaxLuma } = setup();
      sampleMaxLuma.mockReturnValueOnce(2).mockReturnValue(60);
      await cam.start();
      await vi.advanceTimersByTimeAsync(20_000);
      expect(sampleMaxLuma).toHaveBeenCalledTimes(2);
      expect(cam.snapshot.state).toBe('live');
    });

    it('unsampleable video disables the detector', async () => {
      const { cam, sampleMaxLuma } = setup();
      sampleMaxLuma.mockReturnValue(null);
      await cam.start();
      await vi.advanceTimersByTimeAsync(20_000);
      expect(sampleMaxLuma).toHaveBeenCalledTimes(1);
      expect(cam.snapshot.state).toBe('live');
    });

    it('hidden checks are skipped, not counted', async () => {
      const { cam, doc, sampleMaxLuma } = setup();
      sampleMaxLuma.mockReturnValue(0);
      await cam.start();
      doc.setVisible(false);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(sampleMaxLuma).not.toHaveBeenCalled();
      expect(cam.snapshot.state).toBe('live');
    });
  });
});
