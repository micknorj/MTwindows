import { test as base, expect } from '@playwright/test';

// SwiftShader retains queued world work across context teardown. Give each acceptance
// test a fresh browser process; the recycling test still measures one uninterrupted game.
export const test = base.extend({
  context: async ({ playwright, browserName, launchOptions, baseURL, viewport }, use) => {
    const browser = await playwright[browserName].launch(launchOptions);
    try {
      const context = await browser.newContext({ baseURL, viewport });
      await context.addInitScript(()=>{const original=crypto.getRandomValues.bind(crypto);crypto.getRandomValues=values=>{original(values);if(values instanceof Uint32Array&&values.length===1)values[0]=1942;return values;};});
      await use(context);
    } finally { await browser.close(); }
  },
});
export { expect };
