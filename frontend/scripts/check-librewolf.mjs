import net from 'node:net';
import {spawn} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createServer} from 'vite';

// A new, owned profile only. Never connect to or change the user's personal one.
const profile=resolve('test-results/librewolf-qa');
const executable=process.argv[2]??'C:/Program Files/LibreWolf/librewolf.exe';
const server=await createServer({configFile:'frontend/vite.config.ts',mode:'test',plugins:[{name:'native-qa-seed',transformIndexHtml(){return [{tag:'script',injectTo:'head-prepend',children:'const qaRandom=crypto.getRandomValues.bind(crypto);crypto.getRandomValues=values=>{qaRandom(values);if(values instanceof Uint32Array&&values.length===1)values[0]=1942;return values;};'}];}}],server:{host:'127.0.0.1',port:5177,strictPort:true,hmr:false}});
let browser,socket,owned=false,sequence=0,buffer=Buffer.alloc(0);
const pending=new Map(),delay=ms=>new Promise(r=>setTimeout(r,ms));
const send=(method,params={})=>new Promise((resolve,reject)=>{
  const id=++sequence,message=JSON.stringify([0,id,method,params]);
  const timer=setTimeout(()=>{pending.delete(id);reject(Error('Marionette timeout: '+method));},45000);
  pending.set(id,{resolve,reject,timer});socket.write(Buffer.byteLength(message)+':'+message);
});
const evaluate=async script=>(await send('WebDriver:ExecuteScript',{script,args:[],newSandbox:true})).value;
const click=async selector=>{
  const result=await send('WebDriver:FindElement',{using:'css selector',value:selector});
  await send('WebDriver:ElementClick',{id:(result.value??result)['element-6066-11e4-a52e-4f735466cecf']});
};
async function connect(){
  for(let attempt=0;attempt<40;attempt++){
    const connection=net.createConnection({host:'127.0.0.1',port:2829});
    try{await new Promise((resolve,reject)=>{connection.once('connect',resolve);connection.once('error',reject);});return connection;}
    catch{connection.destroy();await delay(250);}
  }
  throw Error('The isolated LibreWolf automation connection did not start.');
}
try{
  await mkdir(profile,{recursive:true});
  await writeFile(resolve(profile,'user.js'),[
    'marionette.enabled=true','marionette.port=2829','remote.system-access-check.enabled=false',
    'webgl.disabled=false','webgl.force-enabled=true','librewolf.webgl.prompt=false','privacy.resistFingerprinting=true',
    'browser.shell.checkDefaultBrowser=false','browser.startup.page=0','browser.tabs.warnOnClose=false',
  ].map(item=>{const [key,value]=item.split('=');return 'user_pref('+JSON.stringify(key)+', '+value+');';}).join('\n'));
  await server.listen();
  browser=spawn(executable,['-no-remote','-profile',profile,'-marionette','-remote-allow-system-access','about:blank'],{windowsHide:true,stdio:'ignore'});
  let launchError;browser.once('error',error=>{launchError=error;});
  socket=await connect();if(launchError)throw launchError;
  socket.on('data',chunk=>{
    buffer=Buffer.concat([buffer,chunk]);
    for(;;){
      const colon=buffer.indexOf(58);if(colon<0)return;
      const length=Number(buffer.subarray(0,colon).toString());if(buffer.length<colon+1+length)return;
      const data=JSON.parse(buffer.subarray(colon+1,colon+1+length));buffer=buffer.subarray(colon+1+length);
      if(!Array.isArray(data))continue;
      const entry=pending.get(data[1]);if(!entry)continue;pending.delete(data[1]);clearTimeout(entry.timer);
      data[2]?entry.reject(Error(JSON.stringify(data[2]))):entry.resolve(data[3]);
    }
  });
  const session=await send('WebDriver:NewSession',{capabilities:{alwaysMatch:{acceptInsecureCerts:true}}});
  const capabilities=session.capabilities??session.value?.capabilities;
  const normalize=value=>value.replaceAll('/','\\').toLowerCase();
  if(!capabilities?.['moz:profile']||normalize(capabilities['moz:profile'])!==normalize(profile))throw Error('Refusing to control an unexpected browser profile.');
  owned=true;
  await send('WebDriver:Navigate',{url:'http://127.0.0.1:5177/'});
  await evaluate(`window.__qaErrors=[];window.__qaWarnings=[];
    const error=console.error,warn=console.warn;
    console.error=(...args)=>{window.__qaErrors.push(args.map(String).join(' '));error(...args);};
    console.warn=(...args)=>{if(args.some(value=>/texture units|Texture has been resized/.test(String(value))))window.__qaWarnings.push(args.map(String).join(' '));warn(...args);};
    window.addEventListener('error',event=>window.__qaErrors.push(event.message));return true;`);
  let ready=false,startup;
  for(let attempt=0;attempt<120;attempt++){
    const state=await evaluate(`const d=window.__rimmile?.snapshot();return {ready:!document.getElementById('scene').hidden,hidden:document.hidden,error:document.getElementById('load-status').textContent,chunks:d?.chunks,pending:d?.pending};`);
    startup=state;if(state.error)throw Error(state.error);if(state.ready){ready=true;break;}await delay(500);
  }
  if(!ready){await writeFile('test-results/librewolf-startup.json',JSON.stringify(startup,null,2));throw Error('Landing world timed out: '+JSON.stringify(startup));}
  const before=await evaluate(`const gl=document.getElementById('game').getContext('webgl2');
    return {state:__rimmile.snapshot().state,vehicle:__rimmile.snapshot().vehicle,audio:__rimmile.snapshot().audio??null,logo:getComputedStyle(document.querySelector('h1')).fontSize,width:innerWidth,varyings:gl.getParameter(gl.MAX_VARYING_VECTORS),samplers:gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS),maxTexture:gl.getParameter(gl.MAX_TEXTURE_SIZE)};`);
  await send('Marionette:SetContext',{value:'chrome'});
  const rfp=await evaluate(`gBrowser.selectedBrowser.fullZoom=1.25;return Services.prefs.getBoolPref('privacy.resistFingerprinting');`);
  await send('Marionette:SetContext',{value:'content'});await delay(300);
  const zoom=await evaluate(`return {logo:getComputedStyle(document.querySelector('h1')).fontSize,width:innerWidth};`);
  await click('#landing-settings');
  const settings=await evaluate(`return {overlay:getComputedStyle(document.getElementById('menu-overlay')).backgroundColor,rows:[...document.querySelectorAll('.setting-row:not(.reset-row)')].map(row=>{const a=row.children[0].getBoundingClientRect(),b=row.children[1].getBoundingClientRect();return Math.abs(a.y+a.height/2-b.y-b.height/2);})};`);
  const menuZoom=[];
  for(const scale of [.8,1,1.25,1.5,2]){
    await send('Marionette:SetContext',{value:'chrome'});await evaluate(`gBrowser.selectedBrowser.fullZoom=${scale};return true;`);await send('Marionette:SetContext',{value:'content'});await delay(150);
    const layout=()=>evaluate(`const panel=document.querySelector('.content-screen:not([hidden])'),b=panel.querySelector('.editorial-content').getBoundingClientRect();return {left:b.left,width:b.width,center:b.left+b.width/2,window:innerWidth,overflow:document.documentElement.scrollWidth,color:getComputedStyle(panel).scrollbarColor,documentScroll:scrollY};`);
    const setting=await layout();await click('#settings-back');await click('#landing-about');const about=await layout();await click('#about-back');await click('#landing-settings');
    if(Math.abs(setting.center-setting.window/2)>1||Math.abs(setting.left-about.left)>1||Math.abs(setting.width-about.width)>1||setting.width>768.1||setting.overflow>setting.window||setting.documentScroll||!setting.color.includes('rgba(0, 0, 0, 0)'))throw Error('Native zoom/transparent-gutter verification failed: '+JSON.stringify({scale,setting,about}));
    menuZoom.push({scale,setting,about});
  }
  await click('#settings-back');await click('#landing-about');await click('#about-back');
  await send('Marionette:SetContext',{value:'chrome'});await evaluate(`gBrowser.selectedBrowser.fullZoom=1;return true;`);await send('Marionette:SetContext',{value:'content'});
  await evaluate(`const Original=AudioContext;window.AudioContext=new Proxy(Original,{construct(target,args){const ctx=Reflect.construct(target,args,target),create=ctx.createGain.bind(ctx);window.__qaAudio=ctx;ctx.createGain=()=>{const node=create();if(!window.__qaMaster)window.__qaMaster=node;return node;};return ctx;}});return true;`);
  await click('#play');
  for(let attempt=0;attempt<40;attempt++){const state=await evaluate(`return __rimmile.snapshot().state;`);if(state==='running'||state==='paused')break;await delay(400);}
  if(await evaluate(`return __rimmile.snapshot().state==='paused';`))await click('#play');
  const presets=[];
  for(const quality of ['Low','Medium','High','Auto']){
    await evaluate(`document.getElementById('pause').click();document.getElementById('landing-settings').click();for(const key of ['resolution','shadows','trees','grass','terrain','distant'])document.querySelector('[data-graphics="'+key+'"][data-value="'+('${quality}'==='Auto'&&key!=='resolution'?'Medium':'${quality}')+'"]').click();document.getElementById('settings-back').click();return true;`);
    await click('#play');await delay(1800);
    presets.push(await evaluate(`return {quality:'${quality}',errors:__qaErrors,warnings:__qaWarnings,glError:document.getElementById('game').getContext('webgl2').getError(),detail:__rimmile.snapshot().detailRadius,audio:__rimmile.snapshot().audio};`));
    if(quality==='High'){
      const frame=await send('WebDriver:TakeScreenshot',{full:false});
      await writeFile('test-results/librewolf-forest-high.png',Buffer.from(frame.value??frame,'base64'));
    }
  }
  await send('WebDriver:PerformActions',{actions:[{type:'key',id:'lights',actions:[{type:'keyDown',value:'l'},{type:'keyUp',value:'l'}]}]});await delay(350);
  const lightsOff=await evaluate(`const v=__rimmile.snapshot().vehicle;return {on:v.lightsOn,tail:v.tailEmission,rear:v.rearIntensity,lamps:v.headlights,error:document.getElementById('game').getContext('webgl2').getError()};`);
  await send('WebDriver:PerformActions',{actions:[{type:'key',id:'lights',actions:[{type:'keyDown',value:'l'},{type:'keyUp',value:'l'}]}]});await delay(350);
  const lightsOn=await evaluate(`const v=__rimmile.snapshot().vehicle;return {on:v.lightsOn,tail:v.tailEmission,lamps:v.headlights,error:document.getElementById('game').getContext('webgl2').getError()};`);
  if(lightsOff.on||lightsOff.tail||lightsOff.rear||lightsOff.error||lightsOff.lamps.some(l=>l.visible||l.shadow||l.intensity)||!lightsOn.on||!lightsOn.tail||lightsOn.error||lightsOn.lamps.some(l=>!l.visible||!l.shadow||!l.intensity))throw Error('Native lamp toggle failed.');
  const activation=await evaluate(`window.__qaAnalyser=__qaAudio.createAnalyser();__qaMaster.connect(__qaAnalyser);
    for(const [id,value] of [['master',100],['engine',100],['environment',0]]){const control=document.getElementById(id);control.value=String(value);control.dispatchEvent(new Event('input',{bubbles:true}));}
    return __rimmile.snapshot().audio.engineActivated;`);
  await delay(300);
  const level=()=>evaluate(`const values=new Float32Array(__qaAnalyser.fftSize);__qaAnalyser.getFloatTimeDomainData(values);return Math.sqrt(values.reduce((sum,value)=>sum+value*value,0)/values.length);`);
  const initialLevel=await level();
  await send('WebDriver:PerformActions',{actions:[{type:'key',id:'drive',actions:[{type:'keyDown',value:'w'},{type:'pause',duration:650},{type:'keyUp',value:'w'}]}]});
  const moving=await evaluate(`return __rimmile.snapshot().audio.engineActivated;`),movingLevel=await level();
  await click('#pause');await click('#landing-settings');await click('[data-transmission="Manual"]');await click('#settings-back');await click('#play');
  const key=async value=>send('WebDriver:PerformActions',{actions:[{type:'key',id:'transmission',actions:[{type:'keyDown',value},{type:'keyUp',value}]}]});
  await key('t');await key('q');const manualUp=await evaluate(`return __rimmile.snapshot().drivetrain;`);await delay(400);await key('e');
  const manualDown=await evaluate(`return __rimmile.snapshot().drivetrain;`);await key('r');const selectedReverse=await evaluate(`return {drive:__rimmile.snapshot().drivetrain,speed:__rimmile.snapshot().speed};`);
  if(manualUp.mode!=='Manual'||manualUp.gear!==2||manualDown.gear!==1||selectedReverse.drive.direction!=='Reverse'||Math.abs(selectedReverse.speed)>.1)throw Error('Native manual/direction selection failed.');
  await key('t');const transmission={manualUp,manualDown,selectedReverse};
  await evaluate(`window.dispatchEvent(new Event('blur'));return true;`);
  // AudioContext suspension is asynchronous; RFP rounds timer scheduling.
  for(let attempt=0;attempt<40;attempt++){if(await evaluate(`return __rimmile.snapshot().audio.state;`)==='suspended')break;await delay(50);}
  const paused=await evaluate(`window.dispatchEvent(new Event('focus'));return __rimmile.snapshot().audio.state;`);
  const tunnel=await send('WebDriver:ExecuteAsyncScript',{script:`const done=arguments[arguments.length-1];(async()=>{
    const {tunnelPlan}=await import('/src/world/road.ts');let bore;for(let i=0;i<100&&!bore;i++)bore=tunnelPlan(i,1942);
    if(!bore)throw Error('Missing native bore');await __rimmile.inspectDistance(bore.center);
    return {bore,actual:__rimmile.snapshot().tunnel,glError:document.getElementById('game').getContext('webgl2').getError(),errors:__qaErrors,warnings:__qaWarnings,chunks:__rimmile.snapshot().chunks};
  })().then(done,e=>done({error:String(e)}));`,args:[],newSandbox:true});
  const nativeTunnel=tunnel.value??tunnel;
  if(nativeTunnel.error||nativeTunnel.glError||nativeTunnel.errors?.length||nativeTunnel.warnings?.length||nativeTunnel.chunks!==25||nativeTunnel.actual?.center!==nativeTunnel.bore?.center)throw Error('Native tunnel verification failed: '+JSON.stringify({...nativeTunnel,frame:undefined}));
  // RFP deliberately masks canvas exports; use the browser compositor without
  // disabling privacy protection or requesting access to the personal profile.
  await evaluate(`document.getElementById('menu-overlay').style.display='none';document.getElementById('landing').style.visibility='hidden';return true;`);
  await delay(150);const tunnelShot=await send('WebDriver:TakeScreenshot',{full:false});
  await writeFile('test-results/librewolf-tunnel.png',Buffer.from(tunnelShot.value??tunnelShot,'base64'));
  const bridge=await send('WebDriver:ExecuteAsyncScript',{script:`const done=arguments[arguments.length-1];(async()=>{
    await __rimmile.inspectDistance(26780);const p=__rimmile.snapshot();
    return {z:p.z,casters:p.bridgeShadowChunks,chunks:p.chunks,detail:p.detailRadius,glError:document.getElementById('game').getContext('webgl2').getError(),errors:__qaErrors};
  })().then(done,e=>done({error:String(e)}));`,args:[],newSandbox:true});
  const nativeBridge=bridge.value??bridge;
  if(nativeBridge.error||nativeBridge.glError||nativeBridge.errors.length||nativeBridge.casters<1||nativeBridge.casters>4||nativeBridge.chunks!==25||nativeBridge.detail!==500)throw Error('Native bridge verification failed: '+JSON.stringify(nativeBridge));
  const bridgeShot=await send('WebDriver:TakeScreenshot',{full:false});await writeFile('test-results/librewolf-bridge.png',Buffer.from(bridgeShot.value??bridgeShot,'base64'));

  await evaluate(`document.getElementById('menu-overlay').style.display='';document.getElementById('landing').style.visibility='';return true;`);
  const screenshot=await send('WebDriver:TakeScreenshot',{full:false});
  await writeFile('test-results/librewolf-qa.png',Buffer.from(screenshot.value??screenshot,'base64'));
  await click('#landing-settings');await evaluate(`const e=document.getElementById('handling-grip');e.value='25';e.dispatchEvent(new Event('input'));return true;`);
  const restorePose=await evaluate(`return __rimmile.snapshot();`);
  await send('WebDriver:SetWindowRect',{width:1280,height:800});await delay(300);
  const resized=await evaluate(`return __rimmile.snapshot();`);
  if(resized.running||resized.x!==restorePose.x||resized.z!==restorePose.z||Math.abs(resized.viewport.aspect-resized.viewport.cssWidth/resized.viewport.cssHeight)>.00001)throw Error('Paused native resize failed.');
  await send('WebDriver:Navigate',{url:'http://127.0.0.1:5177/'});await click('#landing-settings');
  const savedPreferences=await evaluate(`return {grip:document.getElementById('handling-grip').value,data:JSON.parse(localStorage.getItem('rimmile.preferences.v1')),audio:__rimmile.snapshot().audio??null};`);
  if(savedPreferences.grip!=='25'||savedPreferences.data.handling.grip!==.25||savedPreferences.audio!==null)throw Error('Native preference restore failed.');
  const resetDistanceBefore=await evaluate(`return localStorage.getItem('rimmile.distance.metres');`);
  await click('#reset-handling');
  const resetHandling=await evaluate(`return {balance:document.getElementById('handling-balance').value,grip:document.getElementById('handling-grip').value,handling:JSON.parse(localStorage.getItem('rimmile.preferences.v1')).handling,distance:localStorage.getItem('rimmile.distance.metres')};`);
  if(resetHandling.balance!=='0'||resetHandling.grip!=='0'||resetHandling.handling.balance!==0||resetHandling.handling.grip!==0||resetHandling.distance!==resetDistanceBefore)throw Error('Native handling reset failed.');

  const result={capabilities,rfp,before,zoom,settings,menuZoom,presets,lightsOff,lightsOn,activation,initialLevel,moving,movingLevel,transmission,paused,tunnel:nativeTunnel,bridge:nativeBridge,resized:resized.viewport,savedPreferences,resetHandling};
  await writeFile('test-results/librewolf-qa.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
  if(before.vehicle.kind!=='optimized'||before.vehicle.visualTriangles!==80364||!rfp||before.audio!==null||before.logo!==zoom.logo||before.width===zoom.width||settings.rows.some(value=>value>1)||presets.some(p=>p.glError||p.errors.length||p.warnings.length||p.detail!==500||p.audio.voice?.kind!=='sampled')||activation||initialLevel>.00001||!moving||movingLevel<.003||paused!=='suspended')throw Error('Native verification failed.');
}finally{
  if(owned)await send('Marionette:Quit',{flags:['eAttemptQuit']}).catch(()=>{});
  socket?.destroy();if(!owned)browser?.kill();await server.close();
}
