/**
 * Draw-command opcodes.
 *
 * Every command is a 32-bit header word followed by its payload:
 *
 *   header = opcode | (payloadWords << 16)
 *
 * The payload length makes the stream self-describing, so a host can skip
 * commands it does not understand and the engine can add new ones without
 * breaking older hosts. All values are little-endian, 4-byte aligned.
 * Coordinates are float32 logical points, colors are packed RGBA uint32.
 */
export const Op = {
  // ── state ──────────────────────────────────────────────
  /** push canvas state */
  Save: 1,
  /** pop canvas state */
  Restore: 2,
  /** multiply current transform: a b c d e f */
  Transform: 3,
  /** multiply global alpha: alpha */
  Alpha: 4,
  /** clip to rect: x y w h */
  ClipRect: 5,
  /** clip to rounded rect: x y w h tl tr br bl */
  ClipRRect: 6,

  // ── shapes ─────────────────────────────────────────────
  /** x y w h color */
  FillRect: 10,
  /** x y w h tl tr br bl color */
  FillRRect: 11,
  /** x y w h tl tr br bl lineWidth color dash(0 solid|1 dashed|2 dotted) */
  StrokeRRect: 12,
  /** ring between outer and inner rounded rect (even-odd): outer[8] inner[8] color */
  FillRing: 13,
  /** canvas shadow for subsequent fills: color blur dx dy */
  Shadow: 14,
  ShadowClear: 15,
  /** x y w h tl tr br bl x0 y0 x1 y1 count (offset color)* */
  LinearGradientRRect: 16,
  /**
   * CSS box-shadow semantics (also used for iOS shadow* and Android elevation):
   * x y w h tl tr br bl color blur dx dy spread inset(0|1)
   * Outset shadows are not drawn under the box; inset shadows stay inside it.
   */
  BoxShadow: 17,

  // ── paths ──────────────────────────────────────────────
  PathBegin: 20,
  MoveTo: 21,
  LineTo: 22,
  /** cx cy x y */
  QuadTo: 23,
  /** c1x c1y c2x c2y x y */
  CubicTo: 24,
  /** cx cy r startAngle endAngle ccw(0|1) */
  Arc: 25,
  ClosePath: 26,
  /** color rule(0 nonzero|1 evenodd) */
  FillPath: 27,
  /** color lineWidth cap(0 butt|1 round|2 square) join(0 miter|1 round|2 bevel) */
  StrokePath: 28,
  /** rule */
  ClipPath: 29,

  // ── text ───────────────────────────────────────────────
  /** css font string; sets the font for following Text commands */
  Font: 40,
  /** x baselineY color letterSpacing string */
  Text: 41,

  // ── images ─────────────────────────────────────────────
  /** dx dy dw dh sx sy sw sh tint(0 = none) string(uri) */
  Image: 50,
} as const;

export type OpCode = (typeof Op)[keyof typeof Op];

/** Composition commands (the layer tree of a frame). Same header encoding. */
export const CompositeOp = {
  /**
   * Open a layer.
   * layerId a b c d e f opacity clipKind(0 none|1 rect|2 rrect) cx cy cw ch tl tr br bl
   * Transform is relative to the parent layer; the clip is in parent coordinates
   * and applied before the transform.
   */
  Push: 1,
  /** draw a chunk of the current layer: chunkIndex */
  Chunk: 2,
  /** close the current layer */
  Pop: 3,
  /**
   * Backdrop material: blur (and saturate) whatever has already been
   * composited beneath this point, inside a rounded rect of the current layer.
   * x y w h tl tr br bl blurRadius saturation
   * It is a composite-time effect — never part of a cached raster — because
   * its result depends on the content behind it. Tints and highlights are
   * ordinary chunks drawn after it.
   */
  Backdrop: 4,
} as const;

export const ClipKind = { None: 0, Rect: 1, RRect: 2 } as const;
export const DashStyle = { Solid: 0, Dashed: 1, Dotted: 2 } as const;
export const LineCap = { Butt: 0, Round: 1, Square: 2 } as const;
export const LineJoin = { Miter: 0, Round: 1, Bevel: 2 } as const;
export const FillRule = { NonZero: 0, EvenOdd: 1 } as const;

/** Native controls the host mounts on top of the canvas at a resolved rectangle. */
export const OverlayKind = { TextInput: 1 } as const;

export const opName = (code: number): string =>
  (Object.entries(Op).find(([, v]) => v === code)?.[0]) ?? `Unknown(${code})`;
