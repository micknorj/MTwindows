import {test,expect} from '@playwright/test';
test('production frontend uses the separate static origin and preserves saved preferences',async({page,request})=>{
 const errors:string[]=[],media:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 page.on('response',response=>{if(/\.(webp|mp3|bin)$/.test(response.url())){media.push(response.url());expect(response.url()).toMatch(/^http:\/\/127\.0\.0\.1:8787\/v\/[a-f0-9]+\//);expect(response.headers()['access-control-allow-origin']).toBe('*');expect(response.headers()['cache-control']).toContain('immutable');}});
 await page.goto('./');await expect(page.locator('#play')).toHaveText('- Drive -',{timeout:60000});
 const audio=await page.evaluate(()=>typeof AudioContext!=='undefined');
 await page.locator('#landing-settings').click();await page.locator('[data-transmission="Manual"]').click();
 const setting=page.locator(audio?'#engine':'#handling-grip');
 if(!audio)await expect(page.locator('#engine')).toBeDisabled();
 await setting.fill('38');await setting.dispatchEvent('input');await page.reload();await page.locator('#landing-settings').click();await expect(setting).toHaveValue('38');await expect(page.locator('[data-transmission="Manual"]')).toHaveAttribute('aria-pressed','true');
 await page.locator('#settings-back').click();await page.locator('#play').click();await expect(page.locator('#hud')).toBeVisible({timeout:60000});
 if(await page.locator('#play').isVisible())await page.locator('#play').click();
 await page.keyboard.press('q');await expect(page.locator('#transmission-status')).toHaveText('Manual · Gear 2');await page.waitForTimeout(350);await page.keyboard.press('e');await expect(page.locator('#transmission-status')).toHaveText('Manual · Gear 1');
 await page.keyboard.down('w');await page.waitForTimeout(1200);await page.keyboard.up('w');expect(Number(await page.locator('#speed').textContent())).toBeGreaterThan(0);
 await page.keyboard.press('Escape');await expect(page.locator('#play')).toHaveText('- Resume -');
 await page.setViewportSize({width:1000,height:700});await page.screenshot({path:`test-results/release/${test.info().project.name}-cross-origin.png`});
 expect(media.some(url=>url.endsWith('/models/rimmile-vehicle.bin'))).toBe(true);
 expect([...new Set(media.filter(url=>url.endsWith('.webp')))]).toHaveLength(11);if(await page.evaluate(()=>typeof AudioContext!=='undefined')){expect(media.some(url=>url.endsWith('.mp3'))).toBe(true);expect(media.some(url=>url.endsWith('/audio/rimmile-engine.bin'))).toBe(true);}
 const missing=await request.get('http://127.0.0.1:8787/missing.webp');expect(missing.status()).toBe(404);
 expect(await page.evaluate(()=>'__rimmile' in window)).toBe(false);expect(errors).toEqual([]);
});
test('failed external landscape request retains retry and menu access',async({page})=>{
 let fail=true;await page.route('**/asphalt_02-albedo.webp',route=>fail?route.abort():route.continue());
 await page.goto('./');await expect(page.locator('#play')).toHaveText('- Retry -',{timeout:60000});
 await page.locator('#landing-about').click();await expect(page.locator('#about-page')).toBeVisible();await page.locator('#about-back').click();
 fail=false;await page.locator('#play').click();await expect(page.locator('#hud')).toBeVisible({timeout:60000});
});

test('external vehicle failure cannot silently select a placeholder',async({page})=>{
 let fail=true;await page.route('**/models/rimmile-vehicle.bin',route=>fail?route.abort():route.continue());
 await page.goto('./');await expect(page.locator('#play')).toHaveText('- Retry -',{timeout:60000});await expect(page.locator('#hud')).toBeHidden();
 fail=false;await page.locator('#play').click();await expect(page.locator('#hud')).toBeVisible({timeout:60000});
});
