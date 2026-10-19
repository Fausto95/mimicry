/**
 * The damped harmonic oscillator behind CASpringAnimation, UIKit's spring
 * animations and UISpringTimingParameters, solved in closed form:
 *
 *   m·x'' + c·x' + k·x = 0,   x(0) = 1 (the whole distance left), x'(0) = -v0
 *
 * where v0 is the initial velocity in "distances per second" (positive
 * towards the target, as CASpringAnimation.initialVelocity). Progress is
 * 1 - x(t); it overshoots 1 when the spring is underdamped.
 */
export interface SpringParameters {
  mass: number;
  stiffness: number;
  damping: number;
  /** distances per second towards the target */
  initialVelocity: number;
}

/** Progress (0 → 1, may overshoot) `t` seconds into the motion. */
export function springProgress(p: SpringParameters, t: number): number {
  if (t <= 0) return 0;
  const m = Math.max(1e-6, p.mass);
  const k = Math.max(1e-6, p.stiffness);
  const w0 = Math.sqrt(k / m);
  const zeta = p.damping / (2 * Math.sqrt(k * m));
  const x0 = 1;
  const v0 = -p.initialVelocity;
  let x: number;
  if (zeta < 1 - 1e-9) {
    const wd = w0 * Math.sqrt(1 - zeta * zeta);
    const envelope = Math.exp(-zeta * w0 * t);
    x = envelope * (x0 * Math.cos(wd * t) + ((v0 + zeta * w0 * x0) / wd) * Math.sin(wd * t));
  } else if (zeta > 1 + 1e-9) {
    const wd = w0 * Math.sqrt(zeta * zeta - 1);
    const envelope = Math.exp(-zeta * w0 * t);
    x = envelope * (x0 * Math.cosh(wd * t) + ((v0 + zeta * w0 * x0) / wd) * Math.sinh(wd * t));
  } else {
    x = Math.exp(-w0 * t) * (x0 + (v0 + w0 * x0) * t);
  }
  return 1 - x;
}

/**
 * CASpringAnimation.settlingDuration: how long until the spring stays within
 * 0.1% of its target (and its velocity is negligible), in seconds.
 */
export function springSettlingDuration(p: SpringParameters): number {
  const step = 1 / 600;
  let lastOutside = 0;
  // Ten simulated seconds is ample for any spring a UI uses; CA caps it too.
  for (let t = step; t < 10; t += step) {
    const x = 1 - springProgress(p, t);
    const v = (springProgress(p, t + 1e-4) - springProgress(p, t)) / 1e-4;
    if (Math.abs(x) > 1e-3 || Math.abs(v) > 1e-2) lastOutside = t;
    else if (t - lastOutside > 0.5) break;
  }
  return Math.ceil((lastOutside + step) * 1000) / 1000;
}

/**
 * iOS 17's perceptual parameterization (SwiftUI's / UIKit's
 * `springDuration`+`bounce`): duration is the period of the undamped
 * spring, bounce 0 is critically damped, positive values bounce, negative
 * ones are overdamped.
 */
export function perceptualSpring(duration: number, bounce: number, initialVelocity = 0): SpringParameters {
  const d = Math.max(0.01, duration);
  const stiffness = (2 * Math.PI / d) ** 2;
  const ratio = bounce >= 0 ? 1 - bounce : 1 / (1 + bounce);
  return { mass: 1, stiffness, damping: (4 * Math.PI * ratio) / d, initialVelocity };
}

/**
 * The spring behind `animate(withDuration:delay:usingSpringWithDamping:…)`:
 * UIKit picks the stiffness so that the motion has settled when `duration`
 * runs out, for the given damping ratio, and ends the animation there.
 */
export function dampingRatioSpring(duration: number, dampingRatio: number, initialVelocity: number): SpringParameters {
  const zeta = Math.max(0.01, dampingRatio);
  const d = Math.max(0.01, duration);
  // The envelope e^(-ζ·ω0·t) reaches 0.1% at t = duration (ln(1000) ≈ 6.9).
  const w0 = Math.min(6.9 / (zeta * d), 400);
  return { mass: 1, stiffness: w0 * w0, damping: 2 * zeta * w0, initialVelocity };
}
