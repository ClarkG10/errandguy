import { runPool } from '../asyncPool';

const flush = (ms = 10) => new Promise((r) => setTimeout(r, ms));

describe('runPool', () => {
  it('never exceeds the concurrency limit, runs every task, preserves start order', async () => {
    let active = 0;
    let peak = 0;
    const startOrder: number[] = [];

    const make = (id: number) => async () => {
      startOrder.push(id);
      active += 1;
      peak = Math.max(peak, active);
      await flush();
      active -= 1;
    };

    const tasks = Array.from({ length: 8 }, (_, i) => make(i));
    await runPool(tasks, 3);

    expect(peak).toBeLessThanOrEqual(3);
    // All eight ran.
    expect(startOrder.slice().sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    // First wave starts the highest-priority (front) tasks first.
    expect(startOrder.slice(0, 3)).toEqual([0, 1, 2]);
  });

  it('a rejecting task never rejects the pool, and the rest still run', async () => {
    const ran: number[] = [];
    const tasks = [
      async () => { ran.push(0); },
      async () => { ran.push(1); throw new Error('boom'); },
      async () => { ran.push(2); },
      async () => { ran.push(3); },
    ];

    await expect(runPool(tasks, 2)).resolves.toBeUndefined();
    expect(ran.sort((a, b) => a - b)).toEqual([0, 1, 2, 3]);
  });

  it('handles an empty task list and a limit larger than the task count', async () => {
    await expect(runPool([], 4)).resolves.toBeUndefined();

    const ran: number[] = [];
    await runPool([async () => { ran.push(1); }, async () => { ran.push(2); }], 10);
    expect(ran.sort((a, b) => a - b)).toEqual([1, 2]);
  });
});
