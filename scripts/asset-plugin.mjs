import {copyFile,mkdir,readFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {reviewedAssets,checkedAssetBase,checkedPagesBase} from './asset-manifest.mjs';
export async function publicAssetPlugin(build,base,pagesBase='/rimmile/'){
 const {entries,revision}=await reviewedAssets(),origin=checkedAssetBase(base),prefix=checkedPagesBase(pagesBase),virtual='virtual:rimmile-assets';
 const urls=Object.fromEntries(entries.map(e=>[e.id,build?`${origin||`${prefix}game-assets`}/v/${revision}/${e.file}`:`${origin?`${origin}/v/${revision}`:'/__public_assets'}/${e.file}`]));
 return {name:'reviewed-public-assets',resolveId(id){if(id===virtual)return '\0'+virtual;},load(id){if(id==='\0'+virtual)return `export default ${JSON.stringify(urls)};`;},
 configureServer(server){server.middlewares.use('/__public_assets',async(req,res)=>{
  const entry=entries.find(e=>'/'+e.file===req.url);if(req.method!=='GET'||!entry){res.writeHead(404).end();return;}
  try{res.writeHead(200,{'Content-Type':entry.mime,'Cache-Control':'no-cache'});res.end(await readFile(entry.source));}catch{res.writeHead(404).end();}
 });},
 async closeBundle(){if(!build||origin)return;
  for(const entry of entries){const to=resolve('dist/frontend/game-assets/v',revision,entry.file);await mkdir(dirname(to),{recursive:true});await copyFile(entry.source,to);}
 }};
}
