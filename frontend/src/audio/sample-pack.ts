/** Owner-confirmed game-use recording permission, 2026-10-15.
 * Exact accepted stereo float32 banks; no lossy conversion or pitch changes.
 */
export const ENGINE_ASSET = 'audio/rimmile-engine.bin';
export const ENGINE_HEADER = new TextEncoder().encode('RIMMILE-ENGINE-1\n');
export const ENGINE_BANKS = [
  {
    "id": "on-low",
    "rpm": 5300,
    "sha256": "79e8ae0ef62a4a02fff0be996f41f81a2419d2edd68fdeaea2907876af1824d7",
    "bytes": 1646364
  },
  {
    "id": "on-high",
    "rpm": 7700,
    "sha256": "64aa21133308cca2668daa90d6512e6433c136f37737b81799da8191f9b1457c",
    "bytes": 3825140
  },
  {
    "id": "off-low",
    "rpm": 6900,
    "sha256": "c02c89c58444743df8c9fc2b1783c0ce9e35fc0badf454236c9dfec3ac4abe5c",
    "bytes": 862092
  },
  {
    "id": "off-high",
    "rpm": 7900,
    "sha256": "699bcf5eebe2e8fd9884e1696fe057b81da82b43fd35dd0d7a8abb4fcf7b86c7",
    "bytes": 3598060
  }
] as const;
export async function unpackEngine(packed: Uint8Array<ArrayBuffer>) {
  if(packed.length>12*1024*1024)throw new Error('Engine resource too large');
  const reader=new Blob([packed]).stream().pipeThrough(new DecompressionStream('gzip')).getReader();
  const chunks:Uint8Array[]=[];let size=0;
  try { while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>12*1024*1024){await reader.cancel();throw new Error('Engine resource too large');}chunks.push(value);} }
  finally {reader.releaseLock();}
  const bytes=new Uint8Array(size);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.length;}
  if(!ENGINE_HEADER.every((value,i)=>bytes[i]===value))throw new Error('Invalid engine resource');
  at=ENGINE_HEADER.length;
  const layers=[];
  for(const bank of ENGINE_BANKS){
    const data=bytes.slice(at,at+bank.bytes);at+=bank.bytes;
    const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data)),value=>value.toString(16).padStart(2,'0')).join('');
    if(digest!==bank.sha256)throw new Error('Engine integrity check failed');
    layers.push({id:bank.id,rpm:bank.rpm,bytes:data.buffer});
  }
  if(at!==bytes.length)throw new Error('Unexpected engine resource data');
  return layers;
}
