/** Stationary idle is quieter; moving/overrun/shift voices keep their profile. */
export function idleEngineLevel(speed:number){
  const t=Math.max(0,Math.min(1,(Math.abs(speed)-.2)/1.8));
  return .76+.24*t*t*(3-2*t);
}
