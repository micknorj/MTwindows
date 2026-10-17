import { generateChunk } from '../world/generate';
import { generateHorizon } from '../world/horizon';

self.onmessage = (event: MessageEvent<{ id: number; seed: number; token: number;horizon?:boolean }>) => {
  const { id, seed, token } = event.data;
  try {
    if(event.data.horizon){const horizon=generateHorizon(id,seed);self.postMessage({token,horizon},{transfer:[horizon.positions.buffer,horizon.normals.buffer,horizon.colors.buffer,...horizon.indices.map(array=>array.buffer)]});return;}
    const began=import.meta.env.DEV?performance.now():0;
    const data = generateChunk(id, seed);
    self.postMessage({ token, data,generationMs:import.meta.env.DEV?performance.now()-began:undefined }, { transfer: [data.excavation.buffer,data.structure.buffer,data.terrainFine.buffer,data.terrainBounds.buffer,data.tunnel.buffer,data.tunnelLamps.buffer,data.terrain.buffer, data.terrainNormals.buffer, data.colors.buffer, data.road.buffer, data.shoulder.buffer,data.shoulderColors.buffer, data.markings.buffer, data.water.buffer, data.waterColors.buffer, data.scenery.railPitch.buffer, ...Object.values(data.scenery.instances).map(array => array.buffer)] });
  } catch {
    self.postMessage({ token, failed: true });
  }
};
