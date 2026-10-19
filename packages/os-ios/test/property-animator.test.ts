import { describe, expect, it } from 'vitest';
import {
  CADisplayLink, CGRectMake, RunLoop, RunLoopMode, UIColor, UISpringTimingParameters, UIView, UIViewAnimatingPosition,
  UIViewAnimatingState, UIViewAnimationCurve, UIViewPropertyAnimator,
} from '@mimicry/os-ios';
import { boot, pixel } from './helpers';

function scene() {
  const env = boot();
  const view = new UIView(CGRectMake(0, 100, 100, 100));
  view.backgroundColor = UIColor.systemRed;
  env.root.view.addSubview(view);
  env.device.advance(17);
  return { ...env, view };
}

describe('UIViewPropertyAnimator', () => {
  it('runs to the end and reports the position', () => {
    const { device, view } = scene();
    const positions: UIViewAnimatingPosition[] = [];
    const animator = new UIViewPropertyAnimator(1, { curve: UIViewAnimationCurve.linear }, () => {
      view.center = { x: 250, y: 150 };
    });
    animator.addCompletion((p) => positions.push(p));
    expect(animator.state).toBe(UIViewAnimatingState.inactive);
    expect(view.center.x).toBe(50); // the block runs when the animator starts
    animator.startAnimation();
    expect(animator.state).toBe(UIViewAnimatingState.active);
    expect(view.center.x).toBe(250);
    device.advance(500);
    expect(animator.fractionComplete).toBeCloseTo(0.5, 1);
    expect(view.layer.presentation().position.x).toBeCloseTo(150, -1);
    device.advance(600);
    expect(positions).toEqual([UIViewAnimatingPosition.end]);
    expect(animator.state).toBe(UIViewAnimatingState.inactive);
    expect(view.layer.hasAnimations).toBe(false);
  });

  it('scrubs while paused, then reverses back to the start', () => {
    const { device, view } = scene();
    const positions: UIViewAnimatingPosition[] = [];
    const animator = new UIViewPropertyAnimator(1, { curve: UIViewAnimationCurve.easeInOut }, () => {
      view.center = { x: 250, y: 150 };
    });
    animator.addCompletion((p) => positions.push(p));
    animator.pauseAnimation();
    animator.fractionComplete = 0.25;
    device.advance(17);
    expect(view.layer.presentation().position.x).toBeCloseTo(100, 0); // linear scrubbing
    expect(pixel(device, 140, 150)).toEqual([255, 59, 48]);
    animator.isReversed = true;
    animator.startAnimation();
    device.advance(400);
    expect(positions).toEqual([UIViewAnimatingPosition.start]);
    expect(view.center.x).toBe(50); // the model went back too
  });

  it('stops where things are and finishes on request', () => {
    const { device, view } = scene();
    const positions: UIViewAnimatingPosition[] = [];
    const animator = new UIViewPropertyAnimator(1, { curve: UIViewAnimationCurve.linear }, () => {
      view.alpha = 0;
    });
    animator.addCompletion((p) => positions.push(p));
    animator.startAnimation();
    device.advance(300);
    animator.stopAnimation(false);
    expect(animator.state).toBe(UIViewAnimatingState.stopped);
    expect(view.alpha).toBeCloseTo(0.7, 1);
    expect(view.layer.hasAnimations).toBe(false);
    animator.finishAnimation(UIViewAnimatingPosition.current);
    device.advance(17);
    expect(positions).toEqual([UIViewAnimatingPosition.current]);
  });

  it('springs past the target with a low damping ratio', () => {
    const { device, view } = scene();
    const animator = new UIViewPropertyAnimator(1, { timingParameters: new UISpringTimingParameters(0.3) }, () => {
      view.center = { x: 250, y: 150 };
    });
    animator.startAnimation();
    let max = 0;
    for (let i = 0; i < 50; i++) {
      device.advance(17);
      if (view.layer.hasAnimations) max = Math.max(max, view.layer.presentation().position.x);
    }
    expect(max).toBeGreaterThan(260);
  });

  it('starts after a delay and adds animations mid-flight', () => {
    const { device, view } = scene();
    const animator = UIViewPropertyAnimator.runningPropertyAnimator(1, 0.5, 3 << 16, () => {
      view.center = { x: 250, y: 150 };
    });
    device.advance(400);
    expect(view.layer.presentation().position.x).toBeCloseTo(50, 0);
    device.advance(600);
    animator.addAnimations(() => {
      view.alpha = 0;
    });
    device.advance(1000);
    expect(view.alpha).toBe(0);
    expect(view.layer.hasAnimations).toBe(false);
  });
});

describe('CADisplayLink', () => {
  it('calls back every frame with media timestamps until invalidated', () => {
    const { device } = scene();
    const stamps: number[] = [];
    const link = new CADisplayLink((l) => stamps.push(l.timestamp));
    link.add(RunLoop.main, RunLoopMode.common);
    device.advance(100);
    expect(stamps.length).toBeGreaterThanOrEqual(5);
    expect(stamps[1]! - stamps[0]!).toBeCloseTo(1 / 60, 3);
    expect(link.duration).toBeCloseTo(1 / 60, 3);
    link.isPaused = true;
    const paused = stamps.length;
    device.advance(100);
    expect(stamps.length).toBe(paused);
    link.isPaused = false;
    device.advance(50);
    expect(stamps.length).toBeGreaterThan(paused);
    link.invalidate();
    const n = stamps.length;
    device.advance(100);
    expect(stamps.length).toBe(n);
  });

  it('throttles to preferredFramesPerSecond', () => {
    const { device } = scene();
    let calls = 0;
    const link = new CADisplayLink(() => calls++);
    link.preferredFramesPerSecond = 30;
    link.add();
    device.advance(1000);
    expect(calls).toBeGreaterThanOrEqual(28);
    expect(calls).toBeLessThanOrEqual(32);
    link.invalidate();
  });
});
