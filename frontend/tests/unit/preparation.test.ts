import {expect,it} from 'vitest';
import {preparationCenter,chunkWindow,MAX_CHUNKS} from '../../src/world/window';
import {terrainLodIndices} from '../../src/world/terrain-lod';
import {plantClusters} from '../../src/world/spatial';
import {roadAt,nearestRoad,riverAt} from '../../src/world/road';
import {terrainRow} from '../../src/world/terrain-grid';
import {VehiclePhysics} from '../../src/vehicle/physics';
import {generateHorizon} from '../../src/world/horizon';
it('keeps the entire detail zone prepared through high-speed reversals and turns',()=>{
  for(const z of [-1000000,-.1,0,195,999999])for(const speed of [-350/3.6,0,350/3.6])for(const heading of [0,Math.PI/2,Math.PI])for(const view of [-1,1]){
    const ids=chunkWindow(preparationCenter(z,speed,heading,view));expect(ids).toHaveLength(MAX_CHUNKS);
    const center=Math.floor(z/200);for(let i=-3;i<=3;i++)expect(ids).toContain(center+i);
  }
});
it('indexes all original fine triangles and retains exact edge rows in every LOD',()=>{
  const cells=180,levels=terrainLodIndices(cells);
  expect(levels.map(level=>level.length)).toEqual([21600,12780,8370]);
  for(const level of levels){expect(Math.max(...level)).toBeLessThan(20*cells*6);expect(new Set(level).size).toBeLessThan(level.length);}
  const edge=(level:Uint16Array,last:boolean)=>new Set([...level].filter(index=>last?Math.floor(index/(cells*6))===19&&[1,5].includes(index%6):Math.floor(index/(cells*6))===0&&[0,2].includes(index%6)));
  for(const level of levels){expect(edge(level,false)).toEqual(edge(levels[0],false));expect(edge(level,true)).toEqual(edge(levels[0],true));}
});
it('cluster bounds include crowns and stems rather than merely their origins',()=>{
  const values=new Float32Array([10,3,20,12,18,10,0,35,8,40,8,12,8,0,240,20,70,9,16,9,0]);
  const clusters=plantClusters(values);expect(clusters).toHaveLength(2);expect(clusters.flatMap(c=>[...c.indices]).sort()).toEqual([0,1,2]);
  for(const c of clusters)for(const index of c.indices){const i=index*7;for(const y of [values[i+1],values[i+1]+values[i+4]])expect(Math.hypot(values[i]-c.x,y-c.y,values[i+2]-c.z)).toBeLessThanOrEqual(c.radius+.0001);}
});
it('preserves fine terrain coverage across permitted off-road exploration and a fast countdown exit',()=>{
  const row=terrainRow(1000,1942),road=roadAt(1000,1942);
  for(let i=0;i<row.x.length-1;i++)if(row.x[i]>road.x-1300&&row.x[i+1]<road.x+1300)expect(row.x[i+1]-row.x[i]).toBeLessThanOrEqual(25.001);
});
it('nearest-road projection agrees with a global dense search, including bridge areas',()=>{
  for(const seed of [0,1942,98213])for(const z of [760,riverAt(0,seed).crossing,6280])for(const offset of [-650,325]){
    const road=roadAt(z,seed),x=road.x+offset,p=nearestRoad(x,z,seed),cost=(p.x-x)**2+(p.z-z)**2;
    let brute=Infinity;for(let at=z-Math.abs(offset);at<=z+Math.abs(offset);at+=2){const q=roadAt(at,seed);brute=Math.min(brute,(q.x-x)**2+(q.z-z)**2);}
    expect(cost).toBeLessThanOrEqual(brute+.05);
    const car=new VehiclePhysics(seed);car.x=x;car.z=z;car.speed=90;car.yawRate=1;car.recover();expect(car.speed).toBe(0);expect(car.yawRate).toBe(0);expect(car.wheelContact.every(Boolean)).toBe(true);
  }
});
it('bounds and deterministically regenerates both horizon bands with stitching overlap',()=>{
  const a=generateHorizon(0,1942),b=generateHorizon(0,1942);expect(a).toEqual(b);
  expect(a.positions.length).toBeLessThan(250000);expect(a.normals.length).toBe(a.positions.length);expect(a.colors.length).toBe(a.positions.length);
  const z=[];for(let i=2;i<a.positions.length;i+=3)z.push(a.positions[i]);expect(Math.min(...z)).toBe(-5600);expect(Math.max(...z)).toBe(5600);
});
it('dry grass supports steer/brake control and smooth asphalt rejoining',()=>{
  const road=roadAt(0,1942),grass=new VehiclePhysics(1942,()=>0,()=>.84);grass.x=road.x+10;grass.setSpeed(20);
  for(let i=0;i<45;i++)grass.step(1/60,{throttle:false,brake:false,steer:1});expect(grass.yawRate).toBeGreaterThan(.1);expect(Math.abs(grass.lateralSpeed)).toBeLessThan(3);
  for(let i=0;i<180&&grass.speed>.1;i++)grass.step(1/60,{throttle:false,brake:true,steer:0});expect(Math.abs(grass.speed)).toBeLessThan(.1);
  for(let i=0;i<90;i++)grass.step(1/60,{throttle:false,brake:false,steer:0});expect(Math.abs(grass.yawRate)).toBeLessThan(.03);
  grass.x=road.x+3.5;grass.setSpeed(12);for(let i=0;i<45;i++)grass.step(1/60,{throttle:true,brake:false,steer:1});expect(Number.isFinite(grass.speed+grass.yawRate)).toBe(true);expect(grass.slip).toBeLessThan(1);
});
