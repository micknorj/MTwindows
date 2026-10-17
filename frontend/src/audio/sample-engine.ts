import {prepareLoop} from './loop-buffer';
import {engineLoadLevel} from './overrun';
import {smooth} from './automation';
import {assetUrl} from '../assets';
import {ENGINE_ASSET,unpackEngine} from './sample-pack';
const IDS=['on-low','on-high','off-low','off-high'] as const;
type Layer={id:typeof IDS[number];rpm:number;source:AudioBufferSourceNode;gain:GainNode};
/** RPM/load-layer approach adapted from markeasting/engine-audio (MIT, Mark Oosting).
 * Owner confirmed separate game-use recording permission on 2026-10-15. */
export class SampleEngine {
  private layers:Layer[]=[];
  private constructor(readonly node:GainNode){}
  static async load(context:BaseAudioContext,destination:AudioNode,signal:AbortSignal){
    const response=await fetch(assetUrl(ENGINE_ASSET),{signal,credentials:'omit'});
    if(!response.ok)throw new Error('Engine resource unavailable');
    const banks=await unpackEngine(new Uint8Array(await response.arrayBuffer()));
    const decoded=await Promise.all(banks.map(async entry=>{
      const buffer=await context.decodeAudioData(entry.bytes);
      if(buffer.duration>15||buffer.numberOfChannels!==2)throw new Error('Unexpected engine audio');
      const channels=prepareLoop(Array.from({length:buffer.numberOfChannels},(_,channel)=>buffer.getChannelData(channel)),buffer.sampleRate);
      const loop=context.createBuffer(channels.length,channels[0].length,buffer.sampleRate);
      channels.forEach((data,channel)=>loop.copyToChannel(data,channel));
      return {...entry,buffer:loop};
    }));
    if(signal.aborted||context.state==='closed')return;
    const output=context.createGain();output.gain.value=.9;output.connect(destination);
    const engine=new SampleEngine(output);
    try{
      for(const entry of decoded){
        const source=context.createBufferSource(),gain=context.createGain();
        source.buffer=entry.buffer;source.loop=true;gain.gain.value=0;
        source.connect(gain);gain.connect(output);source.start();
        engine.layers.push({id:entry.id,rpm:entry.rpm,source,gain});
      }
      return engine;
    }catch(error){engine.dispose();throw error;}
  }
  update(rpm:number,load:number,time:number){
    smooth(this.node.gain,.9*engineLoadLevel(rpm,load),time,.06);
    const carrier=Math.max(1250,rpm*1.15);
    const mix=Math.max(0,Math.min(1,(carrier-5500)/2400)),power=Math.max(0,Math.min(1,load));
    const low=Math.cos(mix*Math.PI*.5),high=Math.sin(mix*Math.PI*.5);
    const on=Math.sin(power*Math.PI*.5),off=Math.cos(power*Math.PI*.5);
    for(const layer of this.layers){
      const volume=(layer.id.startsWith('on')?on:off)*(layer.id.endsWith('low')?low:high);
      smooth(layer.gain.gain,volume,time,.075);
      // All layers follow the same carrier. Linear cents-per-RPM offsets give
      // overlapping banks different firing pitches and sound like two engines.
      smooth(layer.source.playbackRate,Math.max(.14,Math.min(1.6,carrier/layer.rpm)),time,.045);
    }
  }
  get nodeCount(){return 1+this.layers.length*2;}
  get decodedBytes(){return this.layers.reduce((sum,layer)=>sum+(layer.source.buffer?.length??0)*(layer.source.buffer?.numberOfChannels??0)*4,0);}
  dispose(){for(const {source,gain} of this.layers){try{source.stop();}catch{/* Stopped. */}source.disconnect();gain.disconnect();}this.layers=[];this.node.disconnect();}
}
