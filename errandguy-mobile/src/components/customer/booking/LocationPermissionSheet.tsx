import React from 'react';
import { View, Text, Linking } from 'react-native';
import { MapPin } from 'lucide-react-native';
import { BottomSheet } from '../../ui/BottomSheet';
import { Button } from '../../ui/Button';
import { LightColors } from '../../../constants/colors';

interface LocationPermissionSheetProps {
  isVisible: boolean;
  onClose: () => void;
  /** What the location would have filled in, lower case ("pickup", "store"). */
  placeLabel: string;
  /** The way forward without location: close and focus the address search. */
  onTypeAddress: () => void;
}

/**
 * Location permission was refused. A sheet that says, in one honest
 * sentence, why the app asked; offers the fix (the phone's Settings — the OS
 * won't ask again); and the alternative that needs no permission at all:
 * typing the address.
 */
export function LocationPermissionSheet({
  isVisible,
  onClose,
  placeLabel,
  onTypeAddress,
}: LocationPermissionSheetProps) {
  return (
    <BottomSheet
      isVisible={isVisible}
      onClose={onClose}
      snapPoints={[0.47]}
      scrollable={false}
      footer={
        <View style={{ gap: 10 }}>
          <Button
            title="Allow in Settings"
            fullWidth
            onPress={() => {
              Linking.openSettings().catch(() => {});
            }}
            accessibilityHint="Opens this app's settings, where you can turn on location"
          />
          <Button title="Type the address instead" variant="outline" fullWidth onPress={onTypeAddress} />
        </View>
      }
    >
      <View className="items-center px-2 pt-2">
        <View
          style={{
            width: 96,
            height: 96,
            borderRadius: 48,
            backgroundColor: LightColors.primary50,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <MapPin size={40} color={LightColors.primary} strokeWidth={1.75} />
        </View>
        <Text
          accessibilityRole="header"
          className="text-[20px] font-montserrat-bold text-textPrimary text-center mt-5"
        >
          Location is off for ErrandGuy
        </Text>
        <Text className="text-[14px] font-montserrat text-textSecondary text-center mt-2 leading-[20px]">
          {`ErrandGuy uses your location only to set your ${placeLabel} and show your runner where you are.`}
        </Text>
      </View>
    </BottomSheet>
  );
}
