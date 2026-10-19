import {
  FrameEncoder, NO_CLIP, NO_RADII, OverlayKind, alphaOf, rgba, withAlpha, type CommandWriter, type Radii,
} from '@mimicry/protocol';
import type { Engine } from '../engine';
import { localMatrix, ownTransform, stickyOffset, windowMatrix } from '../geometry';
import { parseColor } from '../style/color';
import { IDENTITY, inflate, intersect, multiply, transformRect, translation, type Rect } from '../style/matrix';
import type { HostNode } from '../tree/node';
import { applyTextTransform } from '../text/text-layout';
import { blockOffset, lineOffset, verticalAlignOf, type VerticalAlign } from '../text/text-block';
import { textVerticalAlign } from '../layout/layout';
import {
  drawBackground, drawBorders, drawShadows, hasRadii, resolveBorders, resolveRadii, resolveShadows, shadowExtent,
  type BoxGeometry,
} from './box';
import { fitImage, resolveSource } from './image-fit';
import { writePath } from './path';
import { paintSvg } from '../svg/paint';
import { LayerRecorder, type RecorderStats } from './recorder';

/**
 * Walks the laid-out tree and produces one frame of draw commands.
 *
 * A node becomes its own composited layer when it has a transform, group
 * opacity, or moves independently of its parent (scroll content, animated
 * nodes, scroll indicators, system chrome). Everything else is recorded into
 * the enclosing layer's chunks. Layer properties (transform/opacity/clip) are
 * composite-time values, so animating them never invalidates a raster.
 */
export const LAYER = { node: 0, scrollContent: 1, indicator: 2, chrome: 3, modalDim: 4 } as const;
const layerId = (node: HostNode | null, kind: number) => (node ? node.id * 8 : 0) + kind;

export interface PaintResult {
  buffer: ArrayBuffer;
  stats: RecorderStats;
}

export class FramePainter {
  private frameNumber = 0;

  constructor(private readonly engine: Engine) {}

  paint(): PaintResult {
    const engine = this.engine;
    const v = engine.viewport;
    const frame = new FrameEncoder(++this.frameNumber, v.width, v.height, v.scale);
    const stats: RecorderStats = { chunks: 0, layers: 0, culled: 0 };
    const screen = { x: 0, y: 0, w: v.width, h: v.height };

    frame.push(0, IDENTITY, 1, NO_CLIP);
    const root = new LayerRecorder(frame, v.scale, screen, stats);
    const background = engine.windowBackground();
    const presenting = engine.presentation;
    // Behind a scaled-back presenting app, the window is black (iOS page sheets).
    root.item(screen, (w) => w.fillRect(0, 0, v.width, v.height, presenting ? rgba(0, 0, 0, 1) : background));

    const ctx: PaintContext = { frame, stats, scale: v.scale, engine };
    // iOS page sheets scale the presenting app back.
    if (presenting) {
      root.flush();
      frame.push(layerId(null, LAYER.modalDim) + 8 * 1_000_000, presenting.matrix, 1, presenting.clip);
      stats.layers++;
      // No tiling here: tiles composited under a scale would show seams.
      const behind = new LayerRecorder(frame, v.scale, null, stats);
      if (presenting.radius > 0) behind.pushClip({ ...screen, radii: [presenting.radius, presenting.radius, presenting.radius, presenting.radius] });
      behind.item(screen, (w) => w.fillRect(0, 0, v.width, v.height, background));
      paintChildren(engine.appRoot.root, 0, 0, behind, ctx);
      behind.flush();
      frame.pop();
    } else {
      paintChildren(engine.appRoot.root, 0, 0, root, ctx);
    }

    for (const modal of engine.visibleModals()) {
      paintModal(modal, root, ctx);
    }
    paintChildren(engine.systemRoot.root, 0, 0, root, ctx);
    root.flush();

    // System chrome: its own layer, so the status bar raster is reused every frame.
    frame.push(layerId(null, LAYER.chrome), IDENTITY, 1, NO_CLIP);
    stats.layers++;
    // iOS switches to light status bar content over the dark backdrop of a page sheet.
    const bar = presenting ? { ...engine.env.statusBar, barStyle: 'light-content' } : engine.env.statusBar;
    const chrome = new LayerRecorder(frame, v.scale, null, stats);
    chrome.item(screen, (w) => engine.kit.drawChrome(w, v, bar, engine.env.appearance, engine.bundledFonts));
    chrome.flush();
    frame.pop();

    frame.pop();
    return { buffer: frame.finish(), stats };
  }
}

interface PaintContext {
  frame: FrameEncoder;
  stats: RecorderStats;
  scale: number;
  engine: Engine;
}

function paintOrder(node: HostNode, android: boolean): HostNode[] {
  const children = node.children;
  let needsSort = false;
  for (const c of children) {
    if (c.computed.zIndex != null || (android && c.computed.elevation)) {
      needsSort = true;
      break;
    }
  }
  if (!needsSort) return children;
  return children
    .map((c, i) => ({ c, i, z: Number(c.computed.zIndex ?? 0), e: android ? Number(c.computed.elevation ?? 0) : 0 }))
    .sort((a, b) => a.z - b.z || a.e - b.e || a.i - b.i)
    .map((x) => x.c);
}

function paintChildren(node: HostNode, ox: number, oy: number, rec: LayerRecorder, ctx: PaintContext): void {
  const android = ctx.engine.kit.platform === 'android';
  const pinned: HostNode[] = [];
  for (const child of paintOrder(node, android)) {
    if (child.kind === 'modal') continue; // painted above everything else
    if (stickyOffset(child) > 0) {
      pinned.push(child); // pinned headers draw above the rows scrolling under them
      continue;
    }
    paintNode(child, ox + child.x, oy + child.y, rec, ctx);
  }
  for (const child of pinned) {
    rec.flush();
    paintNode(child, ox + child.x, oy + child.y + stickyOffset(child), rec, ctx);
  }
}

function isDisplayed(node: HostNode): boolean {
  return !node.hidden && node.computed.display !== 'none' && node.laidOut;
}

function paintNode(node: HostNode, ox: number, oy: number, rec: LayerRecorder, ctx: PaintContext): void {
  if (!isDisplayed(node)) return;
  const style = node.computed;
  const opacity = typeof style.opacity === 'number' ? Math.max(0, Math.min(1, style.opacity)) : 1;
  if (opacity <= 0) return;
  const own = ownTransform(node);
  const forced = node.native.layer === true || node.props.shouldRasterizeIOS || node.props.renderToHardwareTextureAndroid;
  if (own || opacity < 1 || forced) {
    rec.flush();
    const m = own ? multiply(translation(ox, oy), own) : translation(ox, oy);
    ctx.frame.push(layerId(node, LAYER.node), m, opacity, rec.compositeClip());
    ctx.stats.layers++;
    const inner = new LayerRecorder(ctx.frame, ctx.scale, null, ctx.stats);
    paintContent(node, 0, 0, inner, ctx);
    inner.flush();
    ctx.frame.pop();
    return;
  }
  paintContent(node, ox, oy, rec, ctx);
}

function paintModal(modal: HostNode, rec: LayerRecorder, ctx: PaintContext): void {
  const v = ctx.engine.viewport;
  const dim: number = modal.native.dim ?? 0;
  if (dim > 0) {
    rec.item({ x: 0, y: 0, w: v.width, h: v.height }, (w) => w.fillRect(0, 0, v.width, v.height, withAlpha(rgba(0, 0, 0, 1), dim)));
  }
  rec.flush();
  ctx.frame.push(layerId(modal, LAYER.node), localMatrix(modal), modal.native.opacity ?? 1, NO_CLIP);
  ctx.stats.layers++;
  const inner = new LayerRecorder(ctx.frame, ctx.scale, null, ctx.stats);
  const radius: number = modal.native.radius ?? 0;
  if (radius > 0) inner.pushClip({ x: 0, y: 0, w: modal.w, h: modal.h, radii: [radius, radius, 0, 0] });
  const background = parseColor(modal.computed.backgroundColor, ctx.engine.colorContext);
  if (background) inner.item({ x: 0, y: 0, w: modal.w, h: modal.h }, (w) => w.fillRect(0, 0, modal.w, modal.h, background));
  for (const child of modal.children) paintNode(child, child.x, child.y, inner, ctx);
  inner.flush();
  ctx.frame.pop();
}

function paintContent(node: HostNode, ox: number, oy: number, rec: LayerRecorder, ctx: PaintContext): void {
  const engine = ctx.engine;
  const style = node.computed;
  const colors = engine.colorContext;
  const radii = resolveRadii(style, node.w, node.h);
  const box: BoxGeometry = { x: ox, y: oy, w: node.w, h: node.h, radii };
  const shadows = resolveShadows(style, engine.kit.platform, colors);
  const borders = resolveBorders(style, colors, engine.kit.platform === 'ios' ? rgba(0, 0, 0, 1) : rgba(0, 0, 0, 1));
  const bordersOnTop = borders && engine.kit.borderAboveChildren;

  const backdrop = backdropOf(node);
  if (backdrop) {
    // Shadows sit behind the material; then the blur of everything beneath; then the tint (background).
    const outset = shadows.filter((s) => !s.inset);
    if (outset.length) rec.item(inflate(box, shadowExtent(outset) + 1), (w) => drawShadows(w, box, outset, false));
    const visible = rec.visible(box);
    if (visible) {
      rec.flush();
      const whole = visible.w === box.w && visible.h === box.h;
      ctx.frame.backdrop(visible, whole ? radii : NO_RADII, backdrop.blur, backdrop.saturation);
    }
  }

  const decorated = (backdrop ? shadows.some((s) => s.inset) : shadows.length) || style.backgroundColor != null || style.experimental_backgroundImage || style.backgroundImage || (borders && !bordersOnTop);
  if (decorated) {
    const extent = shadowExtent(shadows);
    rec.item(inflate(box, extent + 1), (w) => {
      if (!backdrop) drawShadows(w, box, shadows, false);
      drawBackground(w, box, style, colors);
      drawShadows(w, box, shadows, true);
      if (borders && !bordersOnTop) drawBorders(w, box, borders);
    });
  }

  if (node.native.ripple && !node.native.ripple.foreground) paintRipple(node, box, rec, ctx);

  switch (node.kind) {
    case 'text':
      paintText(node, ox, oy, rec, ctx);
      break;
    case 'image':
      paintImage(node, box, rec, ctx);
      break;
    case 'input':
      paintInput(node, box, rec, ctx);
      break;
    case 'switch': {
      const state = engine.behaviors.switchState(node);
      const s = engine.kit.switchSize;
      rec.item(inflate({ x: ox, y: oy, w: s.width, h: s.height }, 12), (w) => engine.kit.drawSwitch(w, ox, oy, state, engine.env.appearance));
      break;
    }
    case 'activity': {
      const state = engine.behaviors.activityState(node);
      if (!state.animating && node.props.hidesWhenStopped !== false) break;
      const size = engine.kit.activitySize(node.props.size);
      const x = ox + (node.w - size) / 2;
      const y = oy + (node.h - size) / 2;
      rec.item(inflate({ x, y, w: size, h: size }, 2), (w) => engine.kit.drawActivity(w, x, y, size, state, engine.env.appearance));
      break;
    }
    case 'path':
      paintPath(node, box, rec, ctx);
      break;
    case 'svg':
      // The viewport clips its content, so the box bounds the whole drawing.
      rec.item(box, (w) => paintSvg(w, node, box, engine));
      break;
  }

  if (node.kind === 'scroll') {
    paintScroll(node, ox, oy, radii, rec, ctx);
  } else if (node.kind !== 'text' && node.kind !== 'svg' && node.children.length) {
    const clip = style.overflow === 'hidden';
    if (clip) rec.pushClip({ x: ox, y: oy, w: node.w, h: node.h, radii });
    paintChildren(node, ox, oy, rec, ctx);
    if (clip) rec.popClip();
  }

  if (node.native.ripple?.foreground) paintRipple(node, box, rec, ctx);
  if (bordersOnTop) rec.item(inflate(box, 1), (w) => drawBorders(w, box, borders!));
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

function paintText(node: HostNode, ox: number, oy: number, rec: LayerRecorder, ctx: PaintContext): void {
  const content = contentBox(node, ox, oy);
  const layout = ctx.engine.textLayoutFor(node, content.w);
  if (!layout.lines.length) return;
  const align = String(node.computed.textAlign ?? 'auto');
  const block = { ...content, y: content.y + blockOffset(textVerticalAlign(ctx.engine, node), content.h, layout) };
  const bounds = inflate({ x: block.x, y: block.y, w: Math.max(content.w, layout.width), h: Math.max(content.h, layout.height) }, 4);
  rec.item(bounds, (w) => drawTextLines(w, layout.lines, block, align));
  // Inline views, where the layout placed them (layout.ts set their frames).
  for (const line of layout.lines) {
    for (const run of line.runs) {
      const child = run.attachment?.node as HostNode | undefined;
      if (child) paintNode(child, ox + child.x, oy + child.y, rec, ctx);
    }
  }
}

function drawTextLines(w: CommandWriter, lines: ReturnType<Engine['textLayoutFor']>['lines'], content: Rect, align: string): void {
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

export { resolveSource, fitImage };

function paintImage(node: HostNode, box: BoxGeometry, rec: LayerRecorder, ctx: PaintContext): void {
  const engine = ctx.engine;
  const source = resolveSource(node.props.source) ?? resolveSource(node.props.defaultSource);
  if (!source) return;
  const image = engine.images.get(source.uri, node);
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
  rec.item(box, (w) => {
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

function paintInput(node: HostNode, box: BoxGeometry, rec: LayerRecorder, ctx: PaintContext): void {
  const engine = ctx.engine;
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
    rec.item({ x: box.x, y: y - 1, w: box.w, h: 4 }, (w) => w.fillRect(box.x + 4, y, box.w - 8, focused ? 2 : 1, underline));
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
      rec.item(box, (w) => {
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
      rec.item({ x: caretX - 1, y: caretY, w: 3, h: lineH }, (w) => w.fillRect(caretX, caretY + 1, 2, lineH - 2, caret >>> 0));
    }
  }

  // The native control the host mounts at this rectangle — only where it is
  // actually visible, so a hidden input never catches clicks meant for others.
  const r = transformRect(windowMatrix(node), { x: 0, y: 0, w: node.w, h: node.h });
  const visible = visibleOverlayRect(engine, node, r);
  if (!visible) return;
  const i = node.insets;
  ctx.frame.overlay({
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

function paintPath(node: HostNode, box: BoxGeometry, rec: LayerRecorder, ctx: PaintContext): void {
  const props = node.props;
  const d: string[] = Array.isArray(props.d) ? props.d : props.d ? [props.d] : [];
  if (!d.length) return;
  const colors = ctx.engine.colorContext;
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
  rec.item(inflate(box, strokeWidth + 1), (w) => {
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

function paintRipple(node: HostNode, box: BoxGeometry, rec: LayerRecorder, ctx: PaintContext): void {
  const ripple = node.native.ripple as { x: number; y: number; radius: number; alpha: number; color: number; borderless: boolean } | undefined;
  if (!ripple || ripple.alpha <= 0) return;
  const cx = box.x + ripple.x;
  const cy = box.y + ripple.y;
  const bounds = ripple.borderless
    ? { x: cx - ripple.radius, y: cy - ripple.radius, w: ripple.radius * 2, h: ripple.radius * 2 }
    : box;
  rec.item(bounds, (w) => {
    w.save();
    if (!ripple.borderless) w.clipRRect(box.x, box.y, box.w, box.h, box.radii);
    w.pathBegin().arc(cx, cy, Math.max(0.01, ripple.radius), 0, Math.PI * 2).closePath().fillPath(withAlpha(ripple.color, ripple.alpha));
    w.restore();
  });
}

function paintScroll(node: HostNode, ox: number, oy: number, radii: Radii, rec: LayerRecorder, ctx: PaintContext): void {
  const engine = ctx.engine;
  const state = engine.scrolls.ensure(node);
  rec.flush();
  rec.pushClip({ x: ox, y: oy, w: node.w, h: node.h, radii });
  const clip = rec.compositeClip();
  rec.popClip();
  ctx.frame.push(layerId(node, LAYER.scrollContent), translation(ox - state.x, oy - state.y), 1, clip);
  ctx.stats.layers++;
  // Visible region (plus one screen of prefetch either side) in content coordinates.
  const interest = { x: state.x - node.w, y: state.y - node.h, w: node.w * 3, h: node.h * 3 };
  const content = new LayerRecorder(ctx.frame, ctx.scale, interest, ctx.stats);
  for (const child of node.children) {
    // children are positioned in the scroll view's border box; the layer transform applies the offset
    paintNode(child, child.x, child.y, content, ctx);
  }
  content.flush();
  ctx.frame.pop();

  for (const bar of engine.scrolls.indicators(node)) {
    ctx.frame.push(layerId(node, LAYER.indicator) + (bar.axis === 'x' ? 4 : 0), translation(ox + bar.x, oy + bar.y), bar.alpha, NO_CLIP);
    ctx.stats.layers++;
    const r = new LayerRecorder(ctx.frame, ctx.scale, null, ctx.stats);
    const t = Math.min(bar.w, bar.h) / 2;
    r.item({ x: 0, y: 0, w: bar.w, h: bar.h }, (w) => w.fillRRect(0, 0, bar.w, bar.h, [t, t, t, t], bar.color));
    r.flush();
    ctx.frame.pop();
  }
}

export { applyTextTransform };
