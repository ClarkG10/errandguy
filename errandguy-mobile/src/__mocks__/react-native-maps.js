// Stub for react-native-maps on web – the real package is native-only.
const React = require('react');
const { View } = require('react-native');
const noop = () => null;
const MapView = React.forwardRef((props, ref) => React.createElement(View, { ...props, ref }));
MapView.Animated = MapView;
module.exports = {
  default: MapView,
  __esModule: true,
  MapView,
  Marker: noop,
  Polyline: noop,
  Circle: noop,
  PROVIDER_GOOGLE: 'google',
  PROVIDER_DEFAULT: null,
};
