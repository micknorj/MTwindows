/** WebGL2 fences bound submitted work without blocking physics, input or panel UI. */
export class FrameQueue {
  private fences: WebGLSync[] = [];
  constructor(private gl: WebGL2RenderingContext) {}
  ready() {
    while (this.fences.length) {
      const status = this.gl.clientWaitSync(this.fences[0], 0, 0);
      if (status === this.gl.WAIT_FAILED) throw new Error('The graphics connection was lost. Retry to start a new drive.');
      if (status === this.gl.TIMEOUT_EXPIRED) break;
      this.gl.deleteSync(this.fences.shift()!);
    }
    return this.fences.length < 2;
  }
  submitted() {
    const fence = this.gl.fenceSync(this.gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    if (!fence) throw new Error('Unable to queue the next graphics frame. Please retry.');
    this.fences.push(fence); this.gl.flush();
  }
  get pending() { return this.fences.length; }
  dispose() { for (const fence of this.fences) this.gl.deleteSync(fence); this.fences = []; }
}
