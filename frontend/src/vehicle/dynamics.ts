import {VEHICLE} from './config';

/** Operating mass/aero/tire constants are calibration assumptions, not telemetry. */
export const DYNAMICS={
  mass:1800, gravity:9.81, frontWeight:.43, centreHeight:.46,
  yawInertia:3100, pitchInertia:2700, rollInertia:850,
  wheelInertia:2.8, spring:[42000,55000], damper:[2700,3200],
  antiRoll:[8500,9500], cornering:[82000,108000],
  longitudinalStiffness:90000, relaxationLength:.25,
  frontDrive:.3, frontBrake:.64, maximumBrake:14,
  drag:.5*1.225*.72, downforce:[.16,.23],
} as const;
export const CENTRE_Z=(DYNAMICS.frontWeight-.5)*VEHICLE.wheelbase;
export const wheelX=(i:number)=>(i%2?-1:1)*VEHICLE.track/2;
export const wheelZ=(i:number)=>(i<2?1:-1)*VEHICLE.wheelbase/2;

/** Saturating combined-slip tire, with implicit wheel/longitudinal integration.
 * The implicit term avoids a stiff tire-force oscillator at low road speeds. */
export function tireForces(load:number,mu:number,cornering:number,forward:number,lateral:number,omega:number,torque:number,dt:number,previousLateral:number){
  if(load<=0)return {longitudinal:0,lateral:0,omega:omega+torque/DYNAMICS.wheelInertia*dt,slip:0};
  const capacity=Math.max(1,load*mu),denominator=Math.max(3,Math.abs(forward));
  const freeOmega=omega+torque/DYNAMICS.wheelInertia*dt;
  const implicit=denominator+DYNAMICS.longitudinalStiffness*VEHICLE.wheelRadius**2/DYNAMICS.wheelInertia*dt;
  let fx=DYNAMICS.longitudinalStiffness*(freeOmega*VEHICLE.wheelRadius-forward)/implicit;
  const angle=Math.atan2(lateral,denominator);
  const target=-capacity*Math.tanh(cornering*angle/capacity);
  let fy=previousLateral+(target-previousLateral)*(1-Math.exp(-denominator*dt/DYNAMICS.relaxationLength));
  const combined=Math.hypot(fx,fy)/capacity;
  if(combined>1){fx/=combined;fy/=combined;}
  const nextOmega=freeOmega-fx*VEHICLE.wheelRadius/DYNAMICS.wheelInertia*dt;
  return {longitudinal:fx,lateral:fy,omega:nextOmega,slip:(nextOmega*VEHICLE.wheelRadius-forward)/denominator};
}
