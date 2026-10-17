import {describe,it,expect} from 'vitest';
import {EngineSynth} from '../../src/audio/engine-synth';

describe('continuous combustion synthesis',()=>{
  it('retains six combined firings per crank revolution at idle and high revs',()=>{
    for(const rate of [44100,48000,96000])for(const rpm of [900,4500,9500]){
      const synth=new EngineSynth(rate),left=new Float32Array(rate),right=new Float32Array(rate);
      synth.render(left,right,rpm);const warm=synth.firingEvents;
      synth.render(left,right,rpm);
      expect(synth.firingEvents-warm).toBeCloseTo(rpm/10,0);
    }
  });
  it('survives RPM transitions and invalid inputs without clipping or DC drift',()=>{
    const synth=new EngineSynth(44100),left=new Float32Array(44100),right=new Float32Array(44100);
    for(const rpm of [900,9500,6000,4000,NaN]){
      synth.render(left,right,rpm);
      for(const channel of [left,right]){
        expect(channel.every(Number.isFinite)).toBe(true);
        expect(channel.every(value=>Math.abs(value)<.99)).toBe(true);
        expect(Math.abs(channel.subarray(22050).reduce((sum,v)=>sum+v,0)/22050)).toBeLessThan(.015);
      }
    }
  });
  it('preserves phase across worklet render-quantum boundaries',()=>{
    const whole=new EngineSynth(48000),chunks=new EngineSynth(48000);
    const a=new Float32Array(4096),b=new Float32Array(4096),c=new Float32Array(4096),d=new Float32Array(4096);
    whole.render(a,b,5000);
    for(let offset=0;offset<c.length;offset+=128)chunks.render(c.subarray(offset,offset+128),d.subarray(offset,offset+128),5000);
    expect(c).toEqual(a);expect(d).toEqual(b);
  });
  it('keeps engine strength through lift-off and shifts and returns smoothly to idle',()=>{
    const synth=new EngineSynth(48000),left=new Float32Array(48000),right=new Float32Array(48000);
    const level=()=>Math.sqrt(left.subarray(24000).reduce((sum,v)=>sum+v*v,0)/24000);
    synth.render(left,right,7000);const loaded=level();
    synth.render(left,right,7000);const coast=level();
    expect(coast).toBeGreaterThan(.002);expect(coast).toBeCloseTo(loaded,2);
    synth.render(left,right,7000);expect(level()).toBeCloseTo(loaded,2);
    for(let rpm=6500;rpm>=1000;rpm-=500){synth.render(left,right,rpm);expect(left.every(Number.isFinite)).toBe(true);}
    synth.render(left,right,900);const idle=level();
    synth.render(left,right,900);expect(level()).toBeCloseTo(idle,2);
  });
});
