import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
it('reviewed asset manifest matches each public file and excludes private media',()=>{
 const manifest=JSON.parse(readFileSync('assets/manifest.json','utf8'));
 expect(manifest.assets).toHaveLength(14);
 for(const entry of manifest.assets){
  expect(entry.file).toMatch(/^(textures\/.*\.webp|audio\/.*\.mp3|models\/rimmile-vehicle\.bin|audio\/rimmile-engine\.bin)$/);
  expect(entry.file).not.toMatch(/private|reference|wav|glb/i);
  expect(createHash('sha256').update(readFileSync('assets/'+entry.file)).digest('hex')).toBe(entry.sha256);
 }
});

it('distant trees begin beyond both headlight influence and nearby moon shadow coverage',async()=>{
 const {treeMiddleDistance}=await import('../../src/world/tree-config');
 const {CHASE}=await import('../../src/vehicle/config');
 for(const budget of [.65,.82,1])for(const height of [1,8,15,25,40])for(const scale of [.75,1,1.5])expect(treeMiddleDistance(height,scale,budget)-15-CHASE.distance).toBeGreaterThan(125);
});


it('finite-light guard preserves independent projector, shadow and lighting evaluation',async()=>{
 const {FINITE_LIGHTS_FRAGMENT,finiteSpotLightChunk}=await import('../../src/rendering/finite-lights');
 const {ShaderChunk}=await import('three');
 const before=ShaderChunk.lights_fragment_begin;
 const after=finiteSpotLightChunk();
 expect(FINITE_LIGHTS_FRAGMENT).toContain('mix(1.0, getShadow( directionalShadowMap');
 const start=after.indexOf('if ( directLight.visible ) { // rimmile finite-light begin');
 const end=after.indexOf('} // rimmile finite-light end');
 expect(start).toBeGreaterThan(after.indexOf('getSpotLightInfo( spotLight'));
 const guarded=after.slice(start,end);
 for(const operation of ['texture2D( spotLightMap','getShadow( spotShadowMap','RE_Direct( directLight'])expect(guarded).toContain(operation);
 // Removing only the guard reconstructs the vendor block byte-for-byte: no
 // attenuation/shadow/BRDF math, light loop or other light type is changed.
 expect(after.replace('\n\t\tif ( directLight.visible ) { // rimmile finite-light begin','').replace('\n\t\t} // rimmile finite-light end','')).toBe(before);
 expect(()=>finiteSpotLightChunk('changed vendor layout')).toThrow('Unsupported spotlight shader layout');
});


it('release targets the rimmile static Worker without changing asset paths or Pages base',()=>{
 const config=JSON.parse(readFileSync('wrangler.jsonc','utf8'));
 expect(config.name).toBe('rimmile');
 expect(config.assets).toEqual({directory:'./dist/cloudflare',html_handling:'none',not_found_handling:'none',run_worker_first:false});
 expect(config.workers_dev).toBe(true);
 expect(config).not.toHaveProperty('main');
 const vite=readFileSync('frontend/vite.config.ts','utf8');
 expect(vite).toContain("'/rimmile/'");
});


it('asset-first updates retain the published texture and ambience revision',async()=>{
 const {reviewedAssets}=await import('../../../scripts/asset-manifest.mjs');
 const previous=await reviewedAssets('assets/previous-manifest.json');
 expect(previous.revision).toBe('5626dc54408b6d1b39fa');expect(previous.entries).toHaveLength(12);
});

it('Pages assets retain the verified lowercase base and independent Worker configuration',()=>{
 const read=(name:string)=>readFileSync(name,'utf8');
 expect(read('scripts/asset-plugin.mjs')).toContain("pagesBase='/rimmile/'");expect(read('scripts/validate-build.mjs')).toContain('checkedPagesBase');
 for(const file of ['frontend/vite.config.ts','frontend/playwright.production.config.ts','frontend/playwright.release.config.ts']){expect(read(file)).toContain('/rimmile/');expect(read(file)).not.toContain('/Rimmile/');}
 expect(read('README.md')).toMatch(/^# Rimmile(?:\r?\n|$)/);
 expect(JSON.parse(read('wrangler.jsonc')).name).toBe('rimmile');
});

it('Pages metadata paths preserve case while local builds retain the verified default',async()=>{
 const {checkedPagesBase}=await import('../../../scripts/asset-manifest.mjs');
 expect(checkedPagesBase()).toBe('/rimmile/');expect(checkedPagesBase('')).toBe('/rimmile/');
 expect(checkedPagesBase('/Rimmile')).toBe('/Rimmile/');expect(checkedPagesBase('/')).toBe('/');
 for(const invalid of ['https://example.test/','//elsewhere/','/../','/a/./','/rimmile/?x=1','/rimmile/#x','/a\\b/'])expect(()=>checkedPagesBase(invalid)).toThrow('Pages base');
 const workflow=readFileSync('.github/workflows/pages.yml','utf8');
 expect(workflow).toContain('actions/configure-pages@v5');expect(workflow).toContain('enablement: false');expect(workflow).toContain('steps.pages.outputs.base_path');
});
