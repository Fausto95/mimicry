/** `expo` — the parts apps call from JS. */
export { registerRootComponent } from '../apis/app-registry';
export const isRunningInExpoGo = () => false;
export function requireNativeModule(name: string): never {
  throw new Error(`requireNativeModule('${name}') is not available in Mimicry.`);
}
export function requireOptionalNativeModule(): null {
  return null;
}
export class EventEmitter {
  addListener() {
    return { remove() {} };
  }
  removeAllListeners() {}
  emit() {}
}
