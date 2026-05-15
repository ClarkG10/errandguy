/** @type {import('expo/config').ExpoConfig} */
module.exports = ({ config }) => {
  const { withEntitlementsPlist } = require('@expo/config-plugins');

  let updatedConfig = {
    ...config,
    plugins: [
      [
        'expo-router',
        {
          root: './src/app',
        },
      ],
      'expo-secure-store',
      'expo-location',
      'expo-camera',
      'expo-image-picker',
      [
        'expo-media-library',
        {
          photosPermission: 'ErrandGuy needs photo library access to upload item photos.',
          savePhotosPermission: 'ErrandGuy saves chat images to your photo library when you tap Save.',
          isAccessMediaLocationEnabled: false,
        },
      ],
      'expo-font',
      [
        'react-native-maps',
        {
          googleMapsApiKey: process.env.EXPO_PUBLIC_GOOGLE_MAPS_KEY,
          iosGoogleMapsApiKey: process.env.EXPO_PUBLIC_GOOGLE_MAPS_KEY,
          androidGoogleMapsApiKey: process.env.EXPO_PUBLIC_GOOGLE_MAPS_KEY,
        },
      ],
      'expo-image',
      'expo-notifications',
    ],
  };

  // Remove aps-environment entitlement when not building via EAS.
  // Personal/free Apple accounts don't support Push Notifications capability.
  // EAS builds set the EAS_BUILD env var so they retain the entitlement.
  if (!process.env.EAS_BUILD) {
    updatedConfig = withEntitlementsPlist(updatedConfig, (conf) => {
      delete conf.modResults['aps-environment'];
      return conf;
    });
  }

  return updatedConfig;
};
