import {createServer} from 'vite';
import {mkdir,writeFile} from 'node:fs/promises';
// CPU/geometry-only diagnostic; GPU-intensive scripts must run separately.
const server=await createServer({configFile:'frontend/vite.config.ts',mode:'test',server:{hmr:false}});
try{
  const {roadAt,planRoad,naturalHeight,riverAt,bridgeAt,tunnelPlan,viaductsIn}=await server.ssrLoadModule('/src/world/road.ts');
  const counts={},poses={},tunnels=[],viaducts=[];let flowing=0;
  for(let i=0;i<400;i++){const p=planRoad(i,1942);if(p.bend)flowing++;const tunnel=tunnelPlan(i,1942);if(tunnel)tunnels.push(tunnel);viaducts.push(...viaductsIn(i,1942));counts[p.style]=(counts[p.style]??0)+1;poses[p.style]??=i*6000+3000;}
  let maxGrade=0,minRadius=Infinity,maxEarthworks=0,minY=Infinity,maxY=-Infinity,maxAboveRiver=0,fast=0,samples=0,maxVerticalAcceleration=0;
  const crossings=new Map();
  for(let z=-24000;z<144000;z+=25){
    const p=roadAt(z,1942),r=riverAt(z,1942),radius=1/Math.max(1e-12,Math.abs(p.curvature));samples++;
    maxGrade=Math.max(maxGrade,Math.abs(p.grade));minRadius=Math.min(minRadius,radius);maxEarthworks=Math.max(maxEarthworks,Math.abs(p.y-naturalHeight(p.x,z,1942)));
    minY=Math.min(minY,p.y);maxY=Math.max(maxY,p.y);maxAboveRiver=Math.max(maxAboveRiver,p.y-r.y);if(radius>=900)fast++;
    const second=roadAt(z+1,1942).y-2*p.y+roadAt(z-1,1942).y;maxVerticalAcceleration=Math.max(maxVerticalAcceleration,Math.abs(second)*(350/3.6)**2);
    if(Number.isFinite(r.distance))crossings.set(r.crossing,bridgeAt(r.crossing,1942));
  }
  const result={seed:1942,compositionKm:2400,counts,flowingPlans:flowing,tunnels:tunnels.length,viaducts:new Set(viaducts.map(v=>`${v.start}:${v.end}`)).size,viaductExamples:viaducts.slice(0,6),firstTunnel:tunnels[0],poses,sampledKm:168,stepMetres:25,maxGrade,minRadius,maxEarthworks,elevationRange:[minY,maxY],maxAboveRiver,highwayFraction:fast/samples,maxVerticalAccelerationAt350Kmh:maxVerticalAcceleration,bridges:crossings.size,bridgeSpans:[...crossings.values()].map(b=>b.span),caveat:'Seeded numerical scan and composition labels, not a civil-engineering certification or full hydrological/hairpin solver.'};
  await mkdir('test-results',{recursive:true});await writeFile('test-results/route-quality.json',JSON.stringify(result,null,2));console.log(result);
}finally{await server.close();}
