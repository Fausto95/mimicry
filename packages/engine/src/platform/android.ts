import { mixColor, rgba, withAlpha, type Appearance, type CommandWriter, type Viewport } from '@mimicry/protocol';
import { circle, pill, resolveBarStyle, type ActivityState, type PlatformKit, type StatusBarState, type SwitchState } from './kit';

/**
 * Android kit: what a stock React Native app looks like on Android — Roboto,
 * AppCompat widgets (SwitchCompat, ProgressBar, EditText with underline),
 * theme attributes for PlatformColor, edge-to-edge status bar and the
 * gesture navigation handle.
 *
 * React Native's core components are AppCompat-based, not Material 3, so the
 * defaults below follow Theme.AppCompat.DayNight (colorAccent #009688).
 */
const hex = (h: string, a = 1) => {
  const n = parseInt(h.replace('#', ''), 16);
  return rgba((n >> 16) & 255, (n >> 8) & 255, n & 255, a);
};
/** Android #AARRGGBB */
const argb = (h: string) => {
  const n = parseInt(h.replace('#', ''), 16) >>> 0;
  return rgba((n >> 16) & 255, (n >> 8) & 255, n & 255, ((n >>> 24) & 255) / 255);
};

type Pair = readonly [light: number, dark: number];
const same = (c: number): Pair => [c, c];

export const ANDROID_COLORS: Record<string, Pair> = {
  '?attr/colorAccent': [hex('#009688'), hex('#80cbc4')],
  '?android:attr/colorAccent': [hex('#009688'), hex('#80cbc4')],
  '?attr/colorControlActivated': [hex('#009688'), hex('#80cbc4')],
  '?attr/colorPrimary': [hex('#f5f5f5'), hex('#212121')],
  '?android:attr/colorPrimary': [hex('#f5f5f5'), hex('#212121')],
  '?attr/colorPrimaryDark': [hex('#757575'), hex('#000000')],
  '?attr/colorControlNormal': [argb('#8a000000'), argb('#b3ffffff')],
  '?attr/colorControlHighlight': [argb('#1f000000'), argb('#33ffffff')],
  '?attr/colorError': [hex('#b00020'), hex('#cf6679')],
  '?android:attr/textColor': [argb('#de000000'), hex('#ffffff')],
  '?android:attr/textColorPrimary': [argb('#de000000'), hex('#ffffff')],
  '?android:attr/textColorSecondary': [argb('#8a000000'), argb('#b3ffffff')],
  '?android:attr/textColorHint': [argb('#61000000'), argb('#80ffffff')],
  '?android:attr/colorBackground': [hex('#fafafa'), hex('#303030')],
  '?android:attr/windowBackground': [hex('#fafafa'), hex('#303030')],
  '@android:color/black': same(hex('#000000')),
  '@android:color/white': same(hex('#ffffff')),
  '@android:color/transparent': same(0),
  '@android:color/darker_gray': same(hex('#aaaaaa')),
  '@android:color/background_dark': same(hex('#000000')),
  '@android:color/background_light': same(hex('#ffffff')),
  '@android:color/primary_text_dark': same(hex('#ffffff')),
  '@android:color/primary_text_light': same(argb('#de000000')),
  '@android:color/secondary_text_dark': same(argb('#b3ffffff')),
  '@android:color/secondary_text_light': same(argb('#8a000000')),
  '@android:color/holo_blue_bright': same(hex('#00ddff')),
  '@android:color/holo_blue_dark': same(hex('#0099cc')),
  '@android:color/holo_blue_light': same(hex('#33b5e5')),
  '@android:color/holo_green_dark': same(hex('#669900')),
  '@android:color/holo_green_light': same(hex('#99cc00')),
  '@android:color/holo_orange_dark': same(hex('#ff8800')),
  '@android:color/holo_orange_light': same(hex('#ffbb33')),
  '@android:color/holo_purple': same(hex('#aa66cc')),
  '@android:color/holo_red_dark': same(hex('#cc0000')),
  '@android:color/holo_red_light': same(hex('#ff4444')),
  // Material You baseline (used when dynamic color is unavailable)
  '@android:color/system_accent1_500': same(hex('#2b6be1')),
  '@android:color/system_accent1_100': same(hex('#d8e2ff')),
  '@android:color/system_neutral1_900': same(hex('#1b1b1f')),
  '@android:color/system_neutral1_50': same(hex('#f1f0f4')),
};

const accent = (a: Appearance) => ANDROID_COLORS['?attr/colorAccent']![a === 'dark' ? 1 : 0];

const ROBOTO = 'Roboto, "Noto Sans", sans-serif';

const FAMILIES: Record<string, { stack: string; weight?: string }> = {
  'sans-serif': { stack: ROBOTO },
  'sans-serif-medium': { stack: ROBOTO, weight: '500' },
  'sans-serif-light': { stack: ROBOTO, weight: '300' },
  'sans-serif-thin': { stack: ROBOTO, weight: '100' },
  'sans-serif-black': { stack: ROBOTO, weight: '900' },
  'sans-serif-condensed': { stack: `"Roboto Condensed", ${ROBOTO}` },
  serif: { stack: '"Noto Serif", "Droid Serif", serif' },
  monospace: { stack: '"Roboto Mono", "Droid Sans Mono", monospace' },
};

export const androidKit: PlatformKit = {
  platform: 'android',

  // Android always renders with Roboto (served by Mimicry) — a system font
  // stack would silently turn into SF Pro on a Mac.
  fontStack(family) {
    if (!family || family === 'System' || family === 'system-ui') return ROBOTO;
    const known = FAMILIES[family];
    if (known) return known.stack;
    return `"${family}", ${ROBOTO}`;
  },

  fontWeightFor: (family) => (family ? FAMILIES[family]?.weight ?? null : null),

  text: {
    fontSize: 14,
    // Text inherits ?android:textColorPrimary from the theme, so dark mode turns it white.
    color: (a) => (a === 'dark' ? hex('#ffffff') : argb('#de000000')),
    inputPadding: { top: 10, right: 4, bottom: 10, left: 4 },
    inputUnderline: true,
    placeholderColor: (a) => (a === 'dark' ? argb('#80ffffff') : argb('#61000000')),
    selectionColor: (a) => withAlpha(accent(a), 0.4),
  },

  semanticColor(name, appearance) {
    const entry = ANDROID_COLORS[name];
    return entry ? entry[appearance === 'dark' ? 1 : 0] : null;
  },

  scroll: {
    rubberBand: false,
    rubberBandCoefficient: 0,
    decelerationRate: 0.9972,
    fastDecelerationRate: 0.99,
    bounceStiffness: 400,
    bounceDamping: 40,
    touchSlop: 8,
    indicatorThickness: 4,
    indicatorInset: 2,
    indicatorColor: (appearance) => (appearance === 'dark' ? rgba(255, 255, 255, 0.4) : rgba(0, 0, 0, 0.4)),
    indicatorFadeDelay: 300,
  },

  borderAboveChildren: false,
  hitTestOutsideBounds: false,
  switchSize: { width: 52, height: 32 },

  drawSwitch(w: CommandWriter, x: number, y: number, s: SwitchState, appearance: Appearance) {
    const dark = appearance === 'dark';
    const thumbOff = dark ? hex('#b9b9b9') : hex('#ececec');
    const thumbOn = s.thumb ?? accent(appearance);
    const trackOff = s.trackOff ?? (dark ? rgba(255, 255, 255, 0.3) : rgba(0, 0, 0, 0.38));
    const trackOn = s.trackOn ?? withAlpha(accent(appearance), 0.5);
    w.save();
    if (s.disabled) w.alpha(0.5);
    pill(w, x + 9, y + 9, 34, 14, mixColor(trackOff, trackOn, s.progress));
    const cx = x + 16 + 20 * s.progress;
    const cy = y + 16;
    if (s.pressed > 0) circle(w, cx, cy, 20 * s.pressed, withAlpha(mixColor(thumbOff, thumbOn, s.progress), 0.2));
    w.shadow(rgba(0, 0, 0, 0.3), 3, 0, 1);
    circle(w, cx, cy, 10, s.thumb && s.progress < 0.5 ? s.thumb : mixColor(thumbOff, thumbOn, s.progress));
    w.shadowClear();
    w.restore();
  },

  activitySize(size) {
    if (typeof size === 'number') return size;
    return size === 'large' ? 36 : 20;
  },

  drawActivity(w, x, y, size, s: ActivityState, appearance) {
    if (!s.animating) return;
    const c = s.color ?? accent(appearance);
    const stroke = size / 10;
    const r = size / 2 - stroke;
    const cx = x + size / 2;
    const cy = y + size / 2;
    // Material indeterminate spinner: the arc grows and shrinks while the whole thing rotates.
    const cycle = 1.333;
    const phase = (s.time % cycle) / cycle;
    const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
    const grow = phase < 0.5 ? ease(phase * 2) : 1 - ease((phase - 0.5) * 2);
    const sweep = (10 + 260 * grow) * (Math.PI / 180);
    const base = s.time * Math.PI * 2 * 0.8 + (phase >= 0.5 ? ease((phase - 0.5) * 2) * 260 * (Math.PI / 180) : 0);
    w.pathBegin().arc(cx, cy, r, base, base + sweep).strokePath(c, stroke, 0, 0);
  },

  drawChrome(w, viewport: Viewport, bar: StatusBarState, appearance) {
    const { width, height, device } = viewport;
    if (!bar.hidden && viewport.statusBarHeight > 0) {
      if (bar.backgroundColor) w.fillRect(0, 0, width, viewport.statusBarHeight, bar.backgroundColor);
      const glyph = resolveBarStyle(bar.barStyle, appearance) === 'light' ? rgba(255, 255, 255, 1) : rgba(0, 0, 0, 1);
      const cy = viewport.statusBarHeight / 2 + 2;
      w.font(`500 14px ${ROBOTO}`);
      w.text(24, cy + 5, glyph, 0, '12:30');
      // wifi · signal · battery (vertical)
      const right = width - 24;
      w.pathBegin().moveTo(right - 44, cy + 6).lineTo(right - 51, cy - 3).arc(right - 44, cy + 6, 11, -Math.PI * 0.75, -Math.PI * 0.25)
        .closePath().fillPath(glyph);
      w.pathBegin().moveTo(right - 21, cy + 7).lineTo(right - 21 - 13, cy + 7).lineTo(right - 21, cy - 6).closePath().fillPath(glyph);
      w.fillRRect(right - 8, cy - 7, 8, 14, [1.5, 1.5, 1.5, 1.5], glyph);
      w.fillRect(right - 6, cy - 9, 4, 2, glyph);
      if (device.cutout.kind === 'punch-hole') {
        circle(w, width / 2, device.cutout.top + device.cutout.height / 2, device.cutout.height / 2, rgba(0, 0, 0, 1));
      }
    }
    if (device.homeIndicator) {
      const handle = appearance === 'dark' ? rgba(255, 255, 255, 0.85) : rgba(0, 0, 0, 0.7);
      pill(w, (width - 108) / 2, height - 12 - 2, 108, 4, handle);
    }
  },

  tokens: {
    alertWidth: 280,
    alertMaxWidth: 560,
    alertRadius: 2,
    alertBackground: [hex('#ffffff'), hex('#424242')],
    alertTitleSize: 20,
    alertMessageSize: 16,
    alertButtonHeight: 36,
    alertButtonSize: 14,
    alertSeparator: [0, 0],
    alertTint: [hex('#009688'), hex('#80cbc4')],
    alertDestructive: [hex('#009688'), hex('#80cbc4')],
    alertText: [argb('#de000000'), hex('#ffffff')],
    alertMessageText: [argb('#8a000000'), argb('#b3ffffff')],
    alertDim: rgba(0, 0, 0, 0.6),
    alertUppercaseButtons: true,
    sheetRadius: 0,
    sheetDim: rgba(0, 0, 0, 0.6),
    sheetTopGap: 0,
    pageSheetScale: 1,
    modalDuration: 300,
    buttonColor: [hex('#2196f3'), hex('#2196f3')],
    buttonFontSize: 14,
    groupedBackground: [hex('#fafafa'), hex('#303030')],
    cellBackground: [hex('#ffffff'), hex('#424242')],
  },
};
