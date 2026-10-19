import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const { withMimicry }=require('../packages/runtime/metro.cjs');

test('Expo UI imports use Mimicry only for web',()=>{
  const old=()=>({type:'sourceFile',filePath:'/real/expo-ui.tsx'});
  const config=withMimicry({resolver:{resolveRequest:old},watchFolders:[]});
  for(const name of ['@expo/ui','@expo/ui/swift-ui','@expo/ui/jetpack-compose']){
    const alias=config.resolver.resolveRequest({},name,'web');
    assert.equal(alias.type,'sourceFile');
    assert.match(alias.filePath,/packages\/runtime\/src\/index.tsx$/);
    assert.equal(config.resolver.resolveRequest({},name,'ios').filePath,'/real/expo-ui.tsx');
    assert.equal(config.resolver.resolveRequest({},name,'android').filePath,'/real/expo-ui.tsx');
  }
  assert.equal(config.resolver.resolveRequest({},'react-native','web').filePath,'/real/expo-ui.tsx');
});
test('Metro config adds runtime workspace once',()=>{
  const config=withMimicry({resolver:{resolveRequest:()=>({type:'empty'})},watchFolders:[]});
  assert.equal(new Set(config.watchFolders).size,config.watchFolders.length);
});
