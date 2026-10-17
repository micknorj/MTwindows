/** Persistent distance only; preferences have a separate validated owner. No positions or identifiers. */
export const DISTANCE_KEY='rimmile.distance.metres';
export class DrivingDistance {
 private metres=0;private dirty=false;private lastSave=0;
 constructor(private storage?:Pick<Storage,'getItem'|'setItem'>){
  try{const raw=storage?.getItem(DISTANCE_KEY);const value=raw===null||raw===undefined?0:Number(raw);
   if(Number.isFinite(value)&&value>=0&&value<=1e12)this.metres=value;
  }catch{/* Restricted storage falls back to an in-memory total. */}
 }
 get kilometres(){return this.metres/1000;}
 add(metres:number){if(!Number.isFinite(metres)||metres<=0||metres>1000)return;
  this.metres=Math.min(1e12,this.metres+metres);this.dirty=true;
  if(Date.now()-this.lastSave>=10000)this.flush();
 }
 flush(){if(!this.dirty)return;try{this.storage?.setItem(DISTANCE_KEY,String(this.metres));this.dirty=false;this.lastSave=Date.now();}catch{this.lastSave=Date.now();}}
}
export function browserDistance(){let storage:Storage|undefined;try{storage=window.localStorage;}catch{/* Browser privacy policy. */}return new DrivingDistance(storage);}
