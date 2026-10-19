import type { Appearance, CommandWriter, PlatformName, Viewport } from '@mimicry/protocol';

/**
 * A platform kit is everything that differs between "looks like iOS" and
 * "looks like Android" once layout is done: fonts, semantic colors, how
 * native controls draw, system chrome, scroll physics and the small
 * behavioral differences React Native inherits from UIKit and Android Views.
 *
 * Kits are data-heavy on purpose: the fidelity loop (render, diff against a
 * real simulator, adjust) edits token tables, not engine code.
 */
export interface SwitchState {
  /** 0 = off, 1 = on (animated) */
  progress: number;
  /** 0..1 press feedback */
  pressed: number;
  disabled: boolean;
  trackOn: number | null;
  trackOff: number | null;
  thumb: number | null;
  /** iOS: ios_backgroundColor */
  backgroundOff: number | null;
}

export interface ActivityState {
  /** seconds since the indicator started animating */
  time: number;
  color: number | null;
  animating: boolean;
}

export type { StatusBarState } from '../services/environment';
import type { StatusBarState } from '../services/environment';

export interface ScrollPhysics {
  /** iOS rubber banding while dragging past an edge */
  rubberBand: boolean;
  rubberBandCoefficient: number;
  /** momentum decay per millisecond (UIScrollView.DecelerationRate.normal = 0.998) */
  decelerationRate: number;
  fastDecelerationRate: number;
  /** spring used to return from overscroll */
  bounceStiffness: number;
  bounceDamping: number;
  /** minimum movement before a drag claims the gesture */
  touchSlop: number;
  indicatorThickness: number;
  indicatorInset: number;
  indicatorColor(appearance: Appearance, style: string | undefined): number;
  indicatorFadeDelay: number;
}

export interface TextDefaults {
  fontSize: number;
  color(appearance: Appearance): number;
  /** TextInput default padding (Android EditText has one, iOS none) */
  inputPadding: { top: number; right: number; bottom: number; left: number };
  /** Android draws an underline under TextInput unless underlineColorAndroid is transparent */
  inputUnderline: boolean;
  placeholderColor(appearance: Appearance): number;
  selectionColor(appearance: Appearance): number;
}

export interface PlatformKit {
  readonly platform: PlatformName;
  /** css font-family stack for a React Native fontFamily value */
  fontStack(family: string | undefined, bundledOnly: boolean): string;
  /** platform aliases like Android's 'sans-serif-medium' imply a weight */
  fontWeightFor(family: string | undefined): string | null;
  /**
   * When the system face is stood in for by a bundled font (Inter for SF Pro),
   * the corrections that make it occupy the system face's space: extra
   * tracking in em and the system face's line metrics in em.
   */
  standIn?(size: number, weight: number): { tracking: number; ascent: number; descent: number };
  readonly text: TextDefaults;
  /** PlatformColor() names: UIKit semantic colors or Android attrs/resources */
  semanticColor(name: string, appearance: Appearance): number | null;
  readonly scroll: ScrollPhysics;
  /** iOS draws a uniform CALayer border above subviews; Android draws it in the background */
  readonly borderAboveChildren: boolean;
  /** iOS RN views hit-test children outside their bounds when overflow is visible */
  readonly hitTestOutsideBounds: boolean;
  readonly switchSize: { width: number; height: number };
  drawSwitch(w: CommandWriter, x: number, y: number, state: SwitchState, appearance: Appearance): void;
  activitySize(size: unknown): number;
  drawActivity(w: CommandWriter, x: number, y: number, size: number, state: ActivityState, appearance: Appearance): void;
  /** status bar, home indicator / navigation handle */
  drawChrome(w: CommandWriter, viewport: Viewport, statusBar: StatusBarState, appearance: Appearance, bundledFonts: boolean): void;
  /** Design tokens consumed by system UI written in React (alerts, sheets, RedBox). */
  readonly tokens: Readonly<Record<string, unknown>>;
}

// ── drawing helpers shared by kits ───────────────────────────────────────

export function circle(w: CommandWriter, cx: number, cy: number, r: number, color: number): void {
  w.pathBegin().arc(cx, cy, r, 0, Math.PI * 2).closePath().fillPath(color);
}

export function pill(w: CommandWriter, x: number, y: number, width: number, height: number, color: number): void {
  const r = Math.min(width, height) / 2;
  w.fillRRect(x, y, width, height, [r, r, r, r], color);
}

export function resolveBarStyle(barStyle: string, appearance: Appearance): 'light' | 'dark' {
  // 'light' = light glyphs (for dark backgrounds)
  if (barStyle === 'light-content' || barStyle === 'light') return 'light';
  if (barStyle === 'dark-content' || barStyle === 'dark') return 'dark';
  return appearance === 'dark' ? 'light' : 'dark';
}

export const WEIGHTS: Record<string, string> = {
  normal: '400', regular: '400', bold: '700', ultralight: '100', thin: '200', light: '300',
  medium: '500', semibold: '600', heavy: '800', black: '900', condensedBold: '700', condensed: '400',
};

export function normalizeWeight(weight: unknown): string {
  if (weight == null) return '400';
  if (typeof weight === 'number') return String(Math.round(weight / 100) * 100);
  return WEIGHTS[String(weight)] ?? (/^\d00$/.test(String(weight)) ? String(weight) : '400');
}
