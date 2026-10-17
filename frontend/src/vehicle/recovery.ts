/** One recovery controller for exploration and flooded settling. Simulation time only. */
export class RoadRecovery {
 remaining=0;settling=0;
 reason:'exploration'|'water'|undefined;
 update(dt:number,edgeDistance:number,submerged=false){
  dt=Math.max(0,Number.isFinite(dt)?dt:0);
  if(submerged&&this.reason!=='water'){this.reason='water';this.settling=2;this.remaining=5;}
  if(!submerged&&edgeDistance<=300){this.reset();return false;}
  if(this.remaining===0){if(edgeDistance<=305&&!submerged)return false;this.remaining=5;this.reason=submerged?'water':'exploration';}
  if(this.settling>0){const used=Math.min(dt,this.settling);this.settling=Math.max(0,this.settling-used);dt-=used;if(this.settling<1e-7)this.settling=0;}
  this.remaining=Math.max(0,this.remaining-dt);if(this.remaining<1e-7)this.remaining=0;
  return this.remaining===0;
 }
 get seconds(){return this.settling>0?0:Math.max(0,Math.ceil(this.remaining-1e-8));}
 reset(){this.remaining=0;this.settling=0;this.reason=undefined;}
}
