import type { CommandWriter } from '@mimicry/protocol';

/**
 * SVG path data → draw commands, used by the `m-path` host component
 * (icons, system glyphs and the react-native-svg subset). Arcs are converted
 * to cubic béziers so hosts only need move/line/quad/cubic.
 */
type Emit = { moveTo(x: number, y: number): void; lineTo(x: number, y: number): void; quadTo(a: number, b: number, x: number, y: number): void; cubicTo(a: number, b: number, c: number, d: number, x: number, y: number): void; close(): void };

const NUMBER = /-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi;

export function parsePath(d: string, emit: Emit): void {
  const commands = d.match(/[a-df-z][^a-df-z]*/gi) ?? [];
  let x = 0;
  let y = 0;
  let sx = 0;
  let sy = 0;
  let lastCtrlX = 0;
  let lastCtrlY = 0;
  let lastCmd = '';
  for (const chunk of commands) {
    const cmd = chunk[0]!;
    const nums = (chunk.slice(1).match(NUMBER) ?? []).map(Number);
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
    let i = 0;
    const take = (n: number) => {
      const out = nums.slice(i, i + n);
      i += n;
      return out;
    };
    do {
      switch (C) {
        case 'M': {
          const [a, b] = take(2);
          if (a === undefined || b === undefined) break;
          x = rel ? x + a : a;
          y = rel ? y + b : b;
          sx = x;
          sy = y;
          emit.moveTo(x, y);
          // subsequent pairs are implicit lineTo
          while (i + 1 < nums.length) {
            const [c, e] = take(2);
            x = rel ? x + c! : c!;
            y = rel ? y + e! : e!;
            emit.lineTo(x, y);
          }
          break;
        }
        case 'L': {
          const [a, b] = take(2);
          if (b === undefined) break;
          x = rel ? x + a! : a!;
          y = rel ? y + b : b;
          emit.lineTo(x, y);
          break;
        }
        case 'H': {
          const [a] = take(1);
          if (a === undefined) break;
          x = rel ? x + a : a;
          emit.lineTo(x, y);
          break;
        }
        case 'V': {
          const [a] = take(1);
          if (a === undefined) break;
          y = rel ? y + a : a;
          emit.lineTo(x, y);
          break;
        }
        case 'C': {
          const p = take(6);
          if (p.length < 6) break;
          const [x1, y1, x2, y2, ex, ey] = rel ? [x + p[0]!, y + p[1]!, x + p[2]!, y + p[3]!, x + p[4]!, y + p[5]!] : p as number[];
          emit.cubicTo(x1!, y1!, x2!, y2!, ex!, ey!);
          lastCtrlX = x2!;
          lastCtrlY = y2!;
          x = ex!;
          y = ey!;
          break;
        }
        case 'S': {
          const p = take(4);
          if (p.length < 4) break;
          const reflect = lastCmd === 'C' || lastCmd === 'S';
          const x1 = reflect ? 2 * x - lastCtrlX : x;
          const y1 = reflect ? 2 * y - lastCtrlY : y;
          const [x2, y2, ex, ey] = rel ? [x + p[0]!, y + p[1]!, x + p[2]!, y + p[3]!] : p as number[];
          emit.cubicTo(x1, y1, x2!, y2!, ex!, ey!);
          lastCtrlX = x2!;
          lastCtrlY = y2!;
          x = ex!;
          y = ey!;
          break;
        }
        case 'Q': {
          const p = take(4);
          if (p.length < 4) break;
          const [x1, y1, ex, ey] = rel ? [x + p[0]!, y + p[1]!, x + p[2]!, y + p[3]!] : p as number[];
          emit.quadTo(x1!, y1!, ex!, ey!);
          lastCtrlX = x1!;
          lastCtrlY = y1!;
          x = ex!;
          y = ey!;
          break;
        }
        case 'T': {
          const p = take(2);
          if (p.length < 2) break;
          const reflect = lastCmd === 'Q' || lastCmd === 'T';
          const x1 = reflect ? 2 * x - lastCtrlX : x;
          const y1 = reflect ? 2 * y - lastCtrlY : y;
          const [ex, ey] = rel ? [x + p[0]!, y + p[1]!] : p as number[];
          emit.quadTo(x1, y1, ex!, ey!);
          lastCtrlX = x1;
          lastCtrlY = y1;
          x = ex!;
          y = ey!;
          break;
        }
        case 'A': {
          const p = take(7);
          if (p.length < 7) break;
          const ex = rel ? x + p[5]! : p[5]!;
          const ey = rel ? y + p[6]! : p[6]!;
          arcToBeziers(x, y, p[0]!, p[1]!, p[2]!, !!p[3], !!p[4], ex, ey, emit);
          x = ex;
          y = ey;
          break;
        }
        case 'Z':
          emit.close();
          x = sx;
          y = sy;
          break;
      }
      lastCmd = C;
    } while (i < nums.length && C !== 'Z' && C !== 'M');
  }
}

function arcToBeziers(
  x1: number, y1: number, rx: number, ry: number, angle: number, large: boolean, sweep: boolean, x2: number, y2: number, emit: Emit,
): void {
  if (rx === 0 || ry === 0) {
    emit.lineTo(x2, y2);
    return;
  }
  const phi = (angle * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const dx = (x1 - x2) / 2;
  const dy = (y1 - y2) / 2;
  const x1p = cos * dx + sin * dy;
  const y1p = -sin * dx + cos * dy;
  rx = Math.abs(rx);
  ry = Math.abs(ry);
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    rx *= Math.sqrt(lambda);
    ry *= Math.sqrt(lambda);
  }
  const sign = large === sweep ? -1 : 1;
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const coef = sign * Math.sqrt(Math.max(0, num / (rx * rx * y1p * y1p + ry * ry * x1p * x1p)));
  const cxp = (coef * rx * y1p) / ry;
  const cyp = (-coef * ry * x1p) / rx;
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2;
  const cy = sin * cxp + cos * cyp + (y1 + y2) / 2;
  const angleOf = (ux: number, uy: number, vx: number, vy: number) => {
    const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    return a;
  };
  const theta1 = angleOf(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let delta = angleOf((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!sweep && delta > 0) delta -= Math.PI * 2;
  if (sweep && delta < 0) delta += Math.PI * 2;
  const segments = Math.ceil(Math.abs(delta) / (Math.PI / 2));
  const step = delta / segments;
  const t = (4 / 3) * Math.tan(step / 4);
  let a = theta1;
  for (let i = 0; i < segments; i++) {
    const b = a + step;
    const p = (th: number) => [Math.cos(th), Math.sin(th)] as const;
    const [c1, s1] = p(a);
    const [c2, s2] = p(b);
    // ellipse radii are applied per axis before rotation
    const mapped = [
      [c1 - t * s1, s1 + t * c1],
      [c2 + t * s2, s2 - t * c2],
      [c2, s2],
    ].map(([ux, uy]) => {
      const ex = rx * ux!;
      const ey = ry * uy!;
      return [cx + cos * ex - sin * ey, cy + sin * ex + cos * ey] as const;
    });
    emit.cubicTo(mapped[0]![0], mapped[0]![1], mapped[1]![0], mapped[1]![1], mapped[2]![0], mapped[2]![1]);
    a = b;
  }
}

/** Emits a parsed path into a command writer, mapping viewBox → box. */
export function writePath(w: CommandWriter, d: string, map: (x: number, y: number) => [number, number]): void {
  w.pathBegin();
  parsePath(d, {
    moveTo: (x, y) => w.moveTo(...map(x, y)),
    lineTo: (x, y) => w.lineTo(...map(x, y)),
    quadTo: (a, b, x, y) => {
      const [p, q] = map(a, b);
      const [r, s] = map(x, y);
      w.quadTo(p, q, r, s);
    },
    cubicTo: (a, b, c, d2, x, y) => {
      const [p, q] = map(a, b);
      const [r, s] = map(c, d2);
      const [u, v] = map(x, y);
      w.cubicTo(p, q, r, s, u, v);
    },
    close: () => w.closePath(),
  });
}
