import {mkdir,copyFile,writeFile,rm,readdir,readFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {reviewedAssets} from './asset-manifest.mjs';
const {manifest,entries,revision}=await reviewedAssets();
const previous=await reviewedAssets('assets/previous-manifest.json');
const output=resolve('dist/cloudflare');
if(output!==resolve('dist','cloudflare'))throw Error('Invalid output');
await rm(output,{recursive:true,force:true});await mkdir(output,{recursive:true});
for(const generation of [{entries,revision},previous])for(const entry of generation.entries){const to=resolve(output,'v',generation.revision,entry.file);await mkdir(dirname(to),{recursive:true});await copyFile(entry.source,to);}
const notices=['LICENSE','THIRD_PARTY_LICENSES.md','assets/textures/surfaces/sources.json','assets/audio/sources.json','assets/models/sources.json'];
for(const file of notices){const name=file==='assets/textures/surfaces/sources.json'?'poly-haven-sources.json':file==='assets/audio/sources.json'?'nature-sources.json':file==='assets/models/sources.json'?'vehicle-sources.json':file.split('/').pop();await copyFile(file,resolve(output,name));}
await mkdir(resolve(output,'licenses'),{recursive:true});
for(const name of await readdir('assets/licenses'))await copyFile(resolve('assets/licenses',name),resolve(output,'licenses',name));
const credits=(await readFile('THIRD_PARTY_LICENSES.md','utf8')).replaceAll('assets/licenses/','licenses/').replaceAll('assets/textures/surfaces/sources.json','poly-haven-sources.json').replaceAll('assets/audio/sources.json','nature-sources.json').replaceAll('assets/models/sources.json','vehicle-sources.json');
await writeFile(resolve(output,'THIRD_PARTY_LICENSES.md'),credits);
await writeFile(resolve(output,'manifest.json'),JSON.stringify({version:1,revision,assets:manifest.assets.map(e=>({...e,url:`v/${revision}/${e.file}`}))},null,2)+'\n');
await writeFile(resolve(output,'_headers'),`/*
  Access-Control-Allow-Origin: *
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer
  X-Robots-Tag: noindex
/v/*
  Cache-Control: public, max-age=31536000, immutable
/manifest.json
  Cache-Control: public, max-age=0, must-revalidate
`);
console.log(`Built ${entries.length} reviewed media assets, revision ${revision}; ${entries.reduce((n,e)=>n+e.bytes,0)} bytes current; previous asset revision retained; no raw source models or recordings.`);
