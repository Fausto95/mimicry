/**
 * android.os.Vibrator / VibrationEffect and android.view.HapticFeedbackConstants.
 * A simulated phone has no motor: vibrations are recorded (tests can check
 * what an app asked for) and otherwise do nothing.
 */
export class VibrationEffect {
  static readonly DEFAULT_AMPLITUDE = -1;
  static readonly EFFECT_CLICK = 0;
  static readonly EFFECT_DOUBLE_CLICK = 1;
  static readonly EFFECT_TICK = 2;
  static readonly EFFECT_HEAVY_CLICK = 5;

  private constructor(readonly timings: readonly number[], readonly amplitudes: readonly number[], readonly repeat: number, readonly predefined: number | null) {}

  static createOneShot(milliseconds: number, amplitude: number = VibrationEffect.DEFAULT_AMPLITUDE): VibrationEffect {
    return new VibrationEffect([milliseconds], [amplitude], -1, null);
  }

  static createWaveform(timings: readonly number[], amplitudesOrRepeat: readonly number[] | number, repeat = -1): VibrationEffect {
    if (typeof amplitudesOrRepeat === 'number') return new VibrationEffect(timings, timings.map(() => VibrationEffect.DEFAULT_AMPLITUDE), amplitudesOrRepeat, null);
    return new VibrationEffect(timings, amplitudesOrRepeat, repeat, null);
  }

  static createPredefined(effectId: number): VibrationEffect {
    return new VibrationEffect([], [], -1, effectId);
  }

  /** Total length in ms (-1 when it repeats forever). */
  getDuration(): number {
    if (this.repeat >= 0) return -1;
    if (this.predefined !== null) return 20;
    return this.timings.reduce((a, b) => a + b, 0);
  }
}

export class Vibrator {
  /** Everything apps asked for, oldest first. */
  readonly history: VibrationEffect[] = [];

  hasVibrator(): boolean {
    return true;
  }

  hasAmplitudeControl(): boolean {
    return true;
  }

  /** vibrate(ms) or vibrate(VibrationEffect) */
  vibrate(effect: number | VibrationEffect): void {
    this.history.push(typeof effect === 'number' ? VibrationEffect.createOneShot(effect) : effect);
  }

  cancel(): void {}
}

/** VibratorManager (API 31) */
export class VibratorManager {
  constructor(private readonly vibrator: Vibrator) {}
  getDefaultVibrator(): Vibrator {
    return this.vibrator;
  }
  getVibratorIds(): number[] {
    return [0];
  }
}

export const HapticFeedbackConstants = {
  LONG_PRESS: 0,
  VIRTUAL_KEY: 1,
  KEYBOARD_TAP: 3,
  CLOCK_TICK: 4,
  CONTEXT_CLICK: 6,
  KEYBOARD_PRESS: 3,
  KEYBOARD_RELEASE: 7,
  VIRTUAL_KEY_RELEASE: 8,
  TEXT_HANDLE_MOVE: 9,
  GESTURE_START: 12,
  GESTURE_END: 13,
  CONFIRM: 16,
  REJECT: 17,
  TOGGLE_ON: 21,
  TOGGLE_OFF: 22,
  GESTURE_THRESHOLD_ACTIVATE: 23,
  GESTURE_THRESHOLD_DEACTIVATE: 24,
  DRAG_START: 25,
  SEGMENT_TICK: 26,
  SEGMENT_FREQUENT_TICK: 27,
  FLAG_IGNORE_VIEW_SETTING: 1,
} as const;
