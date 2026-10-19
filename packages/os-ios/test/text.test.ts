import { describe, expect, it } from 'vitest';
import {
  CGRectMake, NSAttributedString, NSAttributedStringKey, NSLineBreakMode, NSMakeRange, NSMutableAttributedString, NSMutableParagraphStyle,
  NSShadow, NSStringDrawingOptions, NSTextAlignment, NSUnderlineStyle, UIColor, UIFont, UIFontDescriptorSymbolicTraits, UIFontMetrics,
  UIFontTextStyle, UIFontWeight, UILabel, UIView, type CGContext, type CGRect,
} from '@mimicry/os-ios';
import { boot, decode, pixelAt, saveArtifact } from './helpers';

const ink = (img: ReturnType<typeof decode>, x0: number, y0: number, x1: number, y1: number, scale = 3) => {
  // device-pixel box of non-white pixels inside a point rect
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let y = Math.round(y0 * scale); y < Math.round(y1 * scale); y++) {
    for (let x = Math.round(x0 * scale); x < Math.round(x1 * scale); x++) {
      const [r, g, b] = pixelAt(img, x, y);
      if (r < 200 || g < 200 || b < 200) {
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    }
  }
  return { minX: minX / scale, maxX: maxX / scale, minY: minY / scale, maxY: maxY / scale };
};

describe('UIFont', () => {
  it('reports SF Pro metrics for the system font', () => {
    boot();
    const font = UIFont.systemFont(17);
    expect(font.pointSize).toBe(17);
    expect(font.lineHeight).toBeCloseTo(20.28, 1);
    expect(font.ascender).toBeCloseTo(16.18, 1);
    expect(font.descender).toBeCloseTo(-4.1, 1);
    expect(font.capHeight).toBeCloseTo(11.99, 1);
    expect(font.familyName).toBe('.AppleSystemUIFont');
    expect(UIFont.boldSystemFont(17).weight).toBe(700);
    expect(UIFont.systemFont(17, UIFontWeight.semibold).weight).toBe(600);
    expect(UIFont.italicSystemFont(12).isItalic).toBe(true);
  });

  it('has the Dynamic Type sizes for the content size category', () => {
    boot();
    expect(UIFont.preferredFont(UIFontTextStyle.body).pointSize).toBe(17);
    expect(UIFont.preferredFont(UIFontTextStyle.largeTitle).pointSize).toBe(34);
    expect(UIFont.preferredFont(UIFontTextStyle.headline).weight).toBe(600);
    expect(UIFont.preferredFont(UIFontTextStyle.caption2).pointSize).toBe(11);
    boot({ fontScale: 1.35 });
    expect(UIFont.preferredFont(UIFontTextStyle.body).pointSize).toBe(23);
    expect(UIFontMetrics.default.scaledValue(10)).toBeCloseTo(10 * 23 / 17, 5);
    expect(new UIFontMetrics(UIFontTextStyle.footnote).scaledFont(UIFont.systemFont(13)).pointSize).toBe(19);
  });

  it('finds installed fonts by family and PostScript name', () => {
    boot();
    expect(UIFont.named('Helvetica', 14)?.familyName).toBe('Helvetica');
    expect(UIFont.named('Helvetica-Bold', 14)?.weight).toBe(700);
    expect(UIFont.named('Georgia-Italic', 14)?.isItalic).toBe(true);
    expect(UIFont.named('NoSuchFont', 14)).toBeNull();
    const bold = UIFont.fromDescriptor(UIFont.systemFont(15).fontDescriptor.withSymbolicTraits(UIFontDescriptorSymbolicTraits.traitBold)!, 0);
    expect(bold.weight).toBe(700);
    expect(bold.pointSize).toBe(15);
  });
});

describe('NSAttributedString', () => {
  it('keeps attribute runs through edits', () => {
    const s = new NSMutableAttributedString('Hello world', { [NSAttributedStringKey.kern]: 1 });
    s.addAttribute(NSAttributedStringKey.foregroundColor, UIColor.red, NSMakeRange(6, 5));
    expect(s.attributeRuns.length).toBe(2);
    const range = { current: NSMakeRange(0, 0) };
    expect(s.attribute(NSAttributedStringKey.foregroundColor, 7, range)).toBe(UIColor.red);
    expect(range.current).toEqual(NSMakeRange(6, 5));
    s.replaceCharacters(NSMakeRange(0, 5), 'Goodbye');
    expect(s.string).toBe('Goodbye world');
    expect(s.attribute(NSAttributedStringKey.kern, 0)).toBe(1);
    s.append(new NSAttributedString('!', { [NSAttributedStringKey.underlineStyle]: NSUnderlineStyle.single }));
    expect(s.length).toBe(14);
    expect(s.attributedSubstring(NSMakeRange(8, 6)).string).toBe('world!');
    s.removeAttribute(NSAttributedStringKey.foregroundColor, NSMakeRange(0, s.length));
    const values: unknown[] = [];
    s.enumerateAttribute(NSAttributedStringKey.kern, NSMakeRange(0, s.length), 0, (v) => values.push(v));
    expect(values).toEqual([1, null]);
    expect(s.copy().isEqual(s)).toBe(true);
  });

  it('measures with boundingRect', () => {
    boot();
    const font = UIFont.systemFont(17);
    const s = new NSAttributedString('The quick brown fox jumps over the lazy dog', { [NSAttributedStringKey.font]: font });
    const one = s.boundingRect({ width: Infinity, height: Infinity }, NSStringDrawingOptions.usesLineFragmentOrigin, null);
    expect(one.size.height).toBeCloseTo(font.lineHeight, 3);
    expect(one.size.width).toBeGreaterThan(250);
    const wrapped = s.boundingRect({ width: 150, height: Infinity }, NSStringDrawingOptions.usesLineFragmentOrigin, null);
    expect(wrapped.size.height).toBeCloseTo(font.lineHeight * 3, 2);
    expect(wrapped.size.width).toBeLessThanOrEqual(150);
    const baselineOrigin = s.boundingRect({ width: 150, height: Infinity }, 0, null);
    expect(baselineOrigin.origin.y).toBeCloseTo(-font.ascender, 3);
    const p = new NSMutableParagraphStyle();
    p.lineSpacing = 10;
    p.paragraphSpacing = 20;
    const spaced = new NSAttributedString('one\ntwo', { [NSAttributedStringKey.font]: font, [NSAttributedStringKey.paragraphStyle]: p });
    expect(spaced.size().height).toBeCloseTo(font.lineHeight * 2 + 30, 2);
  });

  it('draws into the current graphics context in draw(_:)', () => {
    const { device, root } = boot();
    class Canvas extends UIView {
      override draw(_ctx: CGContext, rect: CGRect): void {
        new NSAttributedString('Drawn', { [NSAttributedStringKey.font]: UIFont.boldSystemFont(40), [NSAttributedStringKey.foregroundColor]: UIColor.systemBlue }).drawIn(rect);
      }
    }
    root.view.addSubview(new Canvas(CGRectMake(20, 200, 300, 60)));
    device.advance(17);
    const box = ink(decode(device.screenshot()), 20, 200, 320, 260);
    expect(box.minX).toBeLessThan(26);
    expect(box.maxX).toBeGreaterThan(100);
  });
});

describe('UILabel', () => {
  function label(text: string, frame = CGRectMake(20, 100, 200, 60)) {
    const env = boot();
    const l = new UILabel(frame);
    l.text = text;
    env.root.view.addSubview(l);
    env.device.advance(17);
    return { ...env, label: l };
  }

  it('sizes to its text like UIKit (one line, pixel-ceiled)', () => {
    const { label: l } = label('Hello');
    const size = l.intrinsicContentSize;
    expect(size.height).toBeCloseTo(20.333, 2);
    expect(size.width).toBeGreaterThan(30);
    expect(size.width).toBeLessThan(50);
    expect(l.isUserInteractionEnabled).toBe(false);
  });

  it('truncates the tail of a single line', () => {
    const { label: l } = label('The quick brown fox jumps over the lazy dog');
    expect(l.layoutLines.length).toBe(1);
    expect(l.layoutLines[0]!.text.endsWith('…')).toBe(true);
    expect(l.isTruncated).toBe(true);
  });

  it('truncates head and middle', () => {
    const { label: l } = label('The quick brown fox jumps over the lazy dog');
    l.lineBreakMode = NSLineBreakMode.byTruncatingHead;
    expect(l.layoutLines[0]!.text.startsWith('…')).toBe(true);
    expect(l.layoutLines[0]!.text.endsWith('dog')).toBe(true);
    l.lineBreakMode = NSLineBreakMode.byTruncatingMiddle;
    const text = l.layoutLines[0]!.text;
    expect(text.startsWith('The')).toBe(true);
    expect(text.endsWith('dog')).toBe(true);
    expect(text).toContain('…');
  });

  it('wraps to numberOfLines and to what fits the height', () => {
    const { label: l } = label('The quick brown fox jumps over the lazy dog and keeps running far away', CGRectMake(20, 100, 150, 200));
    l.numberOfLines = 2;
    expect(l.layoutLines.length).toBe(2);
    expect(l.layoutLines[1]!.text.endsWith('…')).toBe(true);
    l.numberOfLines = 0;
    expect(l.layoutLines.length).toBeGreaterThan(3);
    l.frame = CGRectMake(20, 100, 150, 45);
    expect(l.layoutLines.length).toBe(2);
    expect(l.layoutLines[1]!.text.endsWith('…')).toBe(true);
    expect(l.sizeThatFits({ width: 150, height: 0 }).height).toBeGreaterThan(60);
  });

  it('wraps by character', () => {
    const { label: l } = label('Supercalifragilistic expialidocious', CGRectMake(20, 100, 100, 200));
    l.numberOfLines = 0;
    l.lineBreakMode = NSLineBreakMode.byCharWrapping;
    const lines = l.layoutLines.map((x) => x.text);
    expect(lines.length).toBeGreaterThan(2);
    expect(lines.join('').replace(/\s/g, '')).toBe('Supercalifragilisticexpialidocious');
  });

  it('shrinks to fit the width', () => {
    const { label: l } = label('The quick brown fox jumps over');
    l.adjustsFontSizeToFitWidth = true;
    l.minimumScaleFactor = 0.5;
    expect(l.isTruncated).toBe(false);
    expect(l.layoutLines[0]!.width).toBeLessThanOrEqual(200.01);
    expect(l.layoutLines[0]!.text).toBe('The quick brown fox jumps over');
  });

  it('centers text vertically and aligns it horizontally', () => {
    const { device, label: l } = label('Centered', CGRectMake(20, 100, 300, 100));
    l.textAlignment = NSTextAlignment.center;
    l.font = UIFont.boldSystemFont(30);
    device.advance(17);
    const box = ink(decode(device.screenshot()), 20, 100, 320, 200);
    const cx = (box.minX + box.maxX) / 2;
    const cy = (box.minY + box.maxY) / 2;
    expect(Math.abs(cx - 170)).toBeLessThan(3);
    // cap-height text sits slightly above the line box center (descender space below)
    expect(Math.abs(cy - 150)).toBeLessThan(5);
    l.textAlignment = NSTextAlignment.right;
    device.advance(17);
    expect(ink(decode(device.screenshot()), 20, 100, 320, 200).maxX).toBeGreaterThan(316);
  });

  it('draws colors, highlight and disabled state', () => {
    const { device, label: l } = label('█████', CGRectMake(20, 100, 200, 40));
    l.textColor = UIColor.systemRed;
    l.font = UIFont.systemFont(30);
    device.advance(17);
    const img = () => decode(device.screenshot());
    const box = ink(img(), 20, 100, 220, 140);
    const at = () => pixelAt(img(), ((box.minX + box.maxX) / 2) * 3, ((box.minY + box.maxY) / 2) * 3);
    expect(at()).toEqual([255, 59, 48]);
    l.highlightedTextColor = UIColor.systemBlue;
    l.isHighlighted = true;
    device.advance(17);
    expect(at()).toEqual([0, 122, 255]);
    l.isHighlighted = false;
    l.isEnabled = false;
    device.advance(17);
    // tertiaryLabel: a light gray
    expect(at()).toEqual([196, 196, 198]);
  });

  it('applies paragraph styles, kern and shadows from attributedText', () => {
    const { label: l } = label('');
    l.numberOfLines = 0;
    l.frame = CGRectMake(20, 100, 300, 300);
    const p = new NSMutableParagraphStyle();
    p.lineHeightMultiple = 1.5;
    p.firstLineHeadIndent = 20;
    const shadow = new NSShadow();
    shadow.shadowColor = UIColor.black;
    shadow.shadowBlurRadius = 2;
    l.attributedText = new NSAttributedString('one two three four five six seven eight nine ten eleven twelve', {
      [NSAttributedStringKey.paragraphStyle]: p,
      [NSAttributedStringKey.kern]: 2,
      [NSAttributedStringKey.shadow]: shadow,
    });
    const lines = l.layoutLines;
    expect(lines[0]!.x).toBe(20);
    expect(lines[1]!.x).toBe(0);
    expect(lines[0]!.height).toBeCloseTo(UIFont.systemFont(17).lineHeight * 1.5, 2);
    expect(l.attributedText!.attribute(NSAttributedStringKey.font, 0)).toBe(l.font);
  });

  it('renders a gallery of labels', () => {
    const { device, root } = boot();
    root.view.backgroundColor = UIColor.systemGroupedBackground;
    const add = (y: number, configure: (l: UILabel) => void) => {
      const l = new UILabel(CGRectMake(20, y, 362, 40));
      configure(l);
      root.view.addSubview(l);
      return l;
    };
    add(70, (l) => {
      l.text = 'Large Title';
      l.font = UIFont.systemFont(34, UIFontWeight.bold);
    });
    add(120, (l) => {
      l.text = 'Headline — semibold 17';
      l.font = UIFont.preferredFont(UIFontTextStyle.headline);
    });
    add(160, (l) => {
      l.text = 'Body text that is far too long to fit on a single line of this label';
    });
    add(200, (l) => {
      l.text = 'Secondary footnote';
      l.font = UIFont.preferredFont(UIFontTextStyle.footnote);
      l.textColor = UIColor.secondaryLabel;
    });
    add(240, (l) => {
      const s = new NSMutableAttributedString('Bold, red, underlined, struck and linked');
      s.addAttribute(NSAttributedStringKey.font, UIFont.boldSystemFont(17), NSMakeRange(0, 4));
      s.addAttribute(NSAttributedStringKey.foregroundColor, UIColor.systemRed, NSMakeRange(6, 3));
      s.addAttribute(NSAttributedStringKey.underlineStyle, NSUnderlineStyle.single, NSMakeRange(11, 10));
      s.addAttribute(NSAttributedStringKey.strikethroughStyle, NSUnderlineStyle.single, NSMakeRange(23, 6));
      s.addAttribute(NSAttributedStringKey.link, 'https://apple.com', NSMakeRange(34, 6));
      l.attributedText = s;
    });
    add(290, (l) => {
      l.frame = CGRectMake(20, 290, 362, 110);
      l.numberOfLines = 0;
      const p = new NSMutableParagraphStyle();
      p.alignment = NSTextAlignment.justified;
      p.lineSpacing = 4;
      l.attributedText = new NSAttributedString('Justified paragraph text spreads every line but the last across the full width of the label, the way TextKit does.', {
        [NSAttributedStringKey.paragraphStyle]: p,
      });
    });
    add(410, (l) => {
      l.text = 'Centered in systemBlue';
      l.textAlignment = NSTextAlignment.center;
      l.textColor = UIColor.systemBlue;
    });
    saveArtifact('labels.png', device.advance(17).screenshot());
  });
});
