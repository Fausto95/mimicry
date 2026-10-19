import { Looper } from './looper';

/**
 * android.os.Build and Build.VERSION, read from the simulated device's
 * descriptor: SDK_INT is its osVersion (36 on the Pixel 9 profile, Android
 * 16), the model its name. Fields are getters because the device can change
 * (the host switches device profiles).
 */
export const VERSION_CODES = {
  BASE: 1,
  LOLLIPOP: 21,
  LOLLIPOP_MR1: 22,
  M: 23,
  N: 24,
  N_MR1: 25,
  O: 26,
  O_MR1: 27,
  P: 28,
  Q: 29,
  R: 30,
  S: 31,
  S_V2: 32,
  TIRAMISU: 33,
  UPSIDE_DOWN_CAKE: 34,
  VANILLA_ICE_CREAM: 35,
  BAKLAVA: 36,
  CUR_DEVELOPMENT: 10000,
} as const;

/** The release name for an API level. */
const RELEASES: Record<number, string> = {
  29: '10', 30: '11', 31: '12', 32: '12L', 33: '13', 34: '14', 35: '15', 36: '16',
};

function device() {
  return Looper.getMainKernel()?.env.device ?? null;
}

function sdk(): number {
  const raw = device()?.osVersion ?? '36';
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : 36;
}

export const Build = {
  VERSION_CODES,
  VERSION: {
    get SDK_INT(): number {
      return sdk();
    },
    get RELEASE(): string {
      return RELEASES[sdk()] ?? String(sdk());
    },
    get CODENAME(): string {
      return 'REL';
    },
    get INCREMENTAL(): string {
      return 'mimicry';
    },
    get SECURITY_PATCH(): string {
      return '2025-09-05';
    },
  },
  get MANUFACTURER(): string {
    return 'Google';
  },
  get BRAND(): string {
    return 'google';
  },
  get MODEL(): string {
    return device()?.name ?? 'Pixel';
  },
  get DEVICE(): string {
    return device()?.id ?? 'generic';
  },
  get PRODUCT(): string {
    return device()?.id ?? 'generic';
  },
  get HARDWARE(): string {
    return 'mimicry';
  },
  get FINGERPRINT(): string {
    return `google/${Build.PRODUCT}/${Build.DEVICE}:${Build.VERSION.RELEASE}/mimicry/1:user/release-keys`;
  },
  get SUPPORTED_ABIS(): string[] {
    return ['arm64-v8a'];
  },
  /** Whether the API level is at least `level` (a Build.VERSION_CODES value). */
  isAtLeast(level: number): boolean {
    return sdk() >= level;
  },
};
