import React from 'react';
import { View } from 'react-native';
import { render, fireEvent } from '@testing-library/react-native';
import { RatingStars } from '../RatingStars';

describe('RatingStars', () => {
  // In RN 0.83 new arch, Pressable renders as a host View with accessible=true and onClick
  const getStarElements = (renderResult: ReturnType<typeof render>) => {
    const allViews = renderResult.UNSAFE_getAllByType(View);
    return allViews.filter((v) => v.props.accessible === true);
  };

  it('renders 5 stars', () => {
    const result = render(<RatingStars value={3} />);
    expect(getStarElements(result)).toHaveLength(5);
  });

  it('calls onChange when a star is pressed in interactive mode', () => {
    const onChange = jest.fn();
    const result = render(<RatingStars value={2} onChange={onChange} />);
    const stars = getStarElements(result);
    fireEvent(stars[4], 'click'); // press 5th star -> value 5
    expect(onChange).toHaveBeenCalledWith(5);
  });

  it('does not call onChange in readonly mode', () => {
    const onChange = jest.fn();
    const result = render(
      <RatingStars value={3} onChange={onChange} readonly={true} />,
    );
    const stars = getStarElements(result);
    fireEvent(stars[0], 'click');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('renders with default value 0 without crashing', () => {
    const result = render(<RatingStars value={0} />);
    expect(getStarElements(result)).toHaveLength(5);
  });

  it('renders correctly with full rating of 5', () => {
    const result = render(<RatingStars value={5} />);
    expect(getStarElements(result)).toHaveLength(5);
  });

  it('calls onChange with correct star number', () => {
    const onChange = jest.fn();
    const result = render(<RatingStars value={0} onChange={onChange} />);
    const stars = getStarElements(result);
    fireEvent(stars[2], 'click'); // press 3rd star -> value 3
    expect(onChange).toHaveBeenCalledWith(3);
  });
});
