import { NO_RADII } from '@mimicry/protocol';
import { inflate, type LayerContext } from '@mimicry/os-core';
import type { CGRect } from '../core-graphics/geometry';
import { UIColor } from './ui-color';
import { UIUserInterfaceStyle, type UITraitCollection } from './ui-trait-collection';
import { UIView } from './ui-view';

/**
 * UIVisualEffectView with UIBlurEffect, UIVibrancyEffect and iOS 26's
 * UIGlassEffect. Materials are composite-time effects: the view asks the
 * host to blur and saturate what is already composited beneath it (inside
 * its layer's corner radius), then draws the material's tint over it.
 * Content goes in `contentView`.
 *
 * Vibrancy is approximated by drawing the content view at the style's
 * opacity (no luminance blending); glass by a light blur, a white wash, a
 * hairline rim and a soft shadow — no refraction.
 */
export enum UIBlurEffectStyle {
  extraLight = 0, light = 1, dark = 2, regular = 4, prominent = 5,
  systemUltraThinMaterial = 6, systemThinMaterial = 7, systemMaterial = 8, systemThickMaterial = 9, systemChromeMaterial = 10,
  systemUltraThinMaterialLight = 11, systemThinMaterialLight = 12, systemMaterialLight = 13, systemThickMaterialLight = 14, systemChromeMaterialLight = 15,
  systemUltraThinMaterialDark = 16, systemThinMaterialDark = 17, systemMaterialDark = 18, systemThickMaterialDark = 19, systemChromeMaterialDark = 20,
}

export enum UIVibrancyEffectStyle {
  label = 0, secondaryLabel = 1, tertiaryLabel = 2, quaternaryLabel = 3, fill = 4, secondaryFill = 5, tertiaryFill = 6, separator = 7,
}

export enum UIGlassEffectStyle { regular = 0, clear = 1 }

export abstract class UIVisualEffect {}

export class UIBlurEffect extends UIVisualEffect {
  constructor(readonly style: UIBlurEffectStyle) {
    super();
  }
}

export class UIVibrancyEffect extends UIVisualEffect {
  constructor(readonly blurEffect: UIBlurEffect, readonly style: UIVibrancyEffectStyle = UIVibrancyEffectStyle.label) {
    super();
  }
}

/** iOS 26 Liquid Glass. */
export class UIGlassEffect extends UIVisualEffect {
  tintColor: UIColor | null = null;
  isInteractive = false;

  constructor(readonly style: UIGlassEffectStyle = UIGlassEffectStyle.regular) {
    super();
  }
}

/** iOS 26: glass views in one container merge — accepted, drawn separately. */
export class UIGlassContainerEffect extends UIVisualEffect {
  spacing = 0;
}

interface Material {
  blur: number;
  saturation: number;
  /** [light, dark] tint (packed RGBA); a fixed style uses the same in both */
  tint: readonly [number, number];
}

/** The materials' blur and wash, in light and dark. */
const MATERIALS: Record<UIBlurEffectStyle, Material> = {
  [UIBlurEffectStyle.extraLight]: { blur: 20, saturation: 1.8, tint: [0xffffffbf, 0xffffffbf] },
  [UIBlurEffectStyle.light]: { blur: 20, saturation: 1.8, tint: [0xffffff8c, 0xffffff8c] },
  [UIBlurEffectStyle.dark]: { blur: 20, saturation: 1.8, tint: [0x101010b3, 0x101010b3] },
  [UIBlurEffectStyle.regular]: { blur: 20, saturation: 1.8, tint: [0xffffffb3, 0x1c1c1eb3] },
  [UIBlurEffectStyle.prominent]: { blur: 20, saturation: 1.8, tint: [0xffffffd1, 0x1c1c1ed1] },
  [UIBlurEffectStyle.systemUltraThinMaterial]: { blur: 15, saturation: 1.8, tint: [0xffffff59, 0x1c1c1e59] },
  [UIBlurEffectStyle.systemThinMaterial]: { blur: 18, saturation: 1.8, tint: [0xffffff8c, 0x1c1c1e8c] },
  [UIBlurEffectStyle.systemMaterial]: { blur: 20, saturation: 1.8, tint: [0xffffffb3, 0x1c1c1eb3] },
  [UIBlurEffectStyle.systemThickMaterial]: { blur: 22, saturation: 1.8, tint: [0xffffffd1, 0x1c1c1ed1] },
  [UIBlurEffectStyle.systemChromeMaterial]: { blur: 20, saturation: 1.8, tint: [0xf8f8f8bf, 0x1c1c1ebf] },
  [UIBlurEffectStyle.systemUltraThinMaterialLight]: { blur: 15, saturation: 1.8, tint: [0xffffff59, 0xffffff59] },
  [UIBlurEffectStyle.systemThinMaterialLight]: { blur: 18, saturation: 1.8, tint: [0xffffff8c, 0xffffff8c] },
  [UIBlurEffectStyle.systemMaterialLight]: { blur: 20, saturation: 1.8, tint: [0xffffffb3, 0xffffffb3] },
  [UIBlurEffectStyle.systemThickMaterialLight]: { blur: 22, saturation: 1.8, tint: [0xffffffd1, 0xffffffd1] },
  [UIBlurEffectStyle.systemChromeMaterialLight]: { blur: 20, saturation: 1.8, tint: [0xf8f8f8bf, 0xf8f8f8bf] },
  [UIBlurEffectStyle.systemUltraThinMaterialDark]: { blur: 15, saturation: 1.8, tint: [0x1c1c1e59, 0x1c1c1e59] },
  [UIBlurEffectStyle.systemThinMaterialDark]: { blur: 18, saturation: 1.8, tint: [0x1c1c1e8c, 0x1c1c1e8c] },
  [UIBlurEffectStyle.systemMaterialDark]: { blur: 20, saturation: 1.8, tint: [0x1c1c1eb3, 0x1c1c1eb3] },
  [UIBlurEffectStyle.systemThickMaterialDark]: { blur: 22, saturation: 1.8, tint: [0x1c1c1ed1, 0x1c1c1ed1] },
  [UIBlurEffectStyle.systemChromeMaterialDark]: { blur: 20, saturation: 1.8, tint: [0x1c1c1ebf, 0x1c1c1ebf] },
};

const VIBRANCY_ALPHA: Record<UIVibrancyEffectStyle, number> = {
  [UIVibrancyEffectStyle.label]: 0.9,
  [UIVibrancyEffectStyle.secondaryLabel]: 0.6,
  [UIVibrancyEffectStyle.tertiaryLabel]: 0.4,
  [UIVibrancyEffectStyle.quaternaryLabel]: 0.25,
  [UIVibrancyEffectStyle.fill]: 0.3,
  [UIVibrancyEffectStyle.secondaryFill]: 0.25,
  [UIVibrancyEffectStyle.tertiaryFill]: 0.2,
  [UIVibrancyEffectStyle.separator]: 0.25,
};

/** Draw a material's backdrop and wash over `box` (shared with bars drawn by UIKit itself). */
export function drawMaterial(ctx: LayerContext, box: { x: number; y: number; w: number; h: number }, radii: readonly [number, number, number, number], effect: UIVisualEffect, traits: UITraitCollection): void {
  const dark = traits.userInterfaceStyle === UIUserInterfaceStyle.dark;
  if (effect instanceof UIGlassEffect) {
    ctx.item(inflate(box, 44), (w) => w.boxShadow(box.x, box.y, box.w, box.h, radii, 0x0000001f, 16, 0, 6, 0, false));
    const visible = ctx.visible(box);
    if (visible) ctx.backdrop(visible, visible.w === box.w && visible.h === box.h ? radii : NO_RADII, effect.style === UIGlassEffectStyle.clear ? 4 : 10, 1.8);
    const wash = effect.tintColor ? effect.tintColor.resolvedColor(traits).rgba : effect.style === UIGlassEffectStyle.clear ? (dark ? 0x1e1e2033 : 0xffffff33) : (dark ? 0x1e1e20b8 : 0xffffffb8);
    ctx.item(inflate(box, 1), (w) => {
      w.fillRRect(box.x, box.y, box.w, box.h, radii, wash);
      w.strokeRRect(box.x + 0.25, box.y + 0.25, box.w - 0.5, box.h - 0.5, radii, 0.5, dark ? 0xffffff24 : 0xffffffcc);
    });
    return;
  }
  const blur = effect instanceof UIVibrancyEffect ? null : effect instanceof UIBlurEffect ? effect : null;
  if (!blur) return;
  const m = MATERIALS[blur.style];
  const visible = ctx.visible(box);
  if (visible) ctx.backdrop(visible, visible.w === box.w && visible.h === box.h ? radii : NO_RADII, m.blur, m.saturation);
  const tint = m.tint[dark ? 1 : 0];
  ctx.item(box, (w) => w.fillRRect(box.x, box.y, box.w, box.h, radii, tint));
}

export class UIVisualEffectView extends UIView {
  readonly contentView: UIView;
  private _effect: UIVisualEffect | null;

  constructor(effect: UIVisualEffect | null = null, frame?: CGRect) {
    super(frame);
    this._effect = effect;
    this.contentView = new UIView();
    this.addSubview(this.contentView);
    this.applyVibrancy();
  }

  get effect(): UIVisualEffect | null {
    return this._effect;
  }

  set effect(effect: UIVisualEffect | null) {
    this._effect = effect;
    this.applyVibrancy();
    this.setNeedsDisplay();
  }

  private applyVibrancy(): void {
    const e = this._effect;
    this.contentView.alpha = e instanceof UIVibrancyEffect ? VIBRANCY_ALPHA[e.style] : 1;
  }

  override layoutSubviews(): void {
    super.layoutSubviews();
    this.contentView.frame = { origin: { x: 0, y: 0 }, size: this.bounds.size };
  }

  protected override drawLayerContent(ctx: LayerContext): void {
    super.drawLayerContent(ctx);
    const effect = this._effect;
    if (!effect) return;
    const b = this.bounds.size;
    drawMaterial(ctx, { x: ctx.x, y: ctx.y, w: b.width, h: b.height }, this.layer.radii, effect, this.traitCollection);
  }
}
