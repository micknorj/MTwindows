import {bridgeAt,roadAt,riverChannelAt,smooth,tunnelAt,RAIL_OFFSET} from './road';
import {surfaceHeight} from './surface';
import {terrainMeshHeight} from './terrain-grid';
const cache=new Map<string,boolean>();
function hazard(z:number,seed:number,side:number){
 const key=`${seed}:${z}:${side}`;if(cache.has(key))return cache.get(key)!;
 const p=roadAt(z,seed),bridge=bridgeAt(z,seed),river=riverChannelAt(z,seed),edge=p.x+side*14;
 const drop=p.y-terrainMeshHeight(edge,z,seed);
 const riverFacing=Math.sign(river.x-p.x)===side&&Math.abs(river.x-p.x)<river.halfWidth+25&&p.y-river.y>2;
 const value=!tunnelAt(z,seed)&&(bridge.active||drop>3.5||riverFacing);
 cache.set(key,value);if(cache.size>4096)cache.delete(cache.keys().next().value!);return value;
}
/** Extend real hazards into smooth terminals; used by beams, colliders and posts. */
export function railCoverage(z:number,seed:number,side:number){
 if(bridgeAt(z,seed).active)return 1;
 if(tunnelAt(z,seed))return 0;
 const station=Math.floor(z/5)*5;let proximity=Infinity;
 for(let d=-25;d<=25;d+=5)if(hazard(station+d,seed,side))proximity=Math.min(proximity,Math.abs(station+d-z));
 return proximity===Infinity?0:1-smooth((proximity-10)/15);
}
export function railPoint(z:number,seed:number,side:number){
 const p=roadAt(z,seed),offset=side*RAIL_OFFSET;
 // Match the rendered five-metre shoulder/deck interpolation exactly; blending
 // analytical pavement with terrain could leave small airborne post bases.
 const y=surfaceHeight(p.x+offset,z,seed)-.03;
 return {x:p.x+offset,z,y};
}
