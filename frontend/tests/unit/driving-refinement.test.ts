import {expect,it,vi} from 'vitest';
import {PerspectiveCamera,Vector3} from 'three';
import {Keyboard} from '../../src/input/keyboard';
import {VehiclePhysics} from '../../src/vehicle/physics';
import {generateChunk} from '../../src/world/generate';
import {bridgeAt,riverAt,roadAt,RAIL_OFFSET,BRIDGE_HALF_WIDTH} from '../../src/world/road';
import {surfaceHeight} from '../../src/world/surface';
import {VEHICLE} from '../../src/vehicle/config';

const idle={throttle:false,brake:false,steer:0};
it('samples wheel support at the exported driver-left/right pivot positions',()=>{
  const car=new VehiclePhysics(1942);car.placeOnRoad(750);
  // Settle an oblique roadside pose, giving the four wheels unequal support.
  car.x+=4;car.heading+=.2;
  for(let step=0;step<90;step++)car.step(1/60,idle);
  const c=Math.cos(car.heading),s=Math.sin(car.heading);
  for(let i=0;i<4;i++){
    const lx=(i%2?-1:1)*VEHICLE.track/2,lz=(i<2?1:-1)*VEHICLE.wheelbase/2;
    const ground=surfaceHeight(car.x+c*lx+s*lz,car.z-s*lx+c*lz,car.seed);
    const required=ground-car.y+Math.sin(car.pitch)*lz-Math.sin(car.roll)*lx;
    expect(car.wheelTravel[i]).toBeCloseTo(Math.max(-.18,Math.min(.14,required)),6);
    expect(car.wheelContact[i]).toBe(required>=-.18);
  }
});
it('A/D and arrows turn the wheels and trajectory left/right in the chase-camera frame',()=>{
  const events=new EventTarget();vi.stubGlobal('window',events);
  const keyboard=new Keyboard(()=>true,()=>{});
  const left=new VehiclePhysics(1942),right=new VehiclePhysics(1942);
  const origin={x:left.x,y:left.y,z:left.z,heading:left.heading};
  try{
    for(const [car,key,steer] of [[left,'KeyA',1],[right,'KeyD',-1]] as const){
      keyboard.clear();events.dispatchEvent(Object.assign(new Event('keydown',{cancelable:true}),{code:key,repeat:false}));
      const input=keyboard.read();expect(input.steer).toBe(steer);
      car.speed=12;for(let i=0;i<60;i++)car.step(1/60,input);
      expect(Math.sign(car.steer)).toBe(steer);
    }
    for(const [code,sign] of [['ArrowLeft',1],['ArrowRight',-1]] as const){keyboard.clear();events.dispatchEvent(Object.assign(new Event('keydown'),{code,repeat:false}));expect(keyboard.read().steer).toBe(sign);}
  }finally{keyboard.dispose();vi.unstubAllGlobals();}
  const camera=new PerspectiveCamera(52,16/9,.1,2600);
  camera.position.set(origin.x-Math.sin(origin.heading)*8.2,origin.y+3.3,origin.z-Math.cos(origin.heading)*8.2);
  camera.lookAt(origin.x+Math.sin(origin.heading)*8,origin.y+.85,origin.z+Math.cos(origin.heading)*8);camera.updateMatrixWorld();
  const projected=(car:VehiclePhysics)=>new Vector3(car.x,car.y,car.z).project(camera).x;
  expect(projected(left)).toBeLessThan(-.05);expect(projected(right)).toBeGreaterThan(.05);
  expect(left.heading-origin.heading).toBeGreaterThan(0);expect(right.heading-origin.heading).toBeLessThan(0);
});
it('full keyboard steering at 250 km/h has a progressive, bounded response',()=>{
  const car=new VehiclePhysics(1942);car.speed=250/3.6;
  for(let i=0;i<24;i++)car.step(1/60,{...idle,steer:1});
  expect(Math.abs(car.steer)).toBeGreaterThan(.004);
  expect(Math.abs(car.steer)).toBeLessThan(.012);
  expect(Math.abs(car.yawRate)).toBeLessThan(.25);
  const turn=car.steer;for(let i=0;i<30;i++)car.step(1/60,idle);
  expect(Math.abs(car.steer)).toBeLessThan(turn*.01);
});
it.each(['metal','wood','stone'] as const)('settles low/high speed %s impacts without adding kinetic energy or launching',material=>{
  for(const speed of [3,25,90]){
    const car=new VehiclePhysics(1942);car.heading=0;car.speed=speed;
    const initialY=car.y;
    car.obstacles=[[{x:car.x,y:car.y-2,z:car.z+5,halfX:material==='metal'?20:.8,halfZ:.35,height:6,heading:0,material}]];
    for(let i=0;i<90;i++){
      car.step(1/60,idle);
      expect(Math.hypot(car.speed,car.lateralSpeed)).toBeLessThanOrEqual(speed+.1);
      expect(Math.abs(car.yawRate)).toBeLessThan(.8);
      expect(car.y-initialY).toBeLessThan(1);
    }
    expect(car.impacts).toBeGreaterThan(0);
  }
});
it('bridge railing feet sit on the slab, and beam endpoints follow its grade',()=>{
  for(const seed of [0,1942,98213]){
    const crossing=riverAt(0,seed).crossing,id=Math.floor(crossing/200),data=generateChunk(id,seed).scenery;
    const rails=data.instances.rail;
    expect(data.railPitch.length).toBe(rails.length/7);
    for(let i=0;i<rails.length;i+=7){
      const z=rails[i+2]+id*200;if(!bridgeAt(z,seed).active)continue;
      const road=roadAt(z,seed);
      expect(Math.abs(rails[i]-road.x)).toBeCloseTo(RAIL_OFFSET,2);
      expect(Math.abs(rails[i]-road.x)).toBeLessThan(BRIDGE_HALF_WIDTH);
      const deck=road.y+(rails[i]-road.x)*road.bank-.018*Math.abs(rails[i]-road.x)-.025;
      expect(rails[i+1]-deck).toBeCloseTo(.62,2);
      expect(Math.abs(data.railPitch[i/7])).toBeLessThan(.1);
    }
  }
});
