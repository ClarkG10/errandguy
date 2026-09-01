import React from 'react';
import { render, fireEvent, act } from '@testing-library/react-native';
import { Gesture } from 'react-native-gesture-handler';
import { SlideToConfirm } from '../SlideToConfirm';

/**
 * jest.setup.js stubs `Gesture.Pan` with a builder that only understands
 * onStart/onUpdate/onEnd, so it throws on the axis constraints this
 * control needs (`activeOffsetX` / `failOffsetY`). Widen the stub for
 * this file: same passthrough GestureDetector, but every builder method
 * is chainable. If a screen test ever renders SlideToConfirm, the global
 * stub in jest.setup.js needs the same treatment.
 */
jest.mock('react-native-gesture-handler', () => {
  const actual = jest.requireActual('react-native-gesture-handler');
  const RN = require('react-native');
  const CHAINABLE = [
    'activeOffsetX',
    'activeOffsetY',
    'failOffsetX',
    'failOffsetY',
    'minDistance',
    'hitSlop',
    'enabled',
    'shouldCancelWhenOutside',
    'simultaneousWithExternalGesture',
    'blocksExternalGesture',
    'onBegin',
    'onStart',
    'onUpdate',
    'onChange',
    'onEnd',
    'onFinalize',
  ];
  const builder = () => {
    const handler: Record<string, unknown> = {};
    CHAINABLE.forEach((name) => {
      handler[name] = jest.fn(function (this: unknown) {
        return this;
      });
    });
    return handler;
  };
  return {
    ...actual,
    GestureHandlerRootView: RN.View,
    GestureDetector: ({ children }: { children: React.ReactNode }) => children,
    Gesture: { Pan: jest.fn(() => builder()), Tap: jest.fn(() => builder()) },
  };
});

const activate = (element: any) =>
  fireEvent(element, 'accessibilityAction', {
    nativeEvent: { actionName: 'activate' },
  });

/**
 * GestureDetector is a passthrough and Gesture.Pan is a recording stub
 * (jest.setup.js), so a real drag can't be dispatched. These helpers
 * replay the callbacks the component registered on the LAST Pan it built
 * — the same sequence gesture-handler drives on device — which is the
 * only way to cover the grab-anywhere / threshold / min-travel rules.
 */
const lastPan = () => {
  const results = (Gesture.Pan as unknown as jest.Mock).mock.results;
  return results[results.length - 1].value;
};
const panHandler = (name: 'onStart' | 'onUpdate' | 'onEnd') =>
  lastPan()[name].mock.calls[0][0];

/** Give the track a real width so `maxX` is non-zero. */
const TRACK_W = 300;
// maxX = 300 - 48 (thumb) - 8 (padding) = 244
const MAX_X = TRACK_W - 48 - 8;

const layout = (element: any) =>
  fireEvent(element, 'layout', {
    nativeEvent: { layout: { width: TRACK_W, height: 56, x: 0, y: 0 } },
  });

/**
 * Replay a drag: the gesture activates at track x `startAt` after
 * `activationDx` points of horizontal slop (activeOffsetX), then the
 * finger ends up `dx` from where it first touched down.
 */
const drag = ({
  startAt,
  dx,
  activationDx = 0,
}: {
  startAt: number;
  dx: number;
  activationDx?: number;
}) =>
  act(() => {
    panHandler('onStart')({ x: startAt, translationX: activationDx });
    panHandler('onUpdate')({ translationX: dx });
    panHandler('onEnd')({ translationX: dx });
  });

/**
 * The tap surface is deliberately hidden from the accessibility tree
 * (so a TalkBack double-tap reaches the outer button and CONFIRMS rather
 * than nudging), and RNTL skips a11y-hidden elements by default — hence
 * `includeHiddenElements`.
 */
const tapSurface = (getByTestId: any) =>
  getByTestId('slider-track', { includeHiddenElements: true });

const renderTrack = (props: Partial<React.ComponentProps<typeof SlideToConfirm>> = {}) => {
  const utils = render(
    <SlideToConfirm
      label="Slide to complete"
      onComplete={jest.fn()}
      testID="slider"
      {...props}
    />,
  );
  layout(utils.getByTestId('slider'));
  return utils;
};

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

  describe('grabbing the track', () => {
    it('completes a full drag that starts on the thumb', () => {
      const onComplete = jest.fn();
      renderTrack({ onComplete });
      drag({ startAt: 20, dx: MAX_X });
      expect(onComplete).toHaveBeenCalledTimes(1);
    });

    it('completes a drag that starts on the bare track, not the thumb', () => {
      // The whole point of the change: a push from the middle of the
      // track used to be a dead touch (the pan lived on the thumb only).
      const onComplete = jest.fn();
      renderTrack({ onComplete });
      drag({ startAt: 150, dx: MAX_X });
      expect(onComplete).toHaveBeenCalledTimes(1);
    });

    it('resumes from the thumb after the activation slop, not 12pt ahead', () => {
      // activeOffsetX means translationX is already non-zero when onStart
      // runs; the start position has to be rebased or the thumb jumps the
      // slop forward (and the maths goes NaN if it is ignored entirely).
      const onComplete = jest.fn();
      renderTrack({ onComplete });
      drag({ startAt: 150, dx: MAX_X, activationDx: 12 });
      expect(onComplete).toHaveBeenCalledTimes(1);
    });

    it('completes at the 70% threshold (it used to need 85%)', () => {
      const onComplete = jest.fn();
      renderTrack({ onComplete });
      drag({ startAt: 20, dx: Math.ceil(MAX_X * 0.72) });
      expect(onComplete).toHaveBeenCalledTimes(1);
    });

    it('does not complete a drag that stops short of the threshold', () => {
      const onComplete = jest.fn();
      renderTrack({ onComplete });
      drag({ startAt: 20, dx: Math.floor(MAX_X * 0.6) });
      expect(onComplete).not.toHaveBeenCalled();
    });

    it('does not complete a jab at the far end of the track', () => {
      // Grabbing the track brings the thumb to the finger, so without the
      // minimum-travel rule a poke at the right edge would confirm a
      // money-affecting, hard-to-undo transition.
      const onComplete = jest.fn();
      renderTrack({ onComplete });
      drag({ startAt: TRACK_W - 10, dx: 4 });
      expect(onComplete).not.toHaveBeenCalled();
    });

    it('does not complete while locked', () => {
      const onComplete = jest.fn();
      renderTrack({ onComplete, disabled: true });
      drag({ startAt: 20, dx: MAX_X });
      expect(onComplete).not.toHaveBeenCalled();
    });
  });

  describe('feedback when the gesture falls short', () => {
    it('answers a tap on the track with a hint instead of nothing', () => {
      const onComplete = jest.fn();
      const { getByTestId, getByText, queryByText } = renderTrack({ onComplete });
      expect(queryByText("Slide, don't tap")).toBeNull();
      fireEvent.press(tapSurface(getByTestId));
      expect(getByText("Slide, don't tap")).toBeTruthy();
      expect(onComplete).not.toHaveBeenCalled();
    });

    it('hints after a drag that stops short', () => {
      const { getByText } = renderTrack();
      drag({ startAt: 20, dx: Math.floor(MAX_X * 0.5) });
      expect(getByText('Slide all the way')).toBeTruthy();
    });

    it('restores the label after the hint expires', () => {
      jest.useFakeTimers();
      try {
        const { getByTestId, getByText } = renderTrack();
        fireEvent.press(tapSurface(getByTestId));
        expect(getByText("Slide, don't tap")).toBeTruthy();
        act(() => {
          jest.advanceTimersByTime(2000);
        });
        expect(getByText('Slide to complete')).toBeTruthy();
      } finally {
        jest.useRealTimers();
      }
    });

    it('does not hint or nudge once the slide has completed', () => {
      const onComplete = jest.fn();
      const { getByTestId, queryByText } = renderTrack({ onComplete });
      drag({ startAt: 20, dx: MAX_X });
      fireEvent.press(tapSurface(getByTestId));
      expect(queryByText("Slide, don't tap")).toBeNull();
      expect(onComplete).toHaveBeenCalledTimes(1);
    });

    it('keeps the tap surface out of the accessibility tree', () => {
      // A TalkBack double-tap must reach the outer button (confirm), not
      // this nudge affordance.
      const { getByTestId, queryByTestId } = renderTrack();
      expect(queryByTestId('slider-track')).toBeNull();
      expect(tapSurface(getByTestId).props.importantForAccessibility).toBe(
        'no-hide-descendants',
      );
    });

    it('ignores taps while locked', () => {
      const { getByTestId, queryByText } = renderTrack({ loading: true });
      fireEvent.press(tapSurface(getByTestId));
      expect(queryByText("Slide, don't tap")).toBeNull();
    });
  });
});
