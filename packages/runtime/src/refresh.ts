import RefreshRuntime from 'react-refresh/runtime';

/**
 * React Fast Refresh is Mimicry's equivalent of Dactyl's @State snapshot:
 * edited component modules are re-executed and React swaps implementations
 * under the running tree, keeping hook state.
 *
 * Must run before the first renderer injects itself into the devtools hook.
 */
let installed = false;

export function installRefresh(): void {
  if (installed) return;
  installed = true;
  RefreshRuntime.injectIntoGlobalHook(globalThis);
}

export function refreshHelpers(moduleId: string) {
  return {
    register: (type: unknown, id: string) => RefreshRuntime.register(type, `${moduleId} ${id}`),
    signature: () => RefreshRuntime.createSignatureFunctionForTransform(),
  };
}

export function isRefreshBoundary(exports: unknown): boolean {
  if (exports == null || typeof exports !== 'object') return RefreshRuntime.isLikelyComponentType(exports);
  let hasExports = false;
  let all = true;
  for (const key in exports as Record<string, unknown>) {
    hasExports = true;
    if (key === '__esModule') continue;
    const desc = Object.getOwnPropertyDescriptor(exports, key);
    if (desc && desc.get && !desc.enumerable) continue;
    const value = (exports as Record<string, unknown>)[key];
    if (!RefreshRuntime.isLikelyComponentType(value)) all = false;
  }
  return hasExports && all;
}

export function performRefresh(): void {
  RefreshRuntime.performReactRefresh();
}
