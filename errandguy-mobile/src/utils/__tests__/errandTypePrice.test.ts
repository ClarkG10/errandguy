import { errandTypeMinimumPrice } from '../errandTypePrice';

describe('errandTypeMinimumPrice', () => {
  it('reads the server’s minimum, string decimals included', () => {
    expect(errandTypeMinimumPrice({ id: 'a', minimum_price: 115 })).toBe(115);
    expect(errandTypeMinimumPrice({ id: 'a', minimum_price: '126.50' })).toBe(126.5);
  });

  it('has no price to show from an older server, or a nonsense one', () => {
    expect(errandTypeMinimumPrice({ id: 'a' })).toBeNull();
    expect(errandTypeMinimumPrice({ id: 'a', minimum_price: null })).toBeNull();
    expect(errandTypeMinimumPrice({ id: 'a', minimum_price: 'abc' })).toBeNull();
    expect(errandTypeMinimumPrice({ id: 'a', minimum_price: 0 })).toBeNull();
  });
});
