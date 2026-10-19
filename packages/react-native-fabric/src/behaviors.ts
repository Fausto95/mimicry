import { rgba } from '@mimicry/protocol';
import type { Engine } from './engine';
import { cubicBezier, easeOut, type FrameTask } from '@mimicry/os-core';
import { parseColor } from '@mimicry/os-core';
import { multiply, scaling, translation, type Matrix } from '@mimicry/os-core';
import type { ActivityState } from '@mimicry/os-core';
import type { HostNode } from './tree/node';

/**
 * Native component behavior that lives below React on a real device:
 * spinners, uncontrolled
 * TextInput text, and Modal presentation (slide, fade, iOS page sheets).
 */
const presentEase = cubicBezier(0.2, 0.85, 0.25, 1);

interface Tween {
  from: number;
  to: number;
  start: number;
  duration: number;
}

export class Behaviors implements FrameTask {
  private readonly live = new Set<HostNode>();

  constructor(private readonly engine: Engine) {}

  private now(): number {
    return this.engine.animator.animationTime;
  }

  private track(node: HostNode): void {
    this.live.add(node);
    this.engine.animator.add(this);
    this.engine.requestFrame();
  }

  // ── lifecycle ─────────────────────────────────────────────────────────

  attached(node: HostNode): void {
    if (node.kind === 'activity' && node.props.animating !== false) {
      node.native.started ??= this.now();
      this.track(node);
    }
    if (node.kind === 'modal') this.modalVisibility(node);
  }

  detached(node: HostNode): void {
    this.live.delete(node);
  }

  propsChanged(node: HostNode): void {
    switch (node.kind) {
      case 'activity':
        if (node.props.animating !== false) {
          node.native.started ??= this.now();
          this.track(node);
        }
        break;
      case 'modal':
        this.modalVisibility(node);
        break;
    }
  }

  tick(now: number): boolean {
    for (const node of Array.from(this.live)) {
      if (!node.mounted) {
        this.live.delete(node);
        continue;
      }
      if (!this.stepNode(node, now)) this.live.delete(node);
    }
    if (this.live.size) this.engine.markPaint();
    return this.live.size > 0;
  }

  private stepNode(node: HostNode, now: number): boolean {
    let busy = false;
    if (node.kind === 'activity' && node.props.animating !== false) busy = true;
    if (node.kind === 'modal') busy = this.stepModal(node, now) || busy;
    return busy;
  }

  // ── switch (UISwitch / SwitchCompat do the animation) ──────────────

  controlPress(node: HostNode, pressed: boolean): void {
    node.hostView?.setControlPressed?.(pressed);
  }

  toggleSwitch(node: HostNode): void {
    const next = !node.props.value;
    this.engine.events.emit(node, 'onChange', { value: next, target: node.id }, this.now());
    // Controlled: if the app did not accept the change, the switch stays (or animates back).
    node.hostView?.updateProps();
  }

  // ── activity indicator ────────────────────────────────────────────────

  activityState(node: HostNode): ActivityState {
    const animating = node.props.animating !== false;
    return {
      time: animating ? (this.now() - (node.native.started ?? this.now())) / 1000 : 0,
      color: parseColor(node.props.color, this.engine.colorContext),
      animating,
    };
  }

  // ── text input ────────────────────────────────────────────────────────

  inputValue(node: HostNode): string {
    if (typeof node.props.value === 'string') return node.props.value;
    if (typeof node.native.text === 'string') return node.native.text;
    return typeof node.props.defaultValue === 'string' ? node.props.defaultValue : '';
  }

  textChanged(node: HostNode, text: string, selection?: { start: number; end: number }): void {
    const max = node.props.maxLength;
    if (typeof max === 'number' && text.length > max) text = text.slice(0, max);
    node.native.text = text;
    node.invalidateText();
    node.native.eventCount = (node.native.eventCount ?? 0) + 1;
    const time = this.now();
    this.engine.events.emit(node, 'onChange', { text, eventCount: node.native.eventCount, target: node.id }, time);
    if (selection) this.engine.events.emit(node, 'onSelectionChange', { selection, target: node.id }, time);
    this.engine.markPaint();
  }

  clearText(node: HostNode): void {
    this.textChanged(node, '');
  }

  // ── commands (Pressable android_ripple → the view's RippleDrawable) ──

  command(node: HostNode, name: string, args: Record<string, unknown>): void {
    if (name !== 'setPressed') return;
    const x = typeof args.x === 'number' ? args.x : undefined;
    const y = typeof args.y === 'number' ? args.y : undefined;
    node.hostView?.setRipplePressed?.(!!args.pressed, x, y, (args.config ?? {}) as Record<string, unknown>);
  }

  // ── modal presentation ────────────────────────────────────────────────

  private modalVisibility(node: HostNode): void {
    const visible = node.props.visible !== false;
    if (node.native.visible === visible) return;
    node.native.visible = visible;
    const animation = node.props.animationType ?? 'none';
    const duration = animation === 'none' ? 0 : (this.engine.kit.tokens.modalDuration as number);
    node.native.modalTween = { from: node.native.modalProgress ?? 0, to: visible ? 1 : 0, start: this.now(), duration } satisfies Tween;
    this.applyPresentation(node, node.native.modalProgress ?? 0);
    this.engine.invalidateLayout();
    this.track(node);
  }

  private stepModal(node: HostNode, now: number): boolean {
    const tween = node.native.modalTween as Tween | undefined;
    if (!tween) return false;
    const t = tween.duration > 0 ? Math.min(1, (now - tween.start) / tween.duration) : 1;
    const p = tween.from + (tween.to - tween.from) * presentEase(t);
    node.native.modalProgress = p;
    this.applyPresentation(node, p);
    if (t >= 1) {
      node.native.modalTween = undefined;
      const time = this.now();
      if (tween.to === 1) this.engine.events.emit(node, 'onShow', { target: node.id }, time);
      else this.engine.events.emit(node, 'onDismiss', { target: node.id }, time);
      return false;
    }
    return true;
  }

  /** iOS page/form sheets on phones present as cards over a scaled-back app. */
  isSheet(node: HostNode): boolean {
    if (this.engine.kit.platform !== 'ios' || node.props.transparent) return false;
    const style = node.props.presentationStyle;
    return style === 'pageSheet' || style === 'formSheet';
  }

  modalFrame(node: HostNode): { x: number; y: number; w: number; h: number } {
    const v = this.engine.viewport;
    if (this.isSheet(node)) {
      const top = v.safeArea.top + (this.engine.kit.tokens.sheetTopGap as number);
      return { x: 0, y: top, w: v.width, h: v.height - top };
    }
    return { x: 0, y: 0, w: v.width, h: v.height };
  }

  private applyPresentation(node: HostNode, p: number): void {
    const animation = node.props.animationType ?? 'none';
    const v = this.engine.viewport;
    node.native.opacity = animation === 'fade' ? p : p > 0 || node.native.visible ? 1 : 0;
    node.native.presentation = animation === 'slide' ? translation(0, (1 - p) * v.height) : undefined;
    node.native.radius = this.isSheet(node) ? (this.engine.kit.tokens.sheetRadius as number) : 0;
    node.native.dim = this.isSheet(node) ? 0 : 0;
    if (!node.props.transparent && !node.computed.backgroundColor) {
      node.native.layer = true;
    }
    this.engine.markPaint();
  }

  /** The transform applied to the app behind an iOS page sheet. */
  presentingTransform(): { matrix: Matrix; radius: number; progress: number } | null {
    for (const modal of this.engine.visibleModals()) {
      if (!this.isSheet(modal) || this.engine.viewport.device.idiom !== 'phone') continue;
      const p = modal.native.modalProgress ?? 0;
      if (p <= 0) continue;
      const v = this.engine.viewport;
      const scale = 1 - (1 - (this.engine.kit.tokens.pageSheetScale as number)) * p;
      const dy = (v.safeArea.top - 10) * p;
      const m = multiply(translation(v.width / 2, dy), multiply(scaling(scale, scale), translation(-v.width / 2, 0)));
      return { matrix: m, radius: 10 * p, progress: p };
    }
    return null;
  }

  isModalShown(node: HostNode): boolean {
    return node.native.visible === true || (node.native.modalProgress ?? 0) > 0;
  }
}
