/**
 * Full browser smoke test. Run only after installing Playwright's Chromium.
 * This is a real browser loading a real Metro-compiled Expo application.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

let server=null;
let browser=null;
let output='';
const origin='http://127.0.0.1:5173';
const log=(text)=>{ output=(output+text).slice(-10000); };
const sleep=(ms)=>new Promise(resolve=>setTimeout(resolve,ms));
async function probe(url,timeout=120000){
  const until=Date.now()+timeout;
  while(Date.now()<until){
    try{const res=await fetch(url,{signal:AbortSignal.timeout(3000)});if(res.ok)return;}
    catch{}
    await sleep(650);
  }
  throw Error('Timed out waiting for '+url+'\n'+output.slice(-2500));
}
function stop(){
  if(!server)return;
  try {
    if(process.platform!=='win32' && server.pid)process.kill(-server.pid,'SIGTERM');
    else server.kill('SIGTERM');
  }catch{server.kill('SIGTERM');}
}
try{
  server=spawn(process.execPath,['scripts/dev.mjs'],{
    cwd:process.cwd(),stdio:['ignore','pipe','pipe'],
    detached:process.platform!=='win32',
    env:{...process.env,EXPO_NO_TELEMETRY:'1',BROWSER:'none'}
  });
  server.stdout.on('data',chunk=>log(chunk.toString('utf8')));
  server.stderr.on('data',chunk=>log(chunk.toString('utf8')));
  await probe(origin+'/api/status');
  await probe('http://localhost:8081');
  browser=await chromium.launch({headless:true,args:['--no-sandbox']});
  const page=await browser.newPage({viewport:{width:1500,height:1000}});
  page.on('pageerror',error=>log('\nPAGE ERROR: '+error.message));
  await page.goto(origin,{waitUntil:'domcontentloaded'});
  const expo=page.frameLocator('#app-frame');
  await expo.getByText(/Designed to/).waitFor({timeout:120000});
  assert.match(await expo.getByText(/Designed to/).textContent(),/Designed to/);
  await expo.getByLabel('Increase count').click();
  await expo.getByText('13',{exact:true}).waitFor({timeout:10000});
  await page.locator('#android-tab').click();
  await expo.getByText(/ANDROID PREVIEW/).waitFor({timeout:10000});
  await expo.getByText(/Native UI/).click();
  await expo.getByText(/COMPOSE \/ COMPONENT REGISTRY/).waitFor({timeout:10000});
  await expo.getByRole('switch').click();
  await expo.getByText(/Notifications off/).waitFor({timeout:10000});
  await page.locator('#ios-tab').click();
  await expo.getByText(/SWIFTUI \/ COMPONENT REGISTRY/).waitFor({timeout:10000});
  await mkdir('artifacts',{recursive:true});
  await page.screenshot({path:'artifacts/mimicry-browser-smoke.png',fullPage:true});
  console.log('PASS: Real Expo app booted, state updated, both platform shims rendered, and controls interacted.');
} catch(error){
  console.error(error);
  console.error('Last Studio / Expo output:\n'+output.slice(-7000));
  process.exitCode=1;
} finally {
  await browser?.close();
  stop();
}
