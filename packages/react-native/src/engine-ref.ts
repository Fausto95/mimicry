import type { Engine } from '@mimicry/engine';

/**
 * The engine the module-level APIs (Dimensions, Alert, Platform…) talk to.
 * There is one engine per worker; headless tests set it per session.
 */
let current: Engine | null = null;
const listeners = new Set<(engine: Engine) => void>();

export function setActiveEngine(engine: Engine | null): void {
  current = engine;
  if (engine) for (const l of listeners) l(engine);
}

export function getEngine(): Engine {
  if (!current) throw new Error('Mimicry: no active engine. React Native APIs are only available inside a running app.');
  return current;
}

export function maybeEngine(): Engine | null {
  return current;
}

export function onEngine(listener: (engine: Engine) => void): () => void {
  listeners.add(listener);
  if (current) listener(current);
  return () => listeners.delete(listener);
}
