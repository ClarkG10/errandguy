import { mediaSource } from '../mediaSource';
import { secureStorage } from '../storage';

jest.mock('../storage', () => ({ secureStorage: { peek: jest.fn() } }));

const peek = secureStorage.peek as jest.Mock;

const GATED_MEDIA = 'https://api.errandguy.app/internal/media/booking-photos/abc-uuid/proof.jpg';
const GATED_DOC = 'https://api.errandguy.app/internal/runner-documents/doc-uuid/file';
const PUBLIC_AVATAR = 'https://api.errandguy.app/storage/avatars/1_x.jpg';
const LOCAL = 'file:///var/tmp/preview.jpg';

describe('mediaSource', () => {
  const realApiUrl = process.env.EXPO_PUBLIC_API_URL;
  beforeAll(() => {
    process.env.EXPO_PUBLIC_API_URL = 'https://api.errandguy.app/api/v1';
  });
  afterAll(() => {
    process.env.EXPO_PUBLIC_API_URL = realApiUrl;
  });
  afterEach(() => peek.mockReset());

  it('never sends the login to another host, however much its link looks like ours', () => {
    peek.mockReturnValue('tok123');
    for (const url of [
      'https://api.errandguy.app.evil.tld/internal/media/chat-images/b/x.jpg',
      'https://api.errandguy.app@evil.tld/internal/media/chat-images/b/x.jpg',
      'https://evil.tld/internal/media/chat-images/b/x.jpg',
      'http://api.errandguy.app/internal/media/chat-images/b/x.jpg',
      'https://evil.tld/api/v1/runner/documents/doc/file',
    ]) {
      expect(mediaSource(url)).toEqual({ uri: url });
    }
  });

  it('attaches the bearer for gated /internal/ media + documents when a token exists', () => {
    peek.mockReturnValue('tok123');
    expect(mediaSource(GATED_MEDIA)).toEqual({
      uri: GATED_MEDIA,
      headers: { Authorization: 'Bearer tok123' },
    });
    expect(mediaSource(GATED_DOC)).toEqual({
      uri: GATED_DOC,
      headers: { Authorization: 'Bearer tok123' },
    });
  });

  it('attaches the bearer to a runner’s OWN document stream (download_url)', () => {
    // RunnerDocumentResource.download_url → GET /api/v1/runner/documents/{id}/file
    // (auth:sanctum). Without the header the runner's own preview never loaded.
    peek.mockReturnValue('tok123');
    const OWN_DOC = 'https://api.errandguy.app/api/v1/runner/documents/9b1c-uuid/file';
    expect(mediaSource(OWN_DOC)).toEqual({
      uri: OWN_DOC,
      headers: { Authorization: 'Bearer tok123' },
    });
    expect(mediaSource(`${OWN_DOC}?v=2`)).toEqual({
      uri: `${OWN_DOC}?v=2`,
      headers: { Authorization: 'Bearer tok123' },
    });
  });

  it('does not treat look-alike paths as the document stream', () => {
    peek.mockReturnValue('tok123');
    const NOT_IT = 'https://cdn.example.com/runner/documents/9b1c/file-preview.jpg';
    expect(mediaSource(NOT_IT)).toEqual({ uri: NOT_IT });
  });

  it('degrades to no header for gated media when no token is cached', () => {
    peek.mockReturnValue(null);
    expect(mediaSource(GATED_MEDIA)).toEqual({ uri: GATED_MEDIA });
  });

  it('never adds an auth header (or looks up a token) for public/local URLs', () => {
    peek.mockReturnValue('tok123');
    expect(mediaSource(PUBLIC_AVATAR)).toEqual({ uri: PUBLIC_AVATAR });
    expect(mediaSource(LOCAL)).toEqual({ uri: LOCAL });
    expect(peek).not.toHaveBeenCalled();
  });

  it('returns undefined for empty input', () => {
    expect(mediaSource(null)).toBeUndefined();
    expect(mediaSource(undefined)).toBeUndefined();
    expect(mediaSource('')).toBeUndefined();
  });
});
