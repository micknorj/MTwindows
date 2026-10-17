import * as THREE from 'three';
import { CHASE } from '../vehicle/config';
import type { VehiclePhysics } from '../vehicle/physics';
import { WorldUniforms } from './world-materials';
import { Atmosphere } from './atmosphere';
import { FrameQueue } from './frame-queue';
import {DEFAULT_GRAPHICS,detailIndex,type Graphics} from './graphics';

export class GameView {
  readonly scene = new THREE.Scene();
  readonly renderer: THREE.WebGLRenderer;
  readonly worldUniforms = new WorldUniforms();
  private atmosphere: Atmosphere;
  readonly camera = new THREE.PerspectiveCamera(CHASE.baseFov, 1, .1, 6000);
  private target = new THREE.Vector3();
  private desired = new THREE.Vector3();
  private look = new THREE.Vector3();
  private followed = new THREE.Vector2();
  private following = false;
  private scale = .9;
  private graphics:Graphics={...DEFAULT_GRAPHICS};
  private sampleTime = 0;
  private frames = 0;
  private moon = new THREE.DirectionalLight(0xb9cbed, .55);
  private environment: THREE.WebGLRenderTarget;
  private frameSamples = new Float32Array(240);
  private renderSamples = new Float32Array(240);
  private sampleIndex = 0;
  private queue: FrameQueue;
  private sinceRender = 0;
  private pressure=0;
  private width=0;private height=0;private pixelRatio=0;
  constructor(canvas: HTMLCanvasElement) {
    const context = canvas.getContext('webgl2', { antialias: true, alpha: false, powerPreference: 'high-performance' });
    if (!context) throw new Error('WebGL2 unavailable.');
    this.renderer = new THREE.WebGLRenderer({ canvas, context, antialias: true });
    this.renderer.debug.onShaderError=(gl,program,vertex,fragment)=>{
      if(import.meta.env.DEV)console.error('Shader compilation failed:',gl.getShaderSource(vertex)?.match(/#define SHADER_NAME .*/)?.[0],gl.getProgramInfoLog(program),gl.getShaderInfoLog(vertex),gl.getShaderInfoLog(fragment));
      throw new Error('Graphics unavailable.');
    };
    this.renderer.info.autoReset=false;
    this.queue = new FrameQueue(context);
    let atmosphere:Atmosphere|undefined,environment:THREE.WebGLRenderTarget|undefined;
    try{
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1;
    this.scene.background = new THREE.Color(0x080d18);
    this.scene.fog = new THREE.Fog(0x111b29, 600, 5200);
    this.scene.add(new THREE.HemisphereLight(0x8c9fbd, 0x32362e, .1));
    this.scene.environmentIntensity = 1;
    this.atmosphere = atmosphere = new Atmosphere(this.scene, this.worldUniforms);
    const moon = this.moon;
    moon.position.set(-40, 90, 25); moon.castShadow = true;
    moon.shadow.mapSize.set(1024, 1024); moon.shadow.camera.left = -30; moon.shadow.camera.right = 30;
    moon.shadow.camera.top = 30; moon.shadow.camera.bottom = -30; moon.shadow.camera.near = .5; moon.shadow.camera.far = 180; moon.shadow.bias=-.00025; moon.shadow.normalBias = .085;
    this.scene.add(moon, moon.target);
    // Capture only the actual cloud/moon sky once, never the streamed world.
    // This avoids a second scene render every frame and mismatched/inverted skies.
    this.environment=environment=this.atmosphere.environment(this.renderer);this.scene.environment=this.environment.texture;
    this.resize();
    }catch(error){
      this.queue.dispose();atmosphere?.dispose();environment?.dispose();this.moon.dispose();
      this.renderer.dispose();this.renderer.forceContextLoss();throw error;
    }
  }
  setGraphics(graphics:Graphics) {
    const resolutionChanged=graphics.resolution!==this.graphics.resolution;
    this.graphics={...graphics};
    // Other detail controls must not reset an already adapted Auto resolution.
    if(resolutionChanged){
      this.pressure=0;
      this.scale=graphics.resolution==='Low'?.65:graphics.resolution==='Medium'?.85:graphics.resolution==='High'?1:.9;
      this.sampleTime=0;this.frames=0;
    }
    this.worldUniforms.treeDetail.value=[.65,.82,1][detailIndex(graphics.trees)];
    this.worldUniforms.grassDetail.value=[.65,.82,1][detailIndex(graphics.grass)];
    this.worldUniforms.distantDetail.value=detailIndex(graphics.distant);
    this.atmosphere.setDetail(graphics.distant==='Low');
    const size=[512,1024,1536][detailIndex(graphics.shadows)];
    if(this.moon.shadow.mapSize.x!==size){this.moon.shadow.map?.dispose();this.moon.shadow.map=null;this.moon.shadow.mapSize.set(size,size);}
    this.sampleIndex=0;this.sinceRender=0;this.resize();
  }
  resize() {
    // Change dimensions/DPI atomically; setPixelRatio followed by setSize resets the
    // default framebuffer twice, even when neither logical dimension changed.
    const canvas=this.renderer.domElement,width=Math.max(1,Math.round(canvas.clientWidth||window.innerWidth)),height=Math.max(1,Math.round(canvas.clientHeight||window.innerHeight));
    const ratio=Math.min(window.devicePixelRatio,1.75)*this.scale;
    if(width===this.width&&height===this.height&&ratio===this.pixelRatio)return;
    this.width=width;this.height=height;this.pixelRatio=ratio;
    this.renderer.setDrawingBufferSize(width,height,ratio);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.worldUniforms.lodScale.value=Math.max(.75,Math.min(1.5,this.height/720*this.camera.projectionMatrix.elements[5]/1.428));
  }
  follow(car: Pick<VehiclePhysics, 'x' | 'y' | 'z' | 'heading' | 'speed'>, origin: { x: number; z: number }, elapsed: number, snap = false) {
    const x = car.x - origin.x, z = car.z - origin.z;
    // Inherit horizontal travel before damping the relative chase offset.
    // Damping absolute positions adds speed/damping metres of unintended lag.
    if(this.following&&!snap){
      const dx=x-this.followed.x,dz=z-this.followed.y;
      this.camera.position.x+=dx;this.camera.position.z+=dz;
      this.target.x+=dx;this.target.z+=dz;
    }
    this.followed.set(x,z);this.following=true;
    this.worldUniforms.update(elapsed, origin.x, origin.z, car.y);
    this.moon.position.set(x - 40, car.y + 90, z + 25); this.moon.target.position.set(x, car.y, z);
    this.desired.set(x - Math.sin(car.heading) * CHASE.distance, car.y + CHASE.height, z - Math.cos(car.heading) * CHASE.distance);
    this.look.set(x + Math.sin(car.heading) * CHASE.lookAhead, car.y + CHASE.targetHeight, z + Math.cos(car.heading) * CHASE.lookAhead);
    const alpha = snap ? 1 : 1 - Math.exp(-CHASE.damping * elapsed);
    this.camera.position.lerp(this.desired, alpha); this.target.lerp(this.look, alpha);
    this.camera.lookAt(this.target);
    const fov = CHASE.baseFov + (CHASE.maxFov - CHASE.baseFov) * Math.min(1, Math.abs(car.speed) / 100);
    this.camera.fov += (fov - this.camera.fov) * alpha; this.camera.updateProjectionMatrix();
    this.worldUniforms.lodScale.value=Math.max(.75,Math.min(1.5,this.height/720*this.camera.projectionMatrix.elements[5]/1.428));
  }
  rebase(dx: number, dz: number) { this.camera.position.x -= dx; this.camera.position.z -= dz; this.target.x -= dx; this.target.z -= dz;this.followed.x-=dx;this.followed.y-=dz; }
  render(elapsed = 0) {
    this.sinceRender += elapsed;
    const ready = this.queue.ready();
    if (this.graphics.resolution === 'Auto' && elapsed > 0) {
      this.sampleTime += elapsed; this.frames += Number(ready);
      if (this.sampleTime >= 6) {
        const average = this.sampleTime / Math.max(1, this.frames);
        if(average>.025&&this.scale<=.62)this.pressure=Math.min(2,this.pressure+1);
        else if(average<.015&&this.pressure>0)this.pressure--;

        const next = Math.max(.6, Math.min(1, this.scale + (average > .021 ? -.08 : average < .015&&this.pressure===0 ? .04 : 0)));
        if (next !== this.scale) { this.scale = next; this.resize(); }
        this.sampleTime = 0; this.frames = 0;
      }
    }
    if (!ready) return false;
    const started = performance.now();
    this.renderer.info.reset();
    this.renderer.render(this.scene, this.camera);
    this.queue.submitted();
    if (import.meta.env.DEV && elapsed > 0) {
      const i = this.sampleIndex++ % this.frameSamples.length;
      this.frameSamples[i] = this.sinceRender * 1000; this.renderSamples[i] = performance.now() - started;
    }
    this.sinceRender = 0;return true;
  }
  get diagnostics() {
    const count = Math.min(this.sampleIndex, this.frameSamples.length);
    const percentile = (values: Float32Array, p: number) => [...values.slice(0, count)].sort((a, b) => a - b)[Math.floor(Math.max(0, count - 1) * p)] ?? 0;
    return { samples: count, frameMedianMs: percentile(this.frameSamples, .5), frameP95Ms: percentile(this.frameSamples, .95), renderCpuMedianMs: percentile(this.renderSamples, .5),renderCpuP95Ms:percentile(this.renderSamples,.95), moonShadowSize:this.moon.shadow.mapSize.x,scale: this.scale,graphics:{...this.graphics}, adaptiveTier:this.pressure, gpuBacklog: this.queue.pending };
  }
  async settleInspection() {
    if (!import.meta.env.DEV) return;
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    const started = performance.now();
    while (true) {
      this.queue.ready();
      if (!this.queue.pending) return;
      if (gl.isContextLost()) throw new Error('The graphics inspection was interrupted.');
      if (performance.now() - started > 30000) throw new Error('The graphics inspection timed out.');
      await new Promise(resolve => setTimeout(resolve, 8));
    }
  }
  dispose() {
    const context = this.renderer.getContext();
    this.queue.dispose();
    this.atmosphere.dispose(); this.environment.dispose(); this.moon.dispose();
    this.renderer.dispose();
    if (!context.isContextLost()) this.renderer.forceContextLoss();
  }
}
