import { FixedClock } from './timestep';
import { Keyboard } from '../input/keyboard';
import { GameView } from '../rendering/view';
import type {Graphics} from '../rendering/graphics';
import type {TransmissionMode} from '../vehicle/drivetrain';
import { VehiclePhysics } from '../vehicle/physics';
import { VehicleVisual } from '../vehicle/model';
import { WorldStream } from '../world/stream';
import { originFor } from '../world/window';
import { riverAt,riverChannelAt,tunnelAt,tunnelPlan,tunnelEnclosure,roadAt,REGION_LENGTH } from '../world/road';
import type { DriveAudio } from '../audio/drive-audio';
import { ControlBindings } from '../input/bindings';
import { RoadRecovery } from '../vehicle/recovery';
import { nearestRoad, ROAD_HALF_WIDTH } from '../world/road';
import type {Handling} from '../vehicle/handling';
import { surfaceHeight } from '../world/surface';

export class Game {
  readonly physics: VehiclePhysics;
  readonly view: GameView;
  readonly stream: WorldStream;
  private visual = new VehicleVisual();
  private input: Keyboard;
  private clock = new FixedClock();
  private origin = { x: 0, z: 0 };
  private frame = 0;
  private last = 0;
  private running = false;
  private disposed = false;
  private speedDisplay = 0;
  private pendingGraphics: Graphics | undefined;
  private needsResize = false;
  private viewportFrame=0;private canvasSize?:ResizeObserver;
  private events = new AbortController();
  private previous = { x: 0, y: 0, z: 0, heading: 0, pitch: 0, roll: 0 };
  private pose = { ...this.previous, speed: 0 };
  private audio?:DriveAudio;
  private initialized=false;
  private recovery=new RoadRecovery();
  private recoverySeconds=0;
  private recoveryDistance=0;
  private recoverySample=0;
  private transmissionNotice=0;
  private lightsOn=true;private tunnelLightingKey='';
  private cpuSamples=import.meta.env.DEV?new Float32Array(240):undefined;
  private cpuIndex=0;
  private cpuCount=0;
  private get cpuFrames(){
    if(!this.cpuSamples)return undefined;
    const values=Array.from(this.cpuSamples.subarray(0,this.cpuCount)).sort((a,b)=>a-b);
    return {samples:values.length,medianMs:values[Math.floor((values.length-1)*.5)]??0,p95Ms:values[Math.floor((values.length-1)*.95)]??0};
  }
  constructor(canvas: HTMLCanvasElement, private onSpeed: (speed: number) => void, private onError: (message: string) => void, bindings=new ControlBindings(),private onRecovery:(seconds:number)=>void=()=>{},private onLights:()=>void=()=>{},private onTravel:(metres:number)=>void=()=>{},private onTransmission:(text:string)=>void=()=>{}) {
    const seed = crypto.getRandomValues(new Uint32Array(1))[0];
    this.physics = new VehiclePhysics(seed);
    this.view = new GameView(canvas);
    let stream: WorldStream | undefined, input: Keyboard | undefined;
    try {
      this.stream = stream = new WorldStream(this.view.scene, seed, this.view.worldUniforms,this.view.renderer);
      this.view.scene.add(this.visual.group);
      this.input = input = new Keyboard(() => this.running, () => this.recover(), bindings,()=>this.onLights(),change=>this.shift(change),()=>this.toggleDirection());
      const refresh=()=>this.refreshViewport();
      for(const event of ['resize','focus','pageshow'])window.addEventListener(event,refresh,{signal:this.events.signal});
      document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();},{signal:this.events.signal});
      window.visualViewport?.addEventListener('resize',refresh,{signal:this.events.signal});
      if(typeof ResizeObserver!=='undefined'){this.canvasSize=new ResizeObserver(refresh);this.canvasSize.observe(canvas);}
      canvas.addEventListener('webglcontextlost', event => {
        event.preventDefault();
        this.pause(); this.onError('The graphics connection was lost. Retry to start a new drive.');
      }, { signal: this.events.signal });
    } catch (error) {
      for (const release of [() => this.events.abort(), () => this.canvasSize?.disconnect(), () => input?.dispose(), () => stream?.dispose(), () => this.visual.dispose(), () => this.view.dispose()]) {
        try { release(); } catch { /* Preserve the original loading error and release remaining resources. */ }
      }
      throw error;
    }
  }
  async initialize(progress: (value: number) => void) {
    const gl=this.view.renderer.getContext();
    await this.visual.initialize(value => progress(Math.round(value * 25)), this.events.signal,gl.getParameter(gl.MAX_VARYING_VECTORS),this.view.worldUniforms);
    if (this.disposed) throw new Error('Loading was interrupted. Please retry.');
    this.physics.colliders = this.visual.colliders;this.visual.setLights(this.lightsOn);
    this.applyGraphics();
    await this.stream.initialize();
    while (!this.stream.ready) {
      if (this.disposed) throw new Error('Loading was interrupted. Please retry.');
      this.stream.tick(this.physics.z, this.physics.x);
      progress(25 + Math.round(this.stream.progress * 70));
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    }
    this.applyGraphics();this.sync(true);this.stream.updateVisibility(this.physics.z,this.physics.x,this.view.camera,this.visual.group.rotation.y); this.view.render(); progress(100);this.initialized=true;this.stream.suspend();
  }
  attachAudio(audio:DriveAudio){if(this.audio&&this.audio!==audio)this.audio.dispose();this.audio=audio;}
  clearInput(){this.input.clear();}
  menuFrame(){if(!this.initialized||this.running)return;this.applyGraphics();this.view.resize();this.needsResize=false;this.stream.updateVisibility(this.physics.z,this.physics.x,this.view.camera,this.visual.group.rotation.y);this.view.render();}
  private refreshViewport(){
    if(this.disposed)return;
    this.view.resize();this.needsResize=true;
    if(this.running||!this.initialized||document.hidden||this.viewportFrame)return;
    const repaint=()=>{this.viewportFrame=0;if(this.disposed||this.running||document.hidden)return;
      this.applyGraphics();this.view.resize();this.needsResize=false;
      this.stream.updateVisibility(this.physics.z,this.physics.x,this.view.camera,this.visual.group.rotation.y);
      if(!this.view.render())this.viewportFrame=requestAnimationFrame(repaint);
    };
    this.viewportFrame=requestAnimationFrame(repaint);
  }
  resume() {
    if (this.disposed || this.running) return;
    cancelAnimationFrame(this.viewportFrame);this.viewportFrame=0;this.input.clear(); this.clock.reset(); this.last = performance.now(); this.running = true; this.capture();this.stream.resume(); this.audio?.resume();
    this.frame = requestAnimationFrame(this.animate);
  }
  pause() {
    this.running = false; cancelAnimationFrame(this.frame); this.input.clear(); this.clock.reset(); this.audio?.pause();if(this.initialized)this.stream.suspend();
  }
  setLights(on:boolean){this.lightsOn=on;this.visual.setLights(on);this.view.worldUniforms.headlights=on;}
  setHandling(value:Handling){this.physics.setHandling(value);}
  setTransmission(mode:TransmissionMode){this.physics.drivetrain.setMode(mode);}
  private notice(text:string){this.onTransmission(text);this.transmissionNotice=2;}
  private shift(change:-1|1){
    if(this.physics.submerged)return;
    const drive=this.physics.drivetrain,result=drive.shiftManual(change,this.physics.speed);
    if(result==='automatic')return;
    this.notice(result==='shifted'?`Manual · Gear ${drive.gear}`:result==='overrev'?'Downshift rejected · RPM too high':result==='reverse'?'Reverse · Select Drive to shift':result==='limit'?`Manual · Gear ${drive.gear}`:'Shift in progress');
  }
  private toggleDirection(){
    if(this.physics.submerged)return;
    const drive=this.physics.drivetrain;
    this.notice(drive.toggleDirection(this.physics.speed,this.physics.lateralSpeed)?drive.direction==='Reverse'?'Reverse · Accelerate to move':`${drive.mode} · Drive · Gear ${drive.gear}`:'Slow down to select Drive / Reverse');
  }
  setGraphics(graphics:Graphics) {this.pendingGraphics={...graphics};if(this.initialized&&!this.running)this.refreshViewport();}
  private applyGraphics(){
    const graphics=this.pendingGraphics;if(!graphics)return;
    this.view.setGraphics(graphics);this.stream.setGraphics(graphics);this.visual.setShadowDetail(graphics.shadows==='Low'?512:graphics.shadows==='High'?1024:768);this.pendingGraphics=undefined;
  }
  private capture() { for (const key of ['x', 'y', 'z', 'heading', 'pitch', 'roll'] as const) this.previous[key] = this.physics[key]; }
  recover() {
    this.physics.recover();this.transmissionNotice=0;this.onTransmission('');this.recovery.reset();this.recoveryDistance=0;this.recoverySample=0;this.recoverySeconds=0;this.onRecovery(0); this.input.clear(); this.clock.reset(); this.speedDisplay = 0; this.onSpeed(0); this.sync(true);
  }
  private sync(snap = false, dt = 0, alpha = 1) {
    const next = originFor(this.physics.x, this.physics.z);
    if (next.x !== this.origin.x || next.z !== this.origin.z) {
      this.view.rebase(next.x - this.origin.x, next.z - this.origin.z);
      this.origin = next; this.stream.rebase(this.origin);
    }
    if (snap) this.capture();
    for (const key of ['x', 'y', 'z', 'heading', 'pitch', 'roll'] as const) this.pose[key] = this.previous[key] + (this.physics[key] - this.previous[key]) * alpha;
    this.pose.speed = this.physics.speed;
    this.visual.group.position.set(this.pose.x - this.origin.x, this.pose.y, this.pose.z - this.origin.z);
    this.visual.group.rotation.set(this.pose.pitch, this.pose.heading, this.pose.roll, 'YXZ');
    this.visual.update(this.physics.speed, this.physics.steer, this.physics.braking, dt, this.physics.wheelTravel,this.physics.wheelAngular,this.physics.wheelSteer,this.physics.drivetrain.direction==='Reverse');
    this.view.follow(this.pose, this.origin, dt, snap);
    const tunnel=tunnelPlan(Math.floor(this.physics.z/REGION_LENGTH),this.physics.seed);
    const tunnelKey=`${tunnel?.start}:${this.origin.x}:${this.origin.z}`;
    if(tunnelKey!==this.tunnelLightingKey){
      this.tunnelLightingKey=tunnelKey;
      this.view.worldUniforms.tunnelPhase.value=tunnel?tunnel.start%35:0;
      if(tunnel){
        this.view.worldUniforms.tunnel.value.set(0,tunnel.start-this.origin.z,tunnel.end-this.origin.z,0);
        for(let i=0;i<=16;i++){const p=roadAt(tunnel.start+(tunnel.end-tunnel.start)*i/16,this.physics.seed);this.view.worldUniforms.tunnelStations.value[i].set(p.x-this.origin.x,p.y,p.z-this.origin.z,p.bank);}
      }else this.view.worldUniforms.tunnel.value.set(0,1,-1,0);
    }
    this.view.worldUniforms.valley.value=riverChannelAt(this.physics.z,this.physics.seed).y;
  }
  private animate = (now: number) => {
    if (!this.running) return;
    try {
      const cpuStart=import.meta.env.DEV?performance.now():0;
      const frameElapsed = (now - this.last) / 1000;
      const elapsed = Math.min(.1, frameElapsed); this.last = now;
      this.applyGraphics();
      this.stream.tick(this.physics.z, this.physics.x,this.view.camera,this.physics.speed,this.physics.heading);
      if (this.needsResize) { this.view.resize(); this.needsResize = false; }
      const input = this.input.read();
      this.physics.obstacles = this.stream.obstaclesNear(this.physics.z);
      const distanceBefore=this.physics.distanceTravelled;let simulationElapsed=0;
      const alpha = this.clock.advance(elapsed, dt => {
        this.capture();
        // Back-pressure if a worker stalls: never advance into missing geometry.
        const projected = this.physics.z + Math.cos(this.physics.heading) * this.physics.speed * dt;
        if (this.stream.hasGround(projected) && this.stream.hasGround(projected + 12) && this.stream.hasGround(projected - 12)){this.physics.step(dt,input);simulationElapsed+=dt;}
      });
      this.onTravel(this.physics.distanceTravelled-distanceBefore);
      if(this.transmissionNotice>0){this.transmissionNotice=Math.max(0,this.transmissionNotice-simulationElapsed);if(!this.transmissionNotice)this.onTransmission('');}
      this.sync(false, elapsed, alpha);
      this.recoverySample-=elapsed;
      if(this.recoverySample<=0){
        const road=nearestRoad(this.physics.x,this.physics.z,this.physics.seed);
        this.recoveryDistance=Math.max(0,Math.hypot(this.physics.x-road.x,this.physics.z-road.z)-ROAD_HALF_WIDTH);this.recoverySample=.1;
      }
      if(this.recovery.update(simulationElapsed,this.recoveryDistance,this.physics.submerged))this.recover();
      const seconds=this.recovery.seconds;if(seconds!==this.recoverySeconds){this.recoverySeconds=seconds;this.onRecovery(seconds);}
      this.audio?.update(this.physics,tunnelEnclosure(this.physics.x,this.physics.z,this.physics.seed,this.physics.y));
      this.speedDisplay += (Math.abs(this.physics.speed) * 3.6 - this.speedDisplay) * (1 - Math.exp(-10 * elapsed));
      this.onSpeed(Math.round(this.speedDisplay));
      this.view.render(frameElapsed);
      if(import.meta.env.DEV&&this.cpuSamples){this.cpuSamples[this.cpuIndex]=performance.now()-cpuStart;this.cpuIndex=(this.cpuIndex+1)%240;this.cpuCount=Math.min(240,this.cpuCount+1);}
      this.frame = requestAnimationFrame(this.animate);
    } catch (error) {
      this.pause();
      this.onError(error instanceof Error ? error.message : 'The drive was interrupted. Please retry.');
    }
  };
  get diagnostics() {
    return { ...this.stream.stats, viewport:{width:this.view.renderer.domElement.width,height:this.view.renderer.domElement.height,cssWidth:this.view.renderer.domElement.clientWidth,cssHeight:this.view.renderer.domElement.clientHeight,aspect:this.view.camera.aspect}, recovery:{seconds:this.recovery.seconds,settling:this.recovery.settling,distance:this.recoveryDistance,reason:this.recovery.reason,submerged:this.physics.submerged},cpuFrames:this.cpuFrames,performance: this.view.diagnostics, vehicle: this.visual.diagnostics, audio: this.audio?.diagnostics, drivetrain: { mode:this.physics.drivetrain.mode,direction:this.physics.drivetrain.direction,load:this.physics.drivetrain.load,shifting:this.physics.drivetrain.shifting,gear: this.physics.drivetrain.gear, rpm: this.physics.drivetrain.rpm, slip: this.physics.slip, wheelTravel: this.physics.wheelTravel }, crossing: riverAt(this.physics.z, this.physics.seed).crossing, handling:this.physics.handling,tunnel:tunnelAt(this.physics.z,this.physics.seed),distanceTravelled:this.physics.distanceTravelled,running: this.running, x: this.physics.x, y:this.physics.y, z: this.physics.z, speed: this.physics.speed, origin: { ...this.origin }, geometries: this.view.renderer.info.memory.geometries, textures: this.view.renderer.info.memory.textures, calls: this.view.renderer.info.render.calls, triangles: this.view.renderer.info.render.triangles };
  }
  async inspectPose(turn: number, pitch: number, roll: number) {
    if (!import.meta.env.DEV) return;
    this.pause(); await this.view.settleInspection(); this.sync(true);
    this.visual.group.rotation.y += turn; this.visual.group.rotation.x += pitch; this.visual.group.rotation.z += roll;
    this.visual.update(20, .25, true, .1); this.view.render();
    await this.view.settleInspection();
    return this.diagnostics;
  }
  async inspectSpeed(speed: number) {
    if(!import.meta.env.DEV)return;
    if(!Number.isFinite(speed))throw new Error('Non-finite inspection speed.');
    this.pause();await this.view.settleInspection();this.physics.setSpeed(speed);this.sync(true);this.view.render();await this.view.settleInspection();return this.diagnostics;
  }
  async inspectHeadlights(lamp:-1|0|1|2){
    if(!import.meta.env.DEV)return;
    this.pause();await this.view.settleInspection();this.visual.inspectHeadlights(lamp);this.view.render();await this.view.settleInspection();
  }
  async inspectCamera(eye: [number,number,number],target: [number,number,number]) {
    if(!import.meta.env.DEV)return;
    if(![...eye,...target].every(Number.isFinite))throw new Error('Non-finite inspection camera.');
    this.pause();await this.view.settleInspection();this.sync(true);
    const point=(p:[number,number,number])=>[this.pose.x-this.origin.x+Math.cos(this.pose.heading)*p[0]+Math.sin(this.pose.heading)*p[2],this.pose.y+p[1],this.pose.z-this.origin.z-Math.sin(this.pose.heading)*p[0]+Math.cos(this.pose.heading)*p[2]] as const;
    this.view.camera.position.set(...point(eye));this.view.camera.lookAt(...point(target));this.stream.updateVisibility(this.physics.z,this.physics.x,this.view.camera,this.visual.group.rotation.y);this.view.render();await this.view.settleInspection();return this.diagnostics;
  }
  async inspectFrame() {
    if (!import.meta.env.DEV) return '';
    this.pause(); await this.view.settleInspection();this.stream.updateVisibility(this.physics.z,this.physics.x,this.view.camera,this.visual.group.rotation.y); this.view.render();
    // Capture synchronously before a non-preserved default buffer is discarded.
    // This also distinguishes correct GL pixels from an automation compositor failure.
    const image=this.view.renderer.domElement.toDataURL('image/png');
    await this.view.settleInspection(); return image;
  }
  async inspectDistance(z: number) {
    if (!import.meta.env.DEV) return;
    if (!Number.isFinite(z)) throw new Error(`Non-finite inspection distance: ${z}`);
    this.pause(); await this.view.settleInspection(); this.physics.placeOnRoad(z);this.stream.resume();
    this.stream.tick(this.physics.z, this.physics.x);
    const started = performance.now();
    while (!this.stream.ready) {
      if (this.disposed) throw new Error('The graphics inspection was interrupted.');
      if (performance.now() - started > 20000) throw new Error(`Streaming inspection timed out: ${JSON.stringify(this.stream.stats)}`);
      this.stream.tick(this.physics.z, this.physics.x); await new Promise(resolve => setTimeout(resolve, 0));
    }
    this.sync(true);this.stream.updateVisibility(this.physics.z,this.physics.x,this.view.camera,this.visual.group.rotation.y); this.view.render();
    await this.view.settleInspection();
    this.stream.suspend();return this.diagnostics;
  }
  async inspectPosition(x:number,z:number){
    if(!import.meta.env.DEV)return;
    if(!Number.isFinite(x)||!Number.isFinite(z))throw new Error('Invalid inspection position.');
    await this.inspectDistance(z);this.physics.x=x;this.physics.z=z;this.physics.y=surfaceHeight(x,z,this.physics.seed);this.physics.setSpeed(0);this.sync(true);
    this.stream.updateVisibility(z,x,this.view.camera,this.visual.group.rotation.y);this.view.render();await this.view.settleInspection();return this.diagnostics;
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    // One damaged subsystem must not prevent release of the worker, audio or WebGL context.
    for (const release of [() => this.pause(), () => cancelAnimationFrame(this.viewportFrame), () => this.canvasSize?.disconnect(), () => this.events.abort(), () => this.input.dispose(), () => this.audio?.dispose(), () => this.stream.dispose(), () => this.visual.dispose(), () => this.view.dispose()]) {
      try { release(); } catch { /* Retry remains available after partial initialization/context loss. */ }
    }
  }
}
