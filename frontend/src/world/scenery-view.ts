import * as THREE from 'three';
import {mergeVertices,mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import { INSTANCE_CAPACITY, SCENERY_KINDS, type SceneryData, type SceneryKind } from './scenery';
import { plantWind, surfaceMaterial, vegetationMaterial, WorldUniforms } from '../rendering/world-materials';
import { TREE_KINDS, treeHeroDistance, treeMiddleDistance, type TreeKind } from './tree-config';
import { plantClusters,type PlantCluster } from './spatial';
import { foliageTexture, treeGeometry, impostorGeometry, impostorMaterial, loadTreeAtlas, plantFade } from './tree-assets';
import type { SurfaceTextures } from '../rendering/surface-textures';
const PLANT_KINDS=[...TREE_KINDS,'rock','grass'] as const;
type PlantKind=typeof PLANT_KINDS[number];

function rock() {
  const geometry = new THREE.IcosahedronGeometry(.6, 2), position = geometry.getAttribute('position');
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i), y = position.getY(i), z = position.getZ(i);
    const ridge = 1 + .17 * Math.sin(x * 11 + z * 7) + .1 * Math.cos(y * 13 - x * 5);
    position.setXYZ(i, x * ridge, Math.max(.015, y * ridge + .36), z * ridge);
  }
  geometry.deleteAttribute('normal');geometry.deleteAttribute('uv');
  const smooth=mergeVertices(geometry,.0001);geometry.dispose();smooth.computeVertexNormals();return smooth;
}
function grassTuft(middle=false) {
  if(middle){
    const parts=[0,Math.PI/2].map(angle=>{
      const card=new THREE.PlaneGeometry(.95,1,2,1).translate(0,.5,0),p=card.getAttribute('position');
      for(let i=0;i<p.count;i++)p.setZ(i,Math.abs(p.getX(i))*.18);
      card.rotateY(angle);card.computeVertexNormals();return card;
    });
    const geometry=mergeGeometries(parts)!;parts.forEach(part=>part.dispose());return geometry;
  }
  const positions: number[] = [], colors:number[]=[];
  const blades=28,segments=2;
  for (let blade = 0; blade < blades; blade++) {
    const angle = blade * 2.399, height = .45 + .55 * Math.sin(blade * 3.7) ** 2;
    const radius=.34*Math.sqrt((blade+.5)/blades), ox=Math.cos(angle)*radius,oz=Math.sin(angle)*radius;
    const point = (t: number, side: number) => {
      const bend = t * t * .3, width = (1 - t) * (blade%4===0?.01:.006) * side;
      return [ox+Math.cos(angle) * bend + Math.sin(angle) * width, t * height, oz+Math.sin(angle) * bend - Math.cos(angle) * width];
    };
    for (let segment=0;segment<segments;segment++) {
      const t=segment/segments,step=1/segments;
      const verts=[point(t,-1),point(t,1),point(t+step,-1),point(t,1),point(t+step,1),point(t+step,-1)];
      for(const v of verts){positions.push(...v);const tip=v[1]/height;colors.push(.13+tip*.16,.2+tip*.18,.07+tip*.08);}
    }
  }
  const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3)); geometry.computeVertexNormals(); return geometry;
}
function grassArtwork(){
  const canvas=document.createElement('canvas');canvas.width=canvas.height=256;const ctx=canvas.getContext('2d')!;
  for(let i=0;i<36;i++){
    const x=24+(i*.6180339%1)*208,tip=20+(i*.754877%1)*110,bend=Math.sin(i*2.399)*36,width=2.2+(i%4)*.7;
    const shade=190+(i*37%65);ctx.fillStyle='rgb('+shade+','+shade+','+shade+')';
    ctx.beginPath();ctx.moveTo(x-width,256);ctx.quadraticCurveTo(x-width,120,x+bend,tip);ctx.quadraticCurveTo(x+width,135,x+width,256);ctx.closePath();ctx.fill();
  }
  const art=new THREE.CanvasTexture(canvas);art.colorSpace=THREE.SRGBColorSpace;art.anisotropy=4;return art;
}
function guardrail() {
  const shape=new THREE.Shape();
  const points=[[-.2,0],[.4,.22],[-.15,.5],[.4,.78],[-.2,1],[-.3,.95],[.25,.78],[-.3,.5],[.25,.22],[-.3,.05]];
  points.forEach(([x,y],i)=>i?shape.lineTo(x,y):shape.moveTo(x,y));shape.closePath();
  return new THREE.ExtrudeGeometry(shape,{depth:1,bevelEnabled:false}).translate(0,0,-.5);
}
export class SceneryAssets {
  readonly box = new THREE.BoxGeometry(1, 1, 1).translate(0, .5, 0);
  readonly geometries: Record<SceneryKind, THREE.BufferGeometry>;
  readonly farTrees = Object.fromEntries(TREE_KINDS.map(kind => [kind, impostorGeometry(kind) as THREE.BufferGeometry])) as Record<TreeKind, THREE.BufferGeometry>;
  readonly middleTrees = Object.fromEntries(TREE_KINDS.map(kind => [kind, treeGeometry(kind, true)])) as Record<TreeKind, THREE.BufferGeometry>;
  readonly foliage = foliageTexture();
  private atlasResource:ReturnType<typeof loadTreeAtlas>;
  readonly atlas:THREE.Texture;
  readonly ready:Promise<void>;
  readonly impostors: THREE.MeshLambertMaterial;
  readonly materials: Record<SceneryKind, THREE.MeshStandardMaterial>;
  readonly middleMaterials: Record<TreeKind, THREE.MeshStandardMaterial|THREE.MeshLambertMaterial>;
  readonly middleGrass=grassTuft(true);
  readonly grassArt=grassArtwork();
  readonly middleGrassMaterial:THREE.MeshStandardMaterial;
  readonly plantDepth: THREE.MeshDepthMaterial;
  readonly shadowMaterial = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
  constructor(readonly state = new WorldUniforms(), textures?: SurfaceTextures, diffuseMiddle=true,maxTextureSize=2048) {
    this.shadowMaterial.onBeforeCompile=shader=>{shader.vertexShader=shader.vertexShader.replace('#include <project_vertex>','#include <project_vertex>\ngl_Position=vec4(2.0,2.0,2.0,1.0);');};
    this.shadowMaterial.customProgramCacheKey=()=> 'rimmile-shadow-only';
    this.atlasResource=loadTreeAtlas(maxTextureSize);this.atlas=this.atlasResource.texture;this.ready=this.atlasResource.ready;
    this.impostors = impostorMaterial(this.atlas, state);
    this.geometries = {
      ...Object.fromEntries(TREE_KINDS.map(kind => [kind, treeGeometry(kind)])) as Record<TreeKind, THREE.BufferGeometry>, rock: rock(), grass: grassTuft(),
      post: this.box, reflector: this.box, rail: guardrail(), concrete: this.box,
    };
    const colors: Record<SceneryKind, number> = { conifer: 0xffffff, pine: 0xffffff, broadleaf: 0xffffff, birch: 0xffffff, rock: 0x555a5b, grass: 0x3e5240, post: 0x9c9e92, reflector: 0xdbddbc, rail: 0x81898e, concrete: 0x777c80 };
    this.materials = Object.fromEntries(SCENERY_KINDS.map(kind => {
      const tree = TREE_KINDS.includes(kind as TreeKind);
      return [kind, new THREE.MeshStandardMaterial({ color: colors[kind], roughness: kind === 'reflector' ? .3 : .95, vertexColors: tree, map: tree ? this.foliage : null, alphaTest: tree ? .35 : 0, alphaToCoverage: tree, side: tree || kind === 'grass' ? THREE.DoubleSide : THREE.FrontSide })];
    })) as Record<SceneryKind, THREE.MeshStandardMaterial>;
    this.materials.rail.metalness=.72;this.materials.rail.roughness=.5;
    this.materials.grass.vertexColors=true;this.materials.grass.color.set(0xffffff);
    // At this projected size the rough foliage's specular/environment response
    // is subpixel. Keep the same volumetric geometry, normals, art and shadows;
    // a diffuse material avoids the full PBR BRDF on hundreds of middle crowns.
    // Three's Lambert environment path adds varyings. Restricted implementations
    // retain the proven PBR shader, rather than lose maps, shadows or 3D crowns.
    this.middleMaterials=Object.fromEntries(TREE_KINDS.map(kind=>[kind,plantFade(plantWind(diffuseMiddle?new THREE.MeshLambertMaterial({
      name:'Mid-field foliage',map:this.foliage,color:this.materials[kind].color,vertexColors:true,alphaTest:.35,alphaToCoverage:true,side:THREE.DoubleSide,
    }):this.materials[kind].clone(),state),state,1)])) as typeof this.middleMaterials;
    for(const kind of TREE_KINDS)vegetationMaterial(this.middleMaterials[kind],state);
    for (const kind of TREE_KINDS) vegetationMaterial(plantFade(plantWind(this.materials[kind],state),state,0),state);
    this.middleGrassMaterial=vegetationMaterial(plantFade(plantWind(new THREE.MeshStandardMaterial({color:new THREE.Color(.23,.32,.16),roughness:.95,map:this.grassArt,alphaTest:.12,alphaToCoverage:true,side:THREE.DoubleSide}),state),state,1,true),state,false);
    vegetationMaterial(plantFade(plantWind(this.materials.grass,state),state,0,true),state,false);
    surfaceMaterial(this.materials.rock, 'rock', state, textures);
    surfaceMaterial(this.materials.concrete, 'concrete', state);
    this.plantDepth = plantWind(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: this.foliage, alphaTest: .4, side: THREE.DoubleSide }), state);
  }
  dispose() { this.atlasResource.cancel(); this.grassArt.dispose(); this.middleGrass.dispose(); this.middleGrassMaterial.dispose(); this.shadowMaterial.dispose(); this.plantDepth.dispose(); this.impostors.dispose(); this.foliage.dispose(); this.atlas.dispose(); new Set([...Object.values(this.geometries), ...Object.values(this.farTrees), ...Object.values(this.middleTrees)]).forEach(geometry => geometry.dispose()); [...Object.values(this.materials),...Object.values(this.middleMaterials)].forEach(material => material.dispose()); }
}
export class ScenerySlot {
  readonly group = new THREE.Group();
  private batches: Record<SceneryKind, THREE.InstancedMesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>>;
  private farTrees: Record<TreeKind, THREE.InstancedMesh>;
  private middleTrees: Record<TreeKind, THREE.InstancedMesh>;
  private middleGrass:THREE.InstancedMesh;
  private matrices=Object.fromEntries(PLANT_KINDS.map(kind=>[kind,new Float32Array(INSTANCE_CAPACITY[kind]*16)])) as Record<PlantKind,Float32Array>;
  private clusters={} as Record<PlantKind,PlantCluster[]>;
  private transform = new THREE.Object3D();
  private shadows: Record<TreeKind | 'rock', THREE.InstancedMesh>;
  private data?: SceneryData;
  private shadowX = Infinity; private shadowZ = Infinity;
  invalidate(){this.previousCullRevision=undefined;this.previousLodScale=0;}
  private previousCullRevision?:number;
  private visibilityX=Infinity;private visibilityZ=Infinity;private previousLodScale=0;
  private shadowHeading=Infinity;
  private shadowLights?:boolean;
  private culled=0;
  private plantBounds=new THREE.Sphere();
  private copyMatrix(mesh:THREE.InstancedMesh,kind:PlantKind,index:number){
    let ids=this.packedIds.get(mesh);if(!ids){ids=new Int32Array(mesh.instanceMatrix.count).fill(-1);this.packedIds.set(mesh,ids);}
    const at=mesh.count++,revision=this.appliedRevision.get(mesh);
    if(ids[at]===index&&revision===this.uploadRevision)return;
    ids[at]=index;this.packedChanged.set(mesh,true);
    const source=this.matrices[kind],target=mesh.instanceMatrix.array,from=index*16,to=at*16;
    for(let component=0;component<16;component++)target[to+component]=source[from+component];
  }
  constructor(private assets: SceneryAssets) {
    const make = (kind: SceneryKind, geometry: THREE.BufferGeometry, material:THREE.Material = assets.materials[kind]) => {
      const mesh = new THREE.InstancedMesh(geometry, material, INSTANCE_CAPACITY[kind]);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); mesh.count = 0; mesh.receiveShadow = true;
      if (TREE_KINDS.includes(kind as TreeKind)) mesh.customDepthMaterial = assets.plantDepth;
      this.group.add(mesh); return mesh;
    };
    this.batches = Object.fromEntries(SCENERY_KINDS.map(kind => [kind, make(kind, assets.geometries[kind])])) as typeof this.batches;
    this.middleGrass=make('grass',assets.middleGrass,assets.middleGrassMaterial);
    this.farTrees = Object.fromEntries(TREE_KINDS.map(kind => [kind, make(kind, assets.farTrees[kind], assets.impostors) as THREE.InstancedMesh])) as typeof this.farTrees;
    for(const mesh of Object.values(this.farTrees))mesh.receiveShadow=false;
    this.middleTrees = Object.fromEntries(TREE_KINDS.map(kind => [kind, make(kind, assets.middleTrees[kind],assets.middleMaterials[kind]) as THREE.InstancedMesh])) as typeof this.middleTrees;
    const shadow = (kind: TreeKind | 'rock') => {
      const geometry = kind === 'rock' ? assets.geometries.rock : assets.middleTrees[kind];
      const object = new THREE.InstancedMesh(geometry, assets.shadowMaterial, INSTANCE_CAPACITY[kind]);
      object.castShadow = true; object.count = 0; object.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      if (kind !== 'rock') object.customDepthMaterial = assets.plantDepth;
      this.group.add(object); return object;
    };
    this.shadows = Object.fromEntries([...TREE_KINDS, 'rock' as const].map(kind => [kind, shadow(kind) as THREE.InstancedMesh])) as typeof this.shadows;
  }
  upload(data: SceneryData) {
    this.uploadRevision++;
    this.data = data; this.shadowX = Infinity; this.shadowZ = Infinity;this.visibilityX=Infinity;this.previousCullRevision=undefined;
    for (const kind of SCENERY_KINDS) {
      const values = data.instances[kind], mesh = this.batches[kind]; mesh.count = values.length / 7;
      for (let i = 0; i < values.length; i += 7) {
        this.transform.position.set(values[i], values[i + 1], values[i + 2]);
        this.transform.scale.set(values[i + 3], values[i + 4], values[i + 5]); this.transform.rotation.set(kind==='rail'?data.railPitch[i/7]:0, values[i + 6], 0, 'YXZ'); this.transform.updateMatrix();
        mesh.setMatrixAt(i / 7, this.transform.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true; mesh.computeBoundingSphere();
      if(PLANT_KINDS.includes(kind as PlantKind)){
        this.matrices[kind as PlantKind].set(mesh.instanceMatrix.array);this.clusters[kind as PlantKind]=plantClusters(values);
        const alternatives=TREE_KINDS.includes(kind as TreeKind)?[this.middleTrees[kind as TreeKind],this.farTrees[kind as TreeKind]]:kind==='grass'?[this.middleGrass]:[];
        for(const alternative of alternatives){alternative.boundingSphere??=new THREE.Sphere();alternative.boundingSphere.copy(mesh.boundingSphere!);}
      }
    }
  }
  private packedIds=new WeakMap<THREE.InstancedMesh,Int32Array>();
  private packedChanged=new WeakMap<THREE.InstancedMesh,boolean>();
  private appliedRevision=new WeakMap<THREE.InstancedMesh,number>();
  private uploadedCounts=new WeakMap<THREE.InstancedMesh,number>();
  private uploadRevision=0;
  private markPacked(mesh:THREE.InstancedMesh){
    if(this.packedChanged.get(mesh)||this.uploadedCounts.get(mesh)!==mesh.count){
      mesh.instanceMatrix.clearUpdateRanges();if(mesh.count)mesh.instanceMatrix.addUpdateRange(0,mesh.count*16);
      mesh.instanceMatrix.needsUpdate=mesh.count>0;
    }
    this.uploadedCounts.set(mesh,mesh.count);this.appliedRevision.set(mesh,this.uploadRevision);
  }
  update(distance:number,carX:number,localCarZ:number,frustum?:THREE.Frustum,cullRevision?:number,heading=0){
    if(!this.data)return;
    for(const kind of SCENERY_KINDS){const mesh=this.batches[kind];mesh.visible=mesh.count>0;mesh.castShadow=distance<250&&(kind==='rail'||kind==='concrete');}
    const scale=this.assets.state.lodScale.value*this.assets.state.treeDetail.value;const grassBudget=this.assets.state.grassDetail.value;
    const moved=Math.hypot(carX-this.visibilityX,localCarZ-this.visibilityZ)>4;
    if(this.previousCullRevision!==cullRevision||moved||Math.abs(scale-this.previousLodScale)>.03){
      this.visibilityX=carX;this.visibilityZ=localCarZ;this.previousCullRevision=cullRevision;this.previousLodScale=scale;this.culled=0;
      const base=this.group.parent!.position;
      const clusterVisibility=(cluster:PlantCluster)=>{
        if(!frustum)return 2;
        const guard=8+Math.hypot(cluster.x-carX,cluster.z-localCarZ)*.04;
        this.plantBounds.center.set(base.x+cluster.x,cluster.y,base.z+cluster.z);this.plantBounds.radius=cluster.radius+guard;
        let inside=true;for(const plane of frustum.planes){const d=plane.distanceToPoint(this.plantBounds.center);if(d< -this.plantBounds.radius)return 0;if(d<this.plantBounds.radius)inside=false;}return inside?2:1;
      };
      const plantVisible=(values:Float32Array,i:number)=>{
        if(!frustum)return true;
        const height=values[i+4],d=Math.hypot(values[i]-carX,values[i+2]-localCarZ);
        this.plantBounds.center.set(base.x+values[i],values[i+1]+height*.5,base.z+values[i+2]);
        this.plantBounds.radius=Math.hypot(values[i+3]*.75,height*.5,values[i+5]*.75)+8+d*.04;
        return frustum.intersectsSphere(this.plantBounds);
      };
      for(const kind of PLANT_KINDS){
        const values=this.data.instances[kind],near=this.batches[kind];
        const tree=TREE_KINDS.includes(kind as TreeKind),middle=tree?this.middleTrees[kind as TreeKind]:kind==='grass'?this.middleGrass:undefined,far=tree?this.farTrees[kind as TreeKind]:undefined;
        for(const mesh of [near,middle,far])if(mesh){mesh.count=0;this.packedChanged.set(mesh,false);}
        // Front clusters write depth first, reducing hidden leaf/atlas overdraw.
        this.clusters[kind].sort((a,b)=>((a.x-carX)**2+(a.z-localCarZ)**2)-((b.x-carX)**2+(b.z-localCarZ)**2));
        for(const cluster of this.clusters[kind]){
          const visibility=clusterVisibility(cluster);
          if(!visibility){if(tree)this.culled+=cluster.indices.length;continue;}
          if(kind==='grass'&&Math.hypot(cluster.x-carX,cluster.z-localCarZ)-cluster.radius>(180*grassBudget+60))continue;
          const farOnly=tree&&Math.hypot(cluster.x-carX,cluster.z-localCarZ)-cluster.radius>420*this.assets.state.treeDetail.value+60;
          for(const index of cluster.indices){
            const i=index*7;
            if(visibility===1&&!plantVisible(values,i)){if(tree)this.culled++;continue;}
            if(farOnly){this.copyMatrix(far!,kind,index);continue;}
            const d=Math.hypot(values[i]-carX,values[i+2]-localCarZ);
            if(kind==='grass'&&d>(180*grassBudget+60))continue;
            if(tree){
              const hero=treeHeroDistance(values[i+4],this.assets.state.lodScale.value,this.assets.state.treeDetail.value),reach=treeMiddleDistance(values[i+4],this.assets.state.lodScale.value,this.assets.state.treeDetail.value);
              if(d<hero+35)this.copyMatrix(near,kind,index);
              if(d>hero-15&&d<reach+60)this.copyMatrix(middle!,kind,index);
              if(d>reach-15)this.copyMatrix(far!,kind,index);
            }else if(kind==='grass'){
              if(d<50*grassBudget+35)this.copyMatrix(near,kind,index);
              if(d>50*grassBudget-15)this.copyMatrix(middle!,kind,index);
            }else this.copyMatrix(near,kind,index);
          }
        }
        near.visible=near.count>0;this.markPacked(near);
        if(middle){middle.visible=middle.count>0;this.markPacked(middle);}
        if(far){far.visible=far.count>0;this.markPacked(far);}
      }
    }
    // A plant outside the camera may still shade the visible road. Do not reuse
    // camera culling for these batches, or repack them on every camera turn.
    if(this.shadowLights!==this.assets.state.headlights||Math.hypot(carX-this.shadowX,localCarZ-this.shadowZ)>5||Math.abs(heading-this.shadowHeading)>.04){
      this.shadowLights=this.assets.state.headlights;this.shadowX=carX;this.shadowZ=localCarZ;this.shadowHeading=heading;
      const s=Math.sin(heading),c=Math.cos(heading);
      for(const kind of [...TREE_KINDS,'rock'] as const){
        const object=this.shadows[kind],values=this.data.instances[kind];object.count=0;this.packedChanged.set(object,false);
        for(const cluster of this.clusters[kind]){
          if(Math.hypot(cluster.x-carX,cluster.z-localCarZ)-cluster.radius>140)continue;
          for(const index of cluster.indices){
            const i=index*7,dx=values[i]-carX,dz=values[i+2]-localCarZ,d=Math.hypot(dx,dz);if(d>140)continue;
            const radius=values[i+3]*.75+4,along=dx*s+dz*c,across=dx*c-dz*s;
            if(d>55+radius&&(!this.assets.state.headlights||along< -radius||along>130+radius||Math.abs(across)>Math.max(0,along)*.62+radius))continue;
            this.copyMatrix(object,kind,index);
          }
        }
        object.visible=object.count>0;this.markPacked(object);object.computeBoundingSphere();
      }
    }
  }
  get statistics() {
    const count=(meshes: Record<TreeKind,THREE.InstancedMesh>)=>TREE_KINDS.reduce((sum,kind)=>sum+meshes[kind].count,0);
    const species=Object.fromEntries(TREE_KINDS.map(kind=>[kind,(this.data?.instances[kind].length ?? 0)/7])) as Record<TreeKind,number>;
    const trees=Object.values(species).reduce((sum,value)=>sum+value,0),near=TREE_KINDS.reduce((sum,kind)=>sum+this.batches[kind].count,0),middle=count(this.middleTrees),images=count(this.farTrees);
    const shadowTrees=TREE_KINDS.reduce((sum,kind)=>sum+this.shadows[kind].count,0),grass=this.batches.grass.count+this.middleGrass.count;
    return {species,trees,near,middle,images,grass,shadowTrees,culled:this.culled,overlap:near+middle+images+this.culled-trees};
  }
  dispose() { this.middleGrass.dispose(); Object.values(this.batches).forEach(mesh => mesh.dispose()); Object.values(this.middleTrees).forEach(mesh => mesh.dispose()); Object.values(this.farTrees).forEach(mesh => mesh.dispose()); Object.values(this.shadows).forEach(mesh => mesh.dispose()); }
}
