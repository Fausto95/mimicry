import {
  resolveViewport,
  type Appearance,
  type DeviceDescriptor,
  type EnvironmentSpec,
  type Orientation,
  type Viewport,
} from '@mimicry/protocol';
import type { StatusBarState } from './platform/kit';

export type EnvironmentListener = (env: EnvironmentStore, changed: { dimensions: boolean; appearance: boolean; device: boolean }) => void;

/**
 * Device, orientation, appearance and status bar state. Dimensions,
 * Appearance, useColorScheme and useSafeAreaInsets subscribe here.
 */
export class EnvironmentStore {
  device: DeviceDescriptor;
  orientation: Orientation;
  appearance: Appearance;
  fontScale: number;
  viewport: Viewport;
  readonly statusBar: StatusBarState = { barStyle: 'default', hidden: false, backgroundColor: null };
  private readonly listeners = new Set<EnvironmentListener>();
  /** bumps on every change; cheap cache key for subscribers */
  version = 0;

  constructor(spec: EnvironmentSpec) {
    this.device = spec.device;
    this.orientation = spec.orientation;
    this.appearance = spec.appearance;
    this.fontScale = spec.fontScale ?? 1;
    this.viewport = resolveViewport(this.device, this.orientation, this.fontScale);
  }

  update(spec: Partial<EnvironmentSpec>): void {
    const prev = this.viewport;
    const prevAppearance = this.appearance;
    const prevDevice = this.device;
    if (spec.device) this.device = spec.device;
    if (spec.orientation) this.orientation = spec.orientation;
    if (spec.appearance) this.appearance = spec.appearance;
    if (spec.fontScale) this.fontScale = spec.fontScale;
    this.viewport = resolveViewport(this.device, this.orientation, this.fontScale);
    const changed = {
      dimensions: prev.width !== this.viewport.width || prev.height !== this.viewport.height || prev.scale !== this.viewport.scale
        || prev.fontScale !== this.viewport.fontScale || JSON.stringify(prev.safeArea) !== JSON.stringify(this.viewport.safeArea),
      appearance: prevAppearance !== this.appearance,
      device: prevDevice.id !== this.device.id,
    };
    if (changed.dimensions || changed.appearance || changed.device) {
      this.version++;
      for (const listener of Array.from(this.listeners)) listener(this, changed);
    }
  }

  subscribe(listener: EnvironmentListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** what Dimensions.get('window') returns */
  get window() {
    const v = this.viewport;
    return { width: v.width, height: v.height, scale: v.scale, fontScale: v.fontScale };
  }

  get screen() {
    return this.window;
  }
}
