import { useEffect, useState } from 'react';
import type { EventSubscription } from '../native/events';

/** `expo`: registerRootComponent plus the Expo Modules API re-exports. */
export { registerRootComponent } from '../apis/app-registry';
export {
  EventEmitter, SharedObject, SharedRef, NativeModule, UnavailabilityError, CodedError, requireNativeModule,
  requireOptionalNativeModule, requireNativeView, registerWebModule, reloadAppAsync, installOnUIRuntime, Platform, uuid,
  createSnapshotFriendlyRef, useReleasingSharedObject, useReleasingSharedObjectWithLifecycle, PermissionStatus,
  createPermissionHook,
} from './expo-modules-core';

export const isRunningInExpoGo = () => false;
export const getExpoGoProjectConfig = () => null;
export function disableErrorHandling(): void {}

type Emitter = { addListener(event: string, listener: (...args: any[]) => void): EventSubscription };

/** Subscribes to an emitter event and returns the latest payload. */
export function useEvent<T = unknown>(emitter: Emitter, eventName: string, initialValue: T | null = null): T | null {
  const [value, setValue] = useState<T | null>(initialValue);
  useEffect(() => {
    const sub = emitter.addListener(eventName, (payload: T) => setValue(payload));
    return () => sub.remove();
  }, [emitter, eventName]);
  return value;
}

export function useEventListener(emitter: Emitter, eventName: string, listener: (...args: any[]) => void): void {
  useEffect(() => {
    const sub = emitter.addListener(eventName, listener);
    return () => sub.remove();
  }, [emitter, eventName, listener]);
}
