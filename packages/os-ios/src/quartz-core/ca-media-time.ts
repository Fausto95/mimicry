import type { Kernel } from '@mimicry/os-core';

/**
 * Core Animation's clock: CACurrentMediaTime(), in seconds.
 *
 * It follows the kernel's clock (virtual under test, the host's vsync time
 * in a browser) and runs slower when the host slows animations down. It is
 * not the animator's `animationTime`, which clamps long gaps between frames:
 * an animation committed after the app sat idle must start when it was
 * committed, not a quarter second into its curve.
 */
class MediaClock {
  private last: number;
  private media: number;

  constructor(private readonly kernel: Kernel) {
    this.last = kernel.clock.now();
    this.media = this.last;
  }

  /** milliseconds */
  now(): number {
    const t = this.kernel.clock.now();
    if (t > this.last) this.media += (t - this.last) / this.kernel.animator.timeScale;
    this.last = Math.max(this.last, t);
    return this.media;
  }
}

const clocks = new WeakMap<Kernel, MediaClock>();

/** The device Core Animation runs on (set when UIApplication starts). */
export const CAEnvironment = {
  kernel: null as Kernel | null,
};

export function mediaClock(kernel: Kernel): MediaClock {
  let clock = clocks.get(kernel);
  if (!clock) clocks.set(kernel, (clock = new MediaClock(kernel)));
  return clock;
}

/** Media time in milliseconds on `kernel` (the current application's when omitted). */
export function mediaNow(kernel: Kernel | null = CAEnvironment.kernel): number {
  return kernel ? mediaClock(kernel).now() : 0;
}

/** CACurrentMediaTime(): seconds on Core Animation's clock. */
export function CACurrentMediaTime(): number {
  return mediaNow() / 1000;
}

/** The kernel a layer tree belongs to: its window's, else the running application's. */
export function kernelOf(host: unknown): Kernel | null {
  if (host && typeof host === 'object' && 'animator' in host && 'clock' in host) return host as Kernel;
  return CAEnvironment.kernel;
}

/**
 * Run `fn` on the main queue after the current task (DispatchQueue.main.async):
 * the kernel's deferred queue, with a frame asked for so a headless host
 * drains it on the next vsync even when nothing else is going on.
 */
export function mainQueueAsync(fn: () => void, kernel: Kernel | null = CAEnvironment.kernel): void {
  if (!kernel) {
    queueMicrotask(fn);
    return;
  }
  kernel.defer(fn);
  kernel.requestFrame();
}
