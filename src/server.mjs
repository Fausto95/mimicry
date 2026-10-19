import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const publicDir=join(root,'public');
const assets=new Map([
  ['/',['index.html','text/html; charset=utf-8']],
  ['/styles.css',['styles.css','text/css; charset=utf-8']],
  ['/app.js',['app.js','text/javascript; charset=utf-8']]
]);
const baseLogs=[];
function append(store, line, emit) {
  for(const part of String(line).split(/\r?\n/).filter(Boolean)){
    store.push(part.slice(0,1500));
    if(store.length>140) store.shift();
    emit('log',{line:part.slice(0,1500)});
  }
}
function sendJson(response,status,payload){
  response.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
  response.end(JSON.stringify(payload));
}
export function studioConfig(env=process.env) {
  const port=Number(env.MIMICRY_PORT || 5173);
  const expoPort=Number(env.MIMICRY_EXPO_PORT || 8081);
  if(!Number.isInteger(port)||port<1024||port>65535||!Number.isInteger(expoPort)||expoPort<1024||expoPort>65535||port===expoPort)
    throw new Error('MIMICRY_PORT and MIMICRY_EXPO_PORT must be different TCP ports');
  return {
    port,expoPort,
    host:'127.0.0.1',
    project:resolve(env.MIMICRY_EXPO_PROJECT || join(root,'examples/expo-demo')),
    appUrl:env.MIMICRY_APP_URL || 'http://localhost:'+expoPort
  };
}
export function createStudio({ port, host='127.0.0.1', project, expoPort, appUrl }, { startExpo=true }={}) {
  const logs=[];
  const streams=new Set();
  const state={status:startExpo?'starting':'external',exitCode:null};
  let child=null;
  const emit=(type,payload={})=>{
    const encoded='event: '+type+'\ndata: '+JSON.stringify(payload)+'\n\n';
    for(const response of streams){
      try{response.write(encoded);}catch{streams.delete(response);}
    }
  };
  const log=(text)=>append(logs,text,emit);
  const server=createServer(async(req,res)=>{
    const url=new URL(req.url||'/','http://localhost');
    if(req.method==='GET'&&url.pathname==='/api/status')
      return sendJson(res,200,{...state,appUrl,project,logs});
    if(req.method==='GET'&&url.pathname==='/api/stream'){
      res.writeHead(200,{
        'Content-Type':'text/event-stream; charset=utf-8',
        'Cache-Control':'no-cache, no-transform',
        'Connection':'keep-alive',
        'X-Accel-Buffering':'no'
      });
      res.write('retry: 1200\n\n');
      streams.add(res);
      req.on('close',()=>streams.delete(res));
      return;
    }
    if(req.method==='GET'&&assets.has(url.pathname)){
      const [file,mime]=assets.get(url.pathname);
      try{
        const body=await readFile(join(publicDir,file));
        res.writeHead(200,{'Content-Type':mime,'Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'});
        res.end(body);
      }catch{
        sendJson(res,404,{error:'Asset unavailable'});
      }
      return;
    }
    return sendJson(res,404,{error:'Not found'});
  });
  function startChild(){
    const command=process.platform==='win32'?'npx.cmd':'npx';
    // Keep the Expo app in its own workspace so Metro can resolve its own modules.
    child=spawn(command,['expo','start','--web','--localhost','--port',String(expoPort)],{
      cwd:project,env:{...process.env,EXPO_NO_TELEMETRY:'1'},
      stdio:['ignore','pipe','pipe'],windowsHide:true
    });
    child.stdout.on('data',data=>log(data.toString('utf8')));
    child.stderr.on('data',data=>log(data.toString('utf8')));
    child.once('error',error=>{
      state.status='failed';
      log('Failed to start Expo: '+error.message);
      emit('status',{...state});
    });
    child.once('close',code=>{
      state.status=code===0?'stopped':'failed';
      state.exitCode=code;
      log('Expo process exited ('+code+').');
      emit('status',{...state});
    });
  }
  let pulse=null;
  return {
    async listen(){
      await new Promise((done,fail)=>{
        server.once('error',fail);
        server.listen(port,host,done);
      });
      if(startExpo)startChild();
      pulse=setInterval(()=>emit('heartbeat',{at:Date.now()}),20000);
      console.log('Mimicry: http://'+host+':'+port);
      console.log('Expo app: '+appUrl);
      console.log('Renderer: browser-native approximation (no native simulators).');
    },
    async close(){
      if(pulse)clearInterval(pulse);
      if(child&&!child.killed)child.kill('SIGTERM');
      for(const stream of streams)stream.end();
      streams.clear();
      await new Promise(done=>server.close(done));
    }
  };
}
