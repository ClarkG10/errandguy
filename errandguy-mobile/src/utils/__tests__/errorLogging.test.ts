jest.mock('../../services/api', () => ({
  __esModule: true,
  default: { post: jest.fn(() => Promise.resolve({ data: {} })) },
}));

jest.mock('../appVersion', () => ({ getAppVersionLabel: jest.fn(() => '1.0.0 · 3f2a9c1b') }));

import { Platform } from 'react-native';
import api from '../../services/api';
import { getAppVersionLabel } from '../appVersion';
import { reportError } from '../errorLogging';
import { useAuthStore } from '../../stores/authStore';

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

  it('says which build crashed: app version (with OTA bundle) and platform', () => {
    reportError(new Error('boom'));
    expect(post.mock.calls[0][1]).toEqual(
      expect.objectContaining({ app_version: '1.0.0 · 3f2a9c1b', platform: Platform.OS }),
    );
  });

  it('reports from signed-out screens too — no session is required', () => {
    useAuthStore.setState({ user: null, token: null, isAuthenticated: false });
    reportError(new Error('crash on the sign-up screen'));
    expect(post).toHaveBeenCalledWith(
      '/client-errors',
      expect.objectContaining({ message: expect.stringContaining('sign-up screen') }),
      expect.anything(),
    );
  });

  it('leaves app_version out (rather than sending junk) when the version is unreadable', () => {
    (getAppVersionLabel as jest.Mock).mockImplementationOnce(() => {
      throw new Error('no native module');
    });
    reportError(new Error('boom'));
    expect(post.mock.calls[0][1]).not.toHaveProperty('app_version');
    expect(post.mock.calls[0][1]).toHaveProperty('platform');
  });

  it('never throws even if the forward fails synchronously', () => {
    post.mockImplementation(() => {
      throw new Error('network layer not ready');
    });

    expect(() => reportError(new Error('boom2'))).not.toThrow();
  });
});
