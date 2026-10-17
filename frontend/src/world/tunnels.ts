import {CHUNK_LENGTH,roadAt,roadSurface,tunnelAt} from './road';
import {terrainMeshHeight} from './terrain-grid';
import type {Obstacle} from '../vehicle/collider';
const ARCH=[[-5.4,0],...Array.from({length:17},(_,i)=>{const a=-Math.PI/2+i*Math.PI/16;return [5.4*Math.sin(a),3+3.3*Math.cos(a)];}),[5.4,0]];
const quad=(out:number[],a:number[],b:number[],c:number[],d:number[])=>out.push(...a,...c,...b,...b,...c,...d);
/** Hollow volume with original mountain roof and open, excavated portals.
 * No caps across the carriageway; the same segment endpoints anchor colliders. */
export function generateTunnel(id:number,seed:number){
 const start=id*CHUNK_LENGTH,lining:number[]=[],excavation:number[]=[],lamps:number[]=[],obstacles:Obstacle[]=[];
 for(let z=start;z<start+CHUNK_LENGTH;z+=10){
  const tunnel=tunnelAt(z+5,seed);if(!tunnel)continue;
  const a=roadAt(z,seed),b=roadAt(z+10,seed);
  const point=(p:typeof a,x:number,h:number)=>[p.x+x,p.y+x*p.bank+h,p.z-start];
  for(let i=0;i<ARCH.length-1;i++){const [x,h]=ARCH[i],[nx,nh]=ARCH[i+1];quad(lining,point(a,nx,nh),point(a,x,h),point(b,nx,nh),point(b,x,h));}
  // Natural exterior terrain connects at the fixed +/-7m terrain columns.
  const top=(p:typeof a,x:number)=>{
    // Match the exact exterior roof plane at the portal too. Sampling a new
    // height at each arch vertex left triangular gaps against that plane.
    const left=terrainMeshHeight(p.x-7,p.z,seed),right=terrainMeshHeight(p.x+7,p.z,seed);
    return [p.x+x,left+(right-left)*(x+7)/14,p.z-start];
  };
  quad(excavation,top(a,-7),top(a,7),top(b,-7),top(b,7));
  for(const side of [-1,1])quad(excavation,point(a,side*5.4,3),top(a,side*7),point(b,side*5.4,3),top(b,side*7));
  for(const side of [-1,1]){const x=(a.x+b.x)/2+side*5.45,y=Math.min(a.y,b.y);obstacles.push({x,y,z:z+5,halfX:.2,halfZ:Math.hypot(b.x-a.x,10)/2+.01,height:6.5,heading:Math.atan2(b.x-a.x,10),material:'stone'});}
  if(z===tunnel.start||z+10===tunnel.end){const p=z===tunnel.start?a:b;
   // Ring/fan around the arch rather than a solid rectangle over its entrance.
   for(let i=0;i<ARCH.length-1;i++){const [x,h]=ARCH[i],[nx,nh]=ARCH[i+1];
    const outer=(x:number,h:number)=>Math.abs(x)>=5.399&&h===0?point(p,Math.sign(x)*7,0):top(p,x===-5.4?-7:x===5.4?7:x);
    quad(excavation,point(p,x,h),point(p,nx,nh),outer(x,h),outer(nx,nh));
   }
   for(let i=0;i<ARCH.length-1;i++){const [x,h]=ARCH[i],[nx,nh]=ARCH[i+1];
    const inner=(x:number,h:number)=>{const v=point(p,x,h);v[2]+=z===tunnel.start?-.12:.12;return v;};
    const outer=(x:number,h:number)=>{const v=point(p,x*1.06,h===0?0:h+.32);v[2]+=z===tunnel.start?-.14:.14;return v;};
    quad(lining,inner(x,h),inner(nx,nh),outer(x,h),outer(nx,nh));
   }
  }
  // Emissive fixtures, 35m spacing, geometry only: no new dynamic/shadow lights.
  for(let at=Math.ceil(z/35)*35;at<z+10;at+=35){const p=roadAt(at,seed);quad(lamps,point(p,-.4,6.15),point(p,.4,6.15),[p.x-.4,p.y+6.15,at+.9-start],[p.x+.4,p.y+6.15,at+.9-start]);}
 }
 return {lining:new Float32Array(lining),excavation:new Float32Array(excavation),lamps:new Float32Array(lamps),obstacles};
}

export function tunnelCeiling(x:number,z:number,seed:number){
 if(!tunnelAt(z,seed))return Infinity;const p=roadSurface(z,seed),offset=x-p.x;
 if(Math.abs(offset)>5.4)return Infinity;
 for(let i=1;i<ARCH.length-2;i++){const a=ARCH[i],b=ARCH[i+1];if(offset>=a[0]&&offset<=b[0]&&b[0]>a[0])return p.y+offset*p.bank+a[1]+(b[1]-a[1])*(offset-a[0])/(b[0]-a[0]);}
 return Infinity;
}
