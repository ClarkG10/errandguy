import React from 'react';
import { render } from '@testing-library/react-native';
import { PaymentBrandMark } from '../PaymentBrandMark';
import type { PaymentMethodType } from '../../../types';

// Serialize the rendered tree to a string so we can assert on the mark content
// without depending on RNTL's text matcher traversing nested <Text>/<Svg>.
const tree = (node: React.ReactElement) => JSON.stringify(render(node).toJSON());

describe('PaymentBrandMark', () => {
  it('renders every payment method type without throwing', () => {
    const types: PaymentMethodType[] = ['gcash', 'maya', 'grabpay', 'card', 'wallet', 'cash'];
    types.forEach((type) => {
      expect(() => render(<PaymentBrandMark type={type} />)).not.toThrow();
    });
  });

  it('shows the correct network mark for a saved card', () => {
    expect(tree(<PaymentBrandMark type="card" brand="visa" />)).toContain('VISA');
    expect(tree(<PaymentBrandMark type="card" brand="American Express" />)).toContain('AMEX');
    // Mastercard is a geometric mark (no wordmark) — renders, no VISA/AMEX text.
    expect(() => render(<PaymentBrandMark type="card" brand="mastercard" />)).not.toThrow();
    expect(tree(<PaymentBrandMark type="card" brand="mastercard" />)).not.toContain('VISA');
    // Unknown / no brand → generic card glyph, no network wordmark.
    expect(tree(<PaymentBrandMark type="card" />)).not.toContain('VISA');
  });

  it('disambiguates e-wallets by initial', () => {
    expect(tree(<PaymentBrandMark type="gcash" />)).toContain('G');
    expect(tree(<PaymentBrandMark type="maya" />)).toContain('M');
    // Correct official brand fills.
    expect(tree(<PaymentBrandMark type="gcash" />)).toContain('#007CFF');
    expect(tree(<PaymentBrandMark type="grabpay" />)).toContain('#00B14F');
  });
});
