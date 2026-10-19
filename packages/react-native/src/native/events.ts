/**
 * React Native's event emitter semantics: `addListener` returns a
 * subscription with `remove()`, and `emit` calls listeners in order.
 */
export interface EventSubscription {
  remove(): void;
}

type Listener = (...args: any[]) => unknown;

export class EventEmitter {
  private readonly listeners = new Map<string, Set<{ fn: Listener; context: unknown }>>();

  addListener(eventType: string, listener: Listener, context?: unknown): EventSubscription {
    let set = this.listeners.get(eventType);
    if (!set) this.listeners.set(eventType, (set = new Set()));
    const entry = { fn: listener, context };
    set.add(entry);
    return { remove: () => set!.delete(entry) };
  }

  emit(eventType: string, ...args: unknown[]): void {
    const set = this.listeners.get(eventType);
    if (!set) return;
    for (const entry of Array.from(set)) entry.fn.apply(entry.context, args);
  }

  removeAllListeners(eventType?: string | null): void {
    if (eventType == null) this.listeners.clear();
    else this.listeners.delete(eventType);
  }

  listenerCount(eventType: string): number {
    return this.listeners.get(eventType)?.size ?? 0;
  }
}

/** RCTDeviceEventEmitter: where native modules post events. */
export const DeviceEventEmitter = new EventEmitter();

/**
 * `new NativeEventEmitter(nativeModule)`: subscribes to the device emitter and
 * tells the module when it gains or loses listeners, like React Native does.
 */
export class NativeEventEmitter {
  constructor(private readonly nativeModule?: { addListener?: (e: string) => void; removeListeners?: (n: number) => void } | null) {}

  addListener(eventType: string, listener: Listener, context?: unknown): EventSubscription {
    this.nativeModule?.addListener?.(eventType);
    const sub = DeviceEventEmitter.addListener(eventType, listener, context);
    let removed = false;
    return {
      remove: () => {
        if (removed) return;
        removed = true;
        this.nativeModule?.removeListeners?.(1);
        sub.remove();
      },
    };
  }

  emit(eventType: string, ...args: unknown[]): void {
    DeviceEventEmitter.emit(eventType, ...args);
  }

  removeAllListeners(eventType?: string | null): void {
    const count = eventType ? DeviceEventEmitter.listenerCount(eventType) : 0;
    if (count) this.nativeModule?.removeListeners?.(count);
    DeviceEventEmitter.removeAllListeners(eventType);
  }

  listenerCount(eventType: string): number {
    return DeviceEventEmitter.listenerCount(eventType);
  }
}
