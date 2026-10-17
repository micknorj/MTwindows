export const ACTIONS = ['accelerate','brake','left','right','shiftUp','shiftDown','direction','recover','lights'] as const;
export type DriveAction = typeof ACTIONS[number];
export type BindingMap=Record<DriveAction,string[]>;
export const isAssignableKey=(code:string)=>/^(Key[A-Z]|Digit[0-9]|Numpad[0-9]|Arrow(Up|Down|Left|Right)|Space)$/.test(code);
const DEFAULTS:Record<DriveAction,readonly string[]>={accelerate:['KeyW','ArrowUp'],brake:['KeyS','ArrowDown'],left:['KeyA','ArrowLeft'],right:['KeyD','ArrowRight'],shiftUp:['KeyQ'],shiftDown:['KeyE'],direction:['KeyR'],recover:['KeyT'],lights:['KeyL']};
export function keyLabel(code:string){return code.replace(/^Key/,'').replace(/^Digit/,'').replace(/^Arrow/,'Arrow ').replace(/^Numpad/,'Numpad ');}
export class ControlBindings {
  private values = this.defaults();
  private defaults(){return Object.fromEntries(ACTIONS.map(action=>[action,[...DEFAULTS[action]]])) as Record<DriveAction,string[]>;}
  keys(action:DriveAction):readonly string[]{return this.values[action];}
  matches(action:DriveAction,held:ReadonlySet<string>){return this.values[action].some(key=>held.has(key));}
  has(code:string){return ACTIONS.some(action=>this.values[action].includes(code));}
  assign(action:DriveAction,code:string):'assigned'|'duplicate'|'unsupported'{
    if(!isAssignableKey(code))return 'unsupported';
    if(ACTIONS.some(other=>other!==action&&this.values[other].includes(code)))return 'duplicate';
    this.values[action]=[code,...this.values[action].slice(1).filter(key=>key!==code)];return 'assigned';
  }
  snapshot():BindingMap{return Object.fromEntries(ACTIONS.map(action=>[action,[...this.values[action]]])) as BindingMap;}
  restore(value:unknown){
    if(typeof value!=='object'||value===null||Array.isArray(value))return false;
    const source=value as Record<string,unknown>,next={} as BindingMap,used=new Set<string>();
    for(const action of ACTIONS){const keys=source[action];if(!Array.isArray(keys)||keys.length<1||keys.length>2)return false;
      for(const key of keys){if(typeof key!=='string'||!isAssignableKey(key)||used.has(key))return false;used.add(key);}
      next[action]=[...keys];
    }
    this.values=next;return true;
  }
  reset(){this.values=this.defaults();}
}

/** Version 1/2 had six actions and R/E for recovery/lights. Reserve customized
 * keys first, then allocate new actions without stealing them or duplicating keys. */
export function migrateLegacyBindings(value: unknown): BindingMap | undefined {
  const complete = new ControlBindings();
  if (complete.restore(value)) return complete.snapshot();
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return;
  const oldActions = ['accelerate','brake','left','right','recover','lights'] as const;
  const oldDefaults = {...DEFAULTS,recover:['KeyR'],lights:['KeyE']};
  const source = value as Record<string, unknown>, used = new Set<string>();
  for (const action of oldActions) {
    const keys = source[action];
    if (!Array.isArray(keys) || keys.length < 1 || keys.length > 2) return;
    for (const key of keys) { if (typeof key !== 'string' || !isAssignableKey(key) || used.has(key)) return; used.add(key); }
  }
  used.clear();const next = {} as BindingMap;
  for (const action of oldActions) {
    const keys = source[action] as string[];
    if (keys.join(',') !== oldDefaults[action].join(',')) { next[action] = [...keys];keys.forEach(key => used.add(key)); }
  }
  const spare = ['KeyU','KeyJ','KeyV','KeyB','KeyG','KeyF','KeyH','KeyC','KeyZ','KeyX','KeyK',...Array.from({length:26},(_,i)=>`Key${String.fromCharCode(65+i)}`)];
  for (const action of ACTIONS) if (!next[action]) {
    const preferred = DEFAULTS[action].filter(key => !used.has(key));
    next[action] = preferred.length ? [...preferred] : [spare.find(key => !used.has(key))!];
    next[action].forEach(key => used.add(key));
  }
  return next;
}
