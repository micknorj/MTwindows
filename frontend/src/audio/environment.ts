import {assetUrl} from '../assets';
import {regionAt,riverChannelAt,landscapeNoise} from '../world/road';
import type {VehiclePhysics} from '../vehicle/physics';
import {smooth} from './automation';
/** Fixed procedural habitat graph plus a redistribution-cleared insect recording. */
export class EnvironmentAudio {
  readonly ready:Promise<void>;
  private nodes:AudioNode[]=[];
  private sources:(AudioBufferSourceNode|OscillatorNode)[]=[];
  private air:GainNode;private leaves:GainNode;private insects:GainNode;private owl:GainNode;
  private owlPitch:OscillatorNode;
  private owlPan:StereoPannerNode;
  private cricketGain?:GainNode;private cricketPan?:StereoPannerNode;
  private request=new AbortController();private disposed=false;
  private recordingFrames=0;
  private streams:{gain:GainNode;pan:StereoPannerNode;offset:number}[]=[];
  constructor(private ctx:AudioContext,destination:AudioNode){
    const gain=(value=0)=>{const node=ctx.createGain();node.gain.value=value;node.connect(destination);this.nodes.push(node);return node;};
    const filter=(to:AudioNode,type:BiquadFilterType,frequency:number,q=.7)=>{const node=ctx.createBiquadFilter();node.type=type;node.frequency.value=frequency;node.Q.value=q;node.connect(to);this.nodes.push(node);return node;};
    const buffer=ctx.createBuffer(1,ctx.sampleRate*5,ctx.sampleRate),data=buffer.getChannelData(0);let seed=0x73aa921,brown=0;
    for(let i=0;i<data.length;i++){seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;const white=(seed>>>0)/2147483648-1;brown=(brown+.026*white)/1.026;data[i]=white*.6+brown*.45;}
    const noise=(to:AudioNode,phase=0)=>{const source=ctx.createBufferSource();source.buffer=buffer;source.loop=true;source.connect(to);source.start(0,phase);this.sources.push(source);};
    this.air=gain();noise(filter(this.air,'lowpass',280));
    this.leaves=gain();noise(filter(filter(this.leaves,'lowpass',3700),'highpass',850),1.73);
    for(const [index,offset] of [-60,0,60].entries()){
      const pan=ctx.createStereoPanner();pan.connect(destination);this.nodes.push(pan);
      const stream=ctx.createGain();stream.gain.value=0;stream.connect(pan);this.nodes.push(stream);
      noise(filter(stream,'bandpass',850+index*390,.55),index*1.11);this.streams.push({gain:stream,pan,offset});
    }
    this.insects=gain();const cricket=ctx.createOscillator();cricket.type='sine';cricket.frequency.value=4300;cricket.connect(this.insects);cricket.start();this.sources.push(cricket);
    this.owl=gain();const owlPan=this.owlPan=ctx.createStereoPanner();owlPan.pan.value=-.6;owlPan.connect(filter(this.owl,'lowpass',850));this.nodes.push(owlPan);
    this.owlPitch=ctx.createOscillator();this.owlPitch.type='triangle';this.owlPitch.frequency.value=410;this.owlPitch.connect(owlPan);this.owlPitch.start();this.sources.push(this.owlPitch);
    this.ready=this.loadRecording(destination).catch(()=>{/* Keep the original procedural fallback. */});
  }
  private async loadRecording(destination:AudioNode){
    const timeout=setTimeout(()=>this.request.abort(),8000);
    try{
      const response=await fetch(assetUrl('audio/night-crickets.mp3'),{signal:this.request.signal});
      if(!response.ok)throw new Error('Ambience unavailable');const bytes=await response.arrayBuffer();if(this.disposed)return;
      const buffer=await this.ctx.decodeAudioData(bytes);if(this.disposed)return;
      const pan=this.cricketPan=this.ctx.createStereoPanner();pan.connect(destination);
      const gain=this.cricketGain=this.ctx.createGain();gain.gain.value=0;gain.connect(pan);
      const filter=this.ctx.createBiquadFilter();filter.type='highpass';filter.frequency.value=170;filter.connect(gain);
      const source=this.ctx.createBufferSource();source.buffer=buffer;source.loop=true;source.connect(filter);source.start();
      this.nodes.push(pan,gain,filter);this.sources.push(source);this.recordingFrames=buffer.length;
    }finally{clearTimeout(timeout);}
  }
  update(car:VehiclePhysics,enclosure=0){
    const time=this.ctx.currentTime,speed=Math.abs(car.speed),forest=regionAt(car.z,car.seed).forest;
    const patch=landscapeNoise(car.x/180,car.z/300,car.seed+719);
    const gust=.55+.25*Math.sin(time*.37+patch*4)+.2*Math.sin(time*.83+1.7);
    const outdoor=1-enclosure*.92;
    const mask=outdoor/(1+speed*.025);
    smooth(this.air.gain,(.017*(1-forest*.5)*(.6+gust)+Math.min(.042,speed/1800))*outdoor,time,.7);
    smooth(this.leaves.gain,.015*forest*(.3+gust)*mask,time,.45);
    for(const stream of this.streams){
      const z=car.z+stream.offset,river=riverChannelAt(z,car.seed),dx=river.x-car.x,dz=z-car.z,dy=river.y-car.y;
      const distance=Math.hypot(dx,dz,dy);
      const attenuation=1/(1+(distance/28)**2);
      smooth(stream.gain.gain,.055*attenuation*(.8+.2*Math.sin(time*.73+stream.offset))*(.75+.25*mask)*outdoor,time,.4);
      smooth(stream.pan.pan,Math.max(-1,Math.min(1,(dx*Math.cos(car.heading)-dz*Math.sin(car.heading))/Math.max(20,distance))),time,.3);
    }
    const phase=(time+patch*7)%4.8;
    const chirp=phase<.33||phase>.7&&phase<.95?Math.sin(time*43)**2:0;
    smooth(this.insects.gain,this.cricketGain?0:.007*chirp*(.2+forest*.8)*mask,time,.008);
    if(this.cricketGain){
      smooth(this.cricketGain.gain,(.025+.07*forest)*(.8+.2*Math.sin(time*.12+patch))*mask,time,.7);
      smooth(this.cricketPan!.pan,Math.sin(patch*6.283-car.heading)*.35,time,.6);
    }
    const owlPhase=(time+patch*9)%47;
    const envelope=(start:number,length:number)=>{const t=(owlPhase-start)/length;return t>0&&t<1?Math.sin(t*Math.PI)**2:0;};
    const hoot=envelope(21,.65)+.75*envelope(22.3,1.15);
    smooth(this.owl.gain,.012*hoot*forest*mask,time,.025);
    smooth(this.owlPitch.frequency,410-45*Math.sin(owlPhase*1.3),time,.06);
    smooth(this.owlPan.pan,Math.sin(patch*6.283-car.heading)*.8,time,.4);
  }
  get nodeCount(){return this.nodes.length+this.sources.length;}
  get recording(){return {loaded:!!this.cricketGain&&!this.disposed,decodedBytes:this.recordingFrames*4};}
  dispose(){this.disposed=true;this.request.abort();for(const source of this.sources){try{source.stop();}catch{/* Stopped. */}source.disconnect();}for(const node of this.nodes)node.disconnect();this.sources=[];this.nodes=[];this.cricketGain=undefined;this.cricketPan=undefined;this.recordingFrames=0;}
}
