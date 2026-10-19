import React, { Component, useLayoutEffect, useRef } from 'react';
import { findHostNode, type GestureConfig, type GestureKind, type GestureRelations } from '@mimicry/react-native-fabric';
import { attachHandler, configureHandler, dropHandler, ensureHandler, type EventSink } from './bridge';
import { BaseGesture, ComposedGesture, createV2Sink, tagsOf } from './gestures';
import { isV3Composed, isV3Single, v3EngineConfig, v3Leaves, v3Sink, v3Tags, type AnyGesture, type SingleGesture } from './hooks';

/**
 * GestureDetector attaches gestures to the first host view its child renders,
 * like RNGH's detector. It accepts v2 gestures (`Gesture.Pan()…`, which it
 * owns: tags are kept stable across renders and dropped on unmount) and v3
 * gestures from the hooks (owned by the hook; the detector only attaches).
 */
export interface Descriptor {
  tag: number;
  kind: GestureKind;
  config: GestureConfig;
  relations: GestureRelations;
  sink: () => EventSink;
  /** the detector drops it when it goes away (v2) */
  owned: boolean;
}

type Links = { simultaneous: Map<number, Set<number>>; waitFor: Map<number, Set<number>> };
const link = (map: Map<number, Set<number>>, from: number, to: number) => {
  let set = map.get(from);
  if (!set) map.set(from, (set = new Set()));
  set.add(to);
};

function v3Links(g: AnyGesture, out: Links): Links {
  if (!isV3Composed(g)) return out;
  for (const child of g.gestures) v3Links(child, out);
  const groups = g.gestures.map((child) => v3Leaves(child).map((l) => l.handlerTag));
  if (g.type === 'SimultaneousGesture') {
    const all = groups.flat();
    for (const a of all) for (const b of all) if (a !== b) link(out.simultaneous, a, b);
  } else if (g.type === 'ExclusiveGesture') {
    groups.forEach((group, i) => {
      for (const earlier of groups.slice(0, i).flat()) for (const tag of group) link(out.waitFor, tag, earlier);
    });
  }
  return out;
}

const union = (...lists: Array<Iterable<number> | undefined>) => Array.from(new Set(lists.flatMap((l) => (l ? Array.from(l) : []))));

function describe(gesture: unknown): Descriptor[] {
  if (gesture instanceof BaseGesture || gesture instanceof ComposedGesture) {
    const links = gesture instanceof ComposedGesture ? gesture.relations() : { simultaneous: new Map(), waitFor: new Map() };
    return gesture.toGestureArray().map((g) => ({
      tag: g.handlerTag,
      kind: g.kind,
      config: g.engineConfig(),
      relations: {
        simultaneousWith: union(links.simultaneous.get(g.handlerTag), g.relations.simultaneousWith.flatMap(tagsOf)),
        waitFor: union(links.waitFor.get(g.handlerTag), g.relations.requireToFail.flatMap(tagsOf)),
        blocks: union(g.relations.blocksHandlers.flatMap(tagsOf)),
      },
      sink: () => createV2Sink(g.handlerTag, g.kind, () => v2Latest.get(g.handlerTag)),
      owned: true,
    }));
  }
  if (isV3Single(gesture) || isV3Composed(gesture)) {
    const links = v3Links(gesture, { simultaneous: new Map(), waitFor: new Map() });
    return v3Leaves(gesture).map((g: SingleGesture) => ({
      tag: g.handlerTag,
      kind: g.kind,
      config: v3EngineConfig(g),
      relations: {
        simultaneousWith: union(links.simultaneous.get(g.handlerTag), v3Tags(g.config.simultaneousWith)),
        waitFor: union(links.waitFor.get(g.handlerTag), v3Tags(g.config.requireToFail)),
        blocks: v3Tags(g.config.block),
      },
      sink: () => v3Sink(g.handlerTag, g.kind),
      owned: false,
    }));
  }
  throw new Error('GestureDetector expected a gesture: Gesture.Pan()…, a composed gesture or a gesture from a use*Gesture hook.');
}

/** The v2 gesture object of the latest render, per tag. */
const v2Latest = new Map<number, BaseGesture>();

/** A class boundary whose first host descendant is the view gestures attach to. */
class Wrap extends Component<{ children?: React.ReactNode }> {
  override render() {
    return this.props.children ?? null;
  }
}

export interface GestureDetectorProps {
  gesture: unknown;
  children?: React.ReactNode;
  userSelect?: string;
  enableContextMenu?: boolean;
  touchAction?: string;
}

/**
 * Keeps a set of handlers configured and attached to the first host view of
 * the returned wrapper, re-applying after every commit (configs and the
 * child view can change on any render). Owned handlers are dropped when they
 * disappear or the component unmounts; others are only detached.
 */
export function useHandlerAttachment(describeHandlers: () => Descriptor[]): React.RefObject<Wrap | null> {
  const wrap = useRef<Wrap>(null);
  const attached = useRef(new Map<number, boolean>());
  const release = (tag: number, owned: boolean) => {
    if (owned) {
      v2Latest.delete(tag);
      dropHandler(tag);
    } else attachHandler(tag, null);
  };

  useLayoutEffect(() => {
    const node = wrap.current ? findHostNode(wrap.current) : null;
    const current = new Set<number>();
    for (const d of describeHandlers()) {
      current.add(d.tag);
      ensureHandler(d.tag, d.kind, d.sink);
      configureHandler(d.tag, d.config, d.relations);
      attachHandler(d.tag, node);
      attached.current.set(d.tag, d.owned);
    }
    for (const [tag, owned] of Array.from(attached.current)) {
      if (current.has(tag)) continue;
      attached.current.delete(tag);
      release(tag, owned);
    }
  });

  useLayoutEffect(
    () => () => {
      for (const [tag, owned] of attached.current) release(tag, owned);
      attached.current.clear();
    },
    [],
  );

  return wrap;
}

export function GestureDetector({ gesture, children }: GestureDetectorProps) {
  const previous = useRef<BaseGesture[]>([]);

  // v2: keep handler tags stable when gesture objects are re-created each render.
  if (gesture instanceof BaseGesture || gesture instanceof ComposedGesture) {
    const list = gesture.toGestureArray();
    list.forEach((g, i) => {
      const prev = previous.current[i];
      if (prev && prev !== g && prev.kind === g.kind && !list.some((other) => other.handlerTag === prev.handlerTag)) g.handlerTag = prev.handlerTag;
      v2Latest.set(g.handlerTag, g);
    });
    previous.current = list;
  }

  const wrap = useHandlerAttachment(() => describe(gesture));
  return <Wrap ref={wrap}>{children}</Wrap>;
}

export { Wrap as HandlerWrap };
