import {smooth,clamp} from './road';
/** Shared slope transitions for PBR terrain and vegetation placement. */
export const ROCK_SLOPE={mixedStart:.05,mixedEnd:.29,cliffStart:.12,cliffEnd:.38} as const;
export function rockCoverage(normalY:number,variation:number){
 const slope=1-Math.abs(normalY),v=clamp(variation),s=ROCK_SLOPE;
 const mixed=smooth((slope-s.mixedStart)/(s.mixedEnd-s.mixedStart))*(.16+.28*v),cliff=smooth((slope-s.cliffStart)/(s.cliffEnd-s.cliffStart));
 return mixed*(1-cliff)+(.9+.1*v)*cliff;
}
export function vegetationSlopeCover(gradient:number){return 1-smooth((gradient-.48)/.72);}
