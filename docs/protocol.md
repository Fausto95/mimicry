# Frame protocol

One frame is one `ArrayBuffer`, transferred from the engine worker to the host without copying. Everything is little-endian and 4-byte aligned. Coordinates are float32 logical points, and colors are packed RGBA `uint32` (`0xRRGGBBAA`).

```
header      magic "MIMC" · version · frameId · width · height · scale
            chunkCount · compositeBytes · overlayBytes · chunkDataBytes
chunkTable  chunkCount × [hashLo hashHi x y w h offset length]
composite   the layer tree (composite commands)
overlays    native controls: nodeId kind x y w h json
chunkData   concatenated draw-command chunks
```

## Commands

Every command is a header word `opcode | payloadWords << 16` followed by its payload. Because the length travels with the command, a host can skip opcodes it does not know, and the engine can add commands without breaking older hosts. Strings are `u32 byteLength` plus UTF-8 bytes padded to a word.

| Group | Commands |
| --- | --- |
| State | `Save` `Restore` `Transform a b c d e f` `Alpha` `ClipRect` `ClipRRect` |
| Shapes | `FillRect` `FillRRect` `StrokeRRect` (solid/dashed/dotted) `FillRing` (per-side borders) `LinearGradientRRect` |
| Shadows | `Shadow`/`ShadowClear` (text, controls) and `BoxShadow` (CSS semantics: outset not drawn under the box, inset clipped to it; also used for iOS `shadow*` and Android `elevation`) |
| Paths | `PathBegin` `MoveTo` `LineTo` `QuadTo` `CubicTo` `Arc` `ClosePath` `FillPath` `StrokePath` `ClipPath` |
| Text | `Font css` · `Text x baseline color letterSpacing string`: single, pre-positioned runs only |
| Images | `Image dx dy dw dh sx sy sw sh tint uri`: emitted only after the host confirmed the image loaded |

`disassemble(bytes)` in `@mimicry/protocol` prints any chunk in readable form.

## Composition

```
Push  layerId · matrix(6) · opacity · clip(kind, rect, radii)   clip is in the parent's space
Chunk index
Pop
Backdrop  rect(4) · radii(4) · blurRadius · saturation              in the current layer's space
```

`Backdrop` blurs and saturates whatever has already been composited beneath it, inside the rounded rect (blur and glass materials). Because the result depends on the content behind it, it is evaluated at composite time and is never part of a cached raster; a tint or highlight over the material is an ordinary chunk drawn after it. Pixels past the surface edge are extended rather than blurred in as transparency.

A layer's content is drawn in paint order: chunks and child layers interleave, so z-order holds across layer boundaries. A layer with opacity < 1 and more than one draw inside is rendered to a surface and composited once, which gives group opacity as on iOS and Android.

## Chunk identity and caching

A chunk's hash covers its command bytes and its raster bounds, never its position in the frame. Commands are in their layer's coordinate space, so:

- **scrolling** changes only the scroll content layer's matrix, and every visible tile is a cache hit;
- **transform and opacity animations** change only composite values;
- **live content** (a spinner, the switch being toggled) re-rasterizes only its own small chunk.

Hosts rasterize at the device's own scale. Chunk bounds and tiles are snapped to that pixel grid, and translations are snapped when compositing, so cached rasters stay crisp. Chunks larger than the host's limit are painted directly instead of cached.

## Messages

`HostMessage` and `EngineMessage` in `packages/protocol/src/messages.ts` define the control plane:

- **Host to engine:** boot, frame ticks, pointer and wheel input, text-input changes from native overlays, environment changes, image load results, hot updates, inspection and hit-test requests, Android back, animation time scale.
- **Engine to host:** frames with stats, frame requests, image loads, logs and errors, focus changes for native inputs, inspection results.
