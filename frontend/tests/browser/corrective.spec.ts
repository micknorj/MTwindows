import {test,expect} from './fixtures';
test('independent graphics change actual budgets, persist, and keep a fixed paused viewport',async({page})=>{
 test.setTimeout(180000);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.goto('/');await page.locator('#play').click();await expect(page.locator('#hud')).toBeVisible({timeout:60000});await page.keyboard.press('Escape');
 const snap=()=>page.evaluate(()=>window.__rimmile.snapshot() as unknown as {x:number;y:number;z:number;detailRadius:number;forest:{trees:number;near:number;grass:number};performance:{scale:number;moonShadowSize:number;graphics:Record<string,string>};renderBudgets:{terrainIndices:number;horizonIndices:number};viewport:{aspect:number;width:number;height:number}});
 const measured:Record<string,number[]>={};
 const initial=await snap();await page.locator('#landing-settings').click();await expect(page.getByText('Quality',{exact:true})).toHaveCount(0);
 for(const key of ['resolution','shadows','trees','grass','terrain','distant']){
  measured[key]=[];for(const value of ['Low','High']){
   await page.locator(`[data-graphics="${key}"][data-value="${value}"]`).click();await expect.poll(async()=>(await snap()).performance.graphics[key]).toBe(value);
   const p=await snap();expect([p.x,p.y,p.z]).toEqual([initial.x,initial.y,initial.z]);expect(p.detailRadius).toBe(500);expect(p.forest.trees).toBe(initial.forest.trees);
   if(key==='resolution')expect(p.performance.scale).toBe(value==='Low'?.65:1);
   if(key==='shadows')expect(p.performance.moonShadowSize).toBe(value==='Low'?512:1536);
   measured[key].push(key==='resolution'?p.viewport.width:key==='shadows'?p.performance.moonShadowSize:key==='trees'?p.forest.near:key==='grass'?p.forest.grass:key==='terrain'?p.renderBudgets.terrainIndices:p.renderBudgets.horizonIndices);
  }
 }
 for(const key of Object.keys(measured))expect(measured[key][1],key+' actual render budget').toBeGreaterThan(measured[key][0]);
 await page.evaluate(()=>{document.getElementById('settings-page')!.scrollTop=0;});
 await page.screenshot({path:`test-results/graphics-settings-${test.info().project.name}.png`});
 const layout=await page.evaluate(()=>{const root=document.documentElement,screen=document.getElementById('settings-page')!,canvas=document.getElementById('game')!;screen.scrollTop=screen.scrollHeight;return {window:innerWidth,doc:root.clientWidth,scroll:root.scrollTop,overflow:root.scrollWidth,canvas:canvas.getBoundingClientRect().toJSON(),menuScroll:screen.scrollTop};});
 expect(layout.doc).toBe(layout.window);expect(layout.scroll).toBe(0);expect(layout.overflow).toBeLessThanOrEqual(layout.window);expect(layout.menuScroll).toBeGreaterThan(0);expect(layout.canvas.width).toBe(layout.window);
 await page.setViewportSize({width:1100,height:700});await expect.poll(async()=>(await snap()).viewport.aspect).toBe(1100/700);
 await page.evaluate(()=>{window.dispatchEvent(new Event('pageshow'));document.dispatchEvent(new Event('visibilitychange'));});expect((await snap()).performance.graphics.resolution).toBe('High');
 await page.reload();await page.locator('#landing-settings').click();for(const key of ['resolution','shadows','trees','grass','terrain','distant'])await expect(page.locator(`[data-graphics="${key}"][data-value="High"]`)).toHaveAttribute('aria-pressed','true');
 await expect(page.locator('#scene')).toBeVisible({timeout:60000});expect(errors).toEqual([]);
});
test('legacy Quality migrates and partially corrupt graphics preserve unrelated saved settings',async({page})=>{
 test.setTimeout(120000);await page.goto('/');await page.evaluate(()=>localStorage.setItem('rimmile.preferences.v1',JSON.stringify({version:1,quality:'Low',handling:{balance:.42,grip:-.25},volumes:{master:.33},lights:false})));await page.reload();await page.locator('#landing-settings').click();
 for(const key of ['resolution','shadows','trees','grass','terrain','distant'])await expect(page.locator(`[data-graphics="${key}"][data-value="Low"]`)).toHaveAttribute('aria-pressed','true');await expect(page.locator('#handling-balance')).toHaveValue('42');
 await page.locator('[data-graphics="trees"][data-value="High"]').click();expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('rimmile.preferences.v1')!).version)).toBe(3);
 await page.evaluate(()=>{const key='rimmile.preferences.v1',v=JSON.parse(localStorage.getItem(key)!);v.graphics.shadows='Ultra';v.graphics.resolution=Infinity;localStorage.setItem(key,JSON.stringify(v));});await page.reload();await page.locator('#landing-settings').click();
 await expect(page.locator('[data-graphics="trees"][data-value="High"]')).toHaveAttribute('aria-pressed','true');await expect(page.locator('[data-graphics="shadows"][data-value="Medium"]')).toHaveAttribute('aria-pressed','true');await expect(page.locator('[data-graphics="resolution"][data-value="Auto"]')).toHaveAttribute('aria-pressed','true');await expect(page.locator('#handling-balance')).toHaveValue('42');await expect(page.locator('#master')).toHaveValue('33');
});

test('closed-throttle recordings retain comparable actual engine energy with unloaded timbre',async({page,browserName})=>{
 test.setTimeout(120000);await page.goto('/');
 const result=await page.evaluate(async()=>{
  if(typeof OfflineAudioContext==='undefined')return null;
  const {SampleEngine}=await import('../../src/audio/sample-engine');
  const energy=async(load:number)=>{const context=new OfflineAudioContext(2,48000*2,48000),voice=await SampleEngine.load(context,context.destination,new AbortController().signal);if(!voice)throw Error('Missing engine');voice.update(5000,load,0);const pcm=await context.startRendering(),samples=pcm.getChannelData(0);let sum=0;for(let i=48000;i<samples.length;i++)sum+=samples[i]*samples[i];voice.dispose();return sum/(samples.length-48000);};
  return {on:await energy(1),off:await energy(0)};
 });
 if(!result){test.skip(browserName==='webkit','Windows WebKit has no OfflineAudioContext; native Chromium exercises PCM.');return;}
 expect(result.on).toBeGreaterThan(.0001);expect(result.off).toBeGreaterThan(.000001);expect(result.off/result.on).toBeGreaterThan(.65);expect(result.off/result.on).toBeLessThan(1.4);
});
