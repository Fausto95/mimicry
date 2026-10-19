import React, { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { PNG } from 'pngjs';
import { requireNativeComponent, View } from 'react-native';
import { render, type Session } from '@mimicry/testing';
import { disassembleComposite } from '@mimicry/protocol';

const BlurView = requireNativeComponent('ExpoBlur_ExpoBlurView') as React.ComponentType<any>;
const GlassView = requireNativeComponent('ExpoGlassEffect_GlassView') as React.ComponentType<any>;

function pixel(s: Session, x: number, y: number): [number, number, number] {
  const png = PNG.sync.read(s.screenshot(1));
  const i = (Math.round(y) * png.width + Math.round(x)) * 4;
  return [png.data[i]!, png.data[i + 1]!, png.data[i + 2]!];
}

/** Left half red, right half blue, with something layered on top across the seam at x = 201. */
function Stripes({ children, left = 'red' }: { children?: React.ReactNode; left?: string }) {
  return (
    <View style={{ flex: 1, flexDirection: 'row' }}>
      <View style={{ flex: 1, backgroundColor: left }} />
      <View style={{ flex: 1, backgroundColor: 'blue' }} />
      {children}
    </View>
  );
}

const overlay = { position: 'absolute', left: 101, top: 300, width: 200, height: 200 } as const;

describe('backdrop material', () => {
  it('blurs what is painted beneath a view with the backdrop prop', async () => {
    const s = await render(<Stripes><View testID="b" backdrop={{ blur: 20, saturation: 1 }} style={overlay} /></Stripes>);
    // Outside the material the seam is sharp…
    expect(pixel(s, 199, 200)).toEqual([255, 0, 0]);
    // …inside it, colors bleed across the seam.
    const [r, , b] = pixel(s, 199, 400);
    expect(r).toBeGreaterThan(60);
    expect(b).toBeGreaterThan(60);
    s.dispose();
  });

  it('is a composite-time effect that tracks content changing beneath it', async () => {
    let swap!: () => void;
    function Scene() {
      const [left, setLeft] = useState('red');
      swap = () => setLeft('lime');
      return <Stripes left={left}><View backdrop={{ blur: 20 }} style={overlay} /></Stripes>;
    }
    const s = await render(<Scene />);
    expect(pixel(s, 160, 400)[0]).toBeGreaterThan(150);
    const { act } = await import('react');
    act(() => swap());
    s.settle();
    const [r, g] = pixel(s, 160, 400);
    expect(g).toBeGreaterThan(150);
    expect(r).toBeLessThan(80);
    // the protocol carries it as a composite op, not inside a cached chunk
    const frame = s.engine.paintNow();
    const { decodeFrame } = await import('@mimicry/protocol');
    const decoded = decodeFrame(frame);
    const composite = disassembleComposite(decoded.bytes.subarray(decoded.compositeStart, decoded.compositeEnd));
    expect(composite.some((l) => l.includes('backdrop'))).toBe(true);
    s.dispose();
  });

  it('expo-blur BlurView: blur plus the tint of its style', async () => {
    const s = await render(<Stripes><BlurView tint="light" intensity={100} style={overlay} /></Stripes>);
    const [r, g, b] = pixel(s, 199, 400);
    // light tint over a red/blue mix: bright, with both hues present
    expect(g).toBeGreaterThan(150);
    expect(r).toBeGreaterThan(180);
    expect(b).toBeGreaterThan(180);
    s.dispose();
  });

  it('expo-blur on Android without a blur method is a tint only, like on device', async () => {
    const s = await render(<Stripes><BlurView tint="dark" intensity={100} style={overlay} /></Stripes>, { device: 'pixel-9' });
    const seam = s.engine.viewport.width / 2;
    const [, , b] = pixel(s, 260, 400);
    const [r] = pixel(s, 140, 400);
    // no bleed across the seam
    expect(pixel(s, seam + 3, 400)[0]).toBeLessThan(40);
    expect(b).toBeGreaterThan(20);
    expect(r).toBeGreaterThan(20);
    s.dispose();
  });

  it('expo-glass-effect GlassView: frosted, rounded, and plain when the style is none', async () => {
    const s = await render(<Stripes><GlassView glassEffectStyle="regular" style={{ ...overlay, borderRadius: 30 }} /></Stripes>);
    const [r, , b] = pixel(s, 199, 400);
    expect(r).toBeGreaterThan(100);
    expect(b).toBeGreaterThan(100);
    // the rounded corner leaves the backdrop unblurred (only the soft shadow reaches it)
    const corner = pixel(s, 102, 301);
    expect(corner[0]).toBeGreaterThan(235);
    expect(corner[2]).toBeLessThan(15);
    s.dispose();
    const plain = await render(<Stripes><GlassView glassEffectStyle="none" style={overlay} /></Stripes>);
    expect(pixel(plain, 199, 400)).toEqual([255, 0, 0]);
    plain.dispose();
  });
});
