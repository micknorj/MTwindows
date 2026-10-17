import {test,expect} from './fixtures';
const snapshot=()=>window.__rimmile.snapshot() as unknown as {state:string;running:boolean;x:number;y:number;z:number;speed:number;viewport:{width:number;height:number;cssWidth:number;cssHeight:number;aspect:number};recovery:unknown;performance:{samples:number};handling:{grip:number}};
test.afterEach(async({page})=>{if(!page.isClosed())await page.evaluate(()=>window.dispatchEvent(new Event('pagehide')));});
test('preferences restore quality, volumes, handling, remaps and lights without storing world state',async({page})=>{
 test.setTimeout(180000); // Four real cold-world loads; retain every persistence/control assertion.
 await page.goto('/');await page.locator('#landing-settings').click();await page.locator('[data-graphics="resolution"][data-value="Low"]').click();
 const audioAvailable=!await page.locator('#master').isDisabled(),volumes=audioAvailable?{master:'38',engine:'49',environment:'61'}:{master:'70',engine:'70',environment:'65'};
 for(const [id,v] of Object.entries({...volumes,'handling-balance':'40','handling-grip':'-20'}))if(!await page.locator(`#${id}`).isDisabled())await page.locator(`#${id}`).fill(v);
 await page.locator('[data-binding="accelerate"]').click();await page.keyboard.press('x');await page.locator('[data-binding="lights"]').click();await page.keyboard.press('j');await page.locator('#settings-back').click();await page.locator('#play').click();await expect(page.locator('#hud')).toBeVisible({timeout:60000});await page.keyboard.press('j');await page.keyboard.press('Escape');
 const stored=await page.evaluate(()=>JSON.parse(localStorage.getItem('rimmile.preferences.v1')!));expect(stored.lights).toBe(false);expect(stored.bindings.accelerate).toEqual(['KeyX','ArrowUp']);expect(stored).not.toHaveProperty('position');
 await page.reload();await page.locator('#landing-settings').click();await expect(page.locator('[data-graphics="resolution"][data-value="Low"]')).toHaveAttribute('aria-pressed','true');
 for(const [id,v] of Object.entries({...volumes,'handling-balance':'40','handling-grip':'-20'}))await expect(page.locator(`#${id}`)).toHaveValue(v);
 await expect(page.locator('#scene')).toBeVisible({timeout:60000});expect(await page.evaluate(()=>window.__rimmile.snapshot().vehicle.lightsOn)).toBe(false);
 await expect(page.locator('[data-binding="accelerate"]')).toHaveText('X / Arrow Up');await expect(page.locator('[data-binding="lights"]')).toHaveText('J');await page.locator('#reset-controls').click();await page.reload();await page.locator('#landing-settings').click();await expect(page.locator('[data-binding="accelerate"]')).toHaveText('W / Arrow Up');await expect(page.locator('[data-binding="lights"]')).toHaveText('L');
});
test('corrupt and blocked preference storage preserve usable defaults and menus',async({page})=>{
 test.setTimeout(180000); // Corrupt/blocked-storage reloads include actual scene generation.
 await page.goto('/');await page.evaluate(()=>localStorage.setItem('rimmile.preferences.v1','{broken'));await page.reload();await page.locator('#landing-settings').click();await expect(page.locator('[data-graphics="resolution"][data-value="Auto"]')).toHaveAttribute('aria-pressed','true');await expect(page.locator('#master')).toHaveValue('70');await expect(page.locator('#handling-grip')).toHaveValue('0');
 await page.addInitScript(()=>Object.defineProperty(window,'localStorage',{get:()=>{throw new DOMException('blocked','SecurityError');}}));await page.reload();await page.locator('#landing-settings').click();if(!await page.locator('#master').isDisabled())await page.locator('#master').fill('22');await page.locator('#handling-grip').fill('30');await page.locator('#reset-handling').click();await expect(page.locator('#handling-status')).toHaveCount(0);await expect(page.locator('#handling-grip')).toHaveValue('0');await page.locator('#handling-grip').fill('30');await page.locator('#settings-back').click();await page.locator('#play').click();await expect(page.locator('#hud')).toBeVisible({timeout:60000});expect((await page.evaluate(snapshot)).handling.grip).toBeGreaterThan(1);
});
test('paused resize, settings changes and restore repaint immediately without simulation',async({page})=>{
 await page.goto('/');await page.locator('#play').click();await expect(page.locator('#hud')).toBeVisible({timeout:60000});await page.keyboard.press('Escape');
 await page.evaluate(()=>{const gl=WebGL2RenderingContext.prototype,original=gl.drawElements;const w=window as unknown as {pausedDraws:number};w.pausedDraws=0;gl.drawElements=function(...args){w.pausedDraws++;return original.apply(this,args);};});
 const before=await page.evaluate(snapshot);await page.setViewportSize({width:1000,height:640});
 await expect.poll(async()=>{const p=(await page.evaluate(snapshot)).viewport;return p.aspect;}).toBe(1000/640);
 await expect.poll(()=>page.evaluate(()=>(window as unknown as {pausedDraws:number}).pausedDraws)).toBeGreaterThan(0);
 const after=await page.evaluate(snapshot);expect(after).toMatchObject({state:'paused',running:false,x:before.x,y:before.y,z:before.z,recovery:before.recovery});expect(after.viewport.width/after.viewport.height).toBeCloseTo(1000/640,2);expect(after.performance.samples).toBe(before.performance.samples);
 await page.locator('#landing-settings').click();await page.locator('[data-graphics="resolution"][data-value="High"]').click();await expect.poll(async()=>{const p=(await page.evaluate(snapshot)).viewport;return p.width;}).toBe(1000);
 const drawBefore=await page.evaluate(()=>(window as unknown as {pausedDraws:number}).pausedDraws);await page.evaluate(()=>window.dispatchEvent(new Event('pageshow')));await expect.poll(()=>page.evaluate(()=>(window as unknown as {pausedDraws:number}).pausedDraws)).toBeGreaterThan(drawBefore);expect((await page.evaluate(snapshot)).running).toBe(false);
 await page.setViewportSize({width:1440,height:900});await expect.poll(async()=>(await page.evaluate(snapshot)).viewport.aspect).toBe(1.6);await page.locator('#settings-back').click();await page.locator('#play').click();await expect(page.locator('#hud')).toBeVisible();
});
