/** react-native-gesture-handler's public enums, with the library's values. */
export const State = {
  UNDETERMINED: 0,
  FAILED: 1,
  BEGAN: 2,
  CANCELLED: 3,
  ACTIVE: 4,
  END: 5,
} as const;
export type State = (typeof State)[keyof typeof State];

export const Directions = { RIGHT: 1, LEFT: 2, UP: 4, DOWN: 8 } as const;
export type Directions = (typeof Directions)[keyof typeof Directions];

export const PointerType = { TOUCH: 0, STYLUS: 1, MOUSE: 2, KEY: 3, OTHER: 4 } as const;
export type PointerType = (typeof PointerType)[keyof typeof PointerType];

export const MouseButton = { LEFT: 1, RIGHT: 2, MIDDLE: 4, BUTTON_4: 8, BUTTON_5: 16, ALL: 31 } as const;
export type MouseButton = (typeof MouseButton)[keyof typeof MouseButton];

export const HoverEffect = { NONE: 0, LIFT: 1, HIGHLIGHT: 2 } as const;
export type HoverEffect = (typeof HoverEffect)[keyof typeof HoverEffect];

export const TouchEventType = { UNDETERMINED: 0, TOUCHES_DOWN: 1, TOUCHES_MOVE: 2, TOUCHES_UP: 3, TOUCHES_CANCELLED: 4 } as const;
