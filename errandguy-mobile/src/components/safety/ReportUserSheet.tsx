import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  Modal,
  ScrollView,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X } from 'lucide-react-native';
import { Button } from '../ui/Button';
import { LightColors } from '../../constants/colors';
import { copy } from '../../constants/copy';
import { supportService } from '../../services/support.service';
import { errorMessage } from '../../utils/errorCatalog';
import { haptics } from '../../utils/haptics';
import { toast } from '../../stores/toastStore';

/** The reasons a person can be reported for. Short on purpose: picked
 *  one-handed, often while upset; the note carries the detail. */
export const REPORT_USER_REASONS = [
  { key: 'unsafe', label: 'Made me feel unsafe' },
  { key: 'harassment', label: 'Rude, abusive or harassing' },
  { key: 'inappropriate_contact', label: 'Inappropriate messages or calls' },
  { key: 'money', label: 'Asked for extra money' },
  { key: 'not_as_expected', label: 'Not who or what I expected' },
  { key: 'other', label: 'Something else' },
] as const;

export type ReportUserReason = (typeof REPORT_USER_REASONS)[number]['key'];

/** Ticket category the server routes to its trust & safety queue. */
export const REPORT_USER_CATEGORY = 'report_user';

const NOTE_MAX = 1000;

/**
 * The ticket a report becomes. Pure so the exact payload — booking, person,
 * category — is pinned by a test; an older server ignores `reported_user_id`
 * and still files the ticket against the errand.
 */
export function buildReportUserTicket(input: {
  bookingId: string;
  bookingNumber?: string | null;
  reportedUserId: string;
  /** Who is being reported, for the subject line ("runner" / "customer"). */
  counterpart: 'runner' | 'customer';
  reason: ReportUserReason;
  note: string;
}) {
  const reason = REPORT_USER_REASONS.find((r) => r.key === input.reason) ?? REPORT_USER_REASONS[REPORT_USER_REASONS.length - 1];
  const ref = input.bookingNumber || input.bookingId;
  const note = input.note.trim();
  return {
    subject: `Report about the ${input.counterpart} — ${ref}`,
    category: REPORT_USER_CATEGORY,
    message: [`Reason: ${reason.label}`, note || null, `Errand: ${ref}`]
      .filter(Boolean)
      .join('\n\n'),
    booking_id: input.bookingId,
    reported_user_id: input.reportedUserId,
  };
}

interface ReportUserSheetProps {
  visible: boolean;
  onClose: () => void;
  bookingId: string;
  bookingNumber?: string | null;
  reportedUserId: string;
  /** Display name of the person being reported (may be a first name). */
  reportedName?: string | null;
  counterpart: 'runner' | 'customer';
  /** Called with the new ticket id once the report is filed. */
  onSubmitted?: (ticketId: string | null) => void;
}

/**
 * "Report this person" — a reason, an optional note, and a ticket that names
 * the errand and the person. Either side of an errand can file one. It is a
 * report to ErrandGuy staff, not an alarm: the sheet points at SOS / 911 for
 * anything happening right now.
 */
export function ReportUserSheet({
  visible,
  onClose,
  bookingId,
  bookingNumber,
  reportedUserId,
  reportedName,
  counterpart,
  onSubmitted,
}: ReportUserSheetProps) {
  const insets = useSafeAreaInsets();
  const [reason, setReason] = useState<ReportUserReason | null>(null);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // A fresh sheet every time it opens — a half-filled report about one errand
  // must never carry over to another.
  useEffect(() => {
    if (visible) {
      setReason(null);
      setNote('');
    }
  }, [visible, bookingId]);

  const close = () => {
    if (submitting) return;
    onClose();
  };

  const submit = async () => {
    if (!reason || submitting) return;
    setSubmitting(true);
    try {
      const res = await supportService.createTicket(
        buildReportUserTicket({
          bookingId,
          bookingNumber,
          reportedUserId,
          counterpart,
          reason,
          note,
        }),
      );
      haptics.success();
      toast.success('Report sent — our team will review it and reply in Support.');
      onSubmitted?.(res.data?.data?.id ?? null);
    } catch (err) {
      haptics.error();
      toast.error(errorMessage(err, copy.support.reportFailed));
    } finally {
      setSubmitting(false);
    }
  };

  const who = reportedName?.trim() || `this ${counterpart}`;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={close}>
      <View className="flex-1 justify-end">
        <Pressable
          className="absolute inset-0 bg-black/40"
          onPress={close}
          accessibilityRole="button"
          accessibilityLabel="Close"
        />
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View
            className="bg-background rounded-t-3xl"
            style={{ paddingBottom: Math.max(insets.bottom, 16), maxHeight: '92%' }}
          >
            <View className="flex-row items-center justify-between px-5 pt-5 pb-2">
              <Text
                className="flex-1 text-[18px] font-montserrat-bold text-textPrimary mr-3"
                numberOfLines={1}
              >
                Report {who}
              </Text>
              <Pressable
                onPress={close}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel="Close"
                className="w-9 h-9 rounded-full bg-divider items-center justify-center"
              >
                <X size={18} color={LightColors.textSecondary} strokeWidth={2} />
              </Pressable>
            </View>

            <ScrollView
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 16 }}
            >
              <Text className="text-[13px] font-montserrat text-textSecondary leading-5 mb-3">
                ErrandGuy staff review every report about {bookingNumber || 'this errand'}.
                In danger right now? Use SOS or call 911.
              </Text>

              <Text className="text-[13px] font-montserrat-semi text-textSecondary mb-2">
                What happened?
              </Text>
              {REPORT_USER_REASONS.map((r) => {
                const selected = reason === r.key;
                return (
                  <Pressable
                    key={r.key}
                    onPress={() => {
                      haptics.selection();
                      setReason(r.key);
                    }}
                    accessibilityRole="radio"
                    accessibilityState={{ selected, checked: selected }}
                    accessibilityLabel={r.label}
                    className={`flex-row items-center rounded-xl border px-4 py-3 mb-2 ${
                      selected ? 'border-primary bg-primaryLight' : 'border-divider bg-surface'
                    }`}
                  >
                    <View
                      className={`w-4 h-4 rounded-full border-2 mr-3 items-center justify-center ${
                        selected ? 'border-primary' : 'border-dividerStrong'
                      }`}
                    >
                      {selected ? <View className="w-2 h-2 rounded-full bg-primary" /> : null}
                    </View>
                    <Text className="flex-1 text-[13px] font-montserrat-semi text-textPrimary">
                      {r.label}
                    </Text>
                  </Pressable>
                );
              })}

              <Text className="text-[13px] font-montserrat-semi text-textSecondary mt-2 mb-2">
                Anything else we should know? (optional)
              </Text>
              <TextInput
                value={note}
                onChangeText={setNote}
                placeholder="What happened, and when"
                placeholderTextColor={LightColors.textMuted}
                multiline
                maxLength={NOTE_MAX}
                className="bg-surface border border-divider rounded-2xl px-4 py-3 text-base font-montserrat text-textPrimary"
                style={{ minHeight: 90, textAlignVertical: 'top' }}
                accessibilityLabel="Report details"
              />

              <View className="mt-5">
                <Button
                  title="Send report"
                  onPress={submit}
                  loading={submitting}
                  loadingTitle="Sending…"
                  disabled={!reason}
                  fullWidth
                />
                {!reason ? (
                  <Text className="text-[12px] font-montserrat text-textSecondary text-center mt-2">
                    Pick what happened to continue.
                  </Text>
                ) : null}
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}
