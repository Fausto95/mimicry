import { createContext } from 'react';
import Reconciler from 'react-reconciler';
import {
  ConcurrentRoot,
  ContinuousEventPriority,
  DefaultEventPriority,
  DiscreteEventPriority,
  NoEventPriority,
} from 'react-reconciler/constants';
import type { Engine } from '../engine';
import { releaseDeletedInstance, removeHostChild } from './exit';
import { HostNode, HostType, kindForType, type Props } from './node';

/**
 * React host config. Mutation mode, like React Native's legacy renderer:
 * the retained tree is mutated in place and Yoga nodes follow along.
 * Layout runs in resetAfterCommit (before layout effects), so refs measured
 * in useLayoutEffect see real geometry — the Fabric behavior.
 */
export interface RootContainer {
  engine: Engine;
  root: HostNode;
  name: 'app' | 'system';
  fiberRoot?: unknown;
}

interface HostContext {
  insideText: boolean;
}

const ROOT_CONTEXT: HostContext = { insideText: false };
const TEXT_CONTEXT: HostContext = { insideText: true };

let currentUpdatePriority: number = NoEventPriority;

export const TEXT_OUTSIDE_TEXT_ERROR = 'Text strings must be rendered within a <Text> component.';

const hostConfig = {
  rendererPackageName: '@mimicry/engine',
  rendererVersion: '0.3.0',
  extraDevToolsConfig: null,
  isPrimaryRenderer: true,
  supportsMutation: true,
  supportsPersistence: false,
  supportsHydration: false,
  supportsMicrotasks: true,
  supportsResources: false,
  supportsSingletons: false,
  supportsTestSelectors: false,
  warnsIfNotActing: true,
  noTimeout: -1 as const,
  NotPendingTransition: null,
  HostTransitionContext: createContext(null),

  scheduleTimeout: (fn: (...args: unknown[]) => unknown, delay?: number) => setTimeout(fn, delay),
  cancelTimeout: (id: ReturnType<typeof setTimeout>) => clearTimeout(id),
  scheduleMicrotask: (fn: () => void) => queueMicrotask(fn),

  getRootHostContext: (): HostContext => ROOT_CONTEXT,
  getChildHostContext(parent: HostContext, type: string): HostContext {
    if (type === HostType.Text) return TEXT_CONTEXT;
    // Views nested in Text start a new non-text context for their own children.
    if (parent.insideText && type !== HostType.Text) return ROOT_CONTEXT;
    return parent;
  },
  getPublicInstance: (instance: HostNode) => instance,

  createInstance(type: string, props: Props, root: RootContainer, context: HostContext, fiber: unknown): HostNode {
    const node = new HostNode(root.engine, type, kindForType(type, context.insideText), props);
    node.fiber = fiber;
    // A view nested in <Text> is an inline box: the text measures it and places it in a line.
    if (context.insideText && type !== HostType.Text) root.engine.inlineViews.add(node);
    return node;
  },

  createTextInstance(text: string, root: RootContainer, context: HostContext): HostNode {
    if (!context.insideText) throw new Error(TEXT_OUTSIDE_TEXT_ERROR);
    const node = new HostNode(root.engine, '#text', 'raw-text', {});
    node.text = text;
    return node;
  },

  appendInitialChild: (parent: HostNode, child: HostNode) => parent.appendChild(child),
  finalizeInitialChildren: () => false,
  shouldSetTextContent: () => false,
  prepareForCommit: () => null,
  resetAfterCommit(root: RootContainer) {
    root.engine.afterCommit(root);
  },
  preparePortalMount: () => {},

  appendChild: (parent: HostNode, child: HostNode) => parent.appendChild(child),
  appendChildToContainer: (root: RootContainer, child: HostNode) => root.root.appendChild(child),
  insertBefore: (parent: HostNode, child: HostNode, before: HostNode) => parent.insertBefore(child, before),
  insertInContainerBefore: (root: RootContainer, child: HostNode, before: HostNode) => root.root.insertBefore(child, before),
  removeChild: (parent: HostNode, child: HostNode) => removeHostChild(parent, child),
  removeChildFromContainer: (root: RootContainer, child: HostNode) => removeHostChild(root.root, child),
  clearContainer(root: RootContainer) {
    for (const child of root.root.children.slice()) root.root.removeChild(child);
  },
  commitUpdate(node: HostNode, _type: string, _old: Props, next: Props) {
    node.setProps(next);
  },
  commitTextUpdate(node: HostNode, _old: string, next: string) {
    node.setText(next);
  },
  commitMount: () => {},
  resetTextContent: () => {},
  hideInstance(node: HostNode) {
    node.hidden = true;
    node.setOverrides({ display: 'none' });
  },
  unhideInstance(node: HostNode) {
    node.hidden = false;
    node.setOverrides({ display: undefined });
  },
  hideTextInstance(node: HostNode) {
    node.hidden = true;
    node.invalidateText();
  },
  unhideTextInstance(node: HostNode) {
    node.hidden = false;
    node.invalidateText();
  },
  detachDeletedInstance(node: HostNode) {
    releaseDeletedInstance(node);
  },

  getCurrentUpdatePriority: () => currentUpdatePriority,
  setCurrentUpdatePriority: (p: number) => {
    currentUpdatePriority = p;
  },
  resolveUpdatePriority: () => (currentUpdatePriority !== NoEventPriority ? currentUpdatePriority : DefaultEventPriority),
  resolveEventType: () => null,
  resolveEventTimeStamp: () => -1.1,
  shouldAttemptEagerTransition: () => false,
  trackSchedulerEvent: () => {},
  requestPostPaintCallback: () => {},
  bindToConsole: (method: string, args: unknown[], badge: string) =>
    (console as any)[method].bind(console, `[${badge}]`, ...args),

  maySuspendCommit: () => false,
  maySuspendCommitOnUpdate: () => false,
  maySuspendCommitInSyncRender: () => false,
  preloadInstance: () => true,
  startSuspendingCommit: () => {},
  suspendInstance: () => {},
  suspendOnActiveViewTransition: () => {},
  waitForCommitToBeReady: () => null,
  getSuspendedCommitReason: () => null,
  resetFormInstance: () => {},

  getInstanceFromNode: () => null,
  getInstanceFromScope: () => null,
  beforeActiveInstanceBlur: () => {},
  afterActiveInstanceBlur: () => {},
  prepareScopeUpdate: () => {},
  setupIntersectionObserver: () => ({ disconnect() {}, observe() {}, unobserve() {} }),

  // View Transitions are only reached through <ViewTransition>; run the phases inline.
  applyViewTransitionName: () => {},
  restoreViewTransitionName: () => {},
  cancelViewTransitionName: () => {},
  cancelRootViewTransitionName: () => {},
  restoreRootViewTransitionName: () => {},
  cloneRootViewTransitionContainer: () => null,
  removeRootViewTransitionClone: () => {},
  measureInstance: () => null,
  measureClonedInstance: () => null,
  wasInstanceInViewport: () => true,
  hasInstanceChanged: () => false,
  hasInstanceAffectedParent: () => false,
  createViewTransitionInstance: () => null,
  addViewTransitionFinishedListener: () => {},
  getCurrentGestureOffset: () => 0,
  startGestureTransition: () => null,
  stopViewTransition: () => {},
  startViewTransition(
    _suspended: unknown, _container: unknown, _types: unknown,
    mutation: () => void, layout: () => void, afterMutation: () => void, spawned: () => void, passive: () => void,
  ) {
    mutation();
    layout();
    afterMutation();
    spawned();
    passive();
    return null;
  },

  // Fragment refs (React 19.2)
  createFragmentInstance: (fiber: unknown) => ({ fiber }),
  updateFragmentInstanceFiber: () => {},
  commitNewChildToFragmentInstance: () => {},
  deleteChildFromFragmentInstance: () => {},
};

export const reconciler = Reconciler(hostConfig as any);

let devtoolsInjected = false;

/** Creates a concurrent root (React Native's new architecture uses concurrent roots). */
export function createFiberRoot(container: RootContainer, onError: (error: unknown, info: { componentStack?: string }, kind: 'uncaught' | 'caught' | 'recoverable') => void): unknown {
  if (!devtoolsInjected) {
    // Required for React Refresh: it reaches the renderer through the devtools hook.
    reconciler.injectIntoDevTools();
    devtoolsInjected = true;
  }
  const root = (reconciler as any).createContainer(
    container,
    ConcurrentRoot,
    null,
    false,
    null,
    'm',
    (error: unknown, info: { componentStack?: string }) => onError(error, info, 'uncaught'),
    (error: unknown, info: { componentStack?: string }) => onError(error, info, 'caught'),
    (error: unknown, info: { componentStack?: string }) => onError(error, info, 'recoverable'),
    () => {},
  );
  container.fiberRoot = root;
  return root;
}

export function renderInto(container: RootContainer, element: React.ReactNode): void {
  (reconciler as any).updateContainer(element, container.fiberRoot, null, null);
}

export function renderIntoSync(container: RootContainer, element: React.ReactNode): void {
  (reconciler as any).updateContainerSync(element, container.fiberRoot, null, null);
  (reconciler as any).flushSyncWork();
}

/** Run an event handler with the right priority, then flush synchronous work. */
export function dispatchWithPriority<T>(kind: 'discrete' | 'continuous' | 'default', fn: () => T): T {
  const previous = currentUpdatePriority;
  currentUpdatePriority = kind === 'discrete' ? DiscreteEventPriority : kind === 'continuous' ? ContinuousEventPriority : DefaultEventPriority;
  try {
    return fn();
  } finally {
    currentUpdatePriority = previous;
    if (kind === 'discrete') (reconciler as any).flushSyncWork();
  }
}

export function batchedUpdates<T>(fn: () => T): T {
  return (reconciler as any).batchedUpdates(fn);
}

/** The first host node rendered by a mounted class component instance (what findNodeHandle resolves). */
export function findHostNode(instance: unknown): HostNode | null {
  try {
    return ((reconciler as any).findHostInstance(instance) as HostNode | null) ?? null;
  } catch {
    return null;
  }
}
