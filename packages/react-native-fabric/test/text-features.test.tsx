import React, { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { PNG } from 'pngjs';
import { Pressable, Text, TextInput, View } from 'react-native';
import { render, type Session } from '@mimicry/testing';

/** RGBA at a point (in points) of a 1x screenshot. */
function pixel(s: Session, x: number, y: number): [number, number, number, number] {
  const png = PNG.sync.read(s.screenshot(1));
  const i = (Math.round(y) * png.width + Math.round(x)) * 4;
  return [png.data[i]!, png.data[i + 1]!, png.data[i + 2]!, png.data[i + 3]!];
}

/** Rows (in points) inside `rect` that contain dark ink. */
function inkRows(s: Session, rect: { x: number; y: number; w: number; h: number }): number[] {
  const png = PNG.sync.read(s.screenshot(1));
  const rows: number[] = [];
  for (let y = Math.floor(rect.y); y < rect.y + rect.h; y++) {
    for (let x = Math.floor(rect.x); x < rect.x + rect.w; x++) {
      const i = (y * png.width + x) * 4;
      if (png.data[i]! < 100 && png.data[i + 1]! < 100 && png.data[i + 2]! < 100) {
        rows.push(y);
        break;
      }
    }
  }
  return rows;
}

const textNode = (s: Session, testID: string) => s.engine.nodes.get(s.find({ testID })[0]!.id)!;

describe('inline views in <Text>', () => {
  it('reserves a box in the line, stands it on the baseline and paints it', async () => {
    const s = await render(
      <View style={{ paddingTop: 100, paddingLeft: 20 }}>
        <Text testID="text" style={{ fontSize: 20 }}>
          ab<View testID="box" style={{ width: 30, height: 10, backgroundColor: 'red' }} />cd
        </Text>
      </View>,
    );
    const text = s.find({ testID: 'text' })[0]!.rect;
    const box = s.find({ testID: 'box' })[0]!.rect;
    expect(box.w).toBe(30);
    expect(box.h).toBe(10);
    // after "ab", inside the first line
    expect(box.x).toBeGreaterThan(text.x + 10);
    expect(box.y).toBeGreaterThan(text.y);
    const layout = s.engine.textLayoutFor(textNode(s, 'text'), text.w);
    const line = layout.lines[0]!;
    // bottom edge on the baseline
    expect(box.y + box.h).toBeCloseTo(text.y + line.baseline, 1);
    // "cd" follows the box
    const cd = line.runs.find((r) => r.text === 'cd')!;
    expect(cd.x).toBeCloseTo(line.runs.find((r) => r.attachment)!.x + 30, 3);
    const [r, g, b] = pixel(s, box.x + 15, box.y + 5);
    expect([r, g, b]).toEqual([255, 0, 0]);
    s.dispose();
  });

  it('grows the line for a tall inline view and makes it hit-testable', async () => {
    let pressed = 0;
    const s = await render(
      <View style={{ paddingTop: 100 }}>
        <Text testID="text" style={{ fontSize: 16 }}>
          Tap <Pressable testID="pill" onPress={() => pressed++} style={{ width: 60, height: 40, backgroundColor: 'blue' }} /> here
        </Text>
      </View>,
    );
    const text = s.find({ testID: 'text' })[0]!.rect;
    expect(text.h).toBeGreaterThanOrEqual(40);
    s.tap({ testID: 'pill' });
    expect(pressed).toBe(1);
    s.dispose();
  });

  it('drops inline views cut off by numberOfLines', async () => {
    const s = await render(
      <View style={{ paddingTop: 100, width: 120 }}>
        <Text testID="text" numberOfLines={1}>
          A long first line of words <View testID="late" style={{ width: 20, height: 10, backgroundColor: 'red' }} />
        </Text>
      </View>,
    );
    const layout = s.engine.textLayoutFor(textNode(s, 'text'), s.find({ testID: 'text' })[0]!.rect.w);
    expect(layout.lines.flatMap((l) => l.runs).some((r) => r.attachment)).toBe(false);
    s.dispose();
  });
});

describe('adjustsFontSizeToFit', () => {
  const sentence = 'Shrink this sentence to fit';

  it('shrinks the font until the text fits numberOfLines', async () => {
    const s = await render(
      <View style={{ paddingTop: 100 }}>
        <Text testID="fit" numberOfLines={1} adjustsFontSizeToFit style={{ width: 120, fontSize: 40 }}>{sentence}</Text>
      </View>,
    );
    const rect = s.find({ testID: 'fit' })[0]!.rect;
    const layout = s.engine.textLayoutFor(textNode(s, 'fit'), rect.w);
    expect(layout.lines).toHaveLength(1);
    expect(layout.truncated).toBe(false);
    expect(layout.width).toBeLessThanOrEqual(120);
    const size = layout.lines[0]!.runs[0]!.style.size;
    expect(size).toBeLessThan(40);
    expect(size).toBeGreaterThan(5);
    s.dispose();
  });

  it('stops at minimumFontScale and truncates', async () => {
    const s = await render(
      <View style={{ paddingTop: 100 }}>
        <Text testID="fit" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.9} style={{ width: 120, fontSize: 40 }}>{sentence}</Text>
      </View>,
    );
    const layout = s.engine.textLayoutFor(textNode(s, 'fit'), s.find({ testID: 'fit' })[0]!.rect.w);
    expect(layout.lines[0]!.runs[0]!.style.size).toBeCloseTo(36, 5);
    expect(layout.truncated).toBe(true);
    s.dispose();
  });

  it('fits a fixed height without numberOfLines', async () => {
    const s = await render(
      <View style={{ paddingTop: 100 }}>
        <Text testID="fit" adjustsFontSizeToFit style={{ width: 120, height: 50, fontSize: 30 }}>{sentence}</Text>
      </View>,
    );
    const layout = s.engine.textLayoutFor(textNode(s, 'fit'), 120);
    expect(layout.height).toBeLessThanOrEqual(50.5);
    expect(layout.lines[0]!.runs[0]!.style.size).toBeLessThan(30);
    s.dispose();
  });
});

describe('hyphenation', () => {
  const words = 'Internationalization considerations';
  const runsOf = async (device: string, frequency?: string) => {
    const s = await render(
      <View style={{ paddingTop: 100 }}>
        <Text testID="t" android_hyphenationFrequency={frequency} style={{ width: 130, fontSize: 16 }}>{words}</Text>
      </View>,
      { device },
    );
    const layout = s.engine.textLayoutFor(textNode(s, 't'), 130);
    const lines = layout.lines.map((l) => l.runs.map((r) => r.text).join(''));
    s.dispose();
    return lines;
  };

  it('breaks words at hyphenation points on Android when asked', async () => {
    const lines = await runsOf('pixel-9', 'full');
    expect(lines.some((l) => l.endsWith('-'))).toBe(true);
    // the hyphen splits a real word: the pieces rejoin into the original text
    expect(lines.join('').replace(/-/g, '').replace(/\s+/g, '')).toBe(words.replace(/\s+/g, ''));
  });

  it('does not hyphenate by default, nor on iOS', async () => {
    expect((await runsOf('pixel-9')).some((l) => l.endsWith('-'))).toBe(false);
    expect((await runsOf('iphone-17-pro', 'full')).some((l) => l.endsWith('-'))).toBe(false);
  });
});

describe('textAlignVertical', () => {
  it('aligns a <Text> block in its box on Android, top on iOS', async () => {
    const probe = async (device: string, align: 'top' | 'center' | 'bottom') => {
      const s = await render(
        <View style={{ paddingTop: 100, backgroundColor: 'white', flex: 1 }}>
          <Text testID="t" style={{ height: 120, width: 200, fontSize: 18, color: 'black', textAlignVertical: align }}>Hi</Text>
        </View>,
        { device },
      );
      const rect = s.find({ testID: 't' })[0]!.rect;
      const rows = inkRows(s, rect);
      s.dispose();
      return { first: rows[0]! - rect.y, last: rows[rows.length - 1]! - rect.y };
    };
    const top = await probe('pixel-9', 'top');
    const center = await probe('pixel-9', 'center');
    const bottom = await probe('pixel-9', 'bottom');
    expect(top.first).toBeLessThan(15);
    expect(center.first).toBeGreaterThan(40);
    expect(center.last).toBeLessThan(80);
    expect(bottom.last).toBeGreaterThan(105);
    expect((await probe('iphone-17-pro', 'bottom')).first).toBeLessThan(15);
  });

  it('centers a multiline TextInput on Android unless textAlignVertical is top', async () => {
    const probe = async (props: Record<string, unknown>) => {
      const s = await render(
        <View style={{ paddingTop: 100, flex: 1, backgroundColor: 'white' }}>
          <TextInput testID="in" multiline defaultValue="Hello" style={{ height: 120, width: 200, color: 'black', fontSize: 18 }} {...props} />
        </View>,
        { device: 'pixel-9' },
      );
      const rect = s.find({ testID: 'in' })[0]!.rect;
      // ignore the underline at the bottom of Android inputs
      const rows = inkRows(s, { ...rect, h: rect.h - 12 });
      s.dispose();
      return rows[0]! - rect.y;
    };
    expect(await probe({})).toBeGreaterThan(40);
    expect(await probe({ textAlignVertical: 'top' })).toBeLessThan(30);
  });
});

describe('verticalAlign alias', () => {
  it("maps 'middle' to center", async () => {
    function Box() {
      const [h] = useState(120);
      return <Text testID="t" style={{ height: h, width: 200, fontSize: 18, verticalAlign: 'middle' } as any}>Hi</Text>;
    }
    const s = await render(<View style={{ paddingTop: 100, flex: 1, backgroundColor: 'white' }}><Box /></View>, { device: 'pixel-9' });
    const rect = s.find({ testID: 't' })[0]!.rect;
    expect(inkRows(s, rect)[0]! - rect.y).toBeGreaterThan(40);
    s.dispose();
  });
});
