/** Non-destructive in-memory loop preparation. Original accepted banks and their
 * hashes stay unchanged. A raised-cosine overlap joins waveform and derivative;
 * bounded circular envelope compensation removes slow recording-level pumping. */
export function prepareLoop(channels:readonly Float32Array[],sampleRate:number){
  const frames=channels[0].length,nominal=Math.min(Math.round(sampleRate*.08),Math.floor(frames/4));
  let overlap=nominal,best=-Infinity;
  // Align the overlap's firing waveform before blending. A fixed duration can
  // put the two engine pulses in opposite phase and create a periodic dip.
  const radius=Math.min(Math.round(sampleRate*.012),Math.floor(nominal/4));
  for(let size=nominal-radius;size<=nominal+radius;size+=4){
    let xx=0,yy=0,xy=0;
    for(const data of channels)for(let i=0;i<size;i+=24){const x=data[i],y=data[frames-size+i];xx+=x*x;yy+=y*y;xy+=x*y;}
    const correlation=xy/Math.sqrt(Math.max(1e-12,xx*yy));
    if(correlation>best){best=correlation;overlap=size;}
  }
  const length=frames-overlap;
  const output=channels.map(source=>{
    const data=source.slice(overlap);
    for(let i=0;i<overlap;i++){
      const weight=(1-Math.cos(Math.PI*(i+1)/overlap))*.5;
      data[length-overlap+i]=source[frames-overlap+i]*(1-weight)+source[i]*weight;
    }
    return data;
  });
  const blocks=Math.max(4,Math.round(length/(sampleRate*.12))),energy=new Float64Array(blocks),count=new Uint32Array(blocks);
  let sum=0;
  for(let i=0;i<length;i++){const block=Math.min(blocks-1,Math.floor(i*blocks/length));for(const data of output){const e=data[i]*data[i];energy[block]+=e;sum+=e;count[block]++;}}
  const rms=Math.sqrt(sum/(length*channels.length)),gain=Math.min(1.5,.12/Math.max(.001,rms)),envelope=new Float64Array(blocks);
  for(let b=0;b<blocks;b++){
    let local=0;for(let j=-2;j<=2;j++){const k=(b+j+blocks)%blocks;local+=energy[k]/Math.max(1,count[k])/5;}
    envelope[b]=Math.max(.8,Math.min(1.25,rms/Math.sqrt(Math.max(1e-8,local))));
  }
  for(let i=0;i<length;i++){
    const position=i*blocks/length-.5,b=Math.floor(position),t=position-b,weight=t*t*(3-2*t);
    const level=gain*(envelope[(b+blocks)%blocks]*(1-weight)+envelope[(b+1+blocks)%blocks]*weight);
    for(const data of output)data[i]*=level;
  }
  return output;
}
