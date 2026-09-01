import { AccessibilityInfo, Platform } from 'react-native';
import { announceFieldError } from '../announceFieldError';

const announce = AccessibilityInfo.announceForAccessibility as unknown as jest.Mock;

const flush = () => new Promise<void>((resolve) => queueMicrotask(() => resolve()));

describe('announceFieldError', () => {
  beforeEach(() => announce.mockClear());

  it('speaks a lone error verbatim, with no count prefix', async () => {
    announceFieldError('Email, error: Enter a valid email address.');
    await flush();
    expect(announce).toHaveBeenCalledWith('Email, error: Enter a valid email address.');
  });

  it('collapses one commit of errors into a count plus the first field', async () => {
    announceFieldError('First name, error: Enter your first name.');
    announceFieldError('Email, error: Enter a valid email address.');
    announceFieldError('Password, error: Use at least 8 characters.');
    await flush();
    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalledWith(
      '3 fields need attention. First name, error: Enter your first name.',
    );
  });

  it('starts a fresh batch for the next submit', async () => {
    announceFieldError('a');
    announceFieldError('b');
    await flush();
    announce.mockClear();
    announceFieldError('c');
    await flush();
    expect(announce).toHaveBeenCalledWith('c');
  });

  it('ignores an empty message', async () => {
    announceFieldError('');
    await flush();
    expect(announce).not.toHaveBeenCalled();
  });

  it('is a no-op off iOS — Android is served by the live region on the error text', async () => {
    const original = Platform.OS;
    Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });
    try {
      announceFieldError('Email, error: Enter a valid email address.');
      await flush();
      expect(announce).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(Platform, 'OS', { value: original, configurable: true });
    }
  });
});
