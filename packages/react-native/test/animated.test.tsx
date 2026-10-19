import React, { useRef } from 'react';
import { describe, expect, it } from 'vitest';
import { Animated, Easing, View } from 'react-native';
import { render } from '@mimicry/testing';

describe('Animated', () => {
  it('drives nested animated children independently of their animated parent', async () => {
    let inner!: InstanceType<typeof Animated.Value>;
    function Scene() {
      const outer = useRef(new Animated.Value(1)).current;
      inner = useRef(new Animated.Value(0)).current;
      return (
        <Animated.View style={{ opacity: outer }}>
          <Animated.View testID="inner" style={{ width: 100, height: 20, transform: [{ translateX: inner }] }} />
        </Animated.View>
      );
    }
    const s = await render(<Scene />);
    Animated.timing(inner, { toValue: 100, duration: 200, easing: Easing.linear, useNativeDriver: true }).start();
    s.advance(100);
    const mid = s.find({ testID: 'inner' })[0]!.rect.x;
    s.advance(200);
    const end = s.find({ testID: 'inner' })[0]!.rect.x;
    expect(mid).toBeGreaterThan(30);
    expect(mid).toBeLessThan(70);
    expect(end).toBe(100);
    s.dispose();
  });

  it('springs settle on the target without React re-renders', async () => {
    let renders = 0;
    let value!: InstanceType<typeof Animated.Value>;
    function Scene() {
      renders++;
      value = useRef(new Animated.Value(0)).current;
      return <Animated.View testID="box" style={{ width: 10, height: 10, transform: [{ translateY: value }] }} />;
    }
    const s = await render(<Scene />);
    const before = renders;
    Animated.spring(value, { toValue: 50, useNativeDriver: true }).start();
    s.settle();
    expect(s.find({ testID: 'box' })[0]!.rect.y).toBeCloseTo(50, 1);
    expect(renders).toBe(before);
    s.dispose();
  });
});
