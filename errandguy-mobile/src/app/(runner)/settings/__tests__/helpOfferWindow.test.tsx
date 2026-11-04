import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import HelpScreen from '../help';
import { useRunnerStore } from '../../../../stores/runnerStore';
import { makeRunnerProfile } from '../../../../__mocks__/factories';

/**
 * The help page told runners they had "about 90 seconds" to accept an offer,
 * whatever staff had set matched_acceptance_timeout_seconds to. The figure now
 * comes off the runner's own profile (`offer_accept_seconds`).
 */

jest.mock('../../../../services/preload.service', () => ({
  prefetchSupportTickets: jest.fn(),
}));
jest.mock('../../../../components/settings/PolicyLinksCard', () => ({
  PolicyLinksCard: () => null,
}));

const renderScreen = () =>
  render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 390, height: 844 },
        insets: { top: 47, left: 0, right: 0, bottom: 34 },
      }}
    >
      <HelpScreen />
    </SafeAreaProvider>,
  );

const openOffersAnswer = (screen: ReturnType<typeof renderScreen>) =>
  act(() => {
    fireEvent.press(screen.getByLabelText('How do I receive errand requests?'));
  });

describe('runner help — the offer window', () => {
  it('states the window staff set', async () => {
    useRunnerStore.setState({
      runnerProfile: { ...makeRunnerProfile(), offer_accept_seconds: 120 } as never,
    });
    const screen = renderScreen();
    await openOffersAnswer(screen);

    expect(screen.getByText(/you have about 2 minutes to accept or decline/)).toBeTruthy();
    expect(screen.queryByText(/about 90 seconds/)).toBeNull();
  });

  it('says 90 seconds, the server default, before the profile has loaded', async () => {
    useRunnerStore.setState({ runnerProfile: null });
    const screen = renderScreen();
    await openOffersAnswer(screen);

    expect(screen.getByText(/you have about 90 seconds to accept or decline/)).toBeTruthy();
  });
});
