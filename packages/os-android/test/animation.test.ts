import { describe, expect, it } from 'vitest';
import { cubicBezier } from '@mimicry/os-core';
import { createDevice, type Device } from '@mimicry/testing';
import {
  AccelerateDecelerateInterpolator, AccelerateInterpolator, Activity, AnimatorSet, AnticipateInterpolator, AnticipateOvershootInterpolator,
  ArgbEvaluator, BounceInterpolator, Color, DecelerateInterpolator, DynamicAnimation, FastOutSlowInInterpolator, FlingAnimation, FloatValueHolder,
  FrameLayout, Keyframe, LinearInterpolator, MaterialMotion, ObjectAnimator, OvershootInterpolator, Path, PathInterpolator, PropertyValuesHolder,
  SpringAnimation, SpringForce, TimeAnimator, ValueAnimator, View, type Animator,
} from '@mimicry/os-android';
import { PNG } from 'pngjs';

const FRAME = 1000 / 60;

function boot(): { device: Device; box: View; root: FrameLayout } {
  const device = createDevice({ device: 'pixel-9' });
  let box!: View;
  let root!: FrameLayout;
  class Main extends Activity {
    protected override onCreate(): void {
      root = new FrameLayout(this);
      root.setBackgroundColor(Color.WHITE);
      box = new View(this);
      box.setBackgroundColor(Color.parseColor('#6750A4'));
      root.addView(box);
      this.setContentView(root);
    }
  }
  new Main(device.kernel, device.android.windowManager).launch();
  device.advance(32);
  box.layout(20, 120, 120, 170);
  device.advance(FRAME);
  return { device, box, root };
}

/** Records listener calls by name. */
function journal() {
  const calls: string[] = [];
  const listener = {
    onAnimationStart: () => calls.push('start'),
    onAnimationEnd: () => calls.push('end'),
    onAnimationCancel: () => calls.push('cancel'),
    onAnimationRepeat: () => calls.push('repeat'),
  };
  return { calls, listener };
}

describe('interpolators', () => {
  it('follow the framework formulas', () => {
    expect(new LinearInterpolator().getInterpolation(0.3)).toBeCloseTo(0.3);
    const ad = new AccelerateDecelerateInterpolator();
    expect(ad.getInterpolation(0)).toBeCloseTo(0);
    expect(ad.getInterpolation(0.5)).toBeCloseTo(0.5);
    expect(ad.getInterpolation(0.25)).toBeCloseTo(0.1464, 3);
    expect(new AccelerateInterpolator().getInterpolation(0.5)).toBeCloseTo(0.25);
    expect(new AccelerateInterpolator(2).getInterpolation(0.5)).toBeCloseTo(0.0625);
    expect(new DecelerateInterpolator().getInterpolation(0.5)).toBeCloseTo(0.75);
    const overshoot = new OvershootInterpolator();
    expect(Math.max(...[0.6, 0.7, 0.8].map((t) => overshoot.getInterpolation(t)))).toBeGreaterThan(1);
    expect(overshoot.getInterpolation(1)).toBeCloseTo(1);
    expect(new AnticipateInterpolator().getInterpolation(0.3)).toBeLessThan(0);
    const ao = new AnticipateOvershootInterpolator();
    expect(ao.getInterpolation(0)).toBeCloseTo(0);
    expect(ao.getInterpolation(1)).toBeCloseTo(1);
    const bounce = new BounceInterpolator();
    expect(bounce.getInterpolation(1)).toBeCloseTo(1, 2);
    expect(bounce.getInterpolation(0.5)).toBeGreaterThan(0.6);
  });

  it('path interpolators match the cubic béziers they describe', () => {
    const fosi = new FastOutSlowInInterpolator();
    const reference = cubicBezier(0.4, 0, 0.2, 1);
    for (const t of [0.1, 0.25, 0.5, 0.75, 0.9]) expect(fosi.getInterpolation(t)).toBeCloseTo(reference(t), 2);
    const quad = new PathInterpolator(0.5, 1);
    expect(quad.getInterpolation(0.5)).toBeGreaterThan(0.5);
    const emphasized = MaterialMotion.easing.emphasized;
    let prev = 0;
    for (let t = 0; t <= 1.0001; t += 0.05) {
      const v = emphasized.getInterpolation(t);
      expect(v).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = v;
    }
    expect(emphasized.getInterpolation(1)).toBe(1);
    // the emphasized curve is mostly done a quarter of the way in
    expect(emphasized.getInterpolation(0.25)).toBeGreaterThan(0.75);
    expect(MaterialMotion.duration.medium2).toBe(300);
  });

  it('rejects a path that does not run from (0,0) to (1,1)', () => {
    const p = new Path();
    p.moveTo(0, 0);
    p.lineTo(0.5, 2);
    expect(() => new PathInterpolator(p)).toThrow(/end at \(1,1\)/);
  });
});

describe('ValueAnimator', () => {
  it('sets the first value at start and ends after its duration on the virtual clock', () => {
    const { device } = boot();
    const anim = ValueAnimator.ofFloat(0, 100);
    const { calls, listener } = journal();
    anim.addListener(listener);
    const values: number[] = [];
    anim.addUpdateListener((a) => values.push(a.getAnimatedValue() as number));
    anim.setInterpolator(new LinearInterpolator());
    anim.start();
    expect(calls).toEqual(['start']);
    expect(values).toEqual([0]);
    expect(anim.isRunning()).toBe(true);
    device.advance(FRAME); // first frame commits the start time: still 0
    expect(values[values.length - 1]).toBe(0);
    device.advance(150);
    const mid = values[values.length - 1]!;
    expect(mid).toBeGreaterThan(40);
    expect(mid).toBeLessThan(60);
    device.advance(200);
    expect(values[values.length - 1]).toBe(100);
    expect(calls).toEqual(['start', 'end']);
    expect(anim.isRunning()).toBe(false);
    expect(anim.getDuration()).toBe(300);
  });

  it('uses AccelerateDecelerate by default and the int and argb evaluators', () => {
    boot();
    const anim = ValueAnimator.ofInt(0, 10);
    expect(anim.getInterpolator()).toBeInstanceOf(AccelerateDecelerateInterpolator);
    anim.setCurrentFraction(0.5);
    expect(anim.getAnimatedValue()).toBe(5);
    anim.setCurrentPlayTime(225);
    expect(anim.getAnimatedValue()).toBe(8); // trunc(8.53)
    const color = ValueAnimator.ofArgb(Color.RED, Color.BLUE);
    color.setInterpolator(null);
    color.setCurrentFraction(0.5);
    const mid = color.getAnimatedValue() as number;
    // gamma-correct mixing: brighter than a naive 0x7f mix
    expect(Color.red(mid)).toBeGreaterThan(0xa0);
    expect(Color.blue(mid)).toBeGreaterThan(0xa0);
    expect(new ArgbEvaluator().evaluate(1, Color.RED, Color.BLUE)).toBe(Color.BLUE);
  });

  it('waits for the start delay before calling start listeners', () => {
    const { device } = boot();
    const anim = ValueAnimator.ofFloat(0, 1);
    const { calls, listener } = journal();
    anim.addListener(listener);
    anim.setStartDelay(100);
    anim.setDuration(100);
    anim.start();
    expect(calls).toEqual([]);
    expect(anim.isStarted()).toBe(true);
    expect(anim.isRunning()).toBe(false);
    device.advance(80);
    expect(calls).toEqual([]);
    device.advance(50);
    expect(calls).toEqual(['start']);
    device.advance(150);
    expect(calls).toEqual(['start', 'end']);
  });

  it('repeats in reverse and reports each repetition', () => {
    const { device } = boot();
    const anim = ValueAnimator.ofFloat(0, 10);
    anim.setDuration(100);
    anim.setRepeatCount(2);
    anim.setRepeatMode(ValueAnimator.REVERSE);
    anim.setInterpolator(new LinearInterpolator());
    const { calls, listener } = journal();
    anim.addListener(listener);
    const seen: number[] = [];
    anim.addUpdateListener((a) => seen.push(a.getAnimatedValue() as number));
    anim.start();
    expect(anim.getTotalDuration()).toBe(300);
    device.advance(FRAME + 150);
    expect(seen[seen.length - 1]!).toBeLessThan(6); // on the way back
    device.advance(250);
    expect(calls).toEqual(['start', 'repeat', 'repeat', 'end']);
    expect(seen[seen.length - 1]).toBe(10); // three passes end forward
  });

  it('cancel calls onAnimationCancel then onAnimationEnd; end() jumps to the final value', () => {
    const { device } = boot();
    const a = ValueAnimator.ofFloat(0, 50);
    const first = journal();
    a.addListener(first.listener);
    a.start();
    device.advance(100);
    a.cancel();
    expect(first.calls).toEqual(['start', 'cancel', 'end']);
    const before = a.getAnimatedValue() as number;
    expect(before).toBeGreaterThan(0);
    expect(before).toBeLessThan(50);

    const b = ValueAnimator.ofFloat(0, 50);
    const second = journal();
    b.addListener(second.listener);
    b.start();
    b.end();
    expect(b.getAnimatedValue()).toBe(50);
    expect(second.calls).toEqual(['start', 'end']);
  });

  it('pauses without losing its place, and reverses from where it is', () => {
    const { device } = boot();
    const anim = ValueAnimator.ofFloat(0, 100);
    anim.setInterpolator(new LinearInterpolator());
    anim.setDuration(200);
    anim.start();
    device.advance(FRAME + 100);
    anim.pause();
    const paused = anim.getAnimatedValue() as number;
    device.advance(500);
    expect(anim.getAnimatedValue()).toBe(paused);
    expect(anim.isPaused()).toBe(true);
    anim.resume();
    device.advance(FRAME * 2);
    expect(anim.getAnimatedValue() as number).toBeGreaterThan(paused);
    expect(anim.getAnimatedValue() as number).toBeLessThan(paused + 25);
    anim.reverse();
    device.advance(400);
    expect(anim.getAnimatedValue()).toBe(0);
    expect(anim.isRunning()).toBe(false);
  });

  it('runs slower under the animator duration scale', () => {
    const { device } = boot();
    device.kernel.handle({ type: 'animationScale', factor: 2 });
    expect(ValueAnimator.getDurationScale()).toBe(2);
    const anim = ValueAnimator.ofFloat(0, 1);
    const { calls, listener } = journal();
    anim.addListener(listener);
    anim.start();
    device.advance(400);
    expect(calls).toEqual(['start']);
    device.advance(300);
    expect(calls).toEqual(['start', 'end']);
  });

  it('interpolates keyframes and named property values', () => {
    boot();
    const kf = PropertyValuesHolder.ofKeyframe('x', Keyframe.ofFloat(0, 0), Keyframe.ofFloat(0.5, 100), Keyframe.ofFloat(1, 0));
    const pvh = PropertyValuesHolder.ofFloat('y', 10, 20);
    const anim = ValueAnimator.ofPropertyValuesHolder(kf, pvh);
    anim.setInterpolator(null);
    anim.setCurrentFraction(0.25);
    expect(anim.getAnimatedValue('x')).toBeCloseTo(50);
    expect(anim.getAnimatedValue('y')).toBeCloseTo(12.5);
    anim.setCurrentFraction(0.75);
    expect(anim.getAnimatedValue('x')).toBeCloseTo(50);
  });

  it('TimeAnimator reports total and delta time each frame', () => {
    const { device } = boot();
    const t = new TimeAnimator();
    const ticks: Array<[number, number]> = [];
    t.setTimeListener((_a, total, delta) => ticks.push([total, delta]));
    t.start();
    device.advance(FRAME * 4);
    t.cancel();
    expect(ticks.length).toBeGreaterThanOrEqual(4);
    expect(ticks[0]).toEqual([0, 0]);
    expect(ticks[1]![1]).toBeCloseTo(FRAME, 5);
  });
});

describe('ObjectAnimator', () => {
  it('animates view properties by name and by Property, starting from the current value', () => {
    const { device, box } = boot();
    expect(box.getAlpha()).toBe(1);
    const fade = ObjectAnimator.ofFloat(box, 'alpha', 0.2);
    fade.start();
    device.advance(FRAME + 150);
    expect(box.getAlpha()).toBeLessThan(1);
    expect(box.getAlpha()).toBeGreaterThan(0.2);
    device.advance(200);
    expect(box.getAlpha()).toBeCloseTo(0.2);

    const move = ObjectAnimator.ofFloat(box, View.TRANSLATION_X, 0, 100);
    move.setDuration(100);
    move.start();
    device.advance(150);
    expect(box.getTranslationX()).toBe(100);
    expect(box.getX()).toBe(120);
  });

  it('animates colors with ofArgb and draws the result', () => {
    const { device, box } = boot();
    const anim = ObjectAnimator.ofArgb(box, 'backgroundColor', Color.RED, Color.GREEN);
    anim.setDuration(100);
    anim.start();
    device.advance(150);
    const png = PNG.sync.read(device.screenshot(1));
    const i = (145 * png.width + 70) * 4;
    expect([png.data[i], png.data[i + 1], png.data[i + 2]]).toEqual([0, 255, 0]);
  });

  it('warns once when the target has no setter', () => {
    const { device } = boot();
    const target = { getFoo: () => 1 };
    const anim = ObjectAnimator.ofFloat(target, 'bar', 0, 1);
    anim.start();
    anim.end();
    expect(device.logs.some((l) => l.includes('setBar'))).toBe(true);
  });

  it('auto-cancels a running animator of the same property', () => {
    const { device, box } = boot();
    const a = ObjectAnimator.ofFloat(box, 'translationY', 0, 100);
    const b = ObjectAnimator.ofFloat(box, 'translationY', 0, -100);
    b.setAutoCancel(true);
    const ja = journal();
    a.addListener(ja.listener);
    a.start();
    device.advance(50);
    b.start();
    expect(ja.calls).toEqual(['start', 'cancel', 'end']);
    device.advance(400);
    expect(box.getTranslationY()).toBe(-100);
  });
});

describe('AnimatorSet', () => {
  const timed = (log: string[], name: string, device: Device, duration = 100): Animator => {
    const a = ValueAnimator.ofFloat(0, 1);
    a.setDuration(duration);
    a.addListener({
      onAnimationStart: () => log.push(`${name}+${Math.round(device.clock.now())}`),
      onAnimationEnd: () => log.push(`${name}-${Math.round(device.clock.now())}`),
    });
    return a;
  };

  it('plays sequentially, then reports its own end', () => {
    const { device } = boot();
    const log: string[] = [];
    const set = new AnimatorSet();
    set.playSequentially(timed(log, 'a', device), timed(log, 'b', device));
    set.addListener({ onAnimationEnd: () => log.push('set-end') });
    expect(set.getTotalDuration()).toBe(200);
    const t0 = device.clock.now();
    set.start();
    device.advance(400);
    expect(log.map((l) => l.replace(/[+-]\d+$/, (m) => m[0]!))).toEqual(['a+', 'a-', 'b+', 'b-', 'set-end']);
    const bStart = Number(log.find((l) => l.startsWith('b+'))!.slice(2)) - t0;
    expect(bStart).toBeGreaterThanOrEqual(100);
    expect(bStart).toBeLessThan(140);
  });

  it('builds play().with().before().after(delay) graphs', () => {
    const { device } = boot();
    const log: string[] = [];
    const a = timed(log, 'a', device);
    const b = timed(log, 'b', device, 50);
    const c = timed(log, 'c', device);
    const set = new AnimatorSet();
    set.play(a).with(b).before(c).after(60);
    expect(set.getTotalDuration()).toBe(260);
    set.start();
    device.advance(30);
    expect(log).toEqual([]);
    device.advance(60);
    expect(log.filter((l) => l.endsWith('+') || /\+\d+$/.test(l)).map((l) => l[0])).toEqual(['a', 'b']);
    device.advance(300);
    expect(log.map((l) => l.slice(0, 2))).toEqual(['a+', 'b+', 'b-', 'a-', 'c+', 'c-']);
  });

  it('overrides child durations, cancels and ends its children', () => {
    const { device } = boot();
    const a = ValueAnimator.ofFloat(0, 1);
    const b = ValueAnimator.ofFloat(0, 10);
    const set = new AnimatorSet();
    set.setDuration(50);
    set.playTogether(a, b);
    set.start();
    expect(a.getDuration()).toBe(50);
    device.advance(30);
    set.cancel();
    expect(a.isRunning()).toBe(false);
    expect(set.isRunning()).toBe(false);
    const set2 = new AnimatorSet();
    const c = ValueAnimator.ofFloat(0, 5);
    const d = ValueAnimator.ofFloat(0, 7);
    set2.playSequentially(c, d);
    set2.end();
    expect(c.getAnimatedValue()).toBe(5);
    expect(d.getAnimatedValue()).toBe(7);
  });
});

describe('ViewPropertyAnimator', () => {
  it('animates several properties together on the next frame and runs the end action', () => {
    const { device, box } = boot();
    let ended = 0;
    let started = 0;
    box.animate().translationX(100).alpha(0.5).scaleX(2).setDuration(200).withStartAction(() => started++).withEndAction(() => ended++);
    expect(box.getTranslationX()).toBe(0);
    device.advance(FRAME * 2);
    expect(started).toBe(1);
    device.advance(100);
    expect(box.getTranslationX()).toBeGreaterThan(0);
    expect(box.getTranslationX()).toBeLessThan(100);
    device.advance(200);
    expect(box.getTranslationX()).toBe(100);
    expect(box.getAlpha()).toBe(0.5);
    expect(box.getScaleX()).toBe(2);
    expect(ended).toBe(1);
  });

  it('a new animation of a property takes it over; the cancelled one skips its end action', () => {
    const { device, box } = boot();
    let firstEnd = 0;
    box.animate().translationY(200).setDuration(300).withEndAction(() => firstEnd++);
    device.advance(100);
    box.animate().translationY(-50).setDuration(100).withEndAction(() => {});
    device.advance(300);
    expect(box.getTranslationY()).toBe(-50);
    expect(firstEnd).toBe(0);
    expect(box.animate().runningCount).toBe(0);
  });

  it('draws the view where the animation put it', () => {
    const { device, box } = boot();
    box.animate().translationY(300).setDuration(100).start();
    device.advance(200);
    const png = PNG.sync.read(device.screenshot(1));
    const at = (x: number, y: number) => {
      const i = (y * png.width + x) * 4;
      return [png.data[i], png.data[i + 1], png.data[i + 2]];
    };
    expect(at(70, 445)).toEqual([0x67, 0x50, 0xa4]);
    expect(at(70, 145)).toEqual([255, 255, 255]);
  });
});

describe('dynamic animations', () => {
  it('a spring settles on its final position; bouncy springs overshoot, critically damped ones do not', () => {
    const { device, box } = boot();
    const run = (damping: number) => {
      box.setTranslationX(0);
      const spring = new SpringAnimation(box, DynamicAnimation.TRANSLATION_X, 100);
      spring.getSpring()!.setDampingRatio(damping).setStiffness(SpringForce.STIFFNESS_LOW);
      let max = 0;
      let endValue = Number.NaN;
      spring.addUpdateListener((_a, value) => (max = Math.max(max, value)));
      spring.addEndListener((_a, canceled, value) => {
        expect(canceled).toBe(false);
        endValue = value;
      });
      spring.start();
      device.settle(4000);
      expect(spring.isRunning()).toBe(false);
      expect(endValue).toBe(100);
      expect(box.getTranslationX()).toBe(100);
      return max;
    };
    expect(run(SpringForce.DAMPING_RATIO_HIGH_BOUNCY)).toBeGreaterThan(130);
    expect(run(SpringForce.DAMPING_RATIO_NO_BOUNCY)).toBeLessThanOrEqual(100);
    expect(run(2)).toBeLessThanOrEqual(100);
  });

  it('retargets with animateToFinalPosition and keeps its velocity', () => {
    const { device } = boot();
    const holder = new FloatValueHolder(0);
    const spring = new SpringAnimation(holder);
    spring.animateToFinalPosition(100);
    device.advance(100);
    const mid = holder.getValue();
    expect(mid).toBeGreaterThan(0);
    spring.animateToFinalPosition(-100);
    device.settle(5000);
    expect(holder.getValue()).toBe(-100);
  });

  it('a fling decelerates with friction and stops at its bounds', () => {
    const { device } = boot();
    const holder = new FloatValueHolder(0);
    const fling = new FlingAnimation(holder);
    fling.setStartVelocity(2000).setFriction(1);
    let ended = false;
    fling.addEndListener(() => (ended = true));
    fling.start();
    device.advance(100);
    const early = holder.getValue();
    device.advance(100);
    const later = holder.getValue() - early;
    expect(later).toBeLessThan(early); // slowing down
    device.settle(5000);
    expect(ended).toBe(true);
    // v0 / 4.2 is where an unbounded fling comes to rest
    expect(holder.getValue()).toBeGreaterThan(400);
    expect(holder.getValue()).toBeLessThan(2000 / 4.2 + 1);

    const bounded = new FloatValueHolder(0);
    const clamped = new FlingAnimation(bounded).setStartVelocity(5000).setMaxValue(120);
    clamped.start();
    device.settle(3000);
    expect(bounded.getValue()).toBe(120);
  });

  it('cancel reports canceled to end listeners', () => {
    const { device } = boot();
    const holder = new FloatValueHolder(0);
    const spring = new SpringAnimation(holder);
    let canceled: boolean | null = null;
    spring.addEndListener((_a, c) => (canceled = c));
    spring.animateToFinalPosition(50);
    device.advance(50);
    spring.cancel();
    expect(canceled).toBe(true);
  });
});
