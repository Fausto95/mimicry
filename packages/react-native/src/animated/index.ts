import { useRef } from 'react';
import * as core from './animated';
import { createAnimatedComponent } from './component';
import { View, Text, Image } from '../components/primitives';
import { ScrollView, FlatList, SectionList } from '../components/lists';

export { Easing } from './easing';

export const Animated = {
  Value: core.AnimatedValue,
  ValueXY: core.AnimatedValueXY,
  Interpolation: core.AnimatedInterpolation,
  Node: core.AnimatedNode,
  timing: core.timing,
  spring: core.spring,
  decay: core.decay,
  sequence: core.sequence,
  parallel: core.parallel,
  stagger: core.stagger,
  loop: core.loop,
  delay: core.delay,
  event: core.event,
  forkEvent: core.forkEvent,
  unforkEvent: core.unforkEvent,
  attachNativeEvent: core.attachNativeEvent,
  add: core.add,
  subtract: core.subtract,
  multiply: core.multiply,
  divide: core.divide,
  modulo: core.modulo,
  diffClamp: core.diffClamp,
  createAnimatedComponent,
  View: createAnimatedComponent(View),
  Text: createAnimatedComponent(Text),
  Image: createAnimatedComponent(Image),
  ScrollView: createAnimatedComponent(ScrollView),
  FlatList: createAnimatedComponent(FlatList),
  SectionList: createAnimatedComponent(SectionList),
};

export function useAnimatedValue(initial: number, config?: { useNativeDriver?: boolean }): core.AnimatedValue {
  const ref = useRef<core.AnimatedValue | null>(null);
  ref.current ??= new core.AnimatedValue(initial, config);
  return ref.current;
}
