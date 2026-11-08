import { cancelAppliedAnyway } from '../cancelPreview';

/**
 * A cancel whose answer was lost (timeout, dropped connection, 5xx) may still
 * have been applied. The tracking screen used to say "Couldn't cancel" at once,
 * and kept treating the errand as one it had cancelled itself.
 */
describe('cancelAppliedAnyway', () => {
  const cancelled = jest.fn(async () => ({ status: 'cancelled' }));
  const stillOpen = jest.fn(async () => ({ status: 'pending' }));

  beforeEach(() => jest.clearAllMocks());

  it.each([
    ['a client timeout', { status: 0, kind: 'timeout' }],
    ['a dropped connection', { status: 0, kind: 'offline' }],
    ['a 5xx', { status: 502, kind: 'server' }],
  ])('after %s, asks the server — and believes it when it reads cancelled', async (_l, err) => {
    await expect(cancelAppliedAnyway(err, cancelled)).resolves.toBe(true);
    expect(cancelled).toHaveBeenCalledTimes(1);
  });

  it('is false when the re-read shows the errand still open', async () => {
    await expect(cancelAppliedAnyway({ status: 0, kind: 'timeout' }, stillOpen)).resolves.toBe(false);
  });

  it('is false when the re-read fails too — never a guess', async () => {
    const failing = jest.fn(async () => {
      throw { status: 0 };
    });
    await expect(cancelAppliedAnyway({ status: 504 }, failing)).resolves.toBe(false);
  });

  it('takes a 4xx at its word: no re-read', async () => {
    await expect(cancelAppliedAnyway({ status: 422, kind: 'validation' }, cancelled)).resolves.toBe(false);
    await expect(cancelAppliedAnyway({ status: 403, kind: 'forbidden' }, cancelled)).resolves.toBe(false);
    expect(cancelled).not.toHaveBeenCalled();
  });
});
