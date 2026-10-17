import { describe, expect, it } from 'vitest';
import { generateChunk } from '../../src/world/generate';
import { CHUNK_LENGTH, nearestRoad, roadAt, terrainHeight } from '../../src/world/road';
import { chunkWindow, MAX_CHUNKS, originFor } from '../../src/world/window';
import { terrainMeshHeight } from '../../src/world/terrain-grid';

describe('continuous deterministic world', () => {
  it('matches terrain and road edges across positive and negative chunk seams', () => {
    for (const seed of [0, 1, 8675309, 0xffffffff]) {
      for (const id of [-501, -1, 0, 70, 50000]) {
        const a = generateChunk(id, seed), b = generateChunk(id + 1, seed);
        for (const field of ['terrain', 'road', 'shoulder', 'water'] as const) {
          const edge = (array: Float32Array, z: number) => {
            const points: string[] = [];
            for (let i = 0; i < array.length; i += 3) if (array[i + 2] === z) points.push(`${array[i]}:${array[i + 1]}`);
            return [...new Set(points)].sort();
          };
          expect(edge(a[field], CHUNK_LENGTH)).toEqual(edge(b[field], 0));
        }
      }
    }
  }, 15000); // Exhaustive geometry/seam checks scale with the denser landscape grid.
  it('regenerates exactly after recycling and varies with a new session seed', () => {
    expect(generateChunk(10, 4)).toEqual(generateChunk(10, 4));
    expect(generateChunk(10, 4).terrain).not.toEqual(generateChunk(10, 5).terrain);
  });
  it('matches off-road contacts to rendered triangles and shares smooth normals at seams', () => {
    for (const seed of [0, 8675309, 0xffffffff]) for (const id of [-16, 0, 17, 50000]) {
      const a = generateChunk(id, seed), b = generateChunk(id + 1, seed);
      for (let i = 0; i < a.terrain.length; i += 9) {
        const x = (a.terrain[i] + a.terrain[i + 3] + a.terrain[i + 6]) / 3;
        const y = (a.terrain[i + 1] + a.terrain[i + 4] + a.terrain[i + 7]) / 3;
        const z = (a.terrain[i + 2] + a.terrain[i + 5] + a.terrain[i + 8]) / 3 + id * CHUNK_LENGTH;
        expect(terrainMeshHeight(x, z, seed), `seed ${seed}, chunk ${id}, triangle ${i / 9}`).toBeCloseTo(y, 3);
      }
      const seam = (data: typeof a, z: number) => {
        const values = new Map<number, string>();
        for (let i = 0; i < data.terrain.length; i += 3) if (data.terrain[i + 2] === z) values.set(data.terrain[i], [...data.terrainNormals.subarray(i,i+3),...data.colors.subarray(i,i+3)].join(','));
        return [...values].sort((left, right) => left[0] - right[0]);
      };
      expect(seam(a, CHUNK_LENGTH)).toEqual(seam(b, 0));
    }
  }, 15000); // Preserve every triangle/contact comparison, including distant terrain.
  it('stays finite with modest grades and curvature over randomized 10,000 km routes', () => {
    for (let seed = 0; seed < 100; seed++) for (let i = 0; i < 100; i++) {
      const z = (i - 50) * 100000 + seed * 13;
      const p = roadAt(z, seed * 91939);
      const next = roadAt(z + 1, seed * 91939);
      expect(Math.abs(p.grade)).toBeLessThan(.07);
      expect(Math.abs(next.heading - p.heading)).toBeLessThan(1 / 150);
      expect(Number.isFinite(terrainHeight(p.x + 70, z, seed))).toBe(true);
    }
  }, 180000); // Same 10,000 cold seed/distance cases; shared/thermally limited hosts measured 95 s. This is not a frame-time budget.
  it('recovery finds a perpendicular projection onto the road', () => {
    const p = nearestRoad(200, 1240, 123);
    expect(Math.abs((p.x - 200) * p.dx + p.z - 1240)).toBeLessThan(.01);
  });
  it('bounds resident chunks while driving, reversing and jumping huge distances', () => {
    const resident = new Set<number>(); let allocated = 0; let pooled = 0;
    for (const direction of [1, -1]) for (let step = 0; step < 3000; step++) {
      const ids = chunkWindow(direction * step);
      for (const id of resident) if (!ids.includes(id)) { resident.delete(id); pooled++; }
      for (const id of ids) if (!resident.has(id)) { if (pooled) pooled--; else allocated++; resident.add(id); }
      expect(resident.size).toBe(MAX_CHUNKS); expect(allocated).toBe(MAX_CHUNKS);
      const origin = originFor(92, direction * step * 200);
      expect(Math.abs(direction * step * 200 - origin.z)).toBeLessThan(1000);
    }
  });
});
