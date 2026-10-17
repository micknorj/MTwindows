export interface BodyBox { centre: [number, number, number]; halfExtents: [number, number, number]; }
export interface Obstacle { x: number; y: number; z: number; halfX: number; halfZ: number; height: number; heading: number; material?: 'stone' | 'wood' | 'metal'; }
export const DEFAULT_BODY: BodyBox[] = [{ centre: [0, .55, 0], halfExtents: [.98, .5, 2.4] }];

/** 2D SAT between the vehicle's oriented compound boxes and solid world proxies. */
export function penetration(x: number, y: number, z: number, heading: number, boxes: BodyBox[], obstacle: Obstacle) {
  const c = Math.cos(heading), s = Math.sin(heading), oc = Math.cos(obstacle.heading), os = Math.sin(obstacle.heading);
  for (const box of boxes) {
    if (y + box.centre[1] + box.halfExtents[1] < obstacle.y || y + box.centre[1] - box.halfExtents[1] > obstacle.y + obstacle.height) continue;
    const dx = x + c * box.centre[0] + s * box.centre[2] - obstacle.x;
    const dz = z - s * box.centre[0] + c * box.centre[2] - obstacle.z;
    let depth = Infinity, nx = 0, nz = 0, separated = false;
    for (const [ax, az] of [[c, -s], [s, c], [oc, -os], [os, oc]]) {
      const radius = box.halfExtents[0] * Math.abs(ax * c - az * s) + box.halfExtents[2] * Math.abs(ax * s + az * c)
        + obstacle.halfX * Math.abs(ax * oc - az * os) + obstacle.halfZ * Math.abs(ax * os + az * oc);
      const distance = dx * ax + dz * az, overlap = radius - Math.abs(distance);
      if (overlap <= 0) { separated = true; break; }
      if (overlap < depth) { depth = overlap; nx = ax * (distance < 0 ? -1 : 1); nz = az * (distance < 0 ? -1 : 1); }
    }
    if (!separated) {
      // Clip the real overlapping footprints. A nearest point to the root
      // misses front-corner wall contacts and creates the wrong yaw impulse.
      let polygon:[number,number][]=[];
      for(const [sx,sz] of [[-1,-1],[1,-1],[1,1],[-1,1]]){
        const vx=dx+c*sx*box.halfExtents[0]+s*sz*box.halfExtents[2];
        const vz=dz-s*sx*box.halfExtents[0]+c*sz*box.halfExtents[2];
        polygon.push([vx*oc-vz*os,vx*os+vz*oc]);
      }
      for(const [axis,sign,extent] of [[0,1,obstacle.halfX],[0,-1,obstacle.halfX],[1,1,obstacle.halfZ],[1,-1,obstacle.halfZ]]){
        const clipped:[number,number][]=[];
        for(let i=0;i<polygon.length;i++){
          const a=polygon[i],b=polygon[(i+1)%polygon.length],da=sign*a[axis]-extent,db=sign*b[axis]-extent;
          if(da<=0)clipped.push(a);
          if((da<=0)!==(db<=0)){const t=da/(da-db);clipped.push([a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t]);}
        }
        polygon=clipped;
      }
      const lx=polygon.reduce((sum,p)=>sum+p[0],0)/Math.max(1,polygon.length);
      const lz=polygon.reduce((sum,p)=>sum+p[1],0)/Math.max(1,polygon.length);
      return { depth, nx, nz, x:obstacle.x+oc*lx+os*lz, z:obstacle.z-os*lx+oc*lz };
    }
  }
  return undefined;
}
