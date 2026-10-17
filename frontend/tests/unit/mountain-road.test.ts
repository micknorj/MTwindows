import {expect,it} from 'vitest';
import {planRoad,roadAt,riverAt,bridgeAt,roadShoulderWidth,naturalHeight} from '../../src/world/road';
import {terrainRow,terrainMeshHeight} from '../../src/world/terrain-grid';
import {generateScenery} from '../../src/world/scenery';
import {surfaceHeight,vehicleSubmerged,waterSurfaceAt} from '../../src/world/surface';
import {VehiclePhysics} from '../../src/vehicle/physics';
import {DEFAULT_BODY} from '../../src/vehicle/collider';

it('composes all six terrain-selected families over a long seeded journey',()=>{
  const counts=new Map<string,number>();let min=Infinity,max=-Infinity;
  for(let i=0;i<400;i++){
    const p=planRoad(i,1942);counts.set(p.style,(counts.get(p.style)??0)+1);
    expect(planRoad(i,1942)).toEqual(p);
    for(const at of [i*6000-1,i*6000,i*6000+1]){
      const road=roadAt(at,1942);min=Math.min(min,road.y);max=Math.max(max,road.y);
      expect(Math.abs(road.grade)).toBeLessThan(.07);
      expect(Math.abs(roadAt(at+.001,1942).grade-road.grade)).toBeLessThan(.00001);
    }
  }
  expect([...counts.keys()].sort()).toEqual(['bench','contour','hillside','pass','ridge','valley']);
  for(const fraction of counts.values())expect(fraction/400).toBeGreaterThan(.025);
  expect(counts.get('hillside')!/400).toBeGreaterThan(.3);
  expect(counts.get('valley')!/400).toBeLessThan(.32);
  expect(max-min).toBeGreaterThan(65);
},15000);

it('keeps road columns aligned as river knots migrate across consecutive rows',()=>{
  for(const seed of [0,1,1942,98213])for(let z=-400;z<6200;z+=10){
    const a=terrainRow(z,seed),b=terrainRow(z+10,seed),road=roadAt(z,seed);
    const i=Array.from(a.x).findIndex(x=>Math.abs(x-road.x)<1e-7);
    expect(b.x[i]).toBeCloseTo(roadAt(z+10,seed).x,7);
    for(const t of [.25,.5,.75])for(const offset of [-3.35,-1.7,0,1.7,3.35]){
      const at=z+t*10,p=roadAt(at,seed),x=p.x+offset;
      expect(terrainMeshHeight(x,at,seed)).toBeLessThan(surfaceHeight(x,at,seed)-.025);
    }
  }
},15000);

it('excludes the complete near/middle grass disk on slopes, curves and seams',()=>{
  for(const id of [-5,0,3,13,35,90]){
    const grass=generateScenery(id,1942).instances.grass;
    for(let i=0;i<grass.length;i+=7){
      const radius=grass[i+3]*.7+.08,z=grass[i+2]+id*200;
      for(let n=0;n<16;n++){
        const angle=n*Math.PI/8,x=grass[i]+Math.cos(angle)*radius,at=z+Math.sin(angle)*radius;
        const road=roadAt(at,1942),side=Math.sign(x-road.x);
        expect(Math.abs(x-road.x)).toBeGreaterThan(roadShoulderWidth(at,1942,side)+.2);
      }
    }
  }
},15000);

it('detects flooded chassis geometry without bridge, bank, shallow or raised-road false positives',()=>{
  for(const seed of [0,1,1942,98213])for(const z of [1000,6000,12000,20001]){
    const water=riverAt(z,seed),road=roadAt(z,seed);
    const pose={x:water.x,y:water.y-1.1,z,heading:0,pitch:0,roll:0};
    if(waterSurfaceAt(water.x,z,seed)!.depth>.7){
      for(const heading of [0,Math.PI/2,Math.PI])for(const roll of [0,.4])expect(vehicleSubmerged({...pose,heading,roll,pitch:.12},DEFAULT_BODY,seed)).toBe(true);
    }
    expect(vehicleSubmerged({...pose,y:water.y-.1},DEFAULT_BODY,seed)).toBe(false);
    expect(vehicleSubmerged({...pose,x:water.x+water.halfWidth+1},DEFAULT_BODY,seed)).toBe(false);
    expect(vehicleSubmerged({...pose,x:road.x,y:surfaceHeight(road.x,z,seed)},DEFAULT_BODY,seed)).toBe(false);
    const bank=waterSurfaceAt(water.x+water.halfWidth-.2,z,seed);
    if(!bank||bank.depth<=.7)expect(vehicleSubmerged({...pose,x:water.x+water.halfWidth-.2},DEFAULT_BODY,seed)).toBe(false);
  }
});

it('settles flooded vehicles with gravity and drag, ignores driving input, and restores after recovery',()=>{
 const water=riverAt(1000,1942),make=()=>{const car=new VehiclePhysics(1942);car.x=water.x;car.z=1000;car.y=water.y-1.1;car.setSpeed(8);car.lateralSpeed=2;return car;};
 const a=make(),b=make(),start=[a.x,a.y,a.z];
 for(let i=0;i<120;i++){a.step(1/60,{throttle:true,brake:true,steer:1});b.step(1/60,{throttle:false,brake:false,steer:0});}
 expect(a.submerged).toBe(true);expect([a.x,a.y,a.z]).not.toEqual(start);expect(a.y).toBeLessThan(start[1]);
 expect([a.x,a.y,a.z,a.speed,a.heading]).toEqual([b.x,b.y,b.z,b.speed,b.heading]);expect(Math.abs(a.speed)).toBeLessThan(1);expect(a.braking).toBe(false);expect(a.drivetrain.load).toBeLessThan(.001);
 a.recover();expect(a.submerged).toBe(false);expect(a.speed).toBe(0);expect(Math.abs(a.y-surfaceHeight(a.x,a.z,a.seed))).toBeLessThan(.15);
});

it('keeps dry bridge endpoints and adequate water clearance',()=>{
  for(const seed of [0,1942,98213])for(let z=0;z<120000;z+=6000){
    const r=riverAt(z,seed);if(!Number.isFinite(r.distance))continue;
    const b=bridgeAt(r.crossing,seed);expect(b.active).toBe(true);
    expect(Math.abs(b.start%5)).toBe(0);expect(Math.abs(b.end%5)).toBe(0);
    for(const at of [b.start,b.end]){const p=roadAt(at,seed),w=riverAt(at,seed);expect(Math.abs(p.x-w.x)).toBeGreaterThan(w.halfWidth+3);}
    const p=roadAt(r.crossing,seed);expect(p.y-riverAt(r.crossing,seed).y).toBeGreaterThan(3);
    expect(Math.abs(p.y-naturalHeight(p.x,r.crossing,seed))).toBeLessThan(26);
  }
});


it('keeps guided four-wheel contact stable at 250–350km/h over representative vertical profiles',()=>{
  const representatives=new Map<string,number>();
  for(let i=0;i<80;i++){const p=planRoad(i,1942);if(!representatives.has(p.style))representatives.set(p.style,i*6000+2500);}
  for(const speed of [250,350])for(const z of representatives.values()){
    const car=new VehiclePhysics(1942);car.placeOnRoad(z);let airborne=0;
    for(let i=0;i<360;i++){
      const road=roadAt(car.z,car.seed);car.x=road.x-Math.cos(road.heading)*1.7;car.heading=road.heading;car.setSpeed(speed/3.6);
      car.step(1/60,{throttle:false,brake:false,steer:0});
      if(car.wheelContact.every(contact=>!contact))airborne++;
      expect(car.submerged).toBe(false);expect(Math.abs(car.pitch)).toBeLessThan(.16);
      expect(car.y-surfaceHeight(car.x,car.z,car.seed),`z=${z},speed=${speed},i=${i},road=${road.grade},pitch=${car.pitch},contact=${car.wheelContact}`).toBeLessThan(.3);
    }
    expect(airborne).toBe(0);
  }
},15000);
