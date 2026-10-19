import { mainQueueAsync } from '../quartz-core/ca-media-time';

/**
 * NotificationCenter and the slice of OperationQueue apps hand it.
 *
 * Posting is synchronous: observers run, in the order they were added,
 * before post returns — also those registered with OperationQueue.main,
 * since the main queue is the posting queue (there is one thread). Other
 * operation queues run their blocks on the main queue's next turn.
 */
export class Notification {
  constructor(
    readonly name: string,
    readonly object: unknown = null,
    readonly userInfo: Readonly<Record<string, unknown>> | null = null,
  ) {}
}

/** OperationQueue.main and private queues (which also run on the one thread, later). */
export class OperationQueue {
  private static readonly mainQueue = new OperationQueue(true);
  name: string | null = null;
  maxConcurrentOperationCount = -1;

  constructor(private readonly isMain = false) {}

  static get main(): OperationQueue {
    return OperationQueue.mainQueue;
  }

  static get current(): OperationQueue {
    return OperationQueue.mainQueue;
  }

  /** @internal does a block for this queue run inline when posted from the main thread? */
  get _runsInline(): boolean {
    return this.isMain;
  }

  addOperation(block: () => void): void {
    mainQueueAsync(block);
  }
}

/** The token addObserver(forName:object:queue:using:) returns. */
export interface NSObjectProtocol {
  readonly __observer: true;
}

interface Observer {
  token: NSObjectProtocol;
  /** addObserver(_:selector:name:object:) observers: the object */
  target: object | null;
  name: string | null;
  object: unknown;
  queue: OperationQueue | null;
  block: (notification: Notification) => void;
}

export class NotificationCenter {
  private static readonly defaultCenter = new NotificationCenter();
  private observers: Observer[] = [];

  static get default(): NotificationCenter {
    return NotificationCenter.defaultCenter;
  }

  /**
   * addObserver(forName:object:queue:using:) — returns the token to pass to
   * removeObserver. A null name or object matches any.
   */
  addObserver(name: string | null, object: unknown, queue: OperationQueue | null, block: (notification: Notification) => void): NSObjectProtocol {
    const token = { __observer: true } as const;
    this.observers.push({ token, target: null, name, object: object ?? null, queue, block });
    return token;
  }

  /** addObserver(_:selector:name:object:) — `selector` is the method name on `observer`. */
  addObserverTarget(observer: object, selector: string, name: string | null, object: unknown = null): void {
    const method = (observer as Record<string, unknown>)[selector];
    if (typeof method !== 'function') throw new Error(`NotificationCenter.addObserver: ${observer.constructor.name} has no method ${selector}`);
    const token = { __observer: true } as const;
    this.observers.push({ token, target: observer, name, object: object ?? null, queue: null, block: (n) => (method as (n: Notification) => void).call(observer, n) });
  }

  /** removeObserver(_:) / removeObserver(_:name:object:) — a token, or a target object. */
  removeObserver(observer: NSObjectProtocol | object, name: string | null = null, object: unknown = null): void {
    this.observers = this.observers.filter((o) => {
      const same = o.token === observer || o.target === observer;
      if (!same) return true;
      if (name !== null && o.name !== name) return true;
      if (object !== null && o.object !== object) return true;
      return false;
    });
  }

  post(notification: Notification): void;
  post(name: string, object?: unknown, userInfo?: Record<string, unknown> | null): void;
  post(a: Notification | string, object: unknown = null, userInfo: Record<string, unknown> | null = null): void {
    const notification = a instanceof Notification ? a : new Notification(a, object, userInfo);
    for (const o of this.observers.slice()) {
      if (!this.observers.includes(o)) continue;
      if (o.name !== null && o.name !== notification.name) continue;
      if (o.object !== null && o.object !== notification.object) continue;
      if (o.queue && !o.queue._runsInline) o.queue.addOperation(() => o.block(notification));
      else o.block(notification);
    }
  }

  /** @internal how many observers are registered (tests) */
  get _observerCount(): number {
    return this.observers.length;
  }
}
