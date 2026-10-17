import {expect,it} from 'vitest';
import {DrivingDistance,DISTANCE_KEY} from '../../src/app/distance';
import {DEFAULT_HANDLING,handlingFactors} from '../../src/vehicle/handling';
import {VehiclePhysics} from '../../src/vehicle/physics';
import {RoadRecovery} from '../../src/vehicle/recovery';
import {roadAt,tunnelAt,tunnelPlan,naturalHeight,landscapeHeight,riverAt,bridgeAt} from '../../src/world/road';
import {penetration} from '../../src/vehicle/collider';
import {generateTunnel} from '../../src/world/tunnels';
import {railCoverage,railPoint} from '../../src/world/roadside';
import {generateScenery} from '../../src/world/scenery';
import {generateChunk} from '../../src/world/generate';
import {TERRAIN_BAND_CELLS,terrainLodIndices,terrainLodRanges} from '../../src/world/terrain-lod';
import {terrainRow,terrainMeshHeight} from '../../src/world/terrain-grid';
import {surfaceHeight,tunnelRoofHeight} from '../../src/world/surface';
it('keeps neutral handling exact and changes axle balance within finite traction limits',()=>{
 expect(handlingFactors(DEFAULT_HANDLING)).toEqual({grip:1,frontGrip:1,rearGrip:1,frontStiffness:1,rearStiffness:1});
 const factors=handlingFactors({balance:1,grip:1});expect(factors.frontGrip).toBeGreaterThan(factors.rearGrip);expect(factors.frontStiffness).toBeGreaterThan(1);
 expect(handlingFactors({balance:99,grip:-99}).grip).toBeCloseTo(.82,12);expect(handlingFactors({balance:NaN,grip:Infinity})).toEqual(handlingFactors(DEFAULT_HANDLING));
 const drive=(balance:number)=>{const car=new VehiclePhysics(1942,()=>0,()=>1.24);car.setHandling({balance,grip:0});car.setSpeed(28);for(let i=0;i<120;i++)car.step(1/240,{throttle:false,brake:false,steer:.7});return car;};
 expect(drive(1).yawRate).toBeGreaterThan(drive(-1).yawRate);
});
it('persists only valid genuine distance and handles corrupt or denied storage',()=>{
 const values=new Map<string,string>();const storage={getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value);}};
 const total=new DrivingDistance(storage);total.add(128.6);total.add(NaN);total.add(-2);total.add(Infinity);total.flush();
 expect([...values.keys()]).toEqual([DISTANCE_KEY]);expect(new DrivingDistance(storage).kilometres).toBe(.1286);
 values.set(DISTANCE_KEY,'broken');expect(new DrivingDistance(storage).kilometres).toBe(0);
 const denied=new DrivingDistance({getItem:()=>{throw Error('denied');},setItem:()=>{throw Error('denied');}});denied.add(123);denied.flush();expect(denied.kilometres).toBe(.123);
 const car=new VehiclePhysics(1942,()=>0,()=>1.24);car.setSpeed(10);car.step(1/60,{throttle:false,brake:false,steer:0});const moved=car.distanceTravelled;expect(moved).toBeGreaterThan(0);car.recover();car.placeOnRoad(10000);expect(car.distanceTravelled).toBe(moved);
});
it('waits two seconds while flooded, then counts five seconds in the shared recovery controller',()=>{
 const timer=new RoadRecovery();timer.update(.1,400,true);expect(timer.seconds).toBe(0);expect(timer.reason).toBe('water');
 timer.update(1.9,400,true);expect(timer.seconds).toBe(5);expect(timer.settling).toBe(0);
 timer.update(4.9,0,true);expect(timer.seconds).toBe(1);expect(timer.update(.1,0,true)).toBe(true);timer.reset();expect(timer.reason).toBeUndefined();
});
it('bores uncommon seeded tunnels beneath actual mountain cover with hollow portals and matching wall colliders',()=>{
 let count=0;for(let i=0;i<100;i++){const t=tunnelPlan(i,1942);expect(tunnelPlan(i,1942)).toEqual(t);if(!t)continue;count++;
  expect(t.end-t.start).toBeGreaterThanOrEqual(120);for(let z=t.start;z<=t.end;z+=10){const road=roadAt(z,1942);expect(Math.abs(road.grade)).toBeLessThan(.07);expect(landscapeHeight(road.x,z,1942)-road.y).toBeGreaterThan(6.3);expect(tunnelAt(z,1942)).toEqual(t);}
  const id=Math.floor(t.start/200),mesh=generateTunnel(id,1942);expect(mesh.lining.length).toBeGreaterThan(0);expect(mesh.obstacles.length).toBeGreaterThan(0);
  for(const o of mesh.obstacles){expect(Math.abs(o.x-roadAt(o.z,1942).x)).toBeGreaterThan(5);expect(o.material).toBe('stone');}
  const car=new VehiclePhysics(1942);car.placeOnRoad(t.center);expect(car.y).toBeLessThan(naturalHeight(car.x,car.z,1942)-6);
  const wall=mesh.obstacles[0],wallCar=new VehiclePhysics(1942);wallCar.x=wall.x-.15;wallCar.z=wall.z;wallCar.y=roadAt(wall.z,1942).y;wallCar.heading=wall.heading;wallCar.obstacles=[mesh.obstacles];wallCar.step(1/60,{throttle:false,brake:false,steer:0});expect(penetration(wallCar.x,wallCar.y,wallCar.z,wallCar.heading,wallCar.colliders,wall)).toBeUndefined();
  car.y=roadAt(t.center,1942).y+8;car.step(1/60,{throttle:false,brake:false,steer:0});expect(car.y-roadAt(t.center,1942).y).toBeLessThan(6);

 }
 expect(count).toBeGreaterThan(0);expect(count).toBeLessThan(30);
},20000);
it('connects rails through bridges without crossing asphalt and removes redundant reflectors',()=>{
 for(const id of [0,2,5,15,45,80]){const data=generateScenery(id,1942),reflectors=data.instances.reflector;
  for(let j=0;j<reflectors.length;j+=7){const z=reflectors[j+2]+id*200,side=Math.sign(reflectors[j]-roadAt(z,1942).x);expect(railCoverage(z,1942,side)).toBe(0);}
  for(let z=id*200;z<(id+1)*200;z+=5)for(const side of [-1,1]){const a=railPoint(z,1942,side),b=railPoint(z+.001,1942,side);expect(Math.abs(a.x-roadAt(z,1942).x)).toBeGreaterThan(3.4);expect(a.y+.03).toBeCloseTo(surfaceHeight(a.x,z,1942),7);expect(Math.hypot(a.x-b.x,a.y-b.y)).toBeLessThan(.01);}
 }
},20000);
it('pins the entire road band below asphalt across road, bridge and bore rows',()=>{
 for(let i=0;i<20;i++){const t=tunnelPlan(i,1942);if(!t)continue;for(let z=t.start-50;z<=t.end+50;z+=10){const p=roadAt(z,1942),row=terrainRow(z,1942);expect(row.x.length).toBe(terrainRow(z+10,1942).x.length);for(const side of [-3.3,0,3.3])expect(terrainMeshHeight(p.x+side,z,1942)).toBeLessThan(surfaceHeight(p.x+side,z,1942)-.02);}}
});

it('terrain bands contain every prepared triangle and index offsets partition each LOD exactly',()=>{
 for(const id of [-2,0,15,1000]){
  const data=generateChunk(id,1942),cells=data.terrain.length/(20*18),indices=terrainLodIndices(cells),ranges=terrainLodRanges(cells);
  for(let level=0;level<3;level++){expect(ranges[level][cells]).toBe(indices[level].length);for(let c=0;c<cells;c++)expect(ranges[level][c+1]).toBeGreaterThan(ranges[level][c]);}
  for(let i=0;i<data.terrain.length;i+=3){const cell=Math.floor(i/18)%cells,band=Math.floor(cell/TERRAIN_BAND_CELLS)*6;
   for(let axis=0;axis<3;axis++){expect(data.terrain[i+axis]).toBeGreaterThanOrEqual(data.terrainBounds[band+axis]-.001);expect(data.terrain[i+axis]).toBeLessThanOrEqual(data.terrainBounds[band+3+axis]+.001);}}
 }
},15000);

it('keeps guided250/350km/h wheel support through a complete bore and both approaches',()=>{
 let tunnel:ReturnType<typeof tunnelPlan>;for(let i=0;i<100&&!tunnel;i++)tunnel=tunnelPlan(i,1942);expect(tunnel).toBeDefined();const t=tunnel!;
 const obstacles=[];for(let id=Math.floor(t.start/200);id<=Math.floor(t.end/200);id++)obstacles.push(...generateTunnel(id,1942).obstacles);
 for(const speed of [250,350]){const car=new VehiclePhysics(1942);car.placeOnRoad(t.start-30);car.obstacles=[obstacles];let airborne=0;
  while(car.z<t.end+30){const p=roadAt(car.z,1942);car.x=p.x-Math.cos(p.heading)*1.7;car.heading=p.heading;car.setSpeed(speed/3.6);car.step(1/60,{throttle:false,brake:false,steer:0});
   if(car.wheelContact.every(c=>!c))airborne++;expect(car.submerged).toBe(false);expect(Math.abs(car.pitch)).toBeLessThan(.16);expect(car.y-surfaceHeight(car.x,car.z,1942)).toBeLessThan(.3);}
  expect(airborne).toBe(0);expect(car.impacts).toBe(0);
 }
},15000);

it('stitches all fine/coarse terrain-border vertices without dropping intermediate edge rows',()=>{
 const cells=180,rows=20,first=(cells+1-7)/2;
 const vertex=(row:number,col:number)=>(Math.min(row,rows-1)*cells+col)*6+(row===rows?1:0);
 for(const indices of terrainLodIndices(cells)){const used=new Set(indices);for(let row=0;row<=rows;row++)for(const col of [first-13,first+19])expect(used.has(vertex(row,col))).toBe(true);}
});

it('preserves flooded gravity below bridge decks and safely recovers onto the deck',()=>{
 const crossing=riverAt(0,1942).crossing,p=roadAt(crossing,1942),water=riverAt(crossing,1942);expect(bridgeAt(crossing,1942).active).toBe(true);
 const car=new VehiclePhysics(1942);car.x=p.x;car.z=crossing;car.y=water.y-1.1;const firstY=car.y;
 for(let i=0;i<120;i++)car.step(1/60,{throttle:true,brake:true,steer:1});
 expect(car.submerged).toBe(true);expect(car.y).toBeLessThan(firstY);expect(car.y).toBeLessThan(p.y-1);car.recover();expect(car.submerged).toBe(false);expect(car.y).toBeGreaterThan(water.y+3);
 const data=generateScenery(Math.floor(crossing/200),1942),supports=data.instances.concrete;
 for(let i=0;i<supports.length;i+=7){const z=supports[i+2]+Math.floor(crossing/200)*200;expect(data.obstacles.some(o=>o.material==='stone'&&Math.abs(o.x-supports[i])<.01&&Math.abs(o.z-z)<.01&&Math.abs(o.halfX-supports[i+3]/2)<.01)).toBe(true);}
});
it('supports exploration above tunnel roofs without snapping the car through mountain terrain',()=>{
 let t:ReturnType<typeof tunnelPlan>;for(let i=0;i<100&&!t;i++)t=tunnelPlan(i,1942);expect(t).toBeDefined();const car=new VehiclePhysics(1942);car.placeOnRoad(t!.center);const roof=tunnelRoofHeight(car.x,car.z,1942);car.y=roof;
 for(let i=0;i<120;i++)car.step(1/60,{throttle:false,brake:false,steer:0});expect(car.y).toBeGreaterThan(roadAt(car.z,1942).y+6);expect(car.submerged).toBe(false);car.recover();expect(car.y).toBeLessThan(roadAt(car.z,1942).y+.15);
});
