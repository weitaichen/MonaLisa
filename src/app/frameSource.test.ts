import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createVideoFrameSource, type FrameInfo } from './frameSource';
import { FakeVideo, stubRaf } from './testFakes';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('createVideoFrameSource', () => {
  it('uses requestVideoFrameCallback and forwards presentedFrames, mediaTime (the frame’s own timestamp) and presentationTime', () => {
    const clock = vi.spyOn(performance, 'now').mockReturnValue(1000);
    const video = new FakeVideo();
    video.presentLag = 12;
    const src = createVideoFrameSource(video as unknown as HTMLVideoElement);
    expect(src.kind).toBe('rvfc');
    const got: FrameInfo[] = [];
    src.request((i) => got.push(i));
    video.present();
    video.present(); // one-shot: second frame not delivered
    clock.mockRestore();
    expect(got).toHaveLength(1);
    expect(got[0].presentedFrames).toBe(1);
    expect(got[0].mediaTime).toBeCloseTo(0.033, 9);
    // when the frame was handed to the compositor, on performance.now()'s clock (§6.4, round-2 review D3)
    expect(got[0].presentationTime).toBe(988);
  });

  it('keeps at most one pending request and cancels it', () => {
    const video = new FakeVideo();
    const src = createVideoFrameSource(video as unknown as HTMLVideoElement);
    const cb = vi.fn();
    src.request(cb);
    src.request(cb);
    expect(video.pending).toBe(1);
    src.cancel();
    expect(video.pending).toBe(0);
    video.present();
    expect(cb).not.toHaveBeenCalled();
  });

  it('rAF fallback delivers only frames whose currentTime changed and that have data', () => {
    const raf = stubRaf();
    const video = new FakeVideo();
    const src = createVideoFrameSource(video as unknown as HTMLVideoElement, { rvfc: false });
    expect(src.kind).toBe('raf');
    const cb = vi.fn();
    src.request(cb);
    vi.advanceTimersByTime(16);
    expect(cb).toHaveBeenCalledTimes(1); // first frame (currentTime 0 is new)
    src.request(cb);
    vi.advanceTimersByTime(16 * 5);
    expect(cb).toHaveBeenCalledTimes(1); // no new frame yet → keeps polling
    video.currentTime += 0.033;
    video.readyState = 1;
    vi.advanceTimersByTime(16 * 3);
    expect(cb).toHaveBeenCalledTimes(1); // no data
    video.readyState = 4;
    vi.advanceTimersByTime(16);
    expect(cb).toHaveBeenCalledTimes(2);
    expect(cb.mock.calls[1][0].presentedFrames).toBeNull();
    expect(cb.mock.calls[1][0].mediaTime).toBeNull();
    expect(cb.mock.calls[1][0].presentationTime).toBeNull();
    src.request(cb);
    src.cancel();
    expect(raf.pending).toBe(0);
  });

  it('falls back automatically when rVFC is missing', () => {
    stubRaf();
    const video = { readyState: 4, currentTime: 0 } as unknown as HTMLVideoElement;
    expect(createVideoFrameSource(video).kind).toBe('raf');
  });
});
