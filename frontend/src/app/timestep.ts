export const FIXED_DT = 1 / 60;
export class FixedClock {
  private accumulator = 0;
  reset() { this.accumulator = 0; }
  advance(elapsed: number, step: (dt: number) => void) {
    this.accumulator += Math.min(.1, Math.max(0, elapsed));
    while (this.accumulator + 1e-10 >= FIXED_DT) {
      step(FIXED_DT);
      this.accumulator -= FIXED_DT;
    }
    return Math.max(0, this.accumulator / FIXED_DT);
  }
}
