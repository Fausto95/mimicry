import React, { useMemo, useState } from 'react';
import { describe, expect, it } from 'vitest';
import { Animated, Pressable, ScrollView, Text, View } from 'react-native';
import {
  Gesture, GestureDetector, GestureHandlerRootView, PanGestureHandler, RectButton, State, usePanGesture, useTapGesture,
  useExclusiveGestures,
} from '@mimicry/react-native/gesture-handler';
import Swipeable from '@mimicry/react-native/gesture-handler/swipeable-module';
import { render } from '@mimicry/testing';

const box = { width: 200, height: 200, marginTop: 100, marginLeft: 50, backgroundColor: 'tomato' };

describe('react-native-gesture-handler', () => {
  it('pans with translation and velocity, through the full callback sequence', async () => {
    const log: string[] = [];
    let last: any = null;
    let change = 0;
    function App() {
      const pan = Gesture.Pan()
        .onBegin(() => log.push('begin'))
        .onStart(() => log.push('start'))
        .onUpdate((e) => {
          last = e;
        })
        .onChange((e) => {
          change += e.changeX;
        })
        .onEnd((_e, success) => log.push(`end:${success}`))
        .onFinalize((_e, success) => log.push(`finalize:${success}`));
      return (
        <GestureHandlerRootView style={{ flex: 1 }}>
          <GestureDetector gesture={pan}>
            <View testID="box" style={box} />
          </GestureDetector>
        </GestureHandlerRootView>
      );
    }
    const s = await render(<App />);
    s.drag({ testID: 'box' }, { dx: 120, dy: 30 }, { duration: 240, steps: 12 });
    expect(log).toEqual(['begin', 'start', 'end:true', 'finalize:true']);
    expect(last.translationX).toBeCloseTo(120, 0);
    expect(last.translationY).toBeCloseTo(30, 0);
    expect(last.velocityX).toBeGreaterThan(300); // 120pt over 240ms ≈ 500pt/s
    expect(change).toBeCloseTo(last.translationX, 0);
    expect(last.absoluteX - last.x).toBeCloseTo(50, 0);
    s.dispose();
  });

  it('a tap that moves too far becomes a pan instead', async () => {
    const log: string[] = [];
    function App() {
      const tap = Gesture.Tap().maxDistance(10).onEnd((_e, ok) => ok && log.push('tap'));
      const pan = Gesture.Pan().onStart(() => log.push('pan'));
      return (
        <GestureDetector gesture={Gesture.Race(tap, pan)}>
          <View testID="box" style={box} />
        </GestureDetector>
      );
    }
    const s = await render(<App />);
    s.tap({ testID: 'box' });
    expect(log).toEqual(['tap']);
    s.drag({ testID: 'box' }, { dx: 0, dy: 80 });
    expect(log).toEqual(['tap', 'pan']);
    s.dispose();
  });

  it('long press activates after its duration and fails when released early', async () => {
    const log: string[] = [];
    function App() {
      const lp = Gesture.LongPress()
        .minDuration(400)
        .onStart(() => log.push('start'))
        .onEnd((e, ok) => log.push(`end:${ok}:${Math.round(e.duration / 100) * 100}`))
        .onFinalize((_e, ok) => log.push(`finalize:${ok}`));
      return (
        <GestureDetector gesture={lp}>
          <View testID="box" style={box} />
        </GestureDetector>
      );
    }
    const s = await render(<App />);
    s.tap({ testID: 'box' }, 100);
    expect(log).toEqual(['finalize:false']);
    s.tap({ testID: 'box' }, 600);
    expect(log).toEqual(['finalize:false', 'start', 'end:true:600', 'finalize:true']);
    s.dispose();
  });

  it('Exclusive waits for a double tap to fail before a single tap fires', async () => {
    const log: string[] = [];
    function App() {
      const double = Gesture.Tap().numberOfTaps(2).onEnd((_e, ok) => ok && log.push('double'));
      const single = Gesture.Tap().onEnd((_e, ok) => ok && log.push('single'));
      return (
        <GestureDetector gesture={Gesture.Exclusive(double, single)}>
          <View testID="box" style={box} />
        </GestureDetector>
      );
    }
    const s = await render(<App />);
    s.tap({ testID: 'box' });
    expect(log).toEqual([]); // still waiting for a possible second tap
    s.advance(600);
    expect(log).toEqual(['single']);
    s.tap({ testID: 'box' }).tap({ testID: 'box' });
    expect(log).toEqual(['single', 'double']);
    s.advance(600);
    expect(log).toEqual(['single', 'double']);
    s.dispose();
  });

  it('Simultaneous pinch and pan both track two fingers', async () => {
    let scale = 1;
    let panned = false;
    function App() {
      const pinch = Gesture.Pinch().onUpdate((e) => {
        scale = e.scale;
      });
      const pan = Gesture.Pan().onStart(() => {
        panned = true;
      });
      return (
        <GestureDetector gesture={Gesture.Simultaneous(pinch, pan)}>
          <View testID="box" style={box} />
        </GestureDetector>
      );
    }
    const s = await render(<App />);
    s.pinch({ testID: 'box' }, 1.8, { distance: 80 });
    expect(scale).toBeCloseTo(1.8, 1);
    expect(panned).toBe(false); // the centroid didn't move
    s.dispose();
  });

  it('an activating pan cancels a Pressable underneath (and its onPress)', async () => {
    const log: string[] = [];
    function App() {
      const pan = Gesture.Pan().onStart(() => log.push('pan'));
      return (
        <GestureDetector gesture={pan}>
          <View style={box}>
            <Pressable testID="press" onPress={() => log.push('press')} onPressOut={() => log.push('out')} style={{ flex: 1 }} />
          </View>
        </GestureDetector>
      );
    }
    const s = await render(<App />);
    s.tap({ testID: 'press' });
    expect(log).toEqual(['out', 'press']);
    log.length = 0;
    s.drag({ testID: 'press' }, { dx: 60, dy: 0 });
    expect(log).toEqual(['out', 'pan']);
    s.dispose();
  });

  it('a horizontal pan inside a vertical ScrollView: whichever activates first wins', async () => {
    const log: string[] = [];
    function App() {
      const pan = Gesture.Pan().activeOffsetX([-10, 10]).onStart(() => log.push('pan'));
      return (
        <ScrollView testID="scroll" style={{ flex: 1 }} onScrollBeginDrag={() => log.push('scroll')}>
          <View style={{ height: 100 }} />
          <GestureDetector gesture={pan}>
            <View testID="row" style={{ height: 80, backgroundColor: 'teal' }} />
          </GestureDetector>
          <View style={{ height: 2000 }} />
        </ScrollView>
      );
    }
    const s = await render(<App />);
    s.drag({ testID: 'row' }, { dx: 80, dy: 0 });
    expect(log).toEqual(['pan']);
    const before = s.find({ testID: 'row' })[0]!.rect.y;
    s.drag({ testID: 'row' }, { dx: 0, dy: -150 });
    expect(log).toEqual(['pan', 'scroll']);
    s.settle();
    expect(s.find({ testID: 'row' })[0]!.rect.y).toBeLessThan(before - 100);
    s.dispose();
  });

  it('legacy PanGestureHandler drives Animated.event and reports state changes', async () => {
    const states: number[] = [];
    let x!: InstanceType<typeof Animated.Value>;
    function App() {
      x = useMemo(() => new Animated.Value(0), []);
      return (
        <PanGestureHandler
          onGestureEvent={Animated.event([{ nativeEvent: { translationX: x } }], { useNativeDriver: true })}
          onHandlerStateChange={(e: any) => states.push(e.nativeEvent.state)}
        >
          <Animated.View testID="box" style={[box, { transform: [{ translateX: x }] }]} />
        </PanGestureHandler>
      );
    }
    const s = await render(<App />);
    s.drag({ testID: 'box' }, { dx: 90, dy: 0 });
    expect((x as any).__getValue()).toBeCloseTo(90, 0);
    expect(states).toEqual([State.BEGAN, State.ACTIVE, State.END]);
    s.dispose();
  });

  it('v3 hooks: useExclusiveGestures with usePanGesture and useTapGesture', async () => {
    const log: string[] = [];
    function App() {
      const pan = usePanGesture({ minDistance: 20, onActivate: () => log.push('activate'), onDeactivate: (e: any) => log.push(`deactivate:${e.canceled}`) });
      const tap = useTapGesture({ onActivate: () => log.push('tap') });
      const gesture = useExclusiveGestures(pan, tap);
      return (
        <GestureDetector gesture={gesture}>
          <View testID="box" style={box} />
        </GestureDetector>
      );
    }
    const s = await render(<App />);
    s.tap({ testID: 'box' });
    expect(log).toEqual(['tap']);
    s.drag({ testID: 'box' }, { dx: 50, dy: 0 });
    expect(log).toEqual(['tap', 'activate', 'deactivate:false']);
    s.dispose();
  });

  it('RectButton presses on release, and is cancelled when its ScrollView scrolls', async () => {
    const log: string[] = [];
    function App() {
      const [n, setN] = useState(0);
      return (
        <ScrollView style={{ flex: 1 }}>
          <View style={{ height: 100 }} />
          <RectButton testID="button" onPress={() => setN((v) => v + 1)} onActiveStateChange={(a: boolean) => log.push(`active:${a}`)} style={{ height: 60 }}>
            <Text testID="count">{n}</Text>
          </RectButton>
          <View style={{ height: 2000 }} />
        </ScrollView>
      );
    }
    const s = await render(<App />);
    s.tap({ testID: 'button' });
    expect(s.text({ testID: 'count' })).toEqual(['1']);
    s.drag({ testID: 'button' }, { dx: 0, dy: -120 });
    expect(s.text({ testID: 'count' })).toEqual(['1']);
    expect(log).toEqual(['active:true', 'active:false', 'active:true', 'active:false']);
    s.dispose();
  });

  it('manual activation through the state manager in onTouchesDown', async () => {
    const log: string[] = [];
    function App() {
      const manual = Gesture.Manual()
        .onTouchesDown((e, manager) => {
          log.push(`down:${e.numberOfTouches}`);
          manager.activate();
        })
        .onTouchesUp((_e, manager) => manager.end())
        .onStart(() => log.push('start'))
        .onEnd((_e, ok) => log.push(`end:${ok}`));
      return (
        <GestureDetector gesture={manual}>
          <View testID="box" style={box} />
        </GestureDetector>
      );
    }
    const s = await render(<App />);
    s.tap({ testID: 'box' });
    expect(log).toEqual(['down:1', 'start', 'end:true']);
    s.dispose();
  });

  it('fling recognizes a fast swipe in its direction only', async () => {
    const log: string[] = [];
    function App() {
      const fling = Gesture.Fling().direction(2 /* LEFT */).onEnd((_e, ok) => ok && log.push('fling'));
      return (
        <GestureDetector gesture={fling}>
          <View testID="box" style={box} />
        </GestureDetector>
      );
    }
    const s = await render(<App />);
    s.drag({ testID: 'box' }, { dx: 120, dy: 0 }, { duration: 100 });
    expect(log).toEqual([]);
    s.drag({ testID: 'box' }, { dx: -120, dy: 0 }, { duration: 100 });
    expect(log).toEqual(['fling']);
    s.dispose();
  });

  it('a pan simultaneous with the ScrollView native gesture keeps tracking while it scrolls', async () => {
    const log: string[] = [];
    function App() {
      const native = Gesture.Native();
      const pan = Gesture.Pan().simultaneousWithExternalGesture(native).onStart(() => log.push('pan')).onEnd(() => log.push('pan-end'));
      return (
        <GestureDetector gesture={pan}>
          <View style={{ flex: 1 }}>
            <GestureDetector gesture={native}>
              <ScrollView testID="scroll" style={{ flex: 1 }} onScrollBeginDrag={() => log.push('scroll')}>
                <View testID="content" style={{ height: 3000 }} />
              </ScrollView>
            </GestureDetector>
          </View>
        </GestureDetector>
      );
    }
    const s = await render(<App />);
    s.drag({ testID: 'scroll' }, { dx: 0, dy: -200 });
    expect(log).toEqual(['pan', 'scroll', 'pan-end']);
    s.dispose();
  });

  it('Swipeable opens to reveal its right actions', async () => {
    let opened: string | null = null;
    function App() {
      return (
        <View style={{ paddingTop: 100 }}>
          <Swipeable
            testID="row"
            renderRightActions={() => <View testID="action" style={{ width: 80, height: 60, backgroundColor: 'red' }} />}
            onSwipeableOpen={(direction: string) => {
              opened = direction;
            }}
          >
            <View style={{ height: 60, backgroundColor: 'white' }}><Text>Row</Text></View>
          </Swipeable>
        </View>
      );
    }
    const s = await render(<App />);
    s.drag({ testID: 'row' }, { dx: -120, dy: 0 });
    s.settle();
    expect(opened).toBe('right');
    s.dispose();
  });
});
