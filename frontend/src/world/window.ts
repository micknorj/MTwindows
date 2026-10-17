export const CHUNK_RADIUS = 12;
export const MAX_CHUNKS = CHUNK_RADIUS * 2 + 1;
/** Predictive preparation shifts the bounded window; it never shrinks detail. */
export function preparationCenter(z:number,speed:number,heading:number,viewZ=0){
  const lead=Math.max(-650,Math.min(650,Math.cos(heading)*speed*5+viewZ*120*Math.min(1,Math.abs(speed)/12)));
  return Math.floor((z+lead)/200);
}

export function chunkWindow(center: number): number[] {
  const ids = [center];
  for (let i = 1; i <= CHUNK_RADIUS; i++) ids.push(center + i, center - i);
  return ids;
}

export function originFor(x: number, z: number) {
  return { x: Math.floor(x / 1000) * 1000, z: Math.floor(z / 1000) * 1000 };
}
