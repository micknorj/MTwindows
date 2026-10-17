import {readdir,readFile,lstat} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {reviewedAssets,hash} from './asset-manifest.mjs';
const walk=async dir=>(await Promise.all((await readdir(dir,{withFileTypes:true})).map(e=>e.isDirectory()?walk(path.join(dir,e.name)):path.join(dir,e.name)))).flat();
const {entries,revision}=await reviewedAssets();
const previous=await reviewedAssets('assets/previous-manifest.json');
const permitted=name=>/^(frontend\/|assets\/|scripts\/|\.github\/workflows\/)/.test(name)||['.gitignore','.gitattributes','package.json','package-lock.json','LICENSE','THIRD_PARTY_LICENSES.md','README.md','SECURITY.md','wrangler.jsonc'].includes(name);
const textFile=name=>/\.(?:ts|mts|js|mjs|json|jsonc|html|css|md|ya?ml|txt)$/i.test(name)||['LICENSE','.gitignore','.gitattributes'].includes(name);
const git=args=>execFileSync('git',args,{encoding:'utf8'}).trim();
const indexed=git(['ls-files','-z']).split('\0').filter(Boolean),candidates=git(['ls-files','--cached','--others','--exclude-standard','-z']).split('\0').filter(Boolean);
const failures=[];
const deleted=new Set(git(['ls-files','--deleted','-z']).split('\0').filter(Boolean));
for(const name of new Set(candidates)){
 if(!permitted(name)||/(?:^|\/)(?:references|audio-reference|model-optimization)(?:\/|$)|\.env|\.pem|\.blend|\.glb|\.wav|\.private|node_modules|test-results|dist\//i.test(name)){failures.push('Non-public Git candidate: '+name);continue;}
 let info;try{info=await lstat(name);}catch{if(!deleted.has(name))failures.push('Stale indexed path: '+name);continue;}
 if(!info.isFile()||info.isSymbolicLink()){failures.push('Non-regular public file: '+name);continue;}
 if(!textFile(name)&&!entries.some(e=>name==='assets/'+e.file)){failures.push('Unreviewed public file type: '+name);continue;}
 if(/\.(webp|mp3|bin|wav|glb|blend|png|jpe?g|gif|mp4|zip|exe|dll)$/i.test(name)){const entry=entries.find(e=>name==='assets/'+e.file);if(!entry||hash(await readFile(name))!==entry.sha256)failures.push('Unreviewed public media: '+name);}
 if(textFile(name)){
  let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(await readFile(name));}catch{failures.push('Non-UTF-8 public text: '+name);continue;}
  if(/(?:[A-Z]:[\\/]Users[\\/]|\/Users\/|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|(?:gh[pousr]_|github_pat_)[a-zA-Z0-9_]{20,}|AIza[\w-]{30,})/.test(text))failures.push('Machine path/credential in '+name);
 }
}
for(const entry of git(['ls-files','--stage']).split('\n').filter(Boolean))if(!entry.startsWith('100644 ')&&!entry.startsWith('100755 '))failures.push('Non-regular staged entry: '+entry.split('\t').at(-1));
for(const name of indexed){
 if(!permitted(name))continue;
 if(/\.(?:glb|blend|wav|png|jpg|gif|mp4|zip|exe|dll)$/i.test(name))continue;
 let bytes;try{bytes=execFileSync('git',['show',':'+name],{maxBuffer:26*1024*1024});}catch{failures.push('Unable to inspect staged file: '+name);continue;}
 const asset=entries.find(e=>name==='assets/'+e.file);if(asset&&hash(bytes)!==asset.sha256)failures.push('Unreviewed staged asset: '+name);
 if(textFile(name)){
  let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{failures.push('Non-UTF-8 staged text: '+name);continue;}
  if(/(?:[A-Z]:[\\/]Users[\\/]|\/Users\/|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|(?:gh[pousr]_|github_pat_)[a-zA-Z0-9_]{20,}|AIza[\w-]{30,})/.test(text))failures.push('Unsafe staged content: '+name);
 }
}
if(process.argv.includes('--source-only')){if(failures.length)throw Error(failures.join('\n'));console.log(`Source/index audit passed: ${new Set(candidates).size} public candidates, ${indexed.length} staged files.`);process.exit(0);}
// Explicit allowlist applies to both outputs, including every non-media notice.
const cf=await walk('dist/cloudflare'),allowed=new Set([{entries,revision},previous].flatMap(generation=>generation.entries.map(e=>`v/${generation.revision}/${e.file}`)).concat(['manifest.json','_headers','LICENSE','THIRD_PARTY_LICENSES.md','poly-haven-sources.json','nature-sources.json','vehicle-sources.json']));
for(const name of await readdir('assets/licenses'))allowed.add('licenses/'+name);
for(const f of cf){const key=path.relative('dist/cloudflare',f).replaceAll('\\','/');if(!allowed.delete(key))failures.push('Unexpected Cloudflare output '+key);const entry=[{entries,revision},previous].flatMap(generation=>generation.entries.map(e=>({...e,key:`v/${generation.revision}/${e.file}`}))).find(e=>e.key===key);if(entry&&hash(await readFile(f))!==entry.sha256)failures.push('Asset output integrity mismatch');}
if(allowed.size)failures.push('Incomplete Cloudflare output');
const front=await walk('dist/frontend');
const frontFixed=new Set(['index.html','LICENSE','THIRD_PARTY_LICENSES.md','licenses/poly-haven-sources.json','licenses/nature-sources.json','licenses/vehicle-sources.json',...(await readdir('assets/licenses')).map(n=>'licenses/'+n)]);
for(const f of front){const key=path.relative('dist/frontend',f).replaceAll('\\','/');
 if(!frontFixed.has(key)&&!/^assets\/(?:index-[\w-]+\.(?:js|css)|(?:game|GLTFLoader|sample-engine)-[\w-]+\.js|world\.worker-[\w-]+\.js|engine-processor-[\w-]+\.js|playfair-display-latin-600-normal-[\w-]+\.woff2?)$/.test(key)&&!entries.some(e=>key===`game-assets/v/${revision}/${e.file}`))failures.push('Unexpected frontend output '+key);
}

for(const f of front)if(/\.private|reference|\.(wav|glb|blend|png|map)$/i.test(f))failures.push('Private frontend output '+f);
if(failures.length)throw Error(failures.join('\n'));
console.log(`Public-safe audit passed: ${new Set(candidates).size} Git candidates, ${indexed.length} indexed files, ${front.length} frontend files, ${cf.length} Cloudflare files (${entries.length} media).`);
