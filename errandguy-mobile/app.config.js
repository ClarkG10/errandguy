/** @type {import('expo/config').ExpoConfig} */
module.exports = ({ config }) => {
  const { withEntitlementsPlist } = require('@expo/config-plugins');

  let updatedConfig = {
    ...config,
    // --- OTA updates (EAS Update) ---
    // JS-driven checks: the in-app useOtaUpdate hook owns the UX (auto on
    // launch + a manual "Check for updates" button + a critical force-update),
    // so we don't let expo-updates auto-check and block the splash.
    runtimeVersion: { policy: 'appVersion' },
    updates: {
      url: 'https://u.expo.dev/1684a4bc-4b59-47f4-a87e-3b3262438098',
      enabled: true,
      checkAutomatically: 'ON_ERROR_RECOVERY',
      fallbackToCacheTimeout: 0,
    },
    // Merge (don't clobber) the eas.projectId + router keys from app.json.
    // `ota.critical` rides along in the published update manifest; set
    // EXPO_OTA_CRITICAL=1 when publishing to force the update in-app.
    extra: {
      ...(config.extra || {}),
      ota: {
        critical: process.env.EXPO_OTA_CRITICAL === '1',
      },
    },
    plugins: [
      [
        'expo-router',
        {
          root: './src/app',
        },
      ],
      'expo-updates',
      'expo-secure-store',
      'expo-location',
      'expo-camera',
      'expo-image-picker',
      [
        // Registers the native contacts module + injects the iOS
        // NSContactsUsageDescription and Android READ_CONTACTS permission.
        // Without this the "Import from contacts" picker never opens (and on
        // iOS, calling the API with no usage string crashes the app).
        'expo-contacts',
        {
          contactsPermission:
            'ErrandGuy uses your contacts so you can quickly import a trusted contact for SOS.',
        },
      ],
      [
        'expo-media-library',
        {
          photosPermission: 'ErrandGuy needs photo library access to upload item photos.',
          savePhotosPermission: 'ErrandGuy saves chat images to your photo library when you tap Save.',
          isAccessMediaLocationEnabled: false,
        },
      ],
      'expo-font',
      'expo-web-browser',
      [
        'react-native-maps',
        {
          googleMapsApiKey: process.env.EXPO_PUBLIC_GOOGLE_MAPS_KEY,
          iosGoogleMapsApiKey: process.env.EXPO_PUBLIC_GOOGLE_MAPS_KEY,
          androidGoogleMapsApiKey: process.env.EXPO_PUBLIC_GOOGLE_MAPS_KEY,
        },
      ],
      'expo-image',
      [
        'expo-notifications',
        {
          // Android's status-bar notification icon is an alpha mask (every
          // opaque pixel renders as `color`), so reuse the monochrome brand
          // mark — pushes now show the ErrandGuy logo tinted brand-blue
          // instead of a generic white square. (iOS uses the app icon itself.)
          icon: './assets/android-monochrome.png',
          color: '#2563EB',
        },
      ],
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
