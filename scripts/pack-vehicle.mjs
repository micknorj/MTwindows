// Explicit authoring command only. Public game delivery was approved by the
// owner after source/license review. Never changes or publishes the raw masters.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createCipheriv,createHash} from 'node:crypto';
import {VEHICLE_ASSET,VEHICLE_SHA256,VEHICLE_HEADER,VEHICLE_KEY} from '../frontend/src/vehicle/package.ts';
const source=await readFile('model-optimization/optimized-car.glb');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
if(hash(source)!==VEHICLE_SHA256)throw Error('Protected optimized vehicle differs from the verified handoff');
// Content-derived unique IV makes the reviewed output reproducible. A changed
// source requires a newly reviewed hash and will have a different IV.
const iv=createHash('sha256').update('rimmile-game-resource-v1').update(source).digest().subarray(0,12);
const cipher=createCipheriv('aes-256-gcm',VEHICLE_KEY,iv);cipher.setAAD(VEHICLE_HEADER);
const output=Buffer.concat([VEHICLE_HEADER,iv,cipher.update(source),cipher.final(),cipher.getAuthTag()]);
await mkdir('assets/models',{recursive:true});await writeFile('assets/'+VEHICLE_ASSET,output);
const manifest=JSON.parse(await readFile('assets/manifest.json','utf8'));
const entry={id:VEHICLE_ASSET,file:VEHICLE_ASSET,sha256:hash(output),bytes:output.length,mime:'application/octet-stream',license:'CGTrader-Royalty-Free-No-AI'};
const index=manifest.assets.findIndex(asset=>asset.id===VEHICLE_ASSET);
if(index<0)manifest.assets.push(entry);else manifest.assets[index]=entry;
await writeFile('assets/manifest.json',JSON.stringify(manifest,null,2)+'\n');
console.log(`Packaged the verified optimized vehicle: ${output.length} bytes. Protected source unchanged.`);
