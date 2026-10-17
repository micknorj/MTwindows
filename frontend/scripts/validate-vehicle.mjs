import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { Box3, Matrix4, Quaternion, Vector3 } from 'three';

const expected = { 'revuelto.blend': 'ed98c51215e37cbbd02d2a2f0a3e8c18b9adb4b95f1a9e62bdfa30af5660932a', 'optimized-car.glb': '7980bcc8059c823377352bef1091088ede0385e6a8551712bdb90ce8cd024288' };
for (const [name, hash] of Object.entries(expected)) assert.equal(crypto.createHash('sha256').update(fs.readFileSync(`model-optimization/${name}`)).digest('hex'), hash, `${name} changed since handoff`);
const bytes = fs.readFileSync('model-optimization/optimized-car.glb');
assert.equal(bytes.readUInt32LE(0), 0x46546c67); assert.equal(bytes.readUInt32LE(4), 2); assert.equal(bytes.readUInt32LE(8), bytes.length);
const jsonLength = bytes.readUInt32LE(12), gltf = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString());
assert(gltf.buffers.every(buffer => !buffer.uri)); assert(gltf.images.every(image => !image.uri && image.bufferView !== undefined));
assert(!/lamborghini|revuelto|cgtrader|badge|logo/i.test(JSON.stringify(gltf)), 'Unapproved branding in metadata');
const triangleCount = mesh => mesh.primitives.reduce((sum, p) => sum + gltf.accessors[p.indices].count / 3, 0);
const visualBounds = new Box3(), counts = { visual: 0, shadow: 0, collision: 0, visualCalls: 0 };
function visit(index, parent = new Matrix4(), role = 'visual') {
  const node = gltf.nodes[index], local = new Matrix4().compose(new Vector3(...(node.translation ?? [0, 0, 0])), new Quaternion(...(node.rotation ?? [0, 0, 0, 1])), new Vector3(...(node.scale ?? [1, 1, 1])));
  const world = parent.clone().multiply(node.matrix ? new Matrix4().fromArray(node.matrix) : local);
  if (node.extras?.role === 'shadowOnly') role = 'shadow';
  if (node.extras?.role === 'collisionOnly') role = 'collision';
  if (node.mesh !== undefined) {
    const mesh = gltf.meshes[node.mesh]; counts[role] += triangleCount(mesh);
    if (role === 'visual') {
      counts.visualCalls += mesh.primitives.length;
      for (const p of mesh.primitives) { const accessor = gltf.accessors[p.attributes.POSITION]; visualBounds.union(new Box3(new Vector3(...accessor.min), new Vector3(...accessor.max)).applyMatrix4(world)); }
    }
  }
  for (const child of node.children ?? []) visit(child, world, role);
}
for (const scene of gltf.scenes) for (const node of scene.nodes) visit(node);
assert.equal(counts.visual, 80364); assert.equal(counts.shadow, 6613); assert.equal(counts.collision, 48); assert.equal(counts.visualCalls, 21);
const colliders = gltf.nodes.filter(node => node.extras?.shape === 'box'); assert.equal(colliders.length, 4);
for (const wheel of ['FL', 'FR', 'RL', 'RR']) {
  assert(gltf.nodes.some(node => node.name === `Wheel_${wheel}Steer`)); assert(gltf.nodes.some(node => node.name === `Wheel_${wheel}Surface`));
  assert(gltf.nodes.some(node => node.name === `BrakeCaliper${wheel}`));
}
const binary = bytes.subarray(28 + jsonLength);
let textureBytes = 0;
const textures = gltf.images.map(image => { const view = gltf.bufferViews[image.bufferView], png = binary.subarray(view.byteOffset, view.byteOffset + view.byteLength); const width = png.readUInt32BE(16), height = png.readUInt32BE(20); textureBytes += width * height * 4 * 4 / 3; return { width, height }; });
console.log(JSON.stringify({ bytes: bytes.length, ...counts, dimensions: visualBounds.getSize(new Vector3()).toArray(), textures, textureMiB: textureBytes / 1048576, license: gltf.asset.extras.licenseStatus, sourceHashesUnchanged: true }, null, 2));
