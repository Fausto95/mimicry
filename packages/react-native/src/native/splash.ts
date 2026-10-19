import { getAppConfig } from '../app-context';

/**
 * The launch screen. Like iOS/Android it covers the app until the first
 * frame, or — after `preventAutoHideAsync()` — until `hideAsync()`.
 * Drawn by system-ui from the expo-splash-screen config.
 */
type Listener = () => void;

class SplashState {
  visible = true;
  prevented = false;
  fadeMs = 0;
  private readonly listeners = new Set<Listener>();

  reset(): void {
    this.visible = true;
    this.prevented = false;
    this.fadeMs = 0;
    this.emit();
  }

  preventAutoHide(): boolean {
    if (!this.visible) return false;
    this.prevented = true;
    return true;
  }

  /** The root rendered its first frame: auto-hide unless prevented. */
  firstFrame(): void {
    if (!this.prevented) this.hide();
  }

  hide(): void {
    if (!this.visible) return;
    this.visible = false;
    this.emit();
  }

  setOptions(options: { duration?: number; fade?: boolean }): void {
    this.fadeMs = options.fade ? options.duration ?? 400 : 0;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    for (const l of Array.from(this.listeners)) l();
  }
}

export const splash = new SplashState();

export interface SplashConfig {
  backgroundColor: string;
  image?: { uri: string; width: number; height: number } | null;
  imageWidth: number;
  resizeMode: 'contain' | 'cover' | 'native';
}

/** The splash look from the expo-splash-screen plugin (or legacy `splash` key). */
export function splashConfig(appearance: 'light' | 'dark'): SplashConfig | null {
  const config = getAppConfig();
  const plugin = (config.plugins ?? []).find((p: unknown) => Array.isArray(p) && p[0] === 'expo-splash-screen');
  const options = plugin ? (plugin[1] ?? {}) : config.splash;
  if (!options) return null;
  const dark = appearance === 'dark' ? options.dark ?? {} : {};
  const assets = config._mimicry?.splash ?? {};
  return {
    backgroundColor: dark.backgroundColor ?? options.backgroundColor ?? '#ffffff',
    image: (appearance === 'dark' && assets.darkImage) || assets.image || null,
    imageWidth: options.imageWidth ?? 100,
    resizeMode: options.resizeMode ?? 'contain',
  };
}
