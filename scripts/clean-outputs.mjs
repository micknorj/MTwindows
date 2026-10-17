import {rm,readFile,realpath} from 'node:fs/promises';
import {resolve} from 'node:path';
// Only these reproducible outputs; never remove private resources or installed packages.
const root=await realpath('.');if(JSON.parse(await readFile(resolve(root,'package.json'),'utf8')).name!=='rimmile')throw Error('Run cleanup from the Rimmile root');
for(const name of ['dist','test-results','playwright-report','coverage','frontend/.vite','frontend/test-results','node_modules/.vite','node_modules/.vite-temp','.wrangler']){
 const target=resolve(root,name);if(!target.startsWith(root+'/')&&!target.startsWith(root+'\\'))throw Error('Unsafe output');
 let actual;try{actual=await realpath(target);}catch(error){if(error.code==='ENOENT')continue;throw error;}
 if(!actual.startsWith(root+'/')&&!actual.startsWith(root+'\\'))throw Error('Output resolves outside workspace');
 await rm(target,{recursive:true,force:true});
}
console.log('Removed reproducible build/test/cache outputs.');
