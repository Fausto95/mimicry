import { CompositeOp, Op, opName } from './opcodes';

const decoder = new TextDecoder();

/**
 * Cursor over a command stream. Payload values are addressed by word index,
 * which keeps the painter's switch statement flat and allocation free.
 */
export class CommandCursor {
  readonly view: DataView;
  readonly bytes: Uint8Array;
  private position: number;
  private readonly end: number;
  op = 0;
  /** byte offset of the current payload */
  payload = 0;
  /** payload length in words */
  words = 0;

  constructor(bytes: Uint8Array, start = 0, end = bytes.byteLength) {
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.position = start;
    this.end = end;
  }

  next(): boolean {
    if (this.position >= this.end) return false;
    const header = this.view.getUint32(this.position, true);
    this.op = header & 0xffff;
    this.words = header >>> 16;
    this.payload = this.position + 4;
    this.position = this.payload + this.words * 4;
    if (this.position > this.end) throw new Error(`truncated command ${opName(this.op)}`);
    return true;
  }

  f32(word: number): number {
    return this.view.getFloat32(this.payload + word * 4, true);
  }

  u32(word: number): number {
    return this.view.getUint32(this.payload + word * 4, true);
  }

  /** Reads a string that starts at payload word `word`. */
  string(word: number): string {
    const at = this.payload + word * 4;
    const length = this.view.getUint32(at, true);
    return decoder.decode(this.bytes.subarray(at + 4, at + 4 + length));
  }
}

const F = 'f';
const U = 'u';
const S = 's';
type Field = typeof F | typeof U | typeof S;

const layouts: Record<number, Field[]> = {
  [Op.Save]: [],
  [Op.Restore]: [],
  [Op.Transform]: [F, F, F, F, F, F],
  [Op.Alpha]: [F],
  [Op.ClipRect]: [F, F, F, F],
  [Op.ClipRRect]: [F, F, F, F, F, F, F, F],
  [Op.FillRect]: [F, F, F, F, U],
  [Op.FillRRect]: [F, F, F, F, F, F, F, F, U],
  [Op.StrokeRRect]: [F, F, F, F, F, F, F, F, F, U, U],
  [Op.FillRing]: [F, F, F, F, F, F, F, F, F, F, F, F, F, F, F, F, U],
  [Op.Shadow]: [U, F, F, F],
  [Op.ShadowClear]: [],
  [Op.BoxShadow]: [F, F, F, F, F, F, F, F, U, F, F, F, F, U],
  [Op.PathBegin]: [],
  [Op.MoveTo]: [F, F],
  [Op.LineTo]: [F, F],
  [Op.QuadTo]: [F, F, F, F],
  [Op.CubicTo]: [F, F, F, F, F, F],
  [Op.Arc]: [F, F, F, F, F, U],
  [Op.ClosePath]: [],
  [Op.FillPath]: [U, U],
  [Op.StrokePath]: [U, F, U, U],
  [Op.ClipPath]: [U],
  [Op.Font]: [S],
  [Op.Text]: [F, F, U, F, S],
  [Op.Image]: [F, F, F, F, F, F, F, F, U, S],
};

const round = (n: number) => Math.round(n * 100) / 100;
const hex = (n: number) => '#' + (n >>> 0).toString(16).padStart(8, '0');

export interface DisassembledCommand {
  op: string;
  args: Array<number | string>;
}

/**
 * Human-readable view of a chunk. Used by tests, the inspector's draw-list
 * panel and when debugging divergence between engine and host.
 */
export function disassemble(bytes: Uint8Array, start = 0, end = bytes.byteLength): DisassembledCommand[] {
  const cursor = new CommandCursor(bytes, start, end);
  const out: DisassembledCommand[] = [];
  while (cursor.next()) {
    const layout = layouts[cursor.op];
    const args: Array<number | string> = [];
    if (cursor.op === Op.StrokeStyle) {
      args.push(round(cursor.f32(0)), round(cursor.f32(1)));
      for (let i = 0; i < cursor.u32(2); i++) args.push(round(cursor.f32(3 + i)));
    } else if (cursor.op === Op.FillPathGradient || cursor.op === Op.StrokePathGradient) {
      const head = cursor.op === Op.FillPathGradient ? 1 : 3;
      for (let i = 0; i < head; i++) args.push(i === 0 && head === 3 ? round(cursor.f32(0)) : cursor.u32(i));
      args.push(cursor.u32(head) === 1 ? 'radial' : 'linear');
      for (let i = head + 1; i < head + 13; i++) args.push(round(cursor.f32(i)));
      const count = cursor.u32(head + 13);
      for (let i = 0; i < count; i++) args.push(round(cursor.f32(head + 14 + i * 2)), hex(cursor.u32(head + 15 + i * 2)));
    } else if (cursor.op === Op.LinearGradientRRect) {
      for (let i = 0; i < 12; i++) args.push(round(cursor.f32(i)));
      const count = cursor.u32(12);
      for (let i = 0; i < count; i++) args.push(round(cursor.f32(13 + i * 2)), hex(cursor.u32(14 + i * 2)));
    } else if (layout) {
      let word = 0;
      for (const field of layout) {
        if (field === F) args.push(round(cursor.f32(word++)));
        else if (field === U) {
          const value = cursor.u32(word++);
          // colors are the only u32 > 0xffff in practice
          args.push(value > 0xffff ? hex(value) : value);
        } else {
          args.push(cursor.string(word));
          word += 1 + ((cursor.u32(word) + 3) >> 2);
        }
      }
    }
    out.push({ op: opName(cursor.op), args });
  }
  return out;
}

export function disassembleComposite(bytes: Uint8Array): string[] {
  const cursor = new CommandCursor(bytes);
  const out: string[] = [];
  let depth = 0;
  while (cursor.next()) {
    const pad = '  '.repeat(depth);
    if (cursor.op === CompositeOp.Push) {
      const m = [1, 2, 3, 4, 5, 6].map((i) => round(cursor.f32(i)));
      out.push(`${pad}layer#${cursor.u32(0)} m=[${m.join(',')}] opacity=${round(cursor.f32(7))} clip=${cursor.u32(8)}`);
      depth++;
    } else if (cursor.op === CompositeOp.Chunk) {
      out.push(`${pad}chunk ${cursor.u32(0)}`);
    } else if (cursor.op === CompositeOp.Pop) {
      depth--;
    } else if (cursor.op === CompositeOp.Backdrop) {
      const r = [0, 1, 2, 3].map((i) => round(cursor.f32(i)));
      out.push(`${pad}backdrop [${r.join(',')}] blur=${round(cursor.f32(8))} saturation=${round(cursor.f32(9))}`);
    }
  }
  return out;
}
