import React from 'react';
import { describe, expect, it } from 'vitest';
import { writeFileSync, mkdirSync } from 'node:fs';
import { SectionList, Text, View } from 'react-native';
import { render } from '@mimicry/testing';

const sections = ['A', 'B', 'C'].map((title) => ({ title, data: Array.from({ length: 15 }, (_, i) => `${title}${i}`) }));

function List({ onHeader }: { onHeader: (t: string) => void }) {
  return (
    <View style={{ flex: 1, paddingTop: 62 }}>
      <SectionList
        testID="list"
        sections={sections}
        keyExtractor={(item: string) => item}
        renderSectionHeader={({ section }: { section: { title: string } }) => (
          <Text testID={`header-${section.title}`} onPress={() => onHeader(section.title)} style={{ height: 30, backgroundColor: '#eee' }}>
            {section.title}
          </Text>
        )}
        renderItem={({ item }: { item: string }) => <Text style={{ height: 44 }}>{item}</Text>}
      />
    </View>
  );
}

describe('sticky section headers (iOS default)', () => {
  it('pins the current header, pushes it out with the next one, and keeps it tappable', async () => {
    const pressed: string[] = [];
    const s = await render(<List onHeader={(t) => pressed.push(t)} />, { device: 'iphone-17-pro' });
    const list = s.engine.nodes.get(s.find({ testID: 'list' })[0]!.id)!;
    list.scrollTo({ y: 200, animated: false });
    s.settle();
    expect(s.find({ testID: 'header-A' })[0]!.rect.y).toBeCloseTo(62, 0);
    mkdirSync('artifacts', { recursive: true });
    writeFileSync('artifacts/sticky.png', s.screenshot(1));
    s.tap({ x: 100, y: 70 });
    expect(pressed).toEqual(['A']);

    list.scrollTo({ y: 690 - 10, animated: false }); // B header at 30 + 15*44 = 690 pushes A up
    s.settle();
    expect(s.find({ testID: 'header-A' })[0]!.rect.y).toBeCloseTo(62 - 20, 0);
    s.dispose();
  });

  it('does not pin on Android unless enabled', async () => {
    const s = await render(<List onHeader={() => {}} />, { device: 'pixel-9' });
    const list = s.engine.nodes.get(s.find({ testID: 'list' })[0]!.id)!;
    list.scrollTo({ y: 200, animated: false });
    s.settle();
    expect(s.find({ testID: 'header-A' })[0]!.rect.y).toBeLessThan(0);
    s.dispose();
  });
});
