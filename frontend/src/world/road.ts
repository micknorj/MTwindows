export const CHUNK_LENGTH = 200;
export const ROAD_HALF_WIDTH = 3.4;
export const ROAD_STEP = 5;
// A constant safety envelope avoids pinching the carriageway at bridge portals.
export const RAIL_OFFSET = 4.95;
export const BRIDGE_HALF_WIDTH = 5.15;
export function roadShoulderWidth(z:number,seed:number,side:number){return ROAD_HALF_WIDTH+.65+.55*landscapeNoise(side*3,z/180,seed+509);}
export const REGION_LENGTH = 6000;
export const BRIDGE_HALF_SPAN = 30;
const PLAN_LENGTH = REGION_LENGTH;
export const clamp = (value: number, low = 0, high = 1) => Math.max(low, Math.min(high, value));
export const smooth = (value: number) => { const t = clamp(value); return t * t * (3 - 2 * t); };
export function randomAt(index: number, seed: number) {
  let n = Math.imul(index ^ seed, 0x45d9f3b); n = Math.imul(n ^ n >>> 16, 0x45d9f3b);
  return ((n ^ n >>> 16) >>> 0) / 4294967296;
}
export function landscapeNoise(x: number, z: number, seed: number) {
  const ix = Math.floor(x), iz = Math.floor(z), tx = smooth(x - ix), tz = smooth(z - iz);
  const sample = (a: number, b: number) => randomAt(Math.imul(a, 73856093) ^ Math.imul(b, 19349663), seed);
  return (sample(ix, iz) * (1 - tx) + sample(ix + 1, iz) * tx) * (1 - tz) + (sample(ix, iz + 1) * (1 - tx) + sample(ix + 1, iz + 1) * tx) * tz;
}
// C2 continuous geographic spine: unequal seeded bends have no fixed cycle or
// alternating steering rule. The existing highland heightfield remains intact.
function routeNoise(z:number,spacing:number,seed:number) {
  const i=Math.floor(z/spacing),t=z/spacing-i,w=t*t*t*(t*(t*6-15)+10);
  return randomAt(i,seed)*(1-w)+randomAt(i+1,seed)*w;
}
function baseline(z: number, seed: number) {
  return {x:(routeNoise(z,1800,seed+301)-.5)*160+(routeNoise(z,5200,seed+302)-.5)*300,
    y:(routeNoise(z,4200,seed+303)-.5)*44+(routeNoise(z,7300,seed+304)-.5)*32};
}
export function regionAt(z: number, seed: number) {
  const id = Math.floor(z / REGION_LENGTH), t = quintic((z - id * REGION_LENGTH) / 2400);
  const forest = (i: number) => .55 + randomAt(i, seed + 13) * .4;
  const ridge = (i: number) => 70 + randomAt(i, seed + 27) * 280;
  return { id, forest: forest(id - 1) * (1 - t) + forest(id) * t, ridge: ridge(id - 1) * (1 - t) + ridge(id) * t };
}
/** Coarse landscape preview exists independently of road proposals. */
export function naturalHeight(x: number, z: number, seed: number) {
  const base = baseline(z, seed), offset = x - base.x;
  // Broad coherent shoulders/ridges break the former uniform bowl, while the
  // valley floor stays unchanged for the accepted route and river contracts.
  const relief = Math.abs(offset)<=65?0:(landscapeNoise(x / 550, z / 700, seed + 211)-.5)*85
    +(landscapeNoise(x / 210, z / 330, seed + 212)-.5)*24;
  const uplands=smooth((Math.abs(offset)-180)/800);
  const crest=1-Math.abs(landscapeNoise(x/900,z/1300,seed+213)*2-1);
  const secondary=1-Math.abs(landscapeNoise(x/430,z/850,seed+214)*2-1);
  const peak=.5+1.65*crest*crest+.28*secondary*secondary*crest;
  return base.y - 2 + regionAt(z, seed).ridge * (1 - Math.exp(-offset * offset / 180000))*(1-uplands+peak*uplands)
    + relief * smooth((Math.abs(offset) - 65) / 270)
    + 2 * Math.sin(x / 150 + z / 230) + 8 * Math.sin(x / 170 + z / 370) * smooth(Math.abs(offset) / 180);
}
function carveRiver(raw:number,x:number,river:{x:number;y:number;halfWidth:number}){
 const distance=Math.abs(x-river.x),channelDistance=distance*13/river.halfWidth;
 const bed=river.y-1.8+2.2*smooth((channelDistance-5)/10)+Math.max(0,channelDistance-15)*.18;
 const blend=1-smooth((distance-river.halfWidth*15/13)/125);return raw*(1-blend)+bed*blend;
}
export function landscapeHeight(x:number,z:number,seed:number){return carveRiver(naturalHeight(x,z,seed),x,riverChannelAt(z,seed));}
export type RouteStyle = 'hillside'|'valley'|'contour'|'bench'|'pass'|'ridge';
export interface RoadPlan { index:number;seed:number;bend:number;fallback:boolean;attempts:number;style:RouteStyle; }
type Anchor={offset:number;style:RouteStyle};
const anchors=new Map<string,Anchor>(),plans=new Map<string,RoadPlan>();
const quintic=(t:number)=>{t=clamp(t);return t*t*t*(t*(t*6-15)+10);};
function routeAnchor(index:number,seed:number):Anchor {
  const key=`${seed}:${index}`,stored=anchors.get(key);if(stored)return stored;
  const z=index*PLAN_LENGTH,region=regionAt(z+1200,seed);
  // Composition weights are tempered by geography: lower saddles support
  // passes, sheltered steep valley flanks favour contour/bench construction.
  const saddle=region.ridge<Math.min(regionAt(z-3000,seed).ridge,regionAt(z+3000,seed).ridge);
  const weights=[.35,.25,.20,.10,saddle?.075:.035,region.ridge>180?.065:.035];
  let pick=randomAt(index,seed+310)*weights.reduce((a,b)=>a+b,0),slot=0;
  while(slot<5&&pick>=weights[slot])pick-=weights[slot++];
  const style=(['hillside','valley','contour','bench','pass','ridge'] as const)[slot];
  const target={hillside:65,valley:3,contour:110,bench:48,pass:150,ridge:165}[style]*(.85+.3*randomAt(index,seed+313));
  // Side persists over several regions, instead of alternating every bend.
  const side=routeNoise(z,22000,seed+312)<.5?-1:1;
  let offset=0,best=Infinity;
  for(let distance=0;distance<=450;distance+=30){
    let maximum=0,grade=0,bankPenalty=0;
    // Check the neighbouring flanks as well as the anchor. Regional ridge
    // height changes must not turn a modest gateway offset into a steep climb.
    for(let dz=-1200;dz<=1200;dz+=400){
      const at=z+dz,spine=baseline(at,seed),x=spine.x+side*distance;
      const water=riverChannelAt(at,seed);bankPenalty=Math.max(bankPenalty,Math.max(0,water.halfWidth+24-Math.abs(x-water.x)));
      maximum=Math.max(maximum,naturalHeight(x,at,seed)-spine.y);
      grade=Math.max(grade,Math.abs(naturalHeight(baseline(at+100,seed).x+side*distance,at+100,seed)-naturalHeight(baseline(at-100,seed).x+side*distance,at-100,seed))/200);
    }
    const cost=Math.abs(maximum-target)+Math.max(0,grade-.048)*4500+bankPenalty*1.6;
    if(cost<best){best=cost;offset=side*distance;}
    if(style==='valley'&&distance>=60)break;
  }
  const anchor={offset,style};anchors.set(key,anchor);if(anchors.size>128)anchors.delete(anchors.keys().next().value!);return anchor;
}
function plannedX(z:number,seed:number,bend:number,index:number){
  const t=(z-index*PLAN_LENGTH)/PLAN_LENGTH,a=routeAnchor(index,seed),b=routeAnchor(index+1,seed);
  // Shared geographic anchors retain hillside altitude at joins. C2 curves
  // blend across six kilometres; optional gentle arcs follow the local flank.
    const mountain=(a.style==='pass'||a.style==='ridge')&&randomAt(index,seed+315)<.55;
  const u=mountain?(t-.27)/.46:t;
  const arc=u>0&&u<1?Math.sin(Math.PI*u)**4*(mountain?1+.22*Math.sin(Math.PI*2*u):1):0;
  return baseline(z,seed).x+a.offset+(b.offset-a.offset)*quintic(t)+bend*arc;
}
export function planRoad(index:number,seed:number,rejectAll=false):RoadPlan {
  const style=routeAnchor(index,seed).style;
  const desired=(randomAt(index,seed+314)-.5)*(style==='valley'?50:style==='pass'||style==='ridge'?700:320);
  const candidates=[desired,desired*.65,desired*.3,0];
  for(let attempt=0;attempt<candidates.length;attempt++){
    const bend=candidates[attempt];let valid=!rejectAll;
    for(let step=0;valid&&step<=60;step++){
      const z=index*PLAN_LENGTH+step*100,x=plannedX(z,seed,bend,index),a=plannedX(z-1,seed,bend,index),b=plannedX(z+1,seed,bend,index);
      const grade=(naturalHeight(plannedX(z+200,seed,bend,index),z+200,seed)-naturalHeight(plannedX(z-200,seed,bend,index),z-200,seed))/400;
      if(Math.abs(grade)>.085||Math.abs(b-2*x+a)>1/500)valid=false;
      const river=riverChannelAt(z,seed);
      if(Math.abs(x-river.x)<river.halfWidth+3.4&&Math.abs((b-a-riverChannelAt(z+1,seed).x+riverChannelAt(z-1,seed).x)/2)<.08)valid=false;
    }
    if(valid)return {index,seed,bend,fallback:false,attempts:attempt+1,style};
  }
  return {index,seed,bend:0,fallback:true,attempts:4,style};
}
function horizontalPoint(z:number,seed:number){
  const index=Math.floor(z/PLAN_LENGTH),key=`${seed}:${index}`;let plan=plans.get(key);
  if(!plan){plan=planRoad(index,seed);plans.set(key,plan);if(plans.size>128)plans.delete(plans.keys().next().value!);}
  return plannedX(z,seed,plan.bend,index);
}
// A bounded uniform cubic B-spline follows the proposed terrain profile. It
// smooths local elevation noise with C2 crest/sag curves, not a flat road or
// an integration history that could break seeded backward regeneration.
const heights=new Map<string,number>(),limitedHeights=new Map<string,number>();
const PROFILE_STEP=800;
function rawProfileHeight(station:number,seed:number){
  const key=`${seed}:${station}`;let height=heights.get(key);
  if(height===undefined){const z=station*PROFILE_STEP;height=naturalHeight(horizontalPoint(z,seed),z,seed)+2;heights.set(key,height);if(heights.size>512)heights.delete(heights.keys().next().value!);}
  return height;
}
function profileHeight(station:number,seed:number){
 const key=`${seed}:${station}`,stored=limitedHeights.get(key);if(stored!==undefined)return stored;
 // Bounded Lipschitz envelopes limit vertical engineering grade before C2
 // interpolation, independently of traversal/cache order. The 16km neighbourhood
 // exceeds the maximum elevation range of these flank candidates.
 let lower=-Infinity,upper=Infinity;
 for(let d=-10;d<=10;d++){const raw=rawProfileHeight(station+d,seed),rise=Math.abs(d)*PROFILE_STEP*.055;lower=Math.max(lower,raw-rise);upper=Math.min(upper,raw+rise);}
 const value=(lower+upper)/2;limitedHeights.set(key,value);if(limitedHeights.size>512)limitedHeights.delete(limitedHeights.keys().next().value!);return value;
}
function basePoint(z:number,seed:number){
  const u=z/PROFILE_STEP,i=Math.floor(u),t=u-i,t2=t*t,t3=t2*t;
  const y=((1-t)**3*profileHeight(i-1,seed)+(3*t3-6*t2+4)*profileHeight(i,seed)+(-3*t3+3*t2+3*t+1)*profileHeight(i+1,seed)+t3*profileHeight(i+2,seed))/6;
  return {x:horizontalPoint(z,seed),y};
}
export interface TunnelPlan {start:number;end:number;center:number;cutStart:number;cutEnd:number;depth:number;}
const tunnels=new Map<string,TunnelPlan|undefined>();
function depression(z:number,t:TunnelPlan){const u=(z-t.cutStart)/(t.cutEnd-t.cutStart);return u>0&&u<1?t.depth*Math.sin(Math.PI*u)**4:0;}
/** A bored cutting crosses the existing flank; its roof is original natural terrain.
 * Candidate excavation and C2 approaches are bounded and order-independent. */
export function tunnelPlan(index:number,seed:number):TunnelPlan|undefined {
 const key=`${seed}:${index}`;if(tunnels.has(key))return tunnels.get(key);
 let chosen:TunnelPlan|undefined;
 if(routeAnchor(index,seed).style!=='valley'&&randomAt(index,seed+370)<.24){
  let best=-Infinity;
  for(const shift of [-600,0,600]){
   const center=index*PLAN_LENGTH+3000+shift,depth=15+randomAt(index,seed+371)*3;
   const t:TunnelPlan={center,depth,cutStart:center-1200,cutEnd:center+1200,start:0,end:0};
   const cover=(at:number)=>{const b=basePoint(at,seed);return Math.min(landscapeHeight(b.x-7,at,seed),landscapeHeight(b.x,at,seed),landscapeHeight(b.x+7,at,seed))-b.y+depression(at,t);};
   if(cover(center)<9)continue;
   let start=center,end=center;
   while(start>center-300&&cover(start-10)>=7.5)start-=10;
   while(end<center+300&&cover(end+10)>=7.5)end+=10;
   if(end-start<120)continue;
   // Never bore through the river bed or replace an existing bridge.
   let safe=true,score=0;
   for(let at=t.cutStart;at<=t.cutEnd;at+=50){const b=basePoint(at,seed),river=riverChannelAt(at,seed);
    if(Math.abs(b.x-river.x)<river.halfWidth+20||b.y-depression(at,t)<river.y+4)safe=false;
    const a=basePoint(at-2,seed),c=basePoint(at+2,seed);
    if(Math.abs((c.y-depression(at+2,t)-a.y+depression(at-2,t))/4)>.065)safe=false;
   }
   score=cover(center);if(safe&&score>best){best=score;chosen={...t,start,end};}
  }
 }
 tunnels.set(key,chosen);if(tunnels.size>128)tunnels.delete(tunnels.keys().next().value!);return chosen;
}
export function tunnelAt(z:number,seed:number){const t=tunnelPlan(Math.floor(z/PLAN_LENGTH),seed);return t&&z>=t.start&&z<=t.end?t:undefined;}
export function tunnelEnclosure(x:number,z:number,seed:number,y?:number){const t=tunnelAt(z,seed);if(!t||Math.abs(x-horizontalPoint(z,seed))>5.5||(y!==undefined&&(y<roadAt(z,seed).y-1||y>roadAt(z,seed).y+6)))return 0;return smooth((z-t.start)/30)*smooth((t.end-z)/30);}
function point(z:number,seed:number){const b=basePoint(z,seed),t=tunnelPlan(Math.floor(z/PLAN_LENGTH),seed);return {x:b.x,y:b.y-(t?depression(z,t):0)};}
/** Conservative swept tuft disk, including curvature, blade lean and wind. */
export function vegetationClearOfRoad(x:number,z:number,radius:number,seed:number){
  const side=Math.sign(x-horizontalPoint(z,seed));
  for(const at of [z-radius,z,z+radius]){
    const width=bridgeAt(at,seed).active?BRIDGE_HALF_WIDTH:roadShoulderWidth(at,seed,side);
    if(Math.abs(x-horizontalPoint(at,seed))<=width+radius+.3)return false;
  }
  return true;
}
const roadSamples=new Map<string,ReturnType<typeof sampleRoad>>();
function sampleRoad(z:number,seed:number){
  const p = point(z, seed), a = point(z - .5, seed), b = point(z + .5, seed);
  const dx = b.x - a.x, grade = b.y - a.y, curvature = (b.x - 2 * p.x + a.x) * 4 / (1 + dx * dx) ** 1.5;
  return { ...p, z, dx, grade, heading: Math.atan(dx), curvature, bank: clamp(curvature * 55, -.045, .045) };
}
export function roadAt(z:number,seed:number){
  // Reuse shared mesh/normal stations; continuous tire/recovery queries should
  // not churn string-keyed caches every simulation step.
  if(!Number.isInteger(z*2))return sampleRoad(z,seed);
  const key=`${seed}:${z}`;let p=roadSamples.get(key);
  if(!p){p=sampleRoad(z,seed);roadSamples.set(key,p);if(roadSamples.size>4096)roadSamples.delete(roadSamples.keys().next().value!);}
  return p;
}
/** Valley drainage is independent of the road's climbs and contour traverses. */
export function riverChannelAt(z:number,seed:number){
  const station=(i:number)=>i*REGION_LENGTH+1200+randomAt(i,seed+221)*3600;
  let i=Math.floor(z/REGION_LENGTH);if(z<station(i))i--;
  const a=station(i),b=station(i+1),t=(z-a)/(b-a),base=baseline(z,seed);
  const envelope=Math.tanh((z-a)/175)*Math.tanh((b-z)/175);
  const width=5.5+8*routeNoise(z,1100,seed+223)+3*routeNoise(z,320,seed+224);
  const meander=(routeNoise(z,650,seed+225)-.5)*45;
  const amplitude=125+(randomAt(i,seed+226)*(1-t)+randomAt(i+1,seed+226)*t)*55;
  const across=(i%2===0?1:-1)*(amplitude+meander)*envelope;
  // The gently graded valley has local watershed divides. Flow follows the
  // water-level gradient, not the direction or elevation of the highway.
  return {x:base.x+across,y:base.y-6,halfWidth:width,reach:i,t};
}
type Crossing={z:number;span:number;start:number;end:number};
const crossings=new Map<string,Crossing[]>();
function crossingsIn(index:number,seed:number){
  const key=`${seed}:${index}`,stored=crossings.get(key);if(stored)return stored;
  const values:Crossing[]=[],start=index*REGION_LENGTH;
  const delta=(z:number)=>horizontalPoint(z,seed)-riverChannelAt(z,seed).x;
  const wet=(z:number)=>{
    const river=riverChannelAt(z,seed),x=horizontalPoint(z,seed),gap=Math.abs(x-river.x)-river.halfWidth;
    if(gap<6)return true;
    if(gap>=100)return false;
    const p=basePoint(z,seed);
    // A high river-bank road cannot meet its channel with a narrow soil wall.
    // Require a supported span until a stable battered approach fits the bank.
    const edge=p.x+Math.sign(river.x-p.x)*5.7;
    const depth=p.y-carveRiver(naturalHeight(edge,z,seed),edge,river);
    return depth>2&&gap<Math.min(100,10+depth*2.2);
  };
  const add=(z:number,root=false)=>{
    const existing=values.find(c=>z>=c.start&&z<=c.end);
    if(existing){if(root)existing.z=z;return;}
    // Measure the actual overlap rather than dividing by a nearly tangent
    // derivative. Independent dry endpoints prevent kilometre overestimates.
    let lo=z,hi=z;
    while(wet(lo)&&z-lo<REGION_LENGTH)lo-=10;
    while(wet(hi)&&hi-z<REGION_LENGTH)hi+=10;
    const from=Math.floor((Math.min(lo,z-(BRIDGE_HALF_SPAN-10))-10)/ROAD_STEP)*ROAD_STEP;
    const to=Math.ceil((Math.max(hi,z+(BRIDGE_HALF_SPAN-10))+10)/ROAD_STEP)*ROAD_STEP;
    if(z>=start&&z<start+REGION_LENGTH){
      const overlaps=values.filter(c=>c.start<=to&&c.end>=from);
      const left=Math.min(from,...overlaps.map(c=>c.start)),right=Math.max(to,...overlaps.map(c=>c.end));
      // Overlapping bank/crossing proposals form one continuous supported reach.
      const centre=root?z:[z,...overlaps.map(c=>c.z)].sort((a,b)=>Math.abs(delta(a))-Math.abs(delta(b)))[0];
      for(const item of overlaps)values.splice(values.indexOf(item),1);
      values.push({z:centre,span:right-left,start:left,end:right});
    }
  };
  // Include grazing contacts (no sign change), but preserve true roots. Scan
  // neighbouring reaches so a boundary cannot truncate an oblique bridge.
  let a=start,da=delta(a);
  for(let b=a+25;b<=start+REGION_LENGTH;b+=25){
    const db=delta(b);
    if(da*db<0){let lo=a,hi=b,dl=da;for(let n=0;n<20;n++){const mid=(lo+hi)/2,dm=delta(mid);if(dl*dm<=0)hi=mid;else{lo=mid;dl=dm;}}add((lo+hi)/2,true);}
    else if(wet(b))add(b);
    a=b;da=db;
  }
  crossings.set(key,values);if(crossings.size>32)crossings.delete(crossings.keys().next().value!);return values;
}
const riverSamples=new Map<string,ReturnType<typeof sampleRiver>>();
function sampleRiver(z:number,seed:number){
  const index=Math.floor(z/REGION_LENGTH);let nearest:Crossing|undefined,distance=Infinity,best=Infinity;
  for(let i=index-1;i<=index+1;i++)for(const item of crossingsIn(i,seed)){const d=Math.abs(z-item.z),outside=Math.max(item.start-z,z-item.end,0),cost=outside;
    // Prefer the containing deck when adjacent/grazing intervals overlap.
    if(cost<best||(cost===best&&d<distance)){best=cost;nearest=item;distance=d;}}
  return {...riverChannelAt(z,seed),crossing:nearest?.z??z,distance,span:nearest?.span??60,bridgeStart:nearest?.start??z,bridgeEnd:nearest?.end??z};
}
export function riverAt(z:number,seed:number){
  if(!Number.isInteger(z*2))return sampleRiver(z,seed);
  const key=`${seed}:${z}`;let river=riverSamples.get(key);
  if(!river){river=sampleRiver(z,seed);riverSamples.set(key,river);if(riverSamples.size>2048)riverSamples.delete(riverSamples.keys().next().value!);}
  return river;
}
export interface ViaductPlan {start:number;end:number;depth:number;}
const viaductPlans=new Map<string,ViaductPlan[]>();
/** Select short unsupported dry spans; do not replace ordinary sidehill fills.
 * Coarse proposals and bounded local searches run once per cached route region. */
export function viaductsIn(index:number,seed:number){
 const key=`${seed}:${index}`,stored=viaductPlans.get(key);if(stored)return stored;
 const start=index*REGION_LENGTH,values:ViaductPlan[]=[];
 // Rejected long depressions overlap many proposals. Evaluate each20m support
 // station once per plan, instead of repeatedly resampling the same mountain.
 const sampled=new Map<number,number>();
 const rawDepth=(z:number)=>{const p=roadAt(z,seed),river=riverChannelAt(z,seed);
  if(Math.abs(p.grade)>.06||Math.abs(p.curvature)>1/450||tunnelAt(z,seed)||Math.abs(p.x-river.x)<river.halfWidth+12)return -Infinity;
  const ground=(x:number)=>carveRiver(naturalHeight(x,z,seed),x,river);
  const centre=p.y-ground(p.x);if(centre<2)return centre;
  return Math.min(centre,p.y-ground(p.x-5),p.y-ground(p.x+5));
 };
 const depth=(z:number)=>{if(sampled.has(z))return sampled.get(z)!;const value=rawDepth(z);sampled.set(z,value);return value;};
 for(let z=start+100;z<start+REGION_LENGTH;z+=200){
  if(values.some(v=>z>=v.start&&z<=v.end)||depth(z)<9)continue;
  let lo=z,hi=z;while(z-lo<2400&&depth(lo)>2)lo-=20;while(hi-z<2400&&depth(hi)>2)hi+=20;
  if(hi-lo<60||hi-lo>2400||depth(lo)>2||depth(hi)>2)continue;
  values.push({start:lo,end:hi,depth:depth(z)});
 }
 values.sort((a,b)=>a.start-b.start);
 viaductPlans.set(key,values);if(viaductPlans.size>64)viaductPlans.delete(viaductPlans.keys().next().value!);return values;
}
const bridgeSamples=new Map<string,ReturnType<typeof sampleBridge>>(),bridgeEligibility=new Map<string,boolean>();
function sampleBridge(z: number, seed: number) {
  const river=riverAt(z,seed),key=`${seed}:${river.crossing}`;let eligible=bridgeEligibility.get(key);
  if(eligible===undefined){const p=roadAt(river.crossing,seed);eligible=Number.isFinite(river.distance)&&Math.abs(p.grade)<.07&&Math.abs(p.curvature)<1/150;bridgeEligibility.set(key,eligible);if(bridgeEligibility.size>128)bridgeEligibility.delete(bridgeEligibility.keys().next().value!);}
  let start=river.bridgeStart,end=river.bridgeEnd,crossing=river.crossing,kind:'river'|'viaduct'='river';
  const riverActive=eligible&&z>=start&&z<=end;
  if(!riverActive){const index=Math.floor(z/REGION_LENGTH),local=z-index*REGION_LENGTH;
    let nearest=eligible?Math.max(start-z,z-end,0):Infinity;
    for(const i of [index,...(local<2400?[index-1]:[]),...(local>REGION_LENGTH-2400?[index+1]:[])])for(const v of viaductsIn(i,seed)){
      const distance=Math.max(v.start-z,z-v.end,0);if(distance<nearest){nearest=distance;start=v.start;end=v.end;crossing=(start+end)/2;kind='viaduct';eligible=true;}
    }
  }
  return {active:eligible&&z>=start&&z<=end,crossing,span:end-start,start,end,eligible,kind};
}
export function bridgeAt(z:number,seed:number){
 if(!Number.isInteger(z*2))return sampleBridge(z,seed);
 const key=`${seed}:${z}`;let bridge=bridgeSamples.get(key);if(!bridge){bridge=sampleBridge(z,seed);bridgeSamples.set(key,bridge);if(bridgeSamples.size>2048)bridgeSamples.delete(bridgeSamples.keys().next().value!);}return bridge;
}
/** Slabs continue into their buried abutments; not an extra span over open ground. */
export function deckAt(z:number,seed:number){const b=bridgeAt(z,seed);return b.eligible&&z>=b.start-10&&z<=b.end+10;}
export function terrainHeight(x: number, z: number, seed: number): number {
  const road=roadAt(z,seed),distance=Math.abs(x-road.x),river=riverChannelAt(z,seed);
  // Shape the valley first. Applying a broad river carve after construction
  // pulled the first roadside column down into an almost vertical soil wall.
  const raw=carveRiver(naturalHeight(x,z,seed),x,river),level=road.y+(x-road.x)*road.bank-.018*distance;
  const depth=level-raw,uphill=depth<0;
  const cutReach=clamp(16+Math.max(0,-depth)*.9,16,44);
  const fillReach=clamp(36+Math.max(0,depth)*1.2,36,60);
  const gradeBlend=1-smooth((distance-5.7)/(uphill?cutReach:fillReach));
  // Outside the bounded construction envelope, bridge/tunnel planning cannot
  // affect the result. Distant vertices and cold off-road probes need no scan.
  if(gradeBlend===0)return raw;
  const bridge=bridgeAt(z,seed),deckGap=bridge.active?smooth(Math.min(z-bridge.start,bridge.end-z)/20):0;
  // Preserve the actual channel and a feathered shore, rather than allowing
  // engineered fill to bury water. Unsupported bank approaches are bridges.
  const channel=1-smooth((Math.abs(x-river.x)-river.halfWidth*1.15)/12);
  let conform=gradeBlend*(1-deckGap)*(1-channel);
  const tunnel=tunnelPlan(Math.floor(z/PLAN_LENGTH),seed);
  if(tunnel&&distance>5.7){const excavation=smooth((z-tunnel.start+30)/30)*smooth((tunnel.end+30-z)/30);conform*=1-excavation;}
  let height=raw*(1-conform)+(level-.06)*conform;
  // The entire fixed deck footprint remains below the structural slab, even
  // at grazing crossings/abutments. Only remove occluding bank terrain; never
  // raise a valley beneath a bridge or create grass-covered deck wedges.
  const abutment=bridge.eligible&&z>=bridge.start-10&&z<=bridge.end+10;
  if(distance<=5.700001)height=abutment?Math.min(height,level-.7):level-.06;
  return height;
}
export function nearestRoad(x: number, z: number, seed: number) {
  const initial=roadAt(z,seed),range=Math.abs(initial.x-x);
  // No closer point can have |delta Z| above the current Euclidean distance.
  // Bracket multiple local minima before bounded Newton/backtracking refinement.
  const cost=(at:number)=>{const p=roadAt(at,seed);return (p.x-x)**2+(at-z)**2;};
  const count=Math.min(64,Math.max(2,Math.ceil(range*2/100))),step=range*2/count;
  let bestZ=z,bestCost=range*range;
  for(let i=0;i<=count;i++){
    let at=z-range+step*i,value=cost(at);
    if(value>bestCost+step*step)continue;
    for(let iteration=0;iteration<12;iteration++){
      const p=roadAt(at,seed),second=p.curvature*(1+p.dx*p.dx)**1.5;
      const gradient=(p.x-x)*p.dx+at-z,curvature=1+p.dx*p.dx+(p.x-x)*second;
      let move=clamp(gradient/Math.max(.2,curvature),-100,100);
      let next=clamp(at-move,z-range,z+range),nextCost=cost(next);
      for(let back=0;back<6&&nextCost>value;back++){move*=.5;next=clamp(at-move,z-range,z+range);nextCost=cost(next);}
      if(nextCost>value||Math.abs(next-at)<.00001)break;
      at=next;value=nextCost;
    }
    if(value<bestCost){bestZ=at;bestCost=value;}
  }
  return roadAt(bestZ,seed);
}
export function roadSurface(z: number, seed: number) {
  const start = Math.floor(z / ROAD_STEP) * ROAD_STEP;
  const a = roadAt(start, seed), b = roadAt(start + ROAD_STEP, seed), t = (z - start) / ROAD_STEP;
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, bank: a.bank + (b.bank - a.bank) * t };
}
