import processorUrl from './engine-processor.js?worker&url';
import type {SampleEngine} from './sample-engine';
/** Live builds always use the accepted sampled voice. The procedural worklet is
 * retained only for explicit offline comparisons, never as a silent live fallback. */
export class EngineVoice {
  private constructor(readonly node:AudioNode,private worklet?:AudioWorkletNode,private layers?:SampleEngine){}
  static async create(context:BaseAudioContext,destination:AudioNode,live=false,signal?:AbortSignal){
    if(live){
      const request=new AbortController(),abort=()=>request.abort();
      signal?.addEventListener('abort',abort,{once:true});const timeout=setTimeout(abort,30000);
      try{
        if(signal?.aborted)request.abort();
        const {SampleEngine}=await import('./sample-engine');
        const layers=await SampleEngine.load(context,destination,request.signal);
        if(!layers)throw new Error('Engine initialization cancelled');
        return new EngineVoice(layers.node,undefined,layers);
      }finally{clearTimeout(timeout);signal?.removeEventListener('abort',abort);}
    }
    if(signal?.aborted||context.state==='closed')throw new Error('Engine initialization cancelled');
    await context.audioWorklet.addModule(processorUrl);
    const node=new AudioWorkletNode(context,'rimmile-v12',{numberOfInputs:0,numberOfOutputs:1,outputChannelCount:[2]});
    node.connect(destination);return new EngineVoice(node,node);
  }
  update(rpm:number,time:number,load=1,shifting=false){
    const power=Math.max(0,Math.min(1,load))*(shifting ? .85 : 1);
    if(this.layers)this.layers.update(rpm,power,time);
    else if(this.worklet){this.worklet.parameters.get('rpm')!.setValueAtTime(rpm,time);this.worklet.parameters.get('load')!.setTargetAtTime(power,time,.06);}
  }
  get diagnostics(){return {kind:this.layers?'sampled':'procedural-offline',decodedBytes:this.layers?.decodedBytes??0};}
  get nodeCount(){return this.layers?this.layers.nodeCount:1;}
  dispose(){this.layers?.dispose();this.layers=undefined;this.node.disconnect();this.worklet?.port.close();}
}
