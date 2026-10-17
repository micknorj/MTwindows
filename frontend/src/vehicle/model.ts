import * as THREE from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { assetUrl } from '../assets';
import { VEHICLE_ASSET, unpackVehicle } from './package';
import { DEFAULT_BODY, type BodyBox } from './collider';
import {surfaceMaterial,WorldUniforms} from '../rendering/world-materials';
import { createHeadlights } from './headlights';

export class VehicleVisual {
  readonly group = new THREE.Group();
  colliders: BodyBox[] = DEFAULT_BODY;
  private wheelPairs: { steer: THREE.Object3D; spin: THREE.Object3D; front: boolean; restY: number }[] = [];
  private followers: { target: THREE.Object3D; source: THREE.Object3D }[] = [];
  private wing?: THREE.Object3D;
  private tail?: THREE.MeshStandardMaterial;
  private front?:THREE.MeshStandardMaterial;
  private frontIntensity=1;
  private rear?:THREE.PointLight;
  private lightsOn=true;
  private braking=false;
  private reverse?: THREE.MeshStandardMaterial;
  private calipers: THREE.Object3D[] = [];
  private paint?: THREE.MeshStandardMaterial;
  private disposed = false;
  private headlights: THREE.SpotLight[] = [];
  private roll = 0;
  private stats = { kind: 'loading', visualTriangles: 0, visualCalls: 0, shadowTriangles: 0, colliderCount: 1, width: 2.03, length: 4.9, height: 1.16 };

  async initialize(progress: (value: number) => void, signal?: AbortSignal, maximumVaryings=16,state=new WorldUniforms()) {
    if (this.disposed || signal?.aborted) throw new Error('Loading was interrupted. Please retry.');
    // Development and release deliberately resolve the same reviewed resource.
    // A missing/corrupt asset must produce Retry, never a different vehicle.
    const timeout = AbortSignal.timeout(30000);
    const loadingSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const response = await fetch(assetUrl(VEHICLE_ASSET), {signal: loadingSignal, credentials: 'omit'});
    if (!response.ok || !response.body) throw new Error('Vehicle unavailable. Retry to load again.');
    const length = Number(response.headers.get('content-length'));
    const reader = response.body.getReader(), chunks: Uint8Array[] = [];
    let received = 0;
    try {
      while (true) {
        const {done, value} = await reader.read(); if (done) break;
        received += value.length;
        if (received > 4 * 1024 * 1024) { await reader.cancel(); throw new Error('Invalid vehicle resource. Retry to load again.'); }
        chunks.push(value); progress(length ? Math.min(.85, received / length * .85) : .4);
      }
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(received); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const decoded = await unpackVehicle(bytes); progress(.9);
    const {GLTFLoader} = await import('three/addons/loaders/GLTFLoader.js');
    const gltf = await new GLTFLoader().parseAsync(decoded, '');
    if (this.disposed || loadingSignal.aborted) {
      this.group.add(...gltf.scenes); this.dispose(); throw new Error('Loading was interrupted. Please retry.');
    }
    try { this.attach(gltf, maximumVaryings,state); this.setLights(this.lightsOn); progress(1); }
    catch (error) { this.group.add(...gltf.scenes); this.dispose(); throw error; }
  }

  private attach(gltf: GLTF,maximumVaryings:number,state:WorldUniforms) {
    const visual = gltf.scene;
    const proxies = gltf.scenes.find(scene => scene !== visual && !!scene.getObjectByName('CollisionProxy'));
    if (!visual || !proxies) throw new Error('The vehicle is missing its visual/proxy handoff scenes.');
    this.group.add(visual, proxies);
    const collision = proxies.getObjectByName('CollisionProxy');
    this.colliders = [];
    collision?.traverse(node => { if (node.userData.shape === 'box') this.colliders.push({ centre: node.userData.centre, halfExtents: node.userData.halfExtents }); });
    if (this.colliders.length !== 4) throw new Error('The vehicle requires four collision boxes.');
    if (collision) collision.visible = false;
    const shadowMaterial = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, side: THREE.DoubleSide });
    let triangles = 0, calls = 0, shadowTriangles = 0;
    visual.traverse(node => {
      if (!(node instanceof THREE.Mesh)) return;
      node.castShadow = false; node.receiveShadow = true;
      triangles += (node.geometry.index?.count ?? node.geometry.getAttribute('position').count) / 3;
      calls += Math.max(1, node.geometry.groups.length);
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      // Under a restricted varying budget, Three.js's derivative TBN preserves
      // normal maps without the two exported tangent-frame varyings. Source
      // assets stay untouched and unrestricted GPUs retain exported tangents.
      if(maximumVaryings<=8&&materials.some(material=>material.normalMap))node.geometry.deleteAttribute('tangent');
      for (const material of materials) {
        if(!material.userData.rimmileShadows){surfaceMaterial(material,'plain',state);material.userData.rimmileShadows=true;}
        if (material.name === 'TailLamp') this.tail = material;
        if (material.name === 'Headlamp'){this.front=material;this.frontIntensity=material.emissiveIntensity;}
        if (material.name === 'ReverseLamp') this.reverse = material;
        if (material.name === 'SatinWhite') { this.paint = material; material.envMapIntensity = 1.6; }
      }
    });
    proxies.getObjectByName('ShadowProxy')?.traverse(node => {
      if (node.userData.follows) {
        const source = visual.getObjectByName(node.userData.follows);
        if (source) this.followers.push({ target: node, source });
      }
      if (node instanceof THREE.Mesh) {
        node.material = shadowMaterial; node.castShadow = true; node.receiveShadow = false;
        shadowTriangles += (node.geometry.index?.count ?? node.geometry.getAttribute('position').count) / 3;
      }
    });
    for (const name of ['FL', 'FR', 'RL', 'RR']) {
      const steer = visual.getObjectByName(`Wheel_${name}Steer`), spin = visual.getObjectByName(`Wheel_${name}Surface`);
      if (!steer || !spin) throw new Error('The vehicle is missing independent wheel pivots.');
      this.wheelPairs.push({ steer, spin, front: name.startsWith('F'), restY: steer.position.y });
      const caliper = visual.getObjectByName(`BrakeCaliper${name}`); if (caliper) this.calipers.push(caliper);
    }
    this.wing = visual.getObjectByName('ActiveWingPivot');
    visual.updateMatrixWorld(true);
    const size = new THREE.Box3().setFromObject(visual).getSize(new THREE.Vector3());
    if (size.z < 4.7 || size.z > 5.2 || size.x < 1.9 || size.x > 2.4 || size.y < 1 || size.y > 1.3) throw new Error('The vehicle does not match the metre-scale handoff.');
    this.stats = { kind: 'optimized', visualTriangles: triangles, visualCalls: calls, shadowTriangles, colliderCount: this.colliders.length, width: size.x, length: size.z, height: size.y };
    this.headlights = createHeadlights(this.group);
    const rear = this.rear = new THREE.PointLight(0xff2010, .6, 3, 2); rear.position.set(0, .55, -2.4);
    this.group.add(rear);
    this.update(0, 0, false, 0);
  }
  setShadowDetail(size:512|768|1024) {
    for (const light of this.headlights) if (light.shadow.mapSize.x !== size) { light.shadow.map?.dispose(); light.shadow.map = null; light.shadow.mapSize.set(size, size); }
  }
  setLights(on:boolean){
    this.lightsOn=on;
    for(const light of this.headlights){light.visible=on;light.castShadow=on;}
    if(this.front)this.front.emissiveIntensity=on?this.frontIntensity:0;
    this.updateLamps();
  }
  private updateLamps(){
    if(this.tail)this.tail.emissiveIntensity=this.braking?3:(this.lightsOn ? .8 : 0);
    if(this.rear)this.rear.intensity=this.braking ? .9 : (this.lightsOn ? .6 : 0);
  }
  inspectHeadlights(lamp: -1|0|1|2){if(import.meta.env.DEV)this.headlights.forEach((light,i)=>{light.visible=lamp===2||lamp===i;});}
  update(speed: number, steer: number, braking: boolean, dt: number, travel: readonly number[] = [], angular:readonly number[]=[],angles:readonly number[]=[],reverseSelected=speed<-.15) {
    this.braking=braking;
    this.wheelPairs.forEach((wheel, i) => { wheel.steer.rotation.y = angles[i]??(wheel.front?steer:0); wheel.steer.position.y = wheel.restY + (travel[i] ?? 0); wheel.spin.rotation.x=(wheel.spin.rotation.x+(angular[i]??speed/.3425)*dt)%(Math.PI*2); });
    this.roll=this.wheelPairs[0]?.spin.rotation.x??0;
    if (this.wing) this.wing.rotation.x += ((braking && speed > 12 ? .2 : Math.abs(speed) > 35 ? .09 : 0) - this.wing.rotation.x) * (1 - Math.exp(-4 * dt));
    for (const { target, source } of this.followers) { target.position.copy(source.position); target.quaternion.copy(source.quaternion); }
    this.updateLamps();
    if (this.reverse) this.reverse.emissiveIntensity = reverseSelected ? 1.5 : 0;
  }
  get diagnostics() { return { ...this.stats, lightsOn:this.lightsOn,tailEmission:this.tail?.emissiveIntensity, rearIntensity:this.rear?.intensity??0, headlights: this.headlights.map(light => ({ x:light.position.x, y:light.position.y, z:light.position.z, shadow:light.castShadow,shadowSize:light.shadow.mapSize.x, visible:light.visible, intensity:light.visible?light.intensity:0, profile:!!light.map })), wheelSpin: this.roll, frontSteer: this.wheelPairs[0]?.steer.rotation.y ?? 0, rearSteer: this.wheelPairs[2]?.steer.rotation.y ?? 0, calipersStationary: this.calipers.every(node => node.rotation.x === 0), shadowError: Math.max(0, ...this.followers.map(({ source, target }) => source.position.distanceTo(target.position) + source.quaternion.angleTo(target.quaternion))), paintRoughness: this.paint?.roughness, wing: this.wing?.rotation.x ?? 0 }; }
  dispose() {
    this.disposed = true;
    const materials = new Set<THREE.Material>(), textures = new Set<THREE.Texture>();
    this.group.traverse(node => {
      if (node instanceof THREE.Mesh) {
        node.geometry.dispose();
        for (const material of Array.isArray(node.material) ? node.material : [node.material]) materials.add(material);
      }
      if (node instanceof THREE.SpotLight) { if (node.map) textures.add(node.map); node.dispose(); }
    });
    for (const material of materials) { for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value); material.dispose(); }
    textures.forEach(texture => { texture.dispose(); if (typeof ImageBitmap !== 'undefined' && texture.source.data instanceof ImageBitmap) texture.source.data.close(); });
    this.group.clear(); this.wheelPairs = []; this.followers = [];
  }
}
