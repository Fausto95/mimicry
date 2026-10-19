#!/usr/bin/env node
import { createStudio, studioConfig } from '../src/server.mjs';
const options=studioConfig();
const studio=createStudio(options,{startExpo:!process.argv.includes('--studio-only') && !process.env.MIMICRY_APP_URL});
await studio.listen();
let stopping=false;
async function stop(){
  if(stopping)return;
  stopping=true;
  await studio.close();
  process.exit(0);
}
process.on('SIGINT',stop);
process.on('SIGTERM',stop);
