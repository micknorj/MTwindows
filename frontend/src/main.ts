import {browserDistance} from './app/distance';
import {browserPreferences} from './app/preferences';
import type {TransmissionMode} from './vehicle/drivetrain';
import {type Handling} from './vehicle/handling';
import {transition,type AppState,type AppEvent} from './app/state';
import type {Game} from './app/game';
import type {Graphics} from './rendering/graphics';
import {ControlBindings,ACTIONS,keyLabel,type DriveAction} from './input/bindings';
import {DriveAudio,type Volumes} from './audio/drive-audio';

const element=<T extends HTMLElement>(id:string)=>document.getElementById(id) as T;
const landing=element('landing'),scene=element('scene'),hud=element('hud'),overlay=element('menu-overlay');
const settingsPage=element('settings-page'),aboutPage=element('about-page');
const play=element<HTMLButtonElement>('play'),status=element('load-status'),speed=element('speed');
let canvas=element<HTMLCanvasElement>('game');
const preferences=browserPreferences(),saved=preferences.load();
const bindings=new ControlBindings(),volumes:Volumes={...saved.volumes};bindings.restore(saved.bindings);
let state:AppState='landing',game:Game|undefined,sessionAudio:DriveAudio|undefined;
let boot:Promise<void>|undefined,loadAttempt=0,worldReady=false,pendingDrive=false,progress=0;
let transmission=saved.transmission;
let lightsOn=saved.lights,fullscreenIntent=saved.fullscreen;
const distance=browserDistance(),handling:Handling={...saved.handling};
function toggleLights(){if(state!=='running')return;lightsOn=!lightsOn;game?.setLights(lightsOn);savePreferences();canvas.focus({preventScroll:true});}
const graphics:Graphics={...saved.graphics};let capture:DriveAction|undefined;
function savePreferences(){preferences.save({transmission,graphics,volumes,handling,bindings:bindings.snapshot(),lights:lightsOn,fullscreen:fullscreenIntent});}
for(const option of document.querySelectorAll<HTMLButtonElement>('[data-graphics]'))option.setAttribute('aria-pressed',String(graphics[option.dataset.graphics as keyof Graphics]===option.dataset.value));
function audioAvailability(available:boolean){
  element<HTMLFieldSetElement>('audio-settings').disabled=!available;
  element('audio-status').textContent=available?'':'Audio unavailable.';
}
audioAvailability(typeof AudioContext!=='undefined');
function renderBindings(){
  for(const action of ACTIONS){
    const button=document.querySelector<HTMLButtonElement>(`[data-binding="${action}"]`)!;
    button.textContent=capture===action?'Press a key…':bindings.keys(action).map(keyLabel).join(' / ');
    button.setAttribute('aria-pressed',String(capture===action));
  }
}
function render(){
  const running=state==='running',settings=state.endsWith('-settings'),about=state.endsWith('-about');
  landing.hidden=running||settings||about;settingsPage.hidden=!settings;aboutPage.hidden=!about;
  hud.hidden=!running;overlay.hidden=running;scene.hidden=!worldReady;
  status.hidden=running||state==='paused';
  element('distance-milestone').hidden=state!=='paused';
  element('distance-milestone').textContent=`Distance driven · ${distance.kilometres.toFixed(1)} km`;
  if(!running)distance.flush();
  play.disabled=pendingDrive&&state==='loading';
  play.textContent=state==='paused'?'- Resume -':pendingDrive?`- Loading ${progress}% -`:status.textContent?'- Retry -':'- Drive -';
  play.setAttribute('aria-label',state==='paused'?'Resume':pendingDrive?`Loading ${progress}%`:status.textContent?'Retry':'Drive');
  if(running){canvas.focus({preventScroll:true});game?.resume();}
  else game?.pause();
}
function dispatch(event:AppEvent){
  const previous=state,next=transition(state,event);if(next===previous)return;
  if(capture){capture=undefined;renderBindings();element('binding-status').textContent='';}
  if(event==='settings'||event==='about'){pendingDrive=false;game?.clearInput();}
  state=next;render();
  if(state.endsWith('-settings'))element('settings-back').focus({preventScroll:true});
  else if(state.endsWith('-about'))element('about-back').focus({preventScroll:true});
  else if(state!=='running'){
    if(event==='back'||event==='escape')element(previous.endsWith('-about')?'landing-about':previous.endsWith('-settings')?'landing-settings':'play').focus({preventScroll:true});
    else play.focus({preventScroll:true});
    if(worldReady&&state==='landing')game?.menuFrame();
  }
}
function fail(message:string){
  loadAttempt++;pendingDrive=false;worldReady=false;boot=undefined;
  const failed=game;game=undefined;
  try{failed?.dispose();}catch{/* Preserve a usable failure screen. */}
  sessionAudio?.dispose();sessionAudio=undefined;
  speed.textContent='0';element('recovery-status').textContent='';element('transmission-status').textContent='';
  const replacement=canvas.cloneNode(false) as HTMLCanvasElement;canvas.replaceWith(replacement);canvas=replacement;
  status.textContent=message;
  if(state.endsWith('-settings')||state.endsWith('-about')){state=state.endsWith('-settings')?'landing-settings':'landing-about';render();}else{state='error';render();play.focus();}
}
function prepareWorld(){
  if(boot)return boot;
  const attempt=++loadAttempt;progress=0;status.textContent='';
  boot=(async()=>{
    try{
      const {Game}=await import('./app/game');if(attempt!==loadAttempt)return;
      game=new Game(canvas,value=>{speed.textContent=String(value);},fail,bindings,seconds=>{
        element('recovery-status').textContent=seconds>0?`Returning to road in ${seconds}…`:'';
      },toggleLights,metres=>distance.add(metres),text=>{element('transmission-status').textContent=text;});
      game.setHandling(handling);game.setTransmission(transmission);
      game.setLights(lightsOn);game.setGraphics(graphics);
      await game.initialize(value=>{if(attempt===loadAttempt){progress=value;if(pendingDrive){play.textContent=`- Loading ${value}% -`;play.setAttribute('aria-label',`Loading ${value}%`);}}});
      if(attempt!==loadAttempt)return;worldReady=true;render();
    }catch(error){if(attempt===loadAttempt)fail(error instanceof Error?error.message:'Unable to start.');}
  })();return boot;
}
play.addEventListener('click',async()=>{
  if(state==='paused'){if(!document.hidden)dispatch('resume');return;}
  if(pendingDrive)return;
  if(fullscreenIntent&&document.fullscreenEnabled&&!document.fullscreenElement)void document.documentElement.requestFullscreen().catch(()=>{element('graphics-status').textContent='Fullscreen unavailable.';});
  pendingDrive=true;dispatch('play');
  const audio=sessionAudio??new DriveAudio(()=>audioAvailability(false));sessionAudio=audio;
  audio.setVolumes(volumes);audio.pause();
  const world=prepareWorld(),attempt=loadAttempt;
  await Promise.all([world,audio.ready]);
  if(attempt!==loadAttempt||!worldReady)return;
  game?.attachAudio(audio);audioAvailability(audio.diagnostics.available);
  if(pendingDrive&&state==='loading'){
    pendingDrive=false;dispatch('ready');
    if(document.hidden||!document.hasFocus())dispatch('blur');
  }else{pendingDrive=false;render();}
});
element('pause').addEventListener('click',()=>dispatch('pause'));
element('landing-settings').addEventListener('click',()=>dispatch('settings'));
element('landing-about').addEventListener('click',()=>dispatch('about'));
element('settings-back').addEventListener('click',()=>dispatch('back'));
element('about-back').addEventListener('click',()=>dispatch('back'));
for(const button of document.querySelectorAll<HTMLButtonElement>('[data-graphics]'))button.addEventListener('click',()=>{
 const key=button.dataset.graphics as keyof Graphics;(graphics as unknown as Record<string,string>)[key]=button.dataset.value!;
 game?.setGraphics(graphics);savePreferences();
 for(const option of document.querySelectorAll<HTMLButtonElement>(`[data-graphics="${key}"]`))option.setAttribute('aria-pressed',String(option===button));
});
for(const key of ['master','engine','environment'] as const){
  const control=element<HTMLInputElement>(key);
  const update=()=>{control.style.setProperty('--range-fill',`${control.value}%`);element(`${key}-value`).textContent=`${control.value}%`;volumes[key]=Number(control.value)/100;sessionAudio?.setVolumes(volumes);};
  control.value=String(Math.round(volumes[key]*100));control.addEventListener('input',()=>{update();savePreferences();});update();
}
function renderHandling(){
 for(const key of ['balance','grip'] as const){
  const control=element<HTMLInputElement>(`handling-${key}`),value=handling[key];
  const text=key==='balance'?(value===0?'Balanced':value<0?'Understeer':'Oversteer'):(value===0?'Normal':value<0?'Low':'High');
  control.value=String(Math.round(value*100));element(`handling-${key}-value`).textContent=text;
  control.setAttribute('aria-valuetext',text);control.style.setProperty('--range-fill',`${(value+1)*50}%`);
 }
}
for(const key of ['balance','grip'] as const){
 const control=element<HTMLInputElement>(`handling-${key}`);
 control.addEventListener('input',()=>{handling[key]=Number(control.value)/100;game?.setHandling(handling);renderHandling();savePreferences();});
}
renderHandling();
function renderTransmission(){for(const button of document.querySelectorAll<HTMLButtonElement>('[data-transmission]'))button.setAttribute('aria-pressed',String(button.dataset.transmission===transmission));}
for(const button of document.querySelectorAll<HTMLButtonElement>('[data-transmission]'))button.addEventListener('click',()=>{
 transmission=button.dataset.transmission as TransmissionMode;game?.setTransmission(transmission);game?.clearInput();renderTransmission();savePreferences();
});
renderTransmission();
element('reset-handling').addEventListener('click',()=>{
 handling.balance=0;handling.grip=0;game?.setHandling(handling);renderHandling();savePreferences();
});
const fullscreenOptions=[...document.querySelectorAll<HTMLButtonElement>('[data-fullscreen]')];
for(const button of fullscreenOptions){
  button.disabled=!document.fullscreenEnabled;
  button.addEventListener('click',async()=>{
    try{
      if(button.dataset.fullscreen==='on'&&!document.fullscreenElement)await document.documentElement.requestFullscreen();
      if(button.dataset.fullscreen==='off'&&document.fullscreenElement)await document.exitFullscreen();
      fullscreenIntent=button.dataset.fullscreen==='on';savePreferences();element('graphics-status').textContent='';
    }catch{element('graphics-status').textContent='Fullscreen unavailable.';}
  });
}
if(!document.fullscreenEnabled)element('graphics-status').textContent='Fullscreen unavailable.';
document.addEventListener('fullscreenchange',()=>fullscreenOptions.forEach(button=>button.setAttribute('aria-pressed',String((button.dataset.fullscreen==='on')===!!document.fullscreenElement))));
for(const button of document.querySelectorAll<HTMLButtonElement>('[data-binding]')){
  button.addEventListener('click',()=>{
    capture=button.dataset.binding as DriveAction;game?.clearInput();renderBindings();
    element('binding-status').textContent='Press a letter, number, arrow or Space. Esc cancels. The arrow alternative is retained. Keys assigned elsewhere are rejected.';
  });
}
element('reset-controls').addEventListener('click',()=>{capture=undefined;bindings.reset();game?.clearInput();renderBindings();savePreferences();element('binding-status').textContent='';});
window.addEventListener('keydown',event=>{
  if(capture){
    event.preventDefault();event.stopImmediatePropagation();if(event.repeat)return;
    if(event.code==='Escape'){capture=undefined;renderBindings();element('binding-status').textContent='';return;}
    const result=event.altKey||event.ctrlKey||event.metaKey?'unsupported':bindings.assign(capture,event.code);
    if(result==='assigned'){capture=undefined;game?.clearInput();renderBindings();savePreferences();element('binding-status').textContent='';}
    else element('binding-status').textContent=result==='duplicate'?'That key is assigned to another control. Choose another key, or Esc to cancel.':'That key is unavailable. Use a letter, number, arrow or Space; Esc cancels.';
    return;
  }
  if(event.code==='Escape'){event.preventDefault();if(!event.repeat&&!document.hidden)dispatch('escape');}
},true);
window.addEventListener('blur',()=>{game?.clearInput();if(capture){capture=undefined;renderBindings();element('binding-status').textContent='';}dispatch('blur');});
document.addEventListener('visibilitychange',()=>{if(document.hidden)dispatch('blur');});
window.addEventListener('pagehide',event=>{
  distance.flush();
  if(event.persisted){dispatch('blur');return;}loadAttempt++;game?.dispose();game=undefined;sessionAudio?.dispose();
});
if(import.meta.env.DEV){
  Object.defineProperty(window,'__rimmile',{configurable:true,value:{
    snapshot:()=>({state,...game?.diagnostics}),
    inspectDistance:(z:number)=>game?.inspectDistance(z),
    inspectPose:(turn:number,pitch:number,roll:number)=>game?.inspectPose(turn,pitch,roll),
    inspectFrame:()=>game?.inspectFrame(),inspectSpeed:(speed:number)=>game?.inspectSpeed(speed),
    inspectHeadlights:(lamp:-1|0|1|2)=>game?.inspectHeadlights(lamp),
    inspectCamera:(eye:[number,number,number],target:[number,number,number])=>game?.inspectCamera(eye,target),
    inspectPosition:(x:number,z:number)=>game?.inspectPosition(x,z),
  }});
}
renderBindings();render();void prepareWorld();
