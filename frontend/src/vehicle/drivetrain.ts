import { VEHICLE } from './config';

// Effective game calibration, not an assertion of unpublished OEM gear ratios.
export const RATIOS = [3.9, 2.55, 1.86, 1.43, 1.15, .93, .78, .67] as const;
const FINAL_DRIVE = 3.8, REDLINE = 9500, SHIFT_TIME = .16;
export type TransmissionMode = 'Automatic' | 'Manual';
export type DriveDirection = 'Drive' | 'Reverse';
export type ShiftResult = 'shifted' | 'automatic' | 'reverse' | 'limit' | 'busy' | 'overrev';
export class Drivetrain {
  mode: TransmissionMode = 'Automatic';
  direction: DriveDirection = 'Drive';
  private forwardGear = 1;
  get gear() { return this.direction === 'Reverse' ? -1 : this.forwardGear; }
  rpm = 900;
  load = 0;
  shifting = 0;
  private cooldown = 0;
  private motorLoad = 0;
  private fromRatio: number = RATIOS[0];
  reset() {
    // Recovery resets motion/direction; the user's transmission preference survives.
    this.direction = 'Drive'; this.forwardGear = 1; this.rpm = 900;
    this.load = this.motorLoad = this.shifting = this.cooldown = 0;
  }
  setMode(mode: TransmissionMode) { this.mode = mode; }
  toggleDirection(speed: number, lateralSpeed = 0) {
    if (!Number.isFinite(speed) || !Number.isFinite(lateralSpeed) || Math.hypot(speed, lateralSpeed) > .8) return false;
    this.direction = this.direction === 'Drive' ? 'Reverse' : 'Drive';
    this.load = this.motorLoad = this.shifting = this.cooldown = 0;
    return true;
  }
  private coupledRpm(speed: number, gear: number) { return Math.abs(speed) / VEHICLE.wheelRadius * 60 / (2 * Math.PI) * RATIOS[gear - 1] * FINAL_DRIVE; }
  shiftManual(change: -1 | 1, speed: number): ShiftResult {
    if (this.mode !== 'Manual') return 'automatic';
    if (this.direction === 'Reverse') return 'reverse';
    const gear = this.forwardGear + change;
    if (gear < 1 || gear > 8) return 'limit';
    if (this.shifting > 0 || this.cooldown > 0) return 'busy';
    // Check road-coupled RPM, not the lagged audible RPM, before engaging a clutch.
    if (!Number.isFinite(speed) || (change < 0 && this.coupledRpm(speed, gear) > REDLINE - 250)) return 'overrev';
    this.shift(gear); return 'shifted';
  }
  step(dt: number, speed: number, throttle: number) {
    this.cooldown = Math.max(0, this.cooldown - dt); this.shifting = Math.max(0, this.shifting - dt);
    const reverse = this.direction === 'Reverse';
    this.load += ((reverse ? 0 : throttle) - this.load) * (1 - Math.exp(-12 * dt));
    this.motorLoad += (throttle - this.motorLoad) * (1 - Math.exp(-12 * dt));
    if (reverse) {
      // OEM reverse is electric. No fictitious reverse ICE ratio or engine roar.
      this.rpm += (900 - this.rpm) * (1 - Math.exp(-12 * dt));
      const force = Math.min(5500, 70000 / Math.max(2, Math.abs(speed))) * Math.max(0, Math.min(1, (12 + speed) / 4));
      return -force * this.motorLoad;
    }
    let ratio = RATIOS[this.forwardGear - 1];
    const coupled = this.coupledRpm(speed, this.forwardGear);
    if (this.mode === 'Automatic' && this.cooldown === 0 && this.shifting === 0) {
      if (coupled > (throttle > .5 ? 8900 : 6400) && this.forwardGear < 8) this.shift(this.forwardGear + 1);
      else if (this.forwardGear > 1 && (coupled < 2400 || (throttle > .8 && coupled < 4800 && this.coupledRpm(speed, this.forwardGear - 1) < 8000))) this.shift(this.forwardGear - 1);
      ratio = RATIOS[this.forwardGear - 1];
    }
    if (this.shifting > 0) {
      const progress = 1 - this.shifting / SHIFT_TIME, blend = progress * progress * (3 - 2 * progress);
      ratio = this.fromRatio + (ratio - this.fromRatio) * blend;
    }
    const roadRpm = this.coupledRpm(speed, this.forwardGear);
    const targetRpm = Math.min(REDLINE, Math.max(900 + throttle * 1700 * Math.max(0, 1 - Math.abs(speed) / 8), roadRpm));
    this.rpm += (targetRpm - this.rpm) * (1 - Math.exp(-18 * dt));
    const torqueCurve = 720 + 270 * Math.exp(-(((this.rpm - 6200) / 2700) ** 2));
    const torque = Math.min(torqueCurve, 747000 / Math.max(100, this.rpm * Math.PI / 30));
    // A manual low gear at excessive road speed slips/disengages rather than
    // over-speeding the engine or imposing an unlimited engine-braking impulse.
    const limiter = Math.max(0, Math.min(1, (REDLINE - Math.max(this.rpm, roadRpm)) / 400));
    const shiftCut = 1 - .72 * Math.sin(Math.PI * this.shifting / SHIFT_TIME) ** 2;
    const propulsion = torque * ratio * FINAL_DRIVE * .9 / VEHICLE.wheelRadius * this.load * limiter * shiftCut;
    const clutch = Math.max(0, Math.min(1, Math.abs(speed) / 2)) * Math.max(0, Math.min(1, (REDLINE + 400 - roadRpm) / 400));
    const engineBraking = Math.abs(speed) > .6 ? (45 + this.rpm * .009) * ratio * FINAL_DRIVE * .9 / VEHICLE.wheelRadius * (1 - this.load) * Math.sign(speed) * clutch : 0;
    return propulsion - engineBraking;
  }
  private shift(gear: number) { this.fromRatio = RATIOS[this.forwardGear - 1]; this.forwardGear = gear; this.shifting = SHIFT_TIME; this.cooldown = this.mode === 'Automatic' ? .5 : .3; }
}
