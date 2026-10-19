import { describe, expect, it } from 'vitest';
import {
  CommandWriter, FrameEncoder, NO_CLIP, OverlayKind, decodeFrame, disassemble,
  disassembleComposite, hashBytes, chunkHash, rgba, toCss, mixColor,
} from '../src';

describe('command stream', () => {
  it('round-trips commands through the disassembler', () => {
    const w = new CommandWriter();
    w.save().fillRRect(1, 2, 30, 40, [4, 4, 4, 4], rgba(255, 0, 0)).font('600 17px Inter')
      .text(10, 20, rgba(0, 0, 0), 0, 'Hello, 世界').restore();
    const ops = disassemble(w.finish());
    expect(ops.map((o) => o.op)).toEqual(['Save', 'FillRRect', 'Font', 'Text', 'Restore']);
    expect(ops[1]!.args).toEqual([1, 2, 30, 40, 4, 4, 4, 4, '#ff0000ff']);
    expect(ops[3]!.args.at(-1)).toBe('Hello, 世界');
  });

  it('hashes by content only', () => {
    const make = (y: number) => new CommandWriter().fillRect(0, y, 10, 10, rgba(1, 2, 3)).finish();
    expect(hashBytes(make(5))).toBe(hashBytes(make(5)));
    expect(hashBytes(make(5))).not.toBe(hashBytes(make(6)));
    expect(Number.isSafeInteger(hashBytes(make(5)))).toBe(true);
  });
});

describe('frames', () => {
  it('encodes chunks, composition and overlays', () => {
    const frame = new FrameEncoder(7, 402, 874, 3);
    const a = new CommandWriter().fillRect(0, 0, 402, 874, rgba(255, 255, 255)).finish();
    const b = new CommandWriter().text(0, 12, rgba(0, 0, 0), 0, 'row').finish();
    frame.push(1, [1, 0, 0, 1, 0, 0], 1, NO_CLIP);
    const ia = frame.addChunk(a, { x: 0, y: 0, w: 402, h: 874 });
    frame.drawChunk(ia);
    frame.push(2, [1, 0, 0, 1, 0, -120], 0.5, { kind: 1, x: 0, y: 100, w: 402, h: 600, radii: [0, 0, 0, 0] });
    frame.drawChunk(frame.addChunk(b, { x: 0, y: 0, w: 30, h: 16 }));
    expect(frame.addChunk(b, { x: 0, y: 0, w: 30, h: 16 })).toBe(1); // deduplicated
    frame.pop();
    frame.pop();
    frame.overlay({ nodeId: 42, kind: OverlayKind.TextInput, x: 16, y: 300, w: 370, h: 44, props: { value: 'hi' } });

    const decoded = decodeFrame(frame.finish());
    expect(decoded.id).toBe(7);
    expect(decoded.scale).toBe(3);
    expect(decoded.chunks).toHaveLength(2);
    expect(decoded.chunks[1]!.hash).toBe(chunkHash(b, { x: 0, y: 0, w: 30, h: 16 }));
    expect(disassemble(decoded.bytes, decoded.chunks[1]!.start, decoded.chunks[1]!.end)[0]!.args.at(-1)).toBe('row');
    expect(decoded.overlays[0]).toMatchObject({ nodeId: 42, w: 370, props: { value: 'hi' } });
    expect(disassembleComposite(decoded.bytes.subarray(decoded.compositeStart, decoded.compositeEnd))).toEqual([
      'layer#1 m=[1,0,0,1,0,0] opacity=1 clip=0',
      '  chunk 0',
      '  layer#2 m=[1,0,0,1,0,-120] opacity=0.5 clip=1',
      '    chunk 1',
    ]);
  });
});

describe('colors', () => {
  it('packs and mixes', () => {
    expect(toCss(rgba(0, 122, 255, 0.5))).toBe('rgba(0,122,255,0.502)');
    expect(mixColor(rgba(0, 0, 0), rgba(255, 255, 255), 0.5)).toBe(rgba(128, 128, 128));
  });
});
