import {engineLoadLevel} from './overrun';
const clamp=(value:number,min:number,max:number)=>Number.isFinite(value)?Math.max(min,Math.min(max,value)):min;

/** Broad exhaust radiation mode, not an RPM-following oscillator. */
class Radiation {
  private z1=0;private z2=0;private b0:number;private b2:number;private a1:number;private a2:number;
  constructor(rate:number,hz:number,q:number){
    const w=2*Math.PI*hz/rate,alpha=Math.sin(w)/(2*q),scale=1/(1+alpha);
    this.b0=alpha*scale;this.b2=-this.b0;this.a1=-2*Math.cos(w)*scale;this.a2=(1-alpha)*scale;
  }
  tick(input:number){
    const output=this.b0*input+this.z1;
    this.z1=-this.a1*output+this.z2;this.z2=this.b2*input-this.a2*output;
    return output;
  }
}

/** Procedurally generated gas-pressure release for one cylinder. */
class Combustion {
  lastPhase:number;private expansion=0;private attack=0;private rebound=0;private charge=0;private delay=0;
  private expansionDecay:number;private attackDecay:number;private reboundDecay:number;
  constructor(rate:number,readonly bank:number,readonly offset:number){
    this.lastPhase=(1-offset)%1;
    this.expansionDecay=Math.exp(-1/(rate*.00046));this.attackDecay=Math.exp(-1/(rate*.000045));
    this.reboundDecay=Math.exp(-1/(rate*.0026));
  }
  ignite(random:number,rate:number){
    // Small pressure/arrival differences broaden actual combustion orders;
    // timing noise never changes drivetrain RPM or the firing-event count.
    this.charge=2*(1+random*.12);
    this.delay=Math.round((random+1)*rate*.000035);
  }
  tick(noise:number){
    if(this.delay>0){if(--this.delay===0){this.expansion=this.attack=this.rebound=this.charge;this.charge=0;}}
    else if(this.charge){this.expansion=this.attack=this.rebound=this.charge;this.charge=0;}
    const pressure=this.expansion-this.attack-this.rebound*.12;
    this.expansion*=this.expansionDecay;this.attack*=this.attackDecay;
    this.rebound*=this.reboundDecay;
    // Turbulence exists only inside a pressure release, not as a wind bed.
    return pressure*(1+noise*.025);
  }
}

class ExhaustRadiator {
  private modes:Radiation[];private low=0;private previous=0;private dc=0;
  constructor(rate:number,offset:number){
    // Broad 180/390/650 Hz body/bark, calibrated from the supplied Automann
    // recording's low/mid envelope. No waveform or recording data is embedded.
    this.modes=[new Radiation(rate,180+offset,.7),new Radiation(rate,390+offset,.65),new Radiation(rate,650+offset,.6)];
  }
  tick(pressure:number,cutoff:number,dcDecay:number){
    const body=this.modes[0].tick(pressure),throat=this.modes[1].tick(pressure),bark=this.modes[2].tick(pressure);
    const raw=body*.55+throat*.9+bark*.8+pressure*.18;
    this.low+=(raw-this.low)*cutoff;
    this.dc=this.low-this.previous+dcDecay*this.dc;this.previous=this.low;
    return this.dc;
  }
}

/** Reference-calibrated combustion pulses and exhaust radiation. Entirely
 * procedural: no recordings, periodic waves, pitched electric voices or pipes.
 * Twelve cylinders fire in order 1-7-4-10-2-8-6-12-3-9-5-11 (six/crank rev).
 * Fixed buffers/state only; no allocation inside the worklet sample loop. */
export class EngineSynth {
  private phase=0;private time=0;private rpm=900;
  private random=0x138fa9;private cylinders:Combustion[];private exhausts:ExhaustRadiator[];
  private smooth:number;private dcDecay:number;private cutoff:number;
  private outputDecay:number;private previousLeft=0;private previousRight=0;private dcLeft=0;private dcRight=0;
  firingEvents=0;
  constructor(private rate:number){
    const order=[1,7,4,10,2,8,6,12,3,9,5,11];
    this.cylinders=order.map((number,index)=>new Combustion(rate,number>6?1:0,index/12));
    this.exhausts=[new ExhaustRadiator(rate,0),new ExhaustRadiator(rate,25)];
    this.smooth=1-Math.exp(-1/(rate*.025));
    this.dcDecay=Math.exp(-2*Math.PI*22/rate);this.outputDecay=Math.exp(-2*Math.PI*8/rate);
    this.cutoff=1-Math.exp(-2*Math.PI*3400/rate);
  }
  render(left:Float32Array,right:Float32Array,rpm:number,load=1){
    const targetRpm=clamp(rpm,650,10000);
    // The accepted acceleration profile and firing strength remain constant.
    // Actual drivetrain RPM supplies idle, lift-off and gear-shift progression.
    for(let i=0;i<left.length;i++){
      this.rpm+=(targetRpm-this.rpm)*this.smooth;
      const idle=Math.max(0,1-this.rpm/2300),variation=1+idle*(.008*Math.sin(this.time*7.3)+.004*Math.sin(this.time*13.7));
      this.phase=(this.phase+this.rpm*variation/(120*this.rate))%1;this.time+=1/this.rate;
      this.random^=this.random<<13;this.random^=this.random>>>17;this.random^=this.random<<5;
      const noise=(this.random>>>0)/2147483648-1;
      let a=0,b=0;
      for(const cylinder of this.cylinders){
        const phase=(this.phase-cylinder.offset+1)%1;
        if(phase<cylinder.lastPhase){this.firingEvents++;cylinder.ignite(noise,this.rate);}
        cylinder.lastPhase=phase;
        const pulse=cylinder.tick(noise);
        if(cylinder.bank===0)a+=pulse;else b+=pulse;
      }
      const pressureA=this.exhausts[0].tick(a,this.cutoff,this.dcDecay);
      const pressureB=this.exhausts[1].tick(b,this.cutoff,this.dcDecay)*.7;
      const gain=3*engineLoadLevel(this.rpm,load);
      const l=(pressureA*.75+pressureB*.25)*gain,r=(pressureA*.25+pressureB*.75)*gain;
      const clippedLeft=l/(1+Math.abs(l)),clippedRight=r/(1+Math.abs(r));
      this.dcLeft=clippedLeft-this.previousLeft+this.outputDecay*this.dcLeft;
      this.dcRight=clippedRight-this.previousRight+this.outputDecay*this.dcRight;
      this.previousLeft=clippedLeft;this.previousRight=clippedRight;
      left[i]=this.dcLeft;right[i]=this.dcRight;
    }
  }
}
