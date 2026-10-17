import { CHUNK_LENGTH, roadAt } from './road';
export class RoadTopology {
  private center = NaN;
  samples: ReturnType<typeof roadAt>[] = [];
  constructor(private seed: number) {}
  update(z: number) {
    const center = Math.floor(z / CHUNK_LENGTH) * CHUNK_LENGTH;
    if (center === this.center) return;
    this.center = center; this.samples = [];
    for (let distance = -1000; distance <= 5200; distance += 25) this.samples.push(roadAt(center + distance, this.seed));
  }
  get ahead() { return this.samples.at(-1)?.z ?? 0; }
}
