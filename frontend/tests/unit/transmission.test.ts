import {expect,it,vi} from 'vitest';
import {Drivetrain,RATIOS} from '../../src/vehicle/drivetrain';
import {VehiclePhysics} from '../../src/vehicle/physics';
import {ControlBindings,migrateLegacyBindings,ACTIONS} from '../../src/input/bindings';
import {Keyboard} from '../../src/input/keyboard';
import {PreferenceStore,PREFERENCES_KEY,defaultPreferences} from '../../src/app/preferences';
import {prepareLoop} from '../../src/audio/loop-buffer';

const idle={throttle:false,brake:false,steer:0};
const settle=(d:Drivetrain,speed=0)=>{for(let i=0;i<40;i++)d.step(.01,speed,0);};
it('retains all eight selected manual gears, limits and rejects an over-rev downshift',()=>{
 const d=new Drivetrain();expect(d.mode).toBe('Automatic');d.setMode('Manual');expect(d.shiftManual(-1,0)).toBe('limit');
 for(let gear=2;gear<=8;gear++){expect(d.shiftManual(1,0)).toBe('shifted');expect(d.gear).toBe(gear);expect(d.shiftManual(-1,0)).toBe('busy');settle(d);}
 expect(d.shiftManual(1,0)).toBe('limit');
 expect(d.shiftManual(-1,100)).toBe('shifted');settle(d,100);expect(d.gear).toBe(7);
 expect(d.shiftManual(-1,100)).toBe('overrev');expect(d.gear).toBe(7);
 for(let i=0;i<2000;i++){const force=d.step(1/240,115,1);expect(Number.isFinite(force)).toBe(true);expect(d.rpm).toBeLessThanOrEqual(9500);}
 expect(d.gear).toBe(7);d.setMode('Automatic');settle(d,115);expect(d.gear).toBe(8);d.setMode('Manual');expect(d.gear).toBe(8);
});
it('couples RPM and torque to manual selection with finite DCT transitions and no runaway limiter',()=>{
 const d=new Drivetrain();d.setMode('Manual');for(let i=0;i<100;i++)d.step(.01,18,1);const before=d.rpm;
 expect(d.shiftManual(1,18)).toBe('shifted');expect(d.rpm).toBe(before);const samples=[];
 for(let i=0;i<100;i++){const old=d.rpm,force=d.step(.004,18,1);expect(Math.abs(d.rpm-old)).toBeLessThan(300);expect(Math.abs(force)).toBeLessThan(45000);samples.push(force);}
 expect(d.rpm/before).toBeCloseTo(RATIOS[1]/RATIOS[0],1);expect(Math.min(...samples)).toBeLessThan(samples.at(-1)!*.6);
 for(let i=0;i<100;i++)d.step(.01,100,1);expect(d.gear).toBe(2);expect(d.step(.01,100,1)).toBe(0);
 expect(d.shiftManual(1,100)).toBe('shifted');
});
it('electric reverse needs accelerator in both modes, has idle ICE RPM, brakes both directions and switches only near rest',()=>{
 for(const mode of ['Automatic','Manual'] as const){
  const car=new VehiclePhysics(1942,()=>0,()=>1.24),d=car.drivetrain;d.setMode(mode);car.setSpeed(5);
  expect(d.toggleDirection(car.speed)).toBe(false);expect(d.toggleDirection(0,2)).toBe(false);
  for(let i=0;i<480;i++)car.step(1/120,{...idle,brake:true});expect(car.speed).toBe(0);expect(d.direction).toBe('Drive');
  expect(d.toggleDirection(0)).toBe(true);for(let i=0;i<240;i++)car.step(1/120,idle);expect(car.speed).toBe(0);
  expect(d.shiftManual(1,0)).toBe(mode==='Manual'?'reverse':'automatic');
  for(let i=0;i<360;i++)car.step(1/120,{...idle,throttle:true});expect(car.speed).toBeLessThan(-2);expect(d.rpm).toBeCloseTo(900,4);expect(d.load).toBe(0);
  for(let i=0;i<480;i++)car.step(1/120,{...idle,brake:true});expect(car.speed).toBe(0);expect(d.direction).toBe('Reverse');
  d.toggleDirection(car.speed);for(let i=0;i<240;i++)car.step(1/120,{...idle,throttle:true});expect(car.speed).toBeGreaterThan(1);
  car.recover();expect(d.mode).toBe(mode);expect(d.direction).toBe('Drive');expect(d.gear).toBe(1);
 }
});
it('migrates legacy defaults and preserves customized keys without assigning conflicts',()=>{
 const legacy={accelerate:['KeyW','ArrowUp'],brake:['KeyS','ArrowDown'],left:['KeyA','ArrowLeft'],right:['KeyD','ArrowRight'],recover:['KeyR'],lights:['KeyE']};
 expect(migrateLegacyBindings(legacy)).toEqual(new ControlBindings().snapshot());
 const custom={...legacy,lights:['KeyQ'],recover:['KeyT'],accelerate:['KeyR','ArrowUp']};const migrated=migrateLegacyBindings(custom)!;
 expect(migrated.lights).toEqual(['KeyQ']);expect(migrated.recover).toEqual(['KeyT']);expect(migrated.accelerate).toEqual(['KeyR','ArrowUp']);
 const keys=Object.values(migrated).flat();expect(new Set(keys).size).toBe(keys.length);expect(new ControlBindings().restore(migrated)).toBe(true);
 for(const version of [1,2]){let raw=JSON.stringify({version,bindings:custom,volumes:{master:.42},handling:{grip:.3},lights:false});
  const store=new PreferenceStore({getItem:()=>raw,setItem:(key,v)=>{expect(key).toBe(PREFERENCES_KEY);raw=v;}}),prefs=store.load();expect(prefs.bindings).toEqual(migrated);expect(prefs.volumes.master).toBe(.42);prefs.transmission='Manual';store.save(prefs);expect(JSON.parse(raw).version).toBe(3);expect(store.load()).toEqual(prefs);
 }
 const prefs=defaultPreferences();expect(prefs.transmission).toBe('Automatic');
 const corrupt=new PreferenceStore({getItem:()=>JSON.stringify({...prefs,version:3,transmission:'CVT',bindings:{...prefs.bindings,shiftDown:['KeyQ']},volumes:{master:.42}}),setItem:()=>{}}).load();expect(corrupt.transmission).toBe('Automatic');expect(corrupt.bindings).toEqual(prefs.bindings);expect(corrupt.volumes.master).toBe(.42);expect(migrateLegacyBindings({...legacy,left:['Escape']})).toBeUndefined();
});
it('dispatches each shift/direction once, suppresses repeat/held modifiers and clears on focus loss',()=>{
 const events=new EventTarget();vi.stubGlobal('window',events);let running=true;const shifts:number[]=[],direction=vi.fn(),recover=vi.fn(),lights=vi.fn();
 const bindings=new ControlBindings(),keyboard=new Keyboard(()=>running,recover,bindings,lights,change=>shifts.push(change),direction);
 const down=(code:string,extra={})=>events.dispatchEvent(Object.assign(new Event('keydown',{cancelable:true}),{code,repeat:false,...extra}));
 const up=(code:string)=>events.dispatchEvent(Object.assign(new Event('keyup'),{code}));
 try{down('KeyQ');down('KeyQ');down('KeyQ',{repeat:true});expect(shifts).toEqual([1]);up('KeyQ');down('KeyQ');down('KeyE');expect(shifts).toEqual([1,1,-1]);
  down('KeyR');down('KeyR',{repeat:true});expect(direction).toHaveBeenCalledTimes(1);down('KeyT');down('KeyL');expect(recover).toHaveBeenCalledTimes(1);expect(lights).toHaveBeenCalledTimes(1);
  down('KeyW');expect(keyboard.read().throttle).toBe(true);events.dispatchEvent(new Event('blur'));expect(keyboard.read().throttle).toBe(false);down('KeyW',{repeat:true});expect(keyboard.read().throttle).toBe(false);
  down('KeyW',{ctrlKey:true});expect(keyboard.read().throttle).toBe(false);running=false;down('KeyR');expect(direction).toHaveBeenCalledTimes(1);
  bindings.reset();expect(ACTIONS).toHaveLength(9);
 }finally{keyboard.dispose();vi.unstubAllGlobals();}
});
it('prepares a continuous periodic loop without mutating originals or collapsing stereo',()=>{
 const rate=48000,length=rate*3,a=new Float32Array(length),b=new Float32Array(length);
 for(let i=0;i<length;i++){a[i]=Math.sin(i*.0251)*(.1+.02*Math.sin(i/rate));b[i]=Math.sin(i*.0251+.4)*.1;}
 const original=a.slice(),[left,right]=prepareLoop([a,b],rate);expect(a).toEqual(original);expect(left.length).toBeGreaterThanOrEqual(length-Math.round(rate*.092));expect(left.length).toBeLessThanOrEqual(length-Math.round(rate*.068));expect(left).not.toEqual(right);
 const seam=Math.abs(left[0]-left.at(-1)!);expect(seam).toBeLessThan(.005);let peak=0,sum=0;for(const v of left){peak=Math.max(peak,Math.abs(v));sum+=v*v;}
 expect(peak).toBeLessThan(.4);expect(Math.sqrt(sum/left.length)).toBeGreaterThan(.1);
});
