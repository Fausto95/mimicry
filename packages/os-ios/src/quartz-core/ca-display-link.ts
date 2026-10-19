import type { FrameTask, Kernel } from '@mimicry/os-core';
import { RunLoop, RunLoopMode, type RunLoopSource } from '../foundation/run-loop';
import { CAEnvironment, mediaNow } from './ca-media-time';

/**
 * CADisplayLink: a callback on every display refresh while it is on a run
 * loop and not paused. `timestamp` is the media time of the frame being
 * prepared, `targetTimestamp` when the next one is due, `duration` the
 * refresh interval. preferredFramesPerSecond / preferredFrameRateRange
 * throttle the callback to a divisor of the display rate.
 *
 * Swift's `CADisplayLink(target:selector:)` takes a callback here.
 */
export class CADisplayLink implements FrameTask, RunLoopSource {
  private _isPaused = false;
  preferredFramesPerSecond = 0;
  preferredFrameRateRange: { minimum: number; maximum: number; preferred?: number } | null = null;
  private _timestamp = 0;
  private _duration = 1 / 60;
  private last: number | null = null;
  private lastFired: number | null = null;
  private scheduled = false;
  private valid = true;
  private readonly kernel: Kernel | null;

  constructor(private readonly callback: (link: CADisplayLink) => void) {
    this.kernel = CAEnvironment.kernel;
  }

  /** A paused link asks for no frames (the display may idle). */
  get isPaused(): boolean {
    return this._isPaused;
  }

  set isPaused(paused: boolean) {
    this._isPaused = paused;
    if (paused || !this.scheduled) return;
    this.last = null;
    this._schedule();
  }

  get timestamp(): number {
    return this._timestamp;
  }

  get targetTimestamp(): number {
    return this._timestamp + this._duration;
  }

  /** seconds between display refreshes */
  get duration(): number {
    return this._duration;
  }

  /** add(to:forMode:) */
  add(to: RunLoop = RunLoop.main, forMode: RunLoopMode = RunLoopMode.common): void {
    if (!this.valid) return;
    to.add(this, forMode);
  }

  /** remove(from:forMode:) */
  remove(from: RunLoop = RunLoop.main, _forMode: RunLoopMode = RunLoopMode.common): void {
    from._remove(this);
  }

  /** Stop for good: the link leaves its run loop. */
  invalidate(): void {
    this.valid = false;
    RunLoop.main._remove(this);
  }

  _schedule(): void {
    this.scheduled = true;
    if (!this.kernel) return;
    this.kernel.animator.add(this);
    this.kernel.requestFrame();
  }

  _unschedule(): void {
    this.scheduled = false;
    this.kernel?.animator.remove(this);
  }

  tick(): boolean {
    if (!this.scheduled || !this.valid) return false;
    const now = mediaNow(this.kernel) / 1000;
    if (this.last !== null && now > this.last) this._duration = now - this.last;
    this.last = now;
    if (this._isPaused) return false;
    const fps = this.preferredFrameRateRange?.preferred ?? this.preferredFramesPerSecond;
    // Throttled links skip refreshes until a frame of their rate is due (half a refresh of slack).
    if (fps > 0 && this.lastFired !== null && now - this.lastFired < 1 / fps - this._duration / 2) return true;
    this.lastFired = now;
    this._timestamp = now;
    this.callback(this);
    return this.scheduled && this.valid;
  }
}
