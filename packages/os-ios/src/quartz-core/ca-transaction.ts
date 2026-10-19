import { CAEnvironment, mainQueueAsync } from './ca-media-time';
import type { CAMediaTimingFunction } from './ca-media-timing-function';

/**
 * CATransaction: batches layer changes. Transactions nest; the outermost
 * one commits them. Every change outside `begin()`/`commit()` joins an
 * implicit transaction committed when the current task ends (the run
 * loop's next turn — the kernel's deferred queue here).
 *
 * The transaction's animation duration and timing function are what an
 * added animation with `duration == 0` (and no timing function) runs with,
 * and its completion block runs once every animation added inside it has
 * finished or been removed — or right after commit when there were none.
 *
 * Mimicry does not run implicit layer actions (a stand-alone CALayer whose
 * opacity changes does not fade); `disableActions` is kept for API parity.
 */
interface Transaction {
  duration: number | null;
  timingFunction: CAMediaTimingFunction | null;
  disableActions: boolean | null;
  completion: (() => void) | null;
  /** animations added in it (or in transactions nested in it) still running */
  running: number;
  committed: boolean;
  fired: boolean;
  implicit: boolean;
}

const stack: Transaction[] = [];
let implicit: Transaction | null = null;

function make(isImplicit: boolean): Transaction {
  return { duration: null, timingFunction: null, disableActions: null, completion: null, running: 0, committed: false, fired: false, implicit: isImplicit };
}

function current(): Transaction {
  const top = stack[stack.length - 1];
  if (top) return top;
  if (!implicit) {
    implicit = make(true);
    const t = implicit;
    const commitImplicit = () => {
      if (implicit === t) implicit = null;
      commitTransaction(t);
    };
    mainQueueAsync(commitImplicit);
  }
  return implicit;
}

function commitTransaction(t: Transaction): void {
  t.committed = true;
  maybeComplete(t);
}

function maybeComplete(t: Transaction): void {
  if (!t.committed || t.running > 0 || t.fired) return;
  t.fired = true;
  const block = t.completion;
  if (!block) return;
  // Completion blocks run on the main queue after the work that finished them.
  mainQueueAsync(block);
}

/** What an animation added inside a transaction reports back when it stops. */
export interface TransactionToken {
  release(): void;
}

export class CATransaction {
  static begin(): void {
    stack.push(make(false));
  }

  static commit(): void {
    const t = stack.pop();
    if (!t) throw new Error('CATransaction.commit: no transaction was begun');
    commitTransaction(t);
  }

  /** Commit the implicit transaction now. */
  static flush(): void {
    if (stack.length || !implicit) return;
    const t = implicit;
    implicit = null;
    commitTransaction(t);
  }

  static lock(): void {}
  static unlock(): void {}

  private static lookup<K extends 'duration' | 'timingFunction' | 'disableActions'>(key: K): Transaction[K] {
    for (let i = stack.length - 1; i >= 0; i--) {
      const v = stack[i]![key];
      if (v !== null) return v;
    }
    return implicit ? implicit[key] : null;
  }

  static animationDuration(): number {
    return CATransaction.lookup('duration') ?? 0.25;
  }

  static setAnimationDuration(duration: number): void {
    current().duration = duration;
  }

  static animationTimingFunction(): CAMediaTimingFunction | null {
    return CATransaction.lookup('timingFunction');
  }

  static setAnimationTimingFunction(fn: CAMediaTimingFunction | null): void {
    current().timingFunction = fn;
  }

  static disableActions(): boolean {
    return CATransaction.lookup('disableActions') ?? false;
  }

  static setDisableActions(flag: boolean): void {
    current().disableActions = flag;
  }

  static completionBlock(): (() => void) | null {
    return current().completion;
  }

  static setCompletionBlock(block: (() => void) | null): void {
    current().completion = block;
  }

  /** @internal An animation was added: every open transaction waits for it. */
  static _track(): TransactionToken {
    const open = stack.length ? stack.slice() : [current()];
    if (stack.length && implicit) open.push(implicit);
    for (const t of open) t.running++;
    let released = false;
    return {
      release() {
        if (released) return;
        released = true;
        for (const t of open) {
          t.running--;
          maybeComplete(t);
        }
      },
    };
  }

  /** @internal no transaction is open (tests reset between devices) */
  static _reset(): void {
    stack.length = 0;
    implicit = null;
  }
}
