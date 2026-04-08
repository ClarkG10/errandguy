import React from 'react';
import { Text, View } from 'react-native';
import { render, fireEvent } from '@testing-library/react-native';
import { BottomSheet } from '../BottomSheet';

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
});
