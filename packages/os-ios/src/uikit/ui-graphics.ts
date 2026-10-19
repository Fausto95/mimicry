import type { CGContext } from '../core-graphics/context';

/**
 * UIKit's graphics context stack: UIGraphicsGetCurrentContext() is the
 * context of the `draw(_:)` running now, which is where NSString /
 * NSAttributedString drawing and UIImage.draw(in:) go.
 */
const stack: CGContext[] = [];

export function UIGraphicsPushContext(context: CGContext): void {
  stack.push(context);
}

export function UIGraphicsPopContext(): void {
  stack.pop();
}

export function UIGraphicsGetCurrentContext(): CGContext | null {
  return stack[stack.length - 1] ?? null;
}
