import * as THREE from 'three';
import {DEFAULT_GRAPHICS,type Graphics} from '../rendering/graphics';
import { generateChunk, type ChunkData } from './generate';
import { CHUNK_LENGTH, roadAt } from './road';
import { chunkWindow, MAX_CHUNKS,preparationCenter } from './window';
import { SceneryAssets, ScenerySlot } from './scenery-view';
import { RoadTopology } from './topology';
import type { Obstacle } from '../vehicle/collider';
import { surfaceMaterial, WorldUniforms } from '../rendering/world-materials';
import { TREE_KINDS, type TreeKind } from './tree-config';
import { SurfaceTextures } from '../rendering/surface-textures';
import {generateHorizon,type HorizonData} from './horizon';
import {terrainLodIndices,terrainLodRanges,TERRAIN_BAND_CELLS} from './terrain-lod';

type Slot = { group: THREE.Group; meshes: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>[]; scenery: ScenerySlot; obstacles: Obstacle[];hasBridge:boolean;terrainFine?:Uint8Array;terrainIndices:Uint16Array[];terrainIndex?:THREE.BufferAttribute;terrainLod:number;terrainBounds:Float32Array;terrainRanges:Uint32Array[];terrainCullRevision:number };
type Job = { id: number; token: number; started: number;horizon?:boolean };

export class WorldStream {
  private worker: Worker | undefined;
  private job: Job | undefined;
  private completed: ChunkData | undefined;
  private completedHorizon?:HorizonData;
  private horizon:THREE.Mesh<THREE.BufferGeometry,THREE.MeshStandardMaterial>;
  private horizonCutoff={value:new THREE.Vector2()};
  private horizonCenter=NaN;private horizonIndices:Uint32Array[]=[];private horizonIndex?:THREE.BufferAttribute;
  private token = 0;
  private generationSamples=import.meta.env.DEV?new Float32Array(120):undefined;
  private generationCount=0;private generationIndex=0;
  private active = new Map<number, Slot>();
  private pool: Slot[] = [];
  private wanted: number[] = [];
  private origin = { x: 0, z: 0 };
  private disposed = false;
  private suspended=false;
  private workerFailed=false;
  private sceneryAssets: SceneryAssets;
  private surfaceTextures: SurfaceTextures;
  private topology: RoadTopology;
  private graphics:Graphics={...DEFAULT_GRAPHICS};
  private frustum=new THREE.Frustum();
  private projection=new THREE.Matrix4();
  private cullPosition=new THREE.Vector3(Infinity,Infinity,Infinity);
  private cullRotation=new THREE.Quaternion();
  private cullProjection=NaN;
  private cullProjectionY=NaN;
  private cullRevision=0;
  private meshBounds=new THREE.Box3();
  private cameraDirection=new THREE.Vector3();
  private preparation=NaN;
  private heading=0;
  private materials = [
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }),
    new THREE.MeshStandardMaterial({ color: 0x252d35, roughness: .97 }),
    new THREE.MeshStandardMaterial({ color: 0x5d6058, roughness: 1,vertexColors:true,shadowSide:THREE.DoubleSide }),
    new THREE.MeshStandardMaterial({ color: 0xc4cbbf, roughness: .85 }),
    new THREE.MeshStandardMaterial({ color: 0x12282b, vertexColors:true, roughness: .18, metalness: 0, transparent:true, depthWrite:false }),
    new THREE.MeshStandardMaterial({color:0x727672,roughness:1,side:THREE.DoubleSide}),
    new THREE.MeshStandardMaterial({color:0xe2cdb0,emissive:0xffd7a3,emissiveIntensity:2,roughness:1,side:THREE.DoubleSide}),
    new THREE.MeshStandardMaterial({color:0x777c80,roughness:.97}),
    new THREE.MeshStandardMaterial({color:0xffffff,roughness:1,side:THREE.DoubleSide}),
  ];
  constructor(private scene: THREE.Scene, private seed: number, state:WorldUniforms, renderer:THREE.WebGLRenderer) {
    this.surfaceTextures=new SurfaceTextures(renderer);
    this.topology = new RoadTopology(seed); this.sceneryAssets = new SceneryAssets(state, this.surfaceTextures,renderer.capabilities.maxVaryings>8,renderer.capabilities.maxTextureSize);
    surfaceMaterial(this.materials[0], 'terrain', state, this.surfaceTextures); surfaceMaterial(this.materials[1], 'asphalt', state, this.surfaceTextures);
    surfaceMaterial(this.materials[2], 'gravel', state, this.surfaceTextures); surfaceMaterial(this.materials[3], 'plain', state); surfaceMaterial(this.materials[4], 'water', state);
    surfaceMaterial(this.materials[5],'concrete',state);surfaceMaterial(this.materials[8],'rock',state,this.surfaceTextures);surfaceMaterial(this.materials[6],'plain',state);surfaceMaterial(this.materials[7],'concrete',state);
    this.materials[4].envMapIntensity=1.8;
    const horizonMaterial=surfaceMaterial(this.materials[0].clone(),'terrain',state,this.surfaceTextures),compile=horizonMaterial.onBeforeCompile,key=horizonMaterial.customProgramCacheKey();
    horizonMaterial.onBeforeCompile=(shader,renderer)=>{
      compile.call(horizonMaterial,shader,renderer);shader.uniforms.rtHorizonCutoff=this.horizonCutoff;
      shader.fragmentShader='uniform vec2 rtHorizonCutoff;\n'+shader.fragmentShader.replace('#include <clipping_planes_fragment>','#include <clipping_planes_fragment>\nif(rtPosition.z>=rtHorizonCutoff.x&&rtPosition.z<=rtHorizonCutoff.y)discard;');
    };
    horizonMaterial.customProgramCacheKey=()=>key+'-horizon';
    this.horizon=new THREE.Mesh(new THREE.BufferGeometry(),horizonMaterial);this.horizon.visible=false;this.scene.add(this.horizon);
    this.startWorker();
  }
  async initialize() { await Promise.all([this.sceneryAssets.ready, this.surfaceTextures.ready]); }
  private startWorker() {
    try {
      this.worker = new Worker(new URL('../workers/world.worker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (event: MessageEvent<{ token: number; data?: ChunkData; horizon?:HorizonData;generationMs?:number;failed?: boolean }>) => {
        if (!this.job || event.data.token !== this.job.token || this.disposed) return;
        if(this.generationSamples&&event.data.generationMs!==undefined){this.generationSamples[this.generationIndex]=event.data.generationMs;this.generationIndex=(this.generationIndex+1)%120;this.generationCount=Math.min(120,this.generationCount+1);}
        if(this.job.horizon)this.completedHorizon=event.data.horizon??generateHorizon(this.job.id,this.seed);
        else this.completed = event.data.data ?? generateChunk(this.job.id, this.seed);
        this.job = undefined;
      };
      this.worker.onerror = event => { event.preventDefault(); this.fallback(); };
    } catch { this.worker = undefined;this.workerFailed=true; }
  }
  private fallback() {
    this.workerFailed=true;
    this.worker?.terminate(); this.worker = undefined;
    if (this.job){if(this.job.horizon)this.completedHorizon=generateHorizon(this.job.id,this.seed);else this.completed = generateChunk(this.job.id, this.seed);}
    this.job = undefined;
  }
  private slot(): Slot {
    const pooled = this.pool.pop();
    if (pooled) return pooled;
    const group = new THREE.Group();
    const meshes = this.materials.map(material => {
      const mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
      mesh.receiveShadow = true;
      group.add(mesh); return mesh;
    });
    this.scene.add(group);
    const scenery = new ScenerySlot(this.sceneryAssets); group.add(scenery.group);
    return { group, meshes, scenery, obstacles: [],hasBridge:false,terrainIndices:[],terrainLod:0,terrainBounds:new Float32Array(),terrainRanges:[],terrainCullRevision:-1 };
  }
  private upload(slot: Slot, data: ChunkData) {
    slot.hasBridge=false;for(let i=2;i<data.shoulderColors.length;i+=3)if(data.shoulderColors[i]>.5){slot.hasBridge=true;break;}
    const arrays = [data.terrain, data.road, data.shoulder, data.markings, data.water,data.tunnel,data.tunnelLamps,data.structure,data.excavation];
    slot.meshes.forEach((mesh, i) => {
      const geometry = mesh.geometry;
      const array = arrays[i];
      if(!array.length){geometry.setDrawRange(0,0);geometry.boundingBox??=new THREE.Box3(new THREE.Vector3(),new THREE.Vector3());geometry.boundingSphere??=new THREE.Sphere();return;}
      const existing = geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
      if (!existing || existing.array.length < array.length) {
        geometry.dispose();
        // Markings and bridge slab sides vary; reserve their maximum strip capacity.
        geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(i===2?Math.max(3600,array.length):i===3?2160:i===5?Math.max(36000,array.length):i===6?360:i===7?Math.max(16200,array.length):i===8?Math.max(24000,array.length):array.length), 3).setUsage(THREE.DynamicDrawUsage));
      }
      const position = geometry.getAttribute('position') as THREE.BufferAttribute;
      position.set(array);
      // Fixed terrain/road/water buffers are fully overwritten. Only clear the
      // unused tail of reserved variable strips for conservative bound scans.
      (position.array as Float32Array).fill(0,array.length); position.needsUpdate = true;
      geometry.setDrawRange(0, array.length / 3);
      if (i === 0) {
        if(!slot.terrainFine||slot.terrainFine.some((v,i)=>v!==data.terrainFine[i])){slot.terrainFine=data.terrainFine;slot.terrainIndices=terrainLodIndices(array.length/(20*18),20,data.terrainFine);slot.terrainRanges=terrainLodRanges(array.length/(20*18),20,data.terrainFine);}
        slot.terrainIndex??=new THREE.BufferAttribute(new Uint16Array(slot.terrainIndices[0].length),1).setUsage(THREE.DynamicDrawUsage);
        slot.terrainIndex!.set(slot.terrainIndices[0]);slot.terrainIndex!.needsUpdate=true;geometry.setIndex(slot.terrainIndex!);geometry.setDrawRange(0,slot.terrainIndices[0].length);slot.terrainLod=0;
        let color = geometry.getAttribute('color') as THREE.BufferAttribute | undefined;
        if (!color) { color = new THREE.BufferAttribute(new Float32Array(data.colors.length), 3); geometry.setAttribute('color', color); }
        color.set(data.colors); color.needsUpdate = true;
        let normal = geometry.getAttribute('normal') as THREE.BufferAttribute | undefined;
        if (!normal) { normal = new THREE.BufferAttribute(new Float32Array(data.terrainNormals.length), 3); geometry.setAttribute('normal', normal); }
        normal.set(data.terrainNormals); normal.needsUpdate = true;
      }
      else {
        if(i===4||i===2){
          const values=i===4?data.waterColors:data.shoulderColors;
          let color=geometry.getAttribute('color') as THREE.BufferAttribute|undefined;
          if(!color){color=new THREE.BufferAttribute(new Float32Array(i===2?3600:values.length),3);geometry.setAttribute('color',color);}
          color.set(values);color.needsUpdate=true;
        }
        geometry.computeVertexNormals();
      }
      if(i===5||i===7||i===8)mesh.castShadow=true;
      geometry.computeBoundingSphere();
      geometry.computeBoundingBox();
    });
    slot.terrainBounds=data.terrainBounds;slot.terrainCullRevision=-1;
    slot.group.position.set(-this.origin.x, 0, data.id * CHUNK_LENGTH - this.origin.z);
    slot.scenery.upload(data.scenery); slot.obstacles = data.scenery.obstacles;
    slot.group.visible = true;
  }
  tick(z: number, x = roadAt(z, this.seed).x, camera?:THREE.PerspectiveCamera,speed=0,heading=0) {
    if(this.suspended)return;
    this.heading=heading;
    this.topology.update(z);
    if(camera)camera.getWorldDirection(this.cameraDirection);
    const preparation=preparationCenter(z,speed,heading,camera?this.cameraDirection.z:0);
    if(preparation!==this.preparation){this.wanted=chunkWindow(preparation);this.preparation=preparation;}
    for (const [id, slot] of this.active) {
      if (!this.wanted.includes(id)) { this.active.delete(id); slot.group.visible = false; this.pool.push(slot); }
    }
    if (this.job && performance.now() - this.job.started > 8000) this.fallback();
    if (this.completed) {
      const data = this.completed; this.completed = undefined;
      if (this.wanted.includes(data.id) && !this.active.has(data.id)) {
        const slot = this.slot(); this.upload(slot, data); this.active.set(data.id, slot);
      }
    }
    if(this.completedHorizon){
      const data=this.completedHorizon;this.completedHorizon=undefined;
      if(data.center===this.preparation){
        for(const [name,array] of [['position',data.positions],['normal',data.normals],['color',data.colors]] as const){
          let attribute=this.horizon.geometry.getAttribute(name) as THREE.BufferAttribute|undefined;
          if(!attribute){attribute=new THREE.BufferAttribute(new Float32Array(array.length),3).setUsage(THREE.DynamicDrawUsage);this.horizon.geometry.setAttribute(name,attribute);}
          attribute.set(array);attribute.needsUpdate=true;
        }
        this.horizonIndices=data.indices;this.updateHorizonIndex();
        this.horizonCenter=data.center;this.horizon.position.set(-this.origin.x,0,data.center*CHUNK_LENGTH-this.origin.z);this.horizon.geometry.computeBoundingSphere();this.horizon.visible=true;
      }
    }
    if (!this.job) {
      const id = this.wanted.find(value => !this.active.has(value));
      if (id !== undefined) {
        if (this.worker) {
          this.job = { id, token: ++this.token, started: performance.now() };
          this.worker.postMessage({ id, seed: this.seed, token: this.token });
        } else this.completed = generateChunk(id, this.seed);
      }else if(this.horizonCenter!==this.preparation){
        if(this.worker){this.job={id:this.preparation,token:++this.token,started:performance.now(),horizon:true};this.worker.postMessage({id:this.preparation,seed:this.seed,token:this.token,horizon:true});}
        else this.completedHorizon=generateHorizon(this.preparation,this.seed);
      }
    }
    this.updateVisibility(z,x,camera);
  }
  private cullTerrain(slot:Slot,camera?:THREE.PerspectiveCamera){
    const mesh=slot.meshes[0],ranges=slot.terrainRanges[slot.terrainLod];
    if(!camera){mesh.geometry.setDrawRange(0,slot.terrainIndices[slot.terrainLod].length);mesh.visible=true;slot.terrainCullRevision=-1;return;}
    if(slot.terrainCullRevision===this.cullRevision)return;
    slot.terrainCullRevision=this.cullRevision;
    let first=Infinity,last=-1;const bounds=slot.terrainBounds;
    for(let i=0;i<bounds.length;i+=6){
      this.meshBounds.min.set(bounds[i]+slot.group.position.x,bounds[i+1],bounds[i+2]+slot.group.position.z);
      this.meshBounds.max.set(bounds[i+3]+slot.group.position.x,bounds[i+4],bounds[i+5]+slot.group.position.z);
      const distance=Math.hypot((this.meshBounds.min.x+this.meshBounds.max.x)*.5-camera.position.x,(this.meshBounds.min.z+this.meshBounds.max.z)*.5-camera.position.z);
      this.meshBounds.expandByScalar(8+distance*.04);
      if(this.frustum.intersectsBox(this.meshBounds)){first=Math.min(first,i/6*TERRAIN_BAND_CELLS);last=Math.min(ranges.length-1,(i/6+1)*TERRAIN_BAND_CELLS);}
    }
    mesh.visible=last>=0;
    mesh.geometry.setDrawRange(last>=0?ranges[first]:0,last>=0?ranges[last]-ranges[first]:0);
  }
  updateVisibility(z:number,x:number,camera?:THREE.PerspectiveCamera,heading=this.heading){
    this.heading=heading;
    let min=Infinity,max=-Infinity;for(const id of this.active.keys()){min=Math.min(min,id);max=Math.max(max,id);}
    this.horizonCutoff.value.set(min*CHUNK_LENGTH-this.origin.z,(max+1)*CHUNK_LENGTH-this.origin.z);
    if(camera){
      camera.updateMatrixWorld();
      const projection=camera.projectionMatrix.elements[0],projectionY=camera.projectionMatrix.elements[5];
      if(camera.position.distanceToSquared(this.cullPosition)>64||camera.quaternion.angleTo(this.cullRotation)>.04||Math.abs(projection-this.cullProjection)>.01||Math.abs(projectionY-this.cullProjectionY)>.01||!Number.isFinite(this.cullProjection)){
        this.projection.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);this.frustum.setFromProjectionMatrix(this.projection);
        this.cullPosition.copy(camera.position);this.cullRotation.copy(camera.quaternion);this.cullProjection=projection;this.cullProjectionY=projectionY;this.cullRevision++;
      }
    }
    for(const [id,slot] of this.active){
      const distance=Math.abs(id*CHUNK_LENGTH+100-z);
      const lod=distance>1800?2:distance<({Low:300,Medium:500,High:750}[this.graphics.terrain])?0:1;
      if(lod!==slot.terrainLod){const indices=slot.terrainIndices[lod];slot.terrainIndex!.set(indices);slot.terrainIndex!.needsUpdate=true;slot.meshes[0].geometry.setDrawRange(0,indices.length);slot.terrainLod=lod;slot.terrainCullRevision=-1;}
      this.cullTerrain(slot,camera);
      const deckShadow=slot.hasBridge&&Math.max(id*CHUNK_LENGTH-z,z-(id+1)*CHUNK_LENGTH,0)<180;
      for(const mesh of slot.meshes){if(mesh===slot.meshes[0])continue;this.meshBounds.copy(mesh.geometry.boundingBox!).translate(slot.group.position);
        const caster=(mesh===slot.meshes[5]||mesh===slot.meshes[8])?distance<180:(mesh===slot.meshes[2]||mesh===slot.meshes[7])&&deckShadow;
        mesh.visible=mesh.geometry.drawRange.count>0&&(!camera||this.frustum.intersectsBox(this.meshBounds)||caster);
        if(mesh===slot.meshes[5]||mesh===slot.meshes[8]||mesh===slot.meshes[2]||mesh===slot.meshes[7])mesh.castShadow=caster;
      }
      slot.scenery.update(distance,x,z-id*CHUNK_LENGTH,camera?this.frustum:undefined,camera?this.cullRevision:undefined,this.heading);
    }
  }
  private updateHorizonIndex(){
    if(!this.horizonIndices.length)return;
    const indices=this.horizonIndices[{Low:0,Medium:1,High:2}[this.graphics.distant]];
    if(!this.horizonIndex){this.horizonIndex=new THREE.BufferAttribute(new Uint32Array(this.horizonIndices[2].length),1).setUsage(THREE.DynamicDrawUsage);this.horizon.geometry.setIndex(this.horizonIndex);}
    this.horizonIndex.set(indices);this.horizonIndex.needsUpdate=true;this.horizon.geometry.setDrawRange(0,indices.length);
  }
  setGraphics(graphics:Graphics) {this.graphics={...graphics};this.updateHorizonIndex();for(const slot of this.active.values())slot.scenery.invalidate();}
  suspend(){this.suspended=true;if(this.job){this.worker?.terminate();this.worker=undefined;this.job=undefined;}}
  resume(){this.suspended=false;if(!this.worker&&!this.workerFailed)this.startWorker();}
  obstaclesNear(z: number) {
    const id = Math.floor(z / CHUNK_LENGTH);
    return [this.active.get(id - 1)?.obstacles ?? [], this.active.get(id)?.obstacles ?? [], this.active.get(id + 1)?.obstacles ?? []];
  }
  rebase(origin: { x: number; z: number }) {
    this.origin = origin;
    for (const [id, slot] of this.active) slot.group.position.set(-origin.x, 0, id * CHUNK_LENGTH - origin.z);
    if(Number.isFinite(this.horizonCenter))this.horizon.position.set(-origin.x,0,this.horizonCenter*CHUNK_LENGTH-origin.z);
  }
  hasGround(z: number) { return this.active.has(Math.floor(z / CHUNK_LENGTH)); }
  get ready() { return this.active.size === MAX_CHUNKS&&this.horizonCenter===this.preparation; }
  get progress() { return this.active.size / MAX_CHUNKS; }
  get stats() {
    const forest={trees:0,near:0,middle:0,images:0,grass:0,shadowTrees:0,overlap:0,culled:0,species:Object.fromEntries(TREE_KINDS.map(kind=>[kind,0])) as Record<TreeKind,number>};
    for(const slot of this.active.values()) {
      const trees=slot.scenery.statistics;
      for(const key of ['trees','near','middle','images','grass','shadowTrees','overlap','culled'] as const) forest[key]+=trees[key];
      for(const kind of TREE_KINDS) forest.species[kind]+=trees.species[kind];
    }
    const samples=this.generationSamples?Array.from(this.generationSamples.subarray(0,this.generationCount)).sort((a,b)=>a-b):[];
    const generation=import.meta.env.DEV?{samples:samples.length,medianMs:samples[Math.floor((samples.length-1)*.5)]??0,p95Ms:samples[Math.floor((samples.length-1)*.95)]??0}:undefined;
    return { generation,forest,allocatedWorldGeometries:[...this.active.values(),...this.pool].reduce((sum,slot)=>sum+slot.meshes.length,0),renderBudgets:{terrain:this.graphics.terrain,distant:this.graphics.distant,terrainIndices:[...this.active.values()].reduce((sum,slot)=>sum+slot.meshes[0].geometry.drawRange.count,0),horizonIndices:this.horizon.geometry.drawRange.count}, bridgeShadowChunks:[...this.active.values()].filter(slot=>slot.hasBridge&&slot.meshes[2].castShadow).length, chunks: this.active.size, slots: this.active.size + this.pool.length, pending: Number(!!this.job) + Number(!!this.completed)+Number(!!this.completedHorizon), worker: !!this.worker, topologySamples: this.topology.samples.length, topologyEnd: this.topology.ahead, detailRadius: 500,horizonDistance:5600,preparedCenter:this.preparation*CHUNK_LENGTH, colliders: [...this.active.values()].reduce((sum, slot) => sum + slot.obstacles.length, 0) };
  }
  dispose() {
    this.disposed = true; this.worker?.terminate();
    for (const slot of [...this.active.values(), ...this.pool]) {
      for (const mesh of slot.meshes) mesh.geometry.dispose();
      slot.scenery.dispose();
      this.scene.remove(slot.group);
    }
    this.materials.forEach(material => material.dispose());
    this.sceneryAssets.dispose();
    this.surfaceTextures.dispose();
    this.horizon.geometry.dispose();this.horizon.material.dispose();this.scene.remove(this.horizon);
    this.active.clear(); this.pool = []; this.completed = undefined;this.completedHorizon=undefined; this.job = undefined;
  }
}
