import { expect, test } from '@playwright/test';

test('production loads all assets locally from a Pages subpath and drives without dev hooks', async ({ page }) => {
  const errors: string[] = [], requests: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('request', request => requests.push(request.url()));
  page.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
  // Observe registrations to ensure the dismissed live synth is never started.
  await page.addInitScript(()=>{
    const modules:string[]=[];Object.defineProperty(window,'__audioModules',{value:modules});
    const original=AudioWorklet.prototype.addModule;
    AudioWorklet.prototype.addModule=function(this:AudioWorklet,...args:Parameters<typeof original>){
      return original.apply(this,args).then(()=>{modules.push(new URL(String(args[0]),document.baseURI).href);});
    };
  });
  const vehicleResponse = page.waitForResponse(response => response.url().endsWith('/models/rimmile-vehicle.bin'));
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Rimmile' })).toBeVisible();
  await page.getByRole('button', { name: 'Drive' }).click();
  await expect(page.locator('#hud')).toBeVisible({ timeout: 30000 });
  const vehicle = await vehicleResponse;
  expect(vehicle.ok()).toBe(true); expect(vehicle.headers()['content-type']).toContain('application/octet-stream');
  expect((await vehicle.body()).length).toBe(3198504);
  expect(requests.filter(url => url.endsWith('/models/rimmile-vehicle.bin'))).toHaveLength(1);
  if (await page.getByRole('button', { name: 'Resume' }).isVisible()) await page.getByRole('button', { name: 'Resume' }).click();
  await page.keyboard.down('ArrowUp'); await page.waitForTimeout(1500); await page.keyboard.up('ArrowUp');
  expect(Number(await page.locator('#speed').textContent())).toBeGreaterThan(1);
  expect(await page.evaluate(() => '__rimmile' in window)).toBe(false);
  await page.keyboard.press('l');await expect(page.locator('#lights')).toHaveCount(0);
  await page.keyboard.press('l');
  // Freeze before capture so software WebGL cannot queue work behind the screenshot.
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Resume', exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/production-driving.png' });
  await page.locator('#game').screenshot({ path: 'test-results/production-car.png', style: '#menu-overlay,#landing { visibility:hidden; }' });
  expect(errors).toEqual([]);
  expect(requests.filter(url=>new URL(url).protocol!=='blob:').every(url => url.startsWith(new URL('./',page.url()).href))).toBe(true);
  expect(requests.some(url => url.includes('world.worker'))).toBe(true);
  expect(requests.some(url=>url.includes('night-crickets')&&url.endsWith('.mp3'))).toBe(true);
  const modules=await page.evaluate(()=>(window as unknown as {__audioModules:string[]}).__audioModules);
  expect(modules).toHaveLength(0); // No dismissed synth is registered or layered under the sampled engine.
  expect(requests.some(url=>url.endsWith('/audio/rimmile-engine.bin'))).toBe(true);
  await expect(page.locator('#master')).toBeEnabled();
});

for (const failure of ['missing','corrupt']) test(`production ${failure} vehicle shows Retry without a placeholder and recovers`,async({page})=>{
 let fail=true;
 await page.route('**/models/rimmile-vehicle.bin',route=>fail?route.fulfill({status:failure==='missing'?404:200,contentType:'application/octet-stream',body:'invalid vehicle'}):route.continue());
 await page.goto('./');await expect(page.locator('#play')).toHaveText('- Retry -',{timeout:60000});
 await expect(page.locator('#hud')).toBeHidden();
 await page.locator('#landing-about').click();await expect(page.locator('#about-page')).toBeVisible();await page.locator('#about-back').click();
 fail=false;await page.locator('#play').click();await expect(page.locator('#hud')).toBeVisible({timeout:60000});
});
