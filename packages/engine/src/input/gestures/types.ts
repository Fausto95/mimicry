/**
 * Shared vocabulary of the gesture system. The numbers are react-native-gesture-handler's
 * own (State, TouchEventType, Directions), so JavaScript can pass them through unchanged.
 */
export const GestureState = {
  UNDETERMINED: 0,
  FAILED: 1,
  BEGAN: 2,
  CANCELLED: 3,
  ACTIVE: 4,
  END: 5,
} as const;
export type GestureStateValue = (typeof GestureState)[keyof typeof GestureState];

export const TouchEventType = {
  UNDETERMINED: 0,
  TOUCHES_DOWN: 1,
  TOUCHES_MOVE: 2,
  TOUCHES_UP: 3,
  TOUCHES_CANCELLED: 4,
} as const;
export type TouchEventTypeValue = (typeof TouchEventType)[keyof typeof TouchEventType];

export const Direction = { RIGHT: 1, LEFT: 2, UP: 4, DOWN: 8 } as const;

export type GestureKind = 'tap' | 'pan' | 'longPress' | 'fling' | 'pinch' | 'rotation' | 'native' | 'manual' | 'hover';

/** Handler configuration, with RNGH's native-side names (`minDist`, `activeOffsetXStart`, …). */
export interface GestureConfig {
  enabled?: boolean;
  shouldCancelWhenOutside?: boolean;
  hitSlop?: number | { top?: number; left?: number; bottom?: number; right?: number; horizontal?: number; vertical?: number; width?: number; height?: number };
  manualActivation?: boolean;
  cancelsJSResponder?: boolean;
  /** deliver onTouches* events */
  needsPointerData?: boolean;
  // pan
  minDist?: number;
  activeOffsetXStart?: number;
  activeOffsetXEnd?: number;
  activeOffsetYStart?: number;
  activeOffsetYEnd?: number;
  failOffsetXStart?: number;
  failOffsetXEnd?: number;
  failOffsetYStart?: number;
  failOffsetYEnd?: number;
  minVelocity?: number;
  minVelocityX?: number;
  minVelocityY?: number;
  minPointers?: number;
  maxPointers?: number;
  avgTouches?: boolean;
  activateAfterLongPress?: number;
  // tap
  numberOfTaps?: number;
  maxDurationMs?: number;
  maxDelayMs?: number;
  maxDeltaX?: number;
  maxDeltaY?: number;
  maxDist?: number;
  // long press
  minDurationMs?: number;
  // fling
  direction?: number;
  numberOfPointers?: number;
  // native
  shouldActivateOnStart?: boolean;
  disallowInterruption?: boolean;
}

export interface GestureRelations {
  /** handlers allowed to be active at the same time as this one */
  simultaneousWith: number[];
  /** handlers that must fail before this one may activate */
  waitFor: number[];
  /** handlers that must wait for this one to fail */
  blocks: number[];
}

/** Payload sent with every state change and update (RNGH's `handlerData`). */
export interface GestureEventData {
  handlerTag: number;
  state: GestureStateValue;
  oldState?: GestureStateValue;
  numberOfPointers: number;
  pointerType: number;
  [key: string]: number | boolean | undefined;
}

export interface TouchData {
  id: number;
  x: number;
  y: number;
  absoluteX: number;
  absoluteY: number;
}

export interface GestureTouchEvent {
  handlerTag: number;
  numberOfTouches: number;
  state: GestureStateValue;
  eventType: TouchEventTypeValue;
  allTouches: TouchData[];
  changedTouches: TouchData[];
  pointerType: number;
}

/** How the engine reports to whoever created a handler (the JS gesture API). */
export interface GestureListener {
  onStateChange(event: GestureEventData): void;
  onUpdate(event: GestureEventData): void;
  onTouches?(event: GestureTouchEvent): void;
}

/** One pointer as the arena sees it, in window coordinates. */
export interface PointerSample {
  id: number;
  x: number;
  y: number;
  time: number;
}
