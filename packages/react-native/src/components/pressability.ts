import { useMemo, useRef, useState } from 'react';
import { maybeEngine } from '../engine-ref';

/**
 * React Native's Pressability state machine on top of the responder system:
 * press in/out, press, long press, press-retention rect, Android ripple.
 * Shared by Pressable, the Touchables and <Text onPress>.
 */
export interface PressabilityConfig {
  disabled?: boolean | null;
  onPress?: ((e: any) => void) | null;
  onPressIn?: ((e: any) => void) | null;
  onPressOut?: ((e: any) => void) | null;
  onLongPress?: ((e: any) => void) | null;
  delayLongPress?: number | null;
  delayPressIn?: number | null;
  delayPressOut?: number | null;
  pressRetentionOffset?: { top?: number; left?: number; bottom?: number; right?: number } | number | null;
  android_ripple?: { color?: unknown; borderless?: boolean; radius?: number; foreground?: boolean } | null;
  /** extra responder handlers from the user, preserved */
  onResponderGrant?: (e: any) => void;
  onResponderRelease?: (e: any) => void;
}

const DEFAULT_RETENTION = { top: 20, left: 20, right: 20, bottom: 30 };

export function usePressability(config: PressabilityConfig, hostRef: React.RefObject<any>) {
  const [pressed, setPressed] = useState(false);
  const configRef = useRef(config);
  configRef.current = config;
  const state = useRef({ active: false, inside: false, longPressed: false, longTimer: null as unknown, pressInTimer: null as unknown });

  const handlers = useMemo(() => {
    const clock = () => maybeEngine()?.clock;
    const clearTimers = () => {
      const c = clock();
      if (state.current.longTimer != null) c?.clearTimeout(state.current.longTimer);
      if (state.current.pressInTimer != null) c?.clearTimeout(state.current.pressInTimer);
      state.current.longTimer = null;
      state.current.pressInTimer = null;
    };
    const ripple = (on: boolean, e?: any) => {
      const cfg = configRef.current.android_ripple;
      if (!cfg || maybeEngine()?.platform !== 'android') return;
      hostRef.current?.command?.('setPressed', {
        pressed: on,
        x: e?.nativeEvent?.locationX,
        y: e?.nativeEvent?.locationY,
        config: cfg,
      });
    };
    const pressIn = (e: any) => {
      setPressed(true);
      ripple(true, e);
      configRef.current.onPressIn?.(e);
    };
    const pressOut = (e: any) => {
      setPressed(false);
      ripple(false, e);
      configRef.current.onPressOut?.(e);
    };
    const insideRetention = (e: any) => {
      const node = hostRef.current;
      if (!node?.getBoundingClientRect) return true;
      const r = node.getBoundingClientRect();
      const o = configRef.current.pressRetentionOffset;
      const off = typeof o === 'number' ? { top: o, left: o, right: o, bottom: o } : { ...DEFAULT_RETENTION, ...(o ?? {}) };
      const x = e.nativeEvent.pageX;
      const y = e.nativeEvent.pageY;
      return x >= r.left - off.left && x <= r.right + off.right && y >= r.top - off.top && y <= r.bottom + off.bottom;
    };
    return {
      onStartShouldSetResponder: () => !configRef.current.disabled,
      onResponderTerminationRequest: () => true,
      onResponderGrant: (e: any) => {
        const s = state.current;
        s.active = true;
        s.inside = true;
        s.longPressed = false;
        const c = clock();
        const delayIn = configRef.current.delayPressIn ?? 0;
        if (delayIn > 0 && c) s.pressInTimer = c.setTimeout(() => s.active && s.inside && pressIn(e), delayIn);
        else pressIn(e);
        if (configRef.current.onLongPress && c) {
          s.longTimer = c.setTimeout(() => {
            if (s.active && s.inside) {
              s.longPressed = true;
              configRef.current.onLongPress?.(e);
            }
          }, (configRef.current.delayLongPress ?? 500) + delayIn);
        }
        configRef.current.onResponderGrant?.(e);
      },
      onResponderMove: (e: any) => {
        const s = state.current;
        if (!s.active) return;
        const inside = insideRetention(e);
        if (inside !== s.inside) {
          s.inside = inside;
          if (inside) pressIn(e);
          else pressOut(e);
        }
      },
      onResponderRelease: (e: any) => {
        const s = state.current;
        const wasInside = s.inside;
        s.active = false;
        clearTimers();
        if (wasInside) {
          pressOut(e);
          if (!s.longPressed && !configRef.current.disabled) configRef.current.onPress?.(e);
        }
        configRef.current.onResponderRelease?.(e);
      },
      onResponderTerminate: (e: any) => {
        const s = state.current;
        const wasInside = s.inside;
        s.active = false;
        clearTimers();
        if (wasInside) pressOut(e);
      },
    };
  }, [hostRef]);

  return { pressed, handlers };
}

export function mergeRefs<T>(...refs: Array<React.Ref<T> | undefined>) {
  return (value: T | null) => {
    for (const ref of refs) {
      if (typeof ref === 'function') ref(value);
      else if (ref && typeof ref === 'object') (ref as React.MutableRefObject<T | null>).current = value;
    }
  };
}
