import type { HostNode } from '@mimicry/react-native-fabric';
import { maybeEngine } from '../engine-ref';
import { hostOf, type AnimatedRef } from './hooks';

/** Reanimated's "UI thread" view functions, reading the retained tree directly. */
export interface MeasuredDimensions {
  x: number;
  y: number;
  width: number;
  height: number;
  pageX: number;
  pageY: number;
}

function nodeOf(ref: AnimatedRef | HostNode | number | null | undefined): HostNode | null {
  if (ref == null) return null;
  if (typeof ref === 'number') return maybeEngine()?.nodes.get(ref) ?? null;
  if (typeof ref === 'function') return hostOf((ref as AnimatedRef).current);
  return hostOf(ref);
}

export function measure(ref: AnimatedRef | null): MeasuredDimensions | null {
  const node = nodeOf(ref);
  if (!node || !node.mounted || !node.laidOut) return null;
  const page = node.engine.geometry.windowRect(node);
  return { x: node.x, y: node.y, width: node.w, height: node.h, pageX: page.x, pageY: page.y };
}

export function scrollTo(ref: AnimatedRef | null, x: number, y: number, animated: boolean): void {
  nodeOf(ref)?.scrollTo({ x, y, animated });
}

export function getRelativeCoords(ref: AnimatedRef, absoluteX: number, absoluteY: number): { x: number; y: number } | null {
  const m = measure(ref);
  return m ? { x: absoluteX - m.pageX, y: absoluteY - m.pageY } : null;
}

export function dispatchCommand(ref: AnimatedRef, commandName: string, args: unknown[] = []): void {
  const node = nodeOf(ref) as unknown as Record<string, unknown> | null;
  const fn = node?.[commandName];
  if (typeof fn === 'function') fn.apply(node, args);
}

export function setNativeProps(ref: AnimatedRef, props: Record<string, unknown>): void {
  nodeOf(ref)?.setNativeProps(props);
}

/** Gesture-handler manual gestures: state is owned by the gesture system, nothing to forward here. */
export function setGestureState(_handlerTag: number, _newState: number): void {}

export async function getViewProp<T>(viewTag: number, propName: string, _component?: unknown): Promise<T> {
  const node = maybeEngine()?.nodes.get(viewTag);
  return (node?.computed[propName] ?? node?.props[propName]) as T;
}
