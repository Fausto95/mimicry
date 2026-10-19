#!/usr/bin/env node
// Runs the TypeScript sources directly (tsx). A published build would ship compiled JS.
import { register } from 'tsx/esm/api';

register();
const { main } = await import('../src/cli.ts');
await main(process.argv.slice(2));
