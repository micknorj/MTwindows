import { expect, it, vi } from 'vitest';
import { FrameQueue } from '../../src/rendering/frame-queue';

it('bounds outstanding GPU work, releases completed frames and reports failed fences', () => {
  let signaled = false, failed = false;
  const gl = { WAIT_FAILED: 1, TIMEOUT_EXPIRED: 2, CONDITION_SATISFIED: 3, SYNC_GPU_COMMANDS_COMPLETE: 4,
    clientWaitSync: () => failed ? 1 : signaled ? 3 : 2,
    fenceSync: () => ({}), deleteSync: vi.fn(), flush: vi.fn(),
  } as unknown as WebGL2RenderingContext;
  const queue = new FrameQueue(gl);
  expect(queue.ready()).toBe(true); queue.submitted(); queue.submitted();
  for (let i = 0; i < 100; i++) expect(queue.ready()).toBe(false);
  expect(queue.pending).toBe(2);
  signaled = true; expect(queue.ready()).toBe(true); expect(queue.pending).toBe(0); expect(gl.deleteSync).toHaveBeenCalledTimes(2);
  queue.submitted(); failed = true; expect(() => queue.ready()).toThrow('graphics connection');
  queue.dispose(); expect(queue.pending).toBe(0); expect(gl.deleteSync).toHaveBeenCalledTimes(3);
});
