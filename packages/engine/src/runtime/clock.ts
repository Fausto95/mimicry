/**
 * Time sources. In the browser the host's vsync drives frames and timers are
 * real. Under test the VirtualClock owns time: frames, timers and animations
 * advance only when the runner says so, which is what makes filmstrips
 * reproducible frame for frame.
 */
export interface Clock {
  now(): number;
  setTimeout(fn: () => void, ms?: number): unknown;
  clearTimeout(handle: unknown): void;
  setInterval(fn: () => void, ms?: number): unknown;
  clearInterval(handle: unknown): void;
}

const perfNow = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export class RealClock implements Clock {
  now(): number {
    return perfNow();
  }
  setTimeout(fn: () => void, ms?: number): unknown {
    return setTimeout(fn, ms);
  }
  clearTimeout(handle: unknown): void {
    clearTimeout(handle as ReturnType<typeof setTimeout>);
  }
  setInterval(fn: () => void, ms?: number): unknown {
    return setInterval(fn, ms);
  }
  clearInterval(handle: unknown): void {
    clearInterval(handle as ReturnType<typeof setInterval>);
  }
}

interface Timer {
  id: number;
  at: number;
  fn: () => void;
  interval: number | null;
}

export class VirtualClock implements Clock {
  private time: number;
  private timers: Timer[] = [];
  private nextId = 1;

  constructor(start = 0) {
    this.time = start;
  }

  now(): number {
    return this.time;
  }

  setTimeout(fn: () => void, ms = 0): unknown {
    const timer = { id: this.nextId++, at: this.time + Math.max(0, ms), fn, interval: null };
    this.insert(timer);
    return timer.id;
  }

  setInterval(fn: () => void, ms = 0): unknown {
    const interval = Math.max(1, ms);
    const timer = { id: this.nextId++, at: this.time + interval, fn, interval };
    this.insert(timer);
    return timer.id;
  }

  clearTimeout(handle: unknown): void {
    this.timers = this.timers.filter((t) => t.id !== handle);
  }

  clearInterval(handle: unknown): void {
    this.clearTimeout(handle);
  }

  private insert(timer: Timer): void {
    const i = this.timers.findIndex((t) => t.at > timer.at);
    if (i < 0) this.timers.push(timer);
    else this.timers.splice(i, 0, timer);
  }

  /** time of the next pending timer, if any */
  get nextTimerAt(): number | null {
    return this.timers[0]?.at ?? null;
  }

  get pendingTimers(): number {
    return this.timers.length;
  }

  /**
   * Fire every timer due up to `until` (in order), moving time forward to
   * each timer's deadline as it fires. `run` wraps each callback (the test
   * harness uses it to flush React work).
   */
  runUntil(until: number, run: (fn: () => void) => void = (fn) => fn()): void {
    for (;;) {
      const next = this.timers[0];
      if (!next || next.at > until) break;
      this.timers.shift();
      this.time = Math.max(this.time, next.at);
      if (next.interval !== null) this.insert({ ...next, at: next.at + next.interval });
      run(next.fn);
    }
    this.time = Math.max(this.time, until);
  }
}
