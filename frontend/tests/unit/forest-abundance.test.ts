import {it,expect} from 'vitest';
import {generateScenery,INSTANCE_CAPACITY} from '../../src/world/scenery';
import {TREE_KINDS} from '../../src/world/tree-config';
import {CHUNK_LENGTH,roadAt,riverChannelAt,vegetationClearOfRoad} from '../../src/world/road';

it('retains abundant actual near/far populations across mountain regions with safe crown corridors and bounded deterministic chunks',()=>{
 let near=0,far=0;
 for(const seed of [12,1942,778])for(const id of [0,30,90,150]){
  const data=generateScenery(id,seed);expect(generateScenery(id,seed)).toEqual(data);
  let chunkNear=0,chunkFar=0;
  for(const kind of TREE_KINDS){const v=data.instances[kind];expect(v.length/7).toBeLessThanOrEqual(INSTANCE_CAPACITY[kind]);
   for(let i=0;i<v.length;i+=7){const x=v[i],z=id*CHUNK_LENGTH+v[i+2],offset=Math.abs(x-roadAt(z,seed).x),river=riverChannelAt(z,seed);
    expect(v[i+2]).toBeGreaterThanOrEqual(0);expect(v[i+2]).toBeLessThan(CHUNK_LENGTH);expect(Math.abs(x-river.x)).toBeGreaterThanOrEqual(Math.max(18,river.halfWidth+4)-.002);
    if(offset<50)expect(vegetationClearOfRoad(x,z,v[i+3]*.65-.002,seed)).toBe(true);
    if(offset<=500)chunkNear++;else chunkFar++;
   }
  }
  expect(chunkNear).toBeGreaterThan(600);expect(chunkFar).toBeGreaterThan(1000);near+=chunkNear;far+=chunkFar;
 }
 // Recorded sparse baseline over these same seeds/chunks:8177 near,7998 far.
 // Real placements, independent of rendering budgets or enlarged crowns.
 expect(near).toBeGreaterThan(8177*1.5);expect(far).toBeGreaterThan(7998*2);
},30000);
