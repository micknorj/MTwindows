import { deckAt, bridgeAt, roadAt, roadSurface, riverAt, riverChannelAt, ROAD_STEP, BRIDGE_HALF_WIDTH, roadShoulderWidth,tunnelAt,landscapeHeight } from './road';
import { terrainMeshHeight } from './terrain-grid';

/** Exact exterior roof quad split; the hollow floor remains a separate surface. */
export function tunnelRoofHeight(x:number,z:number,seed:number){
 const start=Math.floor(z/10)*10,t=(z-start)/10,a=roadAt(start,seed),b=roadAt(start+10,seed);
 const left=a.x-7+(b.x-a.x)*t,right=left+14,diagonal=a.x+7+(b.x-a.x-14)*t;
 const al=landscapeHeight(a.x-7,start,seed),ar=landscapeHeight(a.x+7,start,seed),bl=landscapeHeight(b.x-7,start+10,seed),br=landscapeHeight(b.x+7,start+10,seed);
 if(x<=diagonal){const beta=(x-left)/14;return al*(1-t-beta)+bl*t+ar*beta;}
 const gamma=(right-x)/14;return ar*(1-t)+bl*gamma+br*(t-gamma);
}
export function surfaceHeight(x: number, z: number, seed: number,body?:{x:number;y:number;z:number}) {
  const p = roadSurface(z, seed), lateral = x - p.x;
  const level=p.y+lateral*p.bank-.018*Math.abs(lateral),distance=Math.abs(lateral);
  // Select an actual contact layer. Below a deck, its river bed is ground;
  // above a bore, the original mountain roof supports the vehicle.
  if(body){
    if(body.y<level-.3&&bridgeAt(z,seed).active&&distance<=BRIDGE_HALF_WIDTH)return terrainMeshHeight(x,z,seed);
    if(body.y>level+5&&distance<=7&&tunnelAt(z,seed)){const roof=tunnelRoofHeight(body.x,body.z,seed);if(body.y>=roof-.3)return tunnelRoofHeight(x,z,seed);}
  }
  if(distance<=3.4)return level;
  if(deckAt(z,seed)&&distance<=BRIDGE_HALF_WIDTH)return level-.025;
  const start=Math.floor(z/ROAD_STEP)*ROAD_STEP,t=(z-start)/ROAD_STEP;
  const a=roadAt(start,seed),b=roadAt(start+ROAD_STEP,seed),side=Math.sign(lateral);
  const wa=deckAt(start,seed)?BRIDGE_HALF_WIDTH:roadShoulderWidth(start,seed,side),wb=deckAt(start+ROAD_STEP,seed)?BRIDGE_HALF_WIDTH:roadShoulderWidth(start+ROAD_STEP,seed,side),width=wa+(wb-wa)*t;
  if(distance>=width)return terrainMeshHeight(x,z,seed);
  const outerA=deckAt(start,seed)?a.y+side*wa*a.bank-.018*wa-.025:terrainMeshHeight(a.x+side*wa,start,seed);
  const outerB=deckAt(start+ROAD_STEP,seed)?b.y+side*wb*b.bank-.018*wb-.025:terrainMeshHeight(b.x+side*wb,start+ROAD_STEP,seed);
  return (level-.025)*(1-(distance-3.4)/(width-3.4))+(outerA+(outerB-outerA)*t)*(distance-3.4)/(width-3.4);
}
export function waterDepth(x: number, z: number, seed: number, bodyY = -Infinity) {
  const water = riverAt(z, seed);
  if (Math.abs(x - water.x) > water.halfWidth || (bridgeAt(z, seed).active && Math.abs(x - roadAt(z, seed).x) < BRIDGE_HALF_WIDTH&&(bodyY===-Infinity||bodyY>=water.y))) return 0;
  return Math.max(0, Math.min(water.y - bodyY, water.y - terrainMeshHeight(x, z, seed)));
}

/** Same five-metre interpolation as the visible water ribbon. */
export function waterSurfaceAt(x:number,z:number,seed:number){
  const start=Math.floor(z/ROAD_STEP)*ROAD_STEP,t=(z-start)/ROAD_STEP;
  const a=riverChannelAt(start,seed),b=riverChannelAt(start+ROAD_STEP,seed);
  const centre=a.x+(b.x-a.x)*t,width=a.halfWidth+(b.halfWidth-a.halfWidth)*t;
  if(Math.abs(x-centre)>=width-.15)return undefined;
  const y=a.y+(b.y-a.y)*t;
  return {y,depth:Math.max(0,y-terrainMeshHeight(x,z,seed))};
}
/** Flooded central chassis plus a majority of its footprint; banks and shallow
 * tires do not qualify. Transform actual runtime collision geometry in YXZ,
 * matching the vehicle visual, including roll/pitch rather than root Y alone. */
export function vehicleSubmerged(pose:{x:number;y:number;z:number;heading:number;pitch:number;roll:number},boxes:readonly import('../vehicle/collider').BodyBox[],seed:number){
  const river=riverChannelAt(pose.z,seed);
  if(pose.y-3>river.y||Math.abs(pose.x-river.x)>river.halfWidth+4)return false;
  let body=boxes[0],volume=0;
  for(const box of boxes){const size=box.halfExtents[0]*box.halfExtents[1]*box.halfExtents[2];if(size>volume){body=box;volume=size;}}
  if(!body)return false;
  const ch=Math.cos(pose.heading),sh=Math.sin(pose.heading),cp=Math.cos(pose.pitch),sp=Math.sin(pose.pitch),cr=Math.cos(pose.roll),sr=Math.sin(pose.roll);
  let wet=0;
  for(let i=0;i<5;i++){
    const lx=body.centre[0]+(i===0?0:(i<3?-1:1)*body.halfExtents[0]*.6);
    const ly=body.centre[1]-body.halfExtents[1]*.2;
    const lz=body.centre[2]+(i===0?0:(i%2===0?-1:1)*body.halfExtents[2]*.6);
    const rx=cr*lx-sr*ly,ry=sr*lx+cr*ly,py=cp*ry-sp*lz,pz=sp*ry+cp*lz;
    const x=pose.x+ch*rx+sh*pz,z=pose.z-sh*rx+ch*pz,y=pose.y+py;
    const water=waterSurfaceAt(x,z,seed),flooded=!!water&&water.depth>.7&&water.y>y;
    if(i===0&&!flooded)return false;
    if(flooded)wet++;
  }
  return wet>=3;
}

/** Soffit and longitudinal girders are real ceilings when exploring below spans. */
export function bridgeCeiling(x:number,z:number,seed:number,bodyY:number){
 const p=roadSurface(z,seed),offset=x-p.x;if(Math.abs(offset)>BRIDGE_HALF_WIDTH)return Infinity;
 const top=p.y+offset*p.bank-.018*Math.abs(offset);
 if(bodyY>=top-.3||!deckAt(z,seed))return Infinity;
 return top-(Math.abs(offset)>=2.15&&Math.abs(offset)<=3.05?1.25:.85);
}
