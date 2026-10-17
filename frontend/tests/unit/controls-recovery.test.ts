import {expect,it,vi} from 'vitest';
import {ControlBindings} from '../../src/input/bindings';
import {Keyboard} from '../../src/input/keyboard';
import {RoadRecovery} from '../../src/vehicle/recovery';
it('remaps primary keys, retains alternatives and rejects conflicts/reserved keys',()=>{
  const bindings=new ControlBindings();
  expect(bindings.assign('accelerate','KeyX')).toBe('assigned');
  expect(bindings.keys('accelerate')).toEqual(['KeyX','ArrowUp']);
  expect(bindings.assign('left','KeyX')).toBe('duplicate');
  for(const key of ['Escape','Tab','Enter','ControlLeft','F11'])expect(bindings.assign('left',key)).toBe('unsupported');
  bindings.reset();expect(bindings.keys('accelerate')).toEqual(['KeyW','ArrowUp']);
});
it('suppresses menu inputs and clears held keys on blur/rebinding',()=>{
  const events=new EventTarget();vi.stubGlobal('window',events);let running=true;
  const bindings=new ControlBindings(),input=new Keyboard(()=>running,()=>{},bindings);
  const down=(code:string)=>events.dispatchEvent(Object.assign(new Event('keydown',{cancelable:true}),{code,repeat:false}));
  try{
    down('KeyW');expect(input.read().throttle).toBe(true);events.dispatchEvent(new Event('blur'));expect(input.read().throttle).toBe(false);
    bindings.assign('accelerate','KeyX');input.clear();down('KeyW');expect(input.read().throttle).toBe(false);down('KeyX');expect(input.read().throttle).toBe(true);
    running=false;input.clear();down('KeyX');expect(input.read().throttle).toBe(false);
  }finally{input.dispose();vi.unstubAllGlobals();}
});
it('counts only simulation time, cancels with hysteresis, and expires once',()=>{
  const timer=new RoadRecovery();expect(timer.update(1,299)).toBe(false);expect(timer.seconds).toBe(0);
  expect(timer.update(.1,306)).toBe(false);expect(timer.seconds).toBe(5);
  timer.update(1,304);expect(timer.seconds).toBe(4);const frozen=timer.remaining;expect(timer.remaining).toBe(frozen);
  timer.update(.1,299);expect(timer.seconds).toBe(0);
  for(let i=0;i<49;i++)expect(timer.update(.1,350)).toBe(false);
  expect(timer.update(.100001,350)).toBe(true);timer.reset();expect(timer.seconds).toBe(0);
});

it('toggles lights once per press, respects remaps and suppresses menu/repeated input',()=>{
  const events=new EventTarget();vi.stubGlobal('window',events);let running=true,toggles=0;
  const bindings=new ControlBindings(),input=new Keyboard(()=>running,()=>{},bindings,()=>toggles++);
  const down=(code:string,repeat=false)=>events.dispatchEvent(Object.assign(new Event('keydown',{cancelable:true}),{code,repeat}));
  try {
    down('KeyL');down('KeyL',true);expect(toggles).toBe(1);expect(input.read()).toEqual({throttle:false,brake:false,steer:0});
    expect(bindings.assign('lights','KeyW')).toBe('duplicate');expect(bindings.assign('lights','KeyK')).toBe('assigned');
    down('KeyL');expect(toggles).toBe(1);down('KeyK');expect(toggles).toBe(2);
    running=false;down('KeyK');expect(toggles).toBe(2);
    bindings.reset();expect(bindings.keys('lights')).toEqual(['KeyL']);
    input.dispose();running=true;down('KeyL');expect(toggles).toBe(2);
  }finally{input.dispose();vi.unstubAllGlobals();}
});
