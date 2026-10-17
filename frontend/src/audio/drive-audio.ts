import type { VehiclePhysics } from '../vehicle/physics';
import { EnvironmentAudio } from './environment';
import { EngineVoice } from './engine-voice';
import { engineAudioRpm } from './audio-rpm';
import { idleEngineLevel } from './idle-level';
import {smooth,fade} from './automation';

export interface Volumes { master: number; engine: number; environment: number; }
export const DEFAULT_VOLUMES:Readonly<Volumes>={master:.7,engine:.7,environment:.65};
/** Fixed reusable synthesis graph. No nodes are allocated during driving or impacts. */
export class DriveAudio {
  readonly ready:Promise<void>;
  private context?: AudioContext;
  private master?: GainNode; private engineBus?: GainNode; private environmentBus?: GainNode;
  private voice?:EngineVoice;
  private voiceLevel?:GainNode;
  private tunnelWet?:GainNode;private enclosure=0;
  private engineActivated=false;
  private tire?: GainNode; private tireFilter?: BiquadFilterNode;
  private nature?:EnvironmentAudio;
  private impact?: GainNode; private impactFilter?: BiquadFilterNode;
  private nodes: AudioNode[] = []; private sources: AudioBufferSourceNode[] = [];
  private volumes: Volumes = { ...DEFAULT_VOLUMES };
  private timer?: ReturnType<typeof setTimeout>;
  private generation = 0; private running = false; private disposed = false; private lastImpact = 0;
  private events=new AbortController();
  constructor(onUnavailable:()=>void=()=>{}) {
    try {
      const ctx = this.context = new AudioContext({ latencyHint: 'interactive' });
      ctx.addEventListener('statechange',()=>{if(ctx.state==='closed'&&!this.disposed){this.dispose();onUnavailable();}},{signal:this.events.signal});
      const gain = (destination: AudioNode, value = 0) => { const node = ctx.createGain(); node.gain.value = value; node.connect(destination); this.nodes.push(node); return node; };
      const limiter = ctx.createDynamicsCompressor(); limiter.threshold.value = -14; limiter.knee.value = 12; limiter.ratio.value = 5; limiter.attack.value = .004; limiter.release.value = .12;
      this.nodes.push(limiter);
      // Master is downstream of compression, so it scales the complete audible
      // output rather than changing the compressor's threshold response.
      this.master = gain(ctx.destination);limiter.connect(this.master);
      this.engineBus = gain(limiter, this.volumes.engine); this.environmentBus = gain(limiter, this.volumes.environment);
      this.voiceLevel=gain(this.engineBus,0);
      const filter = (destination: AudioNode, type: BiquadFilterType, frequency: number, q = .7) => { const node = ctx.createBiquadFilter(); node.type = type; node.frequency.value = frequency; node.Q.value = q; node.connect(destination); this.nodes.push(node); return node; };
      const echo=ctx.createConvolver(),low=ctx.createBiquadFilter();low.type='lowpass';low.frequency.value=2200;
      const impulse=ctx.createBuffer(2,Math.ceil(ctx.sampleRate*.48),ctx.sampleRate);
      for(let ch=0;ch<2;ch++){const data=impulse.getChannelData(ch);for(const [index,delay] of [.035,.079,.123,.197,.289,.397].entries()){
        const at=Math.round((delay+ch*.003)*ctx.sampleRate);data[at]=(.32-index*.036)*(index%2?-1:1);
      }}
      echo.buffer=impulse;this.tunnelWet=gain(this.engineBus,0);this.voiceLevel.connect(low);low.connect(echo);echo.connect(this.tunnelWet);this.nodes.push(echo,low);
      const noise = ctx.createBuffer(1, ctx.sampleRate * 3, ctx.sampleRate), samples = noise.getChannelData(0);
      let state = 0x138fa9, brown = 0;
      for (let i = 0; i < samples.length; i++) { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; const white = (state >>> 0) / 2147483648 - 1; brown = (brown + white * .04) / 1.02; samples[i] = white * .45 + brown * .8; }
      const source = ctx.createBufferSource(); source.buffer = noise; source.loop = true;
      this.tire = gain(this.engineBus); this.tireFilter = filter(this.tire, 'bandpass', 650, .8); source.connect(this.tireFilter);
      this.nature=new EnvironmentAudio(ctx,this.environmentBus);
      this.impact = gain(this.engineBus); this.impactFilter = filter(this.impact, 'bandpass', 500, 1); source.connect(this.impactFilter);
      this.sources.push(source);source.start();
      const voiceReady=EngineVoice.create(ctx,this.voiceLevel,true,this.events.signal).then(voice=>{
        if(this.disposed){voice.dispose();return;}this.voice=voice;
        voice.node.addEventListener('processorerror',()=>{this.dispose();onUnavailable();},{once:true});
      });
      this.ready=Promise.all([voiceReady,this.nature.ready]).then(()=>{}).catch(()=>{this.dispose();onUnavailable();});
      // Unlock during the Drive gesture, while the muted world is loading.
      void ctx.resume().catch(() => {});
    } catch { this.dispose();this.ready=Promise.resolve(); }
  }
  setVolumes(volumes: Volumes) {
    const level=(value:number)=>Number.isFinite(value)?Math.max(0,Math.min(1,value)):0;
    this.volumes = {master:level(volumes.master),engine:level(volumes.engine),environment:level(volumes.environment)};
    if (!this.context) return;
    const time = this.context.currentTime;
    if (this.engineBus) fade(this.engineBus.gain, this.volumes.engine, time);
    if (this.environmentBus) fade(this.environmentBus.gain, this.volumes.environment, time);
    if (this.master && this.running) fade(this.master.gain, this.volumes.master, time);
  }
  resume() {
    if (!this.context || this.disposed) return;
    clearTimeout(this.timer); this.running = true; const generation = ++this.generation;
    void this.context.resume().then(() => { if (this.running && generation === this.generation && this.master && this.context) fade(this.master.gain, this.volumes.master, this.context.currentTime); }).catch(() => {});
  }
  pause() {
    this.running = false; this.generation++; clearTimeout(this.timer);
    if (!this.context || !this.master || this.disposed) return;
    fade(this.master.gain, 0, this.context.currentTime);
    this.timer = setTimeout(() => { if (!this.running && this.context?.state !== 'closed') void this.context?.suspend().catch(() => {}); }, 45);
  }
  update(car: VehiclePhysics,enclosure=0) {
    const ctx = this.context; if (!ctx || !this.running || this.disposed) return;
    const time = ctx.currentTime, rpm = car.drivetrain.rpm, speed = Math.abs(car.speed);
    if(Math.hypot(car.speed,car.lateralSpeed)>.15)this.engineActivated=true;
    this.voice?.update(engineAudioRpm(rpm),time,car.drivetrain.load,car.drivetrain.shifting>0);
    smooth(this.voiceLevel!.gain,this.engineActivated?idleEngineLevel(speed):0,time,.18);
    smooth(this.tire!.gain, Math.min(.18, speed / 500 + car.slip * .075) * (car.offRoad ? 1.5 : 1), time);
    smooth(this.tireFilter!.frequency, car.offRoad ? 1100 : 500 + car.slip * 2500, time);
    this.enclosure=Math.max(0,Math.min(1,enclosure));smooth(this.tunnelWet!.gain,this.enclosure*.32,time,.25);
    this.nature?.update(car,this.enclosure);
    if (car.impacts !== this.lastImpact) {
      this.lastImpact = car.impacts; this.impactFilter!.frequency.value = car.impactMaterial === 'metal' ? 1800 : car.impactMaterial === 'wood' ? 230 : 550;
      const param = this.impact!.gain; param.cancelScheduledValues(time); param.setValueAtTime(Math.min(.5, car.impactStrength / 45), time); param.exponentialRampToValueAtTime(.0001, time + .25);
    }
  }
  get diagnostics() { return { available: !!this.voice && !this.disposed, state: this.context?.state ?? 'unavailable', running: this.running,tunnelEnclosure:this.enclosure,engineActivated:this.engineActivated,voice:this.voice?.diagnostics,nature:this.nature?.recording, nodes: this.nodes.length + this.sources.length+(this.voice?.nodeCount??0)+(this.nature?.nodeCount??0), volumes: { ...this.volumes } }; }
  dispose() {
    this.disposed = true; this.running = false; this.generation++; clearTimeout(this.timer);this.events.abort();
    this.voice?.dispose();this.voice=undefined;
    this.nature?.dispose();this.nature=undefined;
    this.sources.forEach(source => { try { source.stop(); } catch { /* Already stopped. */ } source.disconnect(); });
    this.nodes.forEach(node => node.disconnect()); this.sources = []; this.nodes = [];
    if (this.context && this.context.state !== 'closed') void this.context.close().catch(() => {});
  }
}
