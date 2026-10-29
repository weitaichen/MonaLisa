// Beauty video microphone (beauty-video spec §4.2): the one getUserMedia request for a clip's sound. Every caller
// waits a bounded time for it, a later caller joins a request still out, and a release never leaves a stream behind.
// `state` says truthfully whether a request is out, which the camera needs: WebKit answers getUserMedia one request at
// a time, so a camera request behind an unanswered microphone one hangs (the 0.5.1 fix).
// Pure: the media devices and the timers come in as parameters, so a test needs no browser.

/** A record tap waits this long for the microphone; then the clip goes ahead without sound. */
export const MIC_ANSWER_MS = 3_000;
/** Entering 錄影 waits this long: the permission prompt may be up. */
export const MIC_PROMPT_MS = 8_000;

/**
 * - idle: nothing held, no request out
 * - asking: a getUserMedia for audio is out, whether or not anyone still waits for it; it cannot be cancelled, so
 *   release() leaves this state until the browser answers
 * - on: the microphone is held
 * - off: refused or missing; the next ensure() asks again
 */
export type MicState = 'idle' | 'asking' | 'on' | 'off';

export interface Mic {
  /**
   * Reading it notices a held stream whose tracks all ended by themselves: that drop to 'idle' is announced. tracks()
   * and ensure() notice it too, and announce it the same way.
   */
  readonly state: MicState;
  /**
   * Run `fn` with the new state after every change of `state`, inside the call that changed it. Not on subscribe, and
   * not when the state is set to the value it already has. A listener that throws is ignored. Returns the function that
   * unsubscribes. The listeners are a set: the same function subscribed twice is one listener, run once. A listener
   * should only observe: one that calls ensure() or release() changes the state inside that round, so the listeners
   * after it may end on a stale state.
   */
  subscribe(fn: (state: MicState) => void): () => void;
  /** the held live audio tracks; none unless the state is 'on' (a held stream found dead is dropped, as for `state`) */
  tracks(): MediaStreamTrack[];
  /**
   * The microphone's live audio tracks, asked for when it is not held. Call it inside the tap: getUserMedia is issued
   * before this returns, which is what lets iOS show its prompt. Never rejects.
   * - One request at a time: a call while one is out joins it, however old (WebKit answers them in turn, so a second
   *   one would only queue behind it).
   * - Resolves `[]` on a refusal, with no media devices, `timeoutMs` after this call without an answer, and when
   *   release() comes first.
   * - The request outlives a call that gave up. Its late answer is kept (the microphone is then held), unless
   *   release() came in between and no ensure() has joined the request since: then it is stopped.
   */
  ensure(timeoutMs: number): Promise<MediaStreamTrack[]>;
  /**
   * Stop the tracks, settle the waiting ensure() calls with `[]` and go idle. A request still out stays 'asking' until
   * it settles (then idle, unless an ensure() has joined it since).
   */
  release(): void;
}

/** One getUserMedia call (it cannot be cancelled); `owner` is the generation of the ensure() that joined it last. */
interface MicRequest {
  /** settles once the answer is kept or stopped and `state` follows it; never rejects */
  done: Promise<void>;
  owner: number;
}

export function createMic(
  md: Pick<MediaDevices, 'getUserMedia'> | undefined,
  timers: { setTimeout: typeof setTimeout; clearTimeout: typeof clearTimeout } = { setTimeout, clearTimeout },
): Mic {
  // called detached: the browser's setTimeout throws "Illegal invocation" as a method of another object
  const { setTimeout, clearTimeout } = timers;

  /** 'asking' exactly while `request` is out; written by set() only */
  let state: MicState = 'idle';
  /** held while the state is 'on' */
  let stream: MediaStream | null = null;
  /** bumps on every release(): a request is kept only for the generation that last asked for it */
  let gen = 0;
  /** the getUserMedia still unanswered */
  let request: MicRequest | null = null;
  /** the ensure() calls still waiting; each settles itself with [] */
  const waiting = new Set<() => void>();
  /** a set: subscribing the same function again adds nothing */
  const listeners = new Set<(state: MicState) => void>();

  /**
   * The one place `state` is written: the listeners hear a change, never a repeat. It is the last step of whatever
   * changed the state, so a listener finds the module consistent.
   */
  function set(next: MicState): void {
    if (state === next) return;
    state = next;
    for (const fn of [...listeners]) {
      try {
        fn(next);
      } catch {
        /* no reportError in this module: a listener's own fault must not stop the others or the microphone */
      }
    }
  }

  function subscribe(fn: (state: MicState) => void): () => void {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  }

  /** Stop the held stream and forget it. */
  function dropStream(): void {
    if (stream) stopTracks(stream);
    stream = null;
  }

  /**
   * The held stream's live audio tracks. A stream whose tracks all ended by themselves (a headset unplugged) is not
   * held any more: it is dropped here, so the next ensure() asks again instead of handing out a silent stream.
   */
  function liveTracks(): MediaStreamTrack[] {
    if (!stream) return [];
    const live = stream.getAudioTracks().filter((t) => t.readyState !== 'ended');
    if (live.length === 0) {
      dropStream();
      set('idle');
    }
    return live;
  }

  function ask(device: Pick<MediaDevices, 'getUserMedia'>): MicRequest {
    let answer: Promise<MediaStream>;
    try {
      answer = Promise.resolve(device.getUserMedia({ audio: true, video: false }));
    } catch (e) {
      answer = Promise.reject(e); // a getUserMedia that throws is a refusal too
    }
    const req: MicRequest = {
      owner: gen,
      done: answer.then(
        (s) => {
          if (request === req) request = null;
          // released while it was out, and no ensure() joined it since: the stream is nobody's
          if (req.owner !== gen) {
            stopTracks(s);
            set('idle');
            return;
          }
          stream = s;
          set('on');
        },
        () => {
          if (request === req) request = null;
          // a refusal of a request nobody wants any more says nothing about the microphone now: idle, not off
          set(req.owner === gen ? 'off' : 'idle');
        },
      ),
    };
    return req;
  }

  function ensure(timeoutMs: number): Promise<MediaStreamTrack[]> {
    const live = liveTracks();
    if (live.length > 0) return Promise.resolve(live);
    if (!md || typeof md.getUserMedia !== 'function') {
      set('off');
      return Promise.resolve([]);
    }
    // Before anything async, so a tap's ensure() asks while the user gesture is still active (the iOS prompt).
    const req = (request ??= ask(md));
    // A request that outlived a release() now belongs to the generation that asks for it again.
    req.owner = gen;
    const answer = new Promise<MediaStreamTrack[]>((resolve) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const settle = (tracks: MediaStreamTrack[]) => {
        clearTimeout(timer);
        waiting.delete(giveUp);
        resolve(tracks);
      };
      // the timeout and release() give up; an answer settles with what is held by then
      const giveUp = () => settle([]);
      waiting.add(giveUp);
      timer = setTimeout(giveUp, timeoutMs);
      void req.done.then(() => settle(liveTracks()));
    });
    // last, after the call is registered: a listener finds the module consistent (one that broke the observe-only
    // contract with a release() would still settle this call)
    set('asking');
    return answer;
  }

  function release(): void {
    gen++;
    dropStream();
    // they asked in the generation that just ended: they get no tracks of a later one
    for (const giveUp of [...waiting]) giveUp();
    // a request still out cannot be cancelled: its state is 'asking' until it settles
    set(request ? 'asking' : 'idle');
  }

  return {
    get state() {
      liveTracks(); // a stream that ended by itself is not 'on'
      return state;
    },
    subscribe,
    tracks: liveTracks,
    ensure,
    release,
  };
}

function stopTracks(s: MediaStream): void {
  s.getAudioTracks().forEach((t) => t.stop());
}
