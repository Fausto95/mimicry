import { batchedUpdates, dispatchWithPriority } from './tree/reconciler';
import type { HostNode } from './tree/node';

/**
 * React Native-shaped synthetic events. Handlers receive
 * `{ nativeEvent, target, currentTarget, timeStamp, ... }`.
 */
export interface SyntheticEvent<T = Record<string, unknown>> {
  nativeEvent: T;
  target: number;
  currentTarget: number;
  timeStamp: number;
  type: string;
  defaultPrevented: boolean;
  isDefaultPrevented(): boolean;
  isPropagationStopped(): boolean;
  preventDefault(): void;
  stopPropagation(): void;
  persist(): void;
  touchHistory?: unknown;
}

export function syntheticEvent<T extends Record<string, unknown>>(
  type: string,
  target: HostNode,
  nativeEvent: T,
  timeStamp: number,
  currentTarget: HostNode = target,
): SyntheticEvent<T> {
  let prevented = false;
  let stopped = false;
  return {
    nativeEvent,
    target: target.id,
    currentTarget: currentTarget.id,
    timeStamp,
    type,
    get defaultPrevented() {
      return prevented;
    },
    isDefaultPrevented: () => prevented,
    isPropagationStopped: () => stopped,
    preventDefault() {
      prevented = true;
    },
    stopPropagation() {
      stopped = true;
    },
    persist() {},
  };
}

export type Priority = 'discrete' | 'continuous' | 'default';

export class EventDispatcher {
  constructor(private readonly report: (error: unknown) => void) {}

  /** Calls props[handler] if present. Returns the handler's return value. */
  invoke<R = unknown>(node: HostNode, handler: string, event: unknown, priority: Priority = 'discrete', ...extra: unknown[]): R | undefined {
    const fn = node.props[handler];
    if (typeof fn !== 'function') return undefined;
    try {
      return dispatchWithPriority(priority, () => batchedUpdates(() => fn(event, ...extra)));
    } catch (error) {
      this.report(error);
      return undefined;
    }
  }

  emit(node: HostNode, handler: string, nativeEvent: Record<string, unknown>, timeStamp: number, priority: Priority = 'discrete'): void {
    if (typeof node.props[handler] !== 'function') return;
    this.invoke(node, handler, syntheticEvent(handler.replace(/^on/, '').toLowerCase(), node, nativeEvent, timeStamp), priority);
  }
}
