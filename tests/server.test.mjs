import test from 'node:test';
import assert from 'node:assert/strict';
import { studioConfig } from '../src/server.mjs';

test('Studio separates Expo and Mimicry ports',()=>{
  const cfg=studioConfig({MIMICRY_PORT:'5400',MIMICRY_EXPO_PORT:'9000'});
  assert.equal(cfg.port,5400);
  assert.equal(cfg.expoPort,9000);
  assert.equal(cfg.appUrl,'http://localhost:9000');
  assert.equal(cfg.host,'127.0.0.1');
});
test('Studio rejects invalid ports',()=>{
  assert.throws(()=>studioConfig({MIMICRY_PORT:'8081',MIMICRY_EXPO_PORT:'8081'}));
  assert.throws(()=>studioConfig({MIMICRY_PORT:'0'}));
});
test('Custom application URLs can be embedded',()=>{
  assert.equal(studioConfig({MIMICRY_APP_URL:'http://localhost:19006'}).appUrl,'http://localhost:19006');
});
