import { hashBytes, hashHi, hashLo, joinHash } from './hash';
import { CompositeWriter, WordWriter, type ClipSpec, type Radii } from './writer';

/**
 * Frame wire format (all little-endian, 4-byte aligned):
 *
 *   header      10 words: magic, version, frameId, width, height, scale,
 *               chunkCount, compositeBytes, overlayBytes, chunkDataBytes
 *   chunkTable  chunkCount × 8 words: hashLo hashHi x y w h offset length
 *   composite   layer tree (CompositeOp commands)
 *   overlays    native controls: nodeId kind x y w h json
 *   chunkData   concatenated draw-command chunks
 *
 * A chunk is a self-contained run of draw commands in its layer's coordinate
 * space. Its hash is computed over its bytes only, so the host can keep the
 * raster of any chunk it has seen and composite it again for free.
 */
export const FRAME_MAGIC = 0x4d494d43; // "CMIM" little-endian → reads "MIMC"
export const PROTOCOL_VERSION = 1;
const HEADER_WORDS = 10;
const CHUNK_WORDS = 8;

export interface Bounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ChunkRecord extends Bounds {
  hash: number;
  /** byte range of the chunk's commands inside DecodedFrame.bytes */
  start: number;
  end: number;
}

export interface OverlayRecord<P = Record<string, unknown>> extends Bounds {
  nodeId: number;
  kind: number;
  props: P;
}

export interface DecodedFrame {
  id: number;
  width: number;
  height: number;
  scale: number;
  chunks: ChunkRecord[];
  compositeStart: number;
  compositeEnd: number;
  overlays: OverlayRecord[];
  bytes: Uint8Array;
}

/**
 * A chunk's identity is its commands *and* its raster bounds: the same
 * commands rasterized over a different region are a different bitmap.
 */
export function chunkHash(bytes: Uint8Array, bounds: Bounds): number {
  const tail = new Uint8Array(16);
  const view = new DataView(tail.buffer);
  view.setFloat32(0, bounds.x, true);
  view.setFloat32(4, bounds.y, true);
  view.setFloat32(8, bounds.w, true);
  view.setFloat32(12, bounds.h, true);
  const h = hashBytes(bytes);
  const t = hashBytes(tail);
  return (h + t * 31) % 9007199254740991;
}

/** Engine-side frame assembly. */
export class FrameEncoder {
  readonly composite = new CompositeWriter(2048);
  private readonly chunkTable = new WordWriter(1024);
  private readonly overlays = new WordWriter(256);
  private readonly chunkData = new WordWriter(16384);
  private readonly chunkIndexByHash = new Map<number, number>();
  private chunkCount = 0;

  constructor(
    readonly id: number,
    readonly width: number,
    readonly height: number,
    readonly scale: number,
  ) {}

  /** Adds a chunk (deduplicated by content) and returns its index. */
  addChunk(bytes: Uint8Array, bounds: Bounds, hash = chunkHash(bytes, bounds)): number {
    const existing = this.chunkIndexByHash.get(hash);
    if (existing !== undefined) return existing;
    const offset = this.chunkData.byteLength;
    this.chunkData.raw(bytes);
    this.chunkTable
      .u32(hashLo(hash)).u32(hashHi(hash))
      .f32(bounds.x).f32(bounds.y).f32(bounds.w).f32(bounds.h)
      .u32(offset).u32(bytes.byteLength);
    const index = this.chunkCount++;
    this.chunkIndexByHash.set(hash, index);
    return index;
  }

  push(layerId: number, matrix: readonly number[], opacity: number, clip: ClipSpec): void {
    this.composite.push(layerId, matrix, opacity, clip);
  }

  drawChunk(index: number): void {
    this.composite.chunk(index);
  }

  pop(): void {
    this.composite.pop();
  }

  /** Blur what is composited beneath, inside a rounded rect of the current layer (see CompositeOp.Backdrop). */
  backdrop(rect: Bounds, radii: Radii, blur: number, saturation: number): void {
    this.composite.backdrop(rect.x, rect.y, rect.w, rect.h, radii, blur, saturation);
  }

  overlay(record: OverlayRecord): void {
    this.overlays
      .u32(record.nodeId).u32(record.kind)
      .f32(record.x).f32(record.y).f32(record.w).f32(record.h)
      .string(JSON.stringify(record.props));
  }

  get chunks(): number {
    return this.chunkCount;
  }

  finish(): ArrayBuffer {
    const composite = this.composite.finish();
    const table = this.chunkTable.finish();
    const overlays = this.overlays.finish();
    const data = this.chunkData.finish();
    const out = new WordWriter(HEADER_WORDS * 4 + table.byteLength + composite.byteLength + overlays.byteLength + data.byteLength);
    out
      .u32(FRAME_MAGIC).u32(PROTOCOL_VERSION).u32(this.id)
      .f32(this.width).f32(this.height).f32(this.scale)
      .u32(this.chunkCount).u32(composite.byteLength).u32(overlays.byteLength).u32(data.byteLength);
    out.raw(table).raw(composite).raw(overlays).raw(data);
    const bytes = out.finish();
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  }
}

const decoder = new TextDecoder();

export function decodeFrame(buffer: ArrayBuffer | Uint8Array): DecodedFrame {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u32 = (at: number) => view.getUint32(at, true);
  const f32 = (at: number) => view.getFloat32(at, true);
  if (u32(0) !== FRAME_MAGIC) throw new Error('not a Mimicry frame');
  const version = u32(4);
  if (version !== PROTOCOL_VERSION) throw new Error(`unsupported protocol version ${version}`);
  const chunkCount = u32(24);
  const compositeBytes = u32(28);
  const overlayBytes = u32(32);
  const tableStart = HEADER_WORDS * 4;
  const compositeStart = tableStart + chunkCount * CHUNK_WORDS * 4;
  const overlayStart = compositeStart + compositeBytes;
  const dataStart = overlayStart + overlayBytes;

  const chunks: ChunkRecord[] = new Array(chunkCount);
  for (let i = 0; i < chunkCount; i++) {
    const at = tableStart + i * CHUNK_WORDS * 4;
    const offset = u32(at + 24);
    chunks[i] = {
      hash: joinHash(u32(at), u32(at + 4)),
      x: f32(at + 8), y: f32(at + 12), w: f32(at + 16), h: f32(at + 20),
      start: dataStart + offset,
      end: dataStart + offset + u32(at + 28),
    };
  }

  const overlays: OverlayRecord[] = [];
  let at = overlayStart;
  while (at < dataStart) {
    const length = u32(at + 24);
    const json = decoder.decode(bytes.subarray(at + 28, at + 28 + length));
    overlays.push({
      nodeId: u32(at), kind: u32(at + 4),
      x: f32(at + 8), y: f32(at + 12), w: f32(at + 16), h: f32(at + 20),
      props: JSON.parse(json),
    });
    at += 28 + ((length + 3) & ~3);
  }

  return {
    id: u32(8),
    width: f32(12),
    height: f32(16),
    scale: f32(20),
    chunks,
    compositeStart,
    compositeEnd: overlayStart,
    overlays,
    bytes,
  };
}
