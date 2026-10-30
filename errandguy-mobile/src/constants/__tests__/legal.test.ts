import { PUBLIC_PAGES, publicPageUrl } from '../legal';

describe('public page URLs follow the API host', () => {
  it('drops the API path and keeps scheme + host (+ port)', () => {
    expect(publicPageUrl('/terms', 'https://api.errandguy.ph/api/v1')).toBe('https://api.errandguy.ph/terms');
    expect(publicPageUrl('privacy', 'http://192.168.1.5:8000/api/v1')).toBe('http://192.168.1.5:8000/privacy');
    expect(publicPageUrl('/delete-account', 'https://x.on-forge.com/api/v1/')).toBe(
      'https://x.on-forge.com/delete-account',
    );
  });

  it('degrades to string surgery when the base is not a parseable URL', () => {
    expect(publicPageUrl('/terms', 'example.com/api/v1')).toBe('example.com/terms');
  });

  it('exposes the three pages every surface links', () => {
    expect(Object.keys(PUBLIC_PAGES).sort()).toEqual(['deleteAccount', 'privacy', 'terms']);
    expect(PUBLIC_PAGES.terms.url).toMatch(/\/terms$/);
    expect(PUBLIC_PAGES.privacy.url).toMatch(/\/privacy$/);
    expect(PUBLIC_PAGES.deleteAccount.url).toMatch(/\/delete-account$/);
  });
});
