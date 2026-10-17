import * as THREE from 'three';
import {ROCK_SLOPE} from '../world/habitat';
import type { SurfaceTextures } from './surface-textures';
import { FINITE_LIGHTS_FRAGMENT } from './finite-lights';
import { HEADLIGHT_PROFILE_GLSL } from '../vehicle/headlights';

export class WorldUniforms {
  headlights=true;
  treeDetail={value:1};grassDetail={value:1};distantDetail={value:1};
  tunnelPhase={value:0};
  tunnelStations={value:Array.from({length:17},()=>new THREE.Vector4())};
  tunnel={value:new THREE.Vector4(0,1,-1,0)};
  time = { value: 0 }; origin = { value: new THREE.Vector2() }; valley = { value: 0 }; wind = { value: 1 };lodScale={value:1};
  update(dt: number, x: number, z: number, y: number) { this.time.value = (this.time.value + dt) % 65536; this.origin.value.set(((x % 16384) + 16384) % 16384, ((z % 16384) + 16384) % 16384); this.valley.value = y; }
}
const noise = `
float rtHash(vec2 p) { p = mod(p, 256.0); return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
float rtNoise(vec2 p) { vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(rtHash(i),rtHash(i+vec2(1,0)),f.x),mix(rtHash(i+vec2(0,1)),rtHash(i+1.0),f.x),f.y); }
`;
// World-anchored mineral variation, mild runoff and aggregate. No extra texture,
// sampler, varying or dynamic light; identical weathering on decks and supports.
const concrete = `
vec3 rtConcrete(vec3 position,vec3 normal){
  vec2 p=position.xz+rtOrigin;
  float broad=rtNoise(p/16.0+vec2(position.y*.03125,19.0));
  float face=1.0-abs(normal.y);
  vec2 wall=vec2(dot(p,abs(normal.zx)),position.y);
  float runoff=rtNoise(vec2(wall.x*.5,wall.y*.0625)+vec2(31.0,7.0));
  float stain=smoothstep(.48,.85,runoff)*face;
  float grain=mix(.5,rtNoise(p*2.0+position.y),1.0-smoothstep(25.0,90.0,length(vViewPosition)));
  return vec3(.96,.975,.98)*(.87+.16*broad+.05*(grain-.5)-.1*stain);
}
`;
const uniforms = 'uniform float rtTime; uniform vec2 rtOrigin; uniform float rtValley; uniform float rtWind; uniform vec4 rtTunnel; uniform float rtTunnelPhase; uniform vec4 rtTunnelStations[17];';
export const NIGHT_FOG_GLSL=`
float rtNightFog(float depth,float height,float time){
  float air=1.0-exp(-depth*.0001);
  float density=exp(-max(0.0,height+4.0)/28.0);
  float mist=(1.0-exp(-depth*.00042*density))*(.86+.14*sin(time*.015));
  float base=smoothstep(fogNear,fogFar,depth);
  return 1.0-(1.0-base)*(1.0-air)*(1.0-mist);
}
`;
const pbr = `
uniform highp sampler2DArray rtAlbedo; uniform highp sampler2DArray rtSurface;
// Offset-blended repeats retain derivative-based mip selection, unlike hash UV
// discontinuities. Both material channels use exactly the same sampling weights.
void rtSample(vec2 p,float layer,out vec3 color,out vec4 detail,vec2 gradientX,vec2 gradientY){
  float distance=length(vViewPosition);
  color=textureGrad(rtAlbedo,vec3(p,layer),gradientX,gradientY).rgb;
  detail=distance<550.0?textureGrad(rtSurface,vec3(p,layer),gradientX,gradientY):vec4(.5,.5,.9,1.0);
  if(distance<150.0){
    float blend=smoothstep(.25,.75,rtNoise(p*.125))*(1.0-smoothstep(70.0,150.0,distance));
    color=mix(color,textureGrad(rtAlbedo,vec3(p+vec2(.37,.61),layer),gradientX,gradientY).rgb,blend);
    detail=mix(detail,textureGrad(rtSurface,vec3(p+vec2(.37,.61),layer),gradientX,gradientY),blend);
  }
}
vec3 rtMappedNormal(vec3 normal,vec2 xy,vec2 uv){
  vec3 dp1=dFdx(-vViewPosition),dp2=dFdy(-vViewPosition);
  vec2 uv1=dFdx(uv),uv2=dFdy(uv);
  vec3 p1=cross(normal,dp1),p2=cross(dp2,normal);
  vec3 t=p2*uv1.x+p1*uv2.x,b=p2*uv1.y+p1*uv2.y;
  float inv=inversesqrt(max(max(dot(t,t),dot(b,b)),.00001));
  return normalize(t*inv*xy.x+b*inv*xy.y+normal*sqrt(max(.05,1.0-dot(xy,xy))));
}
`;
export function surfaceMaterial(material: THREE.MeshStandardMaterial, kind: 'terrain' | 'asphalt' | 'water' | 'rock' | 'gravel' | 'plain' | 'concrete', state: WorldUniforms, textures?: SurfaceTextures) {
  material.onBeforeCompile = (shader, renderer) => {
    Object.assign(shader.uniforms, { rtTime: state.time, rtOrigin: state.origin, rtValley: state.valley, rtWind: state.wind,rtTunnel:state.tunnel,rtTunnelPhase:state.tunnelPhase,rtTunnelStations:state.tunnelStations });
    shader.vertexShader = `${uniforms}\n${shader.vertexShader}`;
    const textured = textures && ['terrain','asphalt','rock','gravel'].includes(kind);
    // Three's DFG lookup + environment + three shadow maps + two projector
    // cookies + two PBR arrays require nine fragment samplers. RFP reports eight.
    // Evaluate the same cookie for each physical projector in that case; both
    // independent projections/shadows and all surface maps remain intact.
    if (textured && renderer.capabilities.maxTextures < 9) {
      shader.fragmentShader = HEADLIGHT_PROFILE_GLSL + shader.fragmentShader.replace(
        '#include <lights_fragment_begin>',
        FINITE_LIGHTS_FRAGMENT.replace(
          'texture2D( spotLightMap[ SPOT_LIGHT_MAP_INDEX ], spotLightCoord.xy )',
          'rtHeadlightProfile( spotLightCoord.xy )',
        ),
      );
    }
    shader.fragmentShader=shader.fragmentShader.replace('#include <lights_fragment_begin>',FINITE_LIGHTS_FRAGMENT);
    if (textured) Object.assign(shader.uniforms, { rtAlbedo: { value: textures.albedo }, rtSurface: { value: textures.surface } });
    shader.fragmentShader = `${uniforms}\n${noise}\n${shader.fragmentShader}`;
    if(kind==='concrete'||kind==='gravel')shader.fragmentShader=shader.fragmentShader.replace('void main() {',`${concrete}\nvoid main() {`);
    shader.fragmentShader=shader.fragmentShader.replace('void main() {',`#ifdef USE_FOG\n${NIGHT_FOG_GLSL}\n#endif\nvoid main() {`);
    if(kind==='water')shader.fragmentShader=shader.fragmentShader.replace('void main() {',`
      vec3 rtWaterHeights(vec2 drift){
        vec2 warped=drift+vec2(rtNoise(drift*.125),rtNoise(drift*.125+vec2(37.0,91.0)))*1.8;
        return vec3(rtNoise(warped*.5)*.06,rtNoise(warped*2.0)*.018,rtNoise(warped*8.0)*.004);
      }
      void main() {
    `);
    if (textured) shader.fragmentShader = shader.fragmentShader.replace('void main() {', `${pbr}\nvoid main() {`);
    // Reuse Three.js varyings instead of sending another two vec3s. Firefox's
    // fingerprinting-resistant varying limit otherwise fails shader linking
    // when both spotlights and the moon cast shadows, leaving terrain absent.
    shader.fragmentShader=shader.fragmentShader.replace('void main() {',`void main() {
      vec3 rtPosition=(vec4(-vViewPosition,0.0)*viewMatrix).xyz+cameraPosition;
      #ifdef FLAT_SHADED
        vec3 rtNormal=normalize(cross(dFdx(rtPosition),dFdy(rtPosition)));
      #else
        vec3 rtNormal=normalize((vec4(vNormal,0.0)*viewMatrix).xyz);
      #endif
    `);
    let color = kind==='concrete'?'diffuseColor.rgb*=rtConcrete(rtPosition,rtNormal);':'';
    if (kind === 'terrain' && !textured) color = `
      vec2 p=rtPosition.xz+rtOrigin;
      float macro=rtNoise(p*.03125), patches=rtNoise(p*.25), grain=rtNoise(p*4.0);
      float slope=1.0-abs(rtNormal.y);
      vec3 grass=mix(vec3(.12,.17,.075),vec3(.25,.28,.12),macro);
      vec3 soil=vec3(.22,.18,.125)*(0.75+patches*.5);
      vec3 stone=mix(vec3(.18,.115,.075),vec3(.4,.41,.385),macro);
      diffuseColor.rgb=mix(mix(grass,soil,smoothstep(.52,.78,patches)*.55),stone,mix(smoothstep(${ROCK_SLOPE.mixedStart},${ROCK_SLOPE.mixedEnd},slope)*(.16+.28*macro),.9+.1*macro,smoothstep(${ROCK_SLOPE.cliffStart},${ROCK_SLOPE.cliffEnd},slope)));
      diffuseColor.rgb*=.8+grain*.35;
    `;
    if (kind === 'asphalt' && !textured) color = `
      vec2 p=rtPosition.xz+rtOrigin;
      float grain=mix(.5,rtNoise(p*16.0),1.0-smoothstep(45.0,150.0,length(vViewPosition))), wear=rtNoise(p*.5), repair=step(.82,rtNoise(p*.03125));
      diffuseColor.rgb*=.65+grain*.65+wear*.13-repair*.15;
    `;
    if (kind === 'rock' && !textured) color = `vec2 p=rtPosition.xz+rtOrigin; diffuseColor.rgb*=.7+rtNoise(p*2.0)*.5;`;
    if(kind==='water') color=`
      float rtDepth=max(0.0,vColor.r);
      diffuseColor.rgb=mix(vec3(.035,.047,.027),vec3(.009,.023,.028),1.0-exp(-rtDepth*1.4));
      diffuseColor.a*=smoothstep(.01,.3,rtDepth);
    `;
    if (textured) {
      color = `vec2 p=rtPosition.xz+rtOrigin; vec3 rtColor; vec4 rtDetail;`;
      if (kind === 'terrain') color += `
        vec3 grass,dirt,stone; vec4 grassD,dirtD,stoneD,stoneX=vec4(.5,.5,.9,1.0),stoneZ=stoneX;
        vec3 rockWeight=pow(abs(rtNormal),vec3(4.0));rockWeight=max(rockWeight-vec3(.001),vec3(0));rockWeight/=max(.0001,rockWeight.x+rockWeight.y+rockWeight.z);
        // Planar detail is stable on moderate gradients; smoothly introduce
        // side projections only where steep faces would otherwise stretch.
        rockWeight=mix(vec3(0.0,1.0,0.0),rockWeight,smoothstep(.13,.38,1.0-abs(rtNormal.y)));
        rtSample(p*.25,4.0,grass,grassD); rtSample(p*.25,1.0,dirt,dirtD);
        float moss=clamp(vColor.r*.65+vColor.g*.5,0.0,1.0);
        // Dry turf and humus are distinct substrates; forest coverage adds moss.
        grass*=vec3(.76,.98,.68);
        dirt=mix(dirt*vec3(.73,.84,.58),grass*.83,moss*.7);
        float floorMask=clamp(smoothstep(.3,.9,vColor.r)*.32+rtNoise(p*.03125)*.12,0.0,.46);
        // Moderate slopes remain mixed; cliffs converge to rock irrespective
        // of noise. Distant canopy tint must not repaint exposed faces green.
        // Broad mineral beds follow the mountain's height as well as plan position.
        // Avoid64m colour islands and strongly thresholded white patches.
        float geology=rtNoise(p/190.0+vec2(53.0,29.0))*.68+rtNoise(vec2(p.x*.0025+rtPosition.y*.018,p.y*.0025)+vec2(35.0,11.0))*.32,slope=1.0-abs(rtNormal.y);
        float slopeMask=mix(smoothstep(${ROCK_SLOPE.mixedStart},${ROCK_SLOPE.mixedEnd},slope)*(.16+.28*geology),.9+.1*geology,smoothstep(${ROCK_SLOPE.cliffStart},${ROCK_SLOPE.cliffEnd},slope));
        stone=grass;stoneD=grassD;
        if(slopeMask>.001){
          vec3 colorX,colorZ;
          colorX=stone;colorZ=stone;
          if(rockWeight.y>0.0)rtSample(p*.25,2.0,stone,stoneD);
          if(rockWeight.x>0.0)rtSample(vec2(p.y,rtPosition.y)*.25,2.0,colorX,stoneX);
          if(rockWeight.z>0.0)rtSample(vec2(p.x,rtPosition.y)*.25,2.0,colorZ,stoneZ);
          stone=stone*rockWeight.y+colorX*rockWeight.x+colorZ*rockWeight.z;
          // Pale weathered mineral faces and warm brown rock retain the same
          // photographic grain, normal/roughness maps and dry matte response.
          float mineral=clamp((geology-.15)/.7,0.0,1.0);
          vec3 pale=vec3(.98,1.01,.96)*dot(stone,vec3(.2126,.7152,.0722))*1.8;
          stone=mix(stone*vec3(1.04,.94,.86),pale,mineral*.65);
        }
        rtColor=mix(mix(grass,dirt,floorMask),stone,slopeMask);
        vec4 groundDetail=mix(grassD,dirtD,floorMask);
        rtDetail=mix(groundDetail,stoneD*rockWeight.y+stoneX*rockWeight.x+stoneZ*rockWeight.z,slopeMask);
        rtColor*=mix(.9,.82,vColor.g)*(.9+.16*rtNoise(p*.015625));
        // Subpixel crowns converge to coherent forest landcover, rather than
        // scattered dark flecks on otherwise bare distant slopes. Individual
        // atlas silhouettes remain visible above this matte ground response.
        float canopy=smoothstep(.4,.8,vColor.r)*smoothstep(650.0,1400.0,length(vViewPosition));
        rtColor=mix(rtColor,grass*vec3(.45,.62,.5)*(.88+.16*rtNoise(p/32.0)),canopy*.8*(1.0-slopeMask)*(1.0-slopeMask));
        rtDetail.b=max(.85,rtDetail.b);
      `;
      else color += `rtSample(p*${kind === 'rock' ? '.25' : '.5'},${kind === 'asphalt' ? '0' : kind === 'gravel' ? '3' : '2'}.0,rtColor,rtDetail);`;
      if(kind==='gravel')color+=`
        vec3 edgeGrass,edgeSoil;vec4 edgeGrassD,edgeSoilD;
        rtSample(p*.25,4.0,edgeGrass,edgeGrassD);rtSample(p*.25,1.0,edgeSoil,edgeSoilD);
        edgeGrass*=vec3(.76,.98,.68);edgeSoil=mix(edgeSoil*vec3(.73,.84,.58),edgeGrass*.83,vColor.g*.5);
        float floorMask=smoothstep(.28,.85,vColor.g)*.35;
        // Blue is a structural deck flag: no turf/humus may enter its surface,
        // even at banked transitions or interpolated slab side vertices.
        float edgeMask=smoothstep(.12,.9,vColor.r+(rtNoise(p*.35)-.5)*.14)*(1.0-clamp(vColor.b,0.0,1.0));
        rtColor*=vec3(.7,.75,.7);
        rtColor=mix(rtColor,mix(edgeGrass,edgeSoil,floorMask)*(.86+.18*rtNoise(p*.015625)),edgeMask);
        rtDetail=mix(rtDetail,mix(edgeGrassD,edgeSoilD,floorMask),edgeMask);
        if(vColor.b>.5){rtColor=vec3(.34,.355,.36)*rtConcrete(rtPosition,rtNormal);rtDetail=vec4(.5,.5,.96,1.0);}
      `;
      if (kind === 'rock') color += `
        vec3 cx,cz; vec4 dx,dz;
        rtSample(vec2(rtPosition.z+rtOrigin.y,rtPosition.y)*.25,2.0,cx,dx);
        rtSample(vec2(rtPosition.x+rtOrigin.x,rtPosition.y)*.25,2.0,cz,dz);
        vec3 w=pow(abs(rtNormal),vec3(4.0));w/=max(.0001,w.x+w.y+w.z);
        rtColor=rtColor*w.y+cx*w.x+cz*w.z;
        rtColor=mix(rtColor,rtColor*vec3(.65,.8,.5),smoothstep(.6,.95,rtNormal.y)*.25);
      `;
      if (kind === 'asphalt') color += `
        // Most maintained road is intact; a few irregular hairlines occur per
        // kilometre. Period divides the wrapped origin, so rebasing is stable.
        vec2 crackCell=mod(floor(p/128.0),128.0);
        float selected=step(.92,rtHash(crackCell+vec2(11.0,17.0)));
        float seam=(fract(p.y/128.0)-(.25+.5*rtHash(crackCell+1.0)))*128.0+p.x*.12+sin(p.x*1.7+rtHash(crackCell)*6.28)*.16;
        float crack=selected*(1.0-smoothstep(.012,.03+fwidth(seam),abs(seam)));
        float repair=smoothstep(.9,.97,rtNoise(p*.125+vec2(15.0,31.0)));
        float wear=rtNoise(p*.03125);
        rtColor*=mix(.64,.56,repair)*(.93+.1*wear)*(1.0-crack*.22);
        rtDetail.b=.8+.15*rtDetail.b;
      `;
      color=color.replace(/rtSample\((.*?),([0-4]\.0),(\w+),(\w+)\)/g,(_match,uv:string,layer:string,c:string,d:string)=>{
        const plane=uv.includes('p.y,rtPosition.y')||uv.includes('rtPosition.z+')?'zy':uv.includes('p.x,rtPosition.y')||uv.includes('rtPosition.x+')?'xy':'xz';
        const scale=uv.includes('.25')?'.25':'.5';
        return `rtSample(${uv},${layer},${c},${d},rtGradientX.${plane}*${scale},rtGradientY.${plane}*${scale})`;
      });
      color=`vec3 rtGradientX=dFdx(rtPosition),rtGradientY=dFdy(rtPosition);\n`+color;
      color += `diffuseColor.rgb=rtColor;`;
      shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor=clamp(rtDetail.b,.45,.98);');
      let mappedNormal=`normal=rtMappedNormal(normal,(rtDetail.rg*2.0-1.0)*rtNormalStrength,rtPosition.xz);`;
      if(kind==='terrain') mappedNormal=`
        vec3 groundNormal=rtMappedNormal(normal,(groundDetail.rg*2.0-1.0)*rtNormalStrength,rtPosition.xz);
        if(slopeMask>.001){
          vec3 rockNormal=rtMappedNormal(normal,(stoneD.rg*2.0-1.0)*rtNormalStrength,rtPosition.xz)*rockWeight.y
            +rtMappedNormal(normal,(stoneX.rg*2.0-1.0)*rtNormalStrength,rtPosition.zy)*rockWeight.x
            +rtMappedNormal(normal,(stoneZ.rg*2.0-1.0)*rtNormalStrength,rtPosition.xy)*rockWeight.z;
          groundNormal=mix(groundNormal,normalize(rockNormal),slopeMask);
        }
        normal=normalize(groundNormal);
      `;
      if(kind==='rock') mappedNormal=`
        normal=normalize(rtMappedNormal(normal,(rtDetail.rg*2.0-1.0)*rtNormalStrength,rtPosition.xz)*w.y
          +rtMappedNormal(normal,(dx.rg*2.0-1.0)*rtNormalStrength,rtPosition.zy)*w.x
          +rtMappedNormal(normal,(dz.rg*2.0-1.0)*rtNormalStrength,rtPosition.xy)*w.z);
      `;
      shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        float rtNormalStrength=${kind === 'asphalt' ? '.28' : '.65'}*(1.0-smoothstep(250.0,600.0,length(vViewPosition)));
        ${mappedNormal}
      `);
      if(kind==='rock') shader.fragmentShader=shader.fragmentShader.replace('roughnessFactor=clamp(rtDetail.b,.45,.98);','roughnessFactor=clamp(rtDetail.b*w.y+dx.b*w.x+dz.b*w.z,.45,.98);');
      shader.fragmentShader = shader.fragmentShader.replace('#include <aomap_fragment>', '#include <aomap_fragment>\nreflectedLight.indirectDiffuse*=mix(.55,1.0,rtDetail.a);');
    }
    if (color) shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\n' + color);
    if (kind === 'water') {
      shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        vec2 p=rtPosition.xz+rtOrigin;
        vec2 flow=vColor.gb*2.0-1.0;
        vec3 dx=dFdx(rtPosition),dy=dFdy(rtPosition);
        vec3 worldN=normalize(cross(dx,dy)); if(worldN.y<0.0) worldN=-worldN;
        // Two bounded, alternating flow phases prevent indefinitely stretching
        // the field where adjacent flow directions differ. Each phase resets
        // only while its weight is zero. Opposing currents slow through zero.
        float phase=fract(rtTime*.125);
        vec3 heights=mix(rtWaterHeights(p-flow*phase*2.0),rtWaterHeights(p-flow*fract(phase+.5)*2.0),abs(phase*2.0-1.0));
        float footprint=max(length(dFdx(p)),length(dFdy(p)));
        vec3 fade=vec3(1.0,1.0-smoothstep(.125,.3,footprint),1.0-smoothstep(.03,.08,footprint));
        vec3 r1=cross(dy,worldN),r2=cross(worldN,dx);
        float determinant=dot(dx,r1);
        // Fade gradients after differentiation: differentiating a footprint
        // that already uses derivatives invokes undefined second derivatives.
        vec3 gradient=sign(determinant)*(dot(dFdx(heights),fade)*r1+dot(dFdy(heights),fade)*r2)/max(abs(determinant),.00001);
        vec3 flowNormal=normalize(worldN-gradient);
        normal=normalize(mat3(viewMatrix)*flowNormal);
      `);
      shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        float fresnel=pow(1.0-max(0.0,dot(normal,normalize(vViewPosition))),4.0);
        totalEmissiveRadiance+=vec3(.0015,.003,.005)*fresnel;
      `);
    }
    if(['asphalt','gravel','rock','plain','concrete'].includes(kind))shader.fragmentShader=shader.fragmentShader.replace('#include <emissivemap_fragment>',`#include <emissivemap_fragment>
      if(rtTunnel.y<=rtTunnel.z&&rtPosition.z>rtTunnel.y-12.0&&rtPosition.z<rtTunnel.z+12.0){
      float rtStation=clamp((rtPosition.z-rtTunnel.y)/max(1.0,rtTunnel.z-rtTunnel.y)*16.0,0.0,16.0);
      int rtStationIndex=min(15,int(floor(rtStation)));
      vec4 rtAlignment=mix(rtTunnelStations[rtStationIndex],rtTunnelStations[rtStationIndex+1],rtStation-float(rtStationIndex));
      float rtAcross=rtPosition.x-rtAlignment.x,rtHeight=rtPosition.y-rtAlignment.y-rtAcross*rtAlignment.w;
      float rtInside=smoothstep(rtTunnel.y-12.0,rtTunnel.y+8.0,rtPosition.z)*(1.0-smoothstep(rtTunnel.z-8.0,rtTunnel.z+12.0,rtPosition.z))*(1.0-smoothstep(5.2,7.0,abs(rtAcross)));
      rtInside*=smoothstep(-3.0,-1.0,rtHeight)*(1.0-smoothstep(7.0,11.0,rtHeight));
      float rtLampDistance=abs(mod(rtPosition.z-rtTunnel.y+rtTunnelPhase+17.5,35.0)-17.5);
      vec3 rtUp=mat3(viewMatrix)*vec3(0.0,1.0,0.0);
      float rtBounce=.32+.68*max(0.0,dot(normal,rtUp));
      totalEmissiveRadiance+=diffuseColor.rgb*vec3(.035,.028,.02)*rtInside*rtBounce*(.65+.35*exp(-rtLampDistance/12.0));
      }
    `);
    // Height-aware valley haze, computed in the same space as the floating origin.
    shader.fragmentShader = shader.fragmentShader.replace('#include <fog_fragment>', `
      #ifdef USE_FOG
        gl_FragColor.rgb=mix(gl_FragColor.rgb,fogColor,rtNightFog(vFogDepth,rtPosition.y-rtValley,rtTime));
      #endif
    `);
  };
  material.customProgramCacheKey = () => `rimmile-${kind}-${textures ? 'pbr' : 'procedural'}-11`;
  return material;
}
/** Crown normals describe foliage volume, not the orientation of a leaf card.
 * Keep bark normals geometric, retain shadow attenuation, and share air/mist
 * with terrain without exporting another varying or adding a light/sampler. */
export function vegetationMaterial<T extends THREE.MeshStandardMaterial|THREE.MeshLambertMaterial>(material:T,state:WorldUniforms,leafNormals=true){
  const previous=material.onBeforeCompile,key=material.customProgramCacheKey();
  material.onBeforeCompile=(shader,renderer)=>{
    previous.call(material,shader,renderer);
    shader.fragmentShader=shader.fragmentShader.replace('#include <lights_fragment_begin>',FINITE_LIGHTS_FRAGMENT);
    Object.assign(shader.uniforms,{rtTime:state.time,rtValley:state.valley});
    shader.fragmentShader='uniform float rtTime; uniform float rtValley;\n'+shader.fragmentShader;
    shader.fragmentShader=shader.fragmentShader.replace('void main() {',`#ifdef USE_FOG\n${NIGHT_FOG_GLSL}\n#endif\nvoid main() {`);
    if(leafNormals){
      shader.fragmentShader=shader.fragmentShader.replace('#include <normal_fragment_maps>',`#include <normal_fragment_maps>
        if(vMapUv.y>.2){
          vec3 rtLeaf=normalize(vNormal),rtView=normalize(vViewPosition);
          // The visible hemisphere must stay valid for the PBR BRDF, including
          // leaf backs. Bend grazing proxies smoothly rather than flipping them.
          normal=normalize(rtLeaf+rtView*max(0.0,.15-dot(rtLeaf,rtView)));
        }
      `);
    }
    for(const chunk of ['lights_lambert_pars_fragment','lights_physical_pars_fragment'] as const){
      shader.fragmentShader=shader.fragmentShader.replace('#include <'+chunk+'>',THREE.ShaderChunk[chunk].replace(
        'reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );',
        `float rtWrap=${leafNormals?'step(.2,vMapUv.y)*.22':'.18'};float rtDiffuse=saturate((dot(geometryNormal,directLight.direction)+rtWrap)/(1.0+rtWrap));reflectedLight.directDiffuse+=rtDiffuse*directLight.color*BRDF_Lambert(material.diffuseColor);`));
    }
    // A modest diffuse sky response reveals foliage volume without emission,
    // changing exposure, removing direct shadows or altering geometric bark.
    shader.fragmentShader=shader.fragmentShader.replace('#include <aomap_fragment>',`#include <aomap_fragment>
      reflectedLight.indirectDiffuse*=mix(1.0,1.45,${leafNormals?'step(.2,vMapUv.y)':'1.0'});
    `);
    shader.fragmentShader=shader.fragmentShader.replace('#include <fog_fragment>',`#ifdef USE_FOG
      float rtHeight=dot(-vViewPosition,viewMatrix[1].xyz)+cameraPosition.y-rtValley;
      gl_FragColor.rgb=mix(gl_FragColor.rgb,fogColor,rtNightFog(vFogDepth,rtHeight,rtTime));
    #endif`);
  };
  material.customProgramCacheKey=()=>key+'-vegetation-3-'+Number(leafNormals);return material;
}
export function plantWind<T extends THREE.MeshStandardMaterial | THREE.MeshLambertMaterial | THREE.MeshDepthMaterial>(material: T, state: WorldUniforms) {
  const original = material.onBeforeCompile;
  const originalKey = material.customProgramCacheKey();
  material.onBeforeCompile = (shader, renderer) => {
    original.call(material, shader, renderer);
    Object.assign(shader.uniforms, { rtTime: state.time, rtWind: state.wind,rtTunnel:state.tunnel,rtTunnelPhase:state.tunnelPhase,rtTunnelStations:state.tunnelStations });
    shader.vertexShader = `uniform float rtTime; uniform float rtWind;\n${shader.vertexShader}`;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      #ifdef USE_INSTANCING
        float phase=dot(instanceMatrix[3].xz,vec2(.017,.023));
        transformed.xz+=vec2(sin(rtTime*.65+phase),cos(rtTime*.4+phase))*pow(max(0.0,position.y),2.0)*.017*rtWind;
      #endif
    `);
  };
  material.customProgramCacheKey = () => `${originalKey}-rimmile-wind-1`;
  return material;
}
