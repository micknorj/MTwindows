import { expect, it } from 'vitest';
import { DEFAULT_BODY, penetration } from '../../src/vehicle/collider';
import { VehiclePhysics } from '../../src/vehicle/physics';

it('resolves oriented contacts while allowing separated and vertically disjoint objects', () => {
  const obstacle = { x: 1, y: 0, z: 0, halfX: .2, halfZ: 2, height: 2, heading: .4 };
  expect(penetration(0, 0, 0, .3, DEFAULT_BODY, obstacle)).toBeDefined();
  expect(penetration(-5, 0, 0, .3, DEFAULT_BODY, obstacle)).toBeUndefined();
  expect(penetration(0, 8, 0, .3, DEFAULT_BODY, obstacle)).toBeUndefined();
});
it('stops at a thin obstacle at high speed without render-mesh collision', () => {
  const car = new VehiclePhysics(12); car.speed = 95;
  car.obstacles = [[{ x: car.x + Math.sin(car.heading) * 10, y: car.y - 1, z: car.z + Math.cos(car.heading) * 10, halfX: .25, halfZ: .25, height: 8, heading: 0 }]];
  for (let i = 0; i < 30; i++) car.step(1 / 60, { throttle: false, brake: false, steer: 0 });
  expect(car.impacts).toBeGreaterThan(0); expect(Math.abs(car.speed)).toBeLessThan(.1);
});
