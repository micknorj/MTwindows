import { describe, expect, it } from 'vitest';
import { bridgeAt, naturalHeight, planRoad, regionAt, riverAt, roadAt, terrainHeight,riverChannelAt,landscapeHeight } from '../../src/world/road';
import { surfaceHeight, waterDepth } from '../../src/world/surface';
import { generateScenery, INSTANCE_CAPACITY, SCENERY_KINDS } from '../../src/world/scenery';
import { RoadTopology } from '../../src/world/topology';
import { generateChunk } from '../../src/world/generate';
import { TREE_KINDS } from '../../src/world/tree-config';
import { terrainMeshHeight } from '../../src/world/terrain-grid';

describe('terrain-informed road and water', () => {
  it('bounds proposals and provides a deterministic safe fallback', () => {
    for (let i = -20; i < 20; i++) {
      const plan = planRoad(i, 123); expect(plan.attempts).toBeLessThanOrEqual(4);
      expect(planRoad(i, 123)).toEqual(plan);
      expect(planRoad(i, 123, true)).toMatchObject({ bend: 0, fallback: true, attempts: 4 });
    }
  });
  it('keeps joins, grades, curve radii and earthworks within bounds', () => {
    for (const seed of [0, 1942, 98213, 0xffffffff]) for (let z = -20000; z < 20000; z += 25) {
      const p = roadAt(z, seed), next = roadAt(z + .01, seed);
      expect(Math.abs(p.grade)).toBeLessThan(.07); expect(Math.abs(p.curvature)).toBeLessThan(1 / 150);
      expect(Math.abs(naturalHeight(p.x, z, seed) - p.y)).toBeLessThan(40);
      expect(Math.abs(p.heading - next.heading)).toBeLessThan(.001);
    }
  });
  it('keeps 5 km of explicit road topology while bounding stored samples', () => {
    const topology = new RoadTopology(31);
    for (const z of [0, 199, 201, 6000, -3000, 1e6]) { topology.update(z); expect(topology.samples).toHaveLength(249); expect(topology.ahead - z).toBeGreaterThanOrEqual(5000); }
  });
  it('preserves a dry bridge deck over a carved river and enterable deep water', () => {
    for (const seed of [0, 1, 15, 98213]) {
      let z=0;
      for(let station=0;station<240000;station+=6000){const r=riverAt(station,seed);if(Number.isFinite(r.distance)){z=r.crossing;break;}}
      const p=roadAt(z,seed),bridge=bridgeAt(z,seed);
      expect(bridge).toMatchObject({ active: true, eligible: true });
      expect(bridge.span).toBeGreaterThanOrEqual(60);
      expect(surfaceHeight(p.x - 1.7, z, seed)).toBeGreaterThan(riverAt(z, seed).y + 2.8);
      if(Math.abs(p.x-riverAt(z,seed).x)<riverAt(z,seed).halfWidth*.4)expect(terrainHeight(p.x,z,seed)).toBeLessThan(riverAt(z,seed).y-1);
      expect(waterDepth(p.x - 1.7, z, seed)).toBe(0);
      let away=bridge.end+90;for(let step=0;bridgeAt(away,seed).active&&step<200;step++)away+=50;
      const water=riverAt(away, seed);
      expect(waterDepth(water.x, away, seed)).toBeGreaterThan(1);
      expect(bridgeAt(away, seed).active).toBe(false);
    }
  });
  it('uses long continuous macro transitions', () => {
    for (const z of [-6000, 0, 6000, 12000]) {
      expect(regionAt(z - .01, 5).forest).toBeCloseTo(regionAt(z + .01, 5).forest, 5);
      expect(regionAt(z - .01, 5).ridge).toBeCloseTo(regionAt(z + .01, 5).ridge, 4);
    }
  });
  it('keeps the bridge slab below the crowned and banked driving surface', () => {
    for (const seed of [0, 1942, 98213]) {
      const crossing = riverAt(0, seed).crossing, id = Math.floor(crossing / 200);
      const data = generateChunk(id, seed);
      for (let i = 0; i < data.shoulder.length; i += 3) {
        const x = data.shoulder[i], y = data.shoulder[i + 1], z = data.shoulder[i + 2] + id * 200;
        const p = roadAt(z, seed), offset = x - p.x;
        expect(y).toBeLessThan(p.y + offset * p.bank - .018 * Math.abs(offset));
      }
      expect(data.shoulder.length).toBeLessThanOrEqual(3600);
      expect(data.shoulderColors.length).toBe(data.shoulder.length);
    }
  });
});

describe('deterministic populated chunks', () => {
  it('does not leave invisible trunk collisions when a species buffer reaches capacity', () => {
    const capacities=TREE_KINDS.map(kind=>[kind,INSTANCE_CAPACITY[kind]] as const);
    try {
      for(const kind of TREE_KINDS) INSTANCE_CAPACITY[kind]=1;
      const data=generateScenery(14,1942);
      const trees=TREE_KINDS.reduce((sum,kind)=>sum+data.instances[kind].length/7,0);
      expect(trees).toBeGreaterThan(0);expect(trees).toBeLessThanOrEqual(4);
      expect(data.obstacles.filter(obstacle=>obstacle.material==='wood').length).toBe(trees);
    } finally { for(const [kind,capacity] of capacities) INSTANCE_CAPACITY[kind]=capacity; }
  });
  it('bounds instance buffers, excludes road obstructions, and keeps collisions for large objects', () => {
    for (let id = -35; id < 35; id++) {
      const data = generateScenery(id, 123);
      for (const kind of SCENERY_KINDS) expect(data.instances[kind].length / 7).toBeLessThanOrEqual(INSTANCE_CAPACITY[kind]);
      for (const kind of [...TREE_KINDS, 'rock'] as const) {
        const values = data.instances[kind];
        for (let i = 0; i < values.length; i += 7) {
          const z = id * 200 + values[i + 2]; expect(Math.abs(values[i] - roadAt(z, 123).x)).toBeGreaterThan(8);
        }
      }
      expect(data.obstacles.length).toBeGreaterThan(0);
      for(const removed of ['house','roof','window','pole','wire','fence','sign','chevron'])expect(data.instances).not.toHaveProperty(removed);
    }
    expect(generateScenery(14, 82)).toEqual(generateScenery(14, 82));
  },15000); // 70 cold chunks exceed five seconds on slower/loaded hosts.
  it('populates all four species while anchoring trees outside rivers', () => {
    const totals = Object.fromEntries(TREE_KINDS.map(kind=>[kind,0])) as Record<typeof TREE_KINDS[number],number>;
    for(let id=0;id<30;id++) {
      const data=generateScenery(id,1942);
      for(const kind of TREE_KINDS) {
        const values=data.instances[kind]; totals[kind]+=values.length/7;
        for(let i=0;i<values.length;i+=7) {
          const z=id*200+values[i+2];
          expect(values[i+1]).toBeCloseTo(terrainMeshHeight(values[i],z,1942),3);
          expect(Math.abs(values[i]-riverAt(z,1942).x)).toBeGreaterThan(17.99);
        }
      }
    }
    for(const count of Object.values(totals)) expect(count).toBeGreaterThan(100);
    expect(Object.values(totals).reduce((sum,count)=>sum+count,0)/30).toBeGreaterThan(150);
  });
});


describe('organic geography and drainage',()=>{
  it('selects varied seeded route families and substantial high-speed sections',()=>{
    const styles=new Set<string>();let raised=0,fast=0,samples=0;
    for(let id=0;id<80;id++){
      styles.add(planRoad(id,1942).style);
      for(let z=id*6000;z<(id+1)*6000;z+=100){
        const p=roadAt(z,1942),water=riverChannelAt(z,1942);samples++;
        if(p.y-water.y>12)raised++;
        if(Math.abs(p.curvature)<1/900)fast++;
        expect(Math.abs(p.grade)).toBeLessThan(.07);
      }
    }
    expect(styles.size).toBe(6);expect(raised).toBeGreaterThan(100);expect(fast/samples).toBeGreaterThan(.8);
  });
  it('varies channel widths/crossing intervals and preserves dry oblique bridges',()=>{
    const crossings=new Set<number>(),widths:number[]=[];
    for(let z=-12000;z<36000;z+=200){
      const r=riverAt(z,1942);crossings.add(r.crossing);widths.push(r.halfWidth);
      const before=riverAt(z-.001,1942),after=riverAt(z+.001,1942);
      expect(Math.abs(before.x-after.x)).toBeLessThan(.02);expect(Math.abs(before.y-after.y)).toBeLessThan(.002);
      expect(r.y).toBeLessThan(naturalHeight(r.x,z,1942));
    }
    expect(Math.max(...widths)-Math.min(...widths)).toBeGreaterThan(5);
    const ordered=[...crossings].sort((a,b)=>a-b),intervals=ordered.slice(1).map((z,i)=>z-ordered[i]);
    expect(ordered.length).toBeGreaterThan(5);expect(Math.max(...intervals)-Math.min(...intervals)).toBeGreaterThan(1000);
    for(const z of ordered){
      const r=riverAt(z,1942),bridge=bridgeAt(z,1942),road=roadAt(z,1942);
      if(Math.abs(road.x-r.x)>r.halfWidth+6){const edge=road.x+Math.sign(r.x-road.x)*5.7;expect(road.y-landscapeHeight(edge,z,1942)).toBeGreaterThan(2);}
      expect(bridge.active).toBe(true);
      expect(road.y-r.y).toBeGreaterThan(3.5);
      for(const edge of [-1,1]){
        const at=edge<0?bridge.start:bridge.end,r=riverAt(at,1942),p=roadAt(at,1942);
        expect(Math.abs(p.x-r.x)).toBeGreaterThan(r.halfWidth+2);
      }
    }
  });
});
