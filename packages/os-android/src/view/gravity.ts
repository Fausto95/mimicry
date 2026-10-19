/**
 * android.view.Gravity: where an object sits inside a larger container.
 * Layout direction is always left-to-right in Mimicry, so START is LEFT and
 * END is RIGHT once resolved.
 */
export const Gravity = {
  NO_GRAVITY: 0,
  AXIS_SPECIFIED: 0x0001,
  AXIS_PULL_BEFORE: 0x0002,
  AXIS_PULL_AFTER: 0x0004,
  AXIS_X_SHIFT: 0,
  AXIS_Y_SHIFT: 4,
  TOP: 0x30,
  BOTTOM: 0x50,
  LEFT: 0x03,
  RIGHT: 0x05,
  CENTER_VERTICAL: 0x10,
  FILL_VERTICAL: 0x70,
  CENTER_HORIZONTAL: 0x01,
  FILL_HORIZONTAL: 0x07,
  CENTER: 0x11,
  FILL: 0x77,
  CLIP_VERTICAL: 0x80,
  CLIP_HORIZONTAL: 0x08,
  RELATIVE_LAYOUT_DIRECTION: 0x00800000,
  START: 0x00800003,
  END: 0x00800005,
  HORIZONTAL_GRAVITY_MASK: 0x07,
  VERTICAL_GRAVITY_MASK: 0x70,
  RELATIVE_HORIZONTAL_GRAVITY_MASK: 0x00800007,
  DISPLAY_CLIP_VERTICAL: 0x10000000,
  DISPLAY_CLIP_HORIZONTAL: 0x01000000,

  /** START/END → LEFT/RIGHT (left-to-right layout). */
  getAbsoluteGravity(gravity: number, _layoutDirection = 0): number {
    if (gravity & Gravity.RELATIVE_LAYOUT_DIRECTION) {
      gravity &= ~Gravity.RELATIVE_LAYOUT_DIRECTION;
    }
    return gravity;
  },

  isVertical(gravity: number): boolean {
    return gravity > 0 && (gravity & Gravity.VERTICAL_GRAVITY_MASK) !== 0;
  },

  isHorizontal(gravity: number): boolean {
    return gravity > 0 && (gravity & Gravity.RELATIVE_HORIZONTAL_GRAVITY_MASK) !== 0;
  },

  /**
   * Gravity.apply: place a w × h object in `container` (left, top, right,
   * bottom), offset by xAdj / yAdj, and return its bounds.
   */
  apply(gravity: number, w: number, h: number, container: { left: number; top: number; right: number; bottom: number }, xAdj = 0, yAdj = 0): { left: number; top: number; right: number; bottom: number } {
    const g = Gravity.getAbsoluteGravity(gravity);
    let left: number;
    let top: number;
    const cw = container.right - container.left;
    const ch = container.bottom - container.top;
    switch (g & Gravity.HORIZONTAL_GRAVITY_MASK) {
      case Gravity.CENTER_HORIZONTAL:
        left = container.left + (cw - w) / 2 + xAdj;
        break;
      case Gravity.RIGHT:
        left = container.right - w - xAdj;
        break;
      case Gravity.FILL_HORIZONTAL:
        left = container.left;
        w = cw;
        break;
      default:
        left = container.left + xAdj;
    }
    switch (g & Gravity.VERTICAL_GRAVITY_MASK) {
      case Gravity.CENTER_VERTICAL:
        top = container.top + (ch - h) / 2 + yAdj;
        break;
      case Gravity.BOTTOM:
        top = container.bottom - h - yAdj;
        break;
      case Gravity.FILL_VERTICAL:
        top = container.top;
        h = ch;
        break;
      default:
        top = container.top + yAdj;
    }
    return { left, top, right: left + w, bottom: top + h };
  },
} as const;
