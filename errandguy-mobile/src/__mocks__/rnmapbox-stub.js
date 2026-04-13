// Stub for @rnmapbox/maps on web – the real package is native-only.
const noop = () => null;
const Mapbox = {
  MapView: noop,
  Camera: noop,
  PointAnnotation: noop,
  MarkerView: noop,
  ShapeSource: noop,
  LineLayer: noop,
  StyleURL: { Street: 'mapbox://styles/mapbox/streets-v12' },
  setAccessToken: () => {},
};
export default Mapbox;
export const MapView = noop;
export const Camera = noop;
export const PointAnnotation = noop;
export const MarkerView = noop;
export const ShapeSource = noop;
export const LineLayer = noop;
export const StyleURL = { Street: 'mapbox://styles/mapbox/streets-v12' };
export const setAccessToken = () => {};
