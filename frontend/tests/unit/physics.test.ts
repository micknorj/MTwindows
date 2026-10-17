import { describe, expect, it } from 'vitest';
import { VehiclePhysics } from '../../src/vehicle/physics';
import { FixedClock } from '../../src/app/timestep';
import { roadAt } from '../../src/world/road';

const idle = { throttle: false, brake: false, steer: 0 };
describe('vehicle and clock', () => {
  it('starts stationary and follows identical physics at 30, 60 and 144 render Hz', () => {
    const results = [30, 60, 144].map(fps => {
      const car = new VehiclePhysics(12), clock = new FixedClock();
      expect(car.speed).toBe(0);
      for (let i = 0; i < fps * 8; i++) clock.advance(1 / fps, dt => car.step(dt, { ...idle, throttle: true }));
      return [car.x, car.z, car.speed];
    });
    expect(results[0]).toEqual(results[1]); expect(results[1]).toEqual(results[2]);
  });
  it('brakes to rest without selecting reverse, then requires selected direction plus throttle', () => {
    const car = new VehiclePhysics(1,()=>0,()=>1.24); car.speed = 20;
    for (let i = 0; i < 300; i++) car.step(1 / 60, { ...idle, brake: true });
    expect(car.speed).toBe(0);expect(car.drivetrain.direction).toBe('Drive');
    expect(car.drivetrain.toggleDirection(car.speed)).toBe(true);
    for (let i = 0; i < 120; i++) car.step(1 / 60, idle);
    expect(car.speed).toBe(0);
    for (let i = 0; i < 180; i++) car.step(1 / 60, { ...idle, throttle: true });
    expect(car.speed).toBeLessThan(-1);
    for (let i = 0; i < 300; i++) car.step(1 / 60, { ...idle, brake: true });
    expect(car.speed).toBe(0);expect(car.drivetrain.direction).toBe('Reverse');
    car.drivetrain.toggleDirection(car.speed);
    for (let i = 0; i < 180; i++) car.step(1 / 60, { ...idle, throttle: true });
    expect(car.speed).toBeGreaterThan(0);
  });
  it('reduces steering authority with speed and adds off-road resistance', () => {
    const slow = new VehiclePhysics(1), fast = new VehiclePhysics(1);
    slow.speed = 5; fast.speed = 70;
    slow.step(1 / 60, { ...idle, steer: 1 }); fast.step(1 / 60, { ...idle, steer: 1 });
    expect(Math.abs(fast.steer)).toBeLessThan(Math.abs(slow.steer));
    // Isolate material drag: moving the car sideways over a valley may put it
    // airborne, where ground rolling resistance correctly disappears.
    const road = new VehiclePhysics(1,()=>0), grass = new VehiclePhysics(1,()=>0);
    road.speed = grass.speed = 15; grass.x += 25;
    road.step(1 / 60, idle); grass.step(1 / 60, idle);
    expect(grass.speed).toBeLessThan(road.speed);
  });
  it('recovers upright in a lane at million-metre coordinates', () => {
    const car = new VehiclePhysics(31); car.z = -1e6; car.x = 450; car.speed = -12; car.heading = 9;
    car.recover();
    expect(car.speed).toBe(0); expect(car.steer).toBe(0);
    expect(Math.abs(car.x - roadAt(car.z, car.seed).x)).toBeCloseTo(1.7, 1);
    expect(car.heading).toBeCloseTo(roadAt(car.z, car.seed).heading, 2);
    expect(Number.isFinite(car.y)).toBe(true);
  });
  it('bounds catch-up and drops accumulated time on pause', () => {
    const clock = new FixedClock(); let ticks = 0;
    clock.advance(20, () => ticks++); expect(ticks).toBe(6);
    clock.advance(.005, () => ticks++); clock.reset(); clock.advance(.012, () => ticks++);
    expect(ticks).toBe(6);
  });
});
