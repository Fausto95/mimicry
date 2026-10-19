import type { Appearance, DeviceDescriptor, Orientation, PlatformName } from './devices';

/**
 * Side module: the app, compiled per file. Each module carries its own
 * dependency map (specifier → module id), so linking in the engine is a table
 * lookup — the same idea as Dactyl binding a side module's imports to the
 * base module's exports.
 */
export interface ModuleRecord {
  id: string;
  /** CommonJS body; evaluated with (require, module, exports, ...) */
  code: string;
  deps: Record<string, string>;
}

export interface AppBundle {
  platform: PlatformName;
  entry: string;
  modules: ModuleRecord[];
  /** optional prebundled third-party code (CommonJS map of specifier → exports) */
  vendor?: { id: string; code: string; specifiers: string[] };
  /** EXPO_PUBLIC_* variables inlined into process.env */
  env?: Record<string, string>;
  /** content hash of the whole graph, for logging */
  hash?: string;
}

export interface EnvironmentSpec {
  device: DeviceDescriptor;
  orientation: Orientation;
  appearance: Appearance;
  fontScale?: number;
}

export interface FontSpecRecord {
  family: string;
  weight: string;
  style: 'normal' | 'italic';
  url: string;
}

export type PointerPhase = 'down' | 'move' | 'up' | 'cancel';

export type Selector =
  | { testID: string }
  | { text: string | RegExp }
  | { label: string }
  | { nodeId: number };

/** Host → engine */
export type HostMessage =
  | {
      type: 'boot';
      environment: EnvironmentSpec;
      app: AppBundle;
      fonts?: FontSpecRecord[];
      /** 'bundled' = only Mimicry's fonts (deterministic); 'system' = prefer SF Pro when the OS has it */
      fontMode?: 'system' | 'bundled';
      /** 'host' = the host's vsync drives frames; 'virtual' = test runner ticks */
      clock?: 'host' | 'virtual';
      inspector?: boolean;
    }
  | { type: 'frame'; time: number }
  | { type: 'pointer'; phase: PointerPhase; id: number; x: number; y: number; time: number }
  | { type: 'wheel'; x: number; y: number; dx: number; dy: number; time: number }
  | { type: 'textChange'; nodeId: number; text: string; selection?: { start: number; end: number } }
  | { type: 'textEvent'; nodeId: number; event: 'focus' | 'blur' | 'submit' | 'keyPress'; key?: string }
  | { type: 'environment'; environment: Partial<EnvironmentSpec> }
  | { type: 'imageLoaded'; uri: string; width: number; height: number }
  | { type: 'imageFailed'; uri: string; error: string }
  | { type: 'hmr'; modules: ModuleRecord[]; removed: string[] }
  | { type: 'reload'; app?: AppBundle }
  | { type: 'inspect'; requestId: number }
  | { type: 'hitTest'; requestId: number; x: number; y: number }
  | { type: 'query'; requestId: number; selector: SerializedSelector }
  | { type: 'back' }
  | { type: 'animationScale'; factor: number };

export type SerializedSelector =
  | { testID: string }
  | { text: string; regex?: boolean }
  | { label: string }
  | { nodeId: number };

export interface FrameStats {
  frame: number;
  layoutMs: number;
  paintMs: number;
  bytes: number;
  chunks: number;
  layers: number;
  nodes: number;
  live: number;
}

export interface EngineError {
  kind: 'render' | 'runtime' | 'module' | 'syntax';
  message: string;
  stack?: string;
  componentStack?: string;
}

export type CapabilityLevel = 'supported' | 'approximate' | 'stub' | 'unsupported';

export interface InspectorNode {
  id: number;
  type: string;
  /** nearest composite component that rendered this host node */
  component?: string;
  rect: { x: number; y: number; w: number; h: number };
  props: Record<string, unknown>;
  children: InspectorNode[];
}

/** Engine → host */
export type EngineMessage =
  | { type: 'ready'; capabilities: Record<string, CapabilityLevel>; platform: PlatformName }
  | { type: 'frame'; buffer: ArrayBuffer; stats: FrameStats }
  | { type: 'requestFrame' }
  | { type: 'loadImage'; uri: string }
  | { type: 'log'; level: 'log' | 'info' | 'warn' | 'error' | 'debug'; message: string }
  | { type: 'error'; error: EngineError }
  | { type: 'inspectResult'; requestId: number; tree: InspectorNode | null }
  | { type: 'hitTestResult'; requestId: number; nodeId: number | null; path: number[] }
  | { type: 'queryResult'; requestId: number; nodes: Array<{ id: number; rect: { x: number; y: number; w: number; h: number } }> }
  | { type: 'openURL'; url: string }
  | { type: 'focusInput'; nodeId: number }
  | { type: 'blurInput'; nodeId: number }
  | { type: 'reloadRequested' };

export interface Transport<In, Out> {
  send(message: Out, transfer?: Transferable[]): void;
  onMessage(listener: (message: In) => void): () => void;
}

/** Module specifiers the base module provides; the compiler never bundles these. */
export const PROVIDED_MODULE_IDS = [
  'react',
  'react/jsx-runtime',
  'react/jsx-dev-runtime',
  'react-native',
  'expo',
  'expo-status-bar',
  'react-native-safe-area-context',
  'expo-linear-gradient',
] as const;

/** Dependency-map value for a provided module. */
export const providedId = (specifier: string) => `provided:${specifier}`;
