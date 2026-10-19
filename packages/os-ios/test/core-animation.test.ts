import { describe, expect, it } from 'vitest';
import {
  CAAnimationGroup, CABasicAnimation, CAKeyframeAnimation, CAMediaTimingFillMode, CAMediaTimingFunction, CAMediaTimingFunctionName,
  CASpringAnimation, CATransaction, CGAffineTransformMakeRotation, CGAffineTransformMakeScale, CGRectMake, UIColor, UIView,
  springProgress, type CAAnimation, type CAAnimationDelegate,
} from '@mimicry/os-ios';
import { boot, close, pixel } from './helpers';

function box(color = UIColor.systemRed) {
  const env = boot();
  const view = new UIView(CGRectMake(0, 100, 100, 100));
  view.backgroundColor = color;
  env.root.view.addSubview(view);
  env.device.advance(17);
  return { ...env, view };
}

describe('CAMediaTimingFunction', () => {
  it('has Core Animation control points for the named curves', () => {
    expect(new CAMediaTimingFunction(CAMediaTimingFunctionName.default).getControlPoint(1)).toEqual([0.25, 0.1]);
    expect(CAMediaTimingFunction.easeInEaseOut.getControlPoint(2)).toEqual([0.58, 1]);
    expect(CAMediaTimingFunction.linear.evaluate(0.3)).toBeCloseTo(0.3);
    expect(CAMediaTimingFunction.easeInEaseOut.evaluate(0.5)).toBeCloseTo(0.5, 4);
    expect(CAMediaTimingFunction.easeIn.evaluate(0.25)).toBeLessThan(0.25);
    expect(new CAMediaTimingFunction(0, 0, 0.58, 1).evaluate(0.25)).toBeGreaterThan(0.25);
  });
});

describe('CALayer animations', () => {
  it('shows presentation values while the model stays as set, then removes the animation', () => {
    const { device, view } = box();
    const events: string[] = [];
    const delegate: CAAnimationDelegate = {
      animationDidStart: () => events.push('start'),
      animationDidStop: (_a: CAAnimation, finished: boolean) => events.push(`stop:${finished}`),
    };
    const move = new CABasicAnimation('position.x');
    move.fromValue = 50;
    move.toValue = 250;
    move.duration = 1;
    move.timingFunction = CAMediaTimingFunction.linear;
    move.delegate = delegate;
    view.layer.add(move, 'move');
    expect(view.layer.animationKeys()).toEqual(['move']);
    device.advance(500);
    expect(view.layer.position.x).toBe(50); // the model
    expect(view.layer.presentation().position.x).toBeCloseTo(150, 0);
    // On screen: the box spans x 100…200 now.
    expect(pixel(device, 150, 150)).toEqual([255, 59, 48]);
    expect(pixel(device, 30, 150)).toEqual([255, 255, 255]);
    device.advance(600);
    expect(events).toEqual(['start', 'stop:true']);
    expect(view.layer.animationKeys()).toBeNull();
    expect(pixel(device, 30, 150)).toEqual([255, 59, 48]);
  });

  it('holds the final value with fillMode forwards and isRemovedOnCompletion false', () => {
    const { device, view } = box();
    const fade = new CABasicAnimation('opacity');
    fade.toValue = 0;
    fade.duration = 0.2;
    fade.fillMode = CAMediaTimingFillMode.forwards;
    fade.isRemovedOnCompletion = false;
    view.layer.add(fade, 'fade');
    device.advance(400);
    expect(view.layer.opacity).toBe(1);
    expect(view.layer.presentation().opacity).toBe(0);
    expect(pixel(device, 50, 150)).toEqual([255, 255, 255]);
    expect(view.layer.animationKeys()).toEqual(['fade']);
    view.layer.removeAllAnimations();
    expect(pixel(device, 50, 150)).toEqual([255, 59, 48]);
  });

  it('uses the transaction duration when an animation has none, and runs the completion block after it', () => {
    const { device, view } = box();
    let done = 0;
    CATransaction.begin();
    CATransaction.setAnimationDuration(0.5);
    CATransaction.setCompletionBlock(() => done++);
    const a = new CABasicAnimation('opacity');
    a.fromValue = 0;
    view.layer.add(a, 'a');
    CATransaction.commit();
    expect(view.layer.animation('a')!.duration).toBe(0.5);
    device.advance(400);
    expect(done).toBe(0);
    device.advance(200);
    expect(done).toBe(1);
  });

  it('calls a completion block right after commit when nothing animated', () => {
    const { device } = box();
    let done = 0;
    CATransaction.begin();
    CATransaction.setCompletionBlock(() => done++);
    CATransaction.commit();
    device.advance(17);
    expect(done).toBe(1);
  });

  it('reports removal as unfinished and replaces animations with the same key', () => {
    const { device, view } = box();
    const stops: boolean[] = [];
    const make = () => {
      const a = new CABasicAnimation('opacity');
      a.fromValue = 0;
      a.duration = 1;
      a.delegate = { animationDidStop: (_x, finished) => stops.push(finished) };
      return a;
    };
    view.layer.add(make(), 'fade');
    device.advance(100);
    view.layer.add(make(), 'fade');
    expect(stops).toEqual([false]);
    view.layer.removeAnimation('fade');
    expect(stops).toEqual([false, false]);
    expect(view.layer.hasAnimations).toBe(false);
  });

  it('interpolates keyframes at their key times', () => {
    const { device, view } = box();
    const a = new CAKeyframeAnimation('position.y');
    a.values = [150, 350, 250];
    a.keyTimes = [0, 0.2, 1];
    a.duration = 1;
    view.layer.add(a, 'k');
    device.advance(100);
    expect(view.layer.presentation().position.y).toBeCloseTo(250, 0);
    device.advance(500);
    expect(view.layer.presentation().position.y).toBeCloseTo(300, 0);
  });

  it('autoreverses and repeats', () => {
    const { device, view } = box();
    const a = new CABasicAnimation('opacity');
    a.fromValue = 0;
    a.toValue = 1;
    a.duration = 0.5;
    a.autoreverses = true;
    a.repeatCount = 2;
    a.timingFunction = CAMediaTimingFunction.linear;
    view.layer.add(a, 'pulse');
    device.advance(250);
    expect(view.layer.presentation().opacity).toBeCloseTo(0.5, 1);
    device.advance(500);
    expect(view.layer.presentation().opacity).toBeCloseTo(0.5, 1);
    device.advance(500);
    expect(view.layer.presentation().opacity).toBeCloseTo(0.5, 1);
    device.advance(1000);
    expect(view.layer.hasAnimations).toBe(false);
  });

  it('runs a group on one timeline', () => {
    const { device, view } = box();
    const fade = new CABasicAnimation('opacity');
    fade.fromValue = 0;
    fade.toValue = 1;
    fade.duration = 1;
    fade.timingFunction = CAMediaTimingFunction.linear;
    const scale = new CABasicAnimation('transform.scale');
    scale.fromValue = 1;
    scale.toValue = 2;
    scale.beginTime = 0.5;
    scale.duration = 0.5;
    scale.fillMode = CAMediaTimingFillMode.backwards;
    scale.timingFunction = CAMediaTimingFunction.linear;
    const group = new CAAnimationGroup();
    group.animations = [fade, scale];
    group.duration = 1;
    view.layer.add(group, 'group');
    device.advance(250);
    let p = view.layer.presentation();
    expect(p.opacity).toBeCloseTo(0.25, 1);
    expect(p.affineTransform?.[0] ?? 1).toBeCloseTo(1, 2);
    device.advance(500);
    p = view.layer.presentation();
    expect(p.affineTransform![0]).toBeCloseTo(1.5, 1);
  });

  it('animates transforms through their decomposition', () => {
    const { device, view } = box();
    const a = new CABasicAnimation('transform');
    a.fromValue = CGAffineTransformMakeRotation(0);
    a.toValue = CGAffineTransformMakeRotation(Math.PI / 2);
    a.duration = 1;
    a.timingFunction = CAMediaTimingFunction.linear;
    view.layer.add(a, 'spin');
    device.advance(500);
    const m = view.layer.presentation().affineTransform!;
    expect(Math.atan2(m[1], m[0])).toBeCloseTo(Math.PI / 4, 1);
    expect(Math.hypot(m[0], m[1])).toBeCloseTo(1, 3); // rotation, not a shrinking lerp
    void CGAffineTransformMakeScale;
  });

  it('animates colors', () => {
    const { device, view } = box(UIColor.black);
    const a = new CABasicAnimation('backgroundColor');
    a.fromValue = UIColor.black.cgColor;
    a.toValue = UIColor.white.cgColor;
    a.duration = 1;
    a.timingFunction = CAMediaTimingFunction.linear;
    view.layer.add(a, 'c');
    device.advance(500);
    expect(close(pixel(device, 50, 150), [128, 128, 128], 4)).toBe(true);
  });
});

describe('CASpringAnimation', () => {
  it('solves the damped spring and reports its settling duration', () => {
    const spring = new CASpringAnimation('position.x');
    spring.mass = 1;
    spring.stiffness = 100;
    spring.damping = 10;
    expect(spring.settlingDuration).toBeGreaterThan(1);
    expect(spring.settlingDuration).toBeLessThan(2);
    // Underdamped (ζ = 0.5): overshoots, then comes back.
    const peak = Math.max(...Array.from({ length: 100 }, (_, i) => springProgress(spring.parameters, i / 50)));
    expect(peak).toBeGreaterThan(1.1);
    expect(springProgress(spring.parameters, 5)).toBeCloseTo(1, 3);
  });

  it('takes the iOS 17 perceptual parameters', () => {
    const spring = new CASpringAnimation({ perceptualDuration: 0.5, bounce: 0.2 });
    expect(spring.perceptualDuration).toBeCloseTo(0.5, 5);
    expect(spring.bounce).toBeCloseTo(0.2, 5);
    expect(spring.mass).toBe(1);
  });

  it('moves a layer with spring progress', () => {
    const { device, view } = box();
    const spring = new CASpringAnimation('position.x');
    spring.fromValue = 50;
    spring.toValue = 250;
    spring.damping = 8;
    spring.duration = spring.settlingDuration;
    view.layer.add(spring, 'spring');
    let max = 0;
    for (let i = 0; i < 60; i++) {
      device.advance(17);
      if (view.layer.hasAnimations) max = Math.max(max, view.layer.presentation().position.x);
    }
    expect(max).toBeGreaterThan(260);
  });
});
