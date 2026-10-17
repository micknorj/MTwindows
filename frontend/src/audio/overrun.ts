/** Load chooses recorded timbre, not a large volume fade. Overrun remains within
 * 0.36 dB of loaded gain; bank RMS is balanced independently at initialization. */
export function engineLoadLevel(_rpm:number,load:number){
 const power=Math.max(0,Math.min(1,Number.isFinite(load)?load:0));
 return .96+.04*power;
}
