import {
  DEFAULT_SHOPPING_BUDGET_MAX,
  itemsCashDue,
  itemsCashReadyLine,
  shoppingBudgetError,
  shoppingBudgetMax,
} from '../shoppingMoney';

/**
 * Item money on a shopping errand: the runner pays for the items with their
 * own cash and the customer repays the receipt amount IN CASH at the door.
 * Nothing for items is charged online, so the budget is capped (the runner
 * fronts it) and every customer-facing line is cash in hand.
 */
describe('shoppingBudgetMax', () => {
  it("reads the catalog's ceiling, including a decimal sent as a string", () => {
    expect(shoppingBudgetMax({ shopping_budget_max: 5000 })).toBe(5000);
    expect(shoppingBudgetMax({ shopping_budget_max: '2500.00' })).toBe(2500);
  });

  it('falls back to ₱3,000 when the server sends none (or nonsense)', () => {
    expect(DEFAULT_SHOPPING_BUDGET_MAX).toBe(3000);
    expect(shoppingBudgetMax(undefined)).toBe(3000);
    expect(shoppingBudgetMax(null)).toBe(3000);
    expect(shoppingBudgetMax({})).toBe(3000);
    expect(shoppingBudgetMax({ shopping_budget_max: null })).toBe(3000);
    expect(shoppingBudgetMax({ shopping_budget_max: 0 })).toBe(3000);
    expect(shoppingBudgetMax({ shopping_budget_max: -10 })).toBe(3000);
    expect(shoppingBudgetMax({ shopping_budget_max: 'abc' })).toBe(3000);
  });
});

describe('shoppingBudgetError', () => {
  it('requires a budget', () => {
    expect(shoppingBudgetError(undefined, 3000)).toBe('Shopping budget is required');
    expect(shoppingBudgetError(null, 3000)).toBe('Shopping budget is required');
    expect(shoppingBudgetError(0, 3000)).toBe('Shopping budget is required');
    expect(shoppingBudgetError(NaN, 3000)).toBe('Shopping budget is required');
  });

  it('accepts anything up to and including the ceiling', () => {
    expect(shoppingBudgetError(1, 3000)).toBeNull();
    expect(shoppingBudgetError(3000, 3000)).toBeNull();
  });

  it('refuses more than the ceiling, and says why', () => {
    const msg = shoppingBudgetError(3000.01, 3000);
    expect(msg).toBe(
      'The budget can be at most ₱3,000.00, since your runner pays for the items with their own cash.',
    );
  });

  it('enforces the fallback ceiling when the catalog has none', () => {
    expect(shoppingBudgetError(3500, shoppingBudgetMax(undefined))).toMatch(/at most ₱3,000\.00/);
    expect(shoppingBudgetError(3500, shoppingBudgetMax({ shopping_budget_max: 5000 }))).toBeNull();
  });
});

describe('itemsCashDue', () => {
  it("prefers the server's items_cash_due", () => {
    expect(itemsCashDue({ actual_item_cost: 999, items_cash_due: 1234.5 })).toBe(1234.5);
    expect(itemsCashDue({ actual_item_cost: null, items_cash_due: '1200.00' })).toBe(1200);
  });

  it('is null before the runner has bought the items', () => {
    expect(itemsCashDue({ actual_item_cost: null, items_cash_due: null })).toBeNull();
  });

  it('falls back to actual_item_cost on an older server that omits the field', () => {
    expect(itemsCashDue({ actual_item_cost: 850 })).toBe(850);
    expect(itemsCashDue({ actual_item_cost: null })).toBeNull();
  });
});

describe('itemsCashReadyLine', () => {
  it('names the exact cash once the runner has bought the items', () => {
    expect(
      itemsCashReadyLine({ shopping_budget: 1500, actual_item_cost: 1230, items_cash_due: 1230 }),
    ).toBe('Have ₱1,230.00 cash ready for the items');
  });

  it('names the budget as a ceiling before that', () => {
    expect(
      itemsCashReadyLine({ shopping_budget: 1500, actual_item_cost: null, items_cash_due: null }),
    ).toBe('Have up to ₱1,500.00 cash ready for the items');
  });

  it('says so when the runner spent nothing', () => {
    expect(
      itemsCashReadyLine({ shopping_budget: 1500, actual_item_cost: 0, items_cash_due: 0 }),
    ).toBe('No cash needed for the items');
  });

  it('has nothing to say without a budget (not a shopping errand)', () => {
    expect(itemsCashReadyLine({ shopping_budget: null, actual_item_cost: null })).toBeNull();
  });
});
