import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import TypeSelectionScreen from '../type';
import { useBookingStore } from '../../../../stores/bookingStore';
import { configService } from '../../../../services/config.service';
import type { ErrandType } from '../../../../types';

jest.mock('../../../../services/config.service', () => ({
  configService: { getErrandTypes: jest.fn() },
}));

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, replace: jest.fn(), back: jest.fn(), canGoBack: () => true }),
  useLocalSearchParams: () => ({}),
  useNavigation: () => ({ addListener: () => () => {} }),
}));

// Run the fetcher, skip the AsyncStorage layer (same shape as the home test).
jest.mock('../../../../hooks/useQuery', () => {
  const r: typeof React = require('react');
  return {
    useQuery: (_key: unknown, fetcher: () => Promise<unknown>) => {
      const [data, setData] = r.useState<unknown>(undefined);
      const run = r.useCallback(async () => {
        setData(await fetcher());
      }, []);
      r.useEffect(() => {
        void run();
      }, [run]);
      return {
        data: data ?? null,
        loading: data === undefined,
        error: null,
        refresh: run,
        revalidate: run,
        isStale: false,
        updatedAt: null,
        mutate: jest.fn(),
      };
    },
    invalidateQuery: jest.fn(),
  };
});

const type = (id: string, name: string, sort: number, is_active = true): ErrandType =>
  ({
    id,
    slug: id,
    name,
    description: `${name} description`,
    icon_name: 'Package',
    base_fee: 49,
    is_active,
    sort_order: sort,
  }) as ErrandType;

// What the server serves after the launch simplification, in its order.
const SERVED = [
  type('delivery', 'Delivery', 1),
  type('purchase', 'Buy for me', 2),
  type('queue', 'Queue / Pila', 3),
  type('custom', 'Custom errand', 4),
];

const serve = (types: ErrandType[]) =>
  (configService.getErrandTypes as jest.Mock).mockResolvedValue({ data: { data: types } });

const renderGrid = () =>
  render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 390, height: 844 },
        insets: { top: 47, left: 0, right: 0, bottom: 34 },
      }}
    >
      <TypeSelectionScreen />
    </SafeAreaProvider>,
  );

// A tile's accessible name starts with the type name ("Delivery. … From ₱49").
const tileNames = (utils: ReturnType<typeof renderGrid>) =>
  utils.getAllByRole('radio').map((node) => String(node.props.accessibilityLabel).split('.')[0]);

beforeEach(() => {
  jest.clearAllMocks();
  useBookingStore.setState({ draftBooking: {}, currentStep: 0 });
  serve(SERVED);
});

describe('booking type grid', () => {
  it('renders exactly the types the server serves as active, in its order', async () => {
    const utils = renderGrid();
    await waitFor(() => expect(utils.getAllByRole('radio')).toHaveLength(4));
    expect(tileNames(utils)).toEqual(['Delivery', 'Buy for me', 'Queue / Pila', 'Custom errand']);
    // No ride badge (or any other hard-coded tile chrome) survives.
    expect(utils.queryByText('Ride')).toBeNull();
  });

  it('never renders a row the server marks inactive', async () => {
    serve([...SERVED, type('transportation', 'Passenger ride', 5, false)]);
    const utils = renderGrid();
    await waitFor(() => expect(utils.getAllByRole('radio')).toHaveLength(4));
    expect(utils.queryByText('Passenger ride')).toBeNull();
  });

  it('drops a draft’s retired type instead of letting it continue', async () => {
    // A rebook of an older food booking lands here with its retired id.
    useBookingStore.setState({
      draftBooking: { errand_type_id: 'food', errand_type_slug: 'food', pickup_address: 'A' },
      currentStep: 0,
    });
    const utils = renderGrid();
    await waitFor(() => expect(utils.getAllByRole('radio')).toHaveLength(4));
    await waitFor(() => expect(utils.getByText('Choose an errand type')).toBeTruthy());

    // Picking a current type continues as usual, and keeps the address.
    fireEvent.press(utils.getByLabelText(/^Buy for me\./));
    fireEvent.press(utils.getByText('Continue'));
    const draft = useBookingStore.getState().draftBooking;
    expect(draft.errand_type_id).toBe('purchase');
    expect(draft.errand_type_slug).toBe('purchase');
    expect(draft.pickup_address).toBe('A');
    expect(mockPush).toHaveBeenCalledWith('/(customer)/book/details');
  });
});
