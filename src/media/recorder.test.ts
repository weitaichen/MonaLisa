import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  STOP_WAIT_MS,
  clipFile,
  pickVideoMime,
  startClipRecorder,
  videoBitrate,
  type ClipResult,
  type RecorderEnv,
} from './recorder';

const MP4_H264 = 'video/mp4;codecs=avc1.42E01E,mp4a.40.2';

// ── minimal fakes (no jsdom): the pieces of MediaRecorder and MediaStream the recorder touches ──

/** Records how it was made and started; the test makes it emit chunks and report the stop, as a browser would. */
class FakeRecorder {
  static last: FakeRecorder;
  mimeType: string;
  state: RecordingState = 'inactive';
  /** the timeslice of each start() */
  starts: (number | undefined)[] = [];
  /** every stop() call, the ones a real recorder refuses (it throws on an inactive one) included */
  stopCalls = 0;
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(
    readonly stream: MediaStream,
    readonly options: MediaRecorderOptions,
  ) {
    this.mimeType = options.mimeType ?? '';
    FakeRecorder.last = this;
  }
  start(timeslice?: number) {
    this.starts.push(timeslice);
    this.state = 'recording';
  }
  stop() {
    this.stopCalls++;
    if (this.state === 'inactive') throw new DOMException('not recording', 'InvalidStateError');
    this.state = 'inactive';
  }
  /** a chunk arrives */
  emit(data: string) {
    this.ondataavailable?.({ data: new Blob([data]) });
  }
  /** the browser reports the stop: after stop(), or on its own (the tracks ended) */
  finish() {
    this.state = 'inactive';
    this.onstop?.();
  }
  fail() {
    this.onerror?.();
  }
}

interface StreamSpec {
  /** the video track's settings; null = no video track */
  video?: MediaTrackSettings | null;
  audio?: boolean;
}

function fakeStream({ video = { width: 1280, height: 720 }, audio = true }: StreamSpec = {}): MediaStream {
  return {
    getVideoTracks: () => (video ? [{ getSettings: () => video }] : []),
    getAudioTracks: () => (audio ? [{}] : []),
  } as unknown as MediaStream;
}

/** the clock is the faked Date and the timers the faked ones: advancing time moves all of them */
function setup(spec?: StreamSpec, mime = MP4_H264) {
  const env: RecorderEnv = {
    MediaRecorder: FakeRecorder as unknown as RecorderEnv['MediaRecorder'],
    now: () => Date.now(),
    setTimeout,
    clearTimeout,
  };
  const stream = fakeStream(spec);
  const clip = startClipRecorder(stream, mime, env);
  return { clip, rec: FakeRecorder.last, stream };
}

/** whether `p` has settled yet (read it after the microtasks have run) */
function watch(p: Promise<unknown>) {
  const w = { done: false };
  void p.then(() => {
    w.done = true;
  });
  return w;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
});
afterEach(() => {
  vi.useRealTimers();
});

describe('pickVideoMime', () => {
  const supportedAmong =
    (...types: string[]) =>
    (type: string) =>
      types.includes(type);

  it('takes H.264 + AAC MP4 first when everything is supported', () => {
    expect(pickVideoMime(() => true)).toBe('video/mp4;codecs=avc1.42E01E,mp4a.40.2');
  });

  it('takes plain video/mp4 when only it and the WebM types are supported', () => {
    expect(pickVideoMime(supportedAmong('video/mp4', 'video/webm;codecs=vp8,opus', 'video/webm'))).toBe('video/mp4');
  });

  it('takes WebM VP8 + Opus when no MP4 is supported', () => {
    const webm = supportedAmong('video/webm;codecs=vp8,opus', 'video/webm');
    expect(pickVideoMime(webm)).toBe('video/webm;codecs=vp8,opus');
  });

  it('is null when nothing is supported', () => {
    expect(pickVideoMime(() => false)).toBeNull();
  });

  it('goes down the list in order, one entry at a time', () => {
    const list = [
      'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
      'video/mp4;codecs=avc1,mp4a.40.2',
      'video/mp4',
      'video/webm;codecs=vp8,opus',
      'video/webm',
    ];
    list.forEach((type, i) => expect(pickVideoMime(supportedAmong(...list.slice(i)))).toBe(type));
  });
});

describe('videoBitrate', () => {
  it('is 0.1 bit per pixel per frame at 30 fps', () => {
    expect(videoBitrate(1080, 1440)).toBe(4_665_600);
    expect(videoBitrate(1280, 720)).toBe(2_764_800);
  });

  it('is at least 2 Mbps', () => {
    expect(videoBitrate(320, 240)).toBe(2_000_000);
  });

  it('is at most 6 Mbps', () => {
    expect(videoBitrate(1080, 1920)).toBe(6_000_000);
  });
});

describe('startClipRecorder', () => {
  it('starts one-second chunks of the given MIME, with the bitrates of the stream size', () => {
    const { rec, stream } = setup();
    expect(rec.stream).toBe(stream);
    expect(rec.options).toEqual({
      mimeType: MP4_H264,
      videoBitsPerSecond: videoBitrate(1280, 720),
      audioBitsPerSecond: 128_000,
    });
    expect(rec.starts).toEqual([1000]);
  });

  it.each([
    [1080, 1920, 6_000_000],
    [320, 240, 2_000_000],
    [1080, 1440, 4_665_600],
  ])('reads the size from the video track: %i×%i is %i bit/s', (width, height, bps) => {
    const { rec } = setup({ video: { width, height } });
    expect(rec.options.videoBitsPerSecond).toBe(bps);
  });

  it.each([
    ['no video track', null],
    ['no size in the settings', {}],
    ['only half of a size', { width: 1080 }],
  ])('assumes 1280×720 with %s', (_what, video) => {
    const { rec } = setup({ video });
    expect(rec.options.videoBitsPerSecond).toBe(videoBitrate(1280, 720));
  });

  it('stop() stops the recorder and resolves on onstop with every non-empty chunk', async () => {
    const { clip, rec } = setup();
    rec.emit('aa');
    rec.emit(''); // an empty chunk is no data
    rec.emit('bbb');
    await vi.advanceTimersByTimeAsync(3_500);
    const p = clip.stop();
    const w = watch(p);
    expect(rec.stopCalls).toBe(1);
    await vi.advanceTimersByTimeAsync(500);
    expect(w.done).toBe(false); // waits for onstop
    rec.emit('c'); // the last chunk comes with the stop
    rec.finish();
    const r = await p;
    expect(await r.blob.text()).toBe('aabbbc');
    expect(r.blob.type).toBe('video/mp4');
    expect(r.mime).toBe('video/mp4');
    expect(r.durationMs).toBe(3_500); // to the stop() call, not to the late onstop
    expect(r.hasAudio).toBe(true);
  });

  it.each([true, false])("hasAudio follows the stream's audio track (%s)", async (audio) => {
    const { clip, rec } = setup({ audio });
    const p = clip.stop();
    rec.finish();
    expect((await p).hasAudio).toBe(audio);
  });

  it.each([
    [MP4_H264, 'video/mp4'],
    ['video/webm;codecs=vp8,opus', 'video/webm'],
    ['video/webm', 'video/webm'],
  ])('types a clip recorded as %s as %s, without codecs', async (asked, mime) => {
    const { clip, rec } = setup(undefined, asked);
    rec.emit('aa');
    const p = clip.stop();
    rec.finish();
    const r = await p;
    expect(r.mime).toBe(mime);
    expect(r.blob.type).toBe(mime);
  });

  it('types a clip by what the recorder says it records, else by what was asked for', async () => {
    const said = setup();
    said.rec.mimeType = 'video/webm;codecs="vp8, opus"';
    const p1 = said.clip.stop();
    said.rec.finish();
    expect((await p1).mime).toBe('video/webm');

    const silent = setup();
    silent.rec.mimeType = '';
    const p2 = silent.clip.stop();
    silent.rec.finish();
    expect((await p2).mime).toBe('video/mp4');
  });

  it('leaves no timer behind once onstop has settled stop()', async () => {
    const { clip, rec } = setup();
    const p = clip.stop();
    expect(vi.getTimerCount()).toBe(1);
    rec.finish();
    await p;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('stop() resolves from the chunks after STOP_WAIT_MS when onstop never fires', async () => {
    const { clip, rec } = setup();
    rec.emit('aa');
    rec.emit('b');
    await vi.advanceTimersByTimeAsync(2_000);
    const p = clip.stop();
    const w = watch(p);
    await vi.advanceTimersByTimeAsync(STOP_WAIT_MS - 1);
    expect(w.done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(w.done).toBe(true);
    const r = await p;
    expect(await r.blob.text()).toBe('aab');
    expect(r.durationMs).toBe(2_000); // the wait is not part of the clip
  });

  it("calls the timers detached from env, as a browser's setTimeout needs", async () => {
    // like window.setTimeout: "Illegal invocation" when called as a method of another object (here: env)
    const env: RecorderEnv = {
      MediaRecorder: FakeRecorder as unknown as RecorderEnv['MediaRecorder'],
      now: () => Date.now(),
      setTimeout: function (this: unknown, fn: () => void, ms?: number) {
        if (this !== undefined) throw new TypeError('Illegal invocation');
        return setTimeout(fn, ms);
      } as unknown as typeof setTimeout,
      clearTimeout: function (this: unknown, id?: ReturnType<typeof setTimeout>) {
        if (this !== undefined) throw new TypeError('Illegal invocation');
        clearTimeout(id);
      } as unknown as typeof clearTimeout,
    };
    const clip = startClipRecorder(fakeStream(), MP4_H264, env);
    const p = clip.stop();
    FakeRecorder.last.finish();
    await expect(p).resolves.toMatchObject({ mime: 'video/mp4' });
  });

  it('a recorder whose stop() throws still resolves from the chunks after STOP_WAIT_MS', async () => {
    const { clip, rec } = setup();
    rec.emit('aa');
    rec.stop = () => {
      throw new DOMException('broken', 'InvalidStateError');
    };
    const p = clip.stop();
    await vi.advanceTimersByTimeAsync(STOP_WAIT_MS);
    expect(await (await p).blob.text()).toBe('aa');
  });

  it('a second stop() returns the same promise and stops the recorder once', async () => {
    const { clip, rec } = setup();
    const a = clip.stop();
    expect(clip.stop()).toBe(a);
    rec.finish();
    await a;
    expect(clip.stop()).toBe(a);
    expect(rec.stopCalls).toBe(1);
  });

  describe('a recorder that stopped by itself (its tracks ended)', () => {
    it('is not stopped again; stop() resolves at once, with the duration up to the stop', async () => {
      const { clip, rec } = setup();
      rec.emit('aa');
      await vi.advanceTimersByTimeAsync(2_500);
      rec.finish();
      await vi.advanceTimersByTimeAsync(4_000);
      const p = clip.stop();
      const w = watch(p);
      await vi.advanceTimersByTimeAsync(0);
      expect(w.done).toBe(true);
      expect(rec.stopCalls).toBe(0);
      const r = await p;
      expect(await r.blob.text()).toBe('aa');
      expect(r.durationMs).toBe(2_500);
    });

    it('is not stopped while its state is inactive; stop() waits for the stop event still to come', async () => {
      const { clip, rec } = setup();
      rec.emit('aa');
      rec.state = 'inactive'; // the stop event is not delivered yet
      const p = clip.stop();
      const w = watch(p);
      expect(rec.stopCalls).toBe(0);
      await vi.advanceTimersByTimeAsync(STOP_WAIT_MS - 1);
      expect(w.done).toBe(false);
      rec.finish();
      await vi.advanceTimersByTimeAsync(0);
      expect(w.done).toBe(true);
      expect(await (await p).blob.text()).toBe('aa');
    });
  });

  describe('an error event', () => {
    it('stops the recorder and keeps the chunks; a later stop() resolves at once with them', async () => {
      const { clip, rec } = setup();
      rec.emit('aa');
      await vi.advanceTimersByTimeAsync(1_500);
      rec.fail();
      expect(rec.stopCalls).toBe(1);
      await vi.advanceTimersByTimeAsync(200);
      rec.finish(); // its stop event follows
      await vi.advanceTimersByTimeAsync(10_000); // and the tap on stop comes much later
      const p = clip.stop();
      const w = watch(p);
      await vi.advanceTimersByTimeAsync(0);
      expect(w.done).toBe(true);
      expect(rec.stopCalls).toBe(1); // not stopped twice
      const r = await p;
      expect(await r.blob.text()).toBe('aa');
      expect(r.durationMs).toBe(1_500); // the clip ended at the error, not at the stop event or the tap
    });

    it('without a stop event after it, stop() resolves from the chunks after STOP_WAIT_MS', async () => {
      const { clip, rec } = setup();
      rec.emit('aa');
      await vi.advanceTimersByTimeAsync(1_000);
      rec.fail();
      await vi.advanceTimersByTimeAsync(4_000);
      const p = clip.stop();
      const w = watch(p);
      expect(rec.stopCalls).toBe(1); // the error stopped it already
      await vi.advanceTimersByTimeAsync(STOP_WAIT_MS - 1);
      expect(w.done).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(w.done).toBe(true);
      const r = await p;
      expect(await r.blob.text()).toBe('aa');
      expect(r.durationMs).toBe(1_000);
    });
  });

  // The camera shows 「● 00:12」 over the recording; `ended` is how it learns the recording is over without stop().
  describe('ended', () => {
    it('resolves on an error before any stop(), and stop() still hands out the chunks', async () => {
      const { clip, rec } = setup();
      const w = watch(clip.ended);
      rec.emit('aa');
      await vi.advanceTimersByTimeAsync(1_500);
      expect(w.done).toBe(false);
      rec.fail();
      await vi.advanceTimersByTimeAsync(0);
      expect(w.done).toBe(true); // no stop() yet
      const p = clip.stop();
      rec.finish();
      const r = await p;
      expect(await r.blob.text()).toBe('aa');
      expect(r.durationMs).toBe(1_500);
    });

    it('resolves when the browser stops by itself', async () => {
      const { clip, rec } = setup();
      const w = watch(clip.ended);
      await vi.advanceTimersByTimeAsync(2_500);
      expect(w.done).toBe(false);
      rec.finish(); // the tracks ended: a stop event nobody asked for
      await vi.advanceTimersByTimeAsync(0);
      expect(w.done).toBe(true);
      expect(rec.stopCalls).toBe(0); // and no stop() was called
    });

    it('resolves on stop(), at the call and not at the late onstop', async () => {
      const { clip, rec } = setup();
      const w = watch(clip.ended);
      const p = clip.stop();
      await vi.advanceTimersByTimeAsync(0);
      expect(w.done).toBe(true); // the stop event has not come yet
      rec.finish();
      await p;
    });

    it('stays pending while the recording runs', async () => {
      const { clip, rec } = setup();
      const w = watch(clip.ended);
      rec.emit('aa'); // a chunk is no end
      await vi.advanceTimersByTimeAsync(10_000);
      rec.emit('bb');
      await vi.advanceTimersByTimeAsync(10_000);
      expect(w.done).toBe(false);
    });

    it('is one promise however often it is read', () => {
      const { clip } = setup();
      expect(clip.ended).toBeInstanceOf(Promise);
      expect(clip.ended).toBe(clip.ended);
    });
  });
});

describe('clipFile', () => {
  const resultOf = (mime: string): ClipResult => ({
    blob: new Blob(['xyz'], { type: mime }),
    mime,
    durationMs: 2_000,
    hasAudio: true,
  });
  const d = new Date(2026, 9, 29, 8, 5, 3);

  it('wraps an mp4 result as a .mp4 File of type video/mp4, named like the photos', async () => {
    const f = clipFile(resultOf('video/mp4'), d);
    expect(f.name).toBe('meiyan-20261029-080503.mp4');
    expect(f.type).toBe('video/mp4');
    expect(f.lastModified).toBe(d.getTime());
    expect(await f.text()).toBe('xyz');
  });

  it('wraps a webm result as a .webm File of type video/webm', async () => {
    const f = clipFile(resultOf('video/webm'), d);
    expect(f.name).toBe('meiyan-20261029-080503.webm');
    expect(f.type).toBe('video/webm');
    expect(await f.text()).toBe('xyz');
  });

  it('is named for now by default', () => {
    expect(clipFile(resultOf('video/mp4')).name).toMatch(/^meiyan-\d{8}-\d{6}\.mp4$/);
  });
});
