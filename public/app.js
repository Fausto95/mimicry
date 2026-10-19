const $=id=>document.getElementById(id);
const devices=[
  {id:'iphone17',platform:'ios',name:'iPhone 17 Pro',width:402,height:874,icon:'iphone'},
  {id:'iphonese',platform:'ios',name:'iPhone SE',width:375,height:667,icon:'iphone'},
  {id:'ipadair',platform:'ios',name:'iPad Air',width:820,height:1180,icon:'tablet'},
  {id:'pixel9',platform:'android',name:'Pixel 9 Pro',width:412,height:915,icon:'android'},
  {id:'galaxy',platform:'android',name:'Galaxy S25',width:384,height:854,icon:'android'},
  {id:'androidtablet',platform:'android',name:'Pixel Tablet',width:800,height:1280,icon:'tablet'}
];
let selected=devices[0], appearance='light', landscape=false, zoom=1, appUrl='http://localhost:8081',
  runtime='loading', eventCount=0, inspectorVisible=true, iframeOrigin='', userZoom=false;
const stamp=()=>{
  const now=new Date();
  return now.toLocaleTimeString([],{hour:'numeric',minute:'2-digit',hour12:false});
};
function log(message,kind=''){
  const row=document.createElement('div');
  row.textContent='['+stamp()+'] '+String(message);
  if(kind)row.className=kind;
  $('events').append(row);
  while($('events').children.length>120)$('events').firstChild.remove();
  $('events').scrollTop=$('events').scrollHeight;
}
function frameUrl(){
  const url=new URL(appUrl,location.href);
  url.searchParams.set('mimicry-platform',selected.platform);
  url.searchParams.set('mimicry-theme',appearance);
  url.searchParams.set('parentOrigin',location.origin);
  iframeOrigin=url.origin;
  return url.toString();
}
function sendEnvironment(){
  if($('app-frame').contentWindow && iframeOrigin)
    $('app-frame').contentWindow.postMessage({
      source:'mimicry:studio',type:'environment',platform:selected.platform,
      appearance,device:selected.id,width:selected.width,height:selected.height
    },iframeOrigin);
}
function launch(restart=false){
  const frame=$('app-frame');
  if(restart || !frame.src){runtime='loading';$('runtime-status').textContent='Loading Expo bundle…';frame.src=frameUrl();}
  else sendEnvironment();
}
function fit(){
  const rotatedWidth=landscape?selected.height:selected.width;
  const rotatedHeight=landscape?selected.width:selected.height;
  const zone=$('simulator-area');
  const availableWidth=Math.max(200,zone.clientWidth-145),availableHeight=Math.max(270,zone.clientHeight-25);
  const next=Math.min(1.04,availableWidth/(rotatedWidth+20),availableHeight/(rotatedHeight+20));
  if(!userZoom)zoom=Math.max(.24,next);
  const phone=$('device');
  phone.style.width=rotatedWidth+20+'px';
  phone.style.height=rotatedHeight+20+'px';
  phone.style.transform='scale('+zoom+')';
  $('scaled-box').style.width=Math.round((rotatedWidth+20)*zoom)+'px';
  $('scaled-box').style.height=Math.round((rotatedHeight+20)*zoom)+'px';
  $('zoom-level').textContent=Math.round(zoom*100)+'%';
  $('resolution').textContent=rotatedWidth+' × '+rotatedHeight+' pt';
  $('system-time').textContent='9:41';
}
function render(){
  $('ios-tab').classList.toggle('active',selected.platform==='ios');
  $('android-tab').classList.toggle('active',selected.platform==='android');
  $('light-mode').classList.toggle('active',appearance==='light');
  $('dark-mode').classList.toggle('active',appearance==='dark');
  $('stage-name').textContent=selected.name+(landscape?' · Landscape':'');
  $('target-name').textContent=selected.platform==='ios'?'iOS style':'Android style';
  $('info-platform').textContent=selected.platform==='ios'?'iOS':'Android';
  $('info-ui-kit').textContent=selected.platform==='ios'?'UIKit / SwiftUI':'Views / Compose';
  $('device').className='phone '+(selected.platform==='android'?'android ':'')+(selected.icon==='tablet'?'tablet ':'')+(appearance==='dark'?'dark':'');
  $('device').querySelector('.display').style.background=appearance==='dark'?'#10131c':'#f6f8fc';
  $('device-list').replaceChildren();
  for(const d of devices.filter(item=>item.platform===selected.platform)){
    const button=document.createElement('button');
    button.className='device-option '+(selected.id===d.id?'selected ':'')+(d.icon==='tablet'?'tablet':'');
    const icon=document.createElement('div');
    icon.className='device-icon';
    icon.textContent=d.icon==='tablet'?'▦':d.platform==='ios'?'●':'◆';
    const labels=document.createElement('div');
    const name=document.createElement('strong');name.textContent=d.name;
    const size=document.createElement('small');size.textContent=d.width+' × '+d.height+' pt';
    labels.append(name,size);button.append(icon,labels);
    if(d.id===selected.id){const mark=document.createElement('span');mark.className='checkmark';mark.textContent='✓';button.append(mark);}
    button.onclick=()=>{selected=d;landscape=false;userZoom=false;render();launch();log('Device changed to '+selected.name);};
    $('device-list').append(button);
  }
  fit();
}
function platform(name){
  selected=devices.find(d=>d.platform===name);
  landscape=false;userZoom=false;render();launch();log('Simulating '+(name==='ios'?'UIKit / SwiftUI':'Android Views / Compose'));
}
function setTheme(next){appearance=next;render();launch();log('Appearance: '+next);}
$('ios-tab').onclick=()=>platform('ios');
$('android-tab').onclick=()=>platform('android');
$('light-mode').onclick=()=>setTheme('light');
$('dark-mode').onclick=()=>setTheme('dark');
$('theme-toggle').onclick=()=>setTheme(appearance==='dark'?'light':'dark');
$('rotate').onclick=()=>{landscape=!landscape;userZoom=false;render();sendEnvironment();};
$('home').onclick=()=>launch(true);
$('reload').onclick=()=>{launch(true);log('App bundle reloaded');};
$('open-app').onclick=()=>window.open($('app-frame').src,'_blank','noopener,noreferrer');
$('show-code').onclick=()=>{
  inspectorVisible=!inspectorVisible;
  $('inspector').hidden=!inspectorVisible;
  fit();
};
$('zoom-in').onclick=()=>{userZoom=true;zoom=Math.min(1.4,zoom+.1);fit();};
$('zoom-out').onclick=()=>{userZoom=true;zoom=Math.max(.2,zoom-.1);fit();};
$('clear').onclick=()=>$('events').replaceChildren();
$('app-frame').addEventListener('load',()=>{
  runtime='loaded';$('runtime-status').textContent='Expo frame loaded';
  sendEnvironment();log('Expo page loaded in browser','success');
});
window.addEventListener('message',event=>{
  if(event.source!==$('app-frame').contentWindow || event.origin!==iframeOrigin)return;
  const data=event.data;
  if(!data || data.source!=='mimicry:app' || typeof data.type!=='string')return;
  eventCount++;
  if(data.type==='ready'){
    runtime='running';
    $('runtime-status').textContent='Expo JS + Mimicry running';
    log('Browser-native component registry ready ('+(data.capabilities?.length||0)+' components)','success');
  }else if(data.type==='interaction'){
    log(data.component+': '+(data.action||String(data.value)));
  }else if(data.type==='mount'){
    log('Mounted '+data.component+' for '+data.platform);
  }
});
for(const character of 'QWERTYUIOPASDFGHJKLZXCVBNM'){
  const key=document.createElement('div');key.className='key';key.textContent=character.toLowerCase();$('keyboard-grid').append(key);
}
const urlParams=new URLSearchParams(location.search);
if(urlParams.get('app')){
  try{const external=new URL(urlParams.get('app'));if(['http:','https:'].includes(external.protocol))appUrl=external.href;}
  catch{log('Invalid app URL was ignored','error');}
}
$('open-app').title='Open the Expo app separately: '+appUrl;
const stream=new EventSource('/api/stream');
stream.addEventListener('log',event=>{
  const data=JSON.parse(event.data);log(data.line,/error|fail/i.test(data.line)?'error':'');
});
stream.addEventListener('status',event=>{
  const data=JSON.parse(event.data);
  if(data.status==='failed')log('Expo bundler stopped. Check its logs.','error');
});
fetch('/api/status').then(r=>r.json()).then(data=>{
  appUrl=data.appUrl;
  if(data.logs)for(const line of data.logs.slice(-12))log(line);
  launch(true);
}).catch(err=>{log('Could not read server: '+err.message,'error');launch(true);});
new ResizeObserver(()=>fit()).observe($('simulator-area'));
render();
