import React from 'react';
import { View, Text, Linking, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { MapPin, Camera, Bell, Image as ImageIcon, type LucideIcon } from 'lucide-react-native';
import { BottomSheet } from './BottomSheet';
import { Button } from './Button';
import { LightColors } from '../../constants/colors';

export type PermissionKind = 'location' | 'camera' | 'photos' | 'notifications';

const KIND: Record<PermissionKind, { icon: LucideIcon; title: string; reason: string; settingsHint: string }> = {
  location: {
    icon: MapPin,
    title: 'Location is off for ErrandGuy',
    reason: 'ErrandGuy uses your location only while you use the app, to match errands and show where you are.',
    settingsHint: "Opens this app's settings, where you can turn on location",
  },
  camera: {
    icon: Camera,
    title: 'Camera is off for ErrandGuy',
    reason: 'ErrandGuy uses the camera only to take the photos you choose to send.',
    settingsHint: "Opens this app's settings, where you can turn on the camera",
  },
  photos: {
    icon: ImageIcon,
    title: 'Photo access is off for ErrandGuy',
    reason: 'ErrandGuy only opens your photos to attach the one you pick.',
    settingsHint: "Opens this app's settings, where you can allow photo access",
  },
  notifications: {
    icon: Bell,
    title: 'Notifications are off for ErrandGuy',
    reason: 'ErrandGuy only notifies you about your errands, like a new offer or a runner on the way.',
    settingsHint: "Opens this app's settings, where you can turn on notifications",
  },
};

export interface PermissionPromptProps {
  kind: PermissionKind;
  /** Headline. Defaults to "<Thing> is off for ErrandGuy". */
  title?: string;
  /** The one honest sentence on why the app needs it. Defaults per kind. */
  reason?: string;
  /** The way forward that needs no permission, e.g. "Type the address instead". */
  alternativeLabel?: string;
  onAlternative?: () => void;
  /** Replaces the default `Linking.openSettings()` (e.g. to also close a sheet). */
  onOpenSettings?: () => void;
  settingsLabel?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

function openAppSettings() {
  Linking.openSettings().catch(() => {});
}

/**
 * Pattern 7 (permission denied) — the body of the sheet, for embedding inside
 * a sheet or modal that is already on screen (a camera sheet whose camera was
 * refused). Icon in a soft circle, a specific headline, one honest sentence,
 * [Allow in Settings] and an outline alternative.
 */
export function PermissionPrompt({
  kind,
  title,
  reason,
  alternativeLabel,
  onAlternative,
  onOpenSettings,
  settingsLabel = 'Allow in Settings',
  style,
  testID,
}: PermissionPromptProps) {
  const meta = KIND[kind];
  const Icon = meta.icon;
  return (
    <View style={[s.wrap, style]} testID={testID}>
      <View style={s.circle} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Icon size={40} color={LightColors.primary} strokeWidth={1.75} />
      </View>
      <Text style={s.title} accessibilityRole="header">
        {title ?? meta.title}
      </Text>
      <Text style={s.reason}>{reason ?? meta.reason}</Text>
      <View style={s.actions}>
        <Button
          title={settingsLabel}
          fullWidth
          size="lg"
          onPress={onOpenSettings ?? openAppSettings}
          accessibilityHint={meta.settingsHint}
        />
        {alternativeLabel && onAlternative ? (
          <Button title={alternativeLabel} variant="outline" fullWidth size="lg" onPress={onAlternative} />
        ) : null}
      </View>
    </View>
  );
}

interface PermissionSheetProps extends Omit<PermissionPromptProps, 'style'> {
  isVisible: boolean;
  onClose: () => void;
  /** Sheet height as a fraction of the screen. */
  snapPoint?: number;
}

/**
 * Pattern 7 as a bottom sheet: shown when the OS has refused a permission and
 * won't ask again. "Allow in Settings" deep-links to the app's settings page;
 * the outline button is the path that needs no permission at all, or
 * "Not now" when there isn't one.
 *
 *   <PermissionSheet isVisible={denied} onClose={…} kind="location"
 *     alternativeLabel="Type the address instead" onAlternative={…} />
 */
export function PermissionSheet({
  isVisible,
  onClose,
  snapPoint = 0.5,
  alternativeLabel,
  onAlternative,
  ...prompt
}: PermissionSheetProps) {
  return (
    <BottomSheet isVisible={isVisible} onClose={onClose} snapPoints={[snapPoint]} scrollable>
      <PermissionPrompt
        {...prompt}
        alternativeLabel={alternativeLabel ?? 'Not now'}
        onAlternative={onAlternative ?? onClose}
      />
    </BottomSheet>
  );
}

const s = StyleSheet.create({
  wrap: { alignItems: 'center', paddingHorizontal: 8, paddingTop: 8 },
  circle: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: LightColors.primary50,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    marginTop: 20,
    fontSize: 20,
    lineHeight: 26,
    letterSpacing: -0.3,
    textAlign: 'center',
    fontFamily: 'Quicksand_700Bold',
    color: LightColors.textPrimary,
  },
  reason: {
    marginTop: 8,
    fontSize: 15,
    lineHeight: 21,
    textAlign: 'center',
    fontFamily: 'Quicksand_400Regular',
    color: LightColors.textSecondary,
    maxWidth: 340,
  },
  actions: { alignSelf: 'stretch', gap: 10, marginTop: 24 },
});
