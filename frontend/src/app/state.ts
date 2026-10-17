export type AppState='landing'|'loading'|'error'|'running'|'paused'|'landing-settings'|'paused-settings'|'landing-about'|'paused-about';
export type AppEvent='play'|'ready'|'fail'|'escape'|'pause'|'settings'|'about'|'blur'|'back'|'resume';
export function transition(state:AppState,event:AppEvent):AppState{
  if(event==='fail')return 'error';
  if(event==='blur'&&state==='running')return 'paused';
  if(event==='pause'&&state==='running')return 'paused';
  if(event==='play'&&(state==='landing'||state==='error'))return 'loading';
  if(event==='ready'&&state==='loading')return 'running';
  if(event==='resume'&&state==='paused'||event==='escape'&&state==='paused')return 'running';
  if(event==='escape'&&state==='running')return 'paused';
  const root=state.startsWith('paused')?'paused':'landing';
  if(event==='settings'&&state!=='running')return `${root}-settings`;
  if(event==='about'&&state!=='running')return `${root}-about`;
  if((event==='back'||event==='escape')&&(state.endsWith('-settings')||state.endsWith('-about')))return root;
  return state;
}
