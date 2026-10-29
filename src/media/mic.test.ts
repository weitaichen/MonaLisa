import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MIC_ANSWER_MS, MIC_PROMPT_MS, createMic } from './mic';

// ── minimal fakes (no jsdom): the pieces of getUserMedia and MediaStream the microphone touches ──

class FakeTrack {
  readonly kind = 'audio';
  readyState: MediaStreamTrackState = 'live';
  /** stop() was called (not the device ending the track by itself) */
  stopped = false;
  constructor(readonly id: string) {}
  stop() {
    this.stopped = true;
    this.readyState = 'ended';
  }
  /** the device went away by itself, e.g. a headset unplugged */
  end() {
    this.readyState = 'ended';
  }
}

class FakeStream {
  constructor(readonly tracks: FakeTrack[]) {}
  getAudioTracks() {
    return this.tracks;
  }
}

/** a getUserMedia that answers only when told to (the permission prompt can stay up, and WebKit can leave one unanswered) */
function heldGetUserMedia() {
  const pending: { resolve: (s: MediaStream) => void; reject: (e: unknown) => void }[] = [];
  const tracks: FakeTrack[] = [];
  const getUserMedia = vi.fn(
    (_c?: MediaStreamConstraints) =>
      new Promise<MediaStream>((resolve, reject) => {
        pending.push({ resolve, reject });
      }),
  );
  /** answer the oldest unanswered request with a fresh track */
  const answer = () => {
    const p = pending.shift()!;
    const t = new FakeTrack(`m${tracks.length + 1}`);
    tracks.push(t);
    p.resolve(new FakeStream([t]) as unknown as MediaStream);
    return t;
  };
  const refuse = (name = 'NotAllowedError') => pending.shift()!.reject(new DOMException('no', name));
  return { getUserMedia, pending, tracks, answer, refuse };
}

function setup() {
  const h = heldGetUserMedia();
  return { mic: createMic({ getUserMedia: h.getUserMedia }), h };
}

/** whether `p` has settled yet (read it after the microtasks have run) */
function watch(p: Promise<unknown>) {
  const w = { done: false };
  void p.then(() => {
    w.done = true;
  });
  return w;
}

/** let queued promise continuations run (timers are faked) */
const flush = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
});
afterEach(() => {
  vi.useRealTimers();
});

describe('the answer windows', () => {
  it('are 3 s at a record tap and 8 s on entering 錄影, when the permission prompt may be up', () => {
    expect(MIC_ANSWER_MS).toBe(3_000);
    expect(MIC_PROMPT_MS).toBe(8_000);
  });
});

describe('ensure()', () => {
  it('starts idle, holding nothing and asking for nothing', () => {
    const { mic, h } = setup();
    expect(mic.state).toBe('idle');
    expect(mic.tracks()).toEqual([]);
    expect(h.getUserMedia).not.toHaveBeenCalled();
  });

  it('granted: ensure resolves the audio tracks and the state is on', async () => {
    const { mic, h } = setup();
    const p = mic.ensure(MIC_ANSWER_MS);
    expect(mic.state).toBe('asking');
    const t = h.answer();
    await expect(p).resolves.toEqual([t]);
    expect(mic.state).toBe('on');
    expect(mic.tracks()).toEqual([t]);
    expect(t.readyState).toBe('live');
  });

  it('asks for the microphone only, before it returns: still inside the tap that called it', () => {
    const { mic, h } = setup();
    void mic.ensure(MIC_ANSWER_MS);
    // no await yet: a request issued after one would no longer be inside the user gesture
    expect(h.getUserMedia).toHaveBeenCalledTimes(1);
    expect(h.getUserMedia).toHaveBeenCalledWith({ audio: true, video: false });
  });

  describe('refused or missing: [] and off', () => {
    it.each(['NotAllowedError', 'NotFoundError', 'NotReadableError', 'AbortError', 'TypeError'])(
      'refused with %s',
      async (name) => {
        const { mic, h } = setup();
        const p = mic.ensure(MIC_ANSWER_MS);
        h.refuse(name);
        await expect(p).resolves.toEqual([]);
        expect(mic.state).toBe('off');
        expect(mic.tracks()).toEqual([]);
      },
    );

    it.each([
      ['no mediaDevices', undefined],
      ['no getUserMedia', {} as Pick<MediaDevices, 'getUserMedia'>],
    ])('missing: %s', async (_what, md) => {
      const mic = createMic(md);
      await expect(mic.ensure(MIC_ANSWER_MS)).resolves.toEqual([]);
      expect(mic.state).toBe('off');
    });

    it('a getUserMedia that throws instead of rejecting is a refusal too', async () => {
      const getUserMedia = vi.fn((): Promise<MediaStream> => {
        throw new TypeError('boom');
      });
      const mic = createMic({ getUserMedia });
      await expect(mic.ensure(MIC_ANSWER_MS)).resolves.toEqual([]);
      expect(mic.state).toBe('off');
    });
  });

  it('a refusal sets off; the next ensure() asks again', async () => {
    const { mic, h } = setup();
    const first = mic.ensure(MIC_ANSWER_MS);
    h.refuse();
    await first;
    expect(mic.state).toBe('off');

    const second = mic.ensure(MIC_ANSWER_MS);
    expect(h.getUserMedia).toHaveBeenCalledTimes(2);
    expect(mic.state).toBe('asking');
    const t = h.answer();
    await expect(second).resolves.toEqual([t]);
    expect(mic.state).toBe('on');
  });

  it('a record-time ask that does not answer in MIC_ANSWER_MS gives no tracks; a late answer is kept while the mic is held', async () => {
    const { mic, h } = setup();
    const p = mic.ensure(MIC_ANSWER_MS);
    const w = watch(p);
    await vi.advanceTimersByTimeAsync(MIC_ANSWER_MS - 1);
    expect(w.done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(w.done).toBe(true);
    await expect(p).resolves.toEqual([]);
    expect(mic.state).toBe('asking'); // the request is still out

    const t = h.answer(); // 允許, late
    await flush();
    expect(mic.state).toBe('on');
    expect(mic.tracks()).toEqual([t]);
    expect(t.readyState).toBe('live');

    // the next record tap finds it held
    await expect(mic.ensure(MIC_ANSWER_MS)).resolves.toEqual([t]);
    expect(h.getUserMedia).toHaveBeenCalledTimes(1);
  });

  it('two ensure() calls share one request', async () => {
    const { mic, h } = setup();
    const entering = mic.ensure(MIC_PROMPT_MS);
    const tap = mic.ensure(MIC_ANSWER_MS);
    expect(h.getUserMedia).toHaveBeenCalledTimes(1);
    const t = h.answer();
    await expect(entering).resolves.toEqual([t]);
    await expect(tap).resolves.toEqual([t]);
    expect(mic.state).toBe('on');
  });

  it('each ensure() has its own timeout, counted from its own call', async () => {
    const { mic, h } = setup();
    const entering = watch(mic.ensure(MIC_PROMPT_MS)); // t = 0: entering 錄影, the prompt is up
    await vi.advanceTimersByTimeAsync(1_000);
    const tap = watch(mic.ensure(MIC_ANSWER_MS)); // t = 1 s: a record tap joins the same request
    await vi.advanceTimersByTimeAsync(MIC_ANSWER_MS - 1);
    expect([entering.done, tap.done]).toEqual([false, false]);
    await vi.advanceTimersByTimeAsync(1); // t = 4 s
    expect([entering.done, tap.done]).toEqual([false, true]);
    await vi.advanceTimersByTimeAsync(MIC_PROMPT_MS - 1_000 - MIC_ANSWER_MS - 1);
    expect(entering.done).toBe(false);
    await vi.advanceTimersByTimeAsync(1); // t = 8 s
    expect(entering.done).toBe(true);
    expect(h.getUserMedia).toHaveBeenCalledTimes(1);
  });

  it('on a held microphone resolves its tracks at once, without asking again', async () => {
    const { mic, h } = setup();
    const first = mic.ensure(MIC_ANSWER_MS);
    const t = h.answer();
    await first;
    const again = mic.ensure(MIC_ANSWER_MS);
    expect(vi.getTimerCount()).toBe(0); // nothing to wait for
    await expect(again).resolves.toEqual([t]);
    expect(h.getUserMedia).toHaveBeenCalledTimes(1);
    expect(mic.state).toBe('on');
  });

  it('leaves no timer behind once settled by an answer or a refusal', async () => {
    const { mic, h } = setup();
    const granted = mic.ensure(MIC_ANSWER_MS);
    expect(vi.getTimerCount()).toBe(1);
    h.answer();
    await granted;
    expect(vi.getTimerCount()).toBe(0);

    mic.release();
    const refused = mic.ensure(MIC_ANSWER_MS);
    expect(vi.getTimerCount()).toBe(1);
    h.refuse();
    await refused;
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('release()', () => {
  it('release() stops the tracks, goes idle, and the next ensure() asks again', async () => {
    const { mic, h } = setup();
    const p = mic.ensure(MIC_ANSWER_MS);
    const t = h.answer();
    await p;
    mic.release();
    expect(t.stopped).toBe(true);
    expect(mic.state).toBe('idle');
    expect(mic.tracks()).toEqual([]);

    void mic.ensure(MIC_ANSWER_MS);
    expect(h.getUserMedia).toHaveBeenCalledTimes(2);
  });

  it('a late answer after release() is stopped', async () => {
    const { mic, h } = setup();
    void mic.ensure(MIC_ANSWER_MS);
    await vi.advanceTimersByTimeAsync(MIC_ANSWER_MS); // the record tap gave up, the request is still out
    mic.release(); // leaving 錄影
    const t = h.answer();
    await flush();
    expect(t.stopped).toBe(true);
    expect(mic.state).toBe('idle');
    expect(mic.tracks()).toEqual([]);
  });

  it('settles an ensure() that is still waiting with [] at once, and drops its timer', async () => {
    const { mic, h } = setup();
    const p = mic.ensure(MIC_PROMPT_MS);
    const w = watch(p);
    mic.release();
    await flush();
    expect(w.done).toBe(true);
    await expect(p).resolves.toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
    expect(h.getUserMedia).toHaveBeenCalledTimes(1);
  });

  it('is harmless when nothing is held or asked', () => {
    const { mic } = setup();
    mic.release();
    mic.release();
    expect(mic.state).toBe('idle');
    expect(mic.tracks()).toEqual([]);
  });

  // The camera's request ownership: its answer belongs to the generation that asked, unless an ensure() joins the
  // request after the release (as camera.start() joins an unanswered request after a stop()).
  describe('a request still out when release() comes in', () => {
    it('an ensure() after release() joins the request, and the answer is kept for it', async () => {
      const { mic, h } = setup();
      const before = mic.ensure(MIC_PROMPT_MS);
      mic.release(); // ✕ and back in while the prompt is still up
      const after = mic.ensure(MIC_PROMPT_MS);
      expect(h.getUserMedia).toHaveBeenCalledTimes(1);
      expect(mic.state).toBe('asking');

      const t = h.answer();
      await expect(after).resolves.toEqual([t]);
      await expect(before).resolves.toEqual([]); // it was settled when the generation ended
      expect(mic.state).toBe('on');
      expect(mic.tracks()).toEqual([t]);
      expect(t.readyState).toBe('live');
    });

    it('the answer nobody took is stopped, and the next ensure() asks again', async () => {
      const { mic, h } = setup();
      void mic.ensure(MIC_ANSWER_MS);
      mic.release();
      const stale = h.answer();
      await flush();
      expect(stale.stopped).toBe(true);

      const p = mic.ensure(MIC_ANSWER_MS);
      expect(h.getUserMedia).toHaveBeenCalledTimes(2);
      const t = h.answer();
      await expect(p).resolves.toEqual([t]);
      expect(t.stopped).toBe(false);
      expect(mic.state).toBe('on');
    });

    it('a second release() ends that ownership too: the answer is stopped although an ensure() had joined', async () => {
      const { mic, h } = setup();
      void mic.ensure(MIC_ANSWER_MS);
      mic.release();
      void mic.ensure(MIC_ANSWER_MS); // joins the request, takes it
      mic.release(); // and lets it go again
      const t = h.answer();
      await flush();
      expect(t.stopped).toBe(true);
      expect(mic.state).toBe('idle');
    });

    it('a refusal nobody was waiting for leaves the state alone', async () => {
      const { mic, h } = setup();
      void mic.ensure(MIC_ANSWER_MS);
      mic.release();
      h.refuse();
      await flush();
      expect(mic.state).toBe('idle');
    });

    it('a refusal of a request a newer ensure() joined turns the state off', async () => {
      const { mic, h } = setup();
      void mic.ensure(MIC_ANSWER_MS);
      mic.release();
      const p = mic.ensure(MIC_ANSWER_MS);
      h.refuse();
      await expect(p).resolves.toEqual([]);
      expect(mic.state).toBe('off');
    });
  });
});

describe('a held microphone whose tracks ended by themselves', () => {
  it('is no longer held: no tracks, and the state is not on', async () => {
    const { mic, h } = setup();
    const p = mic.ensure(MIC_ANSWER_MS);
    const t = h.answer();
    await p;
    t.end(); // a headset unplugged
    expect(mic.tracks()).toEqual([]);
    expect(mic.state).toBe('idle');
  });

  it('is asked for again by the next ensure(), not handed out dead', async () => {
    const { mic, h } = setup();
    const first = mic.ensure(MIC_ANSWER_MS);
    const dead = h.answer();
    await first;
    dead.end();

    const again = mic.ensure(MIC_ANSWER_MS);
    expect(h.getUserMedia).toHaveBeenCalledTimes(2);
    const t = h.answer();
    await expect(again).resolves.toEqual([t]);
    expect(mic.tracks()).toEqual([t]);
    expect(mic.state).toBe('on');
  });
});

describe('timers', () => {
  it('are the global ones unless given', async () => {
    const h = heldGetUserMedia();
    const mic = createMic({ getUserMedia: h.getUserMedia }); // made under the fake timers
    const w = watch(mic.ensure(MIC_ANSWER_MS));
    await vi.advanceTimersByTimeAsync(MIC_ANSWER_MS);
    expect(w.done).toBe(true);
  });

  it("are called detached from the object they come in, as a browser's setTimeout needs", async () => {
    // like window.setTimeout: "Illegal invocation" when called as a method of another object (here: timers)
    const timers = {
      setTimeout: function (this: unknown, fn: () => void, ms?: number) {
        if (this !== undefined) throw new TypeError('Illegal invocation');
        return setTimeout(fn, ms);
      } as unknown as typeof setTimeout,
      clearTimeout: function (this: unknown, id?: ReturnType<typeof setTimeout>) {
        if (this !== undefined) throw new TypeError('Illegal invocation');
        clearTimeout(id);
      } as unknown as typeof clearTimeout,
    };
    const h = heldGetUserMedia();
    const mic = createMic({ getUserMedia: h.getUserMedia }, timers);
    const p = mic.ensure(MIC_ANSWER_MS); // sets a timer
    const t = h.answer();
    await expect(p).resolves.toEqual([t]); // and clears it
  });

  it('are the ones given: the timeout runs on them', async () => {
    const h = heldGetUserMedia();
    const set = vi.fn((fn: () => void, _ms?: number) => setTimeout(fn, 1)); // the test's own, quicker clock
    const timers = { setTimeout: set as unknown as typeof setTimeout, clearTimeout };
    const mic = createMic({ getUserMedia: h.getUserMedia }, timers);
    const p = mic.ensure(MIC_ANSWER_MS);
    expect(set).toHaveBeenCalledWith(expect.any(Function), MIC_ANSWER_MS);
    await vi.advanceTimersByTimeAsync(1);
    await expect(p).resolves.toEqual([]);
  });
});
