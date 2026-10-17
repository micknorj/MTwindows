import {reviewedAssets,checkedAssetBase,hash} from './asset-manifest.mjs';
const base=checkedAssetBase(process.env.VITE_ASSET_BASE_URL||process.argv[2]);
if(!base)throw Error('Set VITE_ASSET_BASE_URL to the asset origin');
const {entries,revision}=await reviewedAssets();
const previous=await reviewedAssets('assets/previous-manifest.json');
for(const generation of [{entries,revision},previous])for(const entry of generation.entries){
 const response=await fetch(`${base}/v/${generation.revision}/${entry.file}`,{signal:AbortSignal.timeout(30000)});
 if(!response.ok||response.headers.get('access-control-allow-origin')!=='*'||!response.headers.get('content-type')?.startsWith(entry.mime)||(!response.headers.get('cache-control')?.includes('immutable')||response.headers.get('x-content-type-options')!=='nosniff'))throw Error('Asset headers/request failed: '+entry.id);
 if(hash(Buffer.from(await response.arrayBuffer()))!==entry.sha256)throw Error('Remote asset integrity failed: '+entry.id);
}
const response=await fetch(base+'/manifest.json',{signal:AbortSignal.timeout(30000)});
if(!response.ok||!response.headers.get('content-type')?.startsWith('application/json')||response.headers.get('access-control-allow-origin')!=='*'||!response.headers.get('cache-control')?.includes('must-revalidate')||response.headers.get('x-content-type-options')!=='nosniff')throw Error('Remote manifest headers/request failed');
const remote=await response.json();
if(remote.version!==1||remote.revision!==revision||JSON.stringify(remote.assets)!==JSON.stringify(entries.map(({source,...entry})=>({...entry,url:`v/${revision}/${entry.file}`}))))throw Error('Remote manifest differs from reviewed assets');
console.log(`Verified ${entries.length} current cross-origin assets plus the previous generation, MIME, CORS, immutable cache and revision ${revision}.`);
