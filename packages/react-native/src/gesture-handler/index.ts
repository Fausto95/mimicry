/**
 * `react-native-gesture-handler`, provided by Mimicry: the v2 builder API,
 * the v3 hook API and the legacy handler components, recognized by the
 * engine's gesture arena (packages/react-native-fabric/src/input/gestures). The export
 * surface follows react-native-gesture-handler 3.x, plus the 2.x names apps
 * still import.
 */
import { GestureDetector } from './detector';
import {
  BaseButton, BorderlessButton, DrawerLayoutAndroid, FlatList, Pressable, RawButton, RectButton, RefreshControl, ScrollView,
  Switch, Text, TextInput,
} from './components';

export { State, Directions, PointerType, MouseButton, HoverEffect } from './constants';
export { GestureDetector } from './detector';
export { Gesture, GestureObjects } from './gestures';
export type {
  BaseGesture, ContinousBaseGesture, PanGesture, TapGesture, LongPressGesture, FlingGesture, PinchGesture, RotationGesture,
  NativeGesture, ManualGesture, HoverGesture, ForceTouchGesture, ComposedGesture, SimultaneousGesture, ExclusiveGesture,
  GestureStateManager as LegacyGestureStateManager,
} from './gestures';
export {
  useTapGesture, usePanGesture, useLongPressGesture, useFlingGesture, usePinchGesture, useRotationGesture, useNativeGesture,
  useManualGesture, useHoverGesture, useSimultaneousGestures, useExclusiveGestures, useCompetingGestures, GestureStateManager,
} from './hooks';
export {
  PanGestureHandler, TapGestureHandler, LongPressGestureHandler, FlingGestureHandler, PinchGestureHandler,
  RotationGestureHandler, NativeViewGestureHandler, ForceTouchGestureHandler, createNativeWrapper,
  createNativeWrapper as legacy_createNativeWrapper,
} from './legacy';
export {
  GestureHandlerRootView, gestureHandlerRootHOC, BaseButton, BorderlessButton, RawButton, RectButton, ScrollView, FlatList,
  Switch, TextInput, RefreshControl, DrawerLayoutAndroid, Pressable, Text, Touchable,
} from './components';
export {
  TouchableHighlight, TouchableNativeFeedback, TouchableOpacity, TouchableWithoutFeedback,
} from '../components/touchables';
export { Swipeable } from './swipeable';
export { DrawerLayout } from './drawer-layout';

/** v3 detector variants: Mimicry attaches every gesture to a host view, so they share one implementation. */
export const InterceptingGestureDetector = GestureDetector;
export const VirtualGestureDetector = GestureDetector;
export enum GestureDetectorType {
  Native,
  Virtual,
  Intercepting,
}

// 3.x keeps the 2.x components under Legacy* names.
export const LegacyBaseButton = BaseButton;
export const LegacyBorderlessButton = BorderlessButton;
export const LegacyRawButton = RawButton;
export const LegacyRectButton = RectButton;
export const LegacyScrollView = ScrollView;
export const LegacyFlatList = FlatList;
export const LegacySwitch = Switch;
export const LegacyTextInput = TextInput;
export const LegacyRefreshControl = RefreshControl;
export const LegacyDrawerLayoutAndroid = DrawerLayoutAndroid;
export const LegacyPressable = Pressable;
export const LegacyText = Text;
