import React, { forwardRef } from 'react';
import { HostType } from '@mimicry/engine';
import { maybeEngine } from '../engine-ref';

/**
 * The native side of third-party libraries.
 *
 * On a device, a library like react-native-screens ships JavaScript that
 * renders native components (`codegenNativeComponent('RNSScreenStack')`) and
 * calls native modules (`TurboModuleRegistry.get('RNSModule')`). Mimicry runs
 * the library's real JavaScript and implements that native side here, the way
 * Dactyl implements UIKit/Compose views: a native component is a React
 * component written against Mimicry's primitives and engine, a native module
 * is a plain object.
 *
 * Anything unregistered degrades instead of crashing: an unknown view renders
 * its children in a plain View (with one warning), an unknown module is
 * `null` for optional lookups.
 */
export type NativeComponentImpl = React.ComponentType<any>;
type ModuleFactory = () => unknown;

const components = new Map<string, NativeComponentImpl>();
const moduleFactories = new Map<string, ModuleFactory>();
const moduleInstances = new Map<string, unknown>();
const facades = new Map<string, React.ComponentType<any>>();
const warned = new Set<string>();

export function registerNativeComponent(name: string, impl: NativeComponentImpl): void {
  components.set(name, impl);
}

export function registerNativeComponents(map: Record<string, NativeComponentImpl>): void {
  for (const [name, impl] of Object.entries(map)) components.set(name, impl);
}

/** Register a native module. The factory runs on first lookup (per app run). */
export function registerNativeModule(name: string, factory: ModuleFactory): void {
  moduleFactories.set(name, factory);
  moduleInstances.delete(name);
}

export function registerNativeModules(map: Record<string, ModuleFactory>): void {
  for (const [name, factory] of Object.entries(map)) registerNativeModule(name, factory);
}

export function hasNativeModule(name: string): boolean {
  return moduleFactories.has(name);
}

export function getNativeModule<T = any>(name: string): T | null {
  if (moduleInstances.has(name)) return moduleInstances.get(name) as T;
  const factory = moduleFactories.get(name);
  if (!factory) return null;
  const instance = factory();
  moduleInstances.set(name, instance);
  return instance as T;
}

/** Forget module instances (a reload starts from fresh native state). */
export function resetNativeModules(): void {
  moduleInstances.clear();
}

export function hasNativeComponent(name: string): boolean {
  return components.has(name);
}

export function warnOnce(key: string, message: string): void {
  if (warned.has(key)) return;
  warned.add(key);
  const engine = maybeEngine();
  if (engine) engine.send({ type: 'log', level: 'warn', message });
  else console.warn(message);
}

/**
 * The component a library gets back from `codegenNativeComponent(name)`.
 * Resolution is deferred to render so registration order never matters.
 */
export function nativeComponent(name: string): React.ComponentType<any> {
  let facade = facades.get(name);
  if (facade) return facade;
  facade = forwardRef<any, any>(function NativeComponent(props, ref) {
    const impl = components.get(name);
    if (impl) return React.createElement(impl, { ...props, ref });
    warnOnce(`view:${name}`, `Mimicry has no implementation of the native view "${name}"; rendering its children in a plain View.`);
    return React.createElement(HostType.View, { style: props.style, pointerEvents: props.pointerEvents, testID: props.testID, ref }, props.children);
  });
  facade.displayName = name;
  facades.set(name, facade);
  return facade;
}

/** `codegenNativeCommands`: commands call methods on the view's ref. */
export function nativeCommands<T extends string>(options: { supportedCommands: readonly T[] }): Record<T, (ref: any, ...args: unknown[]) => void> {
  const out = {} as Record<T, (ref: any, ...args: unknown[]) => void>;
  for (const command of options.supportedCommands) {
    out[command] = (ref: any, ...args: unknown[]) => {
      const target = ref?.current ?? ref;
      const fn = target?.[command] ?? target?.__nativeCommands?.[command];
      if (typeof fn === 'function') fn.apply(target, args);
    };
  }
  return out;
}
