import React, { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { render } from '@mimicry/testing';
import { startDevServer } from '@mimicry/cli';
import { fileURLToPath } from 'node:url';

describe('regressions from review', () => {
  it('re-measures text when numberOfLines changes', async () => {
    function ReadMore() {
      const [open, setOpen] = useState(false);
      return (
        <View style={{ paddingTop: 80, paddingHorizontal: 20 }}>
          <Text testID="body" numberOfLines={open ? undefined : 2}>{'Lorem ipsum dolor sit amet. '.repeat(20)}</Text>
          <Pressable testID="toggle" onPress={() => setOpen(true)}><Text>Read more</Text></Pressable>
        </View>
      );
    }
    const s = await render(<ReadMore />);
    const before = s.find({ testID: 'body' })[0]!.rect.h;
    s.tap({ testID: 'toggle' });
    expect(s.find({ testID: 'body' })[0]!.rect.h).toBeGreaterThan(before * 2);
    s.dispose();
  });

  it('clamps the scroll offset when content shrinks', async () => {
    let shrink!: () => void;
    function List() {
      const [n, setN] = useState(40);
      shrink = () => setN(3);
      return (
        <ScrollView testID="list" style={{ flex: 1 }}>
          {Array.from({ length: n }, (_, i) => <Text key={i} style={{ height: 50 }}>Row {i}</Text>)}
        </ScrollView>
      );
    }
    const s = await render(<List />);
    const node = s.engine.nodes.get(s.find({ testID: 'list' })[0]!.id)!;
    node.scrollToEnd({ animated: false });
    s.settle();
    expect(node.scroll!.y).toBeGreaterThan(500);
    const { act } = await import('react');
    act(() => shrink());
    s.settle();
    expect(node.scroll!.y).toBe(0);
    s.dispose();
  });

  it('bubbles onTouchStart/onTouchEnd even when a Pressable is the responder', async () => {
    const log: string[] = [];
    const s = await render(
      <View style={{ flex: 1 }} onTouchStart={() => log.push('start')} onTouchEnd={() => log.push('end')}>
        <Pressable testID="p" onPress={() => log.push('press')} style={{ marginTop: 100, height: 50 }} />
      </View>,
    );
    s.tap({ testID: 'p' });
    expect(log).toEqual(['start', 'end', 'press'].sort((a, b) => log.indexOf(a) - log.indexOf(b)));
    expect(log).toContain('start');
    expect(log).toContain('end');
    expect(log).toContain('press');
    s.dispose();
  });

  it('dev server refuses foreign hosts and non-asset files', async () => {
    const project = fileURLToPath(new URL('../../examples/showcase', import.meta.url));
    const server = await startDevServer({ project, port: 0, host: '127.0.0.1', log: () => {} });
    // fetch() won't send a custom Host header; use a raw request
    const { request } = await import('node:http');
    const get = (path: string, host?: string) =>
      new Promise<number>((resolve, reject) => {
        const req = request(server.url + path, { headers: host ? { host } : {} }, (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        });
        req.on('error', reject);
        req.end();
      });
    expect(await get('/__mimicry/assets/assets/avatar@3x.png')).toBe(200);
    expect(await get('/__mimicry/assets/App.tsx')).toBe(403);
    expect(await get('/__mimicry/assets/.env')).toBe(403);
    expect(await get('/__mimicry/manifest', 'evil.example')).toBe(403);
    await server.close();
  });
});
