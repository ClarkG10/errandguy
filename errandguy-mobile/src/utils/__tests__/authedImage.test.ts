import { authedImageSource } from '../authedImage';
import { useAuthStore } from '../../stores/authStore';

describe('authedImageSource', () => {
  afterEach(() => useAuthStore.setState({ token: null }));

  it('returns undefined for an empty uri', () => {
    expect(authedImageSource(null)).toBeUndefined();
    expect(authedImageSource(undefined)).toBeUndefined();
    expect(authedImageSource('')).toBeUndefined();
  });

  it('attaches the bearer token as an Authorization header when signed in', () => {
    useAuthStore.setState({ token: 'tok_abc123' });

    expect(authedImageSource('https://api.test/api/v1/runner/documents/1/file')).toEqual({
      uri: 'https://api.test/api/v1/runner/documents/1/file',
      headers: { Authorization: 'Bearer tok_abc123' },
    });
  });

  it('falls back to a plain uri (no header) when there is no token', () => {
    useAuthStore.setState({ token: null });

    expect(authedImageSource('https://api.test/legacy.jpg')).toEqual({
      uri: 'https://api.test/legacy.jpg',
    });
  });
});
