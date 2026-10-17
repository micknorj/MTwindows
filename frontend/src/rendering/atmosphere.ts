import * as THREE from 'three';
import type { WorldUniforms } from './world-materials';

/** One background draw: layered cloud sheet, moon and sparse stars, no volumetric march. */
export class Atmosphere {
  private geometry = new THREE.SphereGeometry(1, 32, 16);
  private material: THREE.ShaderMaterial;
  private mesh: THREE.Mesh;
  constructor(scene: THREE.Scene, state: WorldUniforms) {
    this.material = new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false, fog: false, uniforms: { rtTime: state.time, detail: { value: 1 } }, vertexShader: `
      varying vec3 direction;
      void main(){ direction=position; vec4 p=projectionMatrix*mat4(mat3(viewMatrix))*vec4(position,1.0); gl_Position=p.xyww; }
    `, fragmentShader: `
      varying vec3 direction; uniform float rtTime; uniform float detail;
      float hash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
      float noise(vec2 p){ vec2 i=floor(p),f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+1.0),f.x),f.y); }
      float fbm(vec2 p){ return noise(p)*.53+noise(p*2.03)*.27+noise(p*4.1)*.13+noise(p*8.3)*.07*detail; }
      void main(){
        vec3 d=normalize(direction); float altitude=max(0.0,d.y);
        vec3 sky=mix(vec3(.012,.018,.031),vec3(.0015,.003,.008),pow(altitude,.45));
        vec3 moonDirection=normalize(vec3(-.4,.9,.25)); float alignment=dot(d,moonDirection);
        float halo=pow(max(0.0,alignment),95.0)*.035;
        float moon=smoothstep(.99965,.99976,alignment);
        vec3 moonRight=normalize(cross(moonDirection,vec3(0,1,0))), moonUp=cross(moonRight,moonDirection);
        vec2 disk=vec2(dot(d,moonRight),dot(d,moonUp))/.026;
        vec3 moonNormal=vec3(disk,sqrt(max(0.0,1.0-dot(disk,disk))));
        float phase=.08+.92*max(0.0,dot(moonNormal,normalize(vec3(.65,.1,.76))));
        float crater=.75+.25*noise(disk*18.0);
        sky+=vec3(.5,.6,.78)*halo+vec3(.75,.83,.9)*moon*crater*phase;
        vec2 stars=d.xz/(altitude+.15)*105.0,cell=floor(stars);
        float pick=hash(cell),magnitude=hash(cell+vec2(91.0,37.0));
        vec2 centre=.2+.6*vec2(hash(cell+3.0),hash(cell+17.0));
        float footprint=max(length(dFdx(stars)),length(dFdy(stars)));
        float radius=.035+.025*magnitude,dist=length(fract(stars)-centre);
        float star=step(.993,pick)*(1.0-smoothstep(radius,radius+max(.02,footprint*.65),dist));
        float starEnergy=min(1.0,radius*radius/max(.001,footprint*footprint));
        sky+=mix(vec3(2.4,2.8,3.4),vec3(4.0,3.8,3.3),magnitude)*star*starEnergy
          *(.18+.82*magnitude*magnitude)*smoothstep(.08,.45,altitude)*(1.0-pow(max(0.0,alignment),45.0)*.9);
        vec2 plane=d.xz/(altitude+.12)*2.2+vec2(rtTime*.002,rtTime*.0007);
        vec2 warp=vec2(fbm(plane*.8+17.0),fbm(plane*.8-9.0))-.5;
        float body=fbm(plane+warp*1.5), fine=fbm(plane*3.5+warp*2.0);
        float clouds=smoothstep(.46,.68,body*.8+fine*.2)*smoothstep(.01,.16,altitude);
        float rim=max(0.0,fbm(plane+warp*1.5+vec2(.12,-.08))-body);
        vec3 cloudColor=mix(vec3(.003,.005,.009),vec3(.024,.033,.045),fine*.5+rim*4.0+halo);
        sky=mix(sky,cloudColor,clouds*.96);
        sky=mix(sky,vec3(.012,.018,.031),1.0-smoothstep(-.05,.08,d.y));
        gl_FragColor=vec4(sky,1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    ` });
    this.mesh = new THREE.Mesh(this.geometry, this.material); this.mesh.frustumCulled = false; this.mesh.renderOrder = -1000; scene.add(this.mesh);
  }
  setDetail(low: boolean) { this.material.uniforms.detail.value = low ? 0 : 1; }
  environment(renderer:THREE.WebGLRenderer) {
    const parent=this.mesh.parent,scene=new THREE.Scene(),generator=new THREE.PMREMGenerator(renderer);
    scene.add(this.mesh);
    try{return generator.fromScene(scene,.015,.1,10,{size:128});}
    finally{if(parent)parent.add(this.mesh);generator.dispose();}
  }
  dispose() { this.mesh.removeFromParent(); this.geometry.dispose(); this.material.dispose(); }
}
