import type { Engine } from '../engine';
import { Spring } from '../runtime/animator';
import type { FrameTask } from '../runtime/animator';
import type { HostNode } from '../tree/node';
import { uikitEase } from '../runtime/animator';

/**
 * Native scroll behavior, owned by the engine like UIScrollView /
 * android.widget.ScrollView own it on device: drag tracking, rubber banding,
 * momentum with platform deceleration, paging/snapping, programmatic
 * scrollTo, scroll indicators and onScroll events.
 */
export interface ScrollState {
  x: number;
  y: number;
  phase: 'idle' | 'dragging' | 'momentum' | 'bouncing' | 'animating';
  vx: number; // points per ms
  vy: number;
  dragOrigin: { px: number; py: number; x: number; y: number } | null;
  samples: Array<{ t: number; px: number; py: number }>;
  springX: Spring | null;
  springY: Spring | null;
  animation: { fromX: number; fromY: number; toX: number; toY: number; start: number; duration: number } | null;
  lastTick: number | null;
  lastActivity: number;
  indicatorAlpha: number;
  lastEmitted: { x: number; y: number } | null;
  initialized: boolean;
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

export class ScrollManager implements FrameTask {
  private readonly active = new Set<HostNode>();

  constructor(private readonly engine: Engine) {}

  ensure(node: HostNode): ScrollState {
    if (!node.scroll) {
      node.scroll = {
        x: 0, y: 0, phase: 'idle', vx: 0, vy: 0, dragOrigin: null, samples: [],
        springX: null, springY: null, animation: null, lastTick: null, lastActivity: -Infinity,
        indicatorAlpha: 0, lastEmitted: null, initialized: false,
      };
    }
    const s = node.scroll;
    if (!s.initialized && node.laidOut) {
      s.initialized = true;
      const offset = node.props.contentOffset;
      if (offset) {
        const b = this.bounds(node);
        s.x = clamp(offset.x ?? 0, 0, b.maxX);
        s.y = clamp(offset.y ?? 0, 0, b.maxY);
      }
    }
    return s;
  }

  horizontal(node: HostNode): boolean {
    return !!node.props.horizontal;
  }

  bounds(node: HostNode) {
    const i = node.insets;
    let contentW = 0;
    let contentH = 0;
    for (const c of node.children) {
      contentW = Math.max(contentW, c.x + c.w);
      contentH = Math.max(contentH, c.y + c.h);
    }
    contentW += i.right;
    contentH += i.bottom;
    const inset = node.props.contentInset ?? {};
    const viewportW = node.w;
    const viewportH = node.h;
    return {
      contentW,
      contentH,
      viewportW,
      viewportH,
      minX: -(inset.left ?? 0),
      minY: -(inset.top ?? 0),
      maxX: Math.max(0, contentW - viewportW + (inset.right ?? 0)),
      maxY: Math.max(0, contentH - viewportH + (inset.bottom ?? 0)),
    };
  }

  /** Can this scroll view move along `axis`? */
  scrollable(node: HostNode, axis: 'x' | 'y'): boolean {
    if (node.props.scrollEnabled === false) return false;
    const horizontal = this.horizontal(node);
    if ((axis === 'x') !== horizontal) return false;
    const b = this.bounds(node);
    const range = axis === 'x' ? b.maxX - b.minX : b.maxY - b.minY;
    if (range > 0.5) return true;
    // iOS vertical scroll views bounce even when content fits (alwaysBounceVertical)
    if (this.engine.kit.scroll.rubberBand && node.props.bounces !== false) {
      return axis === 'y' ? node.props.alwaysBounceVertical !== false : !!node.props.alwaysBounceHorizontal;
    }
    return false;
  }

  /** A touch went down on this scroll view: stop momentum. Returns true if it was moving. */
  touchDown(node: HostNode): boolean {
    const s = this.ensure(node);
    const wasMoving = s.phase === 'momentum' || s.phase === 'animating';
    if (wasMoving) {
      s.phase = 'idle';
      s.vx = s.vy = 0;
      s.animation = null;
      this.emitEvent(node, 'onMomentumScrollEnd');
    }
    return wasMoving;
  }

  beginDrag(node: HostNode, px: number, py: number, t: number): void {
    const s = this.ensure(node);
    s.phase = 'dragging';
    s.springX = s.springY = null;
    s.animation = null;
    s.dragOrigin = { px, py, x: s.x, y: s.y };
    s.samples = [{ t, px, py }];
    s.lastActivity = this.engine.animator.animationTime;
    s.indicatorAlpha = 1;
    this.engine.focus.dismissForScroll(node);
    this.emitEvent(node, 'onScrollBeginDrag');
    this.activate(node);
  }

  drag(node: HostNode, px: number, py: number, t: number): void {
    const s = this.ensure(node);
    if (s.phase !== 'dragging' || !s.dragOrigin) return;
    const b = this.bounds(node);
    const physics = this.engine.kit.scroll;
    const bounces = node.props.bounces !== false && physics.rubberBand;
    const apply = (raw: number, min: number, max: number, dim: number) => {
      if (raw < min) return bounces ? min - rubber(min - raw, dim, physics.rubberBandCoefficient) : min;
      if (raw > max) return bounces ? max + rubber(raw - max, dim, physics.rubberBandCoefficient) : max;
      return raw;
    };
    if (this.horizontal(node)) s.x = apply(s.dragOrigin.x - (px - s.dragOrigin.px), b.minX, b.maxX, b.viewportW);
    else s.y = apply(s.dragOrigin.y - (py - s.dragOrigin.py), b.minY, b.maxY, b.viewportH);
    s.samples.push({ t, px, py });
    if (s.samples.length > 12) s.samples.shift();
    s.lastActivity = this.engine.animator.animationTime;
    s.indicatorAlpha = 1;
    this.engine.requestFrame();
  }

  endDrag(node: HostNode, t: number): void {
    const s = this.ensure(node);
    if (s.phase !== 'dragging') return;
    s.dragOrigin = null;
    // velocity over the last ~80ms of samples, in points/ms (content direction)
    const recent = s.samples.filter((p) => t - p.t <= 80);
    let vx = 0;
    let vy = 0;
    if (recent.length >= 2) {
      const a = recent[0]!;
      const z = recent[recent.length - 1]!;
      const dt = Math.max(1, z.t - a.t);
      vx = -(z.px - a.px) / dt;
      vy = -(z.py - a.py) / dt;
    }
    if (this.horizontal(node)) vy = 0;
    else vx = 0;
    s.vx = vx;
    s.vy = vy;
    this.emitEvent(node, 'onScrollEndDrag', { velocity: { x: vx, y: vy } });
    const target = this.snapTarget(node, s, vx, vy);
    const b = this.bounds(node);
    const out = s.x < b.minX - 0.5 || s.x > b.maxX + 0.5 || s.y < b.minY - 0.5 || s.y > b.maxY + 0.5;
    if (target) {
      this.springTo(node, target.x, target.y, vx, vy);
    } else if (out) {
      this.springTo(node, clamp(s.x, b.minX, b.maxX), clamp(s.y, b.minY, b.maxY), vx, vy);
    } else if (Math.abs(vx) > 0.05 || Math.abs(vy) > 0.05) {
      s.phase = 'momentum';
      s.lastTick = null;
      this.emitEvent(node, 'onMomentumScrollBegin');
    } else {
      s.phase = 'idle';
    }
    this.activate(node);
  }

  private snapTarget(node: HostNode, s: ScrollState, vx: number, vy: number): { x: number; y: number } | null {
    const horizontal = this.horizontal(node);
    const b = this.bounds(node);
    const pos = horizontal ? s.x : s.y;
    const v = horizontal ? vx : vy;
    const max = horizontal ? b.maxX : b.maxY;
    let candidates: number[] | null = null;
    if (node.props.pagingEnabled) {
      const page = horizontal ? b.viewportW : b.viewportH;
      const current = Math.round(pos / page);
      const base = Math.abs(v) > 0.3 ? (v > 0 ? Math.floor(pos / page) + 1 : Math.ceil(pos / page) - 1) : current;
      const target = clamp(base * page, 0, max);
      return horizontal ? { x: target, y: s.y } : { x: s.x, y: target };
    }
    if (node.props.snapToInterval) {
      const interval = node.props.snapToInterval as number;
      candidates = [];
      for (let p = 0; p <= max + interval; p += interval) candidates.push(Math.min(p, max));
    } else if (Array.isArray(node.props.snapToOffsets)) {
      candidates = (node.props.snapToOffsets as number[]).slice();
      if (node.props.snapToStart !== false) candidates.push(0);
      if (node.props.snapToEnd !== false) candidates.push(max);
    }
    if (!candidates?.length) return null;
    const projected = pos + v * 120;
    let best = candidates[0]!;
    for (const c of candidates) if (Math.abs(c - projected) < Math.abs(best - projected)) best = c;
    best = clamp(best, 0, max);
    return horizontal ? { x: best, y: s.y } : { x: s.x, y: best };
  }

  private springTo(node: HostNode, x: number, y: number, vx: number, vy: number): void {
    const s = this.ensure(node);
    const physics = this.engine.kit.scroll;
    s.phase = 'bouncing';
    s.springX = new Spring(s.x, x, vx * 1000, physics.bounceStiffness, physics.bounceDamping);
    s.springY = new Spring(s.y, y, vy * 1000, physics.bounceStiffness, physics.bounceDamping);
    s.lastTick = null;
    this.activate(node);
  }

  wheel(node: HostNode, dx: number, dy: number): void {
    const s = this.ensure(node);
    const b = this.bounds(node);
    s.phase = 'idle';
    s.animation = null;
    if (this.horizontal(node)) s.x = clamp(s.x + (dx || dy), b.minX, b.maxX);
    else s.y = clamp(s.y + dy, b.minY, b.maxY);
    s.lastActivity = this.engine.animator.animationTime;
    s.indicatorAlpha = 1;
    this.activate(node);
  }

  scrollTo(node: HostNode, x: number | undefined, y: number | undefined, animated: boolean): void {
    const s = this.ensure(node);
    const b = this.bounds(node);
    const tx = clamp(x ?? s.x, b.minX, b.maxX);
    const ty = clamp(y ?? s.y, b.minY, b.maxY);
    if (!animated) {
      s.x = tx;
      s.y = ty;
      s.phase = 'idle';
      this.activate(node);
      return;
    }
    s.phase = 'animating';
    s.animation = { fromX: s.x, fromY: s.y, toX: tx, toY: ty, start: this.engine.animator.animationTime, duration: 300 };
    s.lastActivity = this.engine.animator.animationTime;
    s.indicatorAlpha = 1;
    this.activate(node);
  }

  scrollToEnd(node: HostNode, animated: boolean): void {
    const b = this.bounds(node);
    if (this.horizontal(node)) this.scrollTo(node, b.maxX, undefined, animated);
    else this.scrollTo(node, undefined, b.maxY, animated);
  }

  flash(node: HostNode): void {
    const s = this.ensure(node);
    s.indicatorAlpha = 1;
    s.lastActivity = this.engine.animator.animationTime;
    this.activate(node);
  }

  private activate(node: HostNode): void {
    this.active.add(node);
    this.engine.animator.add(this);
    this.engine.requestFrame();
  }

  /** Content shrank or the viewport grew: idle offsets must stay in range (and say so). */
  clampAfterLayout(): void {
    for (const node of this.engine.nodes.values()) {
      const s = node.scroll;
      if (!s || s.phase !== 'idle') continue;
      const b = this.bounds(node);
      const x = clamp(s.x, b.minX, b.maxX);
      const y = clamp(s.y, b.minY, b.maxY);
      if (x !== s.x || y !== s.y) {
        s.x = x;
        s.y = y;
        this.emitScroll(node);
        this.engine.markPaint();
      }
    }
  }

  release(node: HostNode): void {
    this.active.delete(node);
  }

  tick(now: number): boolean {
    for (const node of Array.from(this.active)) {
      if (!node.mounted) {
        this.active.delete(node);
        continue;
      }
      const keep = this.step(node, now);
      this.emitScroll(node);
      if (!keep) this.active.delete(node);
    }
    return this.active.size > 0;
  }

  private step(node: HostNode, now: number): boolean {
    const s = this.ensure(node);
    const dt = s.lastTick === null ? 16 : Math.max(0, Math.min(64, now - s.lastTick));
    s.lastTick = now;
    const physics = this.engine.kit.scroll;
    const b = this.bounds(node);
    switch (s.phase) {
      case 'momentum': {
        const rate = node.props.decelerationRate === 'fast'
          ? physics.fastDecelerationRate
          : typeof node.props.decelerationRate === 'number' ? node.props.decelerationRate : physics.decelerationRate;
        const decay = Math.pow(rate, dt);
        const k = (decay - 1) / Math.log(rate);
        s.x += s.vx * k;
        s.y += s.vy * k;
        s.vx *= decay;
        s.vy *= decay;
        const outX = s.x < b.minX || s.x > b.maxX;
        const outY = s.y < b.minY || s.y > b.maxY;
        if (outX || outY) {
          if (physics.rubberBand && node.props.bounces !== false) {
            this.springTo(node, clamp(s.x, b.minX, b.maxX), clamp(s.y, b.minY, b.maxY), s.vx, s.vy);
          } else {
            s.x = clamp(s.x, b.minX, b.maxX);
            s.y = clamp(s.y, b.minY, b.maxY);
            s.phase = 'idle';
            this.emitEvent(node, 'onMomentumScrollEnd');
          }
        } else if (Math.abs(s.vx) < 0.01 && Math.abs(s.vy) < 0.01) {
          s.phase = 'idle';
          this.emitEvent(node, 'onMomentumScrollEnd');
        }
        s.lastActivity = now;
        break;
      }
      case 'bouncing': {
        const doneX = s.springX ? s.springX.step(dt) : true;
        const doneY = s.springY ? s.springY.step(dt) : true;
        if (s.springX) s.x = s.springX.position;
        if (s.springY) s.y = s.springY.position;
        if (doneX && doneY) {
          s.phase = 'idle';
          s.springX = s.springY = null;
          this.emitEvent(node, 'onMomentumScrollEnd');
        }
        s.lastActivity = now;
        break;
      }
      case 'animating': {
        const a = s.animation!;
        const t = Math.min(1, (now - a.start) / a.duration);
        const e = uikitEase(t);
        s.x = a.fromX + (a.toX - a.fromX) * e;
        s.y = a.fromY + (a.toY - a.fromY) * e;
        if (t >= 1) {
          s.phase = 'idle';
          s.animation = null;
          this.emitEvent(node, 'onMomentumScrollEnd');
        }
        s.lastActivity = now;
        break;
      }
      case 'dragging':
        s.lastActivity = now;
        break;
    }
    // indicator fade
    const idleFor = now - s.lastActivity;
    if (s.phase === 'idle') {
      if (idleFor > physics.indicatorFadeDelay) s.indicatorAlpha = Math.max(0, 1 - (idleFor - physics.indicatorFadeDelay) / 200);
    }
    this.engine.markPaint();
    return s.phase !== 'idle' || s.indicatorAlpha > 0;
  }

  private emitScroll(node: HostNode): void {
    const s = this.ensure(node);
    if (s.lastEmitted && s.lastEmitted.x === s.x && s.lastEmitted.y === s.y) return;
    s.lastEmitted = { x: s.x, y: s.y };
    this.emitEvent(node, 'onScroll', { velocity: { x: s.vx, y: s.vy } }, 'continuous');
  }

  private emitEvent(node: HostNode, name: string, extra: Record<string, unknown> = {}, priority: 'discrete' | 'continuous' = 'discrete'): void {
    if (typeof node.props[name] !== 'function') return;
    const s = this.ensure(node);
    const b = this.bounds(node);
    const inset = node.props.contentInset ?? {};
    this.engine.events.emit(node, name, {
      contentOffset: { x: s.x, y: s.y },
      contentSize: { width: b.contentW, height: b.contentH },
      layoutMeasurement: { width: b.viewportW, height: b.viewportH },
      contentInset: { top: inset.top ?? 0, left: inset.left ?? 0, bottom: inset.bottom ?? 0, right: inset.right ?? 0 },
      zoomScale: 1,
      responderIgnoreScroll: true,
      target: node.id,
      ...extra,
    }, this.engine.animator.animationTime, priority);
  }

  indicators(node: HostNode): IndicatorBar[] {
    const s = node.scroll;
    if (!s || s.indicatorAlpha <= 0) return [];
    const physics = this.engine.kit.scroll;
    const b = this.bounds(node);
    const horizontal = this.horizontal(node);
    const shows = horizontal ? node.props.showsHorizontalScrollIndicator !== false : node.props.showsVerticalScrollIndicator !== false;
    if (!shows) return [];
    const color = physics.indicatorColor(this.engine.env.appearance, node.props.indicatorStyle);
    const t = physics.indicatorThickness;
    const inset = physics.indicatorInset;
    if (!horizontal) {
      if (b.contentH <= b.viewportH) return [];
      const track = b.viewportH - inset * 2;
      let length = Math.max(36, (track * b.viewportH) / b.contentH);
      let pos = b.maxY > 0 ? (s.y / b.maxY) * (track - length) : 0;
      if (s.y < 0) {
        length = Math.max(t * 2, length + s.y);
        pos = 0;
      } else if (s.y > b.maxY) {
        length = Math.max(t * 2, length - (s.y - b.maxY));
        pos = track - length;
      }
      return [{ axis: 'y', x: b.viewportW - inset - t, y: inset + pos, w: t, h: length, alpha: s.indicatorAlpha, color }];
    }
    if (b.contentW <= b.viewportW) return [];
    const track = b.viewportW - inset * 2;
    const length = Math.max(36, (track * b.viewportW) / b.contentW);
    const pos = b.maxX > 0 ? clamp((s.x / b.maxX) * (track - length), 0, track - length) : 0;
    return [{ axis: 'x', x: inset + pos, y: b.viewportH - inset - t, w: length, h: t, alpha: s.indicatorAlpha, color }];
  }
}

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
