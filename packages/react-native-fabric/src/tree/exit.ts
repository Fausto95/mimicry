import type { FlatStyle } from '../style/flatten';
import type { HostNode } from './node';

/**
 * Exit animations (Reanimated's `exiting` prop).
 *
 * When React removes a host node whose subtree has exit animations, the node
 * stays in the retained tree — painted, not hit-testable, pinned at its last
 * frame and out of the flex flow so siblings re-layout at once, as on device
 * — until every exit animation in it reports done. React's later
 * `detachDeletedInstance` calls for that subtree are deferred to the same
 * moment, so nothing is freed while still on screen.
 */
const pendingDestroy = new Set<HostNode>();

export function removeHostChild(parent: HostNode, child: HostNode): void {
  const exits: HostNode[] = [];
  if (child.mounted) {
    child.walk((n) => {
      if (n.exit) exits.push(n);
    });
  }
  if (!exits.length) {
    parent.removeChild(child);
    return;
  }
  child.exiting = true;
  pin(parent, child);
  let pending = exits.length;
  const done = () => {
    if (--pending > 0) return;
    child.exiting = false;
    if (child.parent === parent) parent.removeChild(child);
    child.walk((n) => {
      if (pendingDestroy.delete(n)) n.destroy();
    });
  };
  for (const node of exits) {
    const run = node.exit!;
    node.exit = null;
    let called = false;
    run(() => {
      if (called) return;
      called = true;
      done();
    });
  }
}

/** React is done with a deleted node; free it now unless an exit animation still shows it. */
export function releaseDeletedInstance(node: HostNode): void {
  for (let n: HostNode | null = node; n; n = n.parent) {
    if (n.exiting) {
      pendingDestroy.add(node);
      return;
    }
  }
  node.destroy();
}

const MARGINS = ['margin', 'marginTop', 'marginBottom', 'marginLeft', 'marginRight', 'marginHorizontal', 'marginVertical', 'marginStart', 'marginEnd'];

/** Keep the exiting node where it is drawn now, outside the flex flow. */
function pin(parent: HostNode, child: HostNode): void {
  const border = (side: 'Left' | 'Top'): number => {
    const s = parent.computed;
    const v = s[`border${side}Width`] ?? s.borderWidth ?? 0;
    return typeof v === 'number' ? v : 0;
  };
  const values: FlatStyle = {
    position: 'absolute',
    left: child.x - border('Left'),
    top: child.y - border('Top'),
    width: child.w,
    height: child.h,
  };
  for (const key of MARGINS) values[key] = 0;
  child.setOverrides(values);
}
