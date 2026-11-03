jest.mock('../../services/api', () => ({
  __esModule: true,
  default: { post: jest.fn(() => Promise.resolve({ data: {} })) },
}));

jest.mock('../appVersion', () => ({ getAppVersionLabel: jest.fn(() => '1.0.0 · 3f2a9c1b') }));

import { Platform } from 'react-native';
import api from '../../services/api';
import { getAppVersionLabel } from '../appVersion';
import { fitCrashReport, reportError } from '../errorLogging';
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

/**
 * The server refuses a report over its limits (message 1000 characters,
 * stacks 8000, body 24 KB), and the forward is fire-and-forget — so the
 * biggest crashes were the ones silently lost.
 */
describe('crash reports fit the server limits', () => {
  const bytes = (body: unknown) => Buffer.byteLength(JSON.stringify(body), 'utf8');

  beforeEach(() => {
    post.mockReset();
    post.mockResolvedValue({ data: {} });
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    (console.error as jest.Mock).mockRestore?.();
  });

  it('trims an oversized message, stack and component stack before sending', () => {
    const error = new Error('m'.repeat(5000));
    error.stack = 's'.repeat(50_000);
    reportError(error, 'c'.repeat(50_000));

    const body = post.mock.calls[0][1];
    expect(body.message.length).toBeLessThanOrEqual(1000);
    expect(body.stack.length).toBeLessThanOrEqual(8000);
    expect(body.component_stack.length).toBeLessThanOrEqual(8000);
    expect(bytes(body)).toBeLessThanOrEqual(24576);
    // The start of each is kept — that's the useful end of a stack.
    expect(body.stack.startsWith('sss')).toBe(true);
    expect(body.message.endsWith('…')).toBe(true);
  });

  it('stays under the 24 KB body cap even when every character is multi-byte', () => {
    const body = fitCrashReport({
      message: 'é'.repeat(1000),
      stack: '中'.repeat(8000),
      component_stack: '中'.repeat(8000),
      fatal: true,
    });
    expect(bytes(body)).toBeLessThanOrEqual(24576);
    expect(body.stack?.length).toBeGreaterThan(0);
  });

  it('never cuts an emoji in half', () => {
    const body = fitCrashReport({ message: '😀'.repeat(600), fatal: true });
    const last = body.message.charCodeAt(body.message.length - 2);
    expect(last >= 0xd800 && last <= 0xdbff).toBe(false);
    expect(() => decodeURIComponent(encodeURIComponent(body.message))).not.toThrow();
  });

  it('sends a report that already fits unchanged', () => {
    const report = { message: 'Error: boom', stack: 'at Foo', fatal: true };
    expect(fitCrashReport(report)).toEqual(report);
  });
});
