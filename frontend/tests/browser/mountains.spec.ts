import {expect,test} from './fixtures';
import type {Page} from '@playwright/test';
const snap=(page:Page)=>page.evaluate(()=>window.__rimmile.snapshot() as unknown as {state:string;y:number;x:number;z:number;distanceTravelled:number;handling:{grip:number;frontGrip:number;rearGrip:number};tunnel?:{start:number;end:number;center:number};recovery:{submerged:boolean;settling:number;seconds:number};audio?:{available:boolean;tunnelEnclosure:number;nodes:number;volumes:{engine:number;environment:number;master:number}}});
async function start(page:Page){await page.goto('/');await page.locator('#play').click();await expect(page.locator('#hud')).toBeVisible({timeout:60000});}
async function resume(page:Page){if(await page.locator('#settings-page').isVisible())await page.locator('#settings-back').click();await page.locator('#play').click();}
test.afterEach(async({page})=>{if(!page.isClosed())await page.evaluate(()=>window.dispatchEvent(new Event('pagehide')));});
test('handling defaults are neutral, apply immediately, stay inline and persist across reload',async({page})=>{
 await start(page);expect((await snap(page)).handling).toMatchObject({grip:1,frontGrip:1,rearGrip:1});
 await page.keyboard.press('Escape');await page.locator('#landing-settings').click();
 const region=await page.locator('.editorial-content').first().boundingBox();expect(region!.width).toBe(768);
 await page.locator('#handling-balance').fill('80');await page.locator('#handling-grip').fill('-70');
 const tuned=(await snap(page)).handling;expect(tuned.frontGrip).toBeGreaterThan(tuned.rearGrip);expect(tuned.grip).toBeLessThan(1);
 for(const id of ['handling-balance','handling-grip']){const row=page.locator(`#${id}`).locator('xpath=ancestor::div[contains(@class,"setting-row")]');const label=await row.locator('label').boundingBox(),control=await row.locator('.handling-control').boundingBox();expect(Math.abs(label!.y+label!.height/2-control!.y-control!.height/2)).toBeLessThan(2);expect(control!.x+control!.width).toBeCloseTo(region!.x+region!.width,0);}
 await page.reload();await page.locator('#landing-settings').click();await expect(page.locator('#handling-balance')).toHaveValue('80');await expect(page.locator('#handling-grip')).toHaveValue('-70');
});
test('distance survives reload, excludes inspection/recovery jumps and is unaffected by handling reset',async({page})=>{
 await start(page);await page.keyboard.press('Escape');
 await page.evaluate(()=>window.__rimmile.inspectDistance(20000));expect((await snap(page)).distanceTravelled).toBe(0);
 await resume(page);await page.keyboard.down('w');await page.waitForTimeout(1800);await page.keyboard.up('w');await page.keyboard.press('t');await page.keyboard.press('Escape');
 const saved=await page.evaluate(()=>Number(localStorage.getItem('rimmile.distance.metres')));expect(saved).toBeGreaterThan(1);expect(saved).toBeLessThan(100);
 await expect(page.locator('#distance-milestone')).toHaveText(`Distance driven · ${(saved/1000).toFixed(1)} km`);
 await page.reload();expect(await page.evaluate(()=>Number(localStorage.getItem('rimmile.distance.metres')))).toBe(saved);await expect(page.locator('#distance-milestone')).toBeHidden();
 await page.locator('#landing-about').click();await expect(page.locator('.about')).toContainText('Your preferences and total driving distance are saved only in this browser');await page.locator('#about-back').click();await page.locator('#landing-settings').click();await page.locator('#reset-handling').click();expect(await page.evaluate(()=>Number(localStorage.getItem('rimmile.distance.metres')))).toBe(saved);await expect(page.locator('#reset-distance')).toHaveCount(0);
});
test('tunnel entrances, interior and wall collision render without blocked road or shader failures',async({page})=>{
 test.setTimeout(180000);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});await start(page);
 const bore=await page.evaluate(async()=>{const path='/src/world/road.ts',{tunnelPlan}=await import(path);for(let i=0;i<100;i++){const t=tunnelPlan(i,1942);if(t)return t;}throw Error('No bore');});
 for(const z of [bore.start-35,bore.start+20,bore.center,bore.end-20,bore.end+35]){await page.evaluate(z=>window.__rimmile.inspectDistance(z),z);expect((await snap(page)).y).toBeGreaterThan(-100);await page.evaluate(()=>window.__rimmile.inspectFrame());}
 await page.evaluate(z=>window.__rimmile.inspectDistance(z),bore.center);await page.keyboard.press('Escape');await resume(page);await page.waitForTimeout(300);
 const inside=await snap(page);expect(inside.tunnel).toBeDefined();if(inside.audio?.available)expect(inside.audio.tunnelEnclosure).toBeGreaterThan(.9);
 const x=inside.x,z=inside.z;await page.keyboard.down('w');await page.keyboard.down('a');await page.waitForTimeout(2400);await page.keyboard.up('w');await page.keyboard.up('a');
 const after=await snap(page);expect(Math.abs(after.x-x)).toBeLessThan(7);expect(after.z).toBeGreaterThan(z);expect(after.recovery.submerged).toBe(false);expect(errors).toEqual([]);
});
test('flooding suppresses driving input but preserves settling and freezes both timer phases in menus',async({page})=>{
 await start(page);await page.evaluate(async()=>{const path='/src/world/road.ts',{riverAt}=await import(path),r=riverAt(1000,1942);await window.__rimmile.inspectPosition(r.x,1000);});await page.keyboard.press('Escape');await resume(page);
 await expect.poll(async()=>(await snap(page)).recovery.submerged).toBe(true);await page.keyboard.press('Escape');const early=await snap(page);expect(early.recovery.settling).toBeGreaterThan(0);await page.waitForTimeout(1100);expect((await snap(page)).recovery).toEqual(early.recovery);
 await resume(page);await page.keyboard.down('w');await page.keyboard.down('a');await expect.poll(async()=>(await snap(page)).recovery.settling,{timeout:15000}).toBe(0);await page.keyboard.up('w');await page.keyboard.up('a');await page.keyboard.press('Escape');const settled=await snap(page);expect(settled.recovery.settling).toBe(0);expect(settled.recovery.seconds).toBeGreaterThan(0);expect(settled.y).toBeLessThanOrEqual(early.y+.05);await resume(page);await page.keyboard.press('t');expect((await snap(page)).recovery.submerged).toBe(false);
});

test('terrain band culling reduces submissions without altering pinned scene pixels',async({page})=>{
 test.setTimeout(180000);await start(page);
 for(const z of [0,3000,9000]){
  await page.evaluate(z=>window.__rimmile.inspectDistance(z),z);
  const culled=await page.evaluate(()=>window.__rimmile.inspectFrame());
  const fewer=await page.evaluate(()=>window.__rimmile.snapshot().triangles);
  await page.evaluate(async()=>{
   const path='/src/world/stream.ts',{WorldStream}=await import(path);
   const prototype=WorldStream.prototype as unknown as {cullTerrain:(slot:unknown)=>void};
   const globals=window as unknown as {restoreTerrain?:()=>void};const original=prototype.cullTerrain;
   globals.restoreTerrain=()=>{prototype.cullTerrain=original;};
   prototype.cullTerrain=function(slot:unknown){const s=slot as {meshes:{visible:boolean;geometry:{setDrawRange:(start:number,count:number)=>void}}[];terrainIndices:Uint16Array[];terrainLod:number;terrainCullRevision:number};s.meshes[0].visible=true;s.meshes[0].geometry.setDrawRange(0,s.terrainIndices[s.terrainLod].length);s.terrainCullRevision=-1;};
  });
  const all=await page.evaluate(()=>window.__rimmile.inspectFrame());const more=await page.evaluate(()=>window.__rimmile.snapshot().triangles);
  await page.evaluate(()=>(window as unknown as {restoreTerrain:()=>void}).restoreTerrain());
  expect(culled).toBe(all);expect(fewer).toBeLessThan(more);
 }
});

test('accepted tunnel engine shares dry/reflected volume and pause routing',async({page})=>{
 test.setTimeout(120000);await page.addInitScript(()=>{if(typeof AudioContext==='undefined')return;const Original=AudioContext;
  window.AudioContext=new Proxy(Original,{construct(target,args){const ctx=Reflect.construct(target,args,target) as AudioContext;const probe=window as unknown as {tunnelAudio:AudioContext;tunnelGains:GainNode[]};probe.tunnelAudio=ctx;probe.tunnelGains=[];const create=ctx.createGain.bind(ctx);ctx.createGain=()=>{const n=create();probe.tunnelGains.push(n);return n;};return ctx;}});
 });
 await start(page);if(!await page.evaluate(()=>typeof AudioContext!=='undefined'))return;
 const center=await page.evaluate(async()=>{const path='/src/world/road.ts',{tunnelPlan}=await import(path);for(let i=0;i<100;i++){const t=tunnelPlan(i,1942);if(t)return t.center;}throw Error('No bore');});await page.evaluate(z=>window.__rimmile.inspectDistance(z),center);await page.keyboard.press('Escape');await resume(page);
 await page.evaluate(()=>{const p=window as unknown as {tunnelAudio:AudioContext;tunnelGains:GainNode[];tunnelTap:AnalyserNode};p.tunnelTap=p.tunnelAudio.createAnalyser();p.tunnelTap.fftSize=2048;p.tunnelGains[0].connect(p.tunnelTap);});
 const level=()=>page.evaluate(()=>{const a=(window as unknown as {tunnelTap:AnalyserNode}).tunnelTap,pcm=new Float32Array(a.fftSize);a.getFloatTimeDomainData(pcm);return Math.sqrt(pcm.reduce((s,v)=>s+v*v,0)/pcm.length);});
 const set=async(master:number,engine:number,environment:number)=>{await page.keyboard.press('Escape');await page.evaluate(values=>{for(const [id,v] of Object.entries(values)){const e=document.getElementById(id) as HTMLInputElement;e.value=String(v);e.dispatchEvent(new Event('input'));}},{master,engine,environment});await resume(page);await page.waitForTimeout(350);};
 await set(100,100,0);await page.keyboard.down('w');await page.waitForTimeout(550);await page.keyboard.up('w');expect(await level()).toBeGreaterThan(.001);expect((await snap(page)).audio!.tunnelEnclosure).toBeGreaterThan(.9);const nodes=(await snap(page)).audio!.nodes;
 await set(100,0,0);expect(await level()).toBeLessThan(.00001);await set(0,100,100);expect(await level()).toBeLessThan(.00001);await set(70,70,65);expect((await snap(page)).audio!.nodes).toBe(nodes);
 await page.keyboard.press('Escape');await page.waitForTimeout(100);expect(await page.evaluate(()=>(window as unknown as {tunnelAudio:AudioContext}).tunnelAudio.state)).toBe('suspended');
});

test('renderer loss inside a menu returns to usable Retry while preserving handling and distance',async({page})=>{
 await start(page);await page.keyboard.press('Escape');await page.locator('#landing-settings').click();await page.locator('#handling-balance').fill('40');
 await page.evaluate(()=>document.getElementById('game')!.dispatchEvent(new Event('webglcontextlost',{cancelable:true})));
 await expect(page.locator('#settings-page')).toBeVisible();await page.locator('#settings-back').click();await expect(page.locator('#play')).toHaveText('- Retry -');await page.locator('#play').click();await expect(page.locator('#hud')).toBeVisible({timeout:60000});expect((await snap(page)).handling.frontGrip).toBeGreaterThan((await snap(page)).handling.rearGrip);
});

test('bridge abutments and river-bank spans remain clear after streamed inspection on every preset',async({page},testInfo)=>{
 test.setTimeout(180000);await start(page);await page.keyboard.press('Escape');
 for(const quality of ['Auto','Low','Medium','High']){
  await page.locator('#landing-settings').click();await page.locator(`[data-graphics="resolution"][data-value="${quality}"]`).click();await page.locator('#settings-back').click();
  for(const z of [26780,9000]){
   await page.evaluate(z=>window.__rimmile.inspectDistance(z),z);
   const checked=await page.evaluate(async()=>{
    const path='/src/world/road.ts',grid='/src/world/terrain-grid.ts';const {bridgeAt,roadAt}=await import(path),{terrainMeshHeight}=await import(grid);
    const p=window.__rimmile.snapshot(),b=bridgeAt(p.z,1942),road=roadAt(p.z,1942),gl=(document.getElementById('game') as HTMLCanvasElement).getContext('webgl2')!;
    return {bridge:b.active,deckCasters:p.bridgeShadowChunks,detail:p.detailRadius,error:gl.getError(),clearance:[-5.15,0,5.15].map(x=>road.y+x*road.bank-.018*Math.abs(x)-terrainMeshHeight(road.x+x,p.z,1942))};
   });
   expect(checked.error).toBe(0);expect(checked.detail).toBe(500);
   if(z===26780){expect(checked.bridge).toBe(true);expect(checked.deckCasters).toBeGreaterThan(0);expect(checked.deckCasters).toBeLessThanOrEqual(4);expect(Math.min(...checked.clearance)).toBeGreaterThan(.6);}
  }
 }
 const frame=await page.evaluate(()=>window.__rimmile.inspectFrame());await testInfo.attach('land-road-verge',{body:Buffer.from(frame.split(',')[1],'base64'),contentType:'image/png'});
});

test('Reset Handling restores both axle calibration and grip immediately and persists only those changes',async({page})=>{
 test.setTimeout(120000);await start(page);await page.keyboard.press('Escape');await page.locator('#landing-settings').click();
 await page.locator('[data-graphics="resolution"][data-value="Low"]').click();await page.locator('[data-binding="accelerate"]').click();await page.keyboard.press('x');
 await page.locator('#handling-balance').fill('80');await page.locator('#handling-grip').fill('-70');
 const tuned=(await snap(page)).handling;expect(tuned.frontGrip).toBeGreaterThan(tuned.rearGrip);expect(tuned.grip).toBeLessThan(1);
 await page.evaluate(()=>localStorage.setItem('rimmile.distance.metres','128600'));
 const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('rimmile.preferences.v1')!));
 await page.locator('#reset-handling').click();await expect(page.locator('#handling-balance')).toHaveValue('0');await expect(page.locator('#handling-grip')).toHaveValue('0');
 await expect(page.locator('#handling-balance-value')).toHaveText('Balanced');await expect(page.locator('#handling-grip-value')).toHaveText('Normal');await expect(page.locator('#handling-status')).toHaveCount(0);await expect(page.locator('#handling-grip')).toHaveValue('0');
 expect((await snap(page)).handling).toMatchObject({grip:1,frontGrip:1,rearGrip:1});
 expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('rimmile.preferences.v1')!))).toEqual({...saved,handling:{balance:0,grip:0}});
 expect(await page.evaluate(()=>localStorage.getItem('rimmile.distance.metres'))).toBe('128600');
 await page.reload();await page.locator('#landing-settings').click();await expect(page.locator('#handling-balance')).toHaveValue('0');await expect(page.locator('#handling-grip')).toHaveValue('0');await expect(page.locator('[data-graphics="resolution"][data-value="Low"]')).toHaveAttribute('aria-pressed','true');await expect(page.locator('[data-binding="accelerate"]')).toHaveText('X / Arrow Up');
});
