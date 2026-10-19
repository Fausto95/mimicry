import { describe, expect, it } from 'vitest';
import {
  CGAffineTransformMakeScale, CGRectMake, UIColor, UIControl, UIControlEvents, UIView, UIViewAnimationOptions,
  UIViewKeyframeAnimationOptions,
} from '@mimicry/os-ios';
import { boot, close, pixel } from './helpers';

function scene() {
  const env = boot();
  const view = new UIView(CGRectMake(0, 100, 100, 100));
  view.backgroundColor = UIColor.systemRed;
  env.root.view.addSubview(view);
  env.device.advance(17);
  return { ...env, view };
}

describe('UIView.animate', () => {
  it('sets the model at once and animates the presentation, then completes', () => {
    const { device, view } = scene();
    const done: boolean[] = [];
    UIView.animate(1, 0, UIViewAnimationOptions.curveLinear, () => {
      view.frame = CGRectMake(200, 100, 100, 100);
    }, (finished) => done.push(finished));
    expect(view.frame.origin.x).toBe(200);
    expect(view.layer.animationKeys()).toEqual(['position']); // only the position changed
    device.advance(500);
    expect(view.layer.presentation().frame.origin.x).toBeCloseTo(100, 0);
    expect(pixel(device, 150, 150)).toEqual([255, 59, 48]);
    expect(pixel(device, 50, 150)).toEqual([255, 255, 255]);
    expect(done).toEqual([]);
    device.advance(600);
    expect(done).toEqual([true]);
    expect(view.layer.hasAnimations).toBe(false);
  });

  it('defaults to ease-in-out over the duration', () => {
    const { device, view } = scene();
    UIView.animate(1, () => {
      view.center = { x: 250, y: 150 };
    });
    device.advance(250);
    const x = view.layer.presentation().position.x;
    // ease-in-out at 25% time is well behind 25% distance
    expect(x).toBeGreaterThan(50);
    expect(x).toBeLessThan(50 + 200 * 0.2);
  });

  it('blends an interrupting animation from where things are on screen', () => {
    const { device, view } = scene();
    UIView.animate(1, 0, UIViewAnimationOptions.curveLinear, () => {
      view.center = { x: 250, y: 150 };
    });
    device.advance(500);
    const before = view.layer.presentation().position.x;
    UIView.animate(1, 0, UIViewAnimationOptions.curveLinear, () => {
      view.center = { x: 50, y: 150 };
    });
    const after = view.layer.presentation().position.x;
    expect(Math.abs(after - before)).toBeLessThan(2); // no jump
    device.advance(1100);
    expect(view.layer.presentation().position.x).toBeCloseTo(50, 3);
  });

  it('holds the old value during the delay', () => {
    const { device, view } = scene();
    UIView.animate(0.5, 0.5, 0, () => {
      view.alpha = 0;
    });
    device.advance(300);
    expect(view.layer.presentation().opacity).toBe(1);
    device.advance(800);
    expect(view.layer.presentation().opacity).toBe(0);
  });

  it('animates backgroundColor from what is on screen', () => {
    const { device, view } = scene();
    UIView.animate(1, 0, UIViewAnimationOptions.curveLinear, () => {
      view.backgroundColor = UIColor.black;
    });
    device.advance(500);
    expect(close(pixel(device, 50, 150), [128, 30, 24], 8)).toBe(true);
  });

  it('animates the layer cornerRadius and transforms', () => {
    const { device, view } = scene();
    UIView.animate(1, 0, UIViewAnimationOptions.curveLinear, () => {
      view.layer.cornerRadius = 50;
      view.transform = CGAffineTransformMakeScale(2, 2);
    });
    expect(view.layer.animationKeys()?.sort()).toEqual(['cornerRadius', 'transform']);
    device.advance(500);
    const p = view.layer.presentation();
    expect(p.cornerRadius).toBeCloseTo(25, 0);
    expect(p.affineTransform![0]).toBeCloseTo(1.5, 1);
  });

  it('does nothing animated inside performWithoutAnimation or with zero duration', () => {
    const { device, view } = scene();
    let finished: boolean | null = null;
    UIView.animate(1, () => {
      UIView.performWithoutAnimation(() => {
        view.alpha = 0.5;
      });
    }, (f) => (finished = f));
    expect(view.layer.hasAnimations).toBe(false);
    UIView.animate(0, () => {
      view.alpha = 0.2;
    });
    expect(view.layer.hasAnimations).toBe(false);
    device.advance(17);
    expect(finished).toBe(true);
  });

  it('inherits the outer block duration in nested blocks', () => {
    const { view } = scene();
    UIView.animate(2, () => {
      UIView.animate(0.1, () => {
        view.alpha = 0.5;
      });
      expect(UIView.inheritedAnimationDuration).toBe(2);
    });
    expect(view.layer.animation('opacity')!.duration).toBe(2);
  });

  it('repeats and autoreverses', () => {
    const { device, view } = scene();
    UIView.animate(0.5, 0, UIViewAnimationOptions.repeat | UIViewAnimationOptions.autoreverse | UIViewAnimationOptions.curveLinear, () => {
      view.alpha = 0;
    });
    device.advance(750);
    expect(view.layer.presentation().opacity).toBeCloseTo(0.5, 1);
    device.advance(5000);
    expect(view.layer.hasAnimations).toBe(true);
  });

  it('keeps touches from animating views unless allowUserInteraction', () => {
    const { device, root } = scene();
    const button = new UIControl(CGRectMake(20, 400, 200, 60));
    root.view.addSubview(button);
    let taps = 0;
    button.addTarget(() => taps++, UIControlEvents.touchUpInside);
    UIView.animate(1, () => {
      button.alpha = 0.9;
    });
    device.tap(100, 430);
    expect(taps).toBe(0);
    device.advance(1100);
    device.tap(100, 430);
    expect(taps).toBe(1);
    UIView.animate(1, 0, UIViewAnimationOptions.allowUserInteraction, () => {
      button.alpha = 1;
    });
    device.tap(100, 430);
    expect(taps).toBe(2);
  });
});

describe('UIView spring animations', () => {
  it('overshoots with low damping and ends exactly on the duration', () => {
    const { device, view } = scene();
    let done = false;
    UIView.animate(1, 0, 0.3, 0, 0, () => {
      view.center = { x: 250, y: 150 };
    }, () => (done = true));
    let max = 0;
    for (let t = 0; t < 900; t += 17) {
      device.advance(17);
      max = Math.max(max, view.layer.presentation().position.x);
    }
    expect(max).toBeGreaterThan(260);
    expect(done).toBe(false);
    device.advance(200);
    expect(done).toBe(true);
  });

  it('runs the iOS 17 springDuration/bounce spring until it settles', () => {
    const { device, view } = scene();
    let done = false;
    UIView.animate({ springDuration: 0.5, bounce: 0 }, () => {
      view.center = { x: 250, y: 150 };
    }, () => (done = true));
    device.advance(250);
    const x = view.layer.presentation().position.x;
    expect(x).toBeGreaterThan(200); // critically damped: most of the way at half the period
    expect(x).toBeLessThanOrEqual(250.01);
    device.advance(2000);
    expect(done).toBe(true);
  });
});

describe('UIView keyframes and transitions', () => {
  it('animates keyframes at their relative times', () => {
    const { device, view } = scene();
    UIView.animateKeyframes(1, 0, UIViewKeyframeAnimationOptions.calculationModeLinear, () => {
      UIView.addKeyframe(0, 0.5, () => {
        view.center = { x: 250, y: 150 };
      });
      UIView.addKeyframe(0.5, 0.5, () => {
        view.center = { x: 250, y: 350 };
      });
    });
    expect(view.center).toEqual({ x: 250, y: 350 });
    device.advance(250);
    expect(view.layer.presentation().position.x).toBeCloseTo(150, 0);
    expect(view.layer.presentation().position.y).toBeCloseTo(150, 0);
    device.advance(500);
    expect(view.layer.presentation().position.x).toBeCloseTo(250, 0);
    expect(view.layer.presentation().position.y).toBeCloseTo(250, 0);
  });

  it('cross-dissolves a view from its old rendering to the new one', () => {
    const { device, view } = scene();
    let done = false;
    UIView.transition(view, 1, UIViewAnimationOptions.transitionCrossDissolve | UIViewAnimationOptions.curveLinear, () => {
      view.backgroundColor = UIColor.black;
    }, () => (done = true));
    device.advance(500);
    expect(close(pixel(device, 50, 150), [128, 30, 24], 10)).toBe(true);
    device.advance(600);
    expect(done).toBe(true);
    expect(pixel(device, 50, 150)).toEqual([0, 0, 0]);
    expect(view.layer.sublayers.length).toBe(0);
  });

  it('swaps one view for another', () => {
    const { device, root, view } = scene();
    const other = new UIView(CGRectMake(0, 100, 100, 100));
    other.backgroundColor = UIColor.systemBlue;
    UIView.transition(view, other, 0.4, UIViewAnimationOptions.transitionCrossDissolve);
    expect(other.superview).toBe(root.view);
    device.advance(500);
    expect(view.superview).toBeNull();
    expect(pixel(device, 50, 150)).toEqual([0, 122, 255]);
  });

  it('snapshots a view', () => {
    const { device, root, view } = scene();
    const snap = view.snapshotView(false)!;
    snap.frame = CGRectMake(200, 400, 100, 100);
    root.view.addSubview(snap);
    view.backgroundColor = UIColor.systemGreen;
    device.advance(17);
    expect(pixel(device, 250, 450)).toEqual([255, 59, 48]);
    expect(pixel(device, 50, 150)).toEqual([52, 199, 89]);
  });
});
