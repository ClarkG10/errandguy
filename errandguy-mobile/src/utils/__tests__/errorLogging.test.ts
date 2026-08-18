jest.mock('../../services/api', () => ({
  __esModule: true,
  default: { post: jest.fn(() => Promise.resolve({ data: {} })) },
}));

import api from '../../services/api';
import { reportError } from '../errorLogging';

const post = api.post as jest.Mock;

describe('errorLogging.reportError → server forward', () => {
  beforeEach(() => {
    post.mockReset();
    post.mockResolvedValue({ data: {} });
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    (console.error as jest.Mock).mockRestore?.();
  });

  it('forwards a render error to /client-errors as a fatal crash', () => {
    reportError(new Error('boom'), 'at <Foo>');

    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith(
      '/client-errors',
      expect.objectContaining({
        message: expect.stringContaining('boom'),
        component_stack: 'at <Foo>',
        fatal: true,
      }),
      expect.objectContaining({ silent: true, noDedupe: true }),
    );
  });

  it('never throws even if the forward fails synchronously', () => {
    post.mockImplementation(() => {
      throw new Error('network layer not ready');
    });

    expect(() => reportError(new Error('boom2'))).not.toThrow();
  });
});
