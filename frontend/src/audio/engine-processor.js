import {EngineSynth} from './engine-synth.ts';

class V12Processor extends AudioWorkletProcessor {
  static get parameterDescriptors(){return [
    {name:'rpm',defaultValue:900,minValue:650,maxValue:10000,automationRate:'k-rate'},
    {name:'load',defaultValue:1,minValue:0,maxValue:1,automationRate:'k-rate'},
  ];}
  constructor(){super();this.synth=new EngineSynth(sampleRate);}
  process(_inputs,outputs,parameters){
    const output=outputs[0];
    if(output?.length===2)this.synth.render(output[0],output[1],parameters.rpm[0],parameters.load[0]);
    return true;
  }
}
registerProcessor('rimmile-v12',V12Processor);
