import type { Radii } from '@mimicry/protocol';
import { inflate, type LayerContext, type Rect } from '@mimicry/os-core';
import { UIUserInterfaceStyle, type UITraitCollection } from './ui-trait-collection';

/**
 * The iOS 26 Liquid Glass platter UIKit's own chrome draws under bar
 * buttons, back buttons and the tab bar: a soft shadow, a blur of what is
 * behind, a bright wash and a hairline rim. Values match the React Native
 * header and tab bar, measured on iOS 26 simulator captures.
 */
export interface GlassStyle {
  /** blur the backdrop (the tab bar does; small bar buttons only wash) */
  blur?: number;
  /** a tinted platter (prominent items): its color replaces the wash */
  tint?: number | null;
  /** wash overrides */
  light?: number;
  dark?: number;
  shadowOpacity?: number;
  shadowRadius?: number;
  shadowY?: number;
}

export function drawGlass(ctx: LayerContext, box: Rect, radii: Radii, traits: UITraitCollection, style: GlassStyle = {}): void {
  const dark = traits.userInterfaceStyle === UIUserInterfaceStyle.dark;
  const shadowAlpha = Math.round((style.shadowOpacity ?? 0.08) * 255);
  const radius = style.shadowRadius ?? 10;
  const dy = style.shadowY ?? 2;
  if (shadowAlpha > 0) {
    ctx.item(inflate(box, radius * 2 + Math.abs(dy) + 4), (w) => w.boxShadow(box.x, box.y, box.w, box.h, radii, shadowAlpha >>> 0, radius, 0, dy, 0, false));
  }
  if (style.blur) {
    const visible = ctx.visible(box);
    if (visible) ctx.backdrop(visible, visible.w === box.w && visible.h === box.h ? radii : [0, 0, 0, 0], style.blur, 1.8);
  }
  const wash = style.tint ?? (dark ? style.dark ?? 0x78788052 : style.light ?? 0xffffffdb);
  const rim = dark ? 0xffffff1f : 0x0000000f;
  ctx.item(inflate(box, 1), (w) => {
    w.fillRRect(box.x, box.y, box.w, box.h, radii, wash);
    w.strokeRRect(box.x + 0.25, box.y + 0.25, box.w - 0.5, box.h - 0.5, radii, 0.5, rim);
  });
}
