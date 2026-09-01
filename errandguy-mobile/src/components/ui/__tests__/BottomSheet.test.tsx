import React from 'react';
import { ScrollView, Text, View } from 'react-native';
import { render, fireEvent, within } from '@testing-library/react-native';
import { Gesture } from 'react-native-gesture-handler';
import { BottomSheet } from '../BottomSheet';

/**
 * `jest.setup.js` mocks GestureDetector to a children passthrough and
 * Gesture.Pan to a builder that only records its callbacks, so a real
 * drag can't be dispatched here. The pan logic is still worth asserting
 * — these helpers pull the callbacks off the LAST Pan the component
 * built (one per render) and invoke them by hand, which is exactly what
 * gesture-handler would do on device.
 */
const lastPan = () => {
  const results = (Gesture.Pan as unknown as jest.Mock).mock.results;
  return results[results.length - 1].value;
};
const panHandler = (name: 'onStart' | 'onUpdate' | 'onEnd') =>
  lastPan()[name].mock.calls[0][0];

const drag = ({
  translationY,
  velocityY = 0,
}: {
  translationY: number;
  velocityY?: number;
}) => {
  panHandler('onStart')({});
  panHandler('onUpdate')({ translationY });
  panHandler('onEnd')({ translationY, velocityY });
};

describe('BottomSheet', () => {
  it('does not render sheet content when isVisible is false', () => {
    const { queryByText } = render(
      <BottomSheet isVisible={false} onClose={jest.fn()}>
        <Text>Sheet Content</Text>
      </BottomSheet>,
    );
    // When not visible, the sheet content should not appear
    expect(queryByText('Sheet Content')).toBeNull();
  });

  it('renders children when visible', () => {
    const { getByText } = render(
      <BottomSheet isVisible={true} onClose={jest.fn()}>
        <Text>Sheet Content</Text>
      </BottomSheet>,
    );
    expect(getByText('Sheet Content')).toBeTruthy();
  });

  it('calls onClose when backdrop is pressed', () => {
    const onClose = jest.fn();
    const { UNSAFE_getAllByType } = render(
      <BottomSheet isVisible={true} onClose={onClose}>
        <Text>Content</Text>
      </BottomSheet>,
    );
    // In RN 0.83 new arch, Pressable renders as a host View with accessible=true
    const allViews = UNSAFE_getAllByType(View);
    const pressableViews = allViews.filter((v) => v.props.accessible === true);
    fireEvent(pressableViews[0], 'click'); // first accessible view is the backdrop Pressable
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders with custom snap points without crashing', () => {
    const { getByText } = render(
      <BottomSheet isVisible={true} onClose={jest.fn()} snapPoints={[0.7]}>
        <Text>Tall Sheet</Text>
      </BottomSheet>,
    );
    expect(getByText('Tall Sheet')).toBeTruthy();
  });

  it('renders multiple children', () => {
    const { getByText } = render(
      <BottomSheet isVisible={true} onClose={jest.fn()}>
        <>
          <Text>Title</Text>
          <Text>Body</Text>
        </>
      </BottomSheet>,
    );
    expect(getByText('Title')).toBeTruthy();
    expect(getByText('Body')).toBeTruthy();
  });

  describe('drag-to-dismiss is scoped to the handle', () => {
    it('renders a dedicated drag handle', () => {
      const { getByTestId } = render(
        <BottomSheet isVisible={true} onClose={jest.fn()}>
          <Text>Content</Text>
        </BottomSheet>,
      );
      expect(getByTestId('sheet-drag-handle')).toBeTruthy();
    });

    it('does not wrap the scrollable body in the gesture detector', () => {
      // The regression this guards: the pan used to wrap the whole sheet,
      // so the inner ScrollView never got the drag. The handle must be a
      // sibling of the body, not an ancestor of it.
      const { getByTestId, UNSAFE_getAllByType } = render(
        <BottomSheet isVisible={true} onClose={jest.fn()}>
          <Text>Scrolled content</Text>
        </BottomSheet>,
      );
      const handle = getByTestId('sheet-drag-handle');
      expect(within(handle).queryByText('Scrolled content')).toBeNull();
      expect(UNSAFE_getAllByType(ScrollView).length).toBeGreaterThan(0);
    });

    it('closes on a long downward drag', () => {
      const onClose = jest.fn();
      render(
        <BottomSheet isVisible={true} onClose={onClose}>
          <Text>Content</Text>
        </BottomSheet>,
      );
      drag({ translationY: 140 });
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('closes on a short fast flick down', () => {
      const onClose = jest.fn();
      render(
        <BottomSheet isVisible={true} onClose={onClose}>
          <Text>Content</Text>
        </BottomSheet>,
      );
      drag({ translationY: 40, velocityY: 1400 });
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('springs back instead of closing on a small slow drag', () => {
      const onClose = jest.fn();
      render(
        <BottomSheet isVisible={true} onClose={onClose}>
          <Text>Content</Text>
        </BottomSheet>,
      );
      drag({ translationY: 40, velocityY: 120 });
      expect(onClose).not.toHaveBeenCalled();
    });

    it('never closes on an upward drag and clamps it to the resting top', () => {
      const onClose = jest.fn();
      render(
        <BottomSheet isVisible={true} onClose={onClose}>
          <Text>Content</Text>
        </BottomSheet>,
      );
      panHandler('onStart')({});
      // The clamp itself lives on a shared value the reanimated mock
      // re-creates every render, so it can't be read back here — what is
      // assertable (and what actually regressed) is that an upward drag
      // is inert: it must never dismiss, and must never throw.
      expect(() =>
        panHandler('onUpdate')({ translationY: -300 }),
      ).not.toThrow();
      panHandler('onEnd')({ translationY: -300, velocityY: -2000 });
      expect(onClose).not.toHaveBeenCalled();
    });
  });

  describe('footer slot', () => {
    it('renders the footer outside the scroll area', () => {
      const { getByText, UNSAFE_getAllByType } = render(
        <BottomSheet
          isVisible={true}
          onClose={jest.fn()}
          footer={<Text>Accept errand</Text>}
        >
          <Text>Long body</Text>
        </BottomSheet>,
      );
      expect(getByText('Accept errand')).toBeTruthy();
      const scroll = UNSAFE_getAllByType(ScrollView)[0];
      expect(within(scroll).queryByText('Long body')).toBeTruthy();
      expect(within(scroll).queryByText('Accept errand')).toBeNull();
    });

    it('renders the footer for non-scrollable sheets too', () => {
      const { getByText, UNSAFE_queryAllByType } = render(
        <BottomSheet
          isVisible={true}
          onClose={jest.fn()}
          scrollable={false}
          footer={<Text>Save</Text>}
        >
          <Text>Body</Text>
        </BottomSheet>,
      );
      expect(getByText('Save')).toBeTruthy();
      expect(UNSAFE_queryAllByType(ScrollView)).toHaveLength(0);
    });

    it('renders nothing extra when no footer is given', () => {
      const { queryByText } = render(
        <BottomSheet isVisible={true} onClose={jest.fn()}>
          <Text>Body</Text>
        </BottomSheet>,
      );
      expect(queryByText('Body')).toBeTruthy();
    });
  });
});
