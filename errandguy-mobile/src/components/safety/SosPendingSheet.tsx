import React, { useCallback } from 'react';
import { View, Text, Pressable, Modal, Linking } from 'react-native';
import { Phone, ShieldAlert, RefreshCw } from 'lucide-react-native';
import { Button } from '../ui/Button';
import { LightColors } from '../../constants/colors';
import { haptics } from '../../utils/haptics';
import { toast } from '../../stores/toastStore';

/**
 * The honest failure state of the panic button.
 *
 * Before this, a dead-zone SOS resolved to `toast.error("You're offline —
 * check your connection and try again")` and the intent was thrown away. Now
 * the raise is persisted and retried (see `services/sosIntent.ts`), so this
 * sheet's whole job is to tell the truth about that and to offer the two
 * things that DO work without data: a voice call to 911, and a voice call to
 * a trusted contact whose number is already cached on-device.
 *
 * Copy rules (deliberate, do not soften):
 *   • never say the alert was sent — it hasn't been;
 *   • never say contacts were notified — tapping a row places a call that the
 *     USER makes, and the row says so.
 */

export interface SosCallableContact {
  id?: string;
  name: string;
  phone: string;
}

interface SosPendingSheetProps {
  visible: boolean;
  /** Cached trusted contacts (name + number). May be empty. */
  contacts: SosCallableContact[];
  /** Attempts made so far, for an honest "still trying" line. */
  attempts: number;
  /** True while an attempt is in flight. */
  sending: boolean;
  /** Manual "try sending now". */
  onRetry: () => void;
  /** Drop the queued alert (also used by "I'm safe"). */
  onCancelAlert: () => void;
  /** Leave the sheet — the retry loop keeps running in the background. */
  onClose: () => void;
}

/** National emergency hotline (Philippines). Voice works where data doesn't. */
const EMERGENCY_NUMBER = '911';

export function SosPendingSheet({
  visible,
  contacts,
  attempts,
  sending,
  onRetry,
  onCancelAlert,
  onClose,
}: SosPendingSheetProps) {
  const dial = useCallback((number: string) => {
    haptics.warning();
    const tel = `tel:${number.replace(/[^0-9+#*]/g, '')}`;
    Linking.openURL(tel).catch(() => {
      toast.error(`Couldn’t open the dialler — call ${number}`);
    });
  }, []);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View
        style={{
          flex: 1,
          justifyContent: 'center',
          alignItems: 'center',
          paddingHorizontal: 24,
          backgroundColor: `${LightColors.ink}73`,
        }}
      >
        <View style={{ width: '100%', maxWidth: 400 }}>
          <View
            style={{
              backgroundColor: LightColors.surface,
              borderRadius: 20,
              paddingHorizontal: 22,
              paddingTop: 24,
              paddingBottom: 20,
            }}
          >
            <View className="flex-row items-center mb-2">
              <View
                className="w-11 h-11 rounded-full items-center justify-center mr-3"
                style={{ backgroundColor: LightColors.dangerSoft }}
              >
                <ShieldAlert size={22} color={LightColors.dangerDark} strokeWidth={2.3} />
              </View>
              <View className="flex-1">
                <Text
                  className="text-[16px] font-montserrat-bold text-textPrimary"
                  maxFontSizeMultiplier={1.3}
                >
                  Alert not sent yet
                </Text>
                <Text
                  className="text-[12px] font-montserrat text-textSecondary mt-0.5"
                  maxFontSizeMultiplier={1.3}
                >
                  {sending
                    ? 'Sending…'
                    : attempts > 1
                      ? `We’ll keep trying (${attempts} tries so far)`
                      : 'We’ll keep trying'}
                </Text>
              </View>
            </View>

            <Text
              className="text-[13px] font-montserrat text-textSecondary"
              style={{ lineHeight: 19 }}
              maxFontSizeMultiplier={1.4}
            >
              There’s no connection right now. Your SOS is saved and will send
              itself the moment there’s signal — even if you close the app. Calls
              often work when data doesn’t:
            </Text>

            {/* Voice fallbacks — the only things that work with no data. */}
            <Pressable
              onPress={() => dial(EMERGENCY_NUMBER)}
              accessibilityRole="button"
              accessibilityLabel="Call 911"
              className="flex-row items-center rounded-xl bg-danger px-4 py-3.5 mt-4"
              style={({ pressed }) => ({ opacity: pressed ? 0.9 : 1 })}
              android_ripple={{ color: 'rgba(255,255,255,0.18)' }}
            >
              <Phone size={18} color={LightColors.textInverse} strokeWidth={2.4} />
              <Text className="ml-2.5 text-[15px] font-montserrat-bold text-white">
                Call 911
              </Text>
            </Pressable>

            {contacts.length > 0 && (
              <View className="mt-3">
                <Text
                  className="text-[11px] font-montserrat-bold uppercase text-textTertiary mb-2"
                  style={{ letterSpacing: 1 }}
                  maxFontSizeMultiplier={1.3}
                >
                  Your trusted contacts
                </Text>
                {contacts.slice(0, 3).map((c, i) => (
                  <Pressable
                    key={c.id ?? `${c.phone}-${i}`}
                    onPress={() => dial(c.phone)}
                    accessibilityRole="button"
                    accessibilityLabel={`Call ${c.name} at ${c.phone}`}
                    className="flex-row items-center rounded-xl border border-divider bg-surfaceMuted px-4 py-3 mb-2"
                    style={({ pressed }) => ({ opacity: pressed ? 0.8 : 1 })}
                  >
                    <Phone size={16} color={LightColors.dangerDark} strokeWidth={2.2} />
                    <View className="flex-1 ml-3">
                      <Text
                        className="text-[14px] font-montserrat-bold text-textPrimary"
                        numberOfLines={1}
                      >
                        {c.name}
                      </Text>
                      <Text
                        className="text-[12px] font-inter text-textSecondary mt-0.5"
                        numberOfLines={1}
                      >
                        {c.phone}
                      </Text>
                    </View>
                  </Pressable>
                ))}
                <Text
                  className="text-[11px] font-montserrat text-textTertiary"
                  style={{ lineHeight: 15 }}
                  maxFontSizeMultiplier={1.3}
                >
                  Tapping a contact places the call yourself — they haven’t been
                  alerted.
                </Text>
              </View>
            )}

            <View style={{ gap: 8, marginTop: 18 }}>
              <Pressable
                onPress={onRetry}
                disabled={sending}
                accessibilityRole="button"
                accessibilityLabel="Try sending the alert now"
                className="flex-row items-center justify-center rounded-xl border border-dividerStrong bg-surface px-4 py-3"
                style={({ pressed }) => ({
                  opacity: sending ? 0.6 : pressed ? 0.85 : 1,
                })}
              >
                <RefreshCw size={15} color={LightColors.textPrimary} strokeWidth={2.2} />
                <Text className="ml-2 text-[14px] font-montserrat-bold text-textPrimary">
                  {sending ? 'Sending…' : 'Try sending now'}
                </Text>
              </Pressable>
              <Button
                title="Keep trying in the background"
                variant="ghost"
                fullWidth
                onPress={onClose}
              />
              <Pressable
                onPress={onCancelAlert}
                accessibilityRole="button"
                accessibilityLabel="Cancel the queued alert"
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                className="self-center"
                style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
              >
                <Text
                  className="text-[13px] font-montserrat-semi text-textTertiary"
                  maxFontSizeMultiplier={1.3}
                >
                  I’m safe — cancel this alert
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}
