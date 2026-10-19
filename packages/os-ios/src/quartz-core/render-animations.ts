import type { FrameTask, Kernel } from '@mimicry/os-core';
import { mediaNow } from './ca-media-time';

/**
 * The render server's side of Core Animation: the layers with animations
 * attached, stepped once per frame on the kernel's animator. Stepping
 * starts and stops animations (delegate callbacks, removal on completion,
 * transaction completion blocks) and asks for a frame; the values
 * themselves are evaluated when the layer tree is drawn (see CALayer).
 */
export interface AnimatedLayer {
  /** start/stop animations due by `now` (ms); false once none are left */
  _stepAnimations(now: number): boolean;
  setNeedsDisplay(): void;
}

class LayerAnimations implements FrameTask {
  readonly layers = new Set<AnimatedLayer>();

  constructor(private readonly kernel: Kernel) {}

  tick(): boolean {
    const now = mediaNow(this.kernel);
    for (const layer of Array.from(this.layers)) {
      if (!layer._stepAnimations(now)) this.layers.delete(layer);
      layer.setNeedsDisplay();
    }
    return this.layers.size > 0;
  }
}

const engines = new WeakMap<Kernel, LayerAnimations>();

/** Make sure `layer`'s animations are stepped on `kernel`'s frames. */
export function scheduleAnimations(kernel: Kernel, layer: AnimatedLayer): void {
  let engine = engines.get(kernel);
  if (!engine) engines.set(kernel, (engine = new LayerAnimations(kernel)));
  engine.layers.add(layer);
  kernel.animator.add(engine);
  kernel.setNeedsDisplay();
}

/** How many layers have animations attached (drawing skips presentation work when none do). */
export const animationCensus = { layers: 0 };
