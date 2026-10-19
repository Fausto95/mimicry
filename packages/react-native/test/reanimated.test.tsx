import React, { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { Pressable, View } from 'react-native';
import { render, type Session } from '@mimicry/testing';
import Animated, {
  css, Easing, FadeIn, FadeOut, interpolate, interpolateColor, Keyframe, LinearTransition, useAnimatedStyle, useDerivedValue,
  useSharedValue, withDelay, withRepeat, withSequence, withSpring, withTiming, Extrapolation, type SharedValue,
} from '@mimicry/react-native/reanimated';
import { scheduleOnRN } from '@mimicry/react-native/worklets';

const node = (s: Session, testID: string) => s.engine.nodes.get(s.find({ testID })[0]!.id)!;

describe('Reanimated', () => {
  it('animates a shared value into a style on the frame clock, without React renders', async () => {
    let renders = 0;
    let progress!: SharedValue<number>;
    function Box() {
      renders++;
      progress = useSharedValue(0);
      const style = useAnimatedStyle(() => ({ opacity: progress.value, transform: [{ translateX: progress.value * 100 }] }));
      return <Animated.View testID="box" style={[{ width: 10, height: 10 }, style]} />;
    }
    const s = await render(<Box />);
    const before = renders;
    progress.value = withTiming(1, { duration: 200, easing: Easing.linear });
    s.advance(116);
    const mid = node(s, 'box').computed.opacity as number;
    expect(mid).toBeGreaterThan(0.3);
    expect(mid).toBeLessThan(0.7);
    s.settle();
    expect(node(s, 'box').computed.opacity).toBe(1);
    expect(s.find({ testID: 'box' })[0]!.rect.x).toBe(100);
    expect(renders).toBe(before);
    s.dispose();
  });

  it('re-runs updaters only when the shared values they read change', async () => {
    let runs = 0;
    let a!: SharedValue<number>;
    let b!: SharedValue<number>;
    let flag!: SharedValue<boolean>;
    function Box() {
      a = useSharedValue(1);
      b = useSharedValue(2);
      flag = useSharedValue(true);
      const doubled = useDerivedValue(() => a.value * 2);
      const style = useAnimatedStyle(() => {
        runs++;
        return { width: flag.value ? doubled.value : b.value, height: 10 };
      }, []);
      return <Animated.View testID="box" style={style} />;
    }
    const s = await render(<Box />);
    s.settle();
    const initial = runs;
    b.value = 50; // not read while flag is true
    s.settle();
    expect(runs).toBe(initial);
    a.value = 10; // a → doubled → style
    s.settle();
    expect(runs).toBe(initial + 1);
    expect(s.find({ testID: 'box' })[0]!.rect.w).toBe(20);
    flag.value = false;
    s.settle();
    expect(s.find({ testID: 'box' })[0]!.rect.w).toBe(50);
    s.dispose();
  });

  it('springs, sequences, repeats and delays', async () => {
    let x!: SharedValue<number>;
    function Box() {
      x = useSharedValue(0);
      const style = useAnimatedStyle(() => ({ transform: [{ translateY: x.value }] }));
      return <Animated.View testID="box" style={[{ width: 10, height: 10 }, style]} />;
    }
    const s = await render(<Box />);
    x.value = withSpring(100);
    s.settle();
    expect(x.value).toBe(100);
    x.value = withSequence(withTiming(0, { duration: 100 }), withTiming(50, { duration: 100 }));
    s.advance(116);
    expect(x.value).toBeLessThan(10);
    s.settle();
    expect(x.value).toBe(50);
    x.value = withDelay(200, withTiming(0, { duration: 100 }));
    s.advance(150);
    expect(x.value).toBe(50);
    s.settle();
    expect(x.value).toBe(0);
    let finished: boolean | undefined;
    x.value = withRepeat(withTiming(10, { duration: 50 }), 3, true, (f) => {
      finished = f;
    });
    s.settle();
    expect(finished).toBe(true);
    expect(x.value).toBe(10); // 0→10, 10→0, 0→10
    s.dispose();
  });

  it('plays entering animations from the first frame and clears them afterwards', async () => {
    // render() settles, so mount the animated view after the first render
    let show!: (v: boolean) => void;
    function Toggle() {
      const [visible, setVisible] = useState(false);
      show = setVisible;
      return <View>{visible ? <Animated.View testID="box" entering={FadeIn.duration(200)} style={{ width: 10, height: 10 }} /> : null}</View>;
    }
    const t = await render(<Toggle />);
    const { act } = await import('react');
    act(() => show(true));
    expect(node(t, 'box').computed.opacity).toBe(0);
    t.advance(100);
    const mid = node(t, 'box').computed.opacity as number;
    expect(mid).toBeGreaterThan(0.2);
    expect(mid).toBeLessThan(0.8);
    t.settle();
    expect(node(t, 'box').overrides?.opacity).toBeUndefined();
    t.dispose();
  });

  it('keeps an exiting view on screen until its animation finishes', async () => {
    let hide!: () => void;
    function Toggle() {
      const [visible, setVisible] = useState(true);
      hide = () => setVisible(false);
      return (
        <View style={{ flexDirection: 'row' }}>
          {visible ? <Animated.View testID="leaving" exiting={FadeOut.duration(300)} style={{ width: 40, height: 40 }} /> : null}
          <View testID="sibling" style={{ width: 40, height: 40 }} />
        </View>
      );
    }
    const s = await render(<Toggle />);
    const leaving = node(s, 'leaving');
    const { act } = await import('react');
    act(() => hide());
    s.advance(150);
    expect(leaving.exiting).toBe(true);
    expect(leaving.parent).not.toBeNull();
    expect(leaving.computed.opacity).toBeLessThan(1);
    // the sibling re-laid out immediately; the exiting view is pinned where it was
    expect(s.find({ testID: 'sibling' })[0]!.rect.x).toBe(0);
    s.settle();
    expect(leaving.parent).toBeNull();
    expect(s.exists({ testID: 'leaving' })).toBe(false);
    s.dispose();
  });

  it('runs Keyframes with per-keyframe easing and worklet callbacks', async () => {
    const calls: boolean[] = [];
    let show!: () => void;
    const keyframe = new Keyframe({
      0: { opacity: 0, transform: [{ scale: 2 }] },
      50: { opacity: 1, easing: Easing.linear },
      100: { opacity: 1, transform: [{ scale: 1 }], easing: Easing.elastic(0.7) },
    })
      .duration(400)
      .withCallback((finished) => {
        'worklet';
        scheduleOnRN((f: boolean) => calls.push(f), finished);
      });
    function Toggle() {
      const [visible, setVisible] = useState(false);
      show = () => setVisible(true);
      return visible ? <Animated.View testID="k" entering={keyframe} style={{ width: 10, height: 10 }} /> : null;
    }
    const s = await render(<Toggle />);
    const { act } = await import('react');
    act(() => show());
    expect(node(s, 'k').computed.opacity).toBe(0);
    s.advance(100);
    // linear toward the 50% keyframe (opacity 1 at 200ms)
    const opacity = node(s, 'k').computed.opacity as number;
    expect(opacity).toBeGreaterThan(0.25);
    expect(opacity).toBeLessThan(0.55);
    s.settle();
    expect(calls).toEqual([true]);
    s.dispose();
  });

  it('animates layout changes with LinearTransition', async () => {
    let remove!: () => void;
    function List() {
      const [items, setItems] = useState(['a', 'b']);
      remove = () => setItems(['b']);
      return (
        <View>
          {items.map((id) => (
            <Animated.View key={id} testID={id} layout={LinearTransition.duration(200).easing(Easing.linear)} style={{ height: 50 }} />
          ))}
        </View>
      );
    }
    const s = await render(<List />);
    expect(s.find({ testID: 'b' })[0]!.rect.y).toBe(50);
    const { act } = await import('react');
    act(() => remove());
    s.advance(116);
    const mid = s.find({ testID: 'b' })[0]!.rect.y;
    expect(mid).toBeGreaterThan(10);
    expect(mid).toBeLessThan(40);
    s.settle();
    expect(s.find({ testID: 'b' })[0]!.rect.y).toBe(0);
    s.dispose();
  });

  it('runs CSS animations and transitions', async () => {
    const pulse = css.keyframes({ from: { opacity: 0 }, to: { opacity: 1 } });
    let toggle!: () => void;
    function Box() {
      const [wide, setWide] = useState(false);
      toggle = () => setWide(true);
      return (
        <Pressable>
          <Animated.View
            testID="box"
            style={{ height: 10, width: wide ? 200 : 100, animationName: pulse, animationDuration: '200ms', animationTimingFunction: 'linear', transitionProperty: 'width', transitionDuration: 200, transitionTimingFunction: 'linear' }}
          />
        </Pressable>
      );
    }
    const s = await render(<Box />, { device: 'iphone-17-pro' });
    s.settle();
    expect(node(s, 'box').overrides?.opacity).toBeUndefined();
    const { act } = await import('react');
    act(() => toggle());
    s.advance(100);
    const w = s.find({ testID: 'box' })[0]!.rect.w;
    expect(w).toBeGreaterThan(110);
    expect(w).toBeLessThan(190);
    s.settle();
    expect(s.find({ testID: 'box' })[0]!.rect.w).toBe(200);
    s.dispose();
  });

  it('accepts shared values inline in styles and custom entering functions', async () => {
    let width!: SharedValue<number>;
    let show!: () => void;
    function Scene() {
      width = useSharedValue(10);
      const [visible, setVisible] = useState(false);
      show = () => setVisible(true);
      return (
        <View>
          <Animated.View testID="inline" style={{ width, height: 10 }} />
          {visible ? (
            <Animated.View
              testID="custom"
              style={{ width: 10, height: 10 }}
              entering={() => ({ initialValues: { opacity: 0 }, animations: { opacity: withTiming(1, { duration: 100 }) } })}
            />
          ) : null}
        </View>
      );
    }
    const s = await render(<Scene />);
    width.value = 60;
    s.settle();
    expect(s.find({ testID: 'inline' })[0]!.rect.w).toBe(60);
    const { act } = await import('react');
    act(() => show());
    expect(node(s, 'custom').computed.opacity).toBe(0);
    s.settle();
    expect(node(s, 'custom').overrides?.opacity).toBeUndefined();
    s.dispose();
  });

  it('interpolates numbers and colors', () => {
    expect(interpolate(5, [0, 10], [0, 100])).toBe(50);
    expect(interpolate(20, [0, 10], [0, 100], Extrapolation.CLAMP)).toBe(100);
    expect(interpolate(-10, [0, 10], [0, 100])).toBe(-100);
    expect(interpolateColor(0, [0, 1], ['red', 'blue'])).toBe('rgba(255, 0, 0, 1)');
    expect(interpolateColor(1, [0, 1], ['red', 'blue'])).toBe('rgba(0, 0, 255, 1)');
  });
});
