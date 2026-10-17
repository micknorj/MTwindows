import {readdir,readFile,copyFile,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {loadEnv} from 'vite';
import {reviewedAssets,hash,checkedPagesBase} from './asset-manifest.mjs';
export const walk=async dir=>(await Promise.all((await readdir(dir,{withFileTypes:true})).map(e=>e.isDirectory()?walk(path.join(dir,e.name)):path.join(dir,e.name)))).flat();
const output='dist/frontend';await mkdir(output+'/licenses',{recursive:true});
for(const file of await walk('assets/licenses'))await copyFile(file,output+'/licenses/'+path.basename(file));
await copyFile('LICENSE',output+'/LICENSE');await copyFile('THIRD_PARTY_LICENSES.md',output+'/THIRD_PARTY_LICENSES.md');
await writeFile(output+'/THIRD_PARTY_LICENSES.md',(await readFile('THIRD_PARTY_LICENSES.md','utf8')).replaceAll('assets/licenses/','licenses/').replaceAll('assets/textures/surfaces/sources.json','licenses/poly-haven-sources.json').replaceAll('assets/audio/sources.json','licenses/nature-sources.json').replaceAll('assets/models/sources.json','licenses/vehicle-sources.json'));
await copyFile('assets/textures/surfaces/sources.json',output+'/licenses/poly-haven-sources.json');await copyFile('assets/audio/sources.json',output+'/licenses/nature-sources.json');
await copyFile('assets/models/sources.json',output+'/licenses/vehicle-sources.json');
const files=await walk(output),{entries,revision}=await reviewedAssets();
for(const file of files){
 if(/\.(glb|gltf|fbx|blend|wav|png|map)$/i.test(file)||/model-optimization|audio-reference|mockup-reference|\.private/i.test(file))throw Error('Unapproved output: '+file);
 if(/\.(js|html|css)$/.test(file)){
  const source=await readFile(file,'utf8');
  if(/__rimmile|__local_vehicle|__local_engine|model-optimization|audio-reference|mockup-reference|sessionStorage|indexedDB|navigator\.serviceWorker|[A-Z]:[\\/]Users[\\/]/i.test(source))throw Error('Private/debug code in '+file);
 }
}
const media=files.filter(f=>/\.(webp|mp3|bin)$/.test(f));
if(media.length&&media.length!==entries.length)throw Error('Unexpected bundled game media');
for(const file of media){const id=path.relative(`${output}/game-assets/v/${revision}`,file).replaceAll('\\','/'),entry=entries.find(e=>e.id===id);if(!entry||hash(await readFile(file))!==entry.sha256)throw Error('Unreviewed bundled media');}
const allJs=(await Promise.all(files.filter(f=>f.endsWith('.js')).map(f=>readFile(f,'utf8')))).join('');
if(!media.length&&entries.some(e=>!allJs.includes(`/v/${revision}/${e.file}`)))throw Error('Missing cross-origin asset URL');
if(!files.some(f=>/world\.worker.*\.js$/.test(f))||!files.some(f=>/engine-processor.*\.js$/.test(f)))throw Error('Missing worker/worklet');
const sources=await walk('frontend/src');
for(const file of sources.filter(f=>/\.(ts|js)$/.test(f)))if(/localStorage/.test(await readFile(file,'utf8'))&&!['distance.ts','preferences.ts'].includes(path.basename(file)))throw Error('Unapproved storage owner: '+file);
const pagesBase=checkedPagesBase(process.env.VITE_PAGES_BASE_PATH??loadEnv('production',process.cwd(),'VITE_').VITE_PAGES_BASE_PATH);
const html=await readFile(output+'/index.html','utf8');if(!html.includes('<h1>Rimmile</h1>')||!html.includes(`${pagesBase}assets/`))throw Error('Wrong Pages identity/base');
console.log(`Validated ${files.length} frontend files, ${media.length?'local':'external'} approved media, notices, worker/worklet and private exclusions.`);
