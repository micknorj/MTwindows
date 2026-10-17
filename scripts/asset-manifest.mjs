import {readFile,realpath} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,relative,isAbsolute} from 'node:path';
export const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export async function reviewedAssets(manifestPath='assets/manifest.json'){
 const root=await realpath('assets'),manifest=JSON.parse(await readFile(manifestPath,'utf8'));
 if(manifest.version!==1||!Array.isArray(manifest.assets)||!manifest.assets.length)throw Error('Invalid public asset manifest');
 const seen=new Set(),entries=[];
 for(const entry of manifest.assets){
  if(entry.id!==entry.file||! /^(textures\/[a-z0-9_/-]+\.webp|audio\/[a-z0-9_-]+\.mp3|models\/rimmile-vehicle\.bin|audio\/rimmile-engine\.bin)$/.test(entry.file)||seen.has(entry.id))throw Error('Unapproved/duplicate public asset');
  seen.add(entry.id);const file=await realpath(resolve(root,entry.file)),within=relative(root,file);
  if(isAbsolute(within)||within.startsWith('..'))throw Error('Asset escaped reviewed root');
  const bytes=await readFile(file);
  if(bytes.length!==entry.bytes||hash(bytes)!==entry.sha256||bytes.length>25*1024*1024)throw Error('Asset integrity/size failed: '+entry.id);
  if(!['CC0-1.0','All Rights Reserved','CGTrader-Royalty-Free-No-AI','Owner-Confirmed-Recording-Permission'].includes(entry.license)||entry.mime!==(entry.file.endsWith('.bin')?'application/octet-stream':entry.file.endsWith('.mp3')?'audio/mpeg':'image/webp'))throw Error('Unreviewed asset rights/type');
  if(entry.file==='models/rimmile-vehicle.bin'&&entry.license!=='CGTrader-Royalty-Free-No-AI')throw Error('Vehicle license must remain CGTrader Royalty Free No AI');
  if(entry.file==='audio/rimmile-engine.bin'&&entry.license!=='Owner-Confirmed-Recording-Permission')throw Error('Engine recording permission must be preserved');
  entries.push({...entry,source:file});
 }
 if(manifestPath==='assets/manifest.json'&&['models/rimmile-vehicle.bin','audio/rimmile-engine.bin'].some(id=>!seen.has(id)))throw Error('Required vehicle/engine resource missing from public manifest');
 const revision=hash(Buffer.from(JSON.stringify(manifest))).slice(0,20);
 return {manifest,entries,revision};
}
export function checkedAssetBase(value){
 if(!value)return '';
 const url=new URL(value);
 if(url.username||url.password||url.search||url.hash||!(url.protocol==='https:'||url.protocol==='http:'&&['127.0.0.1','localhost'].includes(url.hostname)))throw Error('Asset URL must be HTTPS, or loopback HTTP for local verification');
 return url.href.replace(/\/$/,'');
}

// Default local/standalone prefix is independent of repository display casing.
// Release CI supplies the actual Pages metadata path, never a guessed repo name.
export function checkedPagesBase(value='/rimmile/'){
 const raw=value||'/rimmile/',base=raw.endsWith('/')?raw:raw+'/';
 if(!/^\/(?:[A-Za-z0-9_.~-]+\/)*$/.test(base)||base.split('/').some(part=>part==='.'||part==='..'))throw Error('Pages base must be an absolute path without query, fragment or traversal');
 return base;
}
