import { closestMatch, editDistance } from '../searchSuggest';

describe('editDistance', () => {
  it('counts inserts, deletes, substitutions and adjacent swaps as one edit each', () => {
    expect(editDistance('delivery', 'delivery')).toBe(0);
    expect(editDistance('delivry', 'delivery')).toBe(1);
    expect(editDistance('delievry', 'delivery')).toBe(1);
    expect(editDistance('cancled', 'cancelled')).toBe(2);
    expect(editDistance('', 'abc')).toBe(3);
  });
});

describe('closestMatch — "Did you mean …?" from the app’s own words', () => {
  const vocab = ['Delivery', 'Buy for me', 'Queue / Pila', 'Custom errand', 'Cancelled', 'home', 'work'];

  it('corrects a typo of a word the app uses, keeping its casing', () => {
    expect(closestMatch('delivry', vocab)).toBe('Delivery');
    expect(closestMatch('cancled', vocab)).toBe('Cancelled');
    expect(closestMatch('buy for mee', vocab)).toBe('Buy for me');
    expect(closestMatch('custm', vocab)).toBe('Custom');
  });

  it('suggests nothing for an exact word, a short query, or something unrelated', () => {
    expect(closestMatch('delivery', vocab)).toBeNull();
    expect(closestMatch('hme', vocab)).toBeNull();
    expect(closestMatch('zzzzqq', vocab)).toBeNull();
    expect(closestMatch('groceries', vocab)).toBeNull();
  });
});
