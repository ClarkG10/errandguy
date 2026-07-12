import React from 'react';
import { RefreshControl, type RefreshControlProps } from 'react-native';
import { LightColors } from '../../constants/colors';

/**
 * RefreshControl pinned to the brand blue spinner (iOS tintColor,
 * Android colors) so pull-to-refresh looks identical on every list —
 * screens stop hand-rolling (or forgetting) the tint props.
 */
export function BrandRefreshControl(props: RefreshControlProps) {
  return (
    <RefreshControl
      {...props}
      tintColor={LightColors.primary}
      colors={[LightColors.primary]}
    />
  );
}
