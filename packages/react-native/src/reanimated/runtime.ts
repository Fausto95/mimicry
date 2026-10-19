import type { Engine, FrameTask } from '@mimicry/react-native-fabric';
import { maybeEngine } from '../engine-ref';

/**
 * The "UI runtime". On a device Reanimated runs worklets on the UI thread;
 * Mimicry has one thread, so the UI runtime is a single engine frame task
 * that, every frame:
 *
 *   1. runs queued UI work (runOnUI / scheduleOnUI),
 *   2. steps every running driver (shared-value animations, layout and CSS
 *      animations, frame callbacks) at the frame's animation time,
 *   3. re-runs mappers (useAnimatedStyle / useDerivedValue / reactions)
 *      whose shared-value inputs changed, until nothing is dirty.
 *
 * Shared values set from React code therefore reach the screen on the next
 * frame, like Reanimated. Time is the engine animator's clock, so headless
 * runs on the virtual clock are deterministic and "slow animations" works.
 */

/** Anything stepped once per frame; return false when finished. */
export interface Driver {
  step(now: number): boolean;
}

/** A computation re-run when shared values it read change. */
export class Mapper {
  /** shared values read during the last run */
  deps = new Set<Trackable>();
  active = true;

  constructor(private readonly body: () => void) {}

  run(): void {
    if (!this.active) return;
    for (const d of this.deps) d.removeDependent(this);
    this.deps.clear();
    const previous = currentMapper;
    currentMapper = this;
    try {
      this.body();
    } finally {
      currentMapper = previous;
    }
    for (const d of this.deps) d.addDependent(this);
  }

  stop(): void {
    this.active = false;
    for (const d of this.deps) d.removeDependent(this);
    this.deps.clear();
    uiRuntime().forget(this);
  }
}

export interface Trackable {
  addDependent(mapper: Mapper): void;
  removeDependent(mapper: Mapper): void;
}

let currentMapper: Mapper | null = null;

/** Record that the running mapper (if any) read `value`. */
export function track(value: Trackable): void {
  currentMapper?.deps.add(value);
}

/** Run `fn` without recording reads into the current mapper. */
export function untracked<T>(fn: () => T): T {
  const previous = currentMapper;
  currentMapper = null;
  try {
    return fn();
  } finally {
    currentMapper = previous;
  }
}

class UIRuntime implements FrameTask {
  private readonly drivers = new Set<Driver>();
  private readonly dirty = new Set<Mapper>();
  private queue: Array<() => void> = [];
  private after: Array<() => void> = [];
  private inFrame = false;
  private frameTime = 0;

  constructor(readonly engine: Engine | null) {}

  /** Current UI time in ms: the frame being produced, else the last frame's. */
  now(): number {
    if (this.inFrame) return this.frameTime;
    return this.engine?.animator.animationTime ?? 0;
  }

  get insideFrame(): boolean {
    return this.inFrame;
  }

  addDriver(driver: Driver): void {
    this.drivers.add(driver);
    this.wake();
  }

  removeDriver(driver: Driver): void {
    this.drivers.delete(driver);
  }

  hasDriver(driver: Driver): boolean {
    return this.drivers.has(driver);
  }

  markDirty(mapper: Mapper): void {
    this.dirty.add(mapper);
    this.wake();
  }

  forget(mapper: Mapper): void {
    this.dirty.delete(mapper);
  }

  /** Queue work for the start of the next frame (runOnUI). */
  enqueue(job: () => void): void {
    this.queue.push(job);
    this.wake();
  }

  /** Run once at the end of the current frame (coalesced view updates). */
  afterFrame(job: () => void): void {
    if (this.inFrame) this.after.push(job);
    else job();
  }

  private wake(): void {
    const engine = this.engine;
    if (!engine) return;
    if (!engine.animator.has(this)) engine.animator.add(this);
    if (!this.inFrame) engine.requestFrame();
  }

  tick(animationTime: number): boolean {
    this.inFrame = true;
    this.frameTime = animationTime;
    try {
      const jobs = this.queue;
      this.queue = [];
      for (const job of jobs) guard(job);
      for (const driver of Array.from(this.drivers)) {
        let keep = false;
        guard(() => {
          keep = driver.step(animationTime);
        });
        if (!keep) this.drivers.delete(driver);
      }
      this.flush();
      const after = this.after;
      this.after = [];
      for (const job of after) guard(job);
    } finally {
      this.inFrame = false;
    }
    return this.drivers.size > 0 || this.dirty.size > 0 || this.queue.length > 0;
  }

  /** Re-run dirty mappers until the graph is stable (bounded against cycles). */
  flush(): void {
    for (let pass = 0; pass < 32 && this.dirty.size; pass++) {
      const batch = Array.from(this.dirty);
      this.dirty.clear();
      for (const mapper of batch) guard(() => mapper.run());
    }
  }
}

function guard(fn: () => void): void {
  try {
    fn();
  } catch (error) {
    const engine = maybeEngine();
    if (engine) engine.reportError(error, 'runtime');
    else console.error(error);
  }
}

const runtimes = new WeakMap<Engine, UIRuntime>();
const detached = new UIRuntime(null);

/** The UI runtime of the active engine (one per engine; tests create many). */
export function uiRuntime(): UIRuntime {
  const engine = maybeEngine();
  if (!engine) return detached;
  let runtime = runtimes.get(engine);
  if (!runtime) runtimes.set(engine, (runtime = new UIRuntime(engine)));
  return runtime;
}

/** Run on the JS ("React Native") side: the next macrotask on the engine clock. */
export function scheduleOnJS(fn: () => void): void {
  const engine = maybeEngine();
  if (engine) engine.clock.setTimeout(() => guard(fn), 0);
  else setTimeout(fn, 0);
}
