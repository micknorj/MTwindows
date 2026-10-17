export interface PlantCluster { indices:Uint16Array; x:number;y:number;z:number;radius:number; }
/** Built once on upload. Coherent cells let culling reject many plants together. */
export function plantClusters(values:Float32Array):PlantCluster[]{
  const cells=new Map<string,number[]>();
  for(let i=0;i<values.length;i+=7){const key=`${Math.floor(values[i]/80)}:${Math.floor(values[i+2]/50)}`;const cell=cells.get(key);if(cell)cell.push(i/7);else cells.set(key,[i/7]);}
  const clusters:PlantCluster[]=[];
  for(const indices of cells.values()){
    let x0=Infinity,y0=Infinity,z0=Infinity,x1=-Infinity,y1=-Infinity,z1=-Infinity;
    for(const index of indices){const i=index*7,w=values[i+3]*.75,d=values[i+5]*.75;x0=Math.min(x0,values[i]-w);x1=Math.max(x1,values[i]+w);y0=Math.min(y0,values[i+1]);y1=Math.max(y1,values[i+1]+values[i+4]);z0=Math.min(z0,values[i+2]-d);z1=Math.max(z1,values[i+2]+d);}
    clusters.push({indices:Uint16Array.from(indices),x:(x0+x1)/2,y:(y0+y1)/2,z:(z0+z1)/2,radius:Math.hypot(x1-x0,y1-y0,z1-z0)/2});
  }
  return clusters;
}
