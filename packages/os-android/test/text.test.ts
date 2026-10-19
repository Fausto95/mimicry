import { describe, expect, it } from 'vitest';
import { createDevice, type Device } from '@mimicry/testing';
import {
  Activity, AbsoluteSizeSpan, BackgroundColorSpan, ClickableSpan, Color, ForegroundColorSpan, FrameLayout, FrameLayoutParams, Gravity, Layout,
  LayoutParams, LinkMovementMethod, RelativeSizeSpan, SpannableString, SpannableStringBuilder, Spanned, StaticLayout, StyleSpan, TextAppearance,
  TextPaint, TextUtils, TextView, TruncateAt, Typeface, TypedValue, URLSpan, UnderlineSpan, type View,
} from '@mimicry/os-android';
import { PNG } from 'pngjs';

function launch(build: (activity: Activity) => View, options: { fontScale?: number } = {}): { device: Device; activity: Activity } {
  const device = createDevice({ device: 'pixel-9', fontScale: options.fontScale });
  let activity!: Activity;
  class Main extends Activity {
    protected override onCreate(): void {
      activity = this;
      this.setContentView(build(this));
    }
  }
  new Main(device.kernel, device.android.windowManager).launch();
  device.advance(32);
  return { device, activity };
}

/** A TextView in a white frame at (0, 0) with the given layout params. */
function textScreen(configure: (tv: TextView) => void, lp = new FrameLayoutParams(LayoutParams.WRAP_CONTENT, LayoutParams.WRAP_CONTENT), options: { fontScale?: number } = {}) {
  let tv!: TextView;
  const launched = launch((ctx) => {
    const frame = new FrameLayout(ctx);
    frame.setBackgroundColor(Color.WHITE);
    tv = new TextView(ctx);
    configure(tv);
    frame.addView(tv, -1, lp);
    return frame;
  }, options);
  return { ...launched, tv };
}

function image(device: Device) {
  return PNG.sync.read(device.screenshot(1));
}

function rgbAt(png: PNG, x: number, y: number): [number, number, number] {
  const i = (Math.round(y) * png.width + Math.round(x)) * 4;
  return [png.data[i]!, png.data[i + 1]!, png.data[i + 2]!];
}

/** Count pixels in a box that match a predicate. */
function count(png: PNG, x0: number, y0: number, x1: number, y1: number, match: (rgb: [number, number, number]) => boolean): number {
  let n = 0;
  for (let y = Math.max(0, Math.floor(y0)); y < Math.min(png.height, y1); y++) {
    for (let x = Math.max(0, Math.floor(x0)); x < Math.min(png.width, x1); x++) if (match(rgbAt(png, x, y))) n++;
  }
  return n;
}

const dark = ([r, g, b]: [number, number, number]) => r + g + b < 300;

describe('units and typefaces', () => {
  it('converts TypedValue units to dp', () => {
    const { activity } = launch((ctx) => new FrameLayout(ctx));
    const metrics = activity.getResources().getDisplayMetrics();
    expect(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, 16, metrics)).toBe(16);
    expect(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_PX, 42, metrics)).toBeCloseTo(16);
    expect(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_SP, 10, metrics)).toBeCloseTo(10);
    expect(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_IN, 1, metrics)).toBeCloseTo(160, 0);
  });

  it('resolves system families, styles and weights', () => {
    expect(Typeface.create('sans-serif-medium', Typeface.NORMAL).weight).toBe(500);
    const boldItalic = Typeface.defaultFromStyle(Typeface.BOLD_ITALIC);
    expect(boldItalic.isBold()).toBe(true);
    expect(boldItalic.isItalic()).toBe(true);
    expect(Typeface.create(Typeface.DEFAULT, 600, false).weight).toBe(600);
    expect(Typeface.MONOSPACE.css(14)).toContain('Roboto Mono');
    expect(Typeface.DEFAULT.css(14)).toMatch(/^400 14px Roboto/);
  });
});

describe('TextView', () => {
  it('is as tall as Roboto with font padding, rounded to device pixels', () => {
    const { tv } = textScreen((t) => t.setText('Hello'));
    // 14sp at 2.625x: top floor(-38.8) = -39px, bottom ceil(9.96) = 10px → 49px
    expect(tv.getHeight()).toBeCloseTo(49 / 2.625, 5);
  });

  it('drops the font padding when asked', () => {
    const { tv } = textScreen((t) => {
      t.setText('Hello');
      t.setIncludeFontPadding(false);
    });
    // ascent round(-34.09) = -34, descent round(8.97) = 9 → 43px
    expect(tv.getHeight()).toBeCloseTo(43 / 2.625, 5);
  });

  it('wraps to the parent, measures its content and ellipsizes at maxLines', () => {
    const long = 'The quick brown fox jumps over the lazy dog and keeps running through the field until the sun goes down';
    const { tv } = textScreen((t) => {
      t.setText(long);
      t.setMaxLines(2);
      t.setEllipsize(TruncateAt.END);
    }, new FrameLayoutParams(200, LayoutParams.WRAP_CONTENT));
    const layout = tv.getLayout()!;
    expect(tv.getLineCount()).toBe(2);
    expect(layout.getEllipsisCount(1)).toBeGreaterThan(0);
    expect(layout.getLineStart(1)).toBeGreaterThan(10);
    expect(layout.getLineEnd(1)).toBe(long.length);
    expect(layout.getLineWidth(1)).toBeLessThanOrEqual(200);
    const lineText = layout.layoutLines[1]!.runs.map((r) => r.text).join('');
    expect(lineText.endsWith('…')).toBe(true);
  });

  it('caps its height at maxLines without ellipsizing, and pads up to minLines', () => {
    const { tv } = textScreen((t) => {
      t.setText('one\ntwo\nthree\nfour');
      t.setMaxLines(2);
    });
    const layout = tv.getLayout()!;
    expect(layout.getLineCount()).toBe(4);
    expect(tv.getHeight()).toBeCloseTo(layout.getLineTop(2) + layout.getBottomPadding(), 5);
    tv.setMaxLines(Number.MAX_SAFE_INTEGER);
    tv.setText('x');
    tv.setMinLines(3);
    tv.measure(0, 0);
    expect(tv.getMeasuredHeight()).toBeCloseTo(tv.getLayout()!.getHeight() + 2 * tv.getLineHeight(), 5);
  });

  it('adds line spacing between lines but not after the last', () => {
    const { tv } = textScreen((t) => {
      t.setText('a\nb\nc');
      t.setIncludeFontPadding(false);
    });
    const single = tv.getLayout()!.getLineBottom(0) - tv.getLayout()!.getLineTop(0);
    tv.setLineSpacing(4, 1);
    tv.measure(0, 0);
    // the extra is rounded to whole device pixels: 4dp × 2.625 = 10.5 → 11px
    expect(tv.getMeasuredHeight()).toBeCloseTo(3 * single + (2 * 11) / 2.625, 5);
    tv.setLineHeight(30);
    tv.measure(0, 0);
    expect(tv.getLayout()!.getLineTop(1)).toBeCloseTo(30, 0);
  });

  it('sizes text by unit and follows the font scale', () => {
    const { tv } = textScreen((t) => t.setText('Aa'), undefined, { fontScale: 1.3 });
    expect(tv.getTextSize()).toBeCloseTo(14 * 1.3);
    tv.setTextSize(TypedValue.COMPLEX_UNIT_DIP, 20);
    expect(tv.getTextSize()).toBe(20);
    tv.setTextSize(TypedValue.COMPLEX_UNIT_PX, 42);
    expect(tv.getTextSize()).toBeCloseTo(16);
  });

  it('applies a Material text appearance', () => {
    const { tv } = textScreen((t) => {
      t.setText('Title\nTwo\nThree');
      t.setTextAppearance(TextAppearance.TitleLarge);
    });
    expect(tv.getTextSize()).toBe(22);
    // line height 28sp between baselines (the first line also carries the font padding)
    const layout = tv.getLayout()!;
    expect(layout.getLineBaseline(2) - layout.getLineBaseline(1)).toBeCloseTo(28, 0);
  });

  it('draws text centered by its gravity in the theme color', () => {
    const { device, tv } = textScreen((t) => {
      t.setText('MMMM');
      t.setTextSize(24);
      t.setGravity(Gravity.CENTER);
      t.setTextColor(Color.BLACK);
    }, new FrameLayoutParams(300, 120, Gravity.CENTER));
    const png = image(device);
    const x = tv.getLeft();
    const y = tv.getTop();
    expect(count(png, x, y, x + 80, y + 120, dark)).toBe(0);
    expect(count(png, x + 120, y + 40, x + 180, y + 80, dark)).toBeGreaterThan(50);
    expect(count(png, x, y, x + 300, y + 35, dark)).toBe(0);
    expect(tv.getCurrentTextColor()).toBe(Color.BLACK);
  });

  it('uses the M3 secondary text color by default and draws the hint when empty', () => {
    const { device, tv } = textScreen((t) => {
      t.setHint('Search');
      t.setTextSize(30);
    });
    expect(tv.getCurrentTextColor()).toBe(Color.parseColor('#49454F'));
    expect(tv.getWidth()).toBeGreaterThan(50);
    const png = image(device);
    const hint = count(png, 0, 0, tv.getWidth(), tv.getHeight(), ([r, g, b]) => r < 230 && r > 100 && Math.abs(r - b) < 40 && g < 230);
    expect(hint).toBeGreaterThan(20);
  });

  it('measures letter spacing and all caps', () => {
    const { tv } = textScreen((t) => t.setText('label'));
    const plain = tv.getWidth();
    tv.setAllCaps(true);
    tv.measure(0, 0);
    const caps = tv.getMeasuredWidth();
    expect(caps).toBeGreaterThan(plain);
    tv.setLetterSpacing(0.1);
    tv.measure(0, 0);
    expect(tv.getMeasuredWidth()).toBeCloseTo(caps + 5 * 1.4, 0);
  });

  it('hyphenates long words when asked', () => {
    const { tv } = textScreen((t) => {
      t.setText('Incomprehensibilities characterization');
      t.setTextSize(20);
      t.setHyphenationFrequency(Layout.HYPHENATION_FREQUENCY_FULL);
    }, new FrameLayoutParams(150, LayoutParams.WRAP_CONTENT));
    const lines = tv.getLayout()!.layoutLines.map((l) => l.runs.map((r) => r.text).join(''));
    expect(lines.some((l) => l.endsWith('-'))).toBe(true);
    expect(lines.every((l) => !l.includes('…'))).toBe(true);
  });
});

describe('spans', () => {
  it('draws colored, bold, sized and highlighted ranges', () => {
    const text = new SpannableString('Hello World');
    text.setSpan(new ForegroundColorSpan(Color.RED), 6, 11, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
    text.setSpan(new StyleSpan(Typeface.BOLD), 0, 5, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
    text.setSpan(new RelativeSizeSpan(2), 6, 11, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
    text.setSpan(new BackgroundColorSpan(Color.YELLOW), 0, 5, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
    const { device, tv } = textScreen((t) => {
      t.setText(text);
      t.setTextColor(Color.BLACK);
      t.setTextSize(20);
    });
    const layout = tv.getLayout()!;
    const world = layout.getPrimaryHorizontal(6);
    expect(world).toBeGreaterThan(40);
    const png = image(device);
    const red = count(png, world, 0, tv.getWidth(), tv.getHeight(), ([r, g, b]) => r > 200 && g < 80 && b < 80);
    expect(red).toBeGreaterThan(40);
    const yellow = count(png, 0, 0, world - 4, tv.getHeight(), ([r, g, b]) => r > 240 && g > 240 && b < 40);
    expect(yellow).toBeGreaterThan(40);
    // the bigger span makes the line taller than plain 20sp text
    expect(tv.getHeight()).toBeGreaterThan(40);
    const runs = layout.layoutLines[0]!.runs;
    expect(runs.find((r) => r.text.startsWith('Hello'))!.style.font).toMatch(/^700 /);
  });

  it('keeps spans across SpannableStringBuilder edits by their flags', () => {
    const b = new SpannableStringBuilder('abc');
    const exclusive = new UnderlineSpan();
    const inclusive = new ForegroundColorSpan(Color.RED);
    b.setSpan(exclusive, 0, 3, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
    b.setSpan(inclusive, 0, 3, Spanned.SPAN_INCLUSIVE_INCLUSIVE);
    b.insert(0, 'X');
    expect([b.getSpanStart(exclusive), b.getSpanEnd(exclusive)]).toEqual([1, 4]);
    expect([b.getSpanStart(inclusive), b.getSpanEnd(inclusive)]).toEqual([0, 4]);
    b.append('YZ');
    expect(b.getSpanEnd(exclusive)).toBe(4);
    expect(b.getSpanEnd(inclusive)).toBe(6);
    b.delete(1, 4);
    expect(b.getSpanStart(exclusive)).toBe(-1); // emptied exclusive span is removed
    expect(b.toString()).toBe('XYZ');
    const appended = new SpannableStringBuilder().append('bold', new StyleSpan(Typeface.BOLD), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE).append(' plain');
    expect(appended.getSpans(0, appended.length(), StyleSpan)).toHaveLength(1);
    expect(appended.getSpans(5, 10, StyleSpan)).toHaveLength(0);
    const sized = new AbsoluteSizeSpan(30, true);
    const paint = new TextPaint();
    sized.updateDrawState(paint);
    expect(paint.getTextSize()).toBe(30);
  });

  it('calls a ClickableSpan tapped through LinkMovementMethod and opens URLSpans on the host', () => {
    const text = new SpannableString('Read the terms and the privacy policy.');
    let clicked = 0;
    const start = text.toString().indexOf('terms');
    text.setSpan(new (class extends ClickableSpan {
      onClick(): void {
        clicked++;
      }
    })(), start, start + 5, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
    const p = text.toString().indexOf('privacy');
    text.setSpan(new URLSpan('https://example.com/privacy'), p, p + 14, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
    const { device, tv } = textScreen((t) => {
      t.setText(text);
      t.setTextSize(18);
      t.setMovementMethod(LinkMovementMethod.getInstance());
    });
    const layout = tv.getLayout()!;
    const baselineY = layout.getLineBaseline(0) - 5;
    device.tap(layout.getPrimaryHorizontal(start + 2), baselineY);
    expect(clicked).toBe(1);
    device.tap(layout.getPrimaryHorizontal(1), baselineY);
    expect(clicked).toBe(1);
    device.tap(layout.getPrimaryHorizontal(p + 3), baselineY);
    expect(device.messages.some((m) => m.type === 'openURL' && m.url === 'https://example.com/privacy')).toBe(true);
  });
});

describe('StaticLayout and TextUtils', () => {
  it('reports line offsets, widths and positions', () => {
    launch((ctx) => new FrameLayout(ctx));
    const paint = new TextPaint();
    paint.setTextSize(16);
    const text = 'alpha beta gamma delta epsilon';
    const layout = StaticLayout.Builder.obtain(text, 0, text.length, paint, 100).setIncludePad(false).build();
    expect(layout.getLineCount()).toBeGreaterThan(1);
    for (let i = 0; i < layout.getLineCount(); i++) expect(layout.getLineWidth(i)).toBeLessThanOrEqual(100);
    expect(layout.getLineStart(0)).toBe(0);
    expect(layout.getLineStart(1)).toBe(layout.getLineEnd(0));
    expect(layout.getLineEnd(layout.getLineCount() - 1)).toBe(text.length);
    expect(text.slice(layout.getLineStart(0), layout.getLineVisibleEnd(0))).toMatch(/^alpha( beta)?$/);
    expect(layout.getLineForOffset(text.indexOf('epsilon'))).toBe(layout.getLineCount() - 1);
    const x = layout.getPrimaryHorizontal(2);
    expect(layout.getOffsetForHorizontal(0, x)).toBe(2);
    expect(layout.getHeight()).toBeCloseTo(layout.getLineCount() * (layout.getLineBottom(0) - layout.getLineTop(0)), 5);
    expect(Layout.getDesiredWidth('alpha beta', paint)).toBeGreaterThan(Layout.getDesiredWidth('alpha', paint));
  });

  it('centers lines with ALIGN_CENTER and balances them on request', () => {
    launch((ctx) => new FrameLayout(ctx));
    const paint = new TextPaint();
    paint.setTextSize(16);
    const text = 'one two three four five six seven eight nine';
    const greedy = new StaticLayout(text, paint, 260);
    const balanced = StaticLayout.Builder.obtain(text, 0, text.length, paint, 260).setBreakStrategy(Layout.BREAK_STRATEGY_BALANCED).build();
    expect(balanced.getLineCount()).toBe(greedy.getLineCount());
    const spread = (l: StaticLayout) => Math.abs(l.getLineWidth(0) - l.getLineWidth(l.getLineCount() - 1));
    expect(spread(balanced)).toBeLessThan(spread(greedy));
    const centered = StaticLayout.Builder.obtain('hi', 0, 2, paint, 200).setAlignment(Layout.Alignment.ALIGN_CENTER).build();
    expect(centered.getLineLeft(0)).toBeCloseTo((200 - centered.getLineWidth(0)) / 2);
  });

  it('ellipsizes plain text at the start, middle or end', () => {
    launch((ctx) => new FrameLayout(ctx));
    const paint = new TextPaint();
    paint.setTextSize(14);
    const s = 'abcdefghijklmnopqrstuvwxyz';
    const end = TextUtils.ellipsize(s, paint, 80, TruncateAt.END);
    const start = TextUtils.ellipsize(s, paint, 80, TruncateAt.START);
    const middle = TextUtils.ellipsize(s, paint, 80, TruncateAt.MIDDLE);
    expect(end.endsWith('…') && end.startsWith('abc')).toBe(true);
    expect(start.startsWith('…') && start.endsWith('xyz')).toBe(true);
    expect(middle.startsWith('a') && middle.endsWith('z') && middle.includes('…')).toBe(true);
    expect(paint.measureText(end)).toBeLessThanOrEqual(80);
    expect(TextUtils.ellipsize('short', paint, 200, TruncateAt.END)).toBe('short');
    expect(TextUtils.isEmpty('')).toBe(true);
    expect(TextUtils.isEmpty(null)).toBe(true);
    expect(TextUtils.isEmpty(new SpannableString('x'))).toBe(false);
  });
});
