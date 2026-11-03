import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import VehicleScreen from '../vehicle';
import { useRunnerStore } from '../../../../stores/runnerStore';
import { runnerService } from '../../../../services/runner.service';
import { makeRunnerProfile } from '../../../../__mocks__/factories';

/**
 * A runner can't go online without a vehicle on file. The screen used to
 * preselect "Walking" with Save live, so a motorcycle rider tapping straight
 * through put "Walking" on record and was only ever offered walking errands.
 * Nothing is preselected now; Save waits until the runner picks.
 */

jest.mock('expo-router', () => ({
  useRouter: () => ({ back: jest.fn(), replace: jest.fn(), push: jest.fn(), canGoBack: () => true }),
  useNavigation: () => ({ addListener: () => () => {} }),
}));

jest.mock('../../../../services/runner.service', () => ({
  runnerService: { updateRunnerProfile: jest.fn() },
}));

const updateRunnerProfile = runnerService.updateRunnerProfile as jest.Mock;

const renderScreen = () =>
  render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 390, height: 844 },
        insets: { top: 47, left: 0, right: 0, bottom: 34 },
      }}
    >
      <VehicleScreen />
    </SafeAreaProvider>,
  );

const saveButton = (screen: ReturnType<typeof renderScreen>, name: string) =>
  screen.getByRole('button', { name });

beforeEach(() => {
  jest.clearAllMocks();
  updateRunnerProfile.mockImplementation(async (data: Record<string, string>) => ({
    data: { data: makeRunnerProfile({ vehicle_type: data.vehicle_type as never }) },
  }));
});

describe('vehicle — nothing on file yet', () => {
  beforeEach(() => {
    useRunnerStore.setState({ runnerProfile: makeRunnerProfile({ vehicle_type: null, vehicle_plate: null }) });
  });

  it('asks the runner to choose, with nothing preselected and Save off', () => {
    const screen = renderScreen();
    expect(screen.getByText('Choose your vehicle')).toBeTruthy();
    for (const name of ['Walking', 'Bicycle', 'Motorcycle', 'Car']) {
      expect(screen.getByRole('radio', { name }).props.accessibilityState).toMatchObject({
        selected: false,
      });
    }
    expect(saveButton(screen, 'Save vehicle').props.accessibilityState).toMatchObject({
      disabled: true,
    });
  });

  it('saves the vehicle the runner picks — so they can go online', async () => {
    const screen = renderScreen();

    fireEvent.press(screen.getByRole('radio', { name: 'Walking' }));
    expect(saveButton(screen, 'Save vehicle').props.accessibilityState).toMatchObject({
      disabled: false,
    });
    await act(async () => {
      fireEvent.press(saveButton(screen, 'Save vehicle'));
    });

    expect(updateRunnerProfile).toHaveBeenCalledWith({ vehicle_type: 'walk' });
    expect(useRunnerStore.getState().runnerProfile?.vehicle_type).toBe('walk');
  });
});

describe('vehicle — one already on file', () => {
  it('keeps Save off until something changes', () => {
    useRunnerStore.setState({ runnerProfile: makeRunnerProfile({ vehicle_type: 'bicycle' }) });
    const screen = renderScreen();

    expect(screen.queryByText('Choose your vehicle')).toBeNull();
    expect(saveButton(screen, 'Save Changes').props.accessibilityState).toMatchObject({
      disabled: true,
    });

    fireEvent.press(screen.getByRole('radio', { name: 'Walking' }));
    expect(saveButton(screen, 'Save Changes').props.accessibilityState).toMatchObject({
      disabled: false,
    });
  });

  it('never offers to save over a profile it has not loaded', () => {
    // Unknown is not "nothing saved": Save stays off rather than risk
    // overwriting a saved car.
    useRunnerStore.setState({ runnerProfile: null });
    const screen = renderScreen();
    expect(screen.queryByText('Choose your vehicle')).toBeNull();
    expect(saveButton(screen, 'Save Changes').props.accessibilityState).toMatchObject({
      disabled: true,
    });
  });
});
