import React from 'react';
import { View, Text, Pressable } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Check, Landmark } from 'lucide-react-native';
import { Input } from '../ui/Input';
import { PaymentBrandMark } from '../customer/PaymentBrandMark';
import { LightColors } from '../../constants/colors';
import { Radius } from '../../constants/radius';
import {
  OTHER_BANK,
  PAYOUT_CHANNEL_LABELS,
  PH_BANKS,
  knownBank,
  type PayoutDestinationDraft,
  type PayoutDestinationErrors,
} from '../../utils/payoutDestination';
import type { PayoutChannel } from '../../types';

interface PayoutDestinationFormProps {
  value: PayoutDestinationDraft;
  onChange: (next: PayoutDestinationDraft) => void;
  /** GCash and Maya always; a bank account only where the server allows it. */
  channels: readonly PayoutChannel[];
  errors?: PayoutDestinationErrors;
}

/**
 * Where money goes out to: GCash, Maya or (where allowed) a bank account, then
 * the number and the account holder's name. Used by a customer's withdrawal,
 * a runner's payout method and account deletion, so all three ask the same
 * questions in the same order.
 */
export function PayoutDestinationForm({
  value,
  onChange,
  channels,
  errors = {},
}: PayoutDestinationFormProps) {
  const set = (patch: Partial<PayoutDestinationDraft>) => onChange({ ...value, ...patch });
  const isBank = value.channel === 'bank';
  // A bank picked from the list vs one typed under "Other".
  const pickedBank = knownBank(value.bankName);
  const [typingBank, setTypingBank] = React.useState(
    () => isBank && !!value.bankName.trim() && !pickedBank,
  );
  React.useEffect(() => {
    if (!isBank) setTypingBank(false);
  }, [isBank]);

  return (
    <View>
      <View
        className="flex-row flex-wrap mb-1"
        style={{ gap: 8 }}
        accessibilityRole="radiogroup"
        accessibilityLabel="Send the money to"
      >
        {channels.map((channel) => {
          const selected = value.channel === channel;
          return (
            <Pressable
              key={channel}
              onPress={() => {
                Haptics.selectionAsync().catch(() => {});
                // The number's format depends on the channel, so switching
                // between an e-wallet and a bank starts it over.
                const crossesKind = (channel === 'bank') !== isBank;
                set({
                  channel,
                  ...(crossesKind ? { accountNumber: '' } : null),
                });
              }}
              accessibilityRole="radio"
              accessibilityLabel={PAYOUT_CHANNEL_LABELS[channel]}
              accessibilityState={{ selected }}
              // Layout in className, colour in a PLAIN style object: a style
              // function next to className dropped the selected fill on web,
              // so the chosen method didn't look chosen. Press via `active:`.
              className="flex-row items-center pl-1.5 pr-3 py-1.5 active:opacity-90"
              style={{
                borderRadius: Radius.chip,
                borderWidth: 1.5,
                borderColor: selected ? LightColors.primary : LightColors.divider,
                backgroundColor: selected ? LightColors.primaryLight : LightColors.surface,
                minHeight: 44,
              }}
            >
              {channel === 'bank' ? (
                <View
                  className="w-7 h-7 items-center justify-center"
                  style={{ borderRadius: 8, backgroundColor: LightColors.surfaceMuted }}
                >
                  <Landmark size={15} color={LightColors.primary} strokeWidth={2} />
                </View>
              ) : (
                <PaymentBrandMark type={channel} size={28} />
              )}
              <Text
                className={`ml-2 text-[13px] ${
                  selected ? 'font-montserrat-bold text-primary' : 'font-montserrat-semi text-textSecondary'
                }`}
              >
                {PAYOUT_CHANNEL_LABELS[channel]}
              </Text>
              {selected ? (
                <Check size={14} color={LightColors.primary} style={{ marginLeft: 4 }} />
              ) : null}
            </Pressable>
          );
        })}
      </View>
      {errors.channel ? (
        <Text className="text-xs font-montserrat-semi text-dangerDark mb-2">{errors.channel}</Text>
      ) : null}

      {value.channel ? (
        <View className="mt-3">
          {isBank ? (
            <>
              <Text className="text-xs font-montserrat-bold text-textSecondary mb-2">Bank</Text>
              <View
                className="flex-row flex-wrap mb-2"
                style={{ gap: 8 }}
                accessibilityRole="radiogroup"
                accessibilityLabel="Bank"
              >
                {[...PH_BANKS, OTHER_BANK].map((bank) => {
                  const selected =
                    bank === OTHER_BANK ? typingBank : !typingBank && pickedBank === bank;
                  return (
                    <Pressable
                      key={bank}
                      onPress={() => {
                        Haptics.selectionAsync().catch(() => {});
                        if (bank === OTHER_BANK) {
                          setTypingBank(true);
                          set({ bankName: pickedBank ? '' : value.bankName });
                        } else {
                          setTypingBank(false);
                          set({ bankName: bank });
                        }
                      }}
                      accessibilityRole="radio"
                      accessibilityLabel={bank}
                      accessibilityState={{ selected }}
                      className="flex-row items-center px-3 py-2 active:opacity-90"
                      style={{
                        borderRadius: Radius.chip,
                        borderWidth: 1.5,
                        borderColor: selected ? LightColors.primary : LightColors.divider,
                        backgroundColor: selected ? LightColors.primaryLight : LightColors.surface,
                        minHeight: 40,
                      }}
                    >
                      <Text
                        className={`text-[13px] ${
                          selected ? 'font-montserrat-bold text-primary' : 'font-montserrat-semi text-textSecondary'
                        }`}
                      >
                        {bank}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              {typingBank ? (
                <Input
                  label="Bank name"
                  value={value.bankName}
                  onChangeText={(bankName) => set({ bankName })}
                  placeholder="Type the bank’s name"
                  autoCapitalize="words"
                  maxLength={100}
                  error={errors.bank_name}
                />
              ) : errors.bank_name ? (
                <Text className="text-xs font-montserrat-semi text-dangerDark mb-3">
                  {errors.bank_name}
                </Text>
              ) : null}
            </>
          ) : null}

          <Input
            label={isBank ? 'Account number' : `${PAYOUT_CHANNEL_LABELS[value.channel]} number`}
            value={value.accountNumber}
            onChangeText={(accountNumber) => set({ accountNumber })}
            placeholder={isBank ? 'Digits only' : '09XX XXX XXXX'}
            keyboardType={isBank ? 'number-pad' : 'phone-pad'}
            autoComplete={isBank ? 'off' : 'tel'}
            maxLength={isBank ? 30 : 16}
            error={errors.account_number}
          />
          <Input
            label="Account holder’s name"
            value={value.accountName}
            onChangeText={(accountName) => set({ accountName })}
            placeholder={isBank ? 'As shown on the account' : `Name on the ${PAYOUT_CHANNEL_LABELS[value.channel]} account`}
            autoCapitalize="words"
            autoComplete="name"
            maxLength={100}
            error={errors.account_name}
          />
        </View>
      ) : null}
    </View>
  );
}
