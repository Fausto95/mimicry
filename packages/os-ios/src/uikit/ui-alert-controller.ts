import { NO_RADII } from '@mimicry/protocol';
import { inflate, type LayerContext } from '@mimicry/os-core';
import {
  CGAffineTransformIdentity, CGAffineTransformMakeScale, CGAffineTransformMakeTranslation, type CGRect, type CGSize,
} from '../core-graphics/geometry';
import { iosKit } from '../theme';
import { UITapGestureRecognizer } from './gesture-recognizers';
import { NSTextAlignment } from './ns-paragraph-style';
import { drawCenteredText } from './text-system';
import { UIColor } from './ui-color';
import { UIControl, UIControlEvents } from './ui-control';
import { UIFont, UIFontWeight } from './ui-font';
import { UILabel } from './ui-label';
import { UIPresentationController } from './ui-presentation-controller';
import { UIUserInterfaceStyle, type UITraitCollection } from './ui-trait-collection';
import { UIView } from './ui-view';
import { UIModalPresentationStyle, UIViewController } from './ui-view-controller';
import type { UIWindow } from './ui-window';
import type { PresentedEntry } from './presentation';

/**
 * UIAlertController: alerts and action sheets, drawn with the iOS system
 * UI tokens React Native's alerts use (iosKit.tokens: 270 pt card, 14 pt
 * corners, 44 pt buttons, hairline separators, a 20% dim).
 *
 * An alert fades in while settling from 1.2× scale (UIKit's zoom-in) and
 * fades out on dismissal; two actions sit side by side (cancel on the
 * left), more stack (cancel last). An action sheet rises from the bottom:
 * its actions in one rounded group, cancel in its own below; tapping the
 * dimmed area cancels. The preferred action (or cancel) is semibold,
 * destructive ones red. Tapping an action dismisses the controller and then
 * runs its handler.
 *
 * Text fields (addTextField) are drawn as static boxes until UITextField
 * exists: their placeholder and text show, they do not edit.
 */
export enum UIAlertControllerStyle { actionSheet = 0, alert = 1 }
export enum UIAlertActionStyle { default = 0, cancel = 1, destructive = 2 }

export class UIAlertAction {
  isEnabled = true;

  constructor(
    readonly title: string | null,
    readonly style: UIAlertActionStyle = UIAlertActionStyle.default,
    readonly handler: ((action: UIAlertAction) => void) | null = null,
  ) {}
}

/** The text field stand-in addTextField(configurationHandler:) configures. */
export class UIAlertTextField extends UIView {
  placeholder: string | null = null;
  text: string | null = null;
  isSecureTextEntry = false;
  keyboardType = 0;
  autocapitalizationType = 0;

  protected override drawLayerContent(ctx: LayerContext): void {
    super.drawLayerContent(ctx);
    const traits = this.traitCollection;
    const dark = traits.userInterfaceStyle === UIUserInterfaceStyle.dark;
    const b = this.bounds.size;
    const box = { x: ctx.x, y: ctx.y, w: b.width, h: b.height };
    ctx.item(inflate(box, 1), (w) => {
      w.fillRRect(box.x, box.y, box.w, box.h, [6, 6, 6, 6], dark ? 0x1c1c1eff : 0xffffffff);
      w.strokeRRect(box.x + 0.25, box.y + 0.25, box.w - 0.5, box.h - 0.5, [6, 6, 6, 6], 0.5, dark ? 0x545458ff : 0xc6c6c8ff);
    });
    const value = this.text ? (this.isSecureTextEntry ? '•'.repeat(this.text.length) : this.text) : this.placeholder ?? '';
    if (!value) return;
    const font = UIFont.systemFont(13);
    const color = this.text ? UIColor.label : UIColor.placeholderText;
    drawLeftText(ctx, value, font, color, box.x + 6, box.y + b.height / 2, b.width - 12, traits);
  }
}

function drawLeftText(ctx: LayerContext, text: string, font: UIFont, color: UIColor, x: number, cy: number, maxWidth: number, traits: UITraitCollection): void {
  // drawCenteredText centers on cx: measure first, then shift by half the width.
  const width = drawCenteredText({ item: () => {} }, text, font, color, 0, cy, maxWidth, traits);
  drawCenteredText(ctx, text, font, color, x + width / 2, cy, maxWidth, traits);
}

const T = iosKit.tokens as Record<string, any>;
const pick = (pair: unknown, dark: boolean) => (Array.isArray(pair) ? (pair[dark ? 1 : 0] as number) : (pair as number));

/** Action sheet metrics (UIKit's iPhone action sheet). */
const SHEET = { margin: 8, radius: 13, button: 57, font: 20, gap: 8, headerFont: 13 };

class AlertActionButton extends UIControl {
  constructor(readonly action: UIAlertAction, private readonly alert: UIAlertController, private readonly sheet: boolean) {
    super();
    this.accessibilityLabel = action.title;
    this.isEnabled = action.isEnabled;
    this.addTarget(() => this.alert._tapped(this.action), UIControlEvents.touchUpInside);
  }

  protected override highlightChanged(): void {
    this.setNeedsDisplay();
  }

  protected override drawLayerContent(ctx: LayerContext): void {
    super.drawLayerContent(ctx);
    const traits = this.traitCollection;
    const dark = traits.userInterfaceStyle === UIUserInterfaceStyle.dark;
    const b = this.bounds.size;
    if (this.isHighlighted) {
      ctx.item({ x: ctx.x, y: ctx.y, w: b.width, h: b.height }, (w) => w.fillRect(ctx.x, ctx.y, b.width, b.height, dark ? 0xffffff14 : 0x0000000f));
    }
    const a = this.action;
    const bold = a === this.alert.preferredAction || (!this.alert.preferredAction && a.style === UIAlertActionStyle.cancel);
    let color = a.style === UIAlertActionStyle.destructive
      ? UIColor.fromRGBA(pick(T.alertDestructive, dark))
      : this.alert.view.tintColor ?? UIColor.fromRGBA(pick(T.alertTint, dark));
    if (!this.isEnabled) color = UIColor.tertiaryLabel;
    const size = this.sheet ? SHEET.font : (T.alertButtonSize as number);
    const font = UIFont.systemFont(size, bold ? UIFontWeight.semibold : UIFontWeight.regular);
    drawCenteredText(ctx, a.title ?? '', font, color, ctx.x + b.width / 2, ctx.y + b.height / 2, b.width - 16, traits);
  }
}

/** A rounded material group (the alert card, an action sheet group). */
class AlertGroupView extends UIView {
  separators: CGRect[] = [];

  constructor(private readonly radius: number) {
    super();
    this.clipsToBounds = true;
    this.layer.cornerRadius = radius;
  }

  protected override drawLayerContent(ctx: LayerContext): void {
    super.drawLayerContent(ctx);
    const dark = this.traitCollection.userInterfaceStyle === UIUserInterfaceStyle.dark;
    const b = this.bounds.size;
    const box = { x: ctx.x, y: ctx.y, w: b.width, h: b.height };
    const r = this.radius;
    const radii = [r, r, r, r] as const;
    const visible = ctx.visible(box);
    if (visible) ctx.backdrop(visible, visible.w === box.w && visible.h === box.h ? radii : NO_RADII, 20, 1.8);
    ctx.item(box, (w) => w.fillRRect(box.x, box.y, box.w, box.h, radii, pick(T.alertBackground, dark)));
  }

  protected override drawLayerOverlay(ctx: LayerContext): void {
    super.drawLayerOverlay(ctx);
    const color = pick(T.alertSeparator, this.traitCollection.userInterfaceStyle === UIUserInterfaceStyle.dark);
    const scale = this.traitCollection.displayScale || 3;
    for (const s of this.separators) {
      const x = ctx.x + s.origin.x;
      const y = ctx.y + s.origin.y;
      const w = Math.max(1 / scale, s.size.width);
      const h = Math.max(1 / scale, s.size.height);
      ctx.item({ x, y, w, h }, (wr) => wr.fillRect(x, y, w, h, color));
    }
  }
}

export class UIAlertController extends UIViewController {
  readonly preferredStyle: UIAlertControllerStyle;
  private _message: string | null;
  private readonly _actions: UIAlertAction[] = [];
  private readonly _textFields: UIAlertTextField[] = [];
  preferredAction: UIAlertAction | null = null;
  private readonly group: AlertGroupView;
  private readonly cancelGroup: AlertGroupView;
  private readonly titleLabel = new UILabel();
  private readonly messageLabel = new UILabel();
  private buttons: AlertActionButton[] = [];
  private cancelButton: AlertActionButton | null = null;

  constructor(title: string | null, message: string | null, preferredStyle: UIAlertControllerStyle) {
    super();
    this.title = title;
    this._message = message;
    this.preferredStyle = preferredStyle;
    this.modalPresentationStyle = UIModalPresentationStyle.custom;
    const sheet = preferredStyle === UIAlertControllerStyle.actionSheet;
    this.group = new AlertGroupView(sheet ? SHEET.radius : (T.alertRadius as number));
    this.cancelGroup = new AlertGroupView(SHEET.radius);
    for (const l of [this.titleLabel, this.messageLabel]) {
      l.numberOfLines = 0;
      l.textAlignment = NSTextAlignment.center;
    }
  }

  get message(): string | null {
    return this._message;
  }

  set message(message: string | null) {
    this._message = message;
    this.viewIfLoaded?.setNeedsLayout();
  }

  get actions(): readonly UIAlertAction[] {
    return this._actions;
  }

  get textFields(): readonly UIAlertTextField[] | null {
    return this._textFields.length ? this._textFields : null;
  }

  addAction(action: UIAlertAction): void {
    if (action.style === UIAlertActionStyle.cancel && this._actions.some((a) => a.style === UIAlertActionStyle.cancel)) {
      throw new Error('UIAlertController can only have one action with a style of UIAlertActionStyleCancel');
    }
    this._actions.push(action);
    this.viewIfLoaded?.setNeedsLayout();
  }

  /** addTextField(configurationHandler:) — alerts only */
  addTextField(configurationHandler?: (field: UIAlertTextField) => void): void {
    if (this.preferredStyle !== UIAlertControllerStyle.alert) throw new Error('Text fields can only be added to an alert controller of style UIAlertControllerStyleAlert');
    const field = new UIAlertTextField();
    configurationHandler?.(field);
    this._textFields.push(field);
    this.viewIfLoaded?.setNeedsLayout();
  }

  /** @internal an action button was tapped */
  _tapped(action: UIAlertAction): void {
    if (!action.isEnabled) return;
    this.dismiss(true, () => action.handler?.(action));
  }

  /** @internal the dimmed area of an action sheet was tapped: cancel */
  _cancelFromOutside(): void {
    const cancel = this._actions.find((a) => a.style === UIAlertActionStyle.cancel);
    if (this.preferredStyle === UIAlertControllerStyle.actionSheet) this.dismiss(true, () => cancel?.handler?.(cancel));
  }

  override loadView(): void {
    const view = new AlertRootView(this);
    view.addSubview(this.group);
    this.view = view;
  }

  // ── layout ────────────────────────────────────────────────────────────

  private rebuild(): void {
    for (const b of this.buttons) b.removeFromSuperview();
    this.cancelButton?.removeFromSuperview();
    this.cancelButton = null;
    const sheet = this.preferredStyle === UIAlertControllerStyle.actionSheet;
    const cancel = this._actions.find((a) => a.style === UIAlertActionStyle.cancel) ?? null;
    let ordered = this._actions.slice();
    if (sheet) ordered = ordered.filter((a) => a !== cancel);
    else if (ordered.length === 2) ordered.sort((a, b) => (a.style === UIAlertActionStyle.cancel ? -1 : b.style === UIAlertActionStyle.cancel ? 1 : 0));
    else ordered.sort((a, b) => (a.style === UIAlertActionStyle.cancel ? 1 : b.style === UIAlertActionStyle.cancel ? -1 : 0));
    this.buttons = ordered.map((a) => new AlertActionButton(a, this, sheet));
    for (const b of this.buttons) this.group.addSubview(b);
    for (const f of this._textFields) if (f.superview !== this.group) this.group.addSubview(f);
    if (sheet && cancel) {
      this.cancelButton = new AlertActionButton(cancel, this, true);
      this.cancelGroup.addSubview(this.cancelButton);
      if (this.cancelGroup.superview !== this.view) this.view.addSubview(this.cancelGroup);
    } else this.cancelGroup.removeFromSuperview();
    if (!this.titleLabel.superview) this.group.addSubview(this.titleLabel);
    if (!this.messageLabel.superview) this.group.addSubview(this.messageLabel);
  }

  /** The alert's (or sheet's) size for a container width. */
  _contentSize(containerWidth: number): CGSize {
    const sheet = this.preferredStyle === UIAlertControllerStyle.actionSheet;
    const width = sheet ? containerWidth - SHEET.margin * 2 : (T.alertWidth as number);
    const header = this.headerHeight(width);
    const rows = this.buttonRows();
    const buttonH = sheet ? SHEET.button : (T.alertButtonHeight as number);
    const fields = this._textFields.length ? this._textFields.length * 24 + 12 : 0;
    let height = header + fields + rows * buttonH;
    if (sheet && this._actions.some((a) => a.style === UIAlertActionStyle.cancel)) height += SHEET.gap + SHEET.button;
    return { width, height };
  }

  private buttonRows(): number {
    const sheet = this.preferredStyle === UIAlertControllerStyle.actionSheet;
    const n = this._actions.filter((a) => !(sheet && a.style === UIAlertActionStyle.cancel)).length;
    return !sheet && n === 2 ? 1 : n;
  }

  private configureLabels(): void {
    const sheet = this.preferredStyle === UIAlertControllerStyle.actionSheet;
    this.titleLabel.text = this.title;
    this.messageLabel.text = this._message;
    if (sheet) {
      this.titleLabel.font = UIFont.systemFont(SHEET.headerFont, UIFontWeight.semibold);
      this.messageLabel.font = UIFont.systemFont(SHEET.headerFont);
      this.titleLabel.textColor = UIColor.secondaryLabel;
      this.messageLabel.textColor = UIColor.secondaryLabel;
    } else {
      this.titleLabel.font = UIFont.systemFont(T.alertTitleSize as number, UIFontWeight.semibold);
      this.messageLabel.font = UIFont.systemFont(T.alertMessageSize as number);
      this.titleLabel.textColor = UIColor.label;
      this.messageLabel.textColor = UIColor.label;
    }
  }

  private headerHeight(width: number): number {
    this.configureLabels();
    const inner = width - 32;
    const title = this.title ? this.titleLabel.sizeThatFits({ width: inner, height: Infinity }).height : 0;
    const message = this._message ? this.messageLabel.sizeThatFits({ width: inner, height: Infinity }).height : 0;
    if (!title && !message) return 0;
    const sheet = this.preferredStyle === UIAlertControllerStyle.actionSheet;
    // Alerts: 19 pt above, 17 below, 3 between; action sheets: 14 / 14 / 3.
    return (sheet ? 14 : 19) + title + (title && message ? 3 : 0) + message + (sheet ? 14 : 17);
  }

  /** @internal lays out the card (or the sheet's groups) inside the alert's view */
  _layoutContent(): void {
    this.rebuild();
    const sheet = this.preferredStyle === UIAlertControllerStyle.actionSheet;
    const b = this.view.bounds.size;
    const width = b.width;
    const header = this.headerHeight(width);
    const inner = width - 32;
    let y = sheet ? 14 : 19;
    if (this.title) {
      const h = this.titleLabel.sizeThatFits({ width: inner, height: Infinity }).height;
      this.titleLabel.frame = { origin: { x: 16, y }, size: { width: inner, height: h } };
      y += h + 3;
    }
    if (this._message) {
      const h = this.messageLabel.sizeThatFits({ width: inner, height: Infinity }).height;
      this.messageLabel.frame = { origin: { x: 16, y: this.title ? y : y }, size: { width: inner, height: h } };
    }
    this.titleLabel.isHidden = !this.title;
    this.messageLabel.isHidden = !this._message;
    let top = header;
    for (const f of this._textFields) {
      f.frame = { origin: { x: 16, y: top }, size: { width: width - 32, height: 24 } };
      top += 24;
    }
    if (this._textFields.length) top += 12;
    const separators: CGRect[] = [];
    const buttonH = sheet ? SHEET.button : (T.alertButtonHeight as number);
    const sideBySide = !sheet && this.buttons.length === 2;
    if (header > 0 || this._textFields.length) separators.push({ origin: { x: 0, y: top }, size: { width, height: 0 } });
    this.buttons.forEach((button, i) => {
      if (sideBySide) {
        button.frame = { origin: { x: (width / 2) * i, y: top }, size: { width: width / 2, height: buttonH } };
        if (i === 1) separators.push({ origin: { x: width / 2, y: top }, size: { width: 0, height: buttonH } });
      } else {
        button.frame = { origin: { x: 0, y: top + i * buttonH }, size: { width, height: buttonH } };
        if (i > 0) separators.push({ origin: { x: 0, y: top + i * buttonH }, size: { width, height: 0 } });
      }
    });
    const groupHeight = top + this.buttonRows() * buttonH;
    this.group.frame = { origin: { x: 0, y: 0 }, size: { width, height: groupHeight } };
    this.group.separators = separators;
    this.group.setNeedsDisplay();
    if (this.cancelButton) {
      this.cancelGroup.frame = { origin: { x: 0, y: groupHeight + SHEET.gap }, size: { width, height: SHEET.button } };
      this.cancelButton.frame = { origin: { x: 0, y: 0 }, size: { width, height: SHEET.button } };
    }
  }

  /** @internal the presentation controller UIKit uses for alerts */
  override _makePresentationController(presenting: UIViewController): UIPresentationController {
    const controller = new UIAlertPresentationController(this, presenting);
    return controller;
  }
}

class AlertRootView extends UIView {
  constructor(private readonly alert: UIAlertController) {
    super();
  }

  override layoutSubviews(): void {
    super.layoutSubviews();
    this.alert._layoutContent();
  }
}

/** Centers an alert (or docks an action sheet) over a dimmed window and animates it in and out. */
class UIAlertPresentationController extends UIPresentationController {
  private readonly dimming = new UIView();

  constructor(private readonly alert: UIAlertController, presenting: UIViewController) {
    super(alert, presenting);
    this.dimming.backgroundColor = UIColor.fromRGBA((T.alertDim as number) >>> 0);
    this.dimming.addGestureRecognizer(new UITapGestureRecognizer(() => this.alert._cancelFromOutside()));
  }

  override get shouldRemovePresentersView(): boolean {
    return false;
  }

  private get isSheet(): boolean {
    return this.alert.preferredStyle === UIAlertControllerStyle.actionSheet;
  }

  override get frameOfPresentedViewInContainerView(): CGRect {
    const b = this.containerView.bounds.size;
    const size = this.alert._contentSize(b.width);
    if (this.isSheet) {
      const bottom = this.window?.application?.screen.safeAreaInsets.bottom ?? 0;
      return { origin: { x: SHEET.margin, y: b.height - size.height - Math.max(bottom, SHEET.margin) }, size };
    }
    return { origin: { x: (b.width - size.width) / 2, y: (b.height - size.height) / 2 }, size };
  }

  override _attach(window: UIWindow, entry: PresentedEntry): void {
    super._attach(window, entry);
    this.containerView.insertSubview(this.dimming, 0);
  }

  override _layout(): void {
    super._layout();
    this.dimming.frame = this.containerView.bounds;
  }

  override _present(animated: boolean, done: () => void): void {
    this.presentationTransitionWillBegin();
    this._layout();
    const view = this.presentedView;
    const finish = () => {
      this.presentationTransitionDidEnd(true);
      done();
    };
    if (!animated) {
      finish();
      return;
    }
    const height = this.containerView.bounds.size.height;
    UIView.performWithoutAnimation(() => {
      this.dimming.alpha = 0;
      if (this.isSheet) view.transform = CGAffineTransformMakeTranslation(0, height - view.frame.origin.y);
      else {
        view.alpha = 0;
        view.transform = CGAffineTransformMakeScale(1.2, 1.2);
      }
    });
    UIView.animate({ springDuration: 0.4, bounce: 0 }, () => {
      this.dimming.alpha = 1;
      view.alpha = 1;
      view.transform = CGAffineTransformIdentity;
    }, finish);
  }

  override _dismiss(animated: boolean, done: () => void): void {
    this.dismissalTransitionWillBegin();
    const view = this.presentedView;
    const finish = () => {
      this.dismissalTransitionDidEnd(true);
      done();
    };
    if (!animated) {
      finish();
      return;
    }
    const height = this.containerView.bounds.size.height;
    UIView.animate(this.isSheet ? 0.3 : 0.2, () => {
      this.dimming.alpha = 0;
      if (this.isSheet) view.transform = CGAffineTransformMakeTranslation(0, height - view.frame.origin.y);
      else view.alpha = 0;
    }, finish);
  }
}
