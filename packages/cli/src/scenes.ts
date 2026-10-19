import type { Session, Target } from '@mimicry/testing';

/**
 * Scenes are the shared language between Mimicry and the oracle: the same
 * JSON drives a headless engine render and (offline, on a Mac) a real
 * simulator capture, so the two screenshots are comparable.
 */
export type SceneStep =
  | { tap: Target }
  | { longPress: Target }
  | { scroll: Target; dy?: number; dx?: number }
  | { drag: Target; dx: number; dy: number; duration?: number }
  | { type: Target; text: string }
  | { back: true }
  | { wait: number }
  | { appearance: 'light' | 'dark' }
  | { orientation: 'portrait' | 'landscape' };

export interface Scene {
  name: string;
  device?: string;
  appearance?: 'light' | 'dark';
  orientation?: 'portrait' | 'landscape';
  steps?: SceneStep[];
  /** filmstrip sampling; for motion scenes, how long to record after the trigger */
  duration?: number;
  every?: number;
  /** motion scenes (scenes/motion/*.json): the step whose animation is recorded, after `steps` set up */
  trigger?: SceneStep;
}

export function runStep(session: Session, step: SceneStep): void {
  if ('tap' in step) session.tap(step.tap);
  else if ('longPress' in step) session.longPress(step.longPress);
  else if ('scroll' in step) session.scroll(step.scroll, { dx: step.dx, dy: step.dy }).settle();
  else if ('drag' in step) session.drag(step.drag, { dx: step.dx, dy: step.dy }, { duration: step.duration });
  else if ('type' in step) session.type(step.type, step.text);
  else if ('back' in step) session.back();
  else if ('wait' in step) session.advance(step.wait);
  else if ('appearance' in step) session.setEnvironment({ appearance: step.appearance });
  else if ('orientation' in step) session.setEnvironment({ orientation: step.orientation });
}
