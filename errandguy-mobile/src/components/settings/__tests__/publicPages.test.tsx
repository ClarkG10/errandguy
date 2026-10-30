import React from 'react';
import { readFileSync } from 'fs';
import { join } from 'path';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { PublicPageLink } from '../PublicPageLink';
import { PolicyLinksCard } from '../PolicyLinksCard';
import { PUBLIC_PAGES } from '../../../constants/legal';
import { openWebPage } from '../../../utils/browser';
import { useToastStore } from '../../../stores/toastStore';

jest.mock('../../../utils/browser', () => ({ openWebPage: jest.fn() }));
const open = openWebPage as jest.Mock;

beforeEach(() => {
  open.mockReset().mockResolvedValue(true);
  useToastStore.setState({ toasts: [] });
});

describe('links to the published Terms / Privacy / account-deletion pages', () => {
  it('a link opens its page on the API host', async () => {
    const { getByText } = render(<PublicPageLink page="terms" />);
    fireEvent.press(getByText('Terms of Service'));
    await waitFor(() => expect(open).toHaveBeenCalledWith(PUBLIC_PAGES.terms.url));
  });

  it('when nothing can open it, the address is shown instead', async () => {
    open.mockResolvedValue(false);
    const { getByText } = render(<PublicPageLink page="privacy" />);
    fireEvent.press(getByText('Privacy Policy'));
    await waitFor(() =>
      expect(useToastStore.getState().toasts[0]?.message).toContain(PUBLIC_PAGES.privacy.url),
    );
  });

  it('the policies card offers all three', async () => {
    const { getByLabelText } = render(<PolicyLinksCard />);
    fireEvent.press(getByLabelText('Delete your account'));
    await waitFor(() => expect(open).toHaveBeenCalledWith(PUBLIC_PAGES.deleteAccount.url));
    expect(getByLabelText('Terms of Service')).toBeTruthy();
    expect(getByLabelText('Privacy Policy')).toBeTruthy();
  });

  describe('every surface that should link them does', () => {
    const read = (rel: string) => readFileSync(join(__dirname, '..', '..', '..', rel), 'utf8');

    it('sign-up: the Terms / Privacy sheet links the full published page', () => {
      expect(read('components/auth/LegalModal.tsx')).toMatch(/<PublicPageLink\s+page=\{document\}/);
      expect(read('components/auth/LegalModal.tsx')).toMatch(/DeleteAccountPageLink/);
    });

    it('help, both roles', () => {
      expect(read('app/(customer)/help.tsx')).toMatch(/<PolicyLinksCard \/>/);
      expect(read('app/(runner)/settings/help.tsx')).toMatch(/<PolicyLinksCard \/>/);
    });

    it('profile / settings, both roles', () => {
      const customer = read('app/(customer)/(tabs)/profile.tsx');
      for (const page of ['terms', 'privacy', 'deleteAccount']) {
        expect(customer).toContain(`openPublicPage('${page}')`);
      }
      const runnerTerms = read('app/(runner)/settings/terms.tsx');
      for (const page of ['terms', 'privacy', 'deleteAccount']) {
        expect(runnerTerms).toContain(`page: '${page}'`);
      }
    });

    it('URLs are built from the API base host, not hard-coded', () => {
      const code = read('constants/legal.ts')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      expect(code).toMatch(/process\.env\.EXPO_PUBLIC_API_URL/);
      expect(code).not.toMatch(/https?:\/\/[a-z0-9.-]+\.[a-z]{2,}/i);
    });
  });
});
