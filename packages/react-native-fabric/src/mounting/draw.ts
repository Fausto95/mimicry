import { NO_RADII, OverlayKind, alphaOf, rgba, withAlpha, type CommandWriter, type Radii } from '@mimicry/protocol';
import {
  blockOffset, drawBackground, drawBorders, drawShadows, fitImage, hasRadii, inflate, intersect, lineOffset, parseColor,
  resolveBorders, resolveRadii, resolveShadows, shadowExtent, transformRect, verticalAlignOf, writePath,
  type BoxGeometry, type LayerContext, type Rect, type TextLayout, type VerticalAlign,
} from '@mimicry/os-core';
import type { Engine } from '../engine';
import { textVerticalAlign } from '../layout/layout';
import { paintSvg } from '../svg/paint';
import type { HostNode } from '../tree/node';
import { windowMatrix } from '../geometry';

/**
 * How React Native's host components draw, shared by the iOS component views
 * (RCTViewComponentView & co.) and the Android ones (ReactViewGroup & co.):
 * the box (shadows, backdrop material, background, borders), then what the
 * component kind draws (text, image, text input, path, SVG). Children are
 * sublayers the render server visits between `drawNodeContent` and
 * `drawNodeOverlay`.
 */
export function drawNodeContent(node: HostNode, ctx: LayerContext): void {
  const engine = node.engine;
  const style = node.computed;
  const colors = engine.colorContext;
  const ox = ctx.x;
  const oy = ctx.y;
  const radii = resolveRadii(style, node.w, node.h);
  const box: BoxGeometry = { x: ox, y: oy, w: node.w, h: node.h, radii };
  const shadows = resolveShadows(style, engine.kit.platform, colors);
  const borders = resolveBorders(style, colors, rgba(0, 0, 0, 1));
  const bordersOnTop = borders && engine.kit.borderAboveChildren;

  const backdrop = backdropOf(node);
  if (backdrop) {
    // Shadows sit behind the material; then the blur of everything beneath; then the tint (background).
    const outset = shadows.filter((s) => !s.inset);
    if (outset.length) ctx.item(inflate(box, shadowExtent(outset) + 1), (w) => drawShadows(w, box, outset, false));
    const visible = ctx.visible(box);
    if (visible) {
      const whole = visible.w === box.w && visible.h === box.h;
      ctx.backdrop(visible, whole ? radii : NO_RADII, backdrop.blur, backdrop.saturation);
    }
  }

  const decorated = (backdrop ? shadows.some((s) => s.inset) : shadows.length) || style.backgroundColor != null || style.experimental_backgroundImage || style.backgroundImage || (borders && !bordersOnTop);
  if (decorated) {
    const extent = shadowExtent(shadows);
    ctx.item(inflate(box, extent + 1), (w) => {
      if (!backdrop) drawShadows(w, box, shadows, false);
      drawBackground(w, box, style, colors);
      drawShadows(w, box, shadows, true);
      if (borders && !bordersOnTop) drawBorders(w, box, borders);
    });
  }

  node.hostView?.drawRipple?.(ctx, box, false);

  switch (node.kind) {
    case 'text':
      drawText(node, ctx);
      break;
    case 'image':
      drawImage(node, box, ctx);
      break;
    case 'input':
      drawInput(node, box, ctx);
      break;
    case 'path':
      drawPath(node, box, ctx);
      break;
    case 'svg':
      // The viewport clips its content, so the box bounds the whole drawing.
      ctx.item(box, (w) => paintSvg(w, node, box, engine));
      break;
  }
}

/** What draws above the children: foreground ripples and (iOS) uniform borders. */
export function drawNodeOverlay(node: HostNode, ctx: LayerContext): void {
  const engine = node.engine;
  const style = node.computed;
  const ripple = node.hostView?.drawRipple;
  if (!ripple && !engine.kit.borderAboveChildren) return;
  const radii = resolveRadii(style, node.w, node.h);
  const box: BoxGeometry = { x: ctx.x, y: ctx.y, w: node.w, h: node.h, radii };
  node.hostView?.drawRipple?.(ctx, box, true);
  if (engine.kit.borderAboveChildren) {
    const borders = resolveBorders(style, engine.colorContext, rgba(0, 0, 0, 1));
    if (borders) ctx.item(inflate(box, 1), (w) => drawBorders(w, box, borders));
  }
}

/**
 * The `backdrop` host prop: `{ blur, saturation? }` blurs (and saturates)
 * whatever is painted beneath the view, inside its border radius. Native
 * views (BlurView, GlassView, glass bars) set it; tints are its backgroundColor.
 */
export interface BackdropProp {
  blur: number;
  saturation: number;
}

function backdropOf(node: HostNode): BackdropProp | null {
  const b = node.props.backdrop as { blur?: number; saturation?: number } | null | undefined;
  if (!b || typeof b !== 'object') return null;
  const blur = Math.max(0, Number(b.blur ?? 0));
  const saturation = Math.max(0, Number(b.saturation ?? 1));
  if (blur === 0 && saturation === 1) return null;
  return { blur, saturation };
}

function contentBox(node: HostNode, ox: number, oy: number): Rect {
  const i = node.insets;
  return { x: ox + i.left, y: oy + i.top, w: Math.max(0, node.w - i.left - i.right), h: Math.max(0, node.h - i.top - i.bottom) };
}

function drawText(node: HostNode, ctx: LayerContext): void {
  const engine = node.engine;
  const content = contentBox(node, ctx.x, ctx.y);
  const layout = engine.textLayoutFor(node, content.w);
  if (!layout.lines.length) return;
  const align = String(node.computed.textAlign ?? 'auto');
  const block = { ...content, y: content.y + blockOffset(textVerticalAlign(engine, node), content.h, layout) };
  const bounds = inflate({ x: block.x, y: block.y, w: Math.max(content.w, layout.width), h: Math.max(content.h, layout.height) }, 4);
  ctx.item(bounds, (w) => drawTextLines(w, layout.lines, block, align));
}

export function drawTextLines(w: CommandWriter, lines: TextLayout['lines'], content: Rect, align: string): void {
  let font = '';
  for (const line of lines) {
    const lx = content.x + lineOffset(align, content.w, line);
    const top = content.y + line.y;
    for (const run of line.runs) {
      if (run.style.background && !run.attachment) w.fillRect(lx + run.x, top, run.width, line.height, run.style.background);
    }
    for (const run of line.runs) {
      if (run.attachment) continue;
      const s = run.style;
      if (s.font !== font) {
        w.font(s.font);
        font = s.font;
      }
      if (s.shadow) w.shadow(s.shadow.color, s.shadow.blur * 2, s.shadow.dx, s.shadow.dy);
      w.text(lx + run.x, content.y + line.baseline, s.color, s.letterSpacing, run.text);
      if (s.shadow) w.shadowClear();
      if (s.decoration) {
        const thickness = Math.max(1, s.size / 15);
        const color = s.decorationColor ?? s.color;
        if (s.decoration & 1) w.fillRect(lx + run.x, content.y + line.baseline + s.size * 0.12, run.width, thickness, color);
        if (s.decoration & 2) w.fillRect(lx + run.x, content.y + line.baseline - s.size * 0.3, run.width, thickness, color);
      }
    }
  }
}

/** Normalize an Image `source` prop to one `{ uri }`. */
export function resolveSource(source: unknown): { uri: string; width?: number; height?: number } | null {
  if (!source) return null;
  if (typeof source === 'string') return { uri: source };
  if (Array.isArray(source)) return resolveSource(source[0]);
  if (typeof source === 'object' && typeof (source as { uri?: unknown }).uri === 'string') return source as { uri: string };
  return null;
}

function drawImage(node: HostNode, box: BoxGeometry, ctx: LayerContext): void {
  const engine = node.engine;
  const source = resolveSource(node.props.source) ?? resolveSource(node.props.defaultSource);
  if (!source) return;
  const image = engine.images.get(source.uri, node.imageConsumer);
  if (!image || image.state !== 'loaded') {
    const fallback = resolveSource(node.props.defaultSource);
    if (!fallback || fallback.uri === source.uri) return;
  }
  const loaded = image?.state === 'loaded' ? image : null;
  if (!loaded) return;
  const style = node.computed;
  const mode = String(style.resizeMode ?? node.props.resizeMode ?? objectFitToMode(style.objectFit) ?? 'cover');
  const content = contentBox(node, box.x, box.y);
  const tint = parseColor(style.tintColor ?? node.props.tintColor, engine.colorContext) ?? 0;
  const iw = loaded.width;
  const ih = loaded.height;
  ctx.item(box, (w) => {
    w.save();
    if (hasRadii(box.radii)) w.clipRRect(box.x, box.y, box.w, box.h, box.radii);
    else w.clipRect(box.x, box.y, box.w, box.h);
    if (mode === 'repeat') {
      for (let y = content.y; y < content.y + content.h; y += ih) {
        for (let x = content.x; x < content.x + content.w; x += iw) {
          w.image(x, y, iw, ih, 0, 0, iw, ih, tint, source.uri);
        }
      }
    } else {
      const r = fitImage(mode, iw, ih, content);
      w.image(r.dx, r.dy, r.dw, r.dh, r.sx, r.sy, r.sw, r.sh, tint, source.uri);
    }
    w.restore();
  });
}

function objectFitToMode(fit: unknown): string | undefined {
  if (fit === 'fill') return 'stretch';
  if (fit === 'scale-down') return 'center';
  return typeof fit === 'string' ? fit : undefined;
}

function drawInput(node: HostNode, box: BoxGeometry, ctx: LayerContext): void {
  const engine = node.engine;
  const kit = engine.kit;
  const appearance = engine.env.appearance;
  const props = node.props;
  const content = contentBox(node, box.x, box.y);
  const focused = engine.focus.focused === node;
  const hostDrawsText = focused && engine.hostInputs;

  if (kit.text.inputUnderline && props.underlineColorAndroid !== 'transparent') {
    const underline = parseColor(props.underlineColorAndroid, engine.colorContext)
      ?? (focused ? kit.semanticColor('?attr/colorAccent', appearance)! : kit.semanticColor('?attr/colorControlNormal', appearance)!);
    const y = box.y + box.h - 8;
    ctx.item({ x: box.x, y: y - 1, w: box.w, h: 4 }, (w) => w.fillRect(box.x + 4, y, box.w - 8, focused ? 2 : 1, underline));
  }

  const value = engine.behaviors.inputValue(node);
  const style = engine.inputTextStyle(node);
  // While focused in a browser, the host's native input draws text, caret and selection.
  if (!hostDrawsText) {
    const showPlaceholder = !value;
    const text = showPlaceholder ? String(props.placeholder ?? '') : props.secureTextEntry ? '•'.repeat(Array.from(value).length) : value;
    if (text) {
      const color = showPlaceholder
        ? parseColor(props.placeholderTextColor, engine.colorContext) ?? kit.text.placeholderColor(appearance)
        : style.color;
      const layout = engine.inputLayout(node, text, content.w);
      const lineStyle = { ...style, color };
      const lines = layout.lines.map((l) => ({ ...l, runs: l.runs.map((r) => ({ ...r, style: lineStyle })) }));
      const top = content.y + blockOffset(inputVerticalAlign(engine, node), content.h, layout);
      ctx.item(box, (w) => {
        w.save();
        w.clipRect(content.x, content.y, content.w, content.h);
        drawTextLines(w, lines, { ...content, y: top }, String(node.computed.textAlign ?? 'left'));
        w.restore();
      });
    }
    if (focused && !props.caretHidden) {
      // Headless hosts have no native input: draw the caret after the text.
      const layout = engine.inputLayout(node, value, content.w);
      const last = layout.lines[layout.lines.length - 1];
      const caretX = content.x + (value ? last?.width ?? 0 : 0);
      const lineH = last?.height ?? style.size * 1.2;
      const caretY = content.y + blockOffset(inputVerticalAlign(engine, node), content.h, layout) + (last?.y ?? 0);
      const caret = parseColor(props.cursorColor ?? props.selectionColor, engine.colorContext) ?? kit.text.selectionColor(appearance) | 0xff;
      ctx.item({ x: caretX - 1, y: caretY, w: 3, h: lineH }, (w) => w.fillRect(caretX, caretY + 1, 2, lineH - 2, caret >>> 0));
    }
  }

  // The native control the host mounts at this rectangle — only where it is
  // actually visible, so a hidden input never catches clicks meant for others.
  const r = transformRect(windowMatrix(node), { x: 0, y: 0, w: node.w, h: node.h });
  const visible = visibleOverlayRect(engine, node, r);
  if (!visible) return;
  const i = node.insets;
  ctx.overlay({
    nodeId: node.id,
    kind: OverlayKind.TextInput,
    x: r.x, y: r.y, w: r.w, h: r.h,
    props: {
      clip: [visible.y - r.y, r.x + r.w - (visible.x + visible.w), r.y + r.h - (visible.y + visible.h), visible.x - r.x],
      value,
      placeholder: props.placeholder ?? '',
      font: style.font,
      color: cssColor(style.color),
      letterSpacing: style.letterSpacing,
      lineHeight: style.lineHeight,
      textAlign: node.computed.textAlign ?? 'left',
      padding: [i.top, i.right, i.bottom, i.left],
      multiline: !!props.multiline,
      secure: !!props.secureTextEntry,
      editable: props.editable !== false && props.readOnly !== true,
      keyboardType: props.keyboardType ?? props.inputMode ?? 'default',
      autoCapitalize: props.autoCapitalize ?? 'sentences',
      autoCorrect: props.autoCorrect !== false,
      maxLength: props.maxLength ?? null,
      returnKeyType: props.returnKeyType ?? props.enterKeyHint ?? 'default',
      selectionColor: cssColor(parseColor(props.selectionColor ?? props.cursorColor, engine.colorContext) ?? kit.text.selectionColor(appearance)),
      caretHidden: !!props.caretHidden,
      autoFocus: !!props.autoFocus,
      testID: props.testID ?? null,
      label: props.accessibilityLabel ?? props['aria-label'] ?? props.placeholder ?? null,
    },
  });
}

/**
 * Where an input's text sits vertically: iOS centers a single line and
 * top-aligns multiline; Android centers both unless `textAlignVertical` says
 * otherwise (the well-known multiline quirk).
 */
function inputVerticalAlign(engine: Engine, node: HostNode): VerticalAlign {
  if (engine.kit.platform === 'android') return verticalAlignOf(node.computed, node.props) ?? 'center';
  return node.props.multiline ? 'top' : 'center';
}

/** Window rect of an input after ancestor clipping, or null if hidden or covered. */
function visibleOverlayRect(engine: Engine, node: HostNode, rect: Rect): Rect | null {
  // Covered by a page-sheet presentation or a modal above its own root?
  let root: HostNode = node;
  while (root.parent && root.kind !== 'modal') root = root.parent;
  const modals = engine.visibleModals();
  if (root.kind !== 'modal') {
    if (modals.length || engine.presentation) return null;
  } else if (modals[modals.length - 1] !== root) return null;
  let visible: Rect | null = rect;
  for (let n = node.parent; n && visible; n = n.kind === 'modal' ? null : n.parent) {
    if (n.kind === 'scroll' || n.computed.overflow === 'hidden') {
      visible = intersect(visible, engine.geometry.windowRect(n));
    }
  }
  if (visible) visible = intersect(visible, { x: 0, y: 0, w: engine.viewport.width, h: engine.viewport.height });
  return visible;
}

function cssColor(c: number): string {
  return `rgba(${(c >>> 24) & 255},${(c >>> 16) & 255},${(c >>> 8) & 255},${alphaOf(c)})`;
}

function drawPath(node: HostNode, box: BoxGeometry, ctx: LayerContext): void {
  const props = node.props;
  const d: string[] = Array.isArray(props.d) ? props.d : props.d ? [props.d] : [];
  if (!d.length) return;
  const colors = node.engine.colorContext;
  const fill = props.fill === 'none' ? null : parseColor(props.fill ?? 'black', colors);
  const stroke = props.stroke && props.stroke !== 'none' ? parseColor(props.stroke, colors) : null;
  const vb = String(props.viewBox ?? `0 0 ${node.w} ${node.h}`).split(/[\s,]+/).map(Number);
  const [vx = 0, vy = 0, vw = node.w || 1, vh = node.h || 1] = vb;
  const s = Math.min(node.w / vw, node.h / vh);
  const offX = box.x + (node.w - vw * s) / 2;
  const offY = box.y + (node.h - vh * s) / 2;
  const map = (x: number, y: number): [number, number] => [offX + (x - vx) * s, offY + (y - vy) * s];
  const strokeWidth = (props.strokeWidth ?? 1) * s;
  const caps: Record<string, number> = { butt: 0, round: 1, square: 2 };
  const joins: Record<string, number> = { miter: 0, round: 1, bevel: 2 };
  ctx.item(inflate(box, strokeWidth + 1), (w) => {
    for (const path of d) {
      if (fill != null && fill !== 0) {
        writePath(w, path, map);
        w.fillPath(fill, props.fillRule === 'evenodd' ? 1 : 0);
      }
      if (stroke != null) {
        writePath(w, path, map);
        w.strokePath(stroke, strokeWidth, caps[props.strokeLinecap] ?? 0, joins[props.strokeLinejoin] ?? 0);
      }
    }
  });
}

/** Clip radii of a node's box (what overflow: hidden clips to). */
export function nodeRadii(node: HostNode): Radii {
  return resolveRadii(node.computed, node.w, node.h);
}
