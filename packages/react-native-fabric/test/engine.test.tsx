import React, { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { EstimatingTextMeasurer, layoutText, TEXT_OUTSIDE_TEXT_ERROR } from '@mimicry/react-native-fabric';
import { PanResponder, Pressable, ScrollView, Text, View } from 'react-native';
import { render } from '@mimicry/testing';

const style = (font = '400 10px Inter') => ({
  font, size: 10, color: 0, letterSpacing: 0, lineHeight: null, decoration: 0, decorationColor: null,
  background: 0, shadow: null, transform: 'none' as const, source: null,
});

describe('text layout', () => {
  const m = new EstimatingTextMeasurer();
  it('wraps at word boundaries and drops the wrapping space', () => {
    const l = layoutText([{ text: 'aaaa bbbb cccc', style: style() }], 60, {}, m);
    expect(l.lines.map((x) => x.runs.map((r) => r.text).join(''))).toEqual(['aaaa bbbb', 'cccc']);
  });
  it('breaks a word longer than the line by characters', () => {
    const l = layoutText([{ text: 'x'.repeat(40), style: style() }], 50, {}, m);
    expect(l.lines.length).toBeGreaterThan(2);
    expect(Math.max(...l.lines.map((x) => x.width))).toBeLessThanOrEqual(50.01);
  });
  it('ellipsizes the last allowed line', () => {
    const l = layoutText([{ text: 'one two three four five six seven', style: style() }], 60, { numberOfLines: 2 }, m);
    expect(l.lines).toHaveLength(2);
    expect(l.truncated).toBe(true);
    expect(l.lines[1]!.runs.at(-1)!.text.endsWith('…')).toBe(true);
  });
  it('keeps an explicit trailing newline as an empty line', () => {
    expect(layoutText([{ text: 'a\n', style: style() }], 100, {}, m).lines).toHaveLength(2);
  });
});

describe('React Native semantics', () => {
  it('rejects raw text outside <Text> with the React Native message', async () => {
    const s = await render(<View>{'oops'}</View>);
    expect(s.errors.map((e) => e.message)).toContain(TEXT_OUTSIDE_TEXT_ERROR);
    expect(s.exists({ testID: 'redbox' })).toBe(true);
    s.dispose();
  });

  it('lays out with React Native flex defaults (column, no shrink, stretch)', async () => {
    const s = await render(
      <View style={{ flex: 1, padding: 10 }}>
        <View testID="a" style={{ height: 50 }} />
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <View testID="b" style={{ flex: 1, height: 20 }} />
          <View testID="c" style={{ width: 100, height: 20 }} />
        </View>
        <View testID="d" style={{ position: 'absolute', right: 0, bottom: 0, width: '50%', aspectRatio: 2 }} />
      </View>,
      { device: 'iphone-se' },
    );
    const rect = (id: string) => s.find({ testID: id })[0]!.rect;
    expect(rect('a')).toEqual({ x: 10, y: 10, w: 355, h: 50 });
    expect(rect('b')).toEqual({ x: 10, y: 60, w: 245, h: 20 });
    expect(rect('c').x).toBe(265);
    // React Native quirk kept by Yoga's compatibility errata: absolute children respect the parent's padding.
    expect(rect('d')).toEqual({ x: 197.5, y: 578.5, w: 177.5, h: 88.5 });
    s.dispose();
  });

  it('a scroll view takes over from a pressable once the drag passes the slop', async () => {
    let presses = 0;
    let terminated = 0;
    function List() {
      return (
        <ScrollView testID="list" style={{ flex: 1 }}>
          {Array.from({ length: 40 }, (_, i) => (
            <Pressable key={i} testID={`row-${i}`} onPress={() => presses++} onPressOut={() => terminated++} style={{ height: 60 }}>
              <Text>Row {i}</Text>
            </Pressable>
          ))}
        </ScrollView>
      );
    }
    const s = await render(<List />);
    s.tap({ testID: 'row-3' });
    expect(presses).toBe(1);
    s.drag({ testID: 'row-6' }, { dx: 0, dy: -200 });
    expect(presses).toBe(1); // the drag became a scroll, not a press
    expect(terminated).toBeGreaterThanOrEqual(2);
    s.dispose();
  });

  it('PanResponder receives gesture deltas', async () => {
    const moves: number[] = [];
    function Draggable() {
      const [pan] = useState(() =>
        PanResponder.create({
          onStartShouldSetPanResponder: () => true,
          onPanResponderMove: (_e, g) => moves.push(Math.round(g.dx)),
        }),
      );
      return <View testID="box" {...pan.panHandlers} style={{ width: 100, height: 100, marginTop: 100 }} />;
    }
    const s = await render(<Draggable />);
    s.drag({ testID: 'box' }, { dx: 80, dy: 0 }, { steps: 4 });
    expect(moves.at(-1)).toBe(80);
    s.dispose();
  });
});
