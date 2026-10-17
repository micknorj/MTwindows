import {expect,it} from 'vitest';
import {PreferenceStore,defaultPreferences,PREFERENCES_KEY} from '../../src/app/preferences';
import {ControlBindings} from '../../src/input/bindings';
import {rockCoverage,vegetationSlopeCover} from '../../src/world/habitat';
import {viaductsIn,bridgeAt,roadAt,riverChannelAt,terrainHeight,landscapeHeight,riverAt,regionAt,tunnelPlan,RAIL_OFFSET,BRIDGE_HALF_WIDTH,vegetationClearOfRoad} from '../../src/world/road';
import {generateChunk} from '../../src/world/generate';
import {terrainLodIndices,terrainLodRanges} from '../../src/world/terrain-lod';
import {terrainMeshHeight,terrainRow} from '../../src/world/terrain-grid';
import {surfaceHeight} from '../../src/world/surface';
import {railCoverage,railPoint} from '../../src/world/roadside';
import {forestCover} from '../../src/world/scenery';

it('round-trips validated preferences independently of distance/world state',()=>{
 const values=new Map<string,string>(),storage={getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>{values.set(k,v);}};
 const prefs=defaultPreferences(),bindings=new ControlBindings();bindings.assign('accelerate','KeyX');prefs.bindings=bindings.snapshot();prefs.graphics={resolution:'High',shadows:'High',trees:'High',grass:'High',terrain:'High',distant:'High'};prefs.volumes={master:.38,engine:0,environment:1};prefs.handling={balance:.4,grip:-.2};prefs.lights=false;prefs.fullscreen=true;
 const store=new PreferenceStore(storage);store.save(prefs);expect(new PreferenceStore(storage).load()).toEqual(prefs);expect([...values.keys()]).toEqual([PREFERENCES_KEY]);
 const parsed=JSON.parse(values.get(PREFERENCES_KEY)!);expect(Object.keys(parsed).sort()).toEqual(['version','transmission','graphics','volumes','handling','bindings','lights','fullscreen'].sort());
 prefs.bindings.accelerate[0]='KeyY';expect(store.load().bindings.accelerate[0]).toBe('KeyX');
});
it('rejects malformed/versioned/oversized preferences and tolerates denied storage',()=>{
 for(const raw of ['{','null','[]','{"version":99}',' '.repeat(8193)])expect(new PreferenceStore({getItem:()=>raw,setItem:()=>{}}).load()).toEqual(defaultPreferences());
 const denied=new PreferenceStore({getItem:()=>{throw Error('denied');},setItem:()=>{throw Error('quota');}});expect(denied.load()).toEqual(defaultPreferences());expect(()=>denied.save(defaultPreferences())).not.toThrow();
});
it('keeps valid fields while resetting unsafe values and duplicate/reserved bindings atomically',()=>{
 const defaults=defaultPreferences(),bad={version:1,quality:'Medium',volumes:{master:2,engine:.2,environment:'0'},handling:{balance:-.6,grip:null},bindings:{...defaults.bindings,left:['Escape']},lights:false,fullscreen:'yes',position:{x:999}};
 const load=()=>new PreferenceStore({getItem:()=>JSON.stringify(bad),setItem:()=>{}}).load();expect(load()).toEqual({...defaults,graphics:{...defaults.graphics,resolution:'Medium'},volumes:{...defaults.volumes,engine:.2},handling:{balance:-.6,grip:0},lights:false});
 bad.bindings={...defaults.bindings,left:['KeyW']};expect(load().bindings).toEqual(defaults.bindings);
 const bindings=new ControlBindings();expect(bindings.restore({...defaults.bindings,recover:[]})).toBe(false);expect(bindings.snapshot()).toEqual(defaults.bindings);
});
it('keeps flat lush ground, mixed moderate slopes and rock-dominant cliffs regardless of geology noise',()=>{
 for(const variation of [0,.2,.7,1]){expect(rockCoverage(1,variation)).toBe(0);expect(rockCoverage(Math.cos(Math.PI/6),variation)).toBeGreaterThan(0);expect(rockCoverage(Math.cos(Math.PI/6),variation)).toBeLessThan(.5);expect(rockCoverage(.5,variation)).toBeGreaterThanOrEqual(.9);
  let previous=0;for(let degree=0;degree<=90;degree++){const v=rockCoverage(Math.cos(degree*Math.PI/180),variation);expect(v).toBeGreaterThanOrEqual(previous-1e-8);expect(v).toBeLessThanOrEqual(1);previous=v;}}
 expect(vegetationSlopeCover(0)).toBe(1);expect(vegetationSlopeCover(1.2)).toBe(0);expect(vegetationSlopeCover(.7)).toBeLessThan(vegetationSlopeCover(.5));
});
it('selects uncommon supported dry spans with continuous driving surfaces and preserved ground underneath',()=>{
 const spans=[];for(let i=0;i<24;i++)spans.push(...viaductsIn(i,1942));expect(spans.length).toBeGreaterThan(0);expect(spans.length).toBeLessThan(24);
 for(const v of spans){expect(viaductsIn(Math.floor(v.start/6000),1942)).toEqual(viaductsIn(Math.floor(v.start/6000),1942));expect(v.end-v.start).toBeLessThanOrEqual(2400);
  const z=(v.start+v.end)/2,p=roadAt(z,1942),b=bridgeAt(z,1942);expect(b.active).toBe(true);expect(v.depth).toBeGreaterThanOrEqual(9);expect(p.y-landscapeHeight(p.x,z,1942)).toBeGreaterThan(2);expect(terrainHeight(p.x,z,1942)).toBeCloseTo(landscapeHeight(p.x,z,1942),8);expect(surfaceHeight(p.x,z,1942)).toBeCloseTo(p.y,8);
  for(const at of [v.start,v.start+5,v.end-5,v.end]){const a=roadAt(at,1942),next=roadAt(at+.01,1942);expect(Math.abs(next.y-a.y)).toBeLessThan(.001);}
 }
});
function lodHeight(data:ReturnType<typeof generateChunk>,indices:Uint16Array,x:number,z:number){
 const p=data.terrain;
 for(let i=0;i<indices.length;i+=3){const a=indices[i]*3,b=indices[i+1]*3,c=indices[i+2]*3;
  if(x<Math.min(p[a],p[b],p[c])-1e-5||x>Math.max(p[a],p[b],p[c])+1e-5||z<Math.min(p[a+2],p[b+2],p[c+2])-1e-5||z>Math.max(p[a+2],p[b+2],p[c+2])+1e-5)continue;
  const ax=p[b]-p[a],az=p[b+2]-p[a+2],bx=p[c]-p[a],bz=p[c+2]-p[a+2],det=ax*bz-az*bx;if(Math.abs(det)<1e-9)continue;
  const u=((x-p[a])*bz-(z-p[a+2])*bx)/det,v=(ax*(z-p[a+2])-az*(x-p[a]))/det;
  if(u>=-1e-4&&v>=-1e-4&&u+v<=1.0001)return p[a+1]+u*(p[b+1]-p[a+1])+v*(p[c+1]-p[a+1]);
 }throw Error('Missing terrain triangle');
}
it('keeps channels below water through road earthworks and every rendered terrain LOD',()=>{
 for(const seed of [0,1942])for(const id of [0,13,29,44,600]){
  const data=generateChunk(id,seed),cells=data.terrainFine.length,indices=terrainLodIndices(cells,20,data.terrainFine),ranges=terrainLodRanges(cells,20,data.terrainFine);
  for(let level=0;level<3;level++)expect(ranges[level][cells]).toBe(indices[level].length);
  for(const localZ of [5,55,105,155,195]){const z=id*200+localZ,a=riverChannelAt(z-5,seed),b=riverChannelAt(z+5,seed),x=(a.x+b.x)/2,water=(a.y+b.y)/2;
   expect(water-terrainMeshHeight(x,z,seed)).toBeGreaterThan(.35);
   for(const lod of indices)expect(water-lodHeight(data,lod,x,localZ),`seed=${seed},z=${z}`).toBeGreaterThan(.3);
  }
 }
},20000);
it('joins water ribbons exactly across chunk and reach boundaries',()=>{
 for(const seed of [0,1942,98213])for(const id of [0,29,30,88]){
  const a=generateChunk(id,seed),b=generateChunk(id+1,seed),edge=(data:Float32Array,z:number)=>{const set=new Set<string>();for(let i=0;i<data.length;i+=3)if(data[i+2]===z)set.add(`${data[i]}:${data[i+1]}`);return [...set].sort();};expect(edge(a.water,200)).toEqual(edge(b.water,0));
  const z=(id+1)*200,left=riverChannelAt(z-.001,seed),right=riverChannelAt(z+.001,seed);expect(Math.abs(right.x-left.x)).toBeLessThan(.01);expect(Math.abs(right.y-left.y)).toBeLessThan(.001);
 }
},20000);

it('keeps bridge/viaduct deck shoulders stone instead of inheriting grassy terrain-edge tint',()=>{
 const data=generateChunk(13,1942);let deckVertices=0;
 for(let i=0;i<data.shoulder.length;i+=3){const z=2600+data.shoulder[i+2],p=roadAt(z,1942);if(!bridgeAt(z,1942).active||data.shoulder[i+1]<p.y-.2)continue;deckVertices++;
  expect(Array.from(data.shoulderColors.subarray(i,i+3))).toEqual([0,0,1]);}
 expect(deckVertices).toBeGreaterThan(100);
});


it('keeps both bridge barriers continuous at the land-road width, including chunk and deck joins',()=>{
 for(const seed of [0,1942,98213]){
  const spans=[];for(let region=0;region<10;region++)spans.push(...viaductsIn(region,seed));
  for(const z of [0,12000,24000]){const bridge=bridgeAt(riverAt(z,seed).crossing,seed);if(bridge.eligible)spans.push({start:bridge.start,end:bridge.end,depth:0});}
  for(const span of spans){
   for(let z=span.start;z<=span.end;z+=5)for(const side of [-1,1]){
    expect(railCoverage(z,seed,side)).toBe(1);
    const p=railPoint(z,seed,side),road=roadAt(z,seed);expect(Math.abs(p.x-road.x)).toBeCloseTo(RAIL_OFFSET,8);
    expect(Math.abs(p.x-road.x)).toBeLessThan(BRIDGE_HALF_WIDTH);
    expect(p.y+.03).toBeCloseTo(surfaceHeight(p.x,z,seed),8);
    expect(vegetationClearOfRoad(p.x,z,.5,seed)).toBe(false);
   }
   for(let id=Math.floor(span.start/200);id<=Math.floor(span.end/200);id++){
    const data=generateChunk(id,seed),rails=data.scenery.instances.rail;
    for(let z=id*200+2.5;z<(id+1)*200;z+=5){if(z<span.start||z>span.end)continue;
     const present=[];for(let i=0;i<rails.length;i+=7)if(Math.abs(rails[i+2]+id*200-z)<.001)present.push(rails[i]);expect(present).toHaveLength(2);
    }
   }
  }
 }
},60000); // Preserve the exhaustive multi-seed/chunk rail sweep; measured 26 s on a loaded host.
it('weathered rock changes actual mountain geometry without shifting road earthworks or river banks',()=>{
 let shaped=0,maximum=0;
 for(const seed of [0,1942,98213])for(const z of [0,1000,4000,9000,27000,57000]){
  const row=terrainRow(z,seed),road=roadAt(z,seed),river=riverChannelAt(z,seed),snapshot=row.y.slice();
  for(let i=0;i<row.x.length;i++){
   const x=row.x[i],delta=Math.abs(row.y[i]-terrainHeight(x,z,seed));maximum=Math.max(maximum,delta);if(delta>1)shaped++;
   if(Math.abs(x-road.x)<=9||Math.abs(x-river.x)<=river.halfWidth+125)expect(delta).toBe(0);
   if(i<row.x.length-1&&row.x[i+1]-x>1e-6)expect(terrainMeshHeight(x,z,seed)).toBeCloseTo(row.y[i],8);
   const n=row.normals.subarray(i*3,i*3+3);expect(Math.hypot(...n)).toBeCloseTo(1,5);expect(n[1]).toBeGreaterThan(0);
  }
  // Eviction/regeneration may not depend on traversal order or previous LOD.
  for(let station=0;station<280;station++)terrainRow(100000+station*10,seed);
  expect(terrainRow(z,seed).y).toEqual(snapshot);
 }
 expect(shaped).toBeGreaterThan(30);expect(maximum).toBeGreaterThan(4);expect(maximum).toBeLessThan(20);
},20000);

it('retains healthy wooded mountain habitat at modest upland elevations instead of an artificial low treeline',()=>{
 let healthy=0;
 for(const seed of [0,1942,98213])for(const z of [0,1500,4000,9000,27000]){
  const water=riverChannelAt(z,seed),region=regionAt(z,seed),road=roadAt(z,seed);
  for(const side of [-1,1])for(const d of [600,1000,1500]){
   const x=road.x+side*d,low=forestCover(x,z,seed,water.y),upland=forestCover(x,z,seed,water.y+Math.max(300,region.ridge*1.7));
   if(low>.65){healthy++;expect(upland).toBeGreaterThan(.45);expect(upland).toBeLessThanOrEqual(low);}
  }
 }
 expect(healthy).toBeGreaterThan(20);
});


it('blends land-road verges instead of stretching the river bank into a vertical wall',()=>{
 let checked=0;
 for(const seed of [0,1942,98213])for(let z=0;z<120000;z+=20){
  const p=roadAt(z,seed),b=bridgeAt(z,seed),t=tunnelPlan(Math.floor(z/6000),seed);
  if(b.active||(t&&z>=t.start-30&&z<=t.end+30))continue;
  for(const side of [-1,1]){
   const inner=terrainHeight(p.x+side*5.7,z,seed),outer=terrainHeight(p.x+side*7,z,seed);
   expect(Math.abs(outer-inner)/1.3,`seed=${seed},z=${z},side=${side}`).toBeLessThan(.85);checked++;
  }
 }
 expect(checked).toBeGreaterThan(20000);
},20000);
it('excavates bridge bank wedges below the slab at both ends and across the actual rendered footprint',()=>{
 let checked=0;
 for(const seed of [0,1942,98213])for(let z=0;z<120000;z+=20){
  const b=bridgeAt(z,seed);if(!b.active)continue;const p=roadAt(z,seed);
  for(const side of [-5.15,0,5.15]){
   expect(terrainHeight(p.x+side,z,seed)).toBeLessThanOrEqual(p.y+side*p.bank-.018*Math.abs(side)-.699999);
   expect(terrainMeshHeight(p.x+side,z,seed)).toBeLessThan(p.y+side*p.bank-.018*Math.abs(side)-.49);checked++;
  }
 }
 expect(checked).toBeGreaterThan(1000);
 // Previously the elevated bank resumed15m after a river bridge and fell65m
 // through a1.3m-wide verge. Extend the supported span over that missing bank.
 expect(bridgeAt(22300,98213).active).toBe(true);
},20000);

it('keeps interpolated abutment terrain below bridge slabs between ten-metre mesh rows',()=>{
 const checked=new Set<string>();
 for(const seed of [0,1942,98213])for(let z=0;z<120000;z+=200){
  const b=bridgeAt(z,seed),key=`${seed}:${b.start}:${b.end}`;if(!b.active||checked.has(key))continue;checked.add(key);
  for(const at of [b.start,b.start+2.5,b.start+5,b.end-5,b.end-2.5,b.end]){
   const p=roadAt(at,seed);for(const offset of [-5.15,-3.4,0,3.4,5.15]){
    expect(terrainMeshHeight(p.x+offset,at,seed),`seed=${seed},at=${at},offset=${offset}`).toBeLessThan(p.y+offset*p.bank-.018*Math.abs(offset)-.6);
   }
  }
 }
 expect(checked.size).toBeGreaterThan(50);
},20000);

it('meets ordinary land shoulders with a thin pavement clearance rather than a raised kerb',()=>{
 let checked=0;
 for(const seed of [0,1942,98213])for(let z=0;z<40000;z+=50){const b=bridgeAt(z,seed);if(b.active||(b.eligible&&z>=b.start-10&&z<=b.end+10))continue;
  const p=roadAt(z,seed);for(const offset of [-5,-3.4,0,3.4,5])expect(p.y+offset*p.bank-.018*Math.abs(offset)-terrainHeight(p.x+offset,z,seed)).toBeCloseTo(.06,8);checked++;
 }
 expect(checked).toBeGreaterThan(1500);
});
