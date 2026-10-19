/**
 * What the native side knows about the running app: its Expo config (from
 * app.json / app.config.*). Set by the runtime before the entry executes.
 */
let config: Record<string, any> = {};

export function setAppConfig(next: Record<string, unknown> | undefined): void {
  config = (next ?? {}) as Record<string, any>;
}

export function getAppConfig(): Record<string, any> {
  return config;
}
