import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import type { LucideIcon } from 'lucide-react-native';

interface TabBarItemProps {
  Icon: LucideIcon;
  label: string;
  focused: boolean;
  badgeCount?: number;
  showOnlineDot?: boolean;
}

const ACTIVE = '#2563EB';
const INACTIVE = '#94A3B8';

/**
 * A single tab-bar entry. Matches the iOS / Material 3 spec:
 *  - icon centred above a small label,
 *  - 22px icon (consistent on iOS and Android),
 *  - active color shift only — no decorative pill behind the icon,
 *  - subtle 2px underline below to anchor the active item.
 *
 * Centralising the renderer here keeps the customer and runner tab
 * groups visually identical and prevents per-platform sizing drift.
 */
export function TabBarItem({
  Icon,
  label,
  focused,
  badgeCount,
  showOnlineDot,
}: TabBarItemProps) {
  const color = focused ? ACTIVE : INACTIVE;

  return (
    <View style={s.wrap}>
      <View style={s.iconBox}>
        <Icon size={22} color={color} strokeWidth={focused ? 2.2 : 1.8} />
        {!!badgeCount && badgeCount > 0 && (
          <View style={s.badge}>
            <Text style={s.badgeText} allowFontScaling={false}>
              {badgeCount > 9 ? '9+' : String(badgeCount)}
            </Text>
          </View>
        )}
        {showOnlineDot && <View style={s.onlineDot} />}
      </View>
      <Text
        allowFontScaling={false}
        style={[s.label, { color, fontWeight: focused ? '700' : '500' }]}
        numberOfLines={1}
      >
        {label}
      </Text>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: {
    width: 64,
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingTop: 6,
  },
  iconBox: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  label: {
    marginTop: 2,
    fontSize: 10.5,
    letterSpacing: 0.1,
    fontFamily: 'Quicksand_500Medium',
  },
  badge: {
    position: 'absolute',
    top: -2,
    right: -4,
    minWidth: 16,
    height: 16,
    paddingHorizontal: 4,
    borderRadius: 8,
    backgroundColor: '#EF4444',
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    color: '#FFFFFF',
    fontSize: 9,
    fontFamily: 'Quicksand_700Bold',
    lineHeight: 11,
  },
  onlineDot: {
    position: 'absolute',
    top: 1,
    right: 1,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#22C55E',
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
  },
});
