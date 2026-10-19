import React, { forwardRef, useImperativeHandle, useMemo, useRef } from 'react';
import type { GestureEventData, GestureKind } from '@mimicry/react-native-fabric';
import { getNextHandlerTag, toEngineConfig, type EventSink } from './bridge';
import { State } from './constants';
import { HandlerWrap, useHandlerAttachment } from './detector';
import { tagsOf, type GestureRef } from './gestures';
import { v3Tags } from './hooks';

/**
 * The legacy handler components (`<PanGestureHandler onGestureEvent=…>`),
 * still common in libraries. Events arrive as `{ nativeEvent }`, so
 * `Animated.event([{ nativeEvent: { translationX } }])` works as on device.
 * A ref to a handler component exposes its `handlerTag`, which is what
 * `simultaneousHandlers` / `waitFor` refer to.
 */
type AnyProps = Record<string, any>;

function refTags(value: unknown): number[] {
  if (value == null) return [];
  if (Array.isArray(value)) return value.flatMap(refTags);
  return tagsOf(value as GestureRef);
}

function legacySink(props: () => AnyProps): EventSink {
  return {
    stateChange: (e: GestureEventData) => {
      const p = props();
      const event = { nativeEvent: e };
      p.onHandlerStateChange?.(event);
      if (e.state === State.BEGAN) p.onBegan?.(event);
      else if (e.state === State.ACTIVE) p.onActivated?.(event);
      else if (e.state === State.END) p.onEnded?.(event);
      else if (e.state === State.FAILED) p.onFailed?.(event);
      else if (e.state === State.CANCELLED) p.onCancelled?.(event);
    },
    update: (e: GestureEventData) => {
      props().onGestureEvent?.({ nativeEvent: e });
    },
  };
}

/** Builds one legacy handler component for a gesture kind. */
function createHandler(kind: GestureKind, name: string, defaults: AnyProps = {}) {
  const Handler = forwardRef<{ handlerTag: number }, AnyProps>(function GestureHandler(props, ref) {
    const tag = useMemo(getNextHandlerTag, []);
    const latest = useRef(props);
    latest.current = props;
    useImperativeHandle(ref, () => ({ handlerTag: tag }), [tag]);
    const wrap = useHandlerAttachment(() => {
      const p = { ...defaults, ...latest.current };
      return [{
        tag,
        kind,
        config: toEngineConfig(kind, p, false),
        relations: {
          simultaneousWith: [...refTags(p.simultaneousHandlers), ...v3Tags(p.simultaneousWith)],
          waitFor: [...refTags(p.waitFor), ...v3Tags(p.requireToFail)],
          blocks: [...refTags(p.blocksHandlers), ...v3Tags(p.block)],
        },
        sink: () => legacySink(() => latest.current),
        owned: true,
      }];
    });
    return <HandlerWrap ref={wrap}>{props.children}</HandlerWrap>;
  });
  Handler.displayName = name;
  return Handler;
}

export const PanGestureHandler = createHandler('pan', 'PanGestureHandler');
export const TapGestureHandler = createHandler('tap', 'TapGestureHandler');
export const LongPressGestureHandler = createHandler('longPress', 'LongPressGestureHandler');
export const FlingGestureHandler = createHandler('fling', 'FlingGestureHandler');
export const PinchGestureHandler = createHandler('pinch', 'PinchGestureHandler');
export const RotationGestureHandler = createHandler('rotation', 'RotationGestureHandler');
export const NativeViewGestureHandler = createHandler('native', 'NativeViewGestureHandler');
/** 3D Touch is not available on current devices; the handler never activates. */
export const ForceTouchGestureHandler = Object.assign(createHandler('manual', 'ForceTouchGestureHandler'), { forceTouchAvailable: false });

const NATIVE_HANDLER_PROPS = [
  'id', 'enabled', 'shouldActivateOnStart', 'disallowInterruption', 'waitFor', 'simultaneousHandlers', 'blocksHandlers',
  'simultaneousWith', 'requireToFail', 'block', 'shouldCancelWhenOutside', 'hitSlop', 'onGestureEvent',
  'onHandlerStateChange', 'onBegan', 'onFailed', 'onCancelled', 'onActivated', 'onEnded',
];

/**
 * Wraps a component so its host view carries a native gesture: scroll views
 * scroll, switches toggle, and both take part in gesture relations.
 */
export function createNativeWrapper<P extends AnyProps>(Component: React.ComponentType<P>, config: AnyProps = {}) {
  const Wrapped = forwardRef<any, P & AnyProps>(function NativeWrapper(props, ref) {
    const handlerProps: AnyProps = { ...config };
    const rest: AnyProps = {};
    for (const [key, value] of Object.entries(props)) {
      if (NATIVE_HANDLER_PROPS.includes(key)) handlerProps[key] = value;
      else rest[key] = value;
    }
    return (
      <NativeViewGestureHandler {...handlerProps}>
        <Component {...(rest as P)} ref={ref} />
      </NativeViewGestureHandler>
    );
  });
  Wrapped.displayName = `NativeWrapper(${Component.displayName ?? Component.name ?? 'Component'})`;
  return Wrapped;
}
