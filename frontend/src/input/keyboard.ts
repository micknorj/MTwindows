import { ControlBindings } from './bindings';
export interface DriveInput { throttle: boolean; brake: boolean; steer: number; }
export class Keyboard {
  private held = new Set<string>();
  private controller = new AbortController();
  constructor(isRunning: () => boolean, recover: () => void, private bindings=new ControlBindings(),toggleLights:()=>void=()=>{},shift:(change:-1|1)=>void=()=>{},direction:()=>void=()=>{}) {
    window.addEventListener('keydown', event => {
      if (!isRunning() || !this.bindings.has(event.code) || event.altKey || event.ctrlKey || event.metaKey) return;
      event.preventDefault();
      if (event.repeat || this.held.has(event.code)) return;
      this.held.add(event.code);
      if (this.bindings.keys('recover').includes(event.code)) { recover(); return; }
      if (this.bindings.keys('lights').includes(event.code)) { toggleLights(); return; }
      if (this.bindings.keys('shiftUp').includes(event.code)) { shift(1); return; }
      if (this.bindings.keys('shiftDown').includes(event.code)) { shift(-1); return; }
      if (this.bindings.keys('direction').includes(event.code)) direction();
    }, { signal: this.controller.signal });
    window.addEventListener('keyup', event => this.held.delete(event.code), { signal: this.controller.signal });
    window.addEventListener('blur',()=>this.clear(),{signal:this.controller.signal});
  }
  read(): DriveInput {
    // +Y yaw rotates +Z forward towards +X: the driver's left in this model's
    // right-handed frame (the chase camera projects +X to the screen's left).
    return { throttle:this.bindings.matches('accelerate',this.held),brake:this.bindings.matches('brake',this.held),steer:Number(this.bindings.matches('left',this.held))-Number(this.bindings.matches('right',this.held)) };
  }
  clear() { this.held.clear(); }
  dispose() { this.clear(); this.controller.abort(); }
}
