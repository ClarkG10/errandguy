import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { Phone, Shield, ShieldCheck } from 'lucide-react-native';
import { SlideToConfirm } from '../ui/SlideToConfirm';
import { LightColors } from '../../constants/colors';
import { formatTime } from '../../utils/formatDate';
import type { SosActiveRecord } from '../../services/sosActive';
import { EMERGENCY_NUMBER, dialNumber } from './emergency';
import type { SosCallableContact } from './SosPendingSheet';

/**
 * Who an acknowledged alert reached, said the way the SERVER said it.
 *
 * The current server writes the exact sentence ("ErrandGuy staff were alerted
 * by email and phone…") and the app repeats it. Without one (an older server,
 * whose only sentence was a blanket "contacts have been notified" that nobody
 * backed), the claim falls back to what is certain: ErrandGuy support has the
 * alert, plus any contacts the server itself listed as delivered.
 */
export function sosAlertedText(
  record: Pick<SosActiveRecord, 'alertedLine' | 'contacts'>,
): string {
  if (record.alertedLine) return record.alertedLine;
  const n = record.contacts.length;
  return n > 0
    ? `Alerted ErrandGuy support and ${n} trusted contact${n === 1 ? '' : 's'}.`
    : 'Alerted ErrandGuy support.';
}

/**
 * The label over the tap-to-call rows. Contacts are only described as messaged
 * when the server confirmed delivery; otherwise the label says plainly that
 * reaching them is the user's own call.
 */
export function sosContactsHeading(
  record: Pick<SosActiveRecord, 'alertedLine' | 'contacts'>,
): string {
  if (record.contacts.length > 0) return 'Call them too — tap a name:';
  if (record.alertedLine) return 'Your trusted contacts — tap to call:';
  return 'We haven’t messaged these people — tap to call:';
}

/** "SOS closed" sentence for an alert this device did not stand down. */
export function sosResolvedText(
  record: Pick<SosActiveRecord, 'resolvedAt' | 'resolvedBy'>,
): string {
  const at = record.resolvedAt ? formatTime(new Date(record.resolvedAt)) : null;
  if (record.resolvedBy === 'staff') {
    return at
      ? `ErrandGuy safety closed your alert at ${at}.`
      : 'ErrandGuy safety closed your alert.';
  }
  return 'Your SOS alert has been closed.';
}

interface SosActiveCardProps {
  record: SosActiveRecord;
  /** "2m 10s" since the raise, or null. */
  elapsedLabel: string | null;
  /** Cached trusted contacts (may be empty). */
  contacts: SosCallableContact[];
  onStandDown: () => void;
  standingDown: boolean;
  /** Bump to remount the (latching) slider after a failed stand-down. */
  standDownResetKey: number;
}

/**
 * The live alert. Three jobs, in order: say truthfully who has it, put a
 * voice call to 911 and to the person's own contacts one tap away, and keep
 * the "I'm safe" stand-down in reach. Rendered from the per-errand record, so
 * it is still here after the screen is left and reopened.
 */
export function SosActiveCard({
  record,
  elapsedLabel,
  contacts,
  onStandDown,
  standingDown,
  standDownResetKey,
}: SosActiveCardProps) {
  return (
    <View className="bg-dangerSoft border border-danger rounded-2xl p-4">
      <View className="flex-row items-center mb-1">
        <Shield size={18} color={LightColors.dangerDark} strokeWidth={2.4} />
        <Text
          className="ml-2 text-[15px] font-montserrat-bold text-dangerDark"
          maxFontSizeMultiplier={1.3}
        >
          SOS active
        </Text>
        {elapsedLabel ? (
          <Text
            className="ml-auto text-[12px] font-montserrat-semi text-dangerDark"
            style={{ fontVariant: ['tabular-nums'] }}
            maxFontSizeMultiplier={1.3}
          >
            {elapsedLabel}
          </Text>
        ) : null}
      </View>
      <Text
        className="text-[12px] font-montserrat text-dangerDark mb-3"
        style={{ lineHeight: 17 }}
        maxFontSizeMultiplier={1.3}
      >
        {sosAlertedText(record)} Stay safe — only stand down once you&apos;re out of
        danger.
      </Text>

      {/* 911 first: ErrandGuy staff are not an emergency service. */}
      <Pressable
        onPress={() => dialNumber(EMERGENCY_NUMBER)}
        accessibilityRole="button"
        accessibilityLabel={`Call ${EMERGENCY_NUMBER}`}
        className="flex-row items-center justify-center rounded-xl bg-danger px-4 py-3.5 mb-3"
        style={({ pressed }) => ({ opacity: pressed ? 0.9 : 1 })}
        android_ripple={{ color: 'rgba(255,255,255,0.18)' }}
      >
        <Phone size={18} color={LightColors.textInverse} strokeWidth={2.4} />
        <Text
          className="ml-2.5 text-[15px] font-montserrat-bold text-white"
          maxFontSizeMultiplier={1.3}
        >
          Call {EMERGENCY_NUMBER}
        </Text>
      </Pressable>

      {contacts.length > 0 ? (
        <View className="mb-3">
          <Text
            className="text-[12px] font-montserrat-semi text-dangerDark mb-1.5"
            maxFontSizeMultiplier={1.3}
          >
            {sosContactsHeading(record)}
          </Text>
          {contacts.map((c, i) => (
            <Pressable
              key={c.id ?? `${c.phone}-${i}`}
              accessibilityRole="button"
              accessibilityLabel={`Call ${c.name} at ${c.phone}`}
              onPress={() => dialNumber(c.phone)}
              className="flex-row items-center rounded-xl border border-danger bg-surface px-3 py-2.5 mb-1.5"
              style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
            >
              <Phone size={15} color={LightColors.dangerDark} strokeWidth={2.4} />
              <Text
                className="flex-1 ml-2 text-[13px] font-montserrat-semi text-dangerDark"
                numberOfLines={1}
                maxFontSizeMultiplier={1.3}
              >
                {c.name}
              </Text>
              <Text
                className="text-[12px] font-montserrat text-dangerDark"
                maxFontSizeMultiplier={1.3}
              >
                {c.phone}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      <SlideToConfirm
        key={`sos-standdown-${standDownResetKey}`}
        label="I’m safe — cancel alert"
        onComplete={onStandDown}
        loading={standingDown}
        color={LightColors.dangerDark}
      />
    </View>
  );
}

interface SosResolvedNoticeProps {
  record: SosActiveRecord;
  onDismiss: () => void;
}

/**
 * An alert someone else closed — staff, or the server no longer has it open.
 * Says so (and when), keeps 911 one tap away, and lets the person clear it.
 */
export function SosResolvedNotice({ record, onDismiss }: SosResolvedNoticeProps) {
  return (
    <View className="bg-surface border border-divider rounded-2xl p-4">
      <View className="flex-row items-center mb-1">
        <ShieldCheck size={18} color={LightColors.successDark} strokeWidth={2.4} />
        <Text
          className="ml-2 text-[15px] font-montserrat-bold text-textPrimary"
          maxFontSizeMultiplier={1.3}
        >
          SOS closed
        </Text>
      </View>
      <Text
        className="text-[12px] font-montserrat text-textSecondary"
        style={{ lineHeight: 17 }}
        maxFontSizeMultiplier={1.3}
      >
        {sosResolvedText(record)} Still need help? Call {EMERGENCY_NUMBER} or send a new
        SOS.
      </Text>
      <View className="flex-row mt-3" style={{ gap: 8 }}>
        <Pressable
          onPress={() => dialNumber(EMERGENCY_NUMBER)}
          accessibilityRole="button"
          accessibilityLabel={`Call ${EMERGENCY_NUMBER}`}
          className="flex-1 flex-row items-center justify-center rounded-xl border border-danger bg-dangerSoft px-3 py-2.5"
          style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
        >
          <Phone size={15} color={LightColors.dangerDark} strokeWidth={2.4} />
          <Text
            className="ml-2 text-[13px] font-montserrat-bold text-dangerDark"
            maxFontSizeMultiplier={1.3}
          >
            Call {EMERGENCY_NUMBER}
          </Text>
        </Pressable>
        <Pressable
          onPress={onDismiss}
          accessibilityRole="button"
          accessibilityLabel="Dismiss this notice"
          className="flex-1 items-center justify-center rounded-xl border border-dividerStrong bg-surface px-3 py-2.5"
          style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
        >
          <Text
            className="text-[13px] font-montserrat-semi text-textPrimary"
            maxFontSizeMultiplier={1.3}
          >
            Dismiss
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
