/**
 * RunLoop: the main thread's run loop, as far as apps address it — a place
 * to add timers and display links, in a mode. There is one thread, and its
 * run loop is the kernel's frame loop plus its deferred queue, so every
 * mode behaves like `.common` (Mimicry never runs in UITrackingRunLoopMode
 * alone; a timer added in `.default` keeps firing while a scroll view tracks).
 */
export enum RunLoopMode {
  default = 'kCFRunLoopDefaultMode',
  common = 'kCFRunLoopCommonModes',
  tracking = 'UITrackingRunLoopMode',
}

/** Something a run loop drives (Timer, CADisplayLink). */
export interface RunLoopSource {
  /** @internal scheduled on the run loop */
  _schedule(): void;
  /** @internal removed from the run loop */
  _unschedule(): void;
}

export class RunLoop {
  private static readonly mainLoop = new RunLoop();
  private readonly sources = new Set<RunLoopSource>();

  static get main(): RunLoop {
    return RunLoop.mainLoop;
  }

  static get current(): RunLoop {
    return RunLoop.mainLoop;
  }

  get currentMode(): RunLoopMode | null {
    return RunLoopMode.default;
  }

  /** add(_:forMode:) for timers */
  add(source: RunLoopSource, _mode: RunLoopMode = RunLoopMode.default): void {
    if (this.sources.has(source)) return;
    this.sources.add(source);
    source._schedule();
  }

  /** @internal a source stopped (invalidated, removed) */
  _remove(source: RunLoopSource): void {
    if (this.sources.delete(source)) source._unschedule();
  }
}
