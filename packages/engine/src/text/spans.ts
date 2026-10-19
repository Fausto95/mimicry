import type { Appearance } from '@mimicry/protocol';
import type { PlatformKit } from '../platform/kit';
import { normalizeWeight } from '../platform/kit';
import { parseColor, type ColorContext } from '../style/color';
import type { FlatStyle } from '../style/flatten';
import type { HostNode } from '../tree/node';
import type { Span, TextStyle } from './text-layout';

export interface TextEnvironment {
  kit: PlatformKit;
  appearance: Appearance;
  colors: ColorContext;
  fontScale: number;
  bundledFonts: boolean;
}

/** Text props that nested <Text> inherits from its parent <Text>. */
const INHERITED = [
  'color', 'fontSize', 'fontWeight', 'fontStyle', 'fontFamily', 'letterSpacing', 'lineHeight',
  'textDecorationLine', 'textDecorationColor', 'textTransform', 'textShadowColor', 'textShadowOffset',
  'textShadowRadius', 'fontVariant', 'textAlign', 'writingDirection',
] as const;

export function inheritTextStyle(parent: FlatStyle, own: FlatStyle): FlatStyle {
  const out: FlatStyle = {};
  for (const key of INHERITED) if (parent[key] !== undefined) out[key] = parent[key];
  return { ...out, ...own };
}

export function resolveTextStyle(style: FlatStyle, env: TextEnvironment, source: unknown, allowFontScaling = true, maxMultiplier?: number): TextStyle {
  const { kit } = env;
  let scale = allowFontScaling ? env.fontScale : 1;
  if (maxMultiplier && maxMultiplier >= 1) scale = Math.min(scale, maxMultiplier);
  const size = (typeof style.fontSize === 'number' ? style.fontSize : kit.text.fontSize) * scale;
  const family = typeof style.fontFamily === 'string' ? style.fontFamily : undefined;
  const weight = style.fontWeight != null ? normalizeWeight(style.fontWeight) : kit.fontWeightFor(family) ?? '400';
  const italic = style.fontStyle === 'italic';
  const font = `${italic ? 'italic ' : ''}${weight} ${round(size)}px ${kit.fontStack(family, env.bundledFonts)}`;
  const decorationLine = String(style.textDecorationLine ?? 'none');
  const color = parseColor(style.color, env.colors) ?? kit.text.color(env.appearance);
  const shadowColor = parseColor(style.textShadowColor, env.colors);
  const offset = style.textShadowOffset ?? { width: 0, height: 0 };
  const standIn = env.bundledFonts && (!family || family === 'System' || family === 'system-ui') ? kit.standIn?.(size, Number(weight) || 400) : undefined;
  const letterSpacing = (typeof style.letterSpacing === 'number' ? style.letterSpacing : 0) + (standIn ? round(standIn.tracking * size) : 0);
  return {
    font,
    size,
    color,
    letterSpacing,
    lineHeight: typeof style.lineHeight === 'number' ? style.lineHeight * scale : null,
    decoration: (decorationLine.includes('underline') ? 1 : 0) | (decorationLine.includes('line-through') ? 2 : 0),
    decorationColor: parseColor(style.textDecorationColor, env.colors),
    background: parseColor(style.backgroundColor, env.colors) ?? 0,
    shadow: shadowColor
      ? { color: shadowColor, dx: offset.width ?? 0, dy: offset.height ?? 0, blur: style.textShadowRadius ?? 0 }
      : null,
    transform: style.textTransform ?? 'none',
    source,
    metrics: standIn ? { ascent: standIn.ascent * size, descent: standIn.descent * size } : null,
  };
}

const round = (n: number) => Math.round(n * 100) / 100;

/**
 * Flattens a <Text> subtree into attributed spans. The top-level text's own
 * backgroundColor paints its box, so it is not a span highlight.
 */
export function collectSpans(textNode: HostNode, env: TextEnvironment): Span[] {
  const spans: Span[] = [];
  const allowScaling = textNode.props.allowFontScaling !== false;
  const maxMultiplier = textNode.props.maxFontSizeMultiplier;
  const rootStyle = { ...textNode.computed, backgroundColor: undefined };
  const visit = (node: HostNode, inherited: FlatStyle, style: TextStyle) => {
    for (const child of node.children) {
      if (child.hidden) continue;
      if (child.kind === 'raw-text') {
        if (child.text) spans.push({ text: child.text, style });
      } else if (child.kind === 'virtual-text') {
        const merged = inheritTextStyle(inherited, child.computed);
        visit(child, merged, resolveTextStyle(merged, env, child, allowScaling, maxMultiplier));
      }
      // inline views inside <Text> are not supported yet (see docs/fidelity.md)
    }
  };
  visit(textNode, rootStyle, resolveTextStyle(rootStyle, env, textNode, allowScaling, maxMultiplier));
  return spans;
}
