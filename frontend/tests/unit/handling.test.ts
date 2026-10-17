import { expect, it } from 'vitest';
import { Drivetrain } from '../../src/vehicle/drivetrain';
import { VehiclePhysics } from '../../src/vehicle/physics';
import { roadAt } from '../../src/world/road';

const idle = { throttle: false, brake: false, steer: 0 };
it('shifts through eight gears with bounded RPM and restores forward after reverse', () => {
  const drive = new Drivetrain(), gears = new Set<number>();
  for (let i = 0; i < 7500; i++) { drive.step(1 / 60, i / 60, 1); gears.add(drive.gear); expect(drive.rpm).toBeLessThanOrEqual(9600); }
  expect([...gears]).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  expect(drive.toggleDirection(0)).toBe(true);expect(drive.step(1 / 60, -3, 1)).toBeLessThan(0);
  drive.toggleDirection(0);drive.reset();expect(drive.gear).toBe(1);
  drive.reset(); expect(drive.rpm).toBe(900);
});
it('keeps aggressive high-speed steering finite and grip-limited, then clears motion on recovery', () => {
  const car = new VehiclePhysics(18); car.speed = 95;
  for (let i = 0; i < 600; i++) {
    car.step(1 / 60, { ...idle, steer: i % 180 < 90 ? 1 : -1 });
    expect(Number.isFinite(car.y + car.speed + car.heading + car.lateralSpeed)).toBe(true);
    expect(Math.abs(car.roll)).toBeLessThan(1.5);
    expect(Math.abs(car.yawRate), JSON.stringify({ i, speed: car.speed, lateral: car.lateralSpeed, yaw: car.yawRate })).toBeLessThan(2);
    car.wheelTravel.forEach(travel => expect(Math.abs(travel)).toBeLessThanOrEqual(.18));
  }
  car.recover(); expect(car.lateralSpeed).toBe(0); expect(car.yawRate).toBe(0); expect(car.drivetrain.gear).toBe(1);
});
it('retains tangential momentum along a barrier instead of erasing all motion', () => {
  const car = new VehiclePhysics(2), p = roadAt(car.z, car.seed);
  car.heading = p.heading + .18; car.speed = 20;
  car.obstacles = [[{ x: car.x + 1.4, y: car.y - 2, z: car.z + 4, halfX: .12, halfZ: 30, height: 6, heading: 0 }]];
  for (let i = 0; i < 30; i++) car.step(1 / 60, idle);
  expect(car.impacts).toBeGreaterThan(0); expect(car.speed, JSON.stringify({ speed: car.speed, lateral: car.lateralSpeed, impacts: car.impacts, heading: car.heading, strength: car.impactStrength })).toBeGreaterThan(5);
});
it('holds a parked car, and brake priority wins over simultaneous pedals', () => {
  const parked = new VehiclePhysics(8);
  for (let i = 0; i < 600; i++) parked.step(1 / 60, idle);
  expect(parked.speed).toBe(0);
  parked.speed = 25;
  for (let i = 0; i < 60; i++) parked.step(1 / 60, { ...idle, throttle: true, brake: true });
  expect(parked.speed).toBeLessThan(17); expect(parked.speed).toBeGreaterThan(0);
});
it('removes tire propulsion, braking and steering while all wheels are out of contact', () => {
  const throttle = new VehiclePhysics(12), brake = new VehiclePhysics(12);
  for (const car of [throttle, brake]) { car.y += 3; car.speed = 20; car.step(1 / 60, idle); }
  const initialY = throttle.y;
  for (let i = 0; i < 15; i++) {
    throttle.step(1 / 60, { ...idle, throttle: true, steer: 1 });
    brake.step(1 / 60, { ...idle, brake: true, steer: -1 });
  }
  expect(throttle.wheelContact).toEqual([false, false, false, false]);
  expect(throttle.speed).toBeCloseTo(brake.speed, 5);
  expect(throttle.y).toBeLessThan(initialY);
  expect(Math.abs(throttle.yawRate)).toBeLessThan(.001);
  throttle.recover(); expect(throttle.wheelContact).toEqual([true, true, true, true]);
});
