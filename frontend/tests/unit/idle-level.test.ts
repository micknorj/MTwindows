import {expect,it} from 'vitest';
import {idleEngineLevel} from '../../src/audio/idle-level';
it('quiets stationary idle without ducking moving, braking or reverse audio',()=>{
  expect(idleEngineLevel(0)).toBe(.76);
  expect(idleEngineLevel(.1)).toBe(.76);
  expect(idleEngineLevel(2)).toBe(1);
  expect(idleEngineLevel(-30)).toBe(1);
  expect(idleEngineLevel(1)).toBeGreaterThan(.76);
  expect(idleEngineLevel(1)).toBeLessThan(1);
});
