import type { AdapterHost, FrameworkAdapter, FrameworkInstance, OperatingSystem } from '@mimicry/os-core';
import type { AppBundle, ModuleRecord } from '@mimicry/protocol';
import type { Android } from '@mimicry/os-android';
import type { IOS } from '@mimicry/os-ios';
import { Engine, loadYoga } from '@mimicry/react-native-fabric';
import { CAPABILITIES } from '@mimicry/react-native';
import { AppRuntime } from './app-runtime';

/**
 * React Native as a framework adapter: its native side is
 * @mimicry/react-native-fabric (shadow tree, Yoga, mounting into the OS's
 * views, touch handling), its JavaScript side @mimicry/react-native (the
 * `react-native` API and the native modules), loaded by AppRuntime.
 */
export interface ReactNativeInstance extends FrameworkInstance<AppBundle, ModuleRecord[]> {
  readonly engine: Engine;
  readonly runtime: AppRuntime;
}

export interface ReactNativeAdapter extends FrameworkAdapter<AppBundle, ModuleRecord[]> {
  boot(os: OperatingSystem, host: AdapterHost): Promise<ReactNativeInstance>;
}

export const reactNativeAdapter: ReactNativeAdapter = {
  id: 'react-native',
  displayName: 'React Native',
  platforms: ['ios', 'android'],
  async boot(os, host) {
    const yoga = await loadYoga();
    const engine = new Engine({ yoga, os: os as IOS | Android });
    const runtime = new AppRuntime(engine, host.timers, host.wrap);
    return {
      engine,
      runtime,
      start: (bundle) => runtime.start(bundle),
      reload: (bundle) => runtime.reload(bundle),
      hotUpdate: (modules) => runtime.hotUpdate(modules),
      capabilities: () => CAPABILITIES,
      destroy: () => engine.destroy(),
    };
  },
};
