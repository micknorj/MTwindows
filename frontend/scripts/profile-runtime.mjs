import { chromium, webkit } from '@playwright/test';
import { createServer } from 'vite';
import { mkdir, writeFile } from 'node:fs/promises';

// Local diagnostic, never part of the browser build. Run browsers sequentially.
const engine = process.argv.includes('--chromium') ? 'chromium' : 'webkit';
const native = engine === 'chromium' && process.argv.includes('--native');
const sweepOnly=process.argv.includes('--sweep-only');
const routeScenes=process.argv.includes('--route-scenes');
const waterScene=process.argv.includes('--water');
const highSpeed=process.argv.includes('--high-speed');
const speedKmh=Number(process.argv.find(a=>a.startsWith('--speed='))?.split('=')[1]??350);
if(!Number.isFinite(speedKmh)||speedKmh<100||speedKmh>350)throw Error('Profile speed must be 100–350 km/h.');
const seconds=Number(process.argv.find(a=>a.startsWith('--seconds='))?.split('=')[1]??18);
if(!Number.isFinite(seconds)||seconds<18||seconds>600)throw Error('Profile duration must be 18–600 seconds.');
const onlyQuality=process.argv.find(a=>a.startsWith('--quality='))?.split('=')[1];
if(onlyQuality&&!['Auto','Low','Medium','High'].includes(onlyQuality))throw Error('Invalid profile quality');
const finiteCompare=process.argv.includes('--finite-compare');
const releaseCompare=process.argv.includes('--release-compare');
const observations=[];
const foliageCompare=process.argv.includes('--foliage-compare');
const profileKey = `${engine}${native?'-native':''}${sweepOnly?'-isolation':''}${waterScene?'-water':''}${highSpeed?`-${speedKmh}kmh`:''}${foliageCompare?'-foliage-compare':''}${routeScenes?'-routes':''}${releaseCompare?'-release-compare':''}${finiteCompare?'-finite-compare':''}${seconds>18?`-${seconds}s`:''}`;
const server = await createServer({configFile:'frontend/vite.config.ts', mode: 'test', server: { host: '127.0.0.1', port: 5176, strictPort: true, hmr: false } });
let browser;
async function openSettings(page){if(await page.locator('#settings-page').isHidden())await page.locator('#landing-settings').click();}
async function resume(page){if(await page.locator('#settings-page').isVisible())await page.locator('#settings-back').click();if(await page.locator('#play').isVisible())await page.locator('#play').click();}
async function chooseQuality(page,quality){await openSettings(page);for(const key of ['resolution','shadows','trees','grass','terrain','distant'])await page.locator(`[data-graphics="${key}"][data-value="${quality==='Auto'&&key!=='resolution'?'Medium':quality}"]`).click();}
try {
  await server.listen();
  browser = await (engine === 'chromium' ? chromium : webkit).launch(engine === 'chromium' ? { args: native ? (process.platform==='win32'?['--use-angle=d3d11']:[]) : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] } : {});
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.setDefaultTimeout(90000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.addInitScript(() => {
    const buffers=new Map(),data=WebGL2RenderingContext.prototype.bufferData,release=WebGL2RenderingContext.prototype.deleteBuffer;
    WebGL2RenderingContext.prototype.bufferData=function(target,source,usage,...range){
      const buffer=this.getParameter(target===this.ARRAY_BUFFER?this.ARRAY_BUFFER_BINDING:this.ELEMENT_ARRAY_BUFFER_BINDING);
      buffers.set(buffer,typeof source==='number'?source:source?.byteLength??0);return data.call(this,target,source,usage,...range);
    };
    WebGL2RenderingContext.prototype.deleteBuffer=function(buffer){buffers.delete(buffer);return release.call(this,buffer);};
    window.__graphicsMemory=()=>({buffers:buffers.size,bufferBytes:[...buffers.values()].reduce((a,b)=>a+b,0),jsHeapBytes:performance.memory?.usedJSHeapSize??null,caveat:'Tracked GL buffer allocation sizes and Chromium JS heap; not total GPU/driver/process working memory.'});
    const original = crypto.getRandomValues.bind(crypto);
    crypto.getRandomValues = values => { original(values); if (values instanceof Uint32Array && values.length === 1) values[0] = 1942; return values; };
  });
  await page.goto('http://127.0.0.1:5176/');
  if(highSpeed)await page.evaluate(async(speedKmh)=>{
    const {VehiclePhysics}=await import('/src/vehicle/physics.ts'),{roadAt}=await import('/src/world/road.ts');const step=VehiclePhysics.prototype.step;
    window.__profileRestorePhysics=()=>{VehiclePhysics.prototype.step=step;};
    VehiclePhysics.prototype.step=function(dt,input){
      const speed=speedKmh/3.6,oldZ=this.z,p=roadAt(oldZ,this.seed);this.setSpeed(speed);step.call(this,dt,input);
      const z=oldZ+speed*dt/Math.sqrt(1+p.dx*p.dx),next=roadAt(z,this.seed);this.z=z;this.x=next.x-Math.cos(next.heading)*1.7;this.heading=next.heading;this.setSpeed(speed);
    };
  },speedKmh);
  // Diagnostic-only asynchronous GPU timing, never shipped in the game. Four
  // reusable query slots bound memory; epochs exclude previous preset results.
  await page.evaluate(async()=>{
    const {GameView}=await import('/src/rendering/view.ts');
    const {WorldStream}=await import('/src/world/stream.ts');
    const tick=WorldStream.prototype.tick;
    WorldStream.prototype.tick=function(z,x,camera,...prediction){window.__profileForest=this.sceneryAssets;return tick.call(this,z,x,window.__gpuProfile?.mask==='no-cull'?undefined:camera,...prediction);};
    const draw=GameView.prototype.render,dispose=GameView.prototype.dispose,follow=GameView.prototype.follow;
    const state={values:[],epoch:0,timer:null};
    window.__gpuProfile={mask:'',pinCamera:false,reset:()=>{state.values=[];state.epoch++;},read:()=>{
      const values=[...state.values].sort((a,b)=>a-b),n=values.length;
      return {available:!!state.timer,samples:n,medianMs:values[Math.floor((n-1)*.5)]??null,p95Ms:values[Math.floor((n-1)*.95)]??null};
    }};
    GameView.prototype.follow=function(...args){
      if(window.__gpuProfile.pinCamera&&!this.rtPinnedCamera)this.rtPinnedCamera={position:this.camera.position.clone(),quaternion:this.camera.quaternion.clone(),fov:this.camera.fov};
      follow.apply(this,args);
      if(window.__gpuProfile.pinCamera){const pose=this.rtPinnedCamera;this.camera.position.copy(pose.position);this.camera.quaternion.copy(pose.quaternion);this.camera.fov=pose.fov;this.camera.updateProjectionMatrix();}
    };
    GameView.prototype.render=function(elapsed=0){
      window.__profileScene=this.scene;
      const mask=window.__gpuProfile.mask,hidden=[],shadows=this.renderer.shadowMap.enabled;
      if(mask==='no-shadows')this.renderer.shadowMap.enabled=false;
      if(mask==='no-ground'||mask==='no-foliage'||mask==='no-images'||mask==='no-water')this.scene.traverse(object=>{
        if(!object.isMesh||!object.visible)return;
        const materials=Array.isArray(object.material)?object.material:[object.material];
        const hide=materials.some(mat=>mask==='no-ground'?/rimmile-(terrain|asphalt|gravel|water)-/.test(mat.customProgramCacheKey()):mask==='no-water'?mat.customProgramCacheKey().includes('rimmile-water-'):mask==='no-images'?mat.customProgramCacheKey().includes('rimmile-tree-impostor'):mat.alphaTest>.3||mat.customProgramCacheKey().includes('fade-grass'))
          ||mask==='no-foliage'&&object.customDepthMaterial?.map?.isCanvasTexture;
        if(hide){hidden.push(object);object.visible=false;}
      });
      const gl=this.renderer.getContext();
      if(this.rtProfileSlots===undefined){state.timer=gl.getExtension('EXT_disjoint_timer_query_webgl2');this.rtProfileSlots=state.timer?Array.from({length:4},()=>({query:gl.createQuery(),pending:false,epoch:0})):[];}
      const restore=()=>{for(const object of hidden)object.visible=true;this.renderer.shadowMap.enabled=shadows;};
      if(!state.timer){try{return draw.call(this,elapsed);}finally{restore();}}
      const disjoint=gl.getParameter(state.timer.GPU_DISJOINT_EXT);
      for(const slot of this.rtProfileSlots)if(slot.pending&&gl.getQueryParameter(slot.query,gl.QUERY_RESULT_AVAILABLE)){
        if(!disjoint&&slot.epoch===state.epoch){state.values.push(gl.getQueryParameter(slot.query,gl.QUERY_RESULT)/1e6);if(state.values.length>240)state.values.shift();}slot.pending=false;
      }
      if(disjoint){state.values=[];state.epoch++;}
      const slot=elapsed>0&&this.queue.ready()?this.rtProfileSlots.find(q=>!q.pending):undefined;
      if(slot){gl.beginQuery(state.timer.TIME_ELAPSED_EXT,slot.query);slot.epoch=state.epoch;}
      try{return draw.call(this,elapsed);}finally{if(slot){gl.endQuery(state.timer.TIME_ELAPSED_EXT);slot.pending=true;}restore();}
    };
    GameView.prototype.dispose=function(){const gl=this.renderer.getContext();for(const slot of this.rtProfileSlots??[])gl.deleteQuery(slot.query);return dispose.call(this);};
  });
  await openSettings(page);
  await chooseQuality(page,'Low');
  await page.locator('#master').focus(); await page.keyboard.press('Home');
  await resume(page);

  await page.locator('#hud').waitFor({ state: 'visible' });
  if (await page.locator('#play').isVisible()) await resume(page);
  const hardware = await page.evaluate(() => {
    const gl = document.querySelector('canvas').getContext('webgl2');
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    return { renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : 'unavailable', vendor: debug ? gl.getParameter(debug.UNMASKED_VENDOR_WEBGL) : 'unavailable', dpr: devicePixelRatio, timerQueries: !!gl.getExtension('EXT_disjoint_timer_query_webgl2') };
  });
  const presets = [];
  if(waterScene){
    await page.evaluate(async()=>{
      await window.__rimmile.inspectDistance(window.__rimmile.snapshot().crossing+65);
      const {riverAt,roadAt}=await import('/src/world/road.ts');
      const p=window.__rimmile.snapshot(),road=roadAt(p.z,1942),river=riverAt(p.z,1942);
      const x=(river.x-p.x)*Math.cos(road.heading),z=(river.x-p.x)*Math.sin(road.heading),y=river.y-road.y;
      await window.__rimmile.inspectCamera([x-7,y+3,z-7],[x,y,z+15]);
      window.__gpuProfile.pinCamera=true;
    });
  }
  for (const quality of onlyQuality?[onlyQuality]:(sweepOnly||routeScenes)?['High']:['Low', 'Medium', 'High']) {
    await page.keyboard.press('Escape');
    await chooseQuality(page,quality);
    await page.evaluate(()=>window.__gpuProfile.reset());
    await resume(page);
    for(let elapsed=0;elapsed<seconds;elapsed+=Math.min(15,seconds-elapsed)){
      await page.waitForTimeout(Math.min(15,seconds-elapsed)*1000);
      observations.push({quality,elapsedSeconds:Math.min(seconds,elapsed+15),snapshot:await page.evaluate(()=>window.__rimmile.snapshot()),memory:await page.evaluate(()=>window.__graphicsMemory()),gpu:await page.evaluate(()=>window.__gpuProfile.read())});
    }
    const snapshot = await page.evaluate(() => window.__rimmile.snapshot());
    const gpu=await page.evaluate(()=>window.__gpuProfile.read());
    const memory=await page.evaluate(()=>window.__graphicsMemory());presets.push({ quality, ...snapshot, gpu,memory });
    console.log(`${engine} ${quality}: ${snapshot.performance.samples} frames, median ${snapshot.performance.frameMedianMs.toFixed(1)} ms, p95 ${snapshot.performance.frameP95Ms.toFixed(1)} ms, GPU ${gpu.medianMs?.toFixed(1)??'unavailable'} ms, ${snapshot.calls} calls/${snapshot.triangles} triangles`);
    await page.screenshot({ path: `test-results/profile-${profileKey}-${quality.toLowerCase()}.png` });
    const frame=await page.evaluate(()=>window.__rimmile.inspectFrame());
    await writeFile(`test-results/profile-${profileKey}-${quality.toLowerCase()}-scene.png`,Buffer.from(frame.split(',')[1],'base64'));
  }
  const routes=[];
  if(routeScenes){
    const poses=await page.evaluate(async()=>{
      const {planRoad}=await import('/src/world/road.ts'),found=new Map();
      for(let i=0;i<80;i++){const p=planRoad(i,1942);if(!found.has(p.style))found.set(p.style,{style:p.style,z:i*6000+3000});}
      const tunnels=await import('/src/world/road.ts');for(let i=0;i<100;i++){const t=tunnels.tunnelPlan(i,1942);if(t){found.set('tunnel',{style:'tunnel',z:t.center});found.set('portal',{style:'portal',z:t.start-35});break;}}return [...found.values()];
    });
    for(const pose of poses){
      await page.evaluate(z=>window.__rimmile.inspectDistance(z),pose.z);
      await page.keyboard.press('Escape');await resume(page);await page.waitForTimeout(2000);
      await page.evaluate(()=>window.__gpuProfile.reset());await page.waitForTimeout(5000);
      const snapshot=await page.evaluate(()=>window.__rimmile.snapshot()),gpu=await page.evaluate(()=>window.__gpuProfile.read()),memory=await page.evaluate(()=>window.__graphicsMemory());
      if(!gpu.samples)throw Error('No measured route frames.');
      routes.push({...pose,...snapshot,gpu,memory});console.log('Route scene',pose.style,pose.z,gpu,snapshot.cpuFrames);
      const frame=await page.evaluate(()=>window.__rimmile.inspectFrame());
      await writeFile(`test-results/profile-${profileKey}-${pose.style}-scene.png`,Buffer.from(frame.split(',')[1],'base64'));
    }
  }
  const sweep=[];
  if(process.argv.includes('--sweep')||sweepOnly){
    // inspectFrame pauses simulation without changing the app state; explicitly
    // dismiss the panel once so isolation phases actually submit new frames.
    await page.keyboard.press('Escape');await resume(page);
  }
  if(process.argv.includes('--sweep')||sweepOnly)for(const mask of finiteCompare?['finite-before','finite-after','finite-before','finite-after']:releaseCompare?['before-release','after-release','before-release','after-release']:foliageCompare?['middle-diffuse','middle-pbr','middle-diffuse','middle-pbr']:waterScene?['','no-water','','no-water']:process.argv.includes('--cull-compare')?['','no-cull','','no-images']:['','no-shadows','no-ground','no-foliage']){
    if(finiteCompare)await page.evaluate(phase=>{
      if(!window.__finiteComparison){
        const materials=new Set();window.__profileScene.traverse(object=>{if(object.isMesh)for(const material of Array.isArray(object.material)?object.material:[object.material])materials.add(material);});
        window.__finiteComparison=[...materials].map(material=>({material,compile:material.onBeforeCompile,key:material.customProgramCacheKey}));
      }
      for(const entry of window.__finiteComparison){
        const before=phase==='finite-before';
        entry.material.onBeforeCompile=before?(shader,renderer)=>{entry.compile.call(entry.material,shader,renderer);shader.fragmentShader=shader.fragmentShader.replace('if ( directLight.visible ) { // rimmile finite-light begin','// rimmile finite-light bypass').replace('} // rimmile finite-light end','// rimmile finite-light bypass end');}:entry.compile;
        entry.material.customProgramCacheKey=before?()=>entry.key.call(entry.material)+'-finite-before':entry.key;entry.material.needsUpdate=true;
      }
    },mask);
    if(releaseCompare)await page.evaluate(phase=>{
      const assets=window.__profileForest;
      if(!window.__releaseComparison)window.__releaseComparison={compile:assets.shadowMaterial.onBeforeCompile,key:assets.shadowMaterial.customProgramCacheKey,forestCompile:assets.impostors.onBeforeCompile,forestKey:assets.impostors.customProgramCacheKey};
      const before=phase==='before-release';
      assets.impostors.onBeforeCompile=before?(shader,renderer)=>{window.__releaseComparison.forestCompile.call(assets.impostors,shader,renderer);shader.fragmentShader=shader.fragmentShader.replace('#if 0 // rimmile distant headlight exclusion','#if ( NUM_SPOT_LIGHTS > 0 ) && defined( RE_Direct )');}:window.__releaseComparison.forestCompile;
      assets.impostors.customProgramCacheKey=before?()=> 'release-before-forest':window.__releaseComparison.forestKey;assets.impostors.needsUpdate=true;
      window.__profileScene.traverse(object=>{if(object.isMesh&&object.material===assets.impostors)object.receiveShadow=before;});
      assets.shadowMaterial.onBeforeCompile=before?()=>{}:window.__releaseComparison.compile;
      assets.shadowMaterial.customProgramCacheKey=before?()=> 'release-before-main-shadow-proxy':window.__releaseComparison.key;assets.shadowMaterial.needsUpdate=true;
    },mask);
    if(foliageCompare)await page.evaluate(async variant=>{
      if(!window.__foliageComparison){
        const {plantFade}=await import('/src/world/tree-assets.ts'),{plantWind,vegetationMaterial}=await import('/src/rendering/world-materials.ts');
        const assets=window.__profileForest,materials=[],meshes=[];
        if(Object.values(assets.middleMaterials).some(material=>!material.isMeshLambertMaterial))throw Error('This capability-constrained renderer retains PBR foliage; a diffuse/PBR comparison is unavailable.');
        for(const [kind,diffuse] of Object.entries(assets.middleMaterials)){
          const pbr=vegetationMaterial(plantFade(plantWind(assets.materials[kind].clone(),assets.state),assets.state,1),assets.state);materials.push(pbr);
          window.__profileScene.traverse(object=>{if(object.isMesh&&object.material===diffuse)meshes.push({object,diffuse,pbr});});
        }
        window.__foliageComparison={materials,meshes};
      }
      for(const entry of window.__foliageComparison.meshes)entry.object.material=variant==='middle-pbr'?entry.pbr:entry.diffuse;
    },mask);
    await page.evaluate(mask=>{window.__gpuProfile.mask=mask;},mask);await page.waitForTimeout(2000);
    await page.evaluate(()=>window.__gpuProfile.reset());await page.waitForTimeout(5000);
    if(finiteCompare){const frame=await page.evaluate(()=>window.__rimmile.inspectFrame());await writeFile(`test-results/profile-${profileKey}-${mask}-scene.png`,Buffer.from(frame.split(',')[1],'base64'));await page.keyboard.press('Escape');await resume(page);}
    const gpu=await page.evaluate(()=>window.__gpuProfile.read());if(gpu.available&&gpu.samples===0)throw new Error('GPU isolation submitted no measured frames.');sweep.push({component:mask||'full-high',gpu});console.log('GPU isolation',mask||'full-high',gpu);
  }
  await page.evaluate(()=>window.__gpuProfile.mask='');
  await page.keyboard.press('Escape');
  if(foliageCompare)await page.evaluate(()=>{
    for(const entry of window.__foliageComparison.meshes)entry.object.material=entry.diffuse;
    for(const material of window.__foliageComparison.materials)material.dispose();
  });
  await page.evaluate(()=>window.__profileRestorePhysics?.());
  const cpu = await page.evaluate(async () => {
    const { generateChunk } = await import('/src/world/generate.ts');
    const { VehiclePhysics } = await import('/src/vehicle/physics.ts');
    const { roadAt } = await import('/src/world/road.ts');
    for (let id = 0; id < 3; id++) generateChunk(id, 1942);
    const costs = [];
    for (const id of [0, 5, -7, 31, 65, -66, 5000, -5000, 500000]) {
      const start = performance.now(); const data = generateChunk(id, 1942);
      costs.push({ id, ms: performance.now() - start, bytes: data.structure.byteLength+data.excavation.byteLength+data.tunnel.byteLength+data.tunnelLamps.byteLength+data.terrain.byteLength + data.terrainNormals.byteLength + data.colors.byteLength + data.road.byteLength + data.shoulder.byteLength+data.shoulderColors.byteLength + data.markings.byteLength + data.water.byteLength + data.waterColors.byteLength + data.scenery.railPitch.byteLength + Object.values(data.scenery.instances).reduce((sum, values) => sum + values.byteLength, 0) });
    }
    const car = new VehiclePhysics(1942), milestones = {}, start = performance.now();
    for (let i = 0; i < 60 * 90; i++) {
      // Guided route calibration separates powertrain response from keyboard cornering ability.
      const road = roadAt(car.z, 1942); car.x = road.x - 1.7; car.heading = road.heading;
      car.step(1 / 60, { throttle: true, brake: false, steer: 0 });
      for (const speed of [100, 200, 300, 350]) if (!milestones[speed] && car.speed * 3.6 >= speed) milestones[speed] = (i + 1) / 60;
    }
    return { chunks: costs, guidedDrivetrain: { milestonesSeconds: milestones, speedAfter90SecondsKmh: car.speed * 3.6, gear: car.drivetrain.gear, rpm: car.drivetrain.rpm, cpuMs: performance.now() - start, caveat: 'Guided generated road; excludes steering and obstacles, is not a flat-track/reference-vehicle match.' } };
  });
  await mkdir('test-results', { recursive: true });
  await writeFile(`test-results/profile-${profileKey}.json`, JSON.stringify({ date: new Date().toISOString(), engine, native, sharedProductionResources:true, seed: 1942, viewport: '1280x720', scene:waterScene?'riverbank':highSpeed?`guided ${speedKmh} km/h render/streaming path`:'stationary chase', hardware, measurement: `${seconds} s per preset, bounded 240 submitted intervals/GPU queries. High-speed mode guides a constant ${speedKmh} km/h path for rendering/streaming measurement, not handling validation. CPU render time is submission cost; gpu fields are disjoint-checked timer durations. Optional isolation: 2 s warm-up and 5 s measured.`, presets, observations, routes, sweep, cpu, errors }, null, 2));
  if (errors.length) throw new Error(errors.join('\n'));
  console.log(`Saved test-results/profile-${profileKey}.json and screenshots.`);
} finally {
  await browser?.close(); await server.close();
}
