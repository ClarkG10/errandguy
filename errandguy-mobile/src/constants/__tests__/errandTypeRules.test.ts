import {
  ERRAND_TYPE_SLUGS,
  RETIRED_ERRAND_SLUGS,
  bookingVehicle,
  getErrandTypeRule,
  isRetiredErrandSlug,
  offeredVehicles,
  vehicleWithinOffer,
} from '../errandTypeRules';
import { getNextStatus, statusActionLabel } from '../../components/runner/StatusActionButton';

/**
 * Launch went from ten errand types to four (delivery, purchase "Buy for me",
 * queue, custom). The six retired slugs stay on bookings made before the cut,
 * and one can still be mid-errand on a runner's phone when this build lands —
 * so each must still resolve to a flow the server accepts, step by step.
 */
describe('errand types after the launch simplification', () => {
  it('has rules for the four current types plus the legacy bills flow only', () => {
    expect(ERRAND_TYPE_SLUGS).toEqual(['delivery', 'queue', 'purchase', 'custom', 'bills_payment']);
  });

  it('knows which slugs can no longer be booked', () => {
    expect([...RETIRED_ERRAND_SLUGS].sort()).toEqual(
      ['bills_payment', 'document', 'food', 'grocery', 'laundry', 'transportation'].sort(),
    );
    for (const slug of RETIRED_ERRAND_SLUGS) expect(isRetiredErrandSlug(slug)).toBe(true);
    for (const slug of ['delivery', 'purchase', 'queue', 'custom']) {
      expect(isRetiredErrandSlug(slug)).toBe(false);
    }
    expect(isRetiredErrandSlug(null)).toBe(false);
    expect(isRetiredErrandSlug(undefined)).toBe(false);
  });
});

describe('a food or grocery errand still in progress', () => {
  it.each(['food', 'grocery'])('%s runs the "Buy for me" shopping flow exactly', (slug) => {
    expect(getErrandTypeRule(slug)).toEqual(getErrandTypeRule('purchase'));
    expect(getErrandTypeRule(slug).requiresShoppingBudget).toBe(true);
  });

  it('asks the runner to buy and capture the receipt at the store', () => {
    expect(statusActionLabel('arrived_at_pickup', 'food')).toBe('Buy item + capture receipt');
    expect(getNextStatus('arrived_at_pickup', 'grocery')).toBe('picked_up');
  });
});

describe('a document or laundry errand still in progress', () => {
  it.each(['document', 'laundry'])('%s runs the delivery flow exactly', (slug) => {
    expect(getErrandTypeRule(slug)).toEqual(getErrandTypeRule('delivery'));
    expect(getErrandTypeRule(slug).requiresShoppingBudget).toBe(false);
    expect(statusActionLabel('arrived_at_pickup', slug)).toBe('Pick up item');
  });
});

describe('a passenger ride still in progress', () => {
  /**
   * The ride ladder used to jump arrived_at_dropoff → completed, a step the
   * server rejects, so a ride could never be finished. It now walks the normal
   * delivery steps, through `delivered`.
   */
  it('follows the normal delivery steps, including the handover', () => {
    const rule = getErrandTypeRule('transportation');
    expect(rule).toEqual(getErrandTypeRule('delivery'));
    expect(rule.statusFlow).toContain('delivered');
    expect(getNextStatus('arrived_at_dropoff', 'transportation')).toBe('delivered');
    expect(getNextStatus('delivered', 'transportation')).toBe('completed');
  });

  it('uses delivery wording, with no ride or PIN step', () => {
    const labels = Object.values(getErrandTypeRule('transportation').statusActions);
    expect(labels).toEqual(Object.values(getErrandTypeRule('delivery').statusActions));
    for (const label of labels) expect(label).not.toMatch(/ride|passenger|PIN/i);
  });
});

describe('a bill payment still in progress (legacy alias)', () => {
  it('still ends at the payment counter, against a receipt', () => {
    const rule = getErrandTypeRule('bills_payment');
    expect(rule.singleLocation).toBe(true);
    expect(rule.requiresShoppingBudget).toBe(true);
    expect(rule.statusFlow).toEqual([
      'accepted',
      'heading_to_pickup',
      'arrived_at_pickup',
      'picked_up',
      'completed',
    ]);
    expect(getNextStatus('picked_up', 'bills_payment')).toBe('completed');
    expect(statusActionLabel('arrived_at_pickup', 'bills_payment')).toBe('Pay bill + capture receipt');
  });
});

describe('a queue / pila errand', () => {
  const queue = getErrandTypeRule('queue');

  /**
   * Review hides the vehicle picker for a single-location errand, so whatever
   * vehicle it lands on is invisible. It used to be the global default,
   * motorcycle: the server added the motorcycle premium and offered the job
   * only to motorcycle and car runners.
   */
  it('is priced and matched on foot', () => {
    expect(queue.defaultVehicle).toBe('walk');
    expect(queue.allowedVehicles).toEqual(['walk']);
    expect(bookingVehicle(queue)).toBe('walk');
  });

  it('never keeps an older vehicle from a restored draft or a rebook', () => {
    expect(bookingVehicle(queue, 'motorcycle')).toBe('walk');
    expect(bookingVehicle(queue, 'car')).toBe('walk');
  });

  it('tells the truth about the price — there is no waiting fee', () => {
    expect(queue.helperNote).toBe('Fixed price. No extra charge for waiting time.');
    expect(queue.helperNote).not.toMatch(/separately|travel/i);
  });
});

describe('the vehicle a booking goes out on', () => {
  it('keeps the customer’s pick where the picker is shown', () => {
    const delivery = getErrandTypeRule('delivery');
    expect(bookingVehicle(delivery, 'car')).toBe('car');
    expect(bookingVehicle(delivery, 'bicycle')).toBe('bicycle');
  });

  it('falls back to the type’s default for nothing, or for a vehicle it doesn’t allow', () => {
    const delivery = getErrandTypeRule('delivery');
    expect(bookingVehicle(delivery)).toBe(delivery.defaultVehicle);
    expect(bookingVehicle(delivery, null)).toBe(delivery.defaultVehicle);
    expect(bookingVehicle(delivery, 'helicopter')).toBe(delivery.defaultVehicle);
  });
});

/**
 * Staff can withdraw a vehicle for an errand type (per-km rate 0). The estimate
 * then leaves it out of `vehicle_types` with no price, and creating the booking
 * refuses it — so Review must stop offering it once the estimate is in.
 */
describe('the vehicles Review offers once the estimate is in', () => {
  const delivery = getErrandTypeRule('delivery');
  const queue = getErrandTypeRule('queue');
  const price = (total: number) => ({
    total_amount: total, distance_fee: 0, base_fee: 0, service_fee: 0, surcharge: 0,
  });

  it('keeps today’s list while the estimate loads or has failed', () => {
    expect(offeredVehicles(delivery, null)).toEqual(['walk', 'bicycle', 'motorcycle', 'car']);
    expect(offeredVehicles(delivery, undefined)).toEqual(delivery.allowedVehicles);
  });

  it('drops a vehicle the server no longer offers for the type', () => {
    const estimate = {
      walk: price(80), bicycle: price(95), motorcycle: price(120),
      vehicle_types: ['walk', 'bicycle', 'motorcycle'],
    };
    expect(offeredVehicles(delivery, estimate)).toEqual(['walk', 'bicycle', 'motorcycle']);
  });

  it('never offers a vehicle without a price, even if the list names it', () => {
    const estimate = {
      walk: price(80), motorcycle: price(120), car: price(0),
      vehicle_types: ['walk', 'bicycle', 'motorcycle', 'car'],
    };
    expect(offeredVehicles(delivery, estimate)).toEqual(['walk', 'motorcycle']);
  });

  it('on an older server with no vehicle list, offers the priced ones', () => {
    const estimate = { walk: price(80), bicycle: price(95), motorcycle: price(120), car: price(150) };
    expect(offeredVehicles(delivery, estimate)).toEqual(['walk', 'bicycle', 'motorcycle', 'car']);
    const { car: _car, ...noCar } = estimate;
    expect(offeredVehicles(delivery, noCar)).toEqual(['walk', 'bicycle', 'motorcycle']);
  });

  it('reads prices sent as strings', () => {
    const estimate = { walk: { total_amount: '80.00' }, vehicle_types: ['walk'] };
    expect(offeredVehicles(delivery, estimate)).toEqual(['walk']);
  });

  it('leaves queue exactly as it was: walk, picker hidden', () => {
    const estimate = { motorcycle: price(120), vehicle_types: ['motorcycle'] };
    expect(offeredVehicles(queue, estimate)).toEqual(['walk']);
    expect(bookingVehicle(queue, 'motorcycle')).toBe('walk');
  });

  it('keeps the pick while it is still offered', () => {
    expect(vehicleWithinOffer(delivery, 'car', ['walk', 'motorcycle', 'car'])).toBe('car');
  });

  it('moves a withdrawn pick to the type’s default, or else the first offered', () => {
    expect(vehicleWithinOffer(delivery, 'car', ['walk', 'bicycle', 'motorcycle'])).toBe('motorcycle');
    expect(vehicleWithinOffer(delivery, 'motorcycle', ['bicycle', 'car'])).toBe('bicycle');
    expect(vehicleWithinOffer(delivery, 'car', [])).toBeNull();
  });
});

describe('a "Buy for me" errand on the map', () => {
  const purchase = getErrandTypeRule('purchase');

  it('starts the customer’s own location on the drop-off, not the store', () => {
    expect(purchase.currentLocationLeg).toBe('dropoff');
    for (const slug of ['delivery', 'queue', 'custom']) {
      expect(getErrandTypeRule(slug).currentLocationLeg).toBe('pickup');
    }
  });

  it('words the store step naturally', () => {
    expect(purchase.pickupLabel).toBe('Store');
    expect(purchase.pickupStepCopy).toEqual({
      title: 'Which store?',
      search: 'Search for a store',
      confirm: 'Confirm store',
    });
    expect(purchase.dropoffStepCopy?.confirm).toBe('Confirm drop-off');
    for (const copy of [purchase.pickupStepCopy, purchase.dropoffStepCopy]) {
      expect(Object.values(copy ?? {}).join(' ')).not.toMatch(/buy from|deliver to/i);
    }
  });
});
