import {chromium,webkit} from '@playwright/test';
import {createServer} from 'vite';
import {mkdir,writeFile} from 'node:fs/promises';

const engine=process.argv.includes('--chromium')?'chromium':'webkit';
const native=engine==='chromium'&&process.argv.includes('--native');
const captureKey=`${engine}${native?'-native':''}`;
const server=await createServer({configFile:'frontend/vite.config.ts',mode:'test',server:{host:'127.0.0.1',port:5176,strictPort:true,hmr:false}});
let browser;
async function openSettings(page){if(await page.locator('#settings-page').isHidden())await page.locator('#landing-settings').click();}
async function resume(page){if(await page.locator('#settings-page').isVisible())await page.locator('#settings-back').click();if(await page.locator('#play').isVisible())await page.locator('#play').click();}
async function chooseQuality(page,quality){await openSettings(page);for(const key of ['resolution','shadows','trees','grass','terrain','distant'])await page.locator(`[data-graphics="${key}"][data-value="${quality==='Auto'&&key!=='resolution'?'Medium':quality}"]`).click();}
try{
  await server.listen();browser=await(engine==='chromium'?chromium:webkit).launch(engine==='chromium'?{args:native?(process.platform==='win32'?['--use-angle=d3d11']:[]):['--use-angle=swiftshader','--enable-unsafe-swiftshader']}:{});
  const page=await browser.newPage({viewport:{width:1280,height:720}});page.setDefaultTimeout(90000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.addInitScript(()=>{const original=crypto.getRandomValues.bind(crypto);crypto.getRandomValues=v=>{original(v);if(v instanceof Uint32Array&&v.length===1)v[0]=1942;return v;};});
  await page.goto('http://127.0.0.1:5176');
  await page.evaluate(async()=>{
    const {GameView}=await import('/src/rendering/view.ts');const render=GameView.prototype.render;
    GameView.prototype.render=function(...args){if(window.__waterInspectionTime!==undefined)this.worldUniforms.time.value=window.__waterInspectionTime;return render.apply(this,args);};
  });
  await chooseQuality(page,'High');await resume(page);await page.locator('#hud').waitFor({state:'visible'});
  if(await page.locator('#play').isVisible())await resume(page);
  await mkdir('test-results',{recursive:true});
  const capture=async(name)=>{const frame=await page.evaluate(()=>window.__rimmile.inspectFrame());await writeFile(`test-results/overhaul-${captureKey}-${name}.png`,Buffer.from(frame.split(',')[1],'base64'));return frame;};
  await page.evaluate(()=>window.__rimmile.inspectDistance(0));await capture('chase');
  if(process.argv.includes('--mountains')){
    const bore=await page.evaluate(async()=>{const {tunnelPlan}=await import('/src/world/road.ts');for(let i=0;i<100;i++){const t=tunnelPlan(i,1942);if(t)return t;}throw Error('No seeded tunnel.');});
    for(const [name,z] of [['tunnel-approach',bore.start-55],['tunnel-portal',bore.start-8],['tunnel-interior',bore.center],['tunnel-exit',bore.end-20],['mountain-pass',393000],['river-bench',207000]]){await page.evaluate(z=>window.__rimmile.inspectDistance(z),z);await capture(name);}
    await page.evaluate(()=>window.__rimmile.inspectDistance(0));
  }
  if(process.argv.includes('--prepolish')){
    const spans=await page.evaluate(async()=>{const {viaductsIn}=await import('/src/world/road.ts');for(let i=0;i<30;i++){const spans=viaductsIn(i,1942);if(spans.length)return spans;}return [];});
    if(!spans.length)throw Error('Expected geography-selected viaduct.');
    const v=spans[0];await page.evaluate(z=>window.__rimmile.inspectDistance(z),(v.start+v.end)/2);await capture('viaduct-chase');
    await page.evaluate(()=>window.__rimmile.inspectCamera([24,12,-22],[0,-9,25]));await capture('viaduct-supports');
    await page.evaluate(async()=>{
      const {roadAt}=await import('/src/world/road.ts'),{terrainMeshHeight}=await import('/src/world/terrain-grid.ts');const p=window.__rimmile.snapshot(),r=roadAt(p.z,1942),c=Math.cos(r.heading),s=Math.sin(r.heading);let eye;
      for(const side of [-24,24]){const dx=c*side-s*20,dz=-s*side-c*20,y=terrainMeshHeight(p.x+dx,p.z+dz,1942)+2.2-p.y;if(!eye||y<eye[1])eye=[side,y,-20];}
      await window.__rimmile.inspectCamera(eye,[0,-1,16]);
    });await capture('viaduct-soffit');

    for(const [name,z] of [['bridge-start',v.start-5],['bridge-end',v.end+5],['river-bank-span',26780],['land-embankment',9000]]){
      await page.evaluate(z=>window.__rimmile.inspectDistance(z),z);
      if(name==='land-embankment'||name==='river-bank-span')await page.evaluate(async()=>{
        const {roadAt,riverChannelAt}=await import('/src/world/road.ts'),{terrainMeshHeight}=await import('/src/world/terrain-grid.ts');
        const p=window.__rimmile.snapshot(),r=roadAt(p.z,1942),c=Math.cos(r.heading),s=Math.sin(r.heading),dx=24,dz=-25;
        const x=p.x+c*dx+s*dz,z=p.z-s*dx+c*dz,water=riverChannelAt(z,1942);
        const y=Math.max(terrainMeshHeight(x,z,1942),Math.abs(x-water.x)<water.halfWidth?water.y:-Infinity)+3;
        await window.__rimmile.inspectCamera([dx,y-p.y,dz],[0,1,35]);
      });
      await capture(name);
    }
    await page.evaluate(z=>window.__rimmile.inspectDistance(z),(v.start+v.end)/2);
    const rock=await page.evaluate(async()=>{const {roadAt}=await import('/src/world/road.ts'),{terrainMeshHeight}=await import('/src/world/terrain-grid.ts');const p=window.__rimmile.snapshot();let best={slope:0,x:0,y:0,z:0};
      for(let dz=20;dz<=200;dz+=20)for(let side=-180;side<=180;side+=12){if(Math.abs(side)<10)continue;const z=p.z+dz,x=roadAt(z,1942).x+side,y=terrainMeshHeight(x,z,1942),slope=Math.hypot(terrainMeshHeight(x+2,z,1942)-y,terrainMeshHeight(x,z+2,1942)-y)/2;if(slope>best.slope)best={slope,x,y,z};}
      const heading=roadAt(p.z,1942).heading,local=(x,y,z)=>[(x-p.x)*Math.cos(heading)-(z-p.z)*Math.sin(heading),y-p.y,(x-p.x)*Math.sin(heading)+(z-p.z)*Math.cos(heading)];
      return {slope:best.slope,eye:local(best.x-18,best.y+11,best.z-25),target:local(best.x,best.y+2,best.z)};
    });
    await page.evaluate(r=>window.__rimmile.inspectCamera(r.eye,r.target),rock);await capture('rock-face');
    const geology=await page.evaluate(async()=>{
      const {roadAt,terrainHeight}=await import('/src/world/road.ts'),{terrainRow}=await import('/src/world/terrain-grid.ts');const p=window.__rimmile.snapshot();let best={score:0,x:0,y:0,z:0};
      for(let dz=0;dz<=400;dz+=20){const z=Math.round((p.z+dz)/10)*10,row=terrainRow(z,1942);for(let i=0;i<row.x.length;i++){
        const x=row.x[i],y=row.y[i],d=Math.abs(x-roadAt(z,1942).x);if(d<160||d>1500)continue;
        const delta=Math.abs(y-terrainHeight(x,z,1942)),score=delta*(1-row.normals[i*3+1]);if(score>best.score)best={score,x,y,z};
      }}
      if(best.score<1)throw Error('No shaped exposed mountain in inspection region.');
      const heading=roadAt(p.z,1942).heading,local=(x,y,z)=>[(x-p.x)*Math.cos(heading)-(z-p.z)*Math.sin(heading),y-p.y,(x-p.x)*Math.sin(heading)+(z-p.z)*Math.cos(heading)];
      return {score:best.score,eye:local(best.x-100,best.y+35,best.z-150),target:local(best.x,best.y-10,best.z)};
    });
    await page.evaluate(r=>window.__rimmile.inspectCamera(r.eye,r.target),geology);await capture('geological-ridge');
    await page.evaluate(()=>window.__rimmile.inspectDistance(0));
  }
  const beams=[];
  for(const [name,lamp] of [['unlit',-1],['left',0],['right',1]]){await page.evaluate(lamp=>window.__rimmile.inspectHeadlights(lamp),lamp);beams.push(await capture(name));}
  const illumination=await page.evaluate(async images=>{
    const pixels=await Promise.all(images.map(async url=>{const img=new Image();img.src=url;await img.decode();const c=document.createElement('canvas');c.width=img.width;c.height=img.height;const ctx=c.getContext('2d');ctx.drawImage(img,0,0);return ctx.getImageData(0,0,img.width,img.height);}));
    return pixels.slice(1).map(data=>{let energy=0,centre=0;for(let y=Math.floor(data.height*.43);y<data.height*.74;y++)for(let x=Math.floor(data.width*.2);x<data.width*.8;x++){const i=(y*data.width+x)*4;const light=Math.max(0,(data.data[i]+data.data[i+1]+data.data[i+2]-pixels[0].data[i]-pixels[0].data[i+1]-pixels[0].data[i+2])/3);energy+=light;centre+=x*light;}return {energy,centroidX:centre/energy};});
  },beams);
  if(!illumination.every(beam=>beam.energy>1000)||illumination[1].centroidX-illumination[0].centroidX<2)throw new Error(`Headlights did not produce distinct beams: ${JSON.stringify(illumination)}`);
  await page.evaluate(()=>window.__rimmile.inspectHeadlights(2));
  await page.evaluate(()=>window.__rimmile.inspectCamera([-6,2.3,12],[-13,4,25]));await capture('roadside');
  const crossing=await page.evaluate(()=>window.__rimmile.snapshot().crossing);
  await page.evaluate(z=>window.__rimmile.inspectDistance(z-18),crossing);
  await page.evaluate(()=>window.__rimmile.inspectCamera([5,3,-6],[1,-1,24]));await capture('bridge');
  await page.evaluate(z=>window.__rimmile.inspectDistance(z+65),crossing);
  await page.evaluate(async()=>{
    const {riverAt,roadAt}=await import('/src/world/road.ts');const p=window.__rimmile.snapshot(),road=roadAt(p.z,1942),river=riverAt(p.z,1942);
    const x=(river.x-p.x)*Math.cos(road.heading),z=(river.x-p.x)*Math.sin(road.heading),y=river.y-road.y;
    await window.__rimmile.inspectCamera([x-7,y+3,z-7],[x,y,z+15]);
  });await capture('water');
  for(const time of [7,31,300,65535]){await page.evaluate(time=>window.__waterInspectionTime=time,time);await capture(`water-${time}`);}
  await page.evaluate(()=>delete window.__waterInspectionTime);
  if(process.argv.includes('--forest'))for(const z of [1500,4000,9000,27000]){
    await page.evaluate(z=>window.__rimmile.inspectDistance(z),z);
    await page.evaluate(()=>window.__rimmile.inspectSpeed(350/3.6));await capture(`forest-${z}`);
  }
  await page.evaluate(()=>window.__rimmile.inspectCamera([0,3,0],[-40,93,25]));await capture('moon-stars');
  // Exercise the real HUD state as well as the lamp-isolation diagnostic.
  await page.keyboard.press('Escape');await resume(page);await page.keyboard.press('l');await page.waitForTimeout(400);await capture('lights-off');
  const lightsOff=await page.evaluate(()=>window.__rimmile.snapshot().vehicle);
  if(lightsOff.lightsOn||lightsOff.tailEmission||lightsOff.rearIntensity||lightsOff.headlights.some(l=>l.visible||l.shadow||l.intensity))throw Error('Lights Off retained illumination.');
  await page.keyboard.press('Escape');await resume(page);await page.keyboard.press('l');await page.waitForTimeout(400);await capture('lights-on');
  await page.evaluate(()=>window.__rimmile.inspectDistance(0));const before=await page.evaluate(()=>window.__rimmile.snapshot());
  await page.evaluate(()=>window.__rimmile.inspectSpeed(350/3.6));await capture('speed');const speed=await page.evaluate(()=>window.__rimmile.snapshot());
  await page.evaluate(()=>window.dispatchEvent(new Event('blur')));await page.screenshot({path:`test-results/overhaul-${captureKey}-paused.png`});
  await page.locator('#landing-settings').click();await page.screenshot({path:`test-results/overhaul-${captureKey}-settings.png`});
  await page.locator('#settings-back').click();await page.locator('#landing-about').click();await page.screenshot({path:`test-results/overhaul-${captureKey}-about.png`});
  await page.locator('#about-back').click();
  await writeFile(`test-results/overhaul-${captureKey}.json`,JSON.stringify({before,speed,illumination,lightsOff,errors},null,2));
  if(errors.length)throw new Error(errors.join('\n'));console.log({engine,headlights:before.vehicle.headlights,illumination,speedRendering:speed.performance,errors});
  await page.evaluate(()=>window.dispatchEvent(new Event('pagehide')));
}finally{await browser?.close();await server.close();}
