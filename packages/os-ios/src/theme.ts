import { mixColor, rgba, withAlpha, type Appearance, type CommandWriter, type Viewport } from '@mimicry/protocol';
import { pill, resolveBarStyle, type ActivityState, type PlatformKit, type StatusBarState, type SwitchState } from '@mimicry/os-core';

/**
 * iOS kit: UIKit semantic colors, SF Pro typography (Inter when bundled
 * fonts are requested), UISwitch / UIActivityIndicatorView drawing, status
 * bar and home indicator.
 *
 * Controls follow iOS 26 metrics measured against simulator captures (see
 * the oracle loop in docs/fidelity.md); Liquid Glass refraction is not drawn.
 */
const hex = (h: string, a = 1) => {
  const n = parseInt(h.replace('#', ''), 16);
  return rgba((n >> 16) & 255, (n >> 8) & 255, n & 255, a);
};

type Pair = readonly [light: number, dark: number];
const pair = (light: number, dark: number): Pair => [light, dark];

export const IOS_COLORS: Record<string, Pair> = {
  label: pair(hex('#000000'), hex('#ffffff')),
  secondaryLabel: pair(rgba(60, 60, 67, 0.6), rgba(235, 235, 245, 0.6)),
  tertiaryLabel: pair(rgba(60, 60, 67, 0.3), rgba(235, 235, 245, 0.3)),
  quaternaryLabel: pair(rgba(60, 60, 67, 0.18), rgba(235, 235, 245, 0.16)),
  placeholderText: pair(rgba(60, 60, 67, 0.3), rgba(235, 235, 245, 0.3)),
  systemFill: pair(rgba(120, 120, 128, 0.2), rgba(120, 120, 128, 0.36)),
  secondarySystemFill: pair(rgba(120, 120, 128, 0.16), rgba(120, 120, 128, 0.32)),
  tertiarySystemFill: pair(rgba(118, 118, 128, 0.12), rgba(118, 118, 128, 0.24)),
  quaternarySystemFill: pair(rgba(116, 116, 128, 0.08), rgba(118, 118, 128, 0.18)),
  systemBackground: pair(hex('#ffffff'), hex('#000000')),
  secondarySystemBackground: pair(hex('#f2f2f7'), hex('#1c1c1e')),
  tertiarySystemBackground: pair(hex('#ffffff'), hex('#2c2c2e')),
  systemGroupedBackground: pair(hex('#f2f2f7'), hex('#000000')),
  secondarySystemGroupedBackground: pair(hex('#ffffff'), hex('#1c1c1e')),
  tertiarySystemGroupedBackground: pair(hex('#f2f2f7'), hex('#2c2c2e')),
  separator: pair(rgba(60, 60, 67, 0.29), rgba(84, 84, 88, 0.6)),
  opaqueSeparator: pair(hex('#c6c6c8'), hex('#38383a')),
  link: pair(hex('#007aff'), hex('#0984ff')),
  systemBlue: pair(hex('#007aff'), hex('#0a84ff')),
  systemGreen: pair(hex('#34c759'), hex('#30d158')),
  systemIndigo: pair(hex('#5856d6'), hex('#5e5ce6')),
  systemOrange: pair(hex('#ff9500'), hex('#ff9f0a')),
  systemPink: pair(hex('#ff2d55'), hex('#ff375f')),
  systemPurple: pair(hex('#af52de'), hex('#bf5af2')),
  systemRed: pair(hex('#ff3b30'), hex('#ff453a')),
  systemTeal: pair(hex('#30b0c7'), hex('#40cbe0')),
  systemYellow: pair(hex('#ffcc00'), hex('#ffd60a')),
  systemMint: pair(hex('#00c7be'), hex('#63e6e2')),
  systemCyan: pair(hex('#32ade6'), hex('#64d2ff')),
  systemBrown: pair(hex('#a2845e'), hex('#ac8e68')),
  systemGray: pair(hex('#8e8e93'), hex('#8e8e93')),
  systemGray2: pair(hex('#aeaeb2'), hex('#636366')),
  systemGray3: pair(hex('#c7c7cc'), hex('#48484a')),
  systemGray4: pair(hex('#d1d1d6'), hex('#3a3a3c')),
  systemGray5: pair(hex('#e5e5ea'), hex('#2c2c2e')),
  systemGray6: pair(hex('#f2f2f7'), hex('#1c1c1e')),
  lightText: pair(rgba(255, 255, 255, 0.6), rgba(255, 255, 255, 0.6)),
  darkText: pair(hex('#000000'), hex('#000000')),
  systemTint: pair(hex('#007aff'), hex('#0a84ff')),
  tintColor: pair(hex('#007aff'), hex('#0a84ff')),
};

const color = (name: string, appearance: Appearance) => IOS_COLORS[name]![appearance === 'dark' ? 1 : 0];

const SYSTEM_STACK = '-apple-system, BlinkMacSystemFont, "SF Pro Text", Inter, "Helvetica Neue", sans-serif';
const BUNDLED = 'Inter';

const NAMED_FAMILIES: Record<string, string> = {
  Courier: 'Courier, "Courier New", monospace',
  'Courier New': '"Courier New", Courier, monospace',
  Menlo: 'Menlo, "SF Mono", Monaco, monospace',
  Georgia: 'Georgia, serif',
  'Times New Roman': '"Times New Roman", Times, serif',
  Helvetica: 'Helvetica, Arial, sans-serif',
  'Helvetica Neue': '"Helvetica Neue", Helvetica, sans-serif',
  Arial: 'Arial, Helvetica, sans-serif',
  'American Typewriter': '"American Typewriter", serif',
  Avenir: 'Avenir, "Avenir Next", sans-serif',
  'Avenir Next': '"Avenir Next", Avenir, sans-serif',
  Futura: 'Futura, sans-serif',
  'Gill Sans': '"Gill Sans", sans-serif',
};

/** [pt, em] extra tracking for the Inter stand-in, by font size */
const TRACKING: [number, number][] = [[11, 0], [12, -0.004], [13, -0.012], [15, -0.018], [17, -0.022], [28, -0.02], [34, -0.02]];

function interpolate(table: [number, number][], x: number): number {
  if (x <= table[0]![0]) return table[0]![1];
  for (let i = 1; i < table.length; i++) {
    const [x1, y1] = table[i]!;
    if (x <= x1) {
      const [x0, y0] = table[i - 1]!;
      return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
    }
  }
  return table[table.length - 1]![1];
}

export const iosKit: PlatformKit = {
  platform: 'ios',

  fontStack(family, bundledOnly) {
    const base = bundledOnly ? BUNDLED : SYSTEM_STACK;
    if (!family || family === 'System' || family === 'system-ui') return base;
    if (family === 'monospace' || family === 'ui-monospace') return `Menlo, "SF Mono", ${bundledOnly ? '"Roboto Mono", ' : ''}monospace`;
    return NAMED_FAMILIES[family] ? `${NAMED_FAMILIES[family]}, ${base}` : `"${family}", ${base}`;
  },

  fontWeightFor: () => null,

  standIn(size, weight) {
    // Inter sets ~2–4% wider than SF Pro and its line box is taller. Tracking
    // was fit to ink widths in iOS 26 simulator captures (see docs/fidelity.md);
    // semibold and bold Inter already match SF at caption sizes.
    let tracking = interpolate(TRACKING, size);
    if (weight >= 600) tracking *= Math.min(1, Math.max(0, (size - 13) / 4));
    return { tracking, ascent: 0.952, descent: 0.241 }; // SF Pro: UIFont.lineHeight = 1.193em
  },

  text: {
    fontSize: 14,
    // React Native's iOS Text defaults to black even in dark mode.
    color: () => rgba(0, 0, 0, 1),
    inputPadding: { top: 0, right: 0, bottom: 0, left: 0 },
    inputUnderline: false,
    placeholderColor: (a) => color('placeholderText', a),
    selectionColor: (a) => color('systemBlue', a),
  },

  semanticColor(name, appearance) {
    const entry = IOS_COLORS[name];
    return entry ? entry[appearance === 'dark' ? 1 : 0] : null;
  },

  scroll: {
    rubberBand: true,
    rubberBandCoefficient: 0.55,
    decelerationRate: 0.998,
    fastDecelerationRate: 0.99,
    bounceStiffness: 220,
    bounceDamping: 2 * Math.sqrt(220),
    touchSlop: 10,
    indicatorThickness: 3,
    indicatorInset: 3,
    indicatorColor: (appearance, style) =>
      style === 'white' || (style !== 'black' && appearance === 'dark') ? rgba(255, 255, 255, 0.35) : rgba(0, 0, 0, 0.35),
    indicatorFadeDelay: 500,
  },

  borderAboveChildren: true,
  hitTestOutsideBounds: true,
  // iOS 26 (Liquid Glass) UISwitch, measured on a simulator capture:
  // 63×28 track, 37×24 pill thumb inset 2pt.
  switchSize: { width: 63, height: 28 },

  drawSwitch(w: CommandWriter, x: number, y: number, s: SwitchState, appearance: Appearance) {
    const off = s.trackOff ?? s.backgroundOff ?? (appearance === 'dark' ? rgba(120, 120, 128, 0.66) : rgba(120, 120, 128, 0.43));
    const on = s.trackOn ?? color('systemGreen', appearance);
    const track = mixColor(off, on, s.progress);
    w.save();
    if (s.disabled) w.alpha(0.5);
    pill(w, x, y, 63, 28, track);
    const stretch = s.pressed * 6; // the thumb stretches while pressed
    const thumbW = 37 + stretch;
    const travel = 63 - 4 - thumbW;
    const tx = x + 2 + travel * s.progress;
    w.shadow(rgba(0, 0, 0, 0.1), 4, 0, 1);
    pill(w, tx, y + 2, thumbW, 24, s.thumb ?? rgba(255, 255, 255, 1));
    w.shadowClear();
    w.restore();
  },

  activitySize(size) {
    if (typeof size === 'number') return size;
    return size === 'large' ? 36 : 20;
  },

  drawActivity(w, x, y, size, s: ActivityState, appearance) {
    if (!s.animating) return;
    const c = s.color ?? (appearance === 'dark' ? rgba(235, 235, 245, 0.6) : rgba(153, 153, 153, 1));
    const cx = x + size / 2;
    const cy = y + size / 2;
    const spokes = 8;
    const step = Math.floor(s.time * spokes) % spokes; // one revolution per second
    const inner = size * 0.22;
    const outer = size * 0.46;
    const width = Math.max(1.5, size * 0.11);
    for (let i = 0; i < spokes; i++) {
      const age = (step - i + spokes) % spokes;
      const alpha = 1 - (age / spokes) * 0.75;
      const a = (i / spokes) * Math.PI * 2 - Math.PI / 2;
      const cos = Math.cos(a);
      const sin = Math.sin(a);
      w.pathBegin().moveTo(cx + cos * inner, cy + sin * inner).lineTo(cx + cos * outer, cy + sin * outer);
      w.strokePath(withAlpha(c, alpha), width, 1, 1);
    }
  },

  drawChrome(w, viewport: Viewport, bar: StatusBarState, appearance, bundled) {
    const { device, width } = viewport;
    const glyph = resolveBarStyle(bar.barStyle, appearance) === 'light' ? rgba(255, 255, 255, 1) : rgba(0, 0, 0, 1);
    const font = bundled ? BUNDLED : SYSTEM_STACK;
    const cutout = device.cutout;
    // The Dynamic Island is drawn by the system and appears in screenshots
    // (unlike a hardware notch or the home indicator, which the host draws).
    if (cutout.kind === 'dynamic-island' && viewport.orientation === 'portrait') {
      pill(w, (width - cutout.width) / 2, cutout.top, cutout.width, cutout.height, rgba(0, 0, 0, 1));
    }
    if (!bar.hidden && viewport.statusBarHeight > 0) {
      if (cutout.kind === 'dynamic-island' || cutout.kind === 'notch') {
        const cy = cutout.kind === 'dynamic-island' ? cutout.top + cutout.height / 2 : viewport.statusBarHeight / 2 + 2;
        const side = (width - cutout.width) / 2;
        const leftCenter = side / 2 + 4;
        w.font(`600 17px ${font}`);
        // "9:41" is ~36pt wide at 17pt semibold
        w.text(leftCenter - 18, cy + 6, glyph, 0, '9:41');
        drawStatusIcons(w, width - leftCenter, cy, glyph, false);
      } else {
        const cy = viewport.statusBarHeight / 2;
        w.font(`600 12px ${font}`);
        if (device.idiom === 'tablet') {
          w.text(20, cy + 4, glyph, 0, '9:41 AM  Mon Jun 9');
          drawStatusIcons(w, width - 46, cy, glyph, true);
        } else {
          w.text(width / 2 - 24, cy + 4, glyph, 0, '9:41 AM');
          drawSignal(w, 6, cy, glyph);
          drawBattery(w, width - 33, cy, glyph);
        }
      }
    }
    // The home indicator is not part of a simulator screenshot; hosts draw it
    // over the screen (Studio does), so captures compare like for like.
  },

  tokens: {
    alertWidth: 270,
    alertRadius: 14,
    alertBackground: [rgba(242, 242, 242, 0.97), rgba(44, 44, 46, 0.97)],
    alertTitleSize: 17,
    alertMessageSize: 13,
    alertButtonHeight: 44,
    alertButtonSize: 17,
    alertSeparator: [rgba(60, 60, 67, 0.29), rgba(84, 84, 88, 0.6)],
    alertTint: [hex('#007aff'), hex('#0a84ff')],
    alertDestructive: [hex('#ff3b30'), hex('#ff453a')],
    alertText: [hex('#000000'), hex('#ffffff')],
    alertDim: rgba(0, 0, 0, 0.2),
    alertUppercaseButtons: false,
    sheetRadius: 10,
    sheetDim: rgba(0, 0, 0, 0.4),
    sheetTopGap: 10,
    pageSheetScale: 0.92,
    modalDuration: 350,
    buttonColor: [hex('#007aff'), hex('#0a84ff')],
    buttonFontSize: 18,
    groupedBackground: [hex('#f2f2f7'), hex('#000000')],
    cellBackground: [hex('#ffffff'), hex('#1c1c1e')],
  },
};

function drawStatusIcons(w: CommandWriter, centerX: number, cy: number, glyph: number, percent: boolean): void {
  // Measured on an iOS 26 simulator capture: signal (19) · wifi at +26.7 ·
  // battery at +51 (27 wide incl. cap).
  let x = centerX - 39;
  if (percent) x -= 10;
  drawSignal(w, x, cy, glyph);
  drawWifi(w, x + 26.7, cy, glyph);
  drawBattery(w, x + 51, cy, glyph);
}

function drawSignal(w: CommandWriter, x: number, cy: number, c: number): void {
  const heights = [4, 6.5, 9, 11.5];
  heights.forEach((h, i) => {
    w.fillRRect(x + i * 5.2, cy + 5.5 - h, 3.4, h, [1, 1, 1, 1], c);
  });
}

function drawWifi(w: CommandWriter, x: number, cy: number, c: number): void {
  const cx = x + 7.5;
  const base = cy + 5.5;
  const start = -Math.PI * 0.75;
  const end = -Math.PI * 0.25;
  // three concentric wedges
  for (const [outer, inner] of [[12, 8.6], [7.6, 4.3]] as const) {
    w.pathBegin().arc(cx, base, outer, start, end).arc(cx, base, inner, end, start, true).closePath().fillPath(c);
  }
  w.pathBegin().moveTo(cx, base).arc(cx, base, 3.3, start, end).closePath().fillPath(c);
}

function drawBattery(w: CommandWriter, x: number, cy: number, c: number): void {
  const top = cy - 6;
  w.strokeRRect(x + 0.5, top + 0.5, 25, 12, [4, 4, 4, 4], 1, withAlpha(c, 0.4));
  w.fillRRect(x + 2.5, top + 2.5, 21, 8, [2, 2, 2, 2], c);
  w.fillRRect(x + 26.5, cy - 2, 1.5, 4, [0, 1, 1, 0], withAlpha(c, 0.4));
}

