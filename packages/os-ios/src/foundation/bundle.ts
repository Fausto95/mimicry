import { CAEnvironment, mediaNow } from '../quartz-core/ca-media-time';

/**
 * Bundle.main and ProcessInfo.processInfo: the app's Info.plist basics and
 * the process facts apps read. A host configures the bundle
 * (`Bundle.main._configure`) from its app config; the defaults describe a
 * plain 1.0 (1) app.
 */
export class Bundle {
  private static readonly mainBundle = new Bundle();
  private info: Record<string, unknown> = {
    CFBundleIdentifier: 'com.example.app',
    CFBundleName: 'App',
    CFBundleDisplayName: 'App',
    CFBundleShortVersionString: '1.0',
    CFBundleVersion: '1',
    CFBundleExecutable: 'App',
    CFBundlePackageType: 'APPL',
    UILaunchStoryboardName: 'LaunchScreen',
  };
  /** resource name.ext → URI (images, JSON…) */
  private resources = new Map<string, string>();

  static get main(): Bundle {
    return Bundle.mainBundle;
  }

  /** @internal a host sets the app's Info.plist values and resources */
  _configure(info: Record<string, unknown>, resources: Record<string, string> = {}): void {
    this.info = { ...this.info, ...info };
    for (const [name, uri] of Object.entries(resources)) this.resources.set(name, uri);
  }

  get bundleIdentifier(): string | null {
    return (this.info.CFBundleIdentifier as string) ?? null;
  }

  get infoDictionary(): Readonly<Record<string, unknown>> {
    return this.info;
  }

  object(forInfoDictionaryKey: string): unknown {
    return this.info[forInfoDictionaryKey] ?? null;
  }

  /** path(forResource:ofType:) — the URI of a configured resource */
  path(forResource: string, ofType: string | null = null): string | null {
    return this.resources.get(ofType ? `${forResource}.${ofType}` : forResource) ?? null;
  }

  get bundlePath(): string {
    return `/var/containers/Bundle/Application/${this.bundleIdentifier}/${this.info.CFBundleExecutable}.app`;
  }
}

export class ProcessInfo {
  private static readonly shared = new ProcessInfo();
  readonly environment: Readonly<Record<string, string>> = {};
  readonly arguments: readonly string[] = ['App'];
  readonly processName = 'App';
  readonly processIdentifier = 1;

  static get processInfo(): ProcessInfo {
    return ProcessInfo.shared;
  }

  /** seconds since the device booted (its media clock) */
  get systemUptime(): number {
    return mediaNow() / 1000;
  }

  get operatingSystemVersion(): { majorVersion: number; minorVersion: number; patchVersion: number } {
    const [major = 0, minor = 0, patch = 0] = (CAEnvironment.kernel?.viewport.device.osVersion ?? '26.0').split('.').map(Number);
    return { majorVersion: major, minorVersion: minor, patchVersion: patch };
  }

  get operatingSystemVersionString(): string {
    const v = this.operatingSystemVersion;
    return `Version ${v.majorVersion}.${v.minorVersion}${v.patchVersion ? `.${v.patchVersion}` : ''}`;
  }

  isOperatingSystemAtLeast(version: { majorVersion: number; minorVersion: number; patchVersion: number }): boolean {
    const v = this.operatingSystemVersion;
    return v.majorVersion !== version.majorVersion ? v.majorVersion > version.majorVersion
      : v.minorVersion !== version.minorVersion ? v.minorVersion > version.minorVersion
        : v.patchVersion >= version.patchVersion;
  }

  get isLowPowerModeEnabled(): boolean {
    return false;
  }

  get thermalState(): number {
    return 0;
  }

  get physicalMemory(): number {
    return 8 * 1024 ** 3;
  }

  get activeProcessorCount(): number {
    return 6;
  }
}
