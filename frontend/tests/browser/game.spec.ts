import type { Page } from '@playwright/test';
import type {GameView} from '../../src/rendering/view';
import { expect, test } from './fixtures';
import { writeFile } from 'node:fs/promises';

type Snapshot = { allocatedWorldGeometries:number; audio: { available: boolean; state: string; running: boolean; engineActivated:boolean;nature:{loaded:boolean;decodedBytes:number};nodes: number; volumes: { master: number } }; drivetrain: { mode:'Automatic'|'Manual';direction:'Drive'|'Reverse';load:number;shifting:number;rpm: number; gear: number; wheelTravel: number[] }; state: string; triangles:number; recovery:{seconds:number;settling:number;distance:number;submerged:boolean;reason?:string};running: boolean; x: number; z: number; speed: number; chunks: number; slots: number; pending: number; geometries: number; textures: number; origin: { x: number; z: number }; topologySamples: number; topologyEnd: number; detailRadius: number; bridgeShadowChunks:number; crossing: number; vehicle: { kind: string; visualTriangles: number; visualCalls: number; shadowTriangles: number; colliderCount: number; wheelSpin: number; frontSteer: number; rearSteer: number; calipersStationary: boolean; shadowError: number; lightsOn:boolean;tailEmission:number;rearIntensity:number;headlights:{visible:boolean;shadow:boolean;intensity:number}[];paintRoughness: number; width: number; length: number; height: number } };
declare global { interface Window { __rimmile: { snapshot: () => Snapshot; inspectPosition:(x:number,z:number)=>Promise<Snapshot>;inspectDistance: (z: number) => Promise<Snapshot>; inspectPose: (turn: number, pitch: number, roll: number) => Promise<Snapshot>; inspectFrame: () => Promise<string>; inspectCamera:(eye:[number,number,number],target:[number,number,number])=>Promise<Snapshot> } } }
const snapshot = (page: Page) => page.evaluate(() => window.__rimmile.snapshot());
async function openSettings(page:Page){
  if((await snapshot(page)).state==='running')await page.keyboard.press('Escape');
  if(await page.locator('#settings-page').isHidden())await page.locator('#landing-settings').click();
}
async function chooseQuality(page:Page,quality:string){await openSettings(page);await page.locator(`[data-graphics="resolution"][data-value="${quality}"]`).click();}
async function resume(page:Page){
  if(await page.locator('#settings-page').isVisible())await page.locator('#settings-back').click();
  if(await page.locator('#about-page').isVisible())await page.locator('#about-back').click();
  if(await page.locator('#play').isVisible())await page.locator('#play').click();
  await expect(page.locator('#hud')).toBeVisible({timeout:60000});
}
async function start(page:Page){
  await page.goto('/');await page.getByRole('button',{name:'Drive',exact:true}).click();
  await page.waitForFunction(()=>!document.getElementById('hud')!.hidden||document.getElementById('play')!.textContent==='- Resume -');
  if(await page.locator('#play').isVisible())await resume(page);
}
test.afterEach(async ({ page }) => {
  // Exercise page teardown while the document is still alive; software GPU queues must not
  // retain all world buffers until a later context is created in the same browser process.
  if (!page.isClosed()) await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
});

test('editorial real-scene menus, fixed typography, inline settings and frozen pause',async({page})=>{
  await page.goto('/');await expect.poll(async()=>(await snapshot(page)).chunks,{timeout:30000}).toBe(25);
  await expect(page.locator('#scene')).toBeVisible({timeout:30000});await expect(page.locator('#landing button')).toHaveCount(3);
  expect((await snapshot(page)).audio).toBeUndefined();expect((await snapshot(page)).running).toBe(false);
  const initial=await snapshot(page);await page.waitForTimeout(400);expect((await snapshot(page)).z).toBe(initial.z);
  for(const width of [1100,1800,1440]){await page.setViewportSize({width,height:900});await expect(page.locator('h1')).toHaveCSS('font-size','112px');}
  await page.evaluate(()=>document.documentElement.style.fontSize='20px');await expect(page.locator('h1')).toHaveCSS('font-size','140px');await page.evaluate(()=>document.documentElement.style.fontSize='');
  const veil=await page.locator('#menu-overlay').evaluate(el=>getComputedStyle(el).backgroundColor);
  await page.locator('#landing-settings').click();await expect(page.getByRole('heading',{name:'Settings',exact:true})).toBeVisible();
  await expect(page.locator('#menu-overlay')).toHaveCSS('background-color',veil);
  const settingsBox=await page.locator('#settings-page .editorial-content').boundingBox();expect(settingsBox!.width).toBe(768);
  const rows=await page.locator('.setting-row:not(.reset-row)').evaluateAll(rows=>rows.map(row=>{const a=row.children[0].getBoundingClientRect(),b=row.children[1].getBoundingClientRect();return {a:a.y+a.height/2,b:b.y+b.height/2,x:b.right};}));
  for(const row of rows){expect(Math.abs(row.a-row.b)).toBeLessThan(1);expect(row.x).toBeCloseTo(rows[0].x,0);}
  for(const node of await page.locator('button,h1,h2,h3,label,legend,output,p,footer,.unit,.setting-row>span').all())if(await node.isVisible()){
    expect(Number.parseFloat(await node.evaluate(el=>getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(13);
    expect(await node.evaluate(el=>getComputedStyle(el).borderRadius)).toBe('0px');
  }
  await expect(page.locator('[data-graphics="resolution"]')).toHaveCount(4);await expect(page.locator('#engine-value')).toHaveText('70%');
  await page.locator('[data-graphics="resolution"][data-value="Low"]').click();await page.keyboard.press('Escape');
  await page.locator('#landing-about').click();await expect(page.locator('#menu-overlay')).toHaveCSS('background-color',veil);
  expect(await page.locator('#about-page .editorial-content').boundingBox()).toMatchObject({x:settingsBox!.x,y:settingsBox!.y,width:settingsBox!.width});
  await expect(page.locator('.site-credit')).toHaveCSS('text-align','center');await expect(page.locator('.site-credit a')).toHaveAttribute('href','https://github.com/micknorj');
  await expect(page.locator('#about-page h3')).toHaveCount(0);await page.locator('#about-back').click();
  await page.locator('#play').click();await expect(page.locator('#hud')).toBeVisible({timeout:60000});
  expect((await snapshot(page)).audio.engineActivated).toBe(false);
  await page.keyboard.down('w');await expect.poll(async()=>(await snapshot(page)).speed).toBeGreaterThan(2);await page.keyboard.up('w');
  await page.keyboard.press('Escape');await expect(page.locator('#play')).toHaveText('- Resume -');await expect(page.locator('#menu-overlay')).toHaveCSS('background-color',veil);
  const frozen=await snapshot(page),pixels=await page.evaluate(()=>window.__rimmile.inspectFrame());await page.waitForTimeout(250);expect((await page.evaluate(()=>window.__rimmile.inspectFrame()))===pixels).toBe(true);
  await page.mouse.click(12,12);expect((await snapshot(page)).state).toBe('paused');expect((await snapshot(page)).z).toBe(frozen.z);
  await page.locator('#landing-settings').click();await page.locator('#settings-back').click();expect((await page.evaluate(()=>window.__rimmile.inspectFrame()))===pixels).toBe(true);
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));expect((await snapshot(page)).state).toBe('paused');
  await page.keyboard.press('Escape');await expect(page.locator('#hud')).toBeVisible();
  await page.keyboard.press('t');await page.keyboard.press('r');await page.keyboard.down('w');await expect.poll(async()=>(await snapshot(page)).speed,{timeout:10000}).toBeLessThan(-1);await page.keyboard.up('w');
  await page.evaluate(()=>window.dispatchEvent(new Event('blur')));await expect(page.locator('#play')).toHaveText('- Resume -');
  await page.waitForTimeout(80);if((await snapshot(page)).audio.available)expect((await snapshot(page)).audio.state).toBe('suspended');
});

test('remaps all driving controls, rejects conflicts and cancels capture before Escape navigation',async({page})=>{
  await start(page);await openSettings(page);
  const assign=async(label:string,key:string)=>{await page.getByRole('button',{name:`Remap ${label}`,exact:true}).click();await page.keyboard.press(key);};
  await assign('Accelerate','x');await expect(page.getByRole('button',{name:'Remap Accelerate',exact:true})).toHaveText('X / Arrow Up');
  await assign('Brake','x');await expect(page.locator('#binding-status')).toContainText('assigned to another');
  await page.keyboard.press('Escape');await expect(page.locator('#settings-page')).toBeVisible();
  await assign('Steer Left','F1');await expect(page.locator('#binding-status')).toContainText('unavailable');await page.keyboard.press('Escape');
  await assign('Steer Left','j');await assign('Steer Right','v');await assign('Brake','b');await assign('Return to Road','t');
  await resume(page);await page.keyboard.down('w');await page.waitForTimeout(250);await page.keyboard.up('w');expect((await snapshot(page)).speed).toBe(0);
  await page.keyboard.down('x');await expect.poll(async()=>(await snapshot(page)).speed).toBeGreaterThan(3);await page.keyboard.up('x');
  await page.keyboard.press('t');expect((await snapshot(page)).speed).toBe(0);
  await page.keyboard.down('ArrowUp');await expect.poll(async()=>(await snapshot(page)).speed).toBeGreaterThan(2);
  await page.evaluate(()=>window.dispatchEvent(new Event('blur')));await page.keyboard.up('ArrowUp');await resume(page);await page.keyboard.press('t');expect((await snapshot(page)).speed).toBe(0);
  await openSettings(page);await page.locator('#reset-controls').click();await expect(page.getByRole('button',{name:'Remap Accelerate',exact:true})).toHaveText('W / Arrow Up');
  await expect(page.getByRole('button',{name:'Remap Return to Road',exact:true})).toHaveText('T');await resume(page);
  await page.keyboard.down('x');await page.waitForTimeout(250);await page.keyboard.up('x');expect((await snapshot(page)).speed).toBe(0);
});

test('exploration countdown cancels inside hysteresis, freezes in menus and returns safely',async({page})=>{
  await start(page);
  const position=async(offset:number)=>page.evaluate(async offset=>{
    const module='/src/world/road.ts';const {roadAt}=await import(module);const road=roadAt(800,1942);return window.__rimmile.inspectPosition(road.x+offset,800);
  },offset);
  await position(325);await page.keyboard.press('Escape');await resume(page);
  await expect.poll(async()=>(await snapshot(page)).recovery.seconds).toBe(5);
  await page.keyboard.press('Escape');const paused=(await snapshot(page)).recovery.seconds;await page.waitForTimeout(1200);
  expect((await snapshot(page)).recovery.seconds).toBe(paused);
  await position(270);await resume(page);await expect.poll(async()=>(await snapshot(page)).recovery.seconds).toBe(0);
  await position(340);await page.keyboard.press('Escape');await resume(page);
  await expect(page.locator('#recovery-status')).toContainText('Returning to road');
  await expect.poll(async()=>(await snapshot(page)).recovery.distance,{timeout:9000}).toBeLessThan(5);
  expect(Math.abs((await snapshot(page)).speed)).toBeLessThan(.01);expect((await snapshot(page)).recovery.seconds).toBe(0);
});

test('high-speed chase stays attached through travel and large origin rebases',async({page})=>{
  await start(page);
  await page.evaluate(async()=>{
    const module='/src/rendering/view.ts', {GameView}=await import(module),follow=GameView.prototype.follow;
    GameView.prototype.follow=function(this:GameView,...args:Parameters<GameView['follow']>){
      follow.apply(this,args);const [car,origin]=args;
      (window as unknown as {chaseDistance:number}).chaseDistance=Math.hypot(this.camera.position.x-(car.x-origin.x),this.camera.position.z-(car.z-origin.z));
    };
    await (window.__rimmile as unknown as {inspectSpeed:(speed:number)=>Promise<unknown>}).inspectSpeed(350/3.6);
  });
  await page.keyboard.press('Escape');await resume(page);await page.waitForTimeout(900);
  expect((await snapshot(page)).speed).toBeGreaterThan(75);
  const distance=()=>page.evaluate(()=>(window as unknown as {chaseDistance:number}).chaseDistance);
  expect(await distance()).toBeGreaterThan(7);expect(await distance()).toBeLessThan(9);
  await page.evaluate(()=>window.__rimmile.inspectDistance(1000000));
  await page.keyboard.press('Escape');await resume(page);await page.waitForTimeout(100);
  expect(await distance()).toBeGreaterThan(7);expect(await distance()).toBeLessThan(9);
});

test('worker recycling and floating origin stay bounded over forward/reverse travel', async ({ page }) => {
  test.setTimeout(300000); // Complete 118 GPU-drained renders of dense foliage on SwiftShader.
  await start(page);
  const warm = await page.evaluate(async () => {
    const values = [];
    for (let i = 0; i < 13; i++) values.push(await window.__rimmile.inspectDistance(i * 220));
    return values;
  });
  // Register the full-detail pool first, then exercise the complete placement/recycling
  // workload on Low. GPU-complete High screenshots are covered separately; forcing all
  // 105 teleport renders through SwiftShader at High exceeds this software test budget.
  await page.keyboard.press('Escape'); await chooseQuality(page,'Low'); await resume(page);
  await expect.poll(() => page.evaluate(() => (window.__rimmile.snapshot() as unknown as { performance: { scale: number } }).performance.scale)).toBe(.65);
  const travel = await page.evaluate(async () => {
    const values = [];
    for (let i = 0; i < 45; i++) values.push(await window.__rimmile.inspectDistance(i * 220));
    for (let i = 45; i >= -12; i--) values.push(await window.__rimmile.inspectDistance(i * 220));
    values.push(await window.__rimmile.inspectDistance(1000000));
    values.push(await window.__rimmile.inspectDistance(-1000000));
    return values;
  });
  const samples = [...warm, ...travel];
  // Three.js registers geometries lazily. Closed structures and exterior tunnel
  // rock add exactly two reusable geometries per25-slot pool; retain the strict
  // late-travel plateau assertion below so a growing allocation still fails.
  expect(Math.max(...samples.map(sample => sample.geometries))).toBeLessThanOrEqual(180+2*25);
  // GPU registration may grow when a rare tunnel surface is first visible.
  // The allocated geometry pool itself must be exactly constant; GPU-visible
  // objects must remain below its explicit bounded allowance above.
  expect(new Set(samples.map(sample => sample.allocatedWorldGeometries)).size).toBe(1);
  expect(samples[0].allocatedWorldGeometries).toBe(25*9);
  expect(new Set(samples.map(sample => sample.textures)).size).toBe(1);
  for (const sample of samples) {
    expect(sample.chunks).toBe(25); expect(sample.slots).toBe(25); expect(sample.pending).toBeLessThanOrEqual(1);
    expect(Math.abs(sample.z - sample.origin.z)).toBeLessThan(1000);
    expect(sample.topologySamples).toBe(249); expect(sample.topologyEnd - sample.z).toBeGreaterThanOrEqual(5000);
    expect(sample.detailRadius).toBe(500);
  }
});

test('optimized vehicle contract, moving parts, bridge and quality coverage', async ({ page }, testInfo) => {
  test.setTimeout(180000); // Multiple full-resolution GLB/shadow screenshots on software WebGL.
  await start(page);
  const initial = await snapshot(page);
  expect(initial.vehicle.kind).toBe('optimized');
  expect(initial.vehicle).toMatchObject({ visualTriangles: 80364, visualCalls: 21, shadowTriangles: 6613, colliderCount: 4, calipersStationary: true });
  expect(initial.vehicle.length).toBeCloseTo(4.948, 2); expect(initial.vehicle.width).toBeCloseTo(2.271, 2);
  expect(initial.vehicle.paintRoughness).toBeCloseTo(.42, 2);
  const lamps=(initial.vehicle as unknown as {headlights:{x:number;shadow:boolean;profile:boolean}[]}).headlights;
  expect(lamps).toHaveLength(2);expect(lamps[0].x).toBeGreaterThan(.7);expect(lamps[1].x).toBeLessThan(-.7);
  expect(lamps.every(light=>light.shadow&&light.profile)).toBe(true);
  await page.keyboard.down('w'); await page.keyboard.down('a'); await page.waitForTimeout(1000);
  await page.keyboard.up('a'); await page.keyboard.up('w');
  const moving = await snapshot(page);
  expect(Math.abs(moving.vehicle.wheelSpin)).toBeGreaterThan(.1); expect(moving.vehicle.frontSteer).toBeGreaterThan(0);
  expect(moving.vehicle.rearSteer).toBe(0); expect(moving.vehicle.calipersStationary).toBe(true); expect(moving.vehicle.shadowError).toBeLessThan(.00001);
  const pose = await page.evaluate(() => window.__rimmile.inspectPose(.4, -.05, .03));
  expect(pose.vehicle.shadowError).toBeLessThan(.00001);
  await page.screenshot({ path: `test-results/vehicle-turn-${testInfo.project.name}.png` });
  await page.evaluate(async () => { const current = window.__rimmile.snapshot(); await window.__rimmile.inspectDistance(current.crossing - 22); });
  await page.screenshot({ path: `test-results/bridge-${testInfo.project.name}.png` });
  await page.keyboard.press('Escape'); await chooseQuality(page,'Low'); await resume(page);
  await page.waitForTimeout(1200); expect((await snapshot(page)).detailRadius).toBe(500);
  await page.screenshot({ path: `test-results/bridge-low-${testInfo.project.name}.png` });
  const metrics = JSON.stringify(await snapshot(page), null, 2);
  await writeFile(`test-results/runtime-metrics-${testInfo.project.name}.json`, metrics);
  await testInfo.attach('runtime-metrics', { body: metrics, contentType: 'application/json' });
});

test('readable WebGL2 failure and successful Retry', async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    let fail = true;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, ...args: Parameters<typeof original>) {
      if (args[0] === 'webgl2' && fail) { fail = false; return null; }
      return original.apply(this, args);
    } as typeof original;
  });
  await page.goto('/');
  const before=await page.locator('.menu-content').boundingBox();
  await expect(page.locator('#load-status')).toContainText('WebGL2 unavailable.');
  await expect(page.locator('#load-status')).toHaveCSS('text-align','center');
  const errorBox=await page.locator('#load-status').boundingBox();
  expect(errorBox!.x+errorBox!.width/2).toBeCloseTo(await page.evaluate(()=>innerWidth/2),0);
  expect(await page.locator('.menu-content').boundingBox()).toEqual(before);
  expect(errorBox!.y+errorBox!.height).toBeGreaterThan(await page.evaluate(()=>innerHeight-40));
  await resume(page);
  await expect(page.locator('#hud')).toBeVisible({ timeout: 60000 });
});

test('shader link failure returns to a stable Retry instead of missing terrain',async({page})=>{
  await page.addInitScript(()=>{
    const original=WebGL2RenderingContext.prototype.getProgramParameter;let fail=true;
    WebGL2RenderingContext.prototype.getProgramParameter=function(program,pname){
      if(fail&&pname===this.LINK_STATUS&&this.getAttachedShaders(program)?.some(shader=>this.getShaderSource(shader)?.includes('rtAlbedo'))){fail=false;return false;}
      return original.call(this,program,pname);
    };
  });
  await page.goto('/');
  await expect(page.locator('#load-status')).toHaveText('Graphics unavailable.',{timeout:60000}); // Await the actual async PBR compile/failure, including cold texture/forest loading.
  await resume(page);await expect(page.locator('#hud')).toBeVisible({timeout:60000});
});

test('restricted shader capabilities keep PBR and independent headlight shadows',async({page})=>{
  const warnings:string[]=[];
  page.on('console',message=>{if(message.type()==='warning'&&/texture units|Texture has been resized/.test(message.text()))warnings.push(message.text());});
  await page.addInitScript(()=>{
    const original=WebGL2RenderingContext.prototype.getParameter;
    WebGL2RenderingContext.prototype.getParameter=function(parameter){return parameter===this.MAX_VARYING_VECTORS||parameter===this.MAX_TEXTURE_IMAGE_UNITS?8:parameter===this.MAX_TEXTURE_SIZE?2048:original.call(this,parameter);};
    const originalUse=WebGL2RenderingContext.prototype.useProgram,seen=new WeakSet<WebGLProgram>();
    (window as unknown as {samplerCounts:number[]}).samplerCounts=[];
    WebGL2RenderingContext.prototype.useProgram=function(program){
      if(program&&!seen.has(program)){
        seen.add(program);let count=0;
        for(let i=0;i<this.getProgramParameter(program,this.ACTIVE_UNIFORMS);i++){
          const uniform=this.getActiveUniform(program,i)!;
          if(new Set<number>([this.SAMPLER_2D,this.SAMPLER_CUBE,this.SAMPLER_3D,this.SAMPLER_2D_ARRAY,this.SAMPLER_2D_SHADOW,this.SAMPLER_CUBE_SHADOW]).has(uniform.type))count+=uniform.size;
        }
        (window as unknown as {samplerCounts:number[]}).samplerCounts.push(count);
      }
      return originalUse.call(this,program);
    };
  });
  await start(page);
  const lamps=(await snapshot(page)).vehicle as unknown as {headlights:{shadow:boolean}[]};
  expect(lamps.headlights).toHaveLength(2);expect(lamps.headlights.every(lamp=>lamp.shadow)).toBe(true);
  expect(await page.evaluate(()=>document.querySelector('canvas')!.getContext('webgl2')!.getError())).toBe(0);
  const counts=await page.evaluate(()=>(window as unknown as {samplerCounts:number[]}).samplerCounts);
  expect(counts.length).toBeGreaterThan(0);expect(Math.max(...counts)).toBeLessThanOrEqual(8);
  expect(warnings).toEqual([]);
});

test('forest color and linear normal atlas uploads directly without Canvas readback',async({page})=>{
  await page.addInitScript(()=>{
    type AtlasProbe={blob?:Blob;bitmap?:ImageBitmap;texture?:WebGLTexture;size?:number[]};
    const probe:AtlasProbe={};Object.defineProperty(window,'__forestAtlas',{value:probe});
    CanvasRenderingContext2D.prototype.getImageData=function(){throw new Error('Canvas readback is blocked');};
    const fetchImage=window.fetch.bind(window),decode=window.createImageBitmap.bind(window);
    window.fetch=async(...args)=>{
      const response=await fetchImage(...args);
      if(String(args[0]).includes('tree-impostors')){
        const blob=response.blob.bind(response);response.blob=async()=>{const result=await blob();probe.blob=result;return result;};
      }
      return response;
    };
    const bitmapApi=window as unknown as {createImageBitmap:(...args:unknown[])=>Promise<ImageBitmap>};
    bitmapApi.createImageBitmap=async(...args:unknown[])=>{
      const bitmap=await Reflect.apply(decode,window,args) as ImageBitmap;if(args[0]===probe.blob){probe.bitmap=bitmap;probe.size=[bitmap.width,bitmap.height];}return bitmap;
    };
    const api=WebGL2RenderingContext.prototype as unknown as Record<'texImage2D'|'texSubImage2D',(...args:unknown[])=>void>;
    for(const method of ['texImage2D','texSubImage2D'] as const){
      const upload=api[method];api[method]=function(this:WebGL2RenderingContext,...args:unknown[]){
        if(probe.bitmap&&args.includes(probe.bitmap))probe.texture=this.getParameter(this.TEXTURE_BINDING_2D);
        return upload.apply(this,args);
      };
    }
  });
  await start(page);await page.evaluate(()=>window.__rimmile.inspectFrame());
  const atlas=await page.evaluate(()=>{
    const probe=(window as unknown as {__forestAtlas:{texture:WebGLTexture;size:number[]}}).__forestAtlas;
    const gl=document.querySelector('canvas')!.getContext('webgl2')!,previous=gl.getParameter(gl.READ_FRAMEBUFFER_BINDING),fb=gl.createFramebuffer(),normals:number[][]=[],colors:number[][]=[];
    try{
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER,fb);gl.framebufferTexture2D(gl.READ_FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,probe.texture,0);
      if(gl.checkFramebufferStatus(gl.READ_FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw Error('Forest atlas is not readable: '+JSON.stringify({size:probe.size,texture:!!probe.texture,error:gl.getError()}));
      for(const y of [0,511,1024,2047])for(const x of [1024,1408,2047]){
        const rgba=new Uint8Array(4);gl.readPixels(x,y,1,1,gl.RGBA,gl.UNSIGNED_BYTE,rgba);normals.push([...rgba]);
      }
      for(const [x,y] of [[128,1567],[384,1567],[640,1567],[896,1567],[128,1980],[128,1055],[128,543],[128,31]]){
        const rgba=new Uint8Array(4);gl.readPixels(x,y,1,1,gl.RGBA,gl.UNSIGNED_BYTE,rgba);colors.push([...rgba]);
      }
      return {size:probe.size,normals,colors,error:gl.getError()};
    }finally{gl.bindFramebuffer(gl.READ_FRAMEBUFFER,previous);gl.deleteFramebuffer(fb);}
  });
  expect(atlas.size).toEqual([2048,2048]);expect(atlas.error).toBe(0);
  for(const pixel of atlas.normals){expect(pixel[3]).toBe(255);expect(pixel.slice(0,3).reduce((a,b)=>a+b,0)).toBeGreaterThan(80);}
  // Source RGBA decoded offline from the lossless bake, in flipped GPU
  // coordinates. Update these if the artwork changes, retaining exact alpha.
  const expected=[[41,36,25,255],[46,40,29,255],[39,34,23,255],[39,34,23,255],[100,126,96,255],[42,37,26,255],[41,35,25,255],[146,143,119,255]];
  for(let pixel=0;pixel<expected.length;pixel++)for(let channel=0;channel<4;channel++)expect(Math.abs(atlas.colors[pixel][channel]-expected[pixel][channel])).toBeLessThanOrEqual(channel===3?0:2);
});

test('worker failure falls back to the same continuous world', async ({ page }) => {
  await page.route('**/src/workers/world.worker.ts*', route => route.abort());
  await start(page);
  await expect.poll(async()=>(await snapshot(page)).chunks).toBe(25);
});

test('forest species and all presets render without changing placements', async ({ page },testInfo) => {
  test.setTimeout(180000);
  await start(page);
  let trees=0;
  for(const quality of ['Low','Medium','High']) {
    await page.keyboard.press('Escape'); await chooseQuality(page,quality); await resume(page);
    await expect.poll(()=>page.evaluate(()=>(window.__rimmile.snapshot() as unknown as {performance:{scale:number}}).performance.scale)).toBe(quality==='Low'?.65:quality==='Medium'?.85:1);
    await page.evaluate(()=>window.__rimmile.inspectDistance(0));
    const forest=await page.evaluate(()=>(window.__rimmile.snapshot() as unknown as {forest:{trees:number;near:number;middle:number;images:number;overlap:number;culled:number;species:Record<string,number>}}).forest);
    if(!trees) trees=forest.trees;
    expect(forest.trees).toBe(trees);expect(forest.near+forest.middle+forest.images-forest.overlap+forest.culled).toBe(trees);
    expect(forest.culled).toBeGreaterThan(0);expect(forest.culled).toBeLessThan(trees);
    expect(forest.overlap).toBeGreaterThan(0);expect(forest.overlap).toBeLessThan(trees*.2);
    expect(Object.keys(forest.species).length).toBe(4); for(const count of Object.values(forest.species)) expect(count).toBeGreaterThan(0);
    expect(forest.middle).toBeGreaterThan(0);expect(forest.images).toBeGreaterThan(0);
    expect(forest.near).toBeGreaterThan(0);
    const frame=await page.evaluate(()=>window.__rimmile.inspectFrame());
    const colors=await page.evaluate(async url=>{
      const img=new Image();img.src=url;await img.decode();const canvas=document.createElement('canvas');canvas.width=img.width;canvas.height=img.height;
      const ctx=canvas.getContext('2d')!;ctx.drawImage(img,0,0);const unique=new Set<string>();
      for(let y=.45;y<1;y+=.035) for(let x=.05;x<1;x+=.05) unique.add([...ctx.getImageData(x*img.width,y*img.height,1,1).data].join(','));
      return unique.size;
    },frame);
    expect(colors).toBeGreaterThan(30);
    await writeFile(`test-results/forest-${quality.toLowerCase()}-${testInfo.project.name}.png`,Buffer.from(frame.split(',')[1],'base64'));
  }
  const forward=await snapshot(page);
  await page.evaluate(()=>window.__rimmile.inspectCamera([0,3,4],[0,2,-35]));
  const backward=await snapshot(page);
  expect(backward.chunks).toBe(forward.chunks);expect(backward.vehicle.colliderCount).toBe(forward.vehicle.colliderCount);
  const reversedForest=await page.evaluate(()=>(window.__rimmile.snapshot() as unknown as {forest:{trees:number;culled:number;middle:number;images:number}}).forest);
  expect(reversedForest.trees).toBe(trees);expect(reversedForest.culled).toBeGreaterThan(0);expect(reversedForest.middle+reversedForest.images).toBeGreaterThan(0);
  const reverseFrame=await page.evaluate(()=>window.__rimmile.inspectFrame());
  await writeFile(`test-results/forest-backward-${testInfo.project.name}.png`,Buffer.from(reverseFrame.split(',')[1],'base64'));
});

test('missing forest artwork offers Retry and reloads cleanly',async({page})=>{
  let failed=false;
  await page.route('**/tree-impostors.webp*',route=>{if(!failed){failed=true;return route.abort();}return route.continue();});
  await page.goto('/');
  await expect(page.locator('#load-status')).toContainText('forest artwork could not be loaded',{timeout:30000});
  await resume(page);
  await expect(page.locator('#hud')).toBeVisible({timeout:60000});
});

test('missing PBR artwork offers Retry and reloads all shared surfaces',async({page})=>{
  let failed=false;
  await page.route('**/asphalt_02-albedo.webp*',route=>{if(!failed){failed=true;return route.abort();}return route.continue();});
  await page.goto('/');
  await expect(page.locator('#load-status')).toContainText('landscape textures could not be loaded',{timeout:60000});
  await resume(page);
  await expect(page.locator('#hud')).toBeVisible({timeout:60000});
});

test('PBR arrays load every layer without privacy-protected canvas readback',async({page})=>{
  await page.addInitScript(()=>{
    Object.defineProperty(window,'__surfaceUploads',{value:[]});
    Object.defineProperty(window,'__packedMap',{value:{texture:null}});
    CanvasRenderingContext2D.prototype.getImageData=function(){throw new Error('Canvas readback is blocked');};
    const api=WebGL2RenderingContext.prototype as unknown as {texSubImage3D:(...args:unknown[])=>void};
    const original=api.texSubImage3D;
    api.texSubImage3D=function(this:WebGL2RenderingContext,...args:unknown[]){
      if(args[0]===this.TEXTURE_2D_ARRAY&&args[10] instanceof ImageBitmap){
        const probe=window as unknown as {__surfaceUploads:number[];__packedMap:{texture:WebGLTexture|null}};
        probe.__surfaceUploads.push(Number(args[4]));
        if(probe.__surfaceUploads.length===2)probe.__packedMap.texture=this.getParameter(this.TEXTURE_BINDING_2D_ARRAY);
      }
      return original.apply(this,args);
    };
  });
  await start(page);
  expect(await page.evaluate(()=>(window as unknown as {__surfaceUploads:number[]}).__surfaceUploads)).toEqual([0,0,1,1,2,2,3,3,4,4]);
  // Lossless packed XY-normal/roughness/AO bytes must survive decoding/upload;
  // AO in alpha must not premultiply the other material channels.
  const packed=await page.evaluate(()=>{
    const gl=document.querySelector('canvas')!.getContext('webgl2')!,previous=gl.getParameter(gl.FRAMEBUFFER_BINDING),fb=gl.createFramebuffer(),pixels:number[][]=[];
    const texture=(window as unknown as {__packedMap:{texture:WebGLTexture}}).__packedMap.texture;
    try{
      gl.bindFramebuffer(gl.FRAMEBUFFER,fb);
      for(let layer=0;layer<5;layer++){
        gl.framebufferTextureLayer(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,texture,0,layer);
        if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw new Error('Packed texture is not readable');
        const rgba=new Uint8Array(4);gl.readPixels(512,511,1,1,gl.RGBA,gl.UNSIGNED_BYTE,rgba);pixels.push([...rgba]);
      }
      return pixels;
    }finally{gl.bindFramebuffer(gl.FRAMEBUFFER,previous);gl.deleteFramebuffer(fb);}
  });
  const expected=[[112,146,199,180],[81,175,174,228],[107,130,212,252],[153,155,197,241],[136,148,248,200]];
  // Native WebKit's alpha-aware image decoder rounds RGB by up to 2/255 even
  // with unpremultiplied Blob decoding; alpha remains exact. This tight bound
  // detects lost/premultiplied/protected bytes without demanding a decoder's
  // unspecified rounding behavior. Chromium reproduces these pixels exactly.
  for(let layer=0;layer<5;layer++)for(let channel=0;channel<4;channel++)expect(Math.abs(packed[layer][channel]-expected[layer][channel])).toBeLessThanOrEqual(channel===3?0:2);
  expect(await page.evaluate(()=>document.querySelector('canvas')!.getContext('webgl2')!.getError())).toBe(0);
});

test('Master, Engine and Environment change actual output through pause and focus loss',async({page})=>{
  await page.addInitScript(()=>{
    if(typeof AudioContext==='undefined')return;
    // Firefox-family runtimes may lack cancelAndHoldAtTime. Exercise the
    // capability fallback against actual output, not only stored gain values.
    Object.defineProperty(AudioParam.prototype,'cancelAndHoldAtTime',{value:undefined,configurable:true});
    const Original=AudioContext;
    const Worklet=AudioWorkletNode;
    window.AudioWorkletNode=new Proxy(Worklet,{construct(target,args){const node=Reflect.construct(target,args,target) as AudioWorkletNode;(window as unknown as {__testVoice:AudioWorkletNode}).__testVoice=node;return node;}});
    window.AudioContext=new Proxy(Original,{construct(target,args){
      // Keep the native WebIDL constructor identity when instrumenting audio.
      const ctx=Reflect.construct(target,args,target) as AudioContext;
      (window as unknown as {__testAudio:AudioContext}).__testAudio=ctx;
      const gain=ctx.createGain.bind(ctx),compressor=ctx.createDynamicsCompressor.bind(ctx);
      ctx.createGain=()=>{const node=gain();const probe=window as unknown as {__testGains:GainNode[]};(probe.__testGains??=[]).push(node);return node;};
      ctx.createDynamicsCompressor=()=>{const node=compressor();(window as unknown as {__testLimiter:DynamicsCompressorNode}).__testLimiter=node;return node;};
      return ctx;
    }});
  });
  await start(page);
  if(!await page.evaluate(()=>typeof AudioContext!=='undefined')){
    await page.keyboard.press('Escape');await expect(page.locator('#master')).toBeDisabled();await expect(page.locator('#engine')).toBeDisabled();await expect(page.locator('#environment')).toBeDisabled();
    await expect(page.locator('#audio-status')).toContainText('unavailable');return;
  }
  expect((await snapshot(page)).audio.available).toBe(true);
  expect((await snapshot(page)).audio.volumes).toMatchObject({master:.7,engine:.7,environment:.65});
  await page.evaluate(()=>{
    const probe=window as unknown as {__testAudio:AudioContext;__testGains:GainNode[];__testAnalyser:AnalyserNode;__testBeforeMaster:AnalyserNode;__testLimiter:DynamicsCompressorNode};
    probe.__testAnalyser=probe.__testAudio.createAnalyser();probe.__testAnalyser.fftSize=2048;
    probe.__testGains[0].connect(probe.__testAnalyser);
    probe.__testBeforeMaster=probe.__testAudio.createAnalyser();probe.__testBeforeMaster.fftSize=2048;probe.__testLimiter.connect(probe.__testBeforeMaster);
  });
  const level=()=>page.evaluate(()=>{
    const analyser=(window as unknown as {__testAnalyser:AnalyserNode}).__testAnalyser;
    const values=new Float32Array(analyser.fftSize);analyser.getFloatTimeDomainData(values);
    return Math.sqrt(values.reduce((sum,v)=>sum+v*v,0)/values.length);
  });
  const set=async(master:number,engine:number,environment:number)=>{
    await page.keyboard.press('Escape');
    await page.evaluate(values=>{for(const [id,value] of Object.entries(values)){const control=document.getElementById(id) as HTMLInputElement;control.value=String(value);control.dispatchEvent(new Event('input',{bubbles:true}));}},{master,engine,environment});
    await resume(page);await page.waitForTimeout(300);
  };
  await set(100,100,0);expect(await level()).toBeLessThan(.00001);
  await page.keyboard.down('w');await page.waitForTimeout(600);await page.keyboard.up('w');await page.keyboard.press('t');await page.waitForTimeout(400);
  expect((await snapshot(page)).audio.engineActivated).toBe(true);
  const engineOnly=await level();expect(engineOnly).toBeGreaterThan(.003);
  await set(100,0,100);const environmentOnly=await level();expect(environmentOnly).toBeGreaterThan(.001);
  await set(50,0,100);
  const ratio=await page.evaluate(()=>{
    const probe=window as unknown as {__testAnalyser:AnalyserNode;__testBeforeMaster:AnalyserNode};
    const rms=(node:AnalyserNode)=>{const values=new Float32Array(node.fftSize);node.getFloatTimeDomainData(values);return Math.sqrt(values.reduce((sum,v)=>sum+v*v,0)/values.length);};
    return rms(probe.__testAnalyser)/rms(probe.__testBeforeMaster);
  });expect(ratio).toBeGreaterThan(.45);expect(ratio).toBeLessThan(.55);
  await set(0,100,100);expect(await level()).toBeLessThan(.00001);
  await set(100,0,0);expect(await level()).toBeLessThan(.00001);
  const nodes=(await snapshot(page)).audio.nodes;
  await page.evaluate(()=>window.dispatchEvent(new Event('blur')));await page.waitForTimeout(80);
  expect((await snapshot(page)).audio.state).toBe('suspended');
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));expect((await snapshot(page)).audio.state).toBe('suspended');
  await page.evaluate(()=>{const control=document.getElementById('engine') as HTMLInputElement;control.value='100';control.dispatchEvent(new Event('input',{bubbles:true}));});
  await resume(page);await page.waitForTimeout(300);
  expect(await level()).toBeGreaterThan(.003);expect((await snapshot(page)).audio.nodes).toBe(nodes);
  await page.evaluate(()=>{
    const probe=window as unknown as {__testVoice?:AudioWorkletNode;__testAudio:AudioContext};
    if(probe.__testVoice)probe.__testVoice.dispatchEvent(new Event('processorerror'));else void probe.__testAudio.close();
  });
  await expect.poll(async()=>(await snapshot(page)).audio.state).toBe('closed');
  expect((await snapshot(page)).audio.nodes).toBe(0);expect((await snapshot(page)).state).toBe('running');
  await page.keyboard.press('Escape');await expect(page.locator('#master')).toBeDisabled();await expect(page.locator('#engine')).toBeDisabled();await expect(page.locator('#environment')).toBeDisabled();
  await expect(page.locator('#audio-status')).toContainText('unavailable');
});

test('missing accepted engine resource keeps driving playable without the dismissed synth',async({page})=>{
  await page.route('**/audio/rimmile-engine.bin',route=>route.fulfill({status:404,body:''}));
  await start(page);if(!await page.evaluate(()=>typeof AudioContext!=='undefined'))return;
  expect((await snapshot(page)).audio.available).toBe(false);
  expect((await snapshot(page)).audio.nodes).toBe(0);
  await page.keyboard.down('w');await expect.poll(async()=>(await snapshot(page)).speed).toBeGreaterThan(1);await page.keyboard.up('w');
  await page.keyboard.press('Escape');await expect(page.locator('#engine')).toBeDisabled();
});

test('accepted stereo engine banks are shared, bounded and do not register the old synth',async({page})=>{
  await page.addInitScript(()=>{
    if(typeof AudioWorklet==='undefined')return;
    const original=AudioWorklet.prototype.addModule;
    (window as unknown as {engineModules:string[]}).engineModules=[];
    AudioWorklet.prototype.addModule=function(...args:Parameters<typeof original>){(window as unknown as {engineModules:string[]}).engineModules.push(String(args[0]));return original.apply(this,args);};
  });
  await start(page);if(!await page.evaluate(()=>typeof AudioContext!=='undefined'))return;
  const audio=await page.evaluate(()=>window.__rimmile.snapshot().audio as unknown as {voice:{kind:string;decodedBytes:number};nodes:number});
  expect(audio.voice.kind).toBe('sampled');expect(audio.voice.decodedBytes).toBeGreaterThan(9e6);expect(audio.voice.decodedBytes).toBeLessThan(12e6);
  expect(audio.nodes).toBeLessThan(60);
  expect(await page.evaluate(()=>(window as unknown as {engineModules:string[]}).engineModules)).toHaveLength(0);
});

test('missing nature recording retains procedural ambience and a playable engine',async({page})=>{
  await page.route('**/night-crickets.mp3*',route=>route.fulfill({status:404,body:''}));
  await start(page);
  const audio=(await snapshot(page)).audio;
  if(!await page.evaluate(()=>typeof AudioContext!=='undefined'))return;
  expect(audio.available).toBe(true);expect(audio.nature.loaded).toBe(false);
  expect(audio.nature.decodedBytes).toBe(0);expect(audio.engineActivated).toBe(false);
  await page.keyboard.down('w');await expect.poll(async()=>(await snapshot(page)).audio.engineActivated).toBe(true);await page.keyboard.up('w');
  await page.keyboard.press('Escape');await page.waitForTimeout(80);expect((await snapshot(page)).audio.state).toBe('suspended');
  await resume(page);await expect.poll(async()=>(await snapshot(page)).audio.state).toBe('running');
});

test('corrupt accepted engine resource closes audio while the game remains playable',async({page})=>{
  await page.route('**/audio/rimmile-engine.bin',route=>route.fulfill({status:200,contentType:'application/octet-stream',body:'corrupt engine'}));
  await start(page);expect((await snapshot(page)).state).toBe('running');
  const audio=(await snapshot(page)).audio;
  expect(audio.available).toBe(false);expect(audio.nodes).toBe(0);
  expect(['closed','unavailable']).toContain(audio.state);
  await page.keyboard.press('Escape');await expect(page.locator('#master')).toBeDisabled();await expect(page.locator('#engine')).toBeDisabled();await expect(page.locator('#environment')).toBeDisabled();
  await expect(page.locator('#audio-status')).toContainText('unavailable');
});

test('live recorded layers share one firing pitch and follow gearbox RPM',async({page})=>{
  await page.addInitScript(()=>{
    if(typeof AudioContext==='undefined')return;
    const Original=AudioContext;
    (window as unknown as {__pitchSources:AudioBufferSourceNode[]}).__pitchSources=[];
    window.AudioContext=new Proxy(Original,{construct(target,args){
      const ctx=Reflect.construct(target,args,target) as AudioContext,create=ctx.createBufferSource.bind(ctx);
      ctx.createBufferSource=()=>{const source=create();(window as unknown as {__pitchSources:AudioBufferSourceNode[]}).__pitchSources.push(source);return source;};return ctx;
    }});
  });
  await start(page);
  if(!(await snapshot(page)).audio.available){await page.keyboard.press('Escape');await expect(page.locator('#master')).toBeDisabled();return;}
  await page.keyboard.down('w');await expect.poll(async()=>(await snapshot(page)).drivetrain.rpm,{timeout:15000}).toBeGreaterThan(7800);
  const pitch=await page.evaluate(()=>{
    const banks=[{duration:4.6664399093,rpm:5300},{duration:10.8421088435,rpm:7700},{duration:2.4434467120,rpm:6900},{duration:10.1984580499,rpm:7900}];
    const sources=(window as unknown as {__pitchSources:AudioBufferSourceNode[]}).__pitchSources;
    return banks.map(bank=>{const source=sources.find(source=>Math.abs((source.buffer?.duration??0)-(bank.duration-.08))<.013);return source?source.playbackRate.value*bank.rpm/1.15:0;});
  });await page.keyboard.up('w');
  expect(pitch).toHaveLength(4);expect(Math.min(...pitch)).toBeGreaterThan(5000);expect(Math.max(...pitch)).toBeLessThanOrEqual(7801);
  expect(Math.max(...pitch)-Math.min(...pitch)).toBeLessThan(100);
});

test('context loss returns to Retry and rebuilds the game', async ({ page }) => {
  await start(page);
  await page.evaluate(async()=>{
    const module='/src/world/road.ts',{roadAt}=await import(module);
    await window.__rimmile.inspectPosition(roadAt(800,1942).x+340,800);
  });
  await page.keyboard.press('Escape');await resume(page);
  await expect(page.locator('#recovery-status')).toContainText('Returning to road');
  await page.evaluate(() => (document.querySelector('canvas')!.getContext('webgl2')!).getExtension('WEBGL_lose_context')!.loseContext());
  await expect(page.locator('#load-status')).toContainText('graphics connection was lost');
  await expect(page.locator('#recovery-status')).toBeEmpty();
  await resume(page);
  await expect(page.locator('#hud')).toBeVisible({ timeout: 60000 });
  expect((await snapshot(page)).recovery.seconds).toBe(0);
  await expect(page.locator('#recovery-status')).toBeEmpty();
});


test('session lights control disables actual lamps, preserves braking and survives remapping, pause and Retry',async({page})=>{
  test.setTimeout(180000);await start(page);
  const lamps=async(on:boolean)=>{
    await expect.poll(async()=>(await snapshot(page)).vehicle.lightsOn).toBe(on);
    const vehicle=(await snapshot(page)).vehicle;
    expect(vehicle.headlights.every(light=>light.visible===on&&light.shadow===on&&(on?light.intensity>0:light.intensity===0))).toBe(true);
    await expect(page.locator('#lights')).toHaveCount(0);
  };
  await lamps(true);await page.keyboard.press('l');await lamps(false);
  expect((await snapshot(page)).vehicle.tailEmission).toBe(0);expect((await snapshot(page)).vehicle.rearIntensity).toBe(0);
  await page.keyboard.down('w');await expect.poll(async()=>(await snapshot(page)).speed).toBeGreaterThan(3);await page.keyboard.up('w');
  await page.keyboard.down('s');await expect.poll(async()=>(await snapshot(page)).vehicle.tailEmission).toBe(3);await page.keyboard.up('s');
  await page.keyboard.down('l');await lamps(true);await page.keyboard.down('l');await lamps(true);await page.keyboard.up('l');
  await page.keyboard.press('l');await lamps(false);await page.keyboard.press('Escape');
  await page.keyboard.press('l');expect((await snapshot(page)).vehicle.lightsOn).toBe(false);
  await page.locator('#landing-settings').click();await page.locator('[data-graphics="resolution"][data-value="Medium"]').click();
  await page.locator('[data-binding="lights"]').click();await page.keyboard.press('w');await expect(page.locator('#binding-status')).toContainText('assigned to another');
  await page.keyboard.press('Escape');await expect(page.locator('#settings-page')).toBeVisible();
  await page.locator('[data-binding="lights"]').click();await page.keyboard.press('k');await expect(page.locator('[data-binding="lights"]')).toHaveText('K');
  await resume(page);await lamps(false);await page.keyboard.press('l');await lamps(false);await page.keyboard.press('k');await lamps(true);
  await openSettings(page);await page.locator('#reset-controls').click();await expect(page.locator('[data-binding="lights"]')).toHaveText('L');await resume(page);
  await page.keyboard.press('l');await lamps(false);await page.evaluate(()=>window.dispatchEvent(new Event('blur')));
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));expect((await snapshot(page)).state).toBe('paused');await resume(page);await lamps(false);
  await page.evaluate(()=>document.getElementById('game')!.dispatchEvent(new Event('webglcontextlost',{cancelable:true})));
  await expect(page.locator('#play')).toHaveText('- Retry -');await page.locator('#play').click();await expect(page.locator('#hud')).toBeVisible({timeout:60000});await lamps(false);
  expect((await snapshot(page)).vehicle.tailEmission).toBe(0);await page.keyboard.press('l');await lamps(true);
});


test('deep water stops propulsion, freezes the shared countdown in menus and supports manual/automatic return',async({page})=>{
  test.setTimeout(180000);await start(page);
  const enter=async()=>{
    await page.evaluate(async()=>{const path='/src/world/road.ts',{riverAt}=await import(path),water=riverAt(1000,1942);await window.__rimmile.inspectPosition(water.x,1000);});
    await page.keyboard.press('Escape');await resume(page);
    await expect.poll(async()=>(await snapshot(page)).recovery.submerged).toBe(true);
    await expect.poll(async()=>(await snapshot(page)).recovery.seconds,{timeout:6000}).toBeGreaterThan(0);
    await expect(page.locator('#recovery-status')).toContainText('Returning to road');
  };
  await enter();await page.keyboard.down('w');await page.waitForTimeout(350);await page.keyboard.up('w');
  const stopped=await snapshot(page);expect(Math.abs(stopped.speed)).toBeLessThan(1);expect(stopped.recovery.reason).toBe('water');
  await page.keyboard.press('Escape');const paused=await snapshot(page);await page.waitForTimeout(1500);
  expect((await snapshot(page)).recovery.seconds).toBe(paused.recovery.seconds);expect((await snapshot(page)).x).toBe(paused.x);
  await resume(page);await page.keyboard.press('t');expect((await snapshot(page)).recovery.submerged).toBe(false);await expect(page.locator('#recovery-status')).toBeEmpty();
  await enter();await expect.poll(async()=>(await snapshot(page)).recovery.submerged,{timeout:10000}).toBe(false);
  await expect(page.locator('#recovery-status')).toBeEmpty();expect((await snapshot(page)).speed).toBe(0);
});
