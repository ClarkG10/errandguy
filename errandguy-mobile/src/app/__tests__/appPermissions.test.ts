import fs from 'fs';
import path from 'path';

/**
 * Permissions the app never uses must not be requested — store review flags
 * them, and users rightly distrust an errand app that asks for the microphone
 * or "always" location. This build only ever:
 *   • reads FOREGROUND location (no background task, no
 *     requestBackgroundPermissionsAsync), and
 *   • takes PHOTOS (image picker `mediaTypes: ['images']`; no video, no audio,
 *     no in-app calls).
 *
 * The config side is pinned below; the source side is pinned too, so adding a
 * real use later fails here and forces the config to be revisited together.
 * (A changed permission set only ships with a new store build.)
 */
const ROOT = path.join(__dirname, '..', '..', '..');
const SRC = path.join(ROOT, 'src');
const appJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'app.json'), 'utf8')).expo;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const resolved = require(path.join(ROOT, 'app.config.js'))({ config: appJson });

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__') continue;
      sourceFiles(full, out);
    } else if (/\.tsx?$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}
const SOURCE = sourceFiles(SRC).map((f) => fs.readFileSync(f, 'utf8')).join('\n');

const pluginOptions = (name: string) => {
  const entry = (resolved.plugins as unknown[]).find(
    (p) => (Array.isArray(p) ? p[0] : p) === name,
  );
  return Array.isArray(entry) ? (entry[1] as Record<string, unknown>) : undefined;
};

describe('Android', () => {
  it('requests neither background location nor the microphone', () => {
    const perms: string[] = resolved.android.permissions;
    expect(perms).not.toContain('android.permission.ACCESS_BACKGROUND_LOCATION');
    expect(perms).not.toContain('android.permission.RECORD_AUDIO');
    expect(perms).toContain('android.permission.ACCESS_FINE_LOCATION');
  });

  it('blocks both, so a library manifest (expo-camera ships RECORD_AUDIO) can’t merge them back', () => {
    expect(resolved.android.blockedPermissions).toEqual(
      expect.arrayContaining([
        'android.permission.ACCESS_BACKGROUND_LOCATION',
        'android.permission.RECORD_AUDIO',
      ]),
    );
  });
});

describe('iOS', () => {
  it('declares only when-in-use location and no microphone usage string', () => {
    const plist = resolved.ios.infoPlist;
    expect(plist.NSLocationWhenInUseUsageDescription).toBeTruthy();
    expect(plist.NSLocationAlwaysAndWhenInUseUsageDescription).toBeUndefined();
    expect(plist.NSLocationAlwaysUsageDescription).toBeUndefined();
    expect(plist.NSMicrophoneUsageDescription).toBeUndefined();
  });

  it('tells the plugins to DELETE their default strings rather than fill them in', () => {
    expect(pluginOptions('expo-location')).toMatchObject({
      locationAlwaysAndWhenInUsePermission: false,
      locationAlwaysPermission: false,
      isIosBackgroundLocationEnabled: false,
      isAndroidBackgroundLocationEnabled: false,
    });
    expect(pluginOptions('expo-camera')).toMatchObject({
      microphonePermission: false,
      recordAudioAndroid: false,
    });
    expect(pluginOptions('expo-image-picker')).toMatchObject({ microphonePermission: false });
  });
});

describe('the source really doesn’t use them', () => {
  it('never asks for background location or runs a location task', () => {
    expect(SOURCE).not.toMatch(/requestBackgroundPermissionsAsync|startLocationUpdatesAsync|expo-task-manager/);
  });

  it('never records audio or picks video', () => {
    expect(SOURCE).not.toMatch(/expo-av|expo-audio|recordAsync|useMicrophonePermissions/);
    expect(SOURCE).not.toMatch(/mediaTypes:\s*\[[^\]]*'videos'/);
  });
});
