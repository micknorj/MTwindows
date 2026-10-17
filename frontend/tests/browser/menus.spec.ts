import {test,expect} from './fixtures';
test.afterEach(async({page})=>{if(!page.isClosed())await page.evaluate(()=>window.dispatchEvent(new Event('pagehide')));});
test('transparent menu scrollbars preserve centered layout, keyboard scrolling and viewport through navigation',async({page,browserName})=>{
 test.setTimeout(150000);await page.goto('/');await expect(page.locator('#scene')).toBeVisible({timeout:60000});
 const metrics=()=>page.evaluate(()=>{
  const panel=document.querySelector<HTMLElement>('.content-screen:not([hidden])')!,content=panel.querySelector<HTMLElement>('.editorial-content')!,heading=panel.querySelector('h2')!,back=panel.querySelector('.back')!,canvas=document.querySelector('canvas')!;
  const x=(e:Element)=>{const b=e.getBoundingClientRect();return {left:b.left,right:b.right,width:b.width};},style=getComputedStyle(panel);
  return {content:x(content),heading:x(heading),back:x(back),canvas:x(canvas),aspect:canvas.width/canvas.height,cssAspect:canvas.clientWidth/canvas.clientHeight,scrollY,documentWidth:document.documentElement.scrollWidth,windowWidth:innerWidth,panelWidth:panel.scrollWidth,panelClient:panel.clientWidth,standardScrollbar:CSS.supports('scrollbar-color','red transparent'),color:style.scrollbarColor,gutter:style.scrollbarGutter,background:style.backgroundColor,track:getComputedStyle(panel,'::-webkit-scrollbar-track').backgroundColor};
 });
 for(const viewport of [{width:1440,height:900},{width:1000,height:620},{width:820,height:600},{width:640,height:480}]){
  await page.setViewportSize(viewport);await page.locator('#landing-settings').click();await page.locator('#settings-page').evaluate(e=>e.scrollTop=0);const before=await metrics();
  expect(before.content.width).toBeLessThanOrEqual(768);expect((before.content.left+before.content.right)/2).toBeCloseTo(viewport.width/2,0);expect(before.scrollY).toBe(0);expect(before.documentWidth).toBeLessThanOrEqual(viewport.width);expect(before.panelWidth).toBeLessThanOrEqual(before.panelClient);expect(before.background).toBe('rgba(0, 0, 0, 0)');
  if(before.standardScrollbar)expect(before.color).toContain('rgba(0, 0, 0, 0)');if(browserName!=='firefox')expect(before.track).toBe('rgba(0, 0, 0, 0)');
  await page.locator('#settings-back').focus();await page.keyboard.press('PageDown');await expect.poll(()=>page.locator('#settings-page').evaluate(e=>e.scrollTop)).toBeGreaterThan(0);expect((await metrics()).content).toEqual(before.content);expect((await metrics()).canvas).toEqual(before.canvas);
  await page.locator('#settings-page').evaluate(e=>e.scrollTop=0);await page.locator('#settings-back').click();await page.locator('#landing-about').click();const about=await metrics();expect(about.content).toEqual(before.content);expect(about.heading).toEqual(before.heading);expect(about.back).toEqual(before.back);
  await page.locator('.about').evaluate(e=>{const p=document.createElement('p');p.id='qa-overflow';p.style.height='2000px';e.append(p);});expect((await metrics()).content).toEqual(about.content);await page.locator('#qa-overflow').evaluate(e=>e.remove());await page.locator('#about-back').click();
 }
 await page.setViewportSize({width:1000,height:620});await page.locator('#landing-settings').click();await page.evaluate(()=>document.documentElement.style.fontSize='20px');const large=await metrics();expect(large.documentWidth).toBeLessThanOrEqual(1000);expect((large.content.left+large.content.right)/2).toBeCloseTo(500,0);await page.evaluate(()=>document.documentElement.style.fontSize='');
 await page.locator('[data-binding="shiftUp"]').scrollIntoViewIfNeeded();await page.screenshot({path:`test-results/menu-scrollbars-${browserName}.png`});await page.locator('#settings-back').click();await page.locator('#play').click();await expect(page.locator('#hud')).toBeVisible({timeout:60000});if(await page.locator('#play').isVisible())await page.locator('#play').click();await page.keyboard.press('Escape');const stopped=await page.evaluate(()=>window.__rimmile.snapshot());
 await page.locator('#landing-settings').click();await page.setViewportSize({width:1280,height:720});await expect.poll(async()=>{const m=await metrics();return Math.abs(m.aspect-m.cssAspect);}).toBeLessThan(.005);await page.locator('#settings-back').click();expect((await page.evaluate(()=>window.__rimmile.snapshot())).z).toBe(stopped.z);await page.locator('#play').click();await expect(page.locator('#hud')).toBeVisible();
});


test('centered category rules, quiet resets, centered About and viewport notices retain accessible controls',async({page,browserName})=>{
 test.setTimeout(180000);await page.goto('/');await expect(page.locator('#scene')).toBeVisible({timeout:60000});await page.locator('#landing-settings').click();
 for(const size of [{width:1440,height:900},{width:820,height:600},{width:640,height:480}]){
  await page.setViewportSize(size);
  for(const heading of await page.locator('.settings-section h3,.settings-section legend').all()){
   const m=await heading.evaluate(e=>{const r=document.createRange();r.selectNodeContents(e);const text=r.getBoundingClientRect(),box=e.getBoundingClientRect();return {center:text.left+text.width/2,container:box.left+box.width/2,before:parseFloat(getComputedStyle(e,'::before').width),after:parseFloat(getComputedStyle(e,'::after').width)};});
   expect(Math.abs(m.center-m.container)).toBeLessThan(1);expect(m.before).toBeGreaterThan(20);expect(m.before).toBeCloseTo(m.after,0);
  }
  for(const selector of ['#reset-handling','#reset-controls']){
   const m=await page.locator(selector).evaluate(e=>({children:e.parentElement!.children.length,right:e.getBoundingClientRect().right,parent:e.parentElement!.getBoundingClientRect().right}));expect(m.children).toBe(1);expect(m.right).toBeCloseTo(m.parent,0);
  }
 }
 await page.locator('[data-transmission="Manual"]').click();await expect(page.locator('#handling-status')).toHaveCount(0);
 await page.locator('#handling-balance').fill('35');await page.locator('#handling-grip').fill('-20');await page.locator('#reset-handling').click();await expect(page.locator('#handling-balance')).toHaveValue('0');await expect(page.locator('#handling-grip')).toHaveValue('0');await expect(page.locator('[data-transmission="Manual"]')).toHaveAttribute('aria-pressed','true');
 await page.locator('[data-binding="shiftUp"]').click();await expect(page.locator('#binding-status')).not.toBeEmpty();await page.keyboard.press('u');await expect(page.locator('#binding-status')).toBeEmpty();await page.locator('#reset-controls').click();await expect(page.locator('#binding-status')).toBeEmpty();await expect(page.locator('[data-binding="shiftUp"]')).toHaveText('Q');
 await page.setViewportSize({width:1280,height:720});await page.locator('#settings-page').evaluate(e=>e.scrollTop=0);await page.screenshot({path:`test-results/refined-settings-${browserName}.png`});
 const back=await page.locator('#settings-back').boundingBox(),settings=await page.locator('#settings-title').boundingBox();await page.locator('#settings-back').click();await page.locator('#landing-about').click();const aboutBack=await page.locator('#about-back').boundingBox(),about=await page.locator('#about-title').boundingBox();expect(aboutBack!.y).toBeCloseTo(back!.y,0);expect(about!.y).toBeGreaterThan(settings!.y);const credit=await page.locator('.site-credit').boundingBox();expect((about!.y+credit!.y+credit!.height)/2).toBeCloseTo(360,0);await expect(page.locator('.about-content')).toHaveCSS('text-align','center');await expect(page.locator('.about-content .site-credit')).toHaveCSS('text-align','center');await page.screenshot({path:`test-results/refined-about-${browserName}.png`});await page.locator('#about-back').click();await page.locator('#play').click();await expect(page.locator('#hud')).toBeVisible({timeout:60000});if(await page.locator('#play').isVisible())await page.locator('#play').click();
 await expect(page.getByRole('button',{name:'Pause',exact:true})).toHaveText('');await expect(page.locator('#pause .pause-icon')).toHaveCSS('border-left-width','4px');
 await page.keyboard.press('q');await expect(page.locator('#transmission-status')).toHaveText('Manual · Gear 2');
 for(const size of [{width:1280,height:720},{width:640,height:480}]){
  await page.setViewportSize(size);const box=await page.locator('#transmission-status').boundingBox();expect(box!.x+box!.width/2).toBeCloseTo(size.width/2,0);expect(box!.y+box!.height).toBeCloseTo(size.height-64,0);await expect(page.locator('#transmission-status')).toHaveCSS('pointer-events','none');
 }
 await page.screenshot({path:`test-results/refined-notice-${browserName}.png`});await page.locator('#pause').focus();await page.keyboard.press('Enter');await expect(page.locator('#distance-milestone')).toBeVisible();for(const size of [{width:1280,height:720},{width:640,height:480},{width:640,height:360}]){
  await page.setViewportSize(size);const paused=await page.locator('#distance-milestone').boundingBox(),last=await page.locator('#landing-about').boundingBox(),title=await page.locator('h1').boundingBox();expect(paused!.x+paused!.width/2).toBeCloseTo(size.width/2,0);expect(paused!.y+paused!.height).toBeCloseTo(size.height-64,0);expect(last!.y+last!.height).toBeLessThan(paused!.y-4);expect(title!.y).toBeGreaterThanOrEqual(0);await page.screenshot({path:`test-results/refined-paused-${size.height}-${browserName}.png`});
 }await expect(page.locator('#transmission-status')).toBeHidden();await page.locator('#landing-settings').click();await expect(page.locator('#distance-milestone')).toBeHidden();await page.locator('#settings-back').click();await expect(page.locator('#distance-milestone')).toBeVisible();
});


test('saved fullscreen intent stays quiet while unavailable fullscreen still reports a real error',async({page})=>{
 await page.goto('/');await page.evaluate(()=>localStorage.setItem('rimmile.preferences.v1',JSON.stringify({version:3,fullscreen:true})));await page.reload();await page.locator('#landing-settings').click();await expect(page.locator('#graphics-status')).not.toContainText('Fullscreen opens');if(await page.evaluate(()=>document.fullscreenEnabled))await expect(page.locator('#graphics-status')).toBeEmpty();else await expect(page.locator('#graphics-status')).toHaveText('Fullscreen unavailable.');
});
