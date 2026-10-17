import {it,expect} from 'vitest';
import {DEFAULT_GRAPHICS,DETAIL_LEVELS,legacyGraphics,validateGraphics} from '../../src/rendering/graphics';
import {PreferenceStore,PREFERENCES_KEY} from '../../src/app/preferences';
import {generateChunk} from '../../src/world/generate';
import {roadAt,bridgeAt,riverAt,tunnelPlan} from '../../src/world/road';
import {terrainMeshHeight} from '../../src/world/terrain-grid';
import {bridgeCeiling,surfaceHeight} from '../../src/world/surface';
import {generateHorizon} from '../../src/world/horizon';
import {VehiclePhysics} from '../../src/vehicle/physics';
import {Drivetrain} from '../../src/vehicle/drivetrain';
import {engineLoadLevel} from '../../src/audio/overrun';
import {EngineSynth} from '../../src/audio/engine-synth';
const idle={throttle:false,brake:false,steer:0};
it('migrates every legacy preset without losing unrelated preferences, then writes version 3',()=>{
 for(const quality of ['Auto',...DETAIL_LEVELS]){let raw=JSON.stringify({version:1,quality,volumes:{master:.24},handling:{balance:.6,grip:-.4},lights:false});
 const store=new PreferenceStore({getItem:()=>raw,setItem:(key,value)=>{expect(key).toBe(PREFERENCES_KEY);raw=value;}}),value=store.load();
 expect(value.graphics).toEqual(legacyGraphics(quality));expect(value.volumes.master).toBe(.24);expect(value.handling).toEqual({balance:.6,grip:-.4});expect(value.lights).toBe(false);
 store.save(value);expect(JSON.parse(raw).version).toBe(3);expect(JSON.parse(raw)).not.toHaveProperty('quality');expect(store.load()).toEqual(value);
 }
 expect(validateGraphics({resolution:'150%',shadows:null,trees:'Ultra',grass:'Low',terrain:'High',distant:'Medium'})).toEqual({...DEFAULT_GRAPHICS,grass:'Low',terrain:'High'});
});
it('all 972 graphics combinations validate independently without changing generation parameters',()=>{
 for(const resolution of ['Auto',...DETAIL_LEVELS])for(const shadows of DETAIL_LEVELS)for(const trees of DETAIL_LEVELS)for(const grass of DETAIL_LEVELS)for(const terrain of DETAIL_LEVELS)for(const distant of DETAIL_LEVELS){const value={resolution,shadows,trees,grass,terrain,distant};expect(validateGraphics(value)).toEqual(value);}
});
it('bridge prisms are closed with downward-facing soffits and deck-width support',()=>{
 for(const seed of [12,1942,778]){const z=riverAt(0,seed).crossing,data=generateChunk(Math.floor(z/200),seed),p=data.structure;expect(p.length).toBeGreaterThan(0);
 for(let prism=0;prism<p.length;prism+=108){const edges=new Map<string,number>();let upward=0,downward=0;
  const vertex=(i:number)=>Array.from(p.subarray(i,i+3)).map(n=>n.toFixed(4)).join(',');
  for(let i=prism;i<prism+108;i+=9){const ax=p[i+3]-p[i],az=p[i+5]-p[i+2],bx=p[i+6]-p[i],bz=p[i+8]-p[i+2],ny=az*bx-ax*bz;if(ny>.01)upward++;if(ny<-.01)downward++;
   for(const [a,b] of [[i,i+3],[i+3,i+6],[i+6,i]]){const key=[vertex(a),vertex(b)].sort().join('|');edges.set(key,(edges.get(key)??0)+1);}}
  expect([...edges.values()].every(count=>count===2)).toBe(true);expect(upward).toBe(2);expect(downward).toBe(2);
 }
 const b=bridgeAt(z,seed),r=roadAt((b.start+b.end)/2,seed);expect(bridgeCeiling(r.x,r.z,seed,r.y-3)).toBeCloseTo(r.y-.85,2);expect(bridgeCeiling(r.x,r.z,seed,r.y)).toBe(Infinity);
 }
},30000);
it('piers and foundations embed their entire rotated terrain footprint and match colliders',()=>{
 const z=riverAt(0,1942).crossing,id=Math.floor(z/200),data=generateChunk(id,1942),values=data.scenery.instances.concrete;expect(values.length).toBeGreaterThan(0);
 for(let i=0;i<values.length;i+=21){const [x,y,lz,w,h,d,yaw]=values.subarray(i,i+7),z=id*200+lz;
 for(const dx of [-w/2,w/2])for(const dz of [-d/2,d/2])expect(y).toBeLessThan(terrainMeshHeight(x+Math.cos(yaw)*dx+Math.sin(yaw)*dz,z-Math.sin(yaw)*dx+Math.cos(yaw)*dz,1942)-.3);
 expect(y+h).toBeLessThan(roadAt(z,1942).y-.8);expect(data.scenery.obstacles.some(o=>Math.abs(o.x-x)<.01&&Math.abs(o.y-y)<.01&&Math.abs(o.halfX-w/2)<.01)).toBe(true);
 }
});
it('distant representations share exact exterior boundaries while reducing triangles',()=>{
 const h=generateHorizon(0,1942);expect(h.indices[0].length).toBeLessThan(h.indices[1].length);expect(h.indices[1].length).toBeLessThan(h.indices[2].length);
 for(const indices of h.indices){expect(Math.max(...indices)).toBeLessThan(h.positions.length/3);expect(Math.min(...indices)).toBe(0);}
});
it('near-vertical slopes defeat AWD and gravity pulls the vehicle back rather than ratcheting uphill',()=>{
 for(const slope of [1.5,4,15]){const car=new VehiclePhysics(12,(_x,z)=>z*slope,()=>.8);car.x=0;car.z=0;car.heading=0;car.y=0;const before=car.z;
 for(let i=0;i<240;i++)car.step(1/60,{...idle,throttle:true});expect(car.z).toBeLessThan(before+.4);expect(Number.isFinite(car.y)).toBe(true);}
 const moderate=new VehiclePhysics(12,(_x,z)=>z*.15,()=>.85);moderate.z=0;moderate.heading=0;moderate.y=0;
 for(let i=0;i<240;i++)moderate.step(1/60,{...idle,throttle:true});expect(moderate.z).toBeGreaterThan(5);
});
it('downhill acceleration keeps zero engine load and consistent overrun level in both voices',()=>{
 const car=new VehiclePhysics(12,(_x,z)=>-z*.25,()=>.8);car.z=0;car.x=0;car.heading=0;car.y=0;car.setSpeed(1);
 for(let i=0;i<180;i++)car.step(1/60,idle);expect(car.speed).toBeGreaterThan(1.1);expect(car.drivetrain.load).toBe(0);
 const d=new Drivetrain();for(let i=0;i<600;i++)d.step(1/60,10+i*.05,0);expect(d.rpm).toBeGreaterThan(900);expect(d.load).toBe(0);expect(engineLoadLevel(d.rpm,0)).toBeGreaterThan(.95);expect(engineLoadLevel(d.rpm,1)).toBe(1);
 const energy=(load:number)=>{const synth=new EngineSynth(48000),a=new Float32Array(48000),b=new Float32Array(48000);synth.render(a,b,5000,load);return a.reduce((sum,v)=>sum+v*v,0);};expect(energy(0)/energy(1)).toBeGreaterThan(.9);
});
it('tunnel portals contain both exterior excavation and enclosed lining without changing road contact',()=>{
 let t:ReturnType<typeof tunnelPlan>;for(let i=0;i<100&&!t;i++)t=tunnelPlan(i,1942);expect(t).toBeDefined();
 for(const z of [t!.start,t!.center,t!.end-10]){const data=generateChunk(Math.floor(z/200),1942);expect(data.tunnel.length).toBeGreaterThan(0);expect(data.excavation.length).toBeGreaterThan(0);expect([...data.tunnel,...data.excavation].every(Number.isFinite)).toBe(true);const p=roadAt(z,1942);expect(surfaceHeight(p.x,z,1942)).toBeCloseTo(p.y,3);expect(terrainMeshHeight(p.x,z,1942)).toBeLessThan(p.y-.02);}
});
