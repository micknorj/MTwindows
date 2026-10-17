import {TERRAIN_BAND_CELLS} from './terrain-lod';
import {generateTunnel} from './tunnels';
import { deckAt, CHUNK_LENGTH, ROAD_STEP, BRIDGE_HALF_WIDTH, bridgeAt, riverChannelAt, roadAt, regionAt,roadShoulderWidth,tunnelAt } from './road';
import { forestCover,generateScenery, type SceneryData } from './scenery';
import { terrainRow, TERRAIN_STEP, terrainMeshHeight } from './terrain-grid';

export interface ChunkData { id: number;terrainFine:Uint8Array; terrainBounds:Float32Array; tunnel:Float32Array; tunnelLamps:Float32Array; structure:Float32Array;excavation:Float32Array; terrain: Float32Array; terrainNormals: Float32Array; colors: Float32Array; road: Float32Array; shoulder: Float32Array; shoulderColors:Float32Array;markings: Float32Array; water: Float32Array; waterColors:Float32Array; scenery: SceneryData; }

function quad(out: number[], a: number[], b: number[], c: number[], d: number[]) {
  out.push(...a, ...c, ...b, ...b, ...c, ...d);
}

export function generateChunk(id: number, seed: number): ChunkData {
  const terrain: number[] = [], terrainNormals: number[] = [], colors: number[] = [], road: number[] = [], shoulder: number[] = [],shoulderColors:number[]=[];const markings: number[] = [], water: number[] = [],structure:number[]=[];
  const start = id * CHUNK_LENGTH;
  const rowColors=(row:ReturnType<typeof terrainRow>,z:number)=>{
    const river=riverChannelAt(z,seed).x;
    return Array.from(row.x,(x,index)=>[forestCover(x,z,seed,row.y[index]),Math.exp(-Math.abs(x-river)/40),0]);
  };
  let first=terrainRow(start,seed),firstColors=rowColors(first,start);
  const terrainFine=new Uint8Array(first.x.length-1);
  const terrainBounds=new Float32Array(Math.ceil((first.x.length-1)/TERRAIN_BAND_CELLS)*6);
  for(let i=0;i<terrainBounds.length;i+=6)terrainBounds.set([Infinity,Infinity,0,-Infinity,-Infinity,CHUNK_LENGTH],i);
  for (let row = 0; row < CHUNK_LENGTH / TERRAIN_STEP; row++) {
    const z = start + row * TERRAIN_STEP, next = terrainRow(z + TERRAIN_STEP, seed),nextColors=rowColors(next,z+TERRAIN_STEP);
    const point = (data: typeof first, i: number, localZ: number) => [data.x[i], data.y[i], localZ];
    const normal = (data: typeof first, i: number) => Array.from(data.normals.subarray(i * 3, i * 3 + 3));
    const waterA=riverChannelAt(z,seed),waterB=riverChannelAt(z+TERRAIN_STEP,seed);
    for (let cell = 0; cell < first.x.length - 1; cell++) {
      // Keep channel/shore columns fine in every LOD: decimating migrating
      // valley banks previously interpolated terrain through the water ribbon.
      if((first.x[cell]<=waterA.x+waterA.halfWidth*1.4&&first.x[cell+1]>=waterA.x-waterA.halfWidth*1.4)
        ||(next.x[cell]<=waterB.x+waterB.halfWidth*1.4&&next.x[cell+1]>=waterB.x-waterB.halfWidth*1.4)){
        for(let c=Math.max(0,cell-1);c<=Math.min(terrainFine.length-1,cell+1);c++)terrainFine[c]=1;
      }
      const at=Math.floor(cell/TERRAIN_BAND_CELLS)*6;
      terrainBounds[at]=Math.min(terrainBounds[at],first.x[cell],next.x[cell]);
      terrainBounds[at+1]=Math.min(terrainBounds[at+1],first.y[cell],next.y[cell],first.y[cell+1],next.y[cell+1]);
      terrainBounds[at+3]=Math.max(terrainBounds[at+3],first.x[cell+1],next.x[cell+1]);
      terrainBounds[at+4]=Math.max(terrainBounds[at+4],first.y[cell],next.y[cell],first.y[cell+1],next.y[cell+1]);
      quad(terrain, point(first, cell, z - start), point(first, cell + 1, z - start), point(next, cell, z + TERRAIN_STEP - start), point(next, cell + 1, z + TERRAIN_STEP - start));
      quad(terrainNormals, normal(first, cell), normal(first, cell + 1), normal(next, cell), normal(next, cell + 1));
      quad(colors,firstColors[cell],firstColors[cell+1],nextColors[cell],nextColors[cell+1]);
    }
    first=next;firstColors=nextColors;
  }
  const strip = (out: number[], z: number, from: number, to: number, lift: number, length = ROAD_STEP) => {
    const a = roadAt(z, seed), b = roadAt(z + length, seed);
    const width=(at:number,side:number)=>tunnelAt(at,seed)?5.4:deckAt(at,seed)?BRIDGE_HALF_WIDTH:roadShoulderWidth(at,seed,side);
    const edge=(p:typeof a,offset:number)=>Math.max(0,Math.min(1,(Math.abs(offset)-3.4)/Math.max(.01,width(p.z,Math.sign(offset))-3.4)));
    const height = (p: typeof a, offset: number) => {
      const level=p.y+offset*p.bank-.018*Math.abs(offset)+lift;
      if(out!==shoulder||deckAt(p.z,seed)||tunnelAt(p.z,seed))return level;
      const blend=edge(p,offset);return level*(1-blend)+terrainMeshHeight(p.x+offset,p.z,seed)*blend;
    };
    const af=out===shoulder&&from<-3.4?-width(z,-1):from,at=out===shoulder&&to>3.4?width(z,1):to;
    const bf=out===shoulder&&from<-3.4?-width(z+length,-1):from,bt=out===shoulder&&to>3.4?width(z+length,1):to;
    quad(out, [a.x + af, height(a, af), z - start], [a.x + at, height(a, at), z - start], [b.x + bf, height(b, bf), z + length - start], [b.x + bt, height(b, bt), z + length - start]);
    if(out===shoulder){
      const tint=(p:typeof a,offset:number)=>(deckAt(p.z,seed)||tunnelAt(p.z,seed))?[0,0,1]:[edge(p,offset),regionAt(p.z,seed).forest,0];
      quad(shoulderColors,tint(a,af),tint(a,at),tint(b,bf),tint(b,bt));
    }

  };
  const beam=(z:number,left:number,right:number,top:number,bottom:number)=>{
    const a=roadAt(z,seed),b=roadAt(z+ROAD_STEP,seed);
    const p=(r:typeof a,x:number,h:number)=>[r.x+x,r.y+x*r.bank-.018*Math.abs(x)+h,r.z-start];
    const al=p(a,left,top),ar=p(a,right,top),bl=p(b,left,top),br=p(b,right,top),ad=p(a,left,bottom),ae=p(a,right,bottom),bd=p(b,left,bottom),be=p(b,right,bottom);
    quad(structure,al,ar,bl,br);quad(structure,ae,ad,be,bd);
    quad(structure,ad,al,bd,bl);quad(structure,ar,ae,br,be);
    quad(structure,ad,ae,al,ar);quad(structure,bl,br,bd,be);
  };
  for (let z = start; z < start + CHUNK_LENGTH; z += ROAD_STEP) {
    const span=bridgeAt(z+ROAD_STEP/2,seed);
    if(span.eligible&&z>=span.start-10&&z<span.end+10){
      beam(z,-BRIDGE_HALF_WIDTH,BRIDGE_HALF_WIDTH,-.026,-.85);
      for(const side of [-1,1])beam(z,side*2.6-.45,side*2.6+.45,-.85,-1.25);
    }

    strip(shoulder,z,-5.3,-3.4,-.025);strip(shoulder,z,-3.4,3.4,-.025);strip(shoulder,z,3.4,5.3,-.025);
    strip(road, z, -3.4, 0, 0); strip(road, z, 0, 3.4, 0);
    strip(markings, z, -3.19, -3.07, .015);
    strip(markings, z, 3.07, 3.19, .015);
    if (Math.round(z / ROAD_STEP) % 3 === 0) strip(markings, z, -.065, .065, .017, 3);
    const a = riverChannelAt(z, seed), b = riverChannelAt(z + ROAD_STEP, seed);
    const offsets=[-1,-7/13,0,7/13,1];
    for(let bank=0;bank<offsets.length-1;bank++) quad(water, [a.x+offsets[bank]*a.halfWidth,a.y,z-start], [a.x+offsets[bank+1]*a.halfWidth,a.y,z-start], [b.x+offsets[bank]*b.halfWidth,b.y,z+ROAD_STEP-start], [b.x+offsets[bank+1]*b.halfWidth,b.y,z+ROAD_STEP-start]);
  }
  const waterColors:number[]=[];
  for(let i=0;i<water.length;i+=3){
    const z=water[i+2]+start,a=riverChannelAt(z-.5,seed),b=riverChannelAt(z+.5,seed);
    const dx=b.x-a.x, direction=b.y>a.y?-1:1, length=Math.hypot(dx,1),speed=.15+.85*Math.min(1,Math.abs(b.y-a.y)*90);
    waterColors.push(Math.max(0,water[i+1]-terrainMeshHeight(water[i],z,seed)),.5+dx/length*direction*speed*.5,.5+direction/length*speed*.5);
  }
  const tunnel=generateTunnel(id,seed),scenery=generateScenery(id,seed);scenery.obstacles.push(...tunnel.obstacles);
  return { id,terrainFine,terrainBounds,tunnel:tunnel.lining,tunnelLamps:tunnel.lamps,structure:new Float32Array(structure),excavation:tunnel.excavation, terrain: new Float32Array(terrain), terrainNormals: new Float32Array(terrainNormals), colors: new Float32Array(colors), road: new Float32Array(road), shoulder: new Float32Array(shoulder),shoulderColors:new Float32Array(shoulderColors), markings: new Float32Array(markings), water: new Float32Array(water), waterColors:new Float32Array(waterColors), scenery };
}
