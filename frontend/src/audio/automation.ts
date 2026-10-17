/** Keep automation bounded while retaining continuous parameter ramps. */
export function hold(param:AudioParam,time:number){
  if(typeof param.cancelAndHoldAtTime==='function')param.cancelAndHoldAtTime(time);
  else{const current=param.value;param.cancelScheduledValues(time);param.setValueAtTime(current,time);}
}
export function smooth(param:AudioParam,value:number,time:number,constant=.04){hold(param,time);param.setTargetAtTime(value,time,constant);}
export function fade(param:AudioParam,value:number,time:number){hold(param,time);param.linearRampToValueAtTime(value,time+.025);}
