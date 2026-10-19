import React, { forwardRef, useCallback, useLayoutEffect, useReducer, useRef } from 'react';
import { flattenStyle } from '@mimicry/react-native-fabric';
import { AnimatedNode } from './animated';

/**
 * createAnimatedComponent: the first render resolves animated values; after
 * that, value changes are pushed straight onto the host node as style
 * overrides (no React render), like the native driver does on device.
 */
/** React elements are plain objects too; never walk into them. */
const isPlain = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype && !('$$typeof' in (value as object));

function resolve(value: unknown): unknown {
  if (value instanceof AnimatedNode) return value.__getValue();
  if (Array.isArray(value)) return value.map(resolve);
  if (isPlain(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = resolve(v);
    return out;
  }
  return value;
}

function containsAnimated(value: unknown): boolean {
  if (value instanceof AnimatedNode) return true;
  if (Array.isArray(value)) return value.some(containsAnimated);
  if (isPlain(value)) {
    return Object.values(value).some(containsAnimated);
  }
  return false;
}

function collectNodes(value: unknown, out: Set<AnimatedNode>): void {
  if (value instanceof AnimatedNode) {
    out.add(value);
    return;
  }
  if (Array.isArray(value)) value.forEach((v) => collectNodes(v, out));
  else if (isPlain(value)) {
    Object.values(value).forEach((v) => collectNodes(v, out));
  }
}

function assignRef<T>(ref: React.Ref<T> | undefined, value: T | null): void {
  if (typeof ref === 'function') ref(value);
  else if (ref && typeof ref === 'object') (ref as React.MutableRefObject<T | null>).current = value;
}

export function createAnimatedComponent<P extends object>(Component: React.ComponentType<P>): React.ComponentType<any> {
  const Animated = forwardRef<unknown, any>(function AnimatedComponent(props, forwardedRef) {
    const host = useRef<any>(null);
    const [, force] = useReducer((x: number) => x + 1, 0);
    const appliedKeys = useRef<Set<string>>(new Set());

    const style = flattenStyle(props.style);
    const animatedStyleKeys = Object.keys(style).filter((k) => containsAnimated(style[k]));
    const otherAnimated = Object.keys(props).filter((k) => k !== 'style' && k !== 'children' && containsAnimated(props[k]));

    const resolved: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(props)) {
      if (k === 'style') continue;
      resolved[k] = otherAnimated.includes(k) ? resolve(v) : v;
    }
    resolved.style = animatedStyleKeys.length ? resolve(style) : props.style;

    const push = useCallback(() => {
      const node = host.current;
      if (otherAnimated.length || !node || typeof node.setOverrides !== 'function') {
        force();
        return;
      }
      const values: Record<string, unknown> = {};
      for (const key of animatedStyleKeys) values[key] = resolve(style[key]);
      node.setOverrides(values);
    }, [props]); // eslint-disable-line react-hooks/exhaustive-deps

    useLayoutEffect(() => {
      const node = host.current;
      // Keys that stopped being animated must not keep a stale override.
      if (node && typeof node.setOverrides === 'function') {
        const clear: Record<string, unknown> = {};
        for (const key of appliedKeys.current) if (!animatedStyleKeys.includes(key)) clear[key] = undefined;
        for (const key of animatedStyleKeys) clear[key] = resolve(style[key]);
        node.setOverrides(clear);
      }
      appliedKeys.current = new Set(animatedStyleKeys);
      const nodes = new Set<AnimatedNode>();
      for (const key of animatedStyleKeys) collectNodes(style[key], nodes);
      for (const key of otherAnimated) collectNodes(props[key], nodes);
      for (const n of nodes) n.__addDependent(push);
      return () => {
        for (const n of nodes) n.__removeDependent(push);
      };
    }, [push]); // eslint-disable-line react-hooks/exhaustive-deps

    const setRef = useCallback(
      (instance: unknown) => {
        host.current = instance;
        assignRef(forwardedRef, instance);
      },
      [forwardedRef],
    );

    // createElement (not JSX spread): children arrive as a prop and must not be re-validated as a keyed list
    return React.createElement(Component as React.ComponentType<any>, { ...resolved, ref: setRef });
  });
  Animated.displayName = `Animated(${Component.displayName ?? Component.name ?? 'Component'})`;
  return Animated;
}
