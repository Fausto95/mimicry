import { Spring, uikitEase } from '../animation/animator';
import type { ScrollPhysics } from '../theme/kit';
import type { Appearance } from '@mimicry/protocol';

/**
 * Scroll kinetics shared by UIScrollView and android.widget.ScrollView /
 * OverScroller: drag tracking with optional rubber banding, momentum with
 * exponential deceleration, spring return from overscroll, paging and
 * snapping, animated programmatic scrolling and scroll indicator fade.
 * Each OS supplies its constants (ScrollPhysics) and turns the events into
 * its own callbacks (UIScrollViewDelegate, OnScrollChangeListener…).
 */
export type ScrollPhase = 'idle' | 'dragging' | 'momentum' | 'bouncing' | 'animating';

export interface ScrollMetrics {
  contentW: number;
  contentH: number;
  viewportW: number;
  viewportH: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface ScrollConfig {
  horizontal: boolean;
  scrollEnabled: boolean;
  bounces: boolean;
  alwaysBounceVertical: boolean;
  alwaysBounceHorizontal: boolean;
  /** 'normal' | 'fast' | a per-millisecond decay rate */
  decelerationRate: 'normal' | 'fast' | number;
  pagingEnabled: boolean;
  snapToInterval: number | null;
  snapToOffsets: number[] | null;
  snapToStart: boolean;
  snapToEnd: boolean;
  showsIndicator: boolean;
  indicatorStyle: string | undefined;
}

export type ScrollEvent =
  | 'beginDrag'
  | 'endDrag'
  | 'momentumBegin'
  | 'momentumEnd'
  | 'scroll';

export interface ScrollKineticsHost {
  readonly physics: ScrollPhysics;
  metrics(): ScrollMetrics;
  config(): ScrollConfig;
  /** current animation time (ms) */
  now(): number;
  /** keep ticking every frame until `tick` returns false */
  activate(): void;
  requestFrame(): void;
  appearance(): Appearance;
  event(name: ScrollEvent, extra?: { velocity: { x: number; y: number } }): void;
}

export interface IndicatorBar {
  axis: 'x' | 'y';
  x: number;
  y: number;
  w: number;
  h: number;
  alpha: number;
  color: number;
}

const rubber = (overshoot: number, dimension: number, c: number) =>
  (1 - 1 / ((overshoot * c) / dimension + 1)) * dimension;

export const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

export class ScrollKinetics {
  x = 0;
  y = 0;
  phase: ScrollPhase = 'idle';
  /** points per ms, in content direction */
  vx = 0;
  vy = 0;
  private dragOrigin: { px: number; py: number; x: number; y: number } | null = null;
  private samples: Array<{ t: number; px: number; py: number }> = [];
  private springX: Spring | null = null;
  private springY: Spring | null = null;
  private animation: { fromX: number; fromY: number; toX: number; toY: number; start: number; duration: number } | null = null;
  private lastTick: number | null = null;
  private lastActivity = -Infinity;
  indicatorAlpha = 0;
  private lastEmitted: { x: number; y: number } | null = null;

  constructor(private readonly host: ScrollKineticsHost) {}

  /** Can the content move along `axis`? */
  scrollable(axis: 'x' | 'y'): boolean {
    const c = this.host.config();
    if (!c.scrollEnabled) return false;
    if ((axis === 'x') !== c.horizontal) return false;
    const b = this.host.metrics();
    const range = axis === 'x' ? b.maxX - b.minX : b.maxY - b.minY;
    if (range > 0.5) return true;
    // iOS vertical scroll views bounce even when content fits (alwaysBounceVertical)
    if (this.host.physics.rubberBand && c.bounces) {
      return axis === 'y' ? c.alwaysBounceVertical : c.alwaysBounceHorizontal;
    }
    return false;
  }

  get isTracking(): boolean {
    return this.phase === 'dragging';
  }

  get isDecelerating(): boolean {
    return this.phase === 'momentum' || this.phase === 'bouncing';
  }

  /** A finger touched down: stop momentum. Returns true if the content was moving. */
  touchDown(): boolean {
    const wasMoving = this.phase === 'momentum' || this.phase === 'animating';
    if (wasMoving) {
      this.phase = 'idle';
      this.vx = this.vy = 0;
      this.animation = null;
      this.host.event('momentumEnd');
    }
    return wasMoving;
  }

  beginDrag(px: number, py: number, t: number): void {
    this.phase = 'dragging';
    this.springX = this.springY = null;
    this.animation = null;
    this.dragOrigin = { px, py, x: this.x, y: this.y };
    this.samples = [{ t, px, py }];
    this.lastActivity = this.host.now();
    this.indicatorAlpha = 1;
    this.host.event('beginDrag');
    this.host.activate();
  }

  drag(px: number, py: number, t: number): void {
    if (this.phase !== 'dragging' || !this.dragOrigin) return;
    const b = this.host.metrics();
    const physics = this.host.physics;
    const bounces = this.host.config().bounces && physics.rubberBand;
    const apply = (raw: number, min: number, max: number, dim: number) => {
      if (raw < min) return bounces ? min - rubber(min - raw, dim, physics.rubberBandCoefficient) : min;
      if (raw > max) return bounces ? max + rubber(raw - max, dim, physics.rubberBandCoefficient) : max;
      return raw;
    };
    if (this.host.config().horizontal) this.x = apply(this.dragOrigin.x - (px - this.dragOrigin.px), b.minX, b.maxX, b.viewportW);
    else this.y = apply(this.dragOrigin.y - (py - this.dragOrigin.py), b.minY, b.maxY, b.viewportH);
    this.samples.push({ t, px, py });
    if (this.samples.length > 12) this.samples.shift();
    this.lastActivity = this.host.now();
    this.indicatorAlpha = 1;
    this.host.requestFrame();
  }

  endDrag(t: number): void {
    if (this.phase !== 'dragging') return;
    this.dragOrigin = null;
    // velocity over the last ~80ms of samples, in points/ms (content direction)
    const recent = this.samples.filter((p) => t - p.t <= 80);
    let vx = 0;
    let vy = 0;
    if (recent.length >= 2) {
      const a = recent[0]!;
      const z = recent[recent.length - 1]!;
      const dt = Math.max(1, z.t - a.t);
      vx = -(z.px - a.px) / dt;
      vy = -(z.py - a.py) / dt;
    }
    if (this.host.config().horizontal) vy = 0;
    else vx = 0;
    this.vx = vx;
    this.vy = vy;
    this.host.event('endDrag', { velocity: { x: vx, y: vy } });
    const target = this.snapTarget(vx, vy);
    const b = this.host.metrics();
    const out = this.x < b.minX - 0.5 || this.x > b.maxX + 0.5 || this.y < b.minY - 0.5 || this.y > b.maxY + 0.5;
    if (target) {
      this.springTo(target.x, target.y, vx, vy);
    } else if (out) {
      this.springTo(clamp(this.x, b.minX, b.maxX), clamp(this.y, b.minY, b.maxY), vx, vy);
    } else if (Math.abs(vx) > 0.05 || Math.abs(vy) > 0.05) {
      this.phase = 'momentum';
      this.lastTick = null;
      this.host.event('momentumBegin');
    } else {
      this.phase = 'idle';
    }
    this.host.activate();
  }

  private snapTarget(vx: number, vy: number): { x: number; y: number } | null {
    const c = this.host.config();
    const horizontal = c.horizontal;
    const b = this.host.metrics();
    const pos = horizontal ? this.x : this.y;
    const v = horizontal ? vx : vy;
    const max = horizontal ? b.maxX : b.maxY;
    let candidates: number[] | null = null;
    if (c.pagingEnabled) {
      const page = horizontal ? b.viewportW : b.viewportH;
      const current = Math.round(pos / page);
      const base = Math.abs(v) > 0.3 ? (v > 0 ? Math.floor(pos / page) + 1 : Math.ceil(pos / page) - 1) : current;
      const target = clamp(base * page, 0, max);
      return horizontal ? { x: target, y: this.y } : { x: this.x, y: target };
    }
    if (c.snapToInterval) {
      const interval = c.snapToInterval;
      candidates = [];
      for (let p = 0; p <= max + interval; p += interval) candidates.push(Math.min(p, max));
    } else if (c.snapToOffsets) {
      candidates = c.snapToOffsets.slice();
      if (c.snapToStart) candidates.push(0);
      if (c.snapToEnd) candidates.push(max);
    }
    if (!candidates?.length) return null;
    const projected = pos + v * 120;
    let best = candidates[0]!;
    for (const cand of candidates) if (Math.abs(cand - projected) < Math.abs(best - projected)) best = cand;
    best = clamp(best, 0, max);
    return horizontal ? { x: best, y: this.y } : { x: this.x, y: best };
  }

  private springTo(x: number, y: number, vx: number, vy: number): void {
    const physics = this.host.physics;
    this.phase = 'bouncing';
    this.springX = new Spring(this.x, x, vx * 1000, physics.bounceStiffness, physics.bounceDamping);
    this.springY = new Spring(this.y, y, vy * 1000, physics.bounceStiffness, physics.bounceDamping);
    this.lastTick = null;
    this.host.activate();
  }

  wheel(dx: number, dy: number): void {
    const b = this.host.metrics();
    this.phase = 'idle';
    this.animation = null;
    if (this.host.config().horizontal) this.x = clamp(this.x + (dx || dy), b.minX, b.maxX);
    else this.y = clamp(this.y + dy, b.minY, b.maxY);
    this.lastActivity = this.host.now();
    this.indicatorAlpha = 1;
    this.host.activate();
  }

  scrollTo(x: number | undefined, y: number | undefined, animated: boolean): void {
    const b = this.host.metrics();
    const tx = clamp(x ?? this.x, b.minX, b.maxX);
    const ty = clamp(y ?? this.y, b.minY, b.maxY);
    if (!animated) {
      this.x = tx;
      this.y = ty;
      this.phase = 'idle';
      this.host.activate();
      return;
    }
    this.phase = 'animating';
    this.animation = { fromX: this.x, fromY: this.y, toX: tx, toY: ty, start: this.host.now(), duration: 300 };
    this.lastActivity = this.host.now();
    this.indicatorAlpha = 1;
    this.host.activate();
  }

  flash(): void {
    this.indicatorAlpha = 1;
    this.lastActivity = this.host.now();
    this.host.activate();
  }

  /** Content shrank or the viewport grew: keep an idle offset in range. Returns true if it moved. */
  clampIdle(): boolean {
    if (this.phase !== 'idle') return false;
    const b = this.host.metrics();
    const x = clamp(this.x, b.minX, b.maxX);
    const y = clamp(this.y, b.minY, b.maxY);
    if (x === this.x && y === this.y) return false;
    this.x = x;
    this.y = y;
    this.emitScroll();
    return true;
  }

  /** One frame. Returns true while anything is still moving or fading. */
  tick(now: number): boolean {
    const keep = this.step(now);
    this.emitScroll();
    return keep;
  }

  private step(now: number): boolean {
    const dt = this.lastTick === null ? 16 : Math.max(0, Math.min(64, now - this.lastTick));
    this.lastTick = now;
    const physics = this.host.physics;
    const c = this.host.config();
    const b = this.host.metrics();
    switch (this.phase) {
      case 'momentum': {
        const rate = c.decelerationRate === 'fast'
          ? physics.fastDecelerationRate
          : typeof c.decelerationRate === 'number' ? c.decelerationRate : physics.decelerationRate;
        const decay = Math.pow(rate, dt);
        const k = (decay - 1) / Math.log(rate);
        this.x += this.vx * k;
        this.y += this.vy * k;
        this.vx *= decay;
        this.vy *= decay;
        const outX = this.x < b.minX || this.x > b.maxX;
        const outY = this.y < b.minY || this.y > b.maxY;
        if (outX || outY) {
          if (physics.rubberBand && c.bounces) {
            this.springTo(clamp(this.x, b.minX, b.maxX), clamp(this.y, b.minY, b.maxY), this.vx, this.vy);
          } else {
            this.x = clamp(this.x, b.minX, b.maxX);
            this.y = clamp(this.y, b.minY, b.maxY);
            this.phase = 'idle';
            this.host.event('momentumEnd');
          }
        } else if (Math.abs(this.vx) < 0.01 && Math.abs(this.vy) < 0.01) {
          this.phase = 'idle';
          this.host.event('momentumEnd');
        }
        this.lastActivity = now;
        break;
      }
      case 'bouncing': {
        const doneX = this.springX ? this.springX.step(dt) : true;
        const doneY = this.springY ? this.springY.step(dt) : true;
        if (this.springX) this.x = this.springX.position;
        if (this.springY) this.y = this.springY.position;
        if (doneX && doneY) {
          this.phase = 'idle';
          this.springX = this.springY = null;
          this.host.event('momentumEnd');
        }
        this.lastActivity = now;
        break;
      }
      case 'animating': {
        const a = this.animation!;
        const t = Math.min(1, (now - a.start) / a.duration);
        const e = uikitEase(t);
        this.x = a.fromX + (a.toX - a.fromX) * e;
        this.y = a.fromY + (a.toY - a.fromY) * e;
        if (t >= 1) {
          this.phase = 'idle';
          this.animation = null;
          this.host.event('momentumEnd');
        }
        this.lastActivity = now;
        break;
      }
      case 'dragging':
        this.lastActivity = now;
        break;
    }
    // indicator fade
    const idleFor = now - this.lastActivity;
    if (this.phase === 'idle') {
      if (idleFor > physics.indicatorFadeDelay) this.indicatorAlpha = Math.max(0, 1 - (idleFor - physics.indicatorFadeDelay) / 200);
    }
    this.host.requestFrame();
    return this.phase !== 'idle' || this.indicatorAlpha > 0;
  }

  /** Report the offset if it changed since the last report. */
  emitScroll(): void {
    if (this.lastEmitted && this.lastEmitted.x === this.x && this.lastEmitted.y === this.y) return;
    this.lastEmitted = { x: this.x, y: this.y };
    this.host.event('scroll', { velocity: { x: this.vx, y: this.vy } });
  }

  indicators(): IndicatorBar[] {
    if (this.indicatorAlpha <= 0) return [];
    const physics = this.host.physics;
    const c = this.host.config();
    const b = this.host.metrics();
    if (!c.showsIndicator) return [];
    const color = physics.indicatorColor(this.host.appearance(), c.indicatorStyle);
    const t = physics.indicatorThickness;
    const inset = physics.indicatorInset;
    if (!c.horizontal) {
      if (b.contentH <= b.viewportH) return [];
      const track = b.viewportH - inset * 2;
      let length = Math.max(36, (track * b.viewportH) / b.contentH);
      let pos = b.maxY > 0 ? (this.y / b.maxY) * (track - length) : 0;
      if (this.y < 0) {
        length = Math.max(t * 2, length + this.y);
        pos = 0;
      } else if (this.y > b.maxY) {
        length = Math.max(t * 2, length - (this.y - b.maxY));
        pos = track - length;
      }
      return [{ axis: 'y', x: b.viewportW - inset - t, y: inset + pos, w: t, h: length, alpha: this.indicatorAlpha, color }];
    }
    if (b.contentW <= b.viewportW) return [];
    const track = b.viewportW - inset * 2;
    const length = Math.max(36, (track * b.viewportW) / b.contentW);
    const pos = b.maxX > 0 ? clamp((this.x / b.maxX) * (track - length), 0, track - length) : 0;
    return [{ axis: 'x', x: inset + pos, y: b.viewportH - inset - t, w: length, h: t, alpha: this.indicatorAlpha, color }];
  }
}
