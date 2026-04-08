import React from 'react';
import { render } from '@testing-library/react-native';
import { Badge } from '../Badge';

describe('Badge', () => {
  it('renders count as text', () => {
    const { getByText } = render(<Badge count={5} />);
    expect(getByText('5')).toBeTruthy();
  });

  it('renders label as text', () => {
    const { getByText } = render(<Badge label="New" />);
    expect(getByText('New')).toBeTruthy();
  });

  it('returns null when count is 0', () => {
    const { toJSON } = render(<Badge count={0} />);
    expect(toJSON()).toBeNull();
  });

  it('renders when count is greater than 0', () => {
    const { getByText } = render(<Badge count={99} />);
    expect(getByText('99')).toBeTruthy();
  });

  it('renders all variants without crashing', () => {
    const variants = ['primary', 'danger', 'neutral'] as const;
    variants.forEach((variant) => {
      const { getByText } = render(<Badge label={variant} variant={variant} />);
      expect(getByText(variant)).toBeTruthy();
    });
  });

  it('renders sm and md sizes without crashing', () => {
    const { getByText: getText1 } = render(<Badge label="sm" size="sm" />);
    expect(getText1('sm')).toBeTruthy();

    const { getByText: getText2 } = render(<Badge label="md" size="md" />);
    expect(getText2('md')).toBeTruthy();
  });

  it('label takes precedence over count display text', () => {
    const { getByText, queryByText } = render(<Badge count={3} label="New" />);
    // When label is provided, it's used
    expect(getByText('New')).toBeTruthy();
    expect(queryByText('3')).toBeNull();
  });
});
