import { bridgeAt, CHUNK_LENGTH, landscapeNoise, naturalHeight, randomAt, regionAt, roadAt, riverChannelAt, vegetationClearOfRoad, clamp, tunnelAt } from './road';
import {railCoverage,railPoint} from './roadside';
import {vegetationSlopeCover} from './habitat';
import type { Obstacle } from '../vehicle/collider';
import { terrainMeshHeight } from './terrain-grid';
import { TREE_KINDS, TREE_PROPORTIONS, type TreeKind } from './tree-config';

export const SCENERY_KINDS = [...TREE_KINDS, 'rock', 'grass', 'post', 'reflector', 'rail', 'concrete'] as const;
export type SceneryKind = typeof SCENERY_KINDS[number];
// x,y,localZ, width,height,depth, yaw; shared by every preset and collider generation.
export interface SceneryData { instances: Record<SceneryKind, Float32Array>; obstacles: Obstacle[]; railPitch: Float32Array; }
export const INSTANCE_CAPACITY = { conifer: 1120, pine: 820, broadleaf: 760, birch: 640, rock: 180, grass: 1680, post: 120, reflector: 40, rail: 100, concrete: 60 } satisfies Record<SceneryKind, number>;

// One coherent habitat signal is shared with ground/horizon materials. Protected
// valley slopes carry forest; high exposed crests retain irregular clearings.
export function forestCover(x:number,z:number,seed:number,height=naturalHeight(x,z,seed)){
  const region=regionAt(z,seed),river=riverChannelAt(z,seed);
  const stand=landscapeNoise(x/135,z/210,seed+71),clearing=landscapeNoise(x/420,z/610,seed+72);
  const elevation=Math.max(0,height-river.y);
  // Sheltered temperate uplands remain wooded; height alone is not a
  // treeline at these modest elevations. Steep geology still rejects trees.
  const sheltered=1-.35*clamp((elevation-region.ridge*1.6)/Math.max(300,region.ridge*2.5));
  const riparian=Math.exp(-Math.abs(x-river.x)/95)*.24;
  return clamp((region.forest*.66+stand*.76-.07)*sheltered+riparian-(clearing<.25?.28:0));
}

export function generateScenery(id: number, seed: number): SceneryData {
  const start = id * CHUNK_LENGTH;
  const data = Object.fromEntries(SCENERY_KINDS.map(kind => [kind, [] as number[]])) as Record<SceneryKind, number[]>;
  const obstacles: Obstacle[] = [];
  const railPitch: number[] = [];
  const add = (kind: SceneryKind, x: number, y: number, z: number, width: number, height: number, depth: number, yaw = 0) => {
    if (data[kind].length / 7 >= INSTANCE_CAPACITY[kind]) return false;
    data[kind].push(x, y, z - start, width, height, depth, yaw); return true;
  };
  const solid = (x: number, y: number, z: number, halfX: number, halfZ: number, height: number, heading = 0, material: Obstacle['material'] = 'stone') => obstacles.push({ x, y, z, halfX, halfZ, height, heading, material });
  const addTree=(kind:TreeKind,x:number,y:number,z:number,height:number,key:number,canopy=1)=>{
    const width=height*canopy*TREE_PROPORTIONS[kind]*(.92+randomAt(key+6,seed)*.36);
    // Crown footprints must clear the carriageway, barriers and bridge deck,
    // including their curved approaches. Far stands need no corridor probes.
    const clearance=width*.65;
    if(Math.abs(x-roadAt(z,seed).x)<clearance+20&&!vegetationClearOfRoad(x,z,clearance,seed))return;
    if(add(kind,x,y,z,width,height,width*(.85+randomAt(key+8,seed)*.3),randomAt(key+7,seed)*Math.PI*2))solid(x,y,z,Math.max(.16,width*.033),Math.max(.16,width*.033),height*.7,0,'wood');
  };
  // More actual stands, with unchanged crown dimensions and shared LODs. Near
  // populations grow by two thirds; distant stands fill the wider mountain belt.
  // Species capacities bound recycled chunk memory on every graphics setting.
  for(let stand=0;stand<560;stand++){
    const distant=stand>=200,key=id*7919+stand*31;
    const cz=start+randomAt(key,seed+91)*CHUNK_LENGTH,p=roadAt(cz,seed);
    const riparian=stand>=168&&stand<200,channel=riverChannelAt(cz,seed);
    const cx=riparian?channel.x+(randomAt(key+1,seed)<.5?-1:1)*(channel.halfWidth+20+randomAt(key+2,seed)*40):p.x+(randomAt(key+1,seed)<.5?-1:1)*(distant?520+randomAt(key+2,seed)**1.45*1680:22+randomAt(key+2,seed)**1.1*470);
    const cover=forestCover(cx,cz,seed);
    if(randomAt(key+3,seed)>cover)continue;
    const members=8+(cover>.82?1:0),patch=landscapeNoise(cx/180,cz/270,seed+127);
    for(let member=0;member<members;member++){
      const mk=key+member*101,angle=randomAt(mk+7,seed)*Math.PI*2;
      const radius=member===0?0:5+Math.sqrt(randomAt(mk+8,seed))*(riparian?12:distant?18:16);
      const x=cx+Math.cos(angle)*radius,z=cz+Math.sin(angle)*radius;
      if(z<start||z>=start+CHUNK_LENGTH||Math.abs(x-roadAt(z,seed).x)<11)continue;
      const river=riverChannelAt(z,seed),bank=Math.abs(x-river.x);
      if(bank<Math.max(18,river.halfWidth+4))continue;
      const y=terrainMeshHeight(x,z,seed),slope=Math.hypot(terrainMeshHeight(x+2,z,seed)-y,terrainMeshHeight(x,z+2,seed)-y)/2;
      if(randomAt(mk+19,seed)>vegetationSlopeCover(slope))continue;
      const species=randomAt(mk+5,seed),wet=bank<95;
      let kind:TreeKind=species>(wet?.61:.83)?(wet?'birch':'broadleaf'):patch>.58?'pine':'conifer';
      const age=randomAt(mk+4,seed),height=(kind==='birch'?8:kind==='broadleaf'?9:10)+age*(distant?15:13);
      if(distant&&data[kind].length/7>=INSTANCE_CAPACITY[kind]){
        const available=TREE_KINDS.filter(candidate=>data[candidate].length/7<INSTANCE_CAPACITY[candidate]);
        if(!available.length)continue;kind=available[Math.floor(randomAt(mk+20,seed)*available.length)];
      }
      addTree(kind,x,y,z,member%4===3?height*.7:height,mk,distant?1.45:1);
    }
  }
  // Rock outcrops remain tied to steep/exposed ground, outside road and channel.
  for(let i=0;i<150;i++){
    const key=id*1009+i*7,z=start+randomAt(key,seed)*200,p=roadAt(z,seed);
    const x=p.x+(randomAt(key+1,seed)<.5?-1:1)*(12+randomAt(key+2,seed)*650),river=riverChannelAt(z,seed);
    if(Math.abs(x-river.x)<river.halfWidth+3)continue;
    const y=terrainMeshHeight(x,z,seed),slope=Math.abs(terrainMeshHeight(x+2,z,seed)-y)/2;
    if(slope<.45&&randomAt(key+3,seed)<.85)continue;
    const size=.8+randomAt(key+4,seed)*3,foot=y-Math.min(.65,size*(.12+slope*.12)),yaw=randomAt(key+5,seed)*6;
    if(add('rock',x,foot,z,size*1.2,size*.7,size,yaw))solid(x,foot,z,size*.5,size*.4,size*.65,yaw);
  }
  for (let i = 0; i < 1200; i++) {
    const key = id * 2003 + Math.floor(i/3) * 17, member=i%3;
    const z = start + Math.max(.001,Math.min(199.999,randomAt(key,seed+3)*200+(randomAt(key+member+9,seed)-.5)*5));
    const p = roadAt(z, seed), x = p.x + (randomAt(key + 1, seed) < .5 ? -1 : 1) * (7 + randomAt(key + 2, seed) ** 2 * 70)+(randomAt(key+member+12,seed)-.5)*2.5;
    if (Math.abs(x - riverChannelAt(z, seed).x) < riverChannelAt(z,seed).halfWidth+2) continue;
    const y=terrainMeshHeight(x,z,seed),slope=Math.hypot(terrainMeshHeight(x+2,z,seed)-y,terrainMeshHeight(x,z+2,seed)-y)/2;
    if(randomAt(key+member+19,seed)>vegetationSlopeCover(slope))continue;
    const width=2+randomAt(key+6,seed)*1.7;
    if(!vegetationClearOfRoad(x,z,width*.7+.08,seed))continue;
    add('grass', x, y, z, width, .24 + randomAt(key + 3, seed) * .32, width, randomAt(key + 4, seed) * 6);
  }
  for(let i=0;i<400;i++){
    const key=id*3011+i*11,z=start+randomAt(key,seed+3)*200,p=roadAt(z,seed);
    const channel=riverChannelAt(z,seed),riparian=i<120;
    const x=(riparian?channel.x:p.x)+(randomAt(key+1,seed)<.5?-1:1)*(riparian?channel.halfWidth+5+randomAt(key+2,seed)*32:75+randomAt(key+2,seed)*775);
    if(Math.abs(x-channel.x)<channel.halfWidth+2||landscapeNoise(x/55,z/80,seed+311)<.27)continue;
    const y=terrainMeshHeight(x,z,seed),slope=Math.hypot(terrainMeshHeight(x+2,z,seed)-y,terrainMeshHeight(x,z+2,seed)-y)/2;
    if(randomAt(key+19,seed)>vegetationSlopeCover(slope))continue;
    const width=2+randomAt(key+4,seed)*1.6;if(!vegetationClearOfRoad(x,z,width*.7+.08,seed))continue;add('grass',x,y,z,width,.18+randomAt(key+5,seed)*.35,width,randomAt(key+6,seed)*6);
  }
  for (let z = start + 10; z < start + 200; z += 25) {
    const p = roadAt(z, seed);
    for (const side of [-1, 1]) {
      const x = p.x + side * 5.7, y = terrainMeshHeight(x, z, seed);
      if (!bridgeAt(z, seed).active&&!tunnelAt(z,seed)&&railCoverage(z,seed,side)===0) {
        add('post', x, y, z, .1, .95, .12, p.heading);
        add('reflector', x, y + .7, z - .07, .12, .14, .025, p.heading);
      }
    }
  }
  for (let z = start + 2.5; z < start + 200; z += 5) {
    const p = roadAt(z, seed), bridge = bridgeAt(z, seed).active;
    for (const side of [-1, 1]) {
      const coverage=railCoverage(z,seed,side);if(coverage===0)continue;
      const a=railPoint(z-2.5,seed,side),b=railPoint(z+2.5,seed,side),mid=railPoint(z,seed,side);
      const ha=.89*railCoverage(z-2.5,seed,side)-.24,hb=.89*railCoverage(z+2.5,seed,side)-.24;
      const length=Math.hypot(b.x-a.x,5),yaw=Math.atan2(b.x-a.x,5);
      if(add('rail',(a.x+b.x)/2,(a.y+b.y+ha+hb)/2,z,.15,.24,length+.02,yaw))railPitch.push(-Math.atan2(b.y+hb-a.y-ha,length));
      add('post',mid.x,mid.y,z,.14,.88*coverage,.14,p.heading);
      solid((a.x+b.x)/2,Math.min(a.y,b.y),z,.13,length/2+.01,.85*coverage,yaw,'metal');
    }
    if(bridge&&Math.round(z/5)%6===0){
      const c=Math.cos(p.heading),s=Math.sin(p.heading);let bottom=Infinity;
      for(const dx of [-2.4,0,2.4])for(const dz of [-1.4,0,1.4])bottom=Math.min(bottom,terrainMeshHeight(p.x+c*dx+s*dz,z-s*dx+c*dz,seed));
      bottom-=1.2;const top=p.y-1.05,height=top-bottom;
      if(height>.4){
        if(add('concrete',p.x,bottom,z,4.8,height,2.2,p.heading))solid(p.x,bottom,z,2.4,1.1,height,p.heading,'stone');
        if(add('concrete',p.x,bottom-.35,z,6,.7,3.4,p.heading))solid(p.x,bottom-.35,z,3,1.7,.7,p.heading,'stone');
        if(add('concrete',p.x,top-.35,z,8.8,.35,2.2,p.heading))solid(p.x,top-.35,z,4.4,1.1,.35,p.heading,'stone');
      }
    }
  }
  return { instances: Object.fromEntries(SCENERY_KINDS.map(kind => [kind, new Float32Array(data[kind])])) as Record<SceneryKind, Float32Array>, obstacles, railPitch: new Float32Array(railPitch) };
}
