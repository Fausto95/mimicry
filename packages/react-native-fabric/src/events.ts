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
  /** handlers attached to a view by tag, outside its props (Reanimated's registerForEvents) */
  private readonly attached = new Map<number, Set<{ names: ReadonlySet<string>; fn: (event: Record<string, unknown>) => void }>>();

  constructor(private readonly report: (error: unknown) => void) {}

  /**
   * Attach a handler to a view's events by its tag, like Reanimated's
   * WorkletEventHandler.registerForEvents. Receives the native event payload.
   */
  attach(nodeId: number, names: Iterable<string>, fn: (event: Record<string, unknown>) => void): () => void {
    let set = this.attached.get(nodeId);
    if (!set) this.attached.set(nodeId, (set = new Set()));
    const entry = { names: new Set(names), fn };
    set.add(entry);
    return () => {
      set!.delete(entry);
      if (!set!.size) this.attached.delete(nodeId);
    };
  }

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

  /** Run a callback that isn't a prop (gesture callbacks) with the same batching and error reporting. */
  run(fn: () => void, priority: Priority = 'discrete'): void {
    try {
      dispatchWithPriority(priority, () => batchedUpdates(fn));
    } catch (error) {
      this.report(error);
    }
  }

  emit(node: HostNode, handler: string, nativeEvent: Record<string, unknown>, timeStamp: number, priority: Priority = 'discrete'): void {
    const attached = this.attached.get(node.id);
    if (attached) {
      for (const entry of Array.from(attached)) {
        if (entry.names.has(handler)) this.run(() => entry.fn({ ...nativeEvent, eventName: handler }), priority);
      }
    }
    if (typeof node.props[handler] !== 'function') return;
    this.invoke(node, handler, syntheticEvent(handler.replace(/^on/, '').toLowerCase(), node, nativeEvent, timeStamp), priority);
  }
}
