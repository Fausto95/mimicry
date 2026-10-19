import { writeFileSync } from 'node:fs';
import { it } from 'vitest';
import { launch } from '@mimicry/testing';
it('ignite', async () => {
  const app = await launch('/home/claude/apps/ignite/boilerplate', { device: 'iphone-17-pro' });
  const s = app.session;
  s.tap({ text: 'Tap to log in!' }); await s.ready();
  s.tap({ text: "Let's go!" }); await s.ready();
  writeFileSync('/tmp/claude-0/ig3.png', s.screenshot(1));
  for (const label of ['Community', 'Podcast', 'Debug']) {
    if (s.exists({ text: label })) { s.tap({ text: label }); await s.ready(); writeFileSync(`/tmp/claude-0/ig-${label}.png`, s.screenshot(1)); }
  }
  process.stdout.write('ERR ' + JSON.stringify(s.errors.map((e) => e.message.slice(0, 200))) + '\n');
}, 120000);
