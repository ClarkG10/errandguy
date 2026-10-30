import React, { useCallback, useRef, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  Modal,
  TextInput,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { AlertTriangle } from 'lucide-react-native';
import { Button } from '../ui/Button';
import { Illustration } from '../ui/Illustration';
import { PayoutDestinationForm } from '../payout/PayoutDestinationForm';
import { DeleteAccountPageLink } from './DeleteAccountPageLink';
import { userService, type AccountDeletionResult } from '../../services/user.service';
import { LightColors } from '../../constants/colors';
import { copy } from '../../constants/copy';
import { errorMessage } from '../../utils/errorCatalog';
import { haptics } from '../../utils/haptics';
import {
  EMPTY_PAYOUT_DESTINATION,
  payoutDestinationServerErrors,
  toPayoutDestinationPayload,
  validatePayoutDestination,
  type PayoutDestinationDraft,
  type PayoutDestinationErrors,
} from '../../utils/payoutDestination';
import type { PayoutChannel } from '../../types';

type Step = 'confirm' | 'destination' | 'done';

interface DeleteAccountSheetProps {
  visible: boolean;
  onClose: () => void;
  /** What deleting removes, in this person's terms (errands vs earnings). */
  description: string;
  /** An account with a runner profile can also have its balance sent to a
   *  bank; a customer-only account chooses GCash or Maya. */
  allowBank: boolean;
  /** The account is gone — sign out and leave. */
  onDeleted: () => Promise<void> | void;
}

/**
 * Account deletion, money first.
 *
 * The server never strands money in an erased account. With a positive
 * balance it answers PAYOUT_METHOD_REQUIRED (with the amount in its message),
 * and this asks where to send it, then deletes with those details — the
 * balance is queued as a payout in the same step and staff send it. Money owed
 * from cash errands (CASH_DEBT_OUTSTANDING) and an errand still in progress
 * refuse deletion outright; both are shown in the server's own words.
 */
export function DeleteAccountSheet({
  visible,
  onClose,
  description,
  allowBank,
  onDeleted,
}: DeleteAccountSheetProps) {
  const insets = useSafeAreaInsets();
  const channels: PayoutChannel[] = allowBank ? ['gcash', 'maya', 'bank'] : ['gcash', 'maya'];

  const [step, setStep] = useState<Step>('confirm');
  const [confirmText, setConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);
  // The server's reason this attempt can't go ahead (money owed, an errand in
  // progress, or why it needs a destination), shown in its own words.
  const [notice, setNotice] = useState<{ tone: 'danger' | 'info'; text: string } | null>(null);
  const [destination, setDestination] = useState<PayoutDestinationDraft>(EMPTY_PAYOUT_DESTINATION);
  const [fieldErrors, setFieldErrors] = useState<PayoutDestinationErrors>({});
  const [doneMessage, setDoneMessage] = useState('');
  const latch = useRef(false);

  const reset = useCallback(() => {
    setStep('confirm');
    setConfirmText('');
    setNotice(null);
    setDestination(EMPTY_PAYOUT_DESTINATION);
    setFieldErrors({});
    setDoneMessage('');
  }, []);

  const finish = useCallback(async () => {
    reset();
    await onDeleted();
  }, [onDeleted, reset]);

  const close = useCallback(() => {
    if (deleting) return;
    // Once the account is gone there is nothing to go back to.
    if (step === 'done') {
      void finish();
      return;
    }
    reset();
    onClose();
  }, [deleting, step, finish, reset, onClose]);

  const submit = useCallback(async () => {
    if (latch.current) return;
    let payload;
    if (step === 'destination') {
      const errors = validatePayoutDestination(destination, channels);
      setFieldErrors(errors);
      if (Object.keys(errors).length > 0) {
        haptics.warning();
        return;
      }
      payload = toPayoutDestinationPayload(destination);
    } else if (confirmText !== 'DELETE') {
      return;
    }

    latch.current = true;
    setDeleting(true);
    setNotice(null);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
    try {
      const res = await userService.deleteAccount(payload);
      const result = (res.data?.data ?? null) as AccountDeletionResult | null;
      haptics.success();
      if (result?.payout) {
        // Say where the money is going before signing out — after that there
        // is no account left to look it up in.
        setDoneMessage(
          typeof res.data?.message === 'string' && res.data.message
            ? res.data.message
            : 'Your account has been deleted.',
        );
        setStep('done');
      } else {
        await finish();
      }
    } catch (err: any) {
      haptics.error();
      if (err?.code === 'PAYOUT_METHOD_REQUIRED') {
        // The server names the amount ("Your wallet has ₱…"), so its message
        // leads the question.
        setStep('destination');
        setNotice({
          tone: 'info',
          text: errorMessage(err, 'Tell us where to send your remaining balance.'),
        });
      } else {
        if (step === 'destination') setFieldErrors(payoutDestinationServerErrors(err));
        // Money owed from cash errands (CASH_DEBT_OUTSTANDING), an errand
        // still in progress, a detail the server rejected — its sentence says
        // exactly what to do, and errorMessage() passes a 422's through.
        setNotice({ tone: 'danger', text: errorMessage(err, copy.profile.deleteAccountFailed) });
      }
    } finally {
      latch.current = false;
      setDeleting(false);
    }
  }, [step, destination, channels, confirmText, finish]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      statusBarTranslucent
      onRequestClose={close}
    >
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <Pressable
          className="flex-1 bg-black/40 justify-end"
          onPress={close}
          accessibilityRole="button"
          accessibilityLabel="Dismiss delete account dialog"
          accessibilityHint="Closes the dialog without deleting your account"
        >
          <Pressable
            className="bg-surface rounded-t-3xl px-5 pt-6"
            style={{ paddingBottom: insets.bottom + 16, maxHeight: '92%' }}
            accessible={false}
            onPress={() => {}}
          >
            <View className="w-10 h-1 rounded-full bg-divider self-center mb-5" />
            <ScrollView
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              bounces={false}
            >
              {step === 'done' ? (
                <View className="items-center pb-2">
                  <Illustration name="account-deleted" size={120} />
                  <Text className="text-base font-montserrat-bold text-textPrimary mt-3 mb-2 text-center">
                    Your account has been deleted
                  </Text>
                  <Text className="text-sm font-montserrat text-textSecondary mb-6 text-center">
                    {doneMessage}
                  </Text>
                  <Button title="Done" fullWidth onPress={() => void finish()} />
                </View>
              ) : (
                <>
                  <Text className="text-base font-montserrat-bold text-textPrimary mb-1">
                    {step === 'destination'
                      ? 'Where should we send your balance?'
                      : 'Delete your account?'}
                  </Text>
                  {step === 'confirm' ? (
                    <>
                      <Text className="text-sm font-montserrat text-textTertiary mb-2">
                        {description}
                      </Text>
                      <Text className="text-sm font-montserrat text-textTertiary mb-3">
                        If there’s money in your wallet, we’ll ask where to send it — GCash or
                        Maya{allowBank ? ', or a bank account' : ''} — and it goes out as part of
                        deleting your account.
                      </Text>
                      <DeleteAccountPageLink className="mb-5" />
                    </>
                  ) : null}

                  {notice ? (
                    <View
                      className={`flex-row items-start rounded-xl px-3 py-2.5 mb-4 ${
                        notice.tone === 'danger' ? 'bg-dangerSoft' : 'bg-surfaceMuted'
                      }`}
                      accessibilityLiveRegion="polite"
                    >
                      {notice.tone === 'danger' ? (
                        <AlertTriangle
                          size={16}
                          color={LightColors.dangerDark}
                          strokeWidth={2}
                          style={{ marginTop: 1 }}
                        />
                      ) : null}
                      <Text
                        className={`flex-1 text-[13px] font-montserrat ${
                          notice.tone === 'danger' ? 'text-dangerDark ml-2' : 'text-textSecondary'
                        }`}
                      >
                        {notice.text}
                      </Text>
                    </View>
                  ) : null}

                  {step === 'destination' ? (
                    <View className="mb-2">
                      <PayoutDestinationForm
                        value={destination}
                        onChange={(next) => {
                          setDestination(next);
                          setFieldErrors({});
                        }}
                        channels={channels}
                        errors={fieldErrors}
                      />
                      <Text className="text-xs font-montserrat text-textTertiary mb-4">
                        It usually arrives within 1–3 business days.
                      </Text>
                    </View>
                  ) : (
                    <>
                      <Text className="text-xs font-montserrat-bold text-textSecondary mb-2">
                        Type DELETE to confirm
                      </Text>
                      <View className="border border-divider rounded-xl px-4 h-12 justify-center mb-5 bg-background">
                        <TextInput
                          value={confirmText}
                          onChangeText={setConfirmText}
                          placeholder="DELETE"
                          placeholderTextColor={LightColors.textMuted}
                          autoCapitalize="characters"
                          accessibilityLabel="Type DELETE to confirm account deletion"
                          style={{
                            fontFamily: 'Quicksand_400Regular',
                            fontSize: 15,
                            color: LightColors.textPrimary,
                          }}
                        />
                      </View>
                    </>
                  )}

                  <Button
                    title={step === 'destination' ? 'Send it & delete account' : 'Delete Account'}
                    variant="danger"
                    fullWidth
                    loading={deleting}
                    loadingTitle="Deleting…"
                    disabled={step === 'confirm' && confirmText !== 'DELETE'}
                    onPress={submit}
                  />
                  <Button title="Cancel" variant="ghost" fullWidth onPress={close} />
                </>
              )}
            </ScrollView>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}
