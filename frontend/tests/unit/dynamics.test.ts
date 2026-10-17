import {expect,it} from 'vitest';
import {VehiclePhysics} from '../../src/vehicle/physics';
import {DYNAMICS,tireForces} from '../../src/vehicle/dynamics';
import {VEHICLE} from '../../src/vehicle/config';
const idle={throttle:false,brake:false,steer:0};
const flat=()=>new VehiclePhysics(1942,()=>0,()=>1.24);

it('balances static mass at the four springs with the rear-biased axle split',()=>{
  const car=flat();for(let i=0;i<240;i++)car.step(1/60,idle);
  expect(car.wheelLoad.reduce((a,b)=>a+b,0)).toBeCloseTo(DYNAMICS.mass*9.81,0);
  expect((car.wheelLoad[0]+car.wheelLoad[1])/(DYNAMICS.mass*9.81)).toBeCloseTo(.43,3);
  expect(car.pitch).toBeCloseTo(0,4);expect(car.roll).toBeCloseTo(0,4);
});
it('keeps combined tire forces inside grip and avoids low-speed wheel oscillation',()=>{
  let omega=0,lateral=0;
  for(let i=0;i<240;i++){
    const tire=tireForces(4000,1.2,72000,2,5,omega,1000,1/240,lateral);omega=tire.omega;lateral=tire.lateral;
    expect(Math.hypot(tire.longitudinal,tire.lateral)).toBeLessThanOrEqual(4800.00001);
    expect(Number.isFinite(omega)).toBe(true);
  }
  const airborne=tireForces(0,1.2,72000,20,5,20/VEHICLE.wheelRadius,0,1/240,lateral);
  expect(airborne.longitudinal).toBe(0);expect(airborne.lateral).toBe(0);
});
it('transfers load rearward on launch and forward during ABS braking',()=>{
  const car=flat();for(let i=0;i<45;i++)car.step(1/60,{...idle,throttle:true});
  const front=(car.wheelLoad[0]+car.wheelLoad[1])/car.wheelLoad.reduce((a,b)=>a+b,0);
  expect(front).toBeLessThan(.43);expect(car.pitch).toBeLessThan(0);
  car.setSpeed(30);for(let i=0;i<40;i++)car.step(1/60,{...idle,brake:true});
  const brakeFront=(car.wheelLoad[0]+car.wheelLoad[1])/car.wheelLoad.reduce((a,b)=>a+b,0);
  expect(brakeFront).toBeGreaterThan(.43);expect(car.pitch).toBeGreaterThan(0);
});
it('has responsive high-speed cornering and restores a straight wheel without forced yaw',()=>{
  const car=flat();car.setSpeed(250/3.6);
  for(let i=0;i<60;i++)car.step(1/60,{...idle,steer:1});
  expect(car.yawRate*car.speed).toBeGreaterThan(7);
  expect(car.yawRate*car.speed).toBeLessThan(17);
  expect(car.wheelLoad[1]+car.wheelLoad[3]).toBeGreaterThan(car.wheelLoad[0]+car.wheelLoad[2]);
  for(let i=0;i<120;i++)car.step(1/60,idle);
  expect(Math.abs(car.steer)).toBeLessThan(.00001);expect(Math.abs(car.yawRate)).toBeLessThan(.02);
});
it('is consistent across simulation subdivisions and produces believable acceleration/stopping',()=>{
  const a=flat(),b=flat();
  for(let i=0;i<180;i++){a.step(1/60,{...idle,throttle:true});b.step(1/120,{...idle,throttle:true});b.step(1/120,{...idle,throttle:true});}
  expect(a.speed).toBeCloseTo(b.speed,2);expect(a.speed*3.6).toBeGreaterThan(90);expect(a.speed*3.6).toBeLessThan(130);
  a.setSpeed(100/3.6);const x=a.x,z=a.z;
  for(let i=0;i<240&&a.speed>.1;i++)a.step(1/60,{...idle,brake:true});
  expect(a.speed).toBeLessThan(.1);expect(Math.hypot(a.x-x,a.z-z)).toBeGreaterThan(25);expect(Math.hypot(a.x-x,a.z-z)).toBeLessThan(45);
});
