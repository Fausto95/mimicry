import { isAnimation, type AnimationObject } from './animations';
import { Mutable } from './mutable';
import { Mapper, uiRuntime, type Driver } from './runtime';

/**
 * The result of useAnimatedStyle / useAnimatedProps: a mapper that runs the
 * updater and keeps a snapshot of its output. Leaves of the output that are
 * animation objects (`{ opacity: withTiming(1) }`, also inside transform
 * arrays) are animated per path, starting from that path's previous value;
 * re-running the updater with the same animation keeps it running instead of
 * restarting. Consumers (animated components, layout animations) subscribe
 * and receive the snapshot whenever it changes — at most once per frame.
 */
export interface UpdaterTarget {
  update(): void;
}

type Path = string;

interface Leaf {
  value: unknown;
  animation?: LeafAnimation;
}

const PLACEHOLDER = Symbol('leaf');

export class AnimatedUpdater {
  readonly __reanimatedUpdater: 'style' | 'props';
  updater: () => unknown;
  /** the latest output with animations replaced by their current values */
  snapshot: Record<string, unknown> = {};
  readonly mapper: Mapper;
  private template: unknown = {};
  private readonly leaves = new Map<Path, Leaf>();
  private readonly targets = new Set<UpdaterTarget>();
  private publishQueued = false;
  private firstRun = true;

  /** `seed` delays the first run: call seed(), then mapper.run(). */
  constructor(kind: 'style' | 'props', updater: () => unknown, options: { deferred?: boolean } = {}) {
    this.__reanimatedUpdater = kind;
    this.updater = updater;
    this.mapper = new Mapper(() => this.evaluate(this.updater()));
    if (!options.deferred) this.mapper.run();
  }

  /** whether any output leaf is still animating */
  get animating(): boolean {
    for (const leaf of this.leaves.values()) if (leaf.animation?.running) return true;
    return false;
  }

  subscribe(target: UpdaterTarget): () => void {
    this.targets.add(target);
    return () => this.targets.delete(target);
  }

  /** Seed previous values (layout animations start from `initialValues`). */
  seed(values: Record<string, unknown>): void {
    this.firstRun = false;
    walk(values, '', (path, value) => {
      this.leaves.set(path, { value });
      return PLACEHOLDER;
    });
  }

  activate(): void {
    if (this.mapper.active) return;
    this.mapper.active = true;
    this.mapper.run();
  }

  deactivate(): void {
    this.mapper.stop();
    for (const leaf of this.leaves.values()) leaf.animation?.stop();
  }

  private evaluate(output: unknown): void {
    const style = Array.isArray(output) ? Object.assign({}, ...output.flat(Infinity).filter(Boolean)) : output ?? {};
    const seen = new Set<Path>();
    this.template = walk(style, '', (path, value) => {
      seen.add(path);
      const leaf = this.leaves.get(path);
      if (value instanceof Mutable) value = value.value;
      if (isAnimation(value)) {
        if (leaf?.animation?.running && leaf.animation.animation.signature === value.signature) return PLACEHOLDER;
        leaf?.animation?.stop();
        if (!leaf || this.firstRun) {
          // Nothing to animate from: the first frame shows the target.
          this.leaves.set(path, { value: value.toValue ?? value.current });
        } else {
          const entry: Leaf = { value: leaf.value };
          entry.animation = new LeafAnimation(this, entry, value, leaf.animation?.animation ?? null);
          this.leaves.set(path, entry);
        }
      } else {
        leaf?.animation?.stop();
        this.leaves.set(path, { value });
      }
      return PLACEHOLDER;
    });
    for (const [path, leaf] of this.leaves) {
      if (!seen.has(path)) {
        leaf.animation?.stop();
        this.leaves.delete(path);
      }
    }
    this.firstRun = false;
    this.materialize();
    this.publish(true);
  }

  private materialize(): void {
    this.snapshot = rebuild(this.template, '', (path) => this.leaves.get(path)?.value) as Record<string, unknown>;
  }

  /** @internal a leaf animation produced a new value */
  leafChanged(): void {
    this.materialize();
    this.publish(false);
  }

  private publish(now: boolean): void {
    const runtime = uiRuntime();
    if (now || !runtime.insideFrame) {
      for (const t of Array.from(this.targets)) t.update();
      return;
    }
    if (this.publishQueued) return;
    this.publishQueued = true;
    runtime.afterFrame(() => {
      this.publishQueued = false;
      for (const t of Array.from(this.targets)) t.update();
    });
  }
}

class LeafAnimation implements Driver {
  running = true;
  private started = false;
  private readonly runtime = uiRuntime();

  constructor(
    private readonly owner: AnimatedUpdater,
    private readonly leaf: Leaf,
    readonly animation: AnimationObject,
    private readonly previous: AnimationObject | null,
  ) {
    if (this.runtime.insideFrame) this.start(this.runtime.now());
    this.runtime.addDriver(this);
  }

  private start(now: number): void {
    this.started = true;
    this.animation.onStart(this.leaf.value, now, this.previous);
  }

  step(now: number): boolean {
    if (!this.running) return false;
    if (!this.started) this.start(now);
    const done = this.animation.onFrame(now);
    this.leaf.value = this.animation.current;
    this.owner.leafChanged();
    if (!done) return true;
    this.running = false;
    this.animation.callback?.(true, this.animation.current);
    return false;
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    this.runtime.removeDriver(this);
    this.animation.callback?.(false, this.animation.current);
  }
}

const isPlain = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype && !('$$typeof' in v);

/** Replace leaves (anything but plain objects/arrays) via `visit`, keeping structure. */
function walk(value: unknown, path: string, visit: (path: string, leaf: unknown) => unknown): unknown {
  if (Array.isArray(value)) return value.map((v, i) => walk(v, `${path}.${i}`, visit));
  if (isPlain(value) && !isAnimation(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = walk(v, path ? `${path}.${k}` : k, visit);
    return out;
  }
  return visit(path, value);
}

function rebuild(template: unknown, path: string, leafAt: (path: string) => unknown): unknown {
  if (template === PLACEHOLDER) return leafAt(path);
  if (Array.isArray(template)) return template.map((v, i) => rebuild(v, `${path}.${i}`, leafAt));
  if (isPlain(template)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(template)) out[k] = rebuild(v, path ? `${path}.${k}` : k, leafAt);
    return out;
  }
  return template;
}

export function isUpdater(value: unknown): value is AnimatedUpdater {
  return value instanceof AnimatedUpdater;
}
