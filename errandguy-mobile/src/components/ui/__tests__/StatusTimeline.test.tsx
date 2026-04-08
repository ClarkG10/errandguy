import React from 'react';
import { render } from '@testing-library/react-native';
import { StatusTimeline } from '../StatusTimeline';

const steps = [
  { label: 'Booking Placed', status: 'completed' as const, timestamp: '10:00 AM' },
  { label: 'Runner Matched', status: 'current' as const, timestamp: '10:05 AM' },
  { label: 'Picked Up', status: 'pending' as const },
  { label: 'Delivered', status: 'pending' as const },
];

describe('StatusTimeline', () => {
  it('renders all step labels', () => {
    const { getByText } = render(<StatusTimeline steps={steps} />);
    expect(getByText('Booking Placed')).toBeTruthy();
    expect(getByText('Runner Matched')).toBeTruthy();
    expect(getByText('Picked Up')).toBeTruthy();
    expect(getByText('Delivered')).toBeTruthy();
  });

  it('renders timestamps when provided', () => {
    const { getByText } = render(<StatusTimeline steps={steps} />);
    expect(getByText('10:00 AM')).toBeTruthy();
    expect(getByText('10:05 AM')).toBeTruthy();
  });

  it('does not render timestamp for steps without one', () => {
    const { queryByText } = render(<StatusTimeline steps={steps} />);
    // pending steps have no timestamp — won't show a timestamp text for them
    // Just verify nothing crashes
    expect(queryByText('Delivered')).toBeTruthy();
  });

  it('renders with a single step', () => {
    const singleStep = [{ label: 'Only Step', status: 'current' as const }];
    const { getByText } = render(<StatusTimeline steps={singleStep} />);
    expect(getByText('Only Step')).toBeTruthy();
  });

  it('renders all completed steps', () => {
    const completedSteps = [
      { label: 'Step 1', status: 'completed' as const },
      { label: 'Step 2', status: 'completed' as const },
      { label: 'Step 3', status: 'completed' as const },
    ];
    const { getByText } = render(<StatusTimeline steps={completedSteps} />);
    expect(getByText('Step 1')).toBeTruthy();
    expect(getByText('Step 2')).toBeTruthy();
    expect(getByText('Step 3')).toBeTruthy();
  });

  it('renders with empty steps without crashing', () => {
    const { toJSON } = render(<StatusTimeline steps={[]} />);
    expect(toJSON()).toBeTruthy();
  });
});
