import { roadAt, riverAt, terrainHeight, landscapeNoise, smooth } from './road';

export const TERRAIN_STEP = 10;
const OFFSETS = [...new Set([
  -12000,-6000,-4000,
  ...Array.from({length:11},(_,i)=>-3000+i*100),
  ...Array.from({length:15},(_,i)=>-2000+i*100),
  ...Array.from({length:109},(_,i)=>(i-54)*25),
  -75,-50,-32,-20,-12,-7,-5,0,5,7,12,20,32,50,75,
  ...Array.from({length:15},(_,i)=>600+i*100),
  ...Array.from({length:11},(_,i)=>2000+i*100),
  4000,6000,12000,
])].sort((a,b)=>a-b);
type ShapeRow = { x: Float64Array; y: Float64Array; raw:Float64Array; shaped:boolean; normals?: Float32Array };
type Row = ShapeRow & {normals:Float32Array};
const rows = new Map<string, ShapeRow>();

/** Shared weathered heightfield. No rocks are placed on top of the mountain.
 * Road earthworks, tunnel volumes and carved river banks remain protected. */
function rawRow(z: number, seed: number): ShapeRow {
  const key = `${seed}:${z}`;
  const stored = rows.get(key);
  if (stored) return stored;
  const road = roadAt(z, seed), river = riverAt(z, seed);
  // Keep carriageway columns at the SAME indices in every row. Sorting
  // migrating river points through those columns joined unrelated vertices,
  // creating triangular terrain ridges across the road at oblique crossings.
  const channel=[-140,-80,-40,-18,-7,0,7,18,40,80,140].map(offset=>river.x-road.x+offset*river.halfWidth/13);
  const left=[...OFFSETS.filter(x=>x<=-7),...channel.map(x=>Math.min(-7,x))].sort((a,b)=>a-b);
  const right=[...OFFSETS.filter(x=>x>=7),...channel.map(x=>Math.max(7,x))].sort((a,b)=>a-b);
  const offsets=[...left,-5.7,-5,-3.4,0,3.4,5,5.7,...right];
  const x = Float64Array.from(offsets, offset => road.x + offset);
  const y = Float64Array.from(x, px => terrainHeight(px, z, seed));
  const row={x,y,raw:y,shaped:false};rows.set(key,row);
  if(rows.size>256)rows.delete(rows.keys().next().value!);
  return row;
}
function shapeRow(z:number,seed:number):ShapeRow{
  const row=rawRow(z,seed);if(row.shaped)return row;
  const {x,raw:y}=row,road=roadAt(z,seed),river=riverAt(z,seed),a=rawRow(z-TERRAIN_STEP,seed),b=rawRow(z+TERRAIN_STEP,seed);
  const shaped=y.slice();
  for(let i=0;i<x.length;i++){
    const distance=Math.abs(x[i]-road.x),bankProtection=smooth((Math.abs(x[i]-river.x)-river.halfWidth-125)/90);
    const protection=smooth((distance-64)/96)*bankProtection;
    const cutting=smooth((distance-9)/12)*(1-smooth((distance-42)/22))*bankProtection;
    if(protection===0&&cutting===0)continue;
    let left=i-1,right=i+1;while(left>=0&&x[i]-x[left]<1e-6)left--;while(right<x.length&&x[right]-x[i]<1e-6)right++;
    const gx=left>=0&&right<x.length?(y[right]-y[left])/(x[right]-x[left]):0;
    const gz=(rowHeight(a,x[i],true)-rowHeight(b,x[i],true))/(TERRAIN_STEP*2);
    const gradient=Math.hypot(gx,gz),exposure=smooth((gradient-.38)/.5)*protection;
    const face=smooth((gradient-.5)/.5)*cutting;
    if(exposure===0&&face===0)continue;
    // Broad weathered ribs, incised gullies and bedding ledges survive the
    // existing 25m cross-section / 10-40m longitudinal LOD. Bounded relief
    // follows the exposed slope, without replacing the geographic spine.
    const rib=1-Math.abs(landscapeNoise(x[i]/105,z/150,seed+621)*2-1);
    const gully=smooth((landscapeNoise(x[i]/75,z/190,seed+622)-.58)/.28);
    const phase=y[i]/22+landscapeNoise(x[i]/170,z/230,seed+623)*.6,bedding=phase-Math.floor(phase);
    const ledge=smooth((bedding-.28)/.24)-bedding;
    shaped[i]+=exposure*((rib-.5)*18-gully*7+ledge*5);
    // Small weathered bedding relief breaks long machined cutting walls,
    // outside the shoulder; it does not add unsupported blocks or road steps.
    shaped[i]+=face*(landscapeNoise(x[i]/28,z/45,seed+624)-.5)*2.4;
  }
  row.y=shaped;row.shaped=true;return row;
}
function rowHeight(row:ShapeRow,x:number,raw=false){
  let lo=0,hi=row.x.length-1;
  while(hi-lo>1){const mid=(lo+hi)>>>1;if(x<row.x[mid])hi=mid;else lo=mid;}
  const span=row.x[hi]-row.x[lo],t=span>1e-9?Math.max(0,Math.min(1,(x-row.x[lo])/span)):0;
  const values=raw?row.raw:row.y;return values[lo]+(values[hi]-values[lo])*t;
}
/** Actual shaped grid normals are shared by PBR shading and contact sampling. */
export function terrainRow(z:number,seed:number):Row{
  const row=shapeRow(z,seed);if(row.normals)return row as Row;
  const {x,y}=row,a=shapeRow(z-TERRAIN_STEP,seed),b=shapeRow(z+TERRAIN_STEP,seed);
  const normals=new Float32Array(x.length*3);
  for(let i=0;i<x.length;i++){
    let left=i-1,right=i+1;while(left>=0&&x[i]-x[left]<1e-6)left--;while(right<x.length&&x[right]-x[i]<1e-6)right++;
    const gl=left>=0?(y[i]-y[left])/(x[i]-x[left]):0,gr=right<x.length?(y[right]-y[i])/(x[right]-x[i]):gl;
    const nx=-(gl+gr)*.5,nz=(rowHeight(a,x[i])-rowHeight(b,x[i]))/(TERRAIN_STEP*2),length=Math.hypot(nx,1,nz);
    normals.set([nx/length,1/length,nz/length],i*3);
  }
  row.normals=normals;return row as Row;
}

export function terrainMeshHeight(x: number, z: number, seed: number): number {
  const start = Math.floor(z / TERRAIN_STEP) * TERRAIN_STEP, t = (z - start) / TERRAIN_STEP;
  const a = terrainRow(start, seed), b = terrainRow(start + TERRAIN_STEP, seed);
  // Interpolated sorted rows stay sorted, including the moving river samples.
  // Find one interval instead of scanning hundreds for every scenery/contact.
  let lo=0,hi=a.x.length-1;
  while(hi-lo>1){const mid=(lo+hi)>>>1;if(x<a.x[mid]*(1-t)+b.x[mid]*t)hi=mid;else lo=mid;}
  for (let i = lo; i < lo+1; i++) {
    const left = a.x[i] * (1 - t) + b.x[i] * t, right = a.x[i + 1] * (1 - t) + b.x[i + 1] * t;
    if (x < left || x > right) continue;
    const diagonal = a.x[i + 1] * (1 - t) + b.x[i] * t;
    // Same a/c/b and b/c/d triangle split used by generateChunk, including moving river rows.
    if (x <= diagonal && a.x[i + 1] - a.x[i] > 1e-9) {
      const beta = (x - left) / (a.x[i + 1] - a.x[i]);
      return a.y[i] * (1 - t - beta) + b.y[i] * t + a.y[i + 1] * beta;
    }
    if (b.x[i + 1] - b.x[i] > 1e-9) {
      const gamma = (right - x) / (b.x[i + 1] - b.x[i]);
      return a.y[i + 1] * (1 - t) + b.y[i] * gamma + b.y[i + 1] * (t - gamma);
    }
    return a.y[i] * (1 - t) + b.y[i] * t;
  }
  return terrainHeight(x, z, seed);
}
