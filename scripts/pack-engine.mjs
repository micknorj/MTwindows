// Owner confirmed redistribution permission for these four recordings on
// 2026-10-15. Exact runtime banks only; private originals are never changed.
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {ENGINE_ASSET,ENGINE_HEADER,ENGINE_BANKS} from '../frontend/src/audio/sample-pack.ts';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex'),parts=[ENGINE_HEADER];
for(const bank of ENGINE_BANKS){
 const bytes=await readFile('.private/audio-reference/'+bank.id+'.wav');
 if(bytes.length!==bank.bytes||hash(bytes)!==bank.sha256)throw Error('Accepted engine bank changed: '+bank.id);
 parts.push(bytes);
}
const packed=gzipSync(Buffer.concat(parts),{level:9});await writeFile('assets/'+ENGINE_ASSET,packed);
const manifest=JSON.parse(await readFile('assets/manifest.json','utf8'));
const entry={id:ENGINE_ASSET,file:ENGINE_ASSET,bytes:packed.length,sha256:hash(packed),mime:'application/octet-stream',license:'Owner-Confirmed-Recording-Permission'};
const index=manifest.assets.findIndex(asset=>asset.id===ENGINE_ASSET);
if(index<0)manifest.assets.push(entry);else manifest.assets[index]=entry;
await writeFile('assets/manifest.json',JSON.stringify(manifest,null,2)+'\n');
console.log(`Packaged accepted engine banks losslessly: ${packed.length} bytes; private recordings unchanged.`);
