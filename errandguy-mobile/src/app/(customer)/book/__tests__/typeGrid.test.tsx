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

const type = (
  id: string,
  name: string,
  sort: number,
  is_active = true,
  minimum_price: number | string | undefined = 56.35,
): ErrandType =>
  ({
    id,
    slug: id,
    name,
    description: `${name} description`,
    icon_name: 'Package',
    base_fee: 49,
    minimum_price,
    is_active,
    sort_order: sort,
  }) as unknown as ErrandType;

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

// A tile's accessible name starts with the type name ("Delivery. … From ₱56.35").
const tiles = (utils: ReturnType<typeof renderGrid>) =>
  utils.getAllByLabelText(/ description(\.|$)/);
const tileNames = (utils: ReturnType<typeof renderGrid>) =>
  tiles(utils).map((node) => String(node.props.accessibilityLabel).split('.')[0]);

beforeEach(() => {
  jest.clearAllMocks();
  useBookingStore.setState({ draftBooking: {}, currentStep: 0 });
  serve(SERVED);
});

describe('booking type grid', () => {
  it('renders exactly the types the server serves as active, in its order', async () => {
    const utils = renderGrid();
    await waitFor(() => expect(tiles(utils)).toHaveLength(4));
    expect(tileNames(utils)).toEqual(['Delivery', 'Buy for me', 'Queue / Pila', 'Custom errand']);
    // No ride badge (or any other hard-coded tile chrome) survives.
    expect(utils.queryByText('Ride')).toBeNull();
  });

  it('never renders a row the server marks inactive', async () => {
    serve([...SERVED, type('transportation', 'Passenger ride', 5, false)]);
    const utils = renderGrid();
    await waitFor(() => expect(tiles(utils)).toHaveLength(4));
    expect(utils.queryByText('Passenger ride')).toBeNull();
  });

  it('drops a draft’s retired type instead of letting it continue', async () => {
    // A rebook of an older food booking lands here with its retired id.
    useBookingStore.setState({
      draftBooking: { errand_type_id: 'food', errand_type_slug: 'food', pickup_address: 'A' },
      currentStep: 0,
    });
    const utils = renderGrid();
    await waitFor(() => expect(tiles(utils)).toHaveLength(4));
    // Nothing is shown as chosen for the retired id.
    for (const tile of tiles(utils)) expect(tile.props.accessibilityState?.selected).toBe(false);

    // Picking a current type continues as usual, and keeps the address.
    fireEvent.press(utils.getByLabelText(/^Buy for me\./));
    const draft = useBookingStore.getState().draftBooking;
    expect(draft.errand_type_id).toBe('purchase');
    expect(draft.errand_type_slug).toBe('purchase');
    expect(draft.pickup_address).toBe('A');
    expect(mockPush).toHaveBeenCalledWith('/(customer)/book/details');
  });

  it('goes straight to details on one tap — no separate Continue', async () => {
    const utils = renderGrid();
    await waitFor(() => expect(tiles(utils)).toHaveLength(4));
    expect(utils.queryByText('Continue')).toBeNull();

    const queue = utils.getByLabelText(/^Queue \/ Pila\./);
    expect(queue.props.accessibilityRole).toBe('button');
    expect(queue.props.accessibilityHint).toBe('Goes to errand details');
    fireEvent.press(queue);

    expect(useBookingStore.getState().draftBooking.errand_type_id).toBe('queue');
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith('/(customer)/book/details');
  });

  it('asks before a tap on another type throws away details already entered', async () => {
    useBookingStore.setState({
      draftBooking: {
        errand_type_id: 'purchase',
        errand_type_slug: 'purchase',
        shoppingItems: [{ id: '1', name: 'Rice 5kg', qty: 1 }],
        shopping_budget: 500,
      },
      currentStep: 1,
    });
    const utils = renderGrid();
    await waitFor(() => expect(tiles(utils)).toHaveLength(4));

    fireEvent.press(utils.getByLabelText(/^Delivery\./));
    expect(mockPush).not.toHaveBeenCalled();
    expect(useBookingStore.getState().draftBooking.shoppingItems).toHaveLength(1);

    // "Keep editing" leaves the errand exactly as it was.
    fireEvent.press(utils.getByText('Keep editing'));
    expect(useBookingStore.getState().draftBooking.errand_type_id).toBe('purchase');

    // Confirming switches and drops the shopping details.
    fireEvent.press(utils.getByLabelText(/^Delivery\./));
    fireEvent.press(utils.getByText('Switch'));
    const draft = useBookingStore.getState().draftBooking;
    expect(draft.errand_type_id).toBe('delivery');
    expect(draft.shoppingItems).toBeUndefined();
    expect(mockPush).toHaveBeenCalledWith('/(customer)/book/details');
  });

  it('quotes the true minimum, service fee included — never the bare base fee', async () => {
    const utils = renderGrid();
    await waitFor(() => expect(tiles(utils)).toHaveLength(4));
    expect(utils.getAllByText('From ₱56.35')).toHaveLength(4);
    expect(utils.queryByText('From ₱49.00')).toBeNull();
  });

  it('shows no "From" price at all from a server that sends no minimum', async () => {
    serve(SERVED.map((t) => ({ ...t, minimum_price: undefined })));
    const utils = renderGrid();
    await waitFor(() => expect(tiles(utils)).toHaveLength(4));
    expect(utils.queryByText(/^From /)).toBeNull();
  });
});
