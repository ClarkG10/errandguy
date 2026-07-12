import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { SlideToConfirm } from '../SlideToConfirm';

const activate = (element: any) =>
  fireEvent(element, 'accessibilityAction', {
    nativeEvent: { actionName: 'activate' },
  });

describe('SlideToConfirm', () => {
  it('renders the label', () => {
    const { getByText } = render(
      <SlideToConfirm label="Slide to confirm pickup" onComplete={jest.fn()} />,
    );
    expect(getByText('Slide to confirm pickup')).toBeTruthy();
  });

  it('exposes an accessible button with the label', () => {
    const { getByRole } = render(
      <SlideToConfirm label="Slide to complete" onComplete={jest.fn()} />,
    );
    expect(getByRole('button', { name: 'Slide to complete' })).toBeTruthy();
  });

  it('calls onComplete via the accessibility activate action', () => {
    const onComplete = jest.fn();
    const { getByRole } = render(
      <SlideToConfirm label="Slide to complete" onComplete={onComplete} />,
    );
    activate(getByRole('button', { name: 'Slide to complete' }));
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('only completes once even if activated repeatedly', () => {
    const onComplete = jest.fn();
    const { getByRole } = render(
      <SlideToConfirm label="Slide to complete" onComplete={onComplete} />,
    );
    const button = getByRole('button', { name: 'Slide to complete' });
    activate(button);
    activate(button);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('does not complete while disabled', () => {
    const onComplete = jest.fn();
    const { getByRole } = render(
      <SlideToConfirm label="Slide to complete" onComplete={onComplete} disabled />,
    );
    activate(getByRole('button', { name: 'Slide to complete' }));
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('does not complete while loading', () => {
    const onComplete = jest.fn();
    const { getByRole } = render(
      <SlideToConfirm label="Slide to complete" onComplete={onComplete} loading />,
    );
    activate(getByRole('button', { name: 'Slide to complete' }));
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('reflects disabled and busy state for screen readers', () => {
    const { getByRole, rerender } = render(
      <SlideToConfirm label="Slide" onComplete={jest.fn()} disabled />,
    );
    expect(
      getByRole('button', { name: 'Slide' }).props.accessibilityState,
    ).toMatchObject({ disabled: true, busy: false });

    rerender(<SlideToConfirm label="Slide" onComplete={jest.fn()} loading />);
    expect(
      getByRole('button', { name: 'Slide' }).props.accessibilityState,
    ).toMatchObject({ disabled: true, busy: true });
  });
});
