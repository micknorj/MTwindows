import {assetUrl} from '../assets';
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { TREE_KINDS, type TreeKind } from './tree-config';
import { plantWind, vegetationMaterial, type WorldUniforms } from '../rendering/world-materials';
import { TREE_CARD_PROFILE } from './tree-card-profile';

export function loadTreeAtlas(maxTextureSize=2048) {
  const texture=new THREE.Texture(),request=new AbortController();
  let bitmap:ImageBitmap|undefined,cancelled=false,timedOut=false;
  let rejectPending!:(error:Error)=>void;
  const interrupted=new Promise<void>((_,reject)=>{rejectPending=reject;});
  const timeout=setTimeout(()=>{timedOut=true;request.abort();rejectPending(new Error('The forest artwork took too long to load. Please retry.'));},20000);
  // The atlas contains sRGB crown color and linear normal data in one sampler.
  // Decode only color in the shader. Direct bitmap upload preserves transparent
  // RGB padding and avoids a privacy-sensitive Canvas resize on small limits.
  texture.flipY=false;texture.colorSpace=THREE.NoColorSpace;texture.anisotropy=4;
  const ready=Promise.race([(async()=>{
    try{
      const response=await fetch(assetUrl('textures/tree-impostors.webp'),{signal:request.signal});
      if(!response.ok)throw new Error('Forest request failed');
      const scale=Math.min(1,maxTextureSize/2048),size=Math.floor(2048*scale);
      const decoded=await createImageBitmap(await response.blob(),{imageOrientation:'flipY',premultiplyAlpha:'none',colorSpaceConversion:'none',resizeWidth:size,resizeHeight:size,resizeQuality:'high'});
      if(cancelled||timedOut){decoded.close();throw new Error('Forest loading was interrupted.');}
      bitmap=decoded;texture.image=bitmap;texture.needsUpdate=true;
    }catch{
      throw new Error(cancelled?'Forest loading was interrupted.':timedOut?'The forest artwork took too long to load. Please retry.':'The forest artwork could not be loaded. Please retry.');
    }finally{clearTimeout(timeout);}
  })(),interrupted]);
  // Attach the rejection handler immediately; initialize awaits the original promise.
  void ready.catch(()=>{});
  return {texture,ready,cancel:()=>{cancelled=true;clearTimeout(timeout);request.abort();rejectPending(new Error('Forest loading was interrupted.'));bitmap?.close();bitmap=undefined;}};
}

// Original leaf/needle art, deterministic and shared by all nearby trees. The corner
// swatch keeps trunk/branch UVs opaque so one material can batch the entire tree.
export function foliageTexture() {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1024;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff'; ctx.fillRect(1008, 0, 16, 16);
  let seed = 1729;
  const random = () => { seed = Math.imul(seed, 1664525) + 1013904223 | 0; return (seed >>> 0) / 4294967296; };
  ctx.scale(2,1.55);
  // Needle sprays, with fine gaps between twigs rather than opaque foliage balls.
  for (let b = 0; b < 25; b++) {
    const x = 85 + random() * 85, y = 120 + random() * 285, angle = random() * 6.28;
    ctx.save(); ctx.translate(x, y); ctx.rotate(angle);
    ctx.strokeStyle = '#8a9b80'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, 20); ctx.lineTo(0, -75); ctx.stroke();
    for (let n = 0; n < 22; n++) for (const side of [-1, 1]) {
      const length = (10 + random() * 20) * Math.sin((n + 1) / 24 * Math.PI);
      const bright = 130 + (random() * 100 | 0);
      ctx.strokeStyle = `rgb(${bright},${Math.min(255,bright+15)},${bright})`; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(0, 15 - n * 4); ctx.lineTo(side * length, 4 - n * 4); ctx.stroke();
    }
    ctx.restore();
  }
  for (let l = 0; l < 225; l++) {
    const x = 265 + random() * 235, y = 36 + random() * 463;
    const radius = Math.hypot((x-383)/115,(y-265)/222);
    const fade = Math.max(0,Math.min(1,(1-radius)*5));
    if (random() > fade) continue;
    ctx.save(); ctx.translate(x, y); ctx.rotate(random() * 6.28);
    const bright = 140 + (random() * 110 | 0);
    const gradient=ctx.createLinearGradient(-7,-12,7,12);
    gradient.addColorStop(0,`rgb(${bright},${bright},${bright-8})`);gradient.addColorStop(1,'#687063');
    ctx.fillStyle = gradient; ctx.beginPath(); ctx.ellipse(0, 0, 5 + random() * 5, 9 + random() * 7, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#bcc3a7'; ctx.lineWidth = .6; ctx.beginPath(); ctx.moveTo(0, -10); ctx.lineTo(0, 11);
    for(let v=-6;v<8;v+=4){ctx.moveTo(0,v);ctx.lineTo(-5,v-3);ctx.moveTo(0,v);ctx.lineTo(5,v-3);}
    ctx.stroke(); ctx.restore();
  }
  ctx.resetTransform();
  // An opaque bark strip gives trunks longitudinal fissures, lenticels and
  // broken highlights; it shares the canopy sampler and material batch.
  ctx.fillStyle='#a3a095';ctx.fillRect(0,850,1024,174);
  ctx.fillStyle='#e4e3d8';ctx.fillRect(512,850,512,174);
  for(let i=0;i<2300;i++){
    const x=random()*512,y=850+random()*174;
    ctx.fillStyle=`rgba(35,30,23,${.1+random()*.45})`;
    ctx.fillRect(x,y,1+random()*3,8+random()*55);
    if(i%3===0)ctx.fillRect(512+random()*512,y,4+random()*22,1+random()*2);
  }
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4; return texture;
}

function colorize(geometry: THREE.BufferGeometry, color: THREE.Color, bark = false) {
  const positions = geometry.getAttribute('position'), colors = new Float32Array(positions.count * 3);
  for (let i = 0; i < positions.count; i++) color.toArray(colors, i * 3);
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  if (bark) {
    const birch=color.r>.4;
    const uv = geometry.getAttribute('uv'); for (let i = 0; i < uv.count; i++) uv.setXY(i, (birch?.51:.01)+uv.getX(i)*.48, .005+uv.getY(i)*.16);
  }
  return geometry;
}
export function treeGeometry(kind: TreeKind, middle = false) {
  const birch = kind === 'birch', broad = birch || kind === 'broadleaf', pine = kind === 'pine';
  const bark = new THREE.Color(birch ? 0xb8b6a1 : 0x6a6251), green = new THREE.Color(broad ? (birch ? 0x809465 : 0x69865c) : 0x647e60);
  const parts: THREE.BufferGeometry[] = [];
  const cylinder = (a: THREE.Vector3, b: THREE.Vector3, bottom: number, top: number) => {
    const direction = b.clone().sub(a), centre = a.clone().add(b).multiplyScalar(.5);
    const trunk=bottom>.02;
    const geometry = new THREE.CylinderGeometry(top, bottom, direction.length(), middle ? 5 : trunk?10:6, !middle&&trunk?4:1);
    const vertices=geometry.getAttribute('position');
    for(let i=0;i<vertices.count;i++) {
      const y=vertices.getY(i), x=vertices.getX(i),z=vertices.getZ(i);
      const rib=1+.045*Math.sin(Math.atan2(z,x)*7+y*21);
      vertices.setXYZ(i,x*rib,y,z*rib);
    }
    geometry.computeVertexNormals();
    geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),direction.normalize())).translate(centre.x,centre.y,centre.z);
    parts.push(colorize(geometry,bark,true));
  };
  cylinder(new THREE.Vector3(),new THREE.Vector3(.018,1,0),birch ? .023 : .035,.006);
  const rings = broad ? 4 : pine ? 5 : 10, branches = broad ? 5 : 6;
  for(let level = 0; level < rings; level++) for(let branch = 0; branch < branches; branch++) {
    const angle = branch * Math.PI * 2 / branches + level * 2.399;
    const y = broad ? (birch ? .38 + level * .13 : .46 + level * .1) : pine ? .46 + level * .095 : .16 + level * .079;
    const reach = (broad ? (birch ? .25 : .42) * Math.sin((level+1)/(rings+1)*Math.PI) : pine ? .34 * (1 - level*.12) : (1-y)*.53) * (.83 + .17*Math.sin(angle*3+level));
    const root = new THREE.Vector3(.01,y,0), end = new THREE.Vector3(Math.cos(angle)*reach,y+(broad?.13:pine?.06:-.025),Math.sin(angle)*reach);
    // Tiny mid-distance twigs project below a pixel. Retain the trunk/main forks;
    // leaf-card positions still follow the complete original branch layout.
    if (!middle || level < (broad ? 1 : 2)) cylinder(root,end,.012*(1-y),.002);
    const cards = middle ? (broad ? 3 : 2) : (broad ? 12 : 9);
    for(let c = 0; c < cards; c++) {
      const t = .28 + .7 * ((c * .6180339) % 1), twist = angle + c*2.399;
      const centre = root.clone().lerp(end,t); centre.x += Math.sin(c*4.1)*reach*.22; centre.z += Math.cos(c*2.7)*reach*.22;
      centre.y += (broad ? .075 : .03) * Math.sin(c*3.3);
      const width = (broad ? .23 : reach*.72)*(middle?1.15:1), height = (broad ? (birch ? .2 : .22) : .13)*(middle?1.1:1);
      const card = new THREE.PlaneGeometry(width,height,2,1);
      const cp=card.getAttribute('position');for(let i=0;i<cp.count;i++) cp.setZ(i,-Math.abs(cp.getX(i)/width)*height*.3);
      card.rotateX(broad ? Math.sin(c*2.7)*.65 : -.3 + (c%3)*.3).rotateY(twist).translate(centre.x,centre.y,centre.z);
      const normal = centre.clone().sub(new THREE.Vector3(0,broad?.4:.2,0)).normalize();
      const normals=card.getAttribute('normal'); for(let i=0;i<normals.count;i++) normals.setXYZ(i,normal.x,Math.max(.3,normal.y),normal.z);
      const uv = card.getAttribute('uv');
      for(let i = 0; i < uv.count; i++) uv.setXY(i, (broad ? .52 : .045) + uv.getX(i)*(broad ? .455 : .4), .22+uv.getY(i)*.75);
      const tint = green.clone().multiplyScalar(.78+.3*((c* .754877)%1) + level/rings*.15);
      parts.push(colorize(card,tint));
      if(!middle) {
        // Individual folded leaves/needle fans occupy real volume close to the
        // road. Textured branch sprays fill the crown between these small forms.
        for(let leaf=0;leaf<(broad?4:3);leaf++) {
          const size=broad?.004:.006, length=broad?.012:.018;
          const shape=new THREE.BufferGeometry();
          const vertices=[-size,0,0, 0,length,.006, 0,0,-.004, 0,0,-.004, 0,length,.006, size,0,0];
          // Needles retain a folded V section; broad leaves retain their lower
          // diamond. Avoid allocating discarded subpixel faces for every fan.
          if(broad)vertices.push(-size,0,0,0,0,-.004,0,-length*.3,0,0,-length*.3,0,0,0,-.004,size,0,0);
          shape.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));
          shape.setAttribute('uv',new THREE.Float32BufferAttribute(new Array(broad?12:6).fill([.992,.992]).flat(),2));
          shape.computeVertexNormals();shape.rotateX(leaf*1.7+c).rotateY(twist+leaf*2.399);
          shape.translate(centre.x+Math.sin(leaf*4+c)*width*.24,centre.y+Math.cos(leaf*3+c)*height*.22,centre.z+Math.cos(leaf*2+c)*width*.24);
          // Match indexed branch geometry before merging.
          shape.setIndex(Array.from({length:broad?12:6},(_,i)=>i));parts.push(colorize(shape,tint.clone().multiplyScalar(.95+leaf*.06)));
        }
      }
    }
  }
  const geometry = mergeGeometries(parts)!; parts.forEach(part=>part.dispose());
  geometry.computeBoundingBox(); geometry.scale(1,1/geometry.boundingBox!.max.y,1); geometry.computeBoundingSphere(); return geometry;
}

// Offline atlas: four azimuths of the very same original 3D trees. Far instances
// use one silhouette envelope and choose their view in the vertex shader, preserving yaw.
export function impostorGeometry(kind: TreeKind) {
  // Conservative silhouette envelopes remove only empty atlas corners. All views
  // share the union bound, so azimuth blending cannot cut branches off.
  const {width,halfWidths:profile}=TREE_CARD_PROFILE[kind],positions:number[]=[],uv:number[]=[],indices:number[]=[],row=TREE_KINDS.indexOf(kind);
  for(let band=0;band<profile.length;band++)for(const side of [-1,1]){
    const y=band/(profile.length-1),x=profile[band]*side;positions.push(x*width,y,0);uv.push(.001+(x+.5)*.123,(3-row)*.25+.001+y*.248);
    if(band<profile.length-1&&side===-1){const i=band*2;indices.push(i,i+1,i+2,i+1,i+3,i+2);}
  }
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));geometry.setIndex(indices);geometry.computeVertexNormals();
  geometry.computeBoundingSphere(); return geometry;
}
export function impostorMaterial(texture: THREE.Texture, state: WorldUniforms) {
  const material = new THREE.MeshLambertMaterial({ map:texture, alphaTest:.35, alphaToCoverage:true, side:THREE.DoubleSide });
  material.onBeforeCompile = shader => {
    shader.fragmentShader='uniform float rtDistantDetail;\n'+shader.fragmentShader;
    shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',`
      vec2 rtAtlasSize=vec2(textureSize(map,0)),rtAtlasDx=dFdx(vMapUv),rtAtlasDy=dFdy(vMapUv);
      float rtFootprint=max(length(rtAtlasDx*rtAtlasSize),length(rtAtlasDy*rtAtlasSize));
      float rtCrownCutoff=mix(.35,.18,smoothstep(2.0,24.0,rtFootprint));
      float rtLimit=min(1.0,32.0/max(1.0,rtFootprint));rtAtlasDx*=rtLimit;rtAtlasDy*=rtLimit;
      vec2 rtTile=vec2(.125,.25),rtTileStart=floor(vMapUv/rtTile)*rtTile;
      vec2 rtPadding=max(vec2(2.0),vec2(min(32.0,rtFootprint)*.6))/rtAtlasSize;
      vec2 rtCrownUv=clamp(vMapUv,rtTileStart+rtPadding,rtTileStart+rtTile-rtPadding);
      #ifdef USE_MAP
      vec4 rtCrownA=textureGrad(map,rtCrownUv,rtAtlasDx,rtAtlasDy),rtCrownB=rtCrownA;
      if(rtAtlasBlend>.001)rtCrownB=textureGrad(map,rtCrownUv+vec2(rtAtlasOffset,0.0),rtAtlasDx,rtAtlasDy);
      diffuseColor.a*=mix(rtCrownA.a,rtCrownB.a,rtAtlasBlend);
    #endif`);
    shader.fragmentShader=shader.fragmentShader.replace('#include <normal_fragment_maps>',`#include <normal_fragment_maps>
      // Empty cutout pixels have already been discarded. Explicit gradients
      // retain correct mip selection after nonuniform alpha rejection.
      diffuseColor.rgb*=mix(sRGBTransferEOTF(rtCrownA).rgb,sRGBTransferEOTF(rtCrownB).rgb,rtAtlasBlend);
      vec3 rtCrownNormal=vec3(0.0,.45,.89);if(rtDistantDetail>.5)rtCrownNormal=textureGrad(map,rtCrownUv+vec2(.5,0.0),rtAtlasDx,rtAtlasDy).rgb*2.0-1.0;
      if(rtDistantDetail>1.5&&rtAtlasBlend>.001)rtCrownNormal=mix(rtCrownNormal,textureGrad(map,rtCrownUv+vec2(.5+rtAtlasOffset,0.0),rtAtlasDx,rtAtlasDy).rgb*2.0-1.0,rtAtlasBlend);
      vec3 rtFront=(vec4(vNormal,0.0)*viewMatrix).xyz;rtFront=normalize(vec3(rtFront.x,0.0,rtFront.z));
      vec3 rtRight=vec3(rtFront.z,0.0,-rtFront.x);
      normal=normalize(mat3(viewMatrix)*(rtRight*rtCrownNormal.x+vec3(0.0,rtCrownNormal.y,0.0)+rtFront*rtCrownNormal.z));
    `);
    // Footprint/cutoff declarations are inserted directly with the map code,
    // never by matching the whitespace of our own generated shader snippet.
    shader.vertexShader=shader.vertexShader.replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
      #ifdef USE_INSTANCING
        vec3 rtCentre=(modelMatrix*instanceMatrix*vec4(0.0,0.0,0.0,1.0)).xyz;
        float rtAngle=atan(cameraPosition.x-rtCentre.x,cameraPosition.z-rtCentre.z)-atan(instanceMatrix[2].x,instanceMatrix[2].z);
        objectNormal=vec3(sin(rtAngle),0.0,cos(rtAngle));
      #endif
    `);
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      #ifdef USE_INSTANCING
        vec3 centre=(modelMatrix*instanceMatrix*vec4(0.0,0.0,0.0,1.0)).xyz;
        vec2 facing=normalize(cameraPosition.xz-centre.xz+vec2(.0001));
        float yaw=atan(instanceMatrix[2].x,instanceMatrix[2].z);
        float angle=mod(atan(facing.x,facing.y)-yaw+6.2831853,6.2831853);
        float rtView=angle/1.5707963,rtFrame=floor(rtView);
        vMapUv.x+=rtFrame*.125;
        rtAtlasOffset=rtFrame<3.0?.125:-.375;
        rtAtlasBlend=smoothstep(.15,.85,fract(rtView));
        // Undo instance yaw; instanceMatrix restores the camera-facing plane.
        float localAngle=atan(facing.x,facing.y)-yaw;
        transformed.xz=vec2(position.x*cos(localAngle),-position.x*sin(localAngle));
      #endif
    `);
  };
  material.name='Distant forest';
  material.customProgramCacheKey = () => 'rimmile-tree-impostor-normal-8';
  const faded=plantFade(plantWind(material,state),state,2),compile=faded.onBeforeCompile;
  faded.onBeforeCompile=(shader,renderer)=>{
    compile.call(faded,shader,renderer);
    // Far coverage starts beyond 185m from the camera on every preset. Both
    // finite headlights stop at125m, so their cookie/BRDF work has zero effect
    // here. Keep moon/sky illumination and all near/mid headlight interactions.
    shader.fragmentShader=shader.fragmentShader.replace('#include <lights_fragment_begin>',THREE.ShaderChunk.lights_fragment_begin.replace('#if ( NUM_SPOT_LIGHTS > 0 ) && defined( RE_Direct )','#if 0 // rimmile distant headlight exclusion'));
    shader.fragmentShader=shader.fragmentShader.replace('#include <alphatest_fragment>',THREE.ShaderChunk.alphatest_fragment.replaceAll('alphaTest','rtCrownCutoff'));
  };
  return vegetationMaterial(faded,state,false);
}

/** Complementary screen-door coverage hides representation changes without
 * transparent sorting or multiplying tree populations outside narrow LOD bands. */
export function plantFade<T extends THREE.MeshStandardMaterial|THREE.MeshLambertMaterial>(material:T, state: WorldUniforms, tier: 0|1|2, grass=false) {
  const previous=material.onBeforeCompile, key=material.customProgramCacheKey();
  material.onBeforeCompile=(shader,renderer)=>{
    previous.call(material,shader,renderer);
    shader.uniforms.rtTreeDetail=grass?state.grassDetail:state.treeDetail;shader.uniforms.rtDistantDetail=state.distantDetail;
    shader.uniforms.rtLodScale=state.lodScale;
    // Separate scalars fit unused components of Three's varyings on LibreWolf.
    // A new vec4 exceeds its eight-vector packing budget. The middle tier encodes
    // its two non-overlapping transitions in one signed scalar.
    const atlas=tier===2?'varying float rtAtlasOffset; varying float rtAtlasBlend;':'';
    shader.vertexShader=`varying float rtPlantFade; ${atlas} uniform float rtLodScale; uniform float rtTreeDetail;\n${shader.vertexShader}`;
    shader.vertexShader=shader.vertexShader.replace('#include <project_vertex>',`
      #ifdef USE_INSTANCING
        vec3 rtBase=(modelMatrix*instanceMatrix*vec4(0.0,0.0,0.0,1.0)).xyz;
        float rtTreeDistance=length(cameraPosition.xz-rtBase.xz),rtTreeHeight=length(instanceMatrix[1].xyz);
        float rtBudget=rtTreeDetail;float rtHero=rtBudget*${grass?'50.0':'clamp(rtTreeHeight*3.4*rtLodScale,35.0,70.0)'};
        float rtReach=rtBudget*${grass?'180.0':'max(240.0,min(420.0,rtTreeHeight*18.0*rtLodScale))'};
        float rtNearFade=smoothstep(rtHero,rtHero+25.0,rtTreeDistance),rtFarFade=smoothstep(rtReach,rtReach+45.0,rtTreeDistance);
        rtPlantFade=${tier===0?'rtNearFade':tier===1?'rtFarFade>0.0?-rtFarFade:rtNearFade':'rtFarFade'};
      #endif
      #include <project_vertex>
      // Preparation/culling margins retain both representations around a band.
      // Fully faded instances need no rasterization or repeated fragment work.
      if(${tier===0?'rtPlantFade>=1.0':tier===1?'rtPlantFade==0.0||rtPlantFade<=-1.0':'rtPlantFade<=0.0'})gl_Position=vec4(2.0,2.0,2.0,1.0);
    `);
    shader.fragmentShader=`varying float rtPlantFade; ${atlas}\n${shader.fragmentShader}`;
    shader.fragmentShader=shader.fragmentShader.replace('#include <alphatest_fragment>',`#include <alphatest_fragment>
      ${tier===0?'if(rtPlantFade>0.0)':'if(rtPlantFade<1.0)'}{
        // Ordered coverage is stable and avoids random single-pixel grain.
        ivec2 rtCell=ivec2(gl_FragCoord.xy)&3;
        const float rtBayer[16]=float[16](0.,8.,2.,10.,12.,4.,14.,6.,3.,11.,1.,9.,15.,7.,13.,5.);
        float rtPixel=(rtBayer[rtCell.y*4+rtCell.x]+.5)/16.;
        ${tier===0?'if(rtPixel<rtPlantFade) discard;':tier===1?'if(rtPlantFade<0.0?rtPixel< -rtPlantFade:rtPixel>=rtPlantFade) discard;':'if(rtPixel>=rtPlantFade) discard;'}
      }
    `);
  };
  material.customProgramCacheKey=()=>`${key}-fade-${grass?'grass':'tree'}-${tier}-vertex-3`;return material;
}
