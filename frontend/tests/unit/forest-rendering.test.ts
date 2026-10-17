import { describe, expect, it } from 'vitest';
import { treeGeometry, impostorGeometry } from '../../src/world/tree-assets';
import { TREE_KINDS } from '../../src/world/tree-config';
import { TREE_CARD_PROFILE } from '../../src/world/tree-card-profile';
import { generateScenery } from '../../src/world/scenery';
import { roadAt } from '../../src/world/road';

describe('original forest representations', () => {
  it('bakes the full crown extent and trims only conservative atlas envelopes', () => {
    for (const kind of TREE_KINDS) {
      const near = treeGeometry(kind), far = impostorGeometry(kind);
      near.computeBoundingBox();
      const bounds = near.boundingBox!, profile = TREE_CARD_PROFILE[kind];
      const extent = 2 * Math.max(Math.abs(bounds.min.x), Math.abs(bounds.max.x), Math.abs(bounds.min.z), Math.abs(bounds.max.z));
      // The old fixed-width bake clipped wide crowns before the LOD transition.
      expect(profile.width).toBeGreaterThan(extent);
      expect(profile.width - extent).toBeCloseTo(.04, 4);
      expect(profile.halfWidths).toHaveLength(9);
      expect(far.index!.count / 3).toBe(16);
      for (const value of far.getAttribute('position').array) expect(Number.isFinite(value)).toBe(true);
      for (const width of profile.halfWidths) { expect(width).toBeGreaterThan(0); expect(width).toBeLessThanOrEqual(.5); }
      const area = profile.halfWidths.slice(1).reduce((sum, width, band) => sum + (width + profile.halfWidths[band]) / 8, 0);
      expect(area).toBeGreaterThan(.5); expect(area).toBeLessThan(.9);
      near.dispose(); far.dispose();
    }
  });

  it('forms mixed-age distant stands within canonical chunk boundaries', () => {
    let trees = 0, grouped = 0, small = 0, large = 0;
    for (const id of [-3, 0, 7, 14]) {
      const data = generateScenery(id, 1942), points: { x: number; z: number }[] = [];
      for (const kind of TREE_KINDS) {
        const values = data.instances[kind];
        for (let i = 0; i < values.length; i += 7) {
          expect(values[i + 2]).toBeGreaterThanOrEqual(0); expect(values[i + 2]).toBeLessThan(200);
          const z = id * 200 + values[i + 2];
          if (Math.abs(values[i] - roadAt(z, 1942).x) > 550) {
            points.push({ x: values[i], z });
            if (values[i + 4] < 13) small++;
            if (values[i + 4] > 17) large++;
          }
        }
      }
      trees += points.length;
      grouped += points.filter((p, i) => points.some((q, j) => i !== j && Math.hypot(p.x - q.x, p.z - q.z) < 32)).length;
    }
    expect(trees).toBeGreaterThan(100); expect(grouped / trees).toBeGreaterThan(.75);
    expect(small).toBeGreaterThan(20); expect(large).toBeGreaterThan(20);
  });
});
