/** Bounded axle calibration; the preference store owns persistence. Zero preserves the established model. */
export interface Handling { balance:number; grip:number; }
export const DEFAULT_HANDLING:Readonly<Handling>={balance:0,grip:0};
export function handlingFactors(value:Handling){
 const finite=(v:number)=>Number.isFinite(v)?Math.max(-1,Math.min(1,v)):0;
 const balance=finite(value.balance),grip=1+finite(value.grip)*.18;
 return {grip,frontGrip:grip*(1+balance*.08),rearGrip:grip*(1-balance*.08),frontStiffness:1+balance*.13,rearStiffness:1-balance*.13};
}
