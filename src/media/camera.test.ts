import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CameraSnapshot } from '../types';
import {
  ANSWER_TIMEOUT_MS,
  AUTO_RESUME_MS,
  BLACK_CHECK_INTERVAL_MS,
  BLACK_FIRST_CHECK_MS,
  MUTE_GRACE_MS,
  FRAME_TIMEOUT_MS,
  REACQUIRE_DELAY_MS,
  REPLAY_GAP_MS,
  REPLAY_MS,
  STALL_GRACES,
  STALL_MS,
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
  paused = true;
  /** frame size the next attached stream reports; null = never reports metadata (WK 252465: no frame ever) */
  nextSize: [number, number] | null = [1280, 720];
  /** readyState it then reaches: 1 = metadata only, no decoded frame */
  nextReady = 4;
  private src: FakeStream | null = null;
  get srcObject() {
    return this.src;
  }
  set srcObject(s: FakeStream | null) {
    this.src = s;
    this.videoWidth = this.videoHeight = this.readyState = 0;
    const size = this.nextSize;
    const ready = this.nextReady;
    if (s && size) {
      queueMicrotask(() => {
        if (this.src !== s) return;
        [this.videoWidth, this.videoHeight] = size;
        this.readyState = ready;
        this.dispatchEvent(new Event('loadedmetadata'));
      });
    }
  }
  play() {
    this.plays++;
    this.paused = false;
    return Promise.resolve();
  }
  /** what WebKit does to a capture video after an interruption (WK 216874) */
  pause() {
    this.paused = true;
    this.dispatchEvent(new Event('pause'));
  }
  /** the first frame decoded late (after the stream arrived) */
  showFrame(w = 1280, h = 720) {
    [this.videoWidth, this.videoHeight] = [w, h];
    this.readyState = 4;
    this.dispatchEvent(new Event('loadeddata'));
  }
  resizeTo(w: number, h: number) {
    this.videoWidth = w;
    this.videoHeight = h;
    this.dispatchEvent(new Event('resize'));
  }
}

/** a getUserMedia that answers only when told to (WebKit can leave one unanswered) */
function heldGetUserMedia() {
  const pending: { facing: unknown; resolve: (s: MediaStream) => void; reject: (e: unknown) => void }[] = [];
  let n = 0;
  const tracks: FakeTrack[] = [];
  const getUserMedia = vi.fn(
    (c?: MediaStreamConstraints) =>
      new Promise<MediaStream>((resolve, reject) => {
        log.push('gum');
        pending.push({ facing: (c?.video as MediaTrackConstraints | undefined)?.facingMode, resolve, reject });
      }),
  );
  /** answer the oldest unanswered request with a fresh track */
  const answer = () => {
    const p = pending.shift()!;
    const t = new FakeTrack(`h${++n}`);
    tracks.push(t);
    p.resolve(new FakeStream([t]) as unknown as MediaStream);
    return t;
  };
  const refuse = (name: string) => pending.shift()!.reject(new DOMException('no', name));
  return { getUserMedia, pending, tracks, answer, refuse };
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
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
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

  it('getUserMedia throwing synchronously → error, and start() resolves', async () => {
    const getUserMedia = vi.fn((): Promise<MediaStream> => {
      throw new TypeError('bad constraints');
    });
    const { cam } = setup({ mediaDevices: { getUserMedia } });
    await expect(cam.start()).resolves.toBeUndefined();
    expect(cam.snapshot).toMatchObject({ state: 'error', error: 'unknown' });
  });

  describe('a stream that shows nothing (WK 252465)', () => {
    it('no frame in time → one clean automatic re-acquire, which goes live', async () => {
      const { cam, video, getUserMedia, tracks } = setup();
      video.nextSize = null;
      const p = cam.start();
      await flush();
      expect(cam.snapshot.state).toBe('starting');
      await vi.advanceTimersByTimeAsync(FRAME_TIMEOUT_MS - 1);
      expect(tracks[0].readyState).toBe('live');
      video.nextSize = [1280, 720];
      await vi.advanceTimersByTimeAsync(1);
      // the dead stream is stopped and detached before the pause, then asked for again
      expect(tracks[0].readyState).toBe('ended');
      expect(video.srcObject).toBeNull();
      expect(cam.snapshot.state).toBe('starting');
      expect(getUserMedia).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(REACQUIRE_DELAY_MS);
      await p;
      expect(getUserMedia).toHaveBeenCalledTimes(2);
      expect(cam.snapshot).toEqual({ state: 'live', facing: 'user', error: null, width: 1280, height: 720 });
    });

    it('no frame twice → error noframe with the second stream stopped (no third request)', async () => {
      const { cam, video, getUserMedia, tracks } = setup();
      video.nextSize = null;
      const p = cam.start();
      await vi.advanceTimersByTimeAsync(FRAME_TIMEOUT_MS + REACQUIRE_DELAY_MS + FRAME_TIMEOUT_MS);
      await p;
      expect(cam.snapshot).toEqual({ state: 'error', facing: 'user', error: 'noframe', width: 0, height: 0 });
      expect(getUserMedia).toHaveBeenCalledTimes(2);
      expect(tracks.map((t) => t.readyState)).toEqual(['ended', 'ended']);
      expect(video.srcObject).toBeNull();
      // 重試 starts over: a fresh request
      video.nextSize = [1280, 720];
      await cam.start();
      expect(getUserMedia).toHaveBeenCalledTimes(3);
      expect(cam.snapshot.state).toBe('live');
    });

    it('metadata without a decoded frame is not live', async () => {
      const { cam, video } = setup();
      video.nextReady = 1;
      void cam.start();
      await vi.advanceTimersByTimeAsync(FRAME_TIMEOUT_MS - 1);
      expect(video.videoWidth).toBe(1280);
      expect(cam.snapshot.state).toBe('starting');
      video.showFrame();
      await flush();
      expect(cam.snapshot).toMatchObject({ state: 'live', width: 1280, height: 720 });
    });

    it('a track that ends before its first frame fails at once, without waiting for the timeout', async () => {
      const { cam, video, getUserMedia, tracks } = setup();
      video.nextSize = null;
      void cam.start();
      await flush();
      tracks[0].end(); // "A MediaStreamTrack ended due to a capture failure"
      await flush();
      expect(video.srcObject).toBeNull();
      video.nextSize = [1280, 720];
      await vi.advanceTimersByTimeAsync(REACQUIRE_DELAY_MS);
      expect(getUserMedia).toHaveBeenCalledTimes(2);
      expect(cam.snapshot.state).toBe('live');
    });

    it('a stop at any point of a start leaves nothing capturing (0.5.1)', async () => {
      // every microtask the start takes between the tap and the stream shown, the hop from acquire to attach included
      for (let k = 0; k < 16; k++) {
        const { cam, video, tracks } = setup();
        void cam.start();
        for (let i = 0; i < k; i++) await Promise.resolve();
        cam.stop();
        await flush();
        await vi.advanceTimersByTimeAsync(FRAME_TIMEOUT_MS + REACQUIRE_DELAY_MS);
        const at = `stop after ${k} microtasks`;
        expect(cam.snapshot.state, at).toBe('idle');
        expect(tracks.map((t) => t.readyState), at).toEqual(tracks.map(() => 'ended'));
        expect(video.srcObject, at).toBeNull();
      }
    });

    it('a stop right after a stream showed no frame lands on idle, not on noframe (0.5.1)', async () => {
      // the second stream's deadline fires (a timer task); the stop lands k microtasks into what follows it
      for (let k = 0; k < 6; k++) {
        const { cam, video, tracks } = setup();
        video.nextSize = null;
        void cam.start();
        await vi.advanceTimersByTimeAsync(FRAME_TIMEOUT_MS + REACQUIRE_DELAY_MS);
        await flush();
        expect(tracks).toHaveLength(2);
        vi.advanceTimersByTime(FRAME_TIMEOUT_MS);
        for (let i = 0; i < k; i++) await Promise.resolve();
        cam.stop();
        await flush();
        const at = `stop after ${k} microtasks`;
        expect(cam.snapshot, at).toMatchObject({ state: 'idle', error: null });
        expect(tracks.map((t) => t.readyState), at).toEqual(['ended', 'ended']);
        expect(video.srcObject, at).toBeNull();
      }
    });

    it('a new start right after a stream showed no frame keeps its own noanswer timer (0.5.1)', async () => {
      // the first stream's deadline fires; ✕ and back in lands k microtasks into what follows, and its request hangs
      for (let k = 0; k < 6; k++) {
        const h = heldGetUserMedia();
        const { cam, video } = setup({ mediaDevices: { getUserMedia: h.getUserMedia } });
        video.nextSize = null;
        void cam.start();
        h.answer();
        await flush();
        vi.advanceTimersByTime(FRAME_TIMEOUT_MS);
        for (let i = 0; i < k; i++) await Promise.resolve();
        cam.stop();
        void cam.start();
        await vi.advanceTimersByTimeAsync(ANSWER_TIMEOUT_MS);
        const at = `stop and start after ${k} microtasks`;
        expect(h.getUserMedia, at).toHaveBeenCalledTimes(2);
        expect(cam.snapshot, at).toMatchObject({ state: 'starting', error: 'noanswer' });
      }
    });

    it('a track found ended as its first frame shows is not live: asked for again (0.5.1)', async () => {
      const { cam, video, getUserMedia, tracks } = setup();
      video.nextSize = null;
      const p = cam.start();
      await flush();
      // the capture ended as its first frame came, its 'ended' event not dispatched yet (a busy main thread)
      tracks[0].readyState = 'ended';
      video.nextSize = [1280, 720];
      video.showFrame();
      await flush();
      expect(cam.snapshot.state).toBe('starting');
      expect(video.srcObject).toBeNull();
      await vi.advanceTimersByTimeAsync(REACQUIRE_DELAY_MS);
      await p;
      expect(getUserMedia).toHaveBeenCalledTimes(2);
      expect(cam.snapshot).toMatchObject({ state: 'live', width: 1280, height: 720 });
    });

    it('a stream that arrives already ended is asked for again', async () => {
      let first = true;
      const getUserMedia = vi.fn(async () => {
        const t = new FakeTrack(first ? 'dead' : 'ok');
        if (first) t.readyState = 'ended';
        first = false;
        return new FakeStream([t]) as unknown as MediaStream;
      });
      const { cam } = setup({ mediaDevices: { getUserMedia } });
      const p = cam.start();
      await vi.advanceTimersByTimeAsync(REACQUIRE_DELAY_MS);
      await p;
      expect(getUserMedia).toHaveBeenCalledTimes(2);
      expect(cam.snapshot.state).toBe('live');
    });

    it('play() is called again when no frame came after a while, and a late frame still goes live', async () => {
      const { cam, video, getUserMedia } = setup();
      video.nextSize = null;
      void cam.start();
      await flush();
      expect(video.plays).toBe(1);
      await vi.advanceTimersByTimeAsync(REPLAY_MS);
      expect(video.plays).toBe(2);
      video.showFrame();
      await flush();
      expect(cam.snapshot.state).toBe('live');
      await vi.advanceTimersByTimeAsync(FRAME_TIMEOUT_MS);
      expect(getUserMedia).toHaveBeenCalledTimes(1);
      expect(cam.snapshot.state).toBe('live');
    });

    it('a deadline held up by a busy main thread gives a frame queued behind the stall a moment more (0.5.1)', async () => {
      const { cam, video, getUserMedia } = setup();
      video.nextSize = null;
      void cam.start();
      await flush();
      // a MediaPipe graph starting up kept the page busy: the deadline fires 3 s late
      vi.setSystemTime(Date.now() + 3_000);
      await vi.advanceTimersByTimeAsync(FRAME_TIMEOUT_MS);
      expect(cam.snapshot.state).toBe('starting');
      expect(video.srcObject).not.toBeNull();
      // the frame was decoded meanwhile, its event not dispatched yet: the deadline's own check finds it
      [video.videoWidth, video.videoHeight, video.readyState] = [1280, 720, 4];
      await vi.advanceTimersByTimeAsync(STALL_MS);
      await flush();
      expect(cam.snapshot).toMatchObject({ state: 'live', width: 1280, height: 720 });
      expect(getUserMedia).toHaveBeenCalledTimes(1);
    });

    it('a deadline that keeps stalling waits STALL_GRACES times at most, then asks again (0.5.1)', async () => {
      const { cam, video, getUserMedia, tracks } = setup();
      video.nextSize = null;
      const p = cam.start();
      await flush();
      vi.setSystemTime(Date.now() + 3_000);
      await vi.advanceTimersByTimeAsync(FRAME_TIMEOUT_MS);
      for (let i = 0; i < STALL_GRACES; i++) {
        expect(tracks[0].readyState).toBe('live');
        vi.setSystemTime(Date.now() + 3_000);
        await vi.advanceTimersByTimeAsync(STALL_MS);
      }
      expect(tracks[0].readyState).toBe('ended');
      video.nextSize = [1280, 720];
      await vi.advanceTimersByTimeAsync(REACQUIRE_DELAY_MS);
      await p;
      expect(getUserMedia).toHaveBeenCalledTimes(2);
      expect(cam.snapshot.state).toBe('live');
    });

    it('stop during the pause before the re-acquire asks for nothing more', async () => {
      const { cam, video, getUserMedia } = setup();
      video.nextSize = null;
      const p = cam.start();
      await vi.advanceTimersByTimeAsync(FRAME_TIMEOUT_MS);
      cam.stop();
      await vi.advanceTimersByTimeAsync(REACQUIRE_DELAY_MS + FRAME_TIMEOUT_MS);
      await p;
      expect(getUserMedia).toHaveBeenCalledTimes(1);
      expect(cam.snapshot.state).toBe('idle');
    });
  });

  describe('a getUserMedia that does not answer', () => {
    it('no answer in time → noanswer while still starting (the permission prompt may be up); a late answer goes live', async () => {
      const h = heldGetUserMedia();
      const { cam, seen } = setup({ mediaDevices: { getUserMedia: h.getUserMedia } });
      const p = cam.start();
      await vi.advanceTimersByTimeAsync(ANSWER_TIMEOUT_MS - 1);
      expect(cam.snapshot).toMatchObject({ state: 'starting', error: null });
      await vi.advanceTimersByTimeAsync(1);
      expect(cam.snapshot).toEqual({ state: 'starting', facing: 'user', error: 'noanswer', width: 0, height: 0 });
      h.answer(); // 允許
      await p;
      expect(cam.snapshot).toEqual({ state: 'live', facing: 'user', error: null, width: 1280, height: 720 });
      expect(h.getUserMedia).toHaveBeenCalledTimes(1);
      expect(seen.map((s) => `${s.state}:${s.error}`)).toEqual(['idle:null', 'starting:null', 'starting:noanswer', 'starting:null', 'live:null']);
    });

    it('a tap during noanswer joins the same request instead of asking twice', async () => {
      const h = heldGetUserMedia();
      const { cam } = setup({ mediaDevices: { getUserMedia: h.getUserMedia } });
      const p = cam.start();
      await vi.advanceTimersByTimeAsync(ANSWER_TIMEOUT_MS);
      expect(cam.snapshot.error).toBe('noanswer');
      expect(cam.start()).toBe(p);
      expect(h.getUserMedia).toHaveBeenCalledTimes(1);
      h.answer();
      await p;
      expect(cam.snapshot.state).toBe('live');
    });

    it('✕ and back in during an overdue request: noanswer at once, on the request\'s own clock', async () => {
      const h = heldGetUserMedia();
      const { cam } = setup({ mediaDevices: { getUserMedia: h.getUserMedia } });
      void cam.start();
      await vi.advanceTimersByTimeAsync(ANSWER_TIMEOUT_MS + 3000);
      cam.stop();
      void cam.start();
      expect(cam.snapshot).toMatchObject({ state: 'starting', error: null });
      await vi.advanceTimersByTimeAsync(0);
      expect(cam.snapshot).toMatchObject({ state: 'starting', error: 'noanswer' });
      expect(h.getUserMedia).toHaveBeenCalledTimes(1);
    });

    it('back in 3 s into a request: noanswer once the request is 8 s old, not 8 s after the return', async () => {
      const h = heldGetUserMedia();
      const { cam } = setup({ mediaDevices: { getUserMedia: h.getUserMedia } });
      void cam.start();
      await vi.advanceTimersByTimeAsync(3000);
      cam.stop();
      void cam.start();
      await vi.advanceTimersByTimeAsync(ANSWER_TIMEOUT_MS - 3000 - 1);
      expect(cam.snapshot.error).toBeNull();
      await vi.advanceTimersByTimeAsync(1);
      expect(cam.snapshot.error).toBe('noanswer');
    });

    it('a setup error is never turned into noanswer by a second start in the same task', async () => {
      const { cam } = setup({ mediaDevices: undefined });
      void cam.start();
      void cam.start();
      await vi.advanceTimersByTimeAsync(ANSWER_TIMEOUT_MS);
      expect(cam.snapshot).toMatchObject({ state: 'error', error: 'notfound' });
    });

    it('a late refusal after noanswer is shown as the refusal', async () => {
      const h = heldGetUserMedia();
      const { cam } = setup({ mediaDevices: { getUserMedia: h.getUserMedia } });
      const p = cam.start();
      await vi.advanceTimersByTimeAsync(ANSWER_TIMEOUT_MS);
      h.refuse('NotAllowedError');
      await p;
      expect(cam.snapshot).toMatchObject({ state: 'error', error: 'denied' });
    });

    it('stop, then start again while the first request is unanswered: no second request, and its answer goes live', async () => {
      const h = heldGetUserMedia();
      const { cam } = setup({ mediaDevices: { getUserMedia: h.getUserMedia } });
      void cam.start();
      cam.stop(); // ✕ while it spins
      const p = cam.start(); // back to the camera, 點擊開啟相機
      expect(h.getUserMedia).toHaveBeenCalledTimes(1);
      const t = h.answer();
      await p;
      expect(cam.snapshot.state).toBe('live');
      expect(t.readyState).toBe('live');
    });

    it('a start for the other camera waits out the unanswered request, drops its stream, then asks', async () => {
      const h = heldGetUserMedia();
      const { cam } = setup({ mediaDevices: { getUserMedia: h.getUserMedia } });
      void cam.start('user');
      cam.stop();
      const p = cam.start('environment');
      await flush();
      expect(h.getUserMedia).toHaveBeenCalledTimes(1);
      const stale = h.answer();
      await flush();
      expect(stale.readyState).toBe('ended');
      expect(h.getUserMedia).toHaveBeenCalledTimes(2);
      expect(h.pending[0].facing).toBe('environment');
      h.answer();
      await p;
      expect(cam.snapshot).toMatchObject({ state: 'live', facing: 'environment' });
    });

    it('waiting out a request for the other camera that never answers still ends in noanswer', async () => {
      const h = heldGetUserMedia();
      const { cam } = setup({ mediaDevices: { getUserMedia: h.getUserMedia } });
      void cam.start('user');
      cam.stop();
      void cam.start('environment');
      await vi.advanceTimersByTimeAsync(ANSWER_TIMEOUT_MS);
      expect(cam.snapshot).toMatchObject({ state: 'starting', error: 'noanswer', facing: 'environment' });
      expect(h.getUserMedia).toHaveBeenCalledTimes(1);
    });
  });

  describe('a start nobody tapped that iOS refuses', () => {
    it('the restart after the background lands on 恢復相機, not on 相機權限已被拒絕', async () => {
      const h = heldGetUserMedia();
      const { cam, doc } = setup({ mediaDevices: { getUserMedia: h.getUserMedia } });
      void cam.start();
      h.answer();
      await flush();
      expect(cam.snapshot.state).toBe('live');
      doc.setVisible(false);
      doc.setVisible(true);
      h.refuse('NotAllowedError');
      await flush();
      expect(cam.snapshot).toMatchObject({ state: 'interrupted', error: null });
      // the 恢復相機 tap asks again, with the gesture
      const p = cam.resume();
      h.answer();
      await p;
      expect(cam.snapshot.state).toBe('live');
    });

    it('the re-acquire after a stream with no frame lands on noframe (重試), not on denied', async () => {
      let calls = 0;
      const getUserMedia = vi.fn(async () => {
        if (++calls === 2) throw new DOMException('no', 'NotAllowedError');
        return new FakeStream([new FakeTrack(`r${calls}`)]) as unknown as MediaStream;
      });
      const { cam, video } = setup({ mediaDevices: { getUserMedia } });
      video.nextSize = null;
      const p = cam.start();
      await vi.advanceTimersByTimeAsync(FRAME_TIMEOUT_MS + REACQUIRE_DELAY_MS);
      await p;
      expect(getUserMedia).toHaveBeenCalledTimes(2);
      expect(cam.snapshot).toMatchObject({ state: 'error', error: 'noframe' });
    });

    it('any failure of the restart after the background lands on 恢復相機 (e.g. NotReadableError right after the return)', async () => {
      const h = heldGetUserMedia();
      const { cam, doc } = setup({ mediaDevices: { getUserMedia: h.getUserMedia } });
      void cam.start();
      h.answer();
      await flush();
      doc.setVisible(false);
      doc.setVisible(true);
      h.refuse('NotReadableError');
      await flush();
      expect(cam.snapshot).toMatchObject({ state: 'interrupted', error: null });
    });

    it('a tapped start that is refused is still denied', async () => {
      const getUserMedia = vi.fn(() => Promise.reject(new DOMException('no', 'NotAllowedError')));
      const { cam } = setup({ mediaDevices: { getUserMedia } });
      await cam.start();
      expect(cam.snapshot).toMatchObject({ state: 'error', error: 'denied' });
    });

    it('judged by what issued the request: a tap that joined the restart\'s request is not told 權限已被拒絕', async () => {
      const h = heldGetUserMedia();
      const { cam, doc } = setup({ mediaDevices: { getUserMedia: h.getUserMedia } });
      void cam.start();
      h.answer();
      await flush();
      doc.setVisible(false);
      doc.setVisible(true); // the restart asks, without a gesture
      cam.stop(); // ✕
      void cam.start(); // 點擊開啟相機: joins that request
      expect(h.getUserMedia).toHaveBeenCalledTimes(2);
      h.refuse('NotAllowedError');
      await flush();
      expect(cam.snapshot).toMatchObject({ state: 'interrupted', error: null });
    });

    it('and the restart that joined a tapped request still shows the user\'s own 不允許 as denied', async () => {
      const h = heldGetUserMedia();
      const { cam, doc } = setup({ mediaDevices: { getUserMedia: h.getUserMedia } });
      void cam.start(); // the permission prompt is up
      doc.setVisible(false);
      doc.setVisible(true); // the restart joins the tapped request
      expect(h.getUserMedia).toHaveBeenCalledTimes(1);
      h.refuse('NotAllowedError'); // 不允許
      await flush();
      expect(cam.snapshot).toMatchObject({ state: 'error', error: 'denied' });
    });
  });

  describe('background', () => {
    it('going to the background stops the capture; back soon, it restarts by itself', async () => {
      const { cam, doc, video, tracks, getUserMedia } = setup();
      await cam.start();
      doc.setVisible(false);
      // nothing captures while hidden (WK 252465 is left by a capture iOS suspends or kills with the app)
      expect(cam.snapshot).toMatchObject({ state: 'interrupted', error: null, width: 1280, height: 720 });
      expect(tracks[0].readyState).toBe('ended');
      expect(video.srcObject).toBeNull();
      await vi.advanceTimersByTimeAsync(AUTO_RESUME_MS - 1);
      doc.setVisible(true);
      expect(cam.snapshot.state).toBe('starting');
      await flush();
      expect(getUserMedia).toHaveBeenCalledTimes(2);
      expect(cam.snapshot.state).toBe('live');
    });

    it('back after a long time stays interrupted until 恢復相機', async () => {
      const { cam, doc, getUserMedia } = setup();
      await cam.start();
      doc.setVisible(false);
      await vi.advanceTimersByTimeAsync(AUTO_RESUME_MS + 1);
      doc.setVisible(true);
      await flush();
      expect(cam.snapshot.state).toBe('interrupted');
      expect(getUserMedia).toHaveBeenCalledTimes(1);
      await cam.resume();
      expect(getUserMedia).toHaveBeenCalledTimes(2);
      expect(cam.snapshot.state).toBe('live');
    });

    it('to the background while starting: the start is dropped, and back soon it joins the unanswered request', async () => {
      const h = heldGetUserMedia();
      const { cam, doc } = setup({ mediaDevices: { getUserMedia: h.getUserMedia } });
      void cam.start();
      doc.setVisible(false);
      expect(cam.snapshot.state).toBe('interrupted');
      doc.setVisible(true);
      expect(cam.snapshot.state).toBe('starting');
      expect(h.getUserMedia).toHaveBeenCalledTimes(1);
      const t = h.answer();
      await flush();
      expect(cam.snapshot.state).toBe('live');
      expect(t.readyState).toBe('live');
    });

    it('an answer that lands while hidden is stopped (no capture in the background), and the return asks again', async () => {
      const h = heldGetUserMedia();
      const { cam, doc, video } = setup({ mediaDevices: { getUserMedia: h.getUserMedia } });
      void cam.start();
      doc.setVisible(false);
      const late = h.answer();
      await flush();
      expect(late.readyState).toBe('ended');
      expect(video.srcObject).toBeNull();
      expect(cam.snapshot.state).toBe('interrupted');
      doc.setVisible(true);
      expect(h.getUserMedia).toHaveBeenCalledTimes(2);
      h.answer();
      await flush();
      expect(cam.snapshot.state).toBe('live');
    });

    it('hidden during noanswer: back soon, it waits for the same request again', async () => {
      const h = heldGetUserMedia();
      const { cam, doc } = setup({ mediaDevices: { getUserMedia: h.getUserMedia } });
      void cam.start();
      await vi.advanceTimersByTimeAsync(ANSWER_TIMEOUT_MS);
      expect(cam.snapshot.error).toBe('noanswer');
      doc.setVisible(false);
      expect(cam.snapshot).toMatchObject({ state: 'interrupted', error: null });
      doc.setVisible(true);
      expect(cam.snapshot).toMatchObject({ state: 'starting', error: null });
      expect(h.getUserMedia).toHaveBeenCalledTimes(1);
      h.answer();
      await flush();
      expect(cam.snapshot.state).toBe('live');
    });

    it('stop while hidden cancels the automatic restart', async () => {
      const { cam, doc, getUserMedia } = setup();
      await cam.start();
      doc.setVisible(false);
      cam.stop();
      doc.setVisible(true);
      await flush();
      expect(cam.snapshot.state).toBe('idle');
      expect(getUserMedia).toHaveBeenCalledTimes(1);
    });

    it('hidden while idle or after an error does nothing on return', async () => {
      const getUserMedia = vi.fn(() => Promise.reject(new DOMException('no', 'NotAllowedError')));
      const { cam, doc } = setup({ mediaDevices: { getUserMedia } });
      doc.setVisible(false);
      doc.setVisible(true);
      expect(cam.snapshot.state).toBe('idle');
      await cam.start();
      doc.setVisible(false);
      doc.setVisible(true);
      await flush();
      expect(cam.snapshot).toMatchObject({ state: 'error', error: 'denied' });
      expect(getUserMedia).toHaveBeenCalledTimes(1);
    });
  });

  describe('recovery', () => {
    it('mute while visible, auto-unmuted within the grace period, stays live', async () => {
      const { cam, tracks } = setup();
      await cam.start();
      tracks[0].mute();
      await vi.advanceTimersByTimeAsync(300);
      tracks[0].unmute();
      await vi.advanceTimersByTimeAsync(2000);
      expect(cam.snapshot.state).toBe('live');
    });

    it('a capture video WebKit pauses while live is played again, at most once a second', async () => {
      const { cam, video } = setup();
      await cam.start();
      expect(video.plays).toBe(1);
      video.pause();
      expect(video.plays).toBe(2);
      expect(video.paused).toBe(false);
      video.pause(); // the browser pausing it again at once: no play/pause loop, but played at the end of the gap
      video.pause();
      expect(video.plays).toBe(2);
      await vi.advanceTimersByTimeAsync(REPLAY_GAP_MS - 1);
      expect(video.plays).toBe(2);
      await vi.advanceTimersByTimeAsync(1);
      expect(video.plays).toBe(3);
      expect(video.paused).toBe(false);
      await vi.advanceTimersByTimeAsync(10 * REPLAY_GAP_MS);
      expect(video.plays).toBe(3); // playing again: nothing more
    });

    it('a held-back play() is dropped when the camera stops meanwhile', async () => {
      const { cam, video } = setup();
      await cam.start();
      video.pause();
      video.pause();
      cam.stop();
      await vi.advanceTimersByTimeAsync(REPLAY_GAP_MS);
      expect(video.plays).toBe(2);
    });

    it('unmute plays a video paused during the interruption', async () => {
      const { cam, video, tracks } = setup();
      await cam.start();
      tracks[0].mute();
      video.paused = true; // paused by the interruption, no event while muted
      tracks[0].unmute();
      expect(video.plays).toBe(2);
      await vi.advanceTimersByTimeAsync(MUTE_GRACE_MS);
      expect(cam.snapshot.state).toBe('live');
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
      await vi.advanceTimersByTimeAsync(MUTE_GRACE_MS);
      expect(cam.snapshot.state).toBe('interrupted');
    });

    it('the wake lock is released in the background and taken again by the restarted camera', async () => {
      const { cam, doc, wakeLock, sentinels } = setup();
      await cam.start();
      await flush();
      expect(wakeLock.request).toHaveBeenCalledTimes(1);
      doc.setVisible(false);
      expect(sentinels[0].released).toBe(true);
      doc.setVisible(true);
      await flush();
      expect(wakeLock.request).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(MUTE_GRACE_MS);
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

    it('the background stops the check with the capture; the restarted camera checks again from the start', async () => {
      const { cam, doc, sampleMaxLuma } = setup();
      sampleMaxLuma.mockReturnValue(0);
      await cam.start();
      doc.setVisible(false);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(sampleMaxLuma).not.toHaveBeenCalled();
      expect(cam.snapshot.state).toBe('interrupted');
      doc.setVisible(true);
      await flush();
      await vi.advanceTimersByTimeAsync(BLACK_FIRST_CHECK_MS + BLACK_CHECK_INTERVAL_MS);
      expect(sampleMaxLuma).toHaveBeenCalledTimes(2);
      expect(cam.snapshot.state).toBe('live');
    });
  });
});
