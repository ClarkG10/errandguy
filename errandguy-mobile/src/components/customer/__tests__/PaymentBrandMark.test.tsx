import React from 'react';
import { render } from '@testing-library/react-native';
import { PaymentBrandMark } from '../PaymentBrandMark';
import type { PaymentMethodType } from '../../../types';

// Serialize the rendered tree to a string so we can assert on the mark content
// without depending on RNTL's text matcher traversing nested <Text>/<Svg>.
const tree = (node: React.ReactElement) => JSON.stringify(render(node).toJSON());

describe('PaymentBrandMark', () => {
  it('renders every payment method type without throwing', () => {
    const types: PaymentMethodType[] = ['gcash', 'maya', 'wallet', 'cash'];
    types.forEach((type) => {
      expect(() => render(<PaymentBrandMark type={type} />)).not.toThrow();
    });
  });

  it('disambiguates e-wallets by initial and official brand fill', () => {
    expect(tree(<PaymentBrandMark type="gcash" />)).toContain('"G"');
    expect(tree(<PaymentBrandMark type="maya" />)).toContain('"M"');
    expect(tree(<PaymentBrandMark type="gcash" />)).toContain('#007CFF');
    expect(tree(<PaymentBrandMark type="maya" />)).toContain('#10C98E');
  });

  it('renders a neutral tile, not a crash, for a method it does not know', () => {
    // Only the selector renders marks and it offers the four launch methods,
    // but a value from an older server must still draw something.
    expect(() =>
      render(<PaymentBrandMark type={'card' as unknown as PaymentMethodType} />),
    ).not.toThrow();
  });
});
