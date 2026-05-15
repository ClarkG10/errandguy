/** Shared map styling constants */

// Google Maps standard map style identifier (used for MapType)
export const MAP_STYLE_URL = 'standard'; // kept for compat; not used by react-native-maps

export const MAP_COLORS = {
  primary: '#2563EB',
  primaryLight: '#93C5FD',
  route: '#2563EB',
  routeOutline: '#1D4ED8',
  pickup: '#22C55E',
  dropoff: '#EF4444',
  marker: '#2563EB',
} as const;
