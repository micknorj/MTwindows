import {ControlBindings,migrateLegacyBindings,type BindingMap} from '../input/bindings';
import {DEFAULT_VOLUMES,type Volumes} from '../audio/drive-audio';
import {DEFAULT_HANDLING,type Handling} from '../vehicle/handling';
import {DEFAULT_GRAPHICS,legacyGraphics,validateGraphics,type Graphics} from '../rendering/graphics';

import type {TransmissionMode} from '../vehicle/drivetrain';

export const PREFERENCES_KEY='rimmile.preferences.v1';
export interface Preferences {transmission:TransmissionMode;graphics:Graphics;volumes:Volumes;handling:Handling;bindings:BindingMap;lights:boolean;fullscreen:boolean;}
export function defaultPreferences():Preferences {return {transmission:'Automatic',graphics:{...DEFAULT_GRAPHICS},volumes:{...DEFAULT_VOLUMES},handling:{...DEFAULT_HANDLING},bindings:new ControlBindings().snapshot(),lights:true,fullscreen:false};}
const object=(value:unknown):value is Record<string,unknown>=>typeof value==='object'&&value!==null&&!Array.isArray(value);
function validated(value:unknown):Preferences {
 const result=defaultPreferences();if(!object(value)||(value.version!==1&&value.version!==2&&value.version!==3))return result;
 result.graphics=validateGraphics(value.graphics,value.version===1&&['Auto','Low','Medium','High'].includes(value.quality as string)?legacyGraphics(value.quality):result.graphics);
 for(const group of ['volumes','handling'] as const){const fields=value[group];if(!object(fields))continue;
  for(const key of Object.keys(result[group])){const v=fields[key];if(typeof v==='number'&&Number.isFinite(v)&&v>=(group==='volumes'?0:-1)&&v<=1)(result[group] as unknown as Record<string,number>)[key]=v;}
 }
 const bindings=new ControlBindings();
 if(value.version===3){if(bindings.restore(value.bindings))result.bindings=bindings.snapshot();}
 else result.bindings=migrateLegacyBindings(value.bindings)??result.bindings;
 if(value.transmission==='Automatic'||value.transmission==='Manual')result.transmission=value.transmission;
 for(const key of ['lights','fullscreen'] as const)if(typeof value[key]==='boolean')result[key]=value[key];
 return result;
}
/** Only explicit preferences, never world position, identifiers or telemetry. */
export class PreferenceStore {
 constructor(private storage?:Pick<Storage,'getItem'|'setItem'>){}
 load(){try{const raw=this.storage?.getItem(PREFERENCES_KEY);return raw&&raw.length<=8192?validated(JSON.parse(raw)):defaultPreferences();}catch{return defaultPreferences();}}
 save(value:Preferences){try{this.storage?.setItem(PREFERENCES_KEY,JSON.stringify({version:3,...validated({version:3,...value})}));}catch{/* Blocked/quota-limited storage leaves current preferences usable in memory. */}}
}
export function browserPreferences(){let storage:Storage|undefined;try{storage=window.localStorage;}catch{/* Browser privacy policy. */}return new PreferenceStore(storage);}
