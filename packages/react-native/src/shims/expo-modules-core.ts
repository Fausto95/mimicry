import { useEffect, useMemo, useRef, useState } from 'react';
import { DevSettings, Platform as RNPlatform } from '../apis/core';
import { EventEmitter as BaseEmitter, type EventSubscription } from '../native/events';
import { getNativeModule, nativeComponent, stubNativeModule } from '../native/registry';

/**
 * expo-modules-core, the JavaScript half of the Expo Modules API. On a device
 * its classes are installed natively (JSI); here they are plain classes, and
 * `requireNativeModule` / `requireNativeView` look up Mimicry's native
 * registry so every expo-* package can run its real JavaScript.
 */
export type { EventSubscription };

export class EventEmitter<_TEvents = Record<string, (...args: any[]) => void>> {
  private readonly emitter = new BaseEmitter();
  private observing = 0;

  addListener(eventName: string, listener: (...args: any[]) => void): EventSubscription {
    if (this.observing++ === 0) (this as any).startObserving?.(eventName);
    const sub = this.emitter.addListener(eventName, listener);
    let removed = false;
    return {
      remove: () => {
        if (removed) return;
        removed = true;
        sub.remove();
        if (--this.observing === 0) (this as any).stopObserving?.(eventName);
      },
    };
  }

  removeListener(eventName: string, _listener: (...args: any[]) => void): void {
    // Subscriptions are removed through their handle; this mirrors Expo's API surface.
    void eventName;
  }

  removeAllListeners(eventName: string): void {
    this.emitter.removeAllListeners(eventName);
  }

  emit(eventName: string, ...args: unknown[]): void {
    this.emitter.emit(eventName, ...args);
  }

  listenerCount(eventName: string): number {
    return this.emitter.listenerCount(eventName);
  }
}

export class NativeModule<TEvents = Record<string, never>> extends EventEmitter<TEvents> {
  ViewPrototypes?: Record<string, object>;
}

export class SharedObject<TEvents = Record<string, never>> extends EventEmitter<TEvents> {
  release(): void {}
}

export class SharedRef<TNativeRefType extends string = 'unknown', TEvents = Record<string, never>> extends SharedObject<TEvents> {
  nativeRefType: TNativeRefType = 'unknown' as TNativeRefType;
}

export const Platform = {
  get OS() {
    return RNPlatform.OS;
  },
  select<T>(spec: Record<string, T>): T | undefined {
    return RNPlatform.select(spec as any) as T | undefined;
  },
  isDOMAvailable: false,
  canUseEventListeners: false,
  canUseViewport: false,
  isAsyncDebugging: false,
};

/** Unknown modules are no-op stubs (with one warning) rather than a crash; see native/registry.ts. */
export function requireNativeModule<T = any>(moduleName: string): T {
  return getNativeModule<T>(moduleName) ?? (stubNativeModule(moduleName) as T);
}

export function requireOptionalNativeModule<T = any>(moduleName: string): T | null {
  return getNativeModule<T>(moduleName);
}

export function requireNativeViewManager<P = any>(moduleName: string, viewName?: string): React.ComponentType<P> {
  return nativeComponent(viewName ? `${moduleName}_${viewName}` : moduleName) as React.ComponentType<P>;
}
export { requireNativeViewManager as requireNativeView };

export function registerWebModule<T>(moduleImplementation: new () => T): T {
  return new moduleImplementation();
}

export const NativeModulesProxy: Record<string, any> = new Proxy({}, {
  get: (_t, name) => (typeof name === 'string' ? getNativeModule(name) ?? undefined : undefined),
});

export class CodedError extends Error {
  code: string;
  info?: unknown;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export class UnavailabilityError extends CodedError {
  constructor(moduleName: string, propertyName: string) {
    super('ERR_UNAVAILABLE', `The method or property ${moduleName}.${propertyName} is not available on ${RNPlatform.OS}, are you sure you've linked all the native dependencies properly?`);
  }
}

export class LegacyEventEmitter {
  private readonly emitter = new BaseEmitter();
  constructor(_nativeModule?: unknown) {}
  addListener<T>(eventName: string, listener: (event: T) => void): EventSubscription {
    return this.emitter.addListener(eventName, listener);
  }
  removeAllListeners(eventName: string): void {
    this.emitter.removeAllListeners(eventName);
  }
  removeSubscription(subscription: EventSubscription): void {
    subscription.remove();
  }
  emit(eventName: string, ...params: unknown[]): void {
    this.emitter.emit(eventName, ...params);
  }
}

function v4(): string {
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0'));
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10).join('')}`;
}

export const uuid = {
  v4,
  v5: (_name: string, _namespace: string | number[]) => v4(),
  namespace: { dns: '6ba7b810-9dad-11d1-80b4-00c04fd430c8', url: '6ba7b811-9dad-11d1-80b4-00c04fd430c8' },
};

export enum PermissionStatus {
  GRANTED = 'granted',
  UNDETERMINED = 'undetermined',
  DENIED = 'denied',
}

export interface PermissionResponse {
  status: PermissionStatus;
  expires: 'never' | number;
  granted: boolean;
  canAskAgain: boolean;
}

export function createPermissionHook<Permission extends PermissionResponse, Options extends object>(methods: {
  getMethod: (options?: Options) => Promise<Permission>;
  requestMethod: (options?: Options) => Promise<Permission>;
}) {
  return (options?: Options & { get?: boolean; request?: boolean }): [Permission | null, () => Promise<Permission>, () => Promise<Permission>] => {
    const [status, setStatus] = useState<Permission | null>(null);
    const mounted = useRef(true);
    const request = async () => {
      const response = await methods.requestMethod(options);
      if (mounted.current) setStatus(response);
      return response;
    };
    const get = async () => {
      const response = await methods.getMethod(options);
      if (mounted.current) setStatus(response);
      return response;
    };
    useEffect(() => {
      mounted.current = true;
      if (options?.request) void request();
      else if (options?.get !== false) void get();
      return () => {
        mounted.current = false;
      };
    }, []);
    return [status, request, get];
  };
}

export function useReleasingSharedObject<T extends SharedObject>(factory: () => T, dependencies: unknown[]): T {
  const object = useMemo(factory, dependencies);
  useEffect(() => () => object.release(), [object]);
  return object;
}

export function useReleasingSharedObjectWithLifecycle<T extends SharedObject>(factory: () => T, dependencies: unknown[]): T {
  return useReleasingSharedObject(factory, dependencies);
}

export function createSnapshotFriendlyRef<T>() {
  return { current: null as T | null };
}

export async function reloadAppAsync(_reason?: string): Promise<void> {
  DevSettings.reload();
}

export function installOnUIRuntime(): void {}

