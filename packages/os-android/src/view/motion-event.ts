import { IDENTITY, apply, multiply, type Matrix } from '@mimicry/os-core';

/**
 * android.view.MotionEvent: an action plus every pointer's position. Raw
 * coordinates are window coordinates; getX()/getY() are in the receiving
 * view's coordinates (ViewGroup transforms a copy for each child).
 */
export class MotionEvent {
  static readonly ACTION_DOWN = 0;
  static readonly ACTION_UP = 1;
  static readonly ACTION_MOVE = 2;
  static readonly ACTION_CANCEL = 3;
  static readonly ACTION_OUTSIDE = 4;
  static readonly ACTION_POINTER_DOWN = 5;
  static readonly ACTION_POINTER_UP = 6;
  static readonly ACTION_MASK = 0xff;
  static readonly ACTION_POINTER_INDEX_MASK = 0xff00;
  static readonly ACTION_POINTER_INDEX_SHIFT = 8;
  static readonly INVALID_POINTER_ID = -1;

  private constructor(
    private action: number,
    readonly downTime: number,
    readonly eventTime: number,
    /** pointer ids, by index */
    private readonly ids: number[],
    /** window coordinates, by index */
    private readonly raw: Array<[number, number]>,
    /** window → this view's coordinates */
    private toLocal: Matrix,
  ) {}

  static obtain(downTime: number, eventTime: number, action: number, pointers: Array<{ id: number; x: number; y: number }>): MotionEvent {
    return new MotionEvent(action, downTime, eventTime, pointers.map((p) => p.id), pointers.map((p) => [p.x, p.y] as [number, number]), IDENTITY.slice() as Matrix);
  }

  static obtainCopy(other: MotionEvent): MotionEvent {
    return new MotionEvent(other.action, other.downTime, other.eventTime, other.ids.slice(), other.raw.map((r) => [r[0], r[1]] as [number, number]), other.toLocal.slice() as Matrix);
  }

  getAction(): number {
    return this.action;
  }

  setAction(action: number): void {
    this.action = action;
  }

  getActionMasked(): number {
    return this.action & MotionEvent.ACTION_MASK;
  }

  getActionIndex(): number {
    return (this.action & MotionEvent.ACTION_POINTER_INDEX_MASK) >> MotionEvent.ACTION_POINTER_INDEX_SHIFT;
  }

  getDownTime(): number {
    return this.downTime;
  }

  getEventTime(): number {
    return this.eventTime;
  }

  getPointerCount(): number {
    return this.ids.length;
  }

  getPointerId(index: number): number {
    return this.ids[index] ?? MotionEvent.INVALID_POINTER_ID;
  }

  findPointerIndex(id: number): number {
    return this.ids.indexOf(id);
  }

  getX(index = 0): number {
    const r = this.raw[index];
    return r ? apply(this.toLocal, r[0], r[1])[0] : 0;
  }

  getY(index = 0): number {
    const r = this.raw[index];
    return r ? apply(this.toLocal, r[0], r[1])[1] : 0;
  }

  getRawX(index = 0): number {
    return this.raw[index]?.[0] ?? 0;
  }

  getRawY(index = 0): number {
    return this.raw[index]?.[1] ?? 0;
  }

  /** @internal the window → local transform */
  get localTransform(): Matrix {
    return this.toLocal;
  }

  /** Move into a child's space: `childFromParent` maps parent coordinates to the child's. */
  transform(childFromParent: Matrix): void {
    this.toLocal = multiply(childFromParent, this.toLocal);
  }

  offsetLocation(dx: number, dy: number): void {
    this.toLocal = multiply([1, 0, 0, 1, dx, dy], this.toLocal);
  }

  /** Copy with only the pointers in `idBits` (for touch targets that own some pointers). */
  split(idBits: number): MotionEvent | null {
    const keep: number[] = [];
    for (let i = 0; i < this.ids.length; i++) if (idBits & (1 << this.ids[i]!)) keep.push(i);
    if (!keep.length) return null;
    const masked = this.getActionMasked();
    let action = masked;
    if (masked === MotionEvent.ACTION_POINTER_DOWN || masked === MotionEvent.ACTION_POINTER_UP) {
      const changed = this.getPointerId(this.getActionIndex());
      const at = keep.findIndex((i) => this.ids[i] === changed);
      if (at < 0) action = MotionEvent.ACTION_MOVE;
      else if (keep.length === 1) action = masked === MotionEvent.ACTION_POINTER_DOWN ? MotionEvent.ACTION_DOWN : MotionEvent.ACTION_UP;
      else action = masked | (at << MotionEvent.ACTION_POINTER_INDEX_SHIFT);
    }
    return new MotionEvent(action, this.downTime, this.eventTime, keep.map((i) => this.ids[i]!), keep.map((i) => [this.raw[i]![0], this.raw[i]![1]] as [number, number]), this.toLocal.slice() as Matrix);
  }

  recycle(): void {}

  toString(): string {
    return `MotionEvent { action=${this.getActionMasked()}, pointers=${this.ids.length}, x=${this.getX().toFixed(1)}, y=${this.getY().toFixed(1)} }`;
  }
}

/** android.view.ViewConfiguration: touch thresholds and timeouts (dp, ms). */
export const ViewConfiguration = {
  getTouchSlop: () => 8,
  getScaledTouchSlop: () => 8,
  getScaledPagingTouchSlop: () => 16,
  getScaledMinimumFlingVelocity: () => 50,
  getScaledMaximumFlingVelocity: () => 8000,
  getTapTimeout: () => 100,
  getLongPressTimeout: () => 400,
  getDoubleTapTimeout: () => 300,
  getPressedStateDuration: () => 64,
  getScrollBarFadeDuration: () => 250,
  getScrollDefaultDelay: () => 300,
} as const;

/** android.view.VelocityTracker: velocity over the last 100 ms of samples. */
export class VelocityTracker {
  private samples = new Map<number, Array<{ t: number; x: number; y: number }>>();
  private vx = new Map<number, number>();
  private vy = new Map<number, number>();

  static obtain(): VelocityTracker {
    return new VelocityTracker();
  }

  addMovement(event: MotionEvent): void {
    if (event.getActionMasked() === MotionEvent.ACTION_DOWN) this.samples.clear();
    for (let i = 0; i < event.getPointerCount(); i++) {
      const id = event.getPointerId(i);
      const list = this.samples.get(id) ?? [];
      list.push({ t: event.getEventTime(), x: event.getRawX(i), y: event.getRawY(i) });
      if (list.length > 20) list.shift();
      this.samples.set(id, list);
    }
  }

  /** units: 1 → px/ms, 1000 → px/s */
  computeCurrentVelocity(units: number, maxVelocity = Infinity): void {
    for (const [id, list] of this.samples) {
      const last = list[list.length - 1];
      if (!last) continue;
      const first = list.find((s) => last.t - s.t <= 100) ?? list[0]!;
      const dt = Math.max(1, last.t - first.t);
      const clampV = (v: number) => Math.max(-maxVelocity, Math.min(maxVelocity, v));
      this.vx.set(id, clampV(((last.x - first.x) / dt) * units));
      this.vy.set(id, clampV(((last.y - first.y) / dt) * units));
    }
  }

  getXVelocity(id = 0): number {
    return this.vx.get(id) ?? 0;
  }

  getYVelocity(id = 0): number {
    return this.vy.get(id) ?? 0;
  }

  clear(): void {
    this.samples.clear();
    this.vx.clear();
    this.vy.clear();
  }

  recycle(): void {
    this.clear();
  }
}
