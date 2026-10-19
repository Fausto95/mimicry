/**
 * PanResponder over the engine's responder events. gestureState is derived
 * from the event's touchHistory, the same way React Native computes it.
 */
export interface GestureState {
  stateID: number;
  moveX: number;
  moveY: number;
  x0: number;
  y0: number;
  dx: number;
  dy: number;
  vx: number;
  vy: number;
  numberActiveTouches: number;
  _accountsForMovesUpTo: number;
}

type Handler = (e: any, g: GestureState) => any;

export interface PanResponderConfig {
  onStartShouldSetPanResponder?: Handler;
  onStartShouldSetPanResponderCapture?: Handler;
  onMoveShouldSetPanResponder?: Handler;
  onMoveShouldSetPanResponderCapture?: Handler;
  onPanResponderGrant?: Handler;
  onPanResponderReject?: Handler;
  onPanResponderStart?: Handler;
  onPanResponderMove?: Handler;
  onPanResponderEnd?: Handler;
  onPanResponderRelease?: Handler;
  onPanResponderTerminate?: Handler;
  onPanResponderTerminationRequest?: Handler;
  onShouldBlockNativeResponder?: Handler;
}

function touch(e: any) {
  const bank = e.touchHistory?.touchBank ?? [];
  return bank[e.touchHistory?.indexOfSingleActiveTouch ?? 0] ?? Object.values(bank)[0];
}

export const PanResponder = {
  create(config: PanResponderConfig) {
    const g: GestureState = {
      stateID: Math.random(), moveX: 0, moveY: 0, x0: 0, y0: 0, dx: 0, dy: 0, vx: 0, vy: 0,
      numberActiveTouches: 0, _accountsForMovesUpTo: 0,
    };
    const reset = (e: any) => {
      const t = touch(e);
      g.x0 = g.moveX = t?.startPageX ?? e.nativeEvent.pageX;
      g.y0 = g.moveY = t?.startPageY ?? e.nativeEvent.pageY;
      g.dx = g.dy = g.vx = g.vy = 0;
      g.numberActiveTouches = e.touchHistory?.numberActiveTouches ?? 1;
      g._accountsForMovesUpTo = e.touchHistory?.mostRecentTimeStamp ?? 0;
    };
    const update = (e: any) => {
      const t = touch(e);
      if (!t) return;
      const prevX = g.moveX;
      const prevY = g.moveY;
      g.moveX = t.currentPageX;
      g.moveY = t.currentPageY;
      const dt = Math.max(1, t.currentTimeStamp - g._accountsForMovesUpTo);
      g.vx = (g.moveX - prevX) / dt;
      g.vy = (g.moveY - prevY) / dt;
      g.dx = g.moveX - g.x0;
      g.dy = g.moveY - g.y0;
      g.numberActiveTouches = e.touchHistory.numberActiveTouches;
      g._accountsForMovesUpTo = t.currentTimeStamp;
    };
    return {
      panHandlers: {
        onStartShouldSetResponder(e: any) {
          reset(e);
          return config.onStartShouldSetPanResponder?.(e, g) ?? false;
        },
        onStartShouldSetResponderCapture(e: any) {
          reset(e);
          return config.onStartShouldSetPanResponderCapture?.(e, g) ?? false;
        },
        onMoveShouldSetResponder(e: any) {
          update(e);
          return config.onMoveShouldSetPanResponder?.(e, g) ?? false;
        },
        onMoveShouldSetResponderCapture(e: any) {
          update(e);
          return config.onMoveShouldSetPanResponderCapture?.(e, g) ?? false;
        },
        onResponderGrant(e: any) {
          config.onPanResponderGrant?.(e, g);
          config.onPanResponderStart?.(e, g);
          return config.onShouldBlockNativeResponder?.(e, g) ?? true;
        },
        onResponderReject(e: any) {
          config.onPanResponderReject?.(e, g);
        },
        onResponderMove(e: any) {
          update(e);
          config.onPanResponderMove?.(e, g);
        },
        onResponderRelease(e: any) {
          update(e);
          config.onPanResponderEnd?.(e, g);
          config.onPanResponderRelease?.(e, g);
          g.numberActiveTouches = 0;
        },
        onResponderTerminate(e: any) {
          config.onPanResponderEnd?.(e, g);
          config.onPanResponderTerminate?.(e, g);
          g.numberActiveTouches = 0;
        },
        onResponderTerminationRequest(e: any) {
          return config.onPanResponderTerminationRequest?.(e, g) ?? true;
        },
      },
      getInteractionHandle: () => null,
    };
  },
};
