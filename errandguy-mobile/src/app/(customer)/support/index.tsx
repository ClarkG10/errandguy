import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  Pressable,
  Modal,
  ScrollView,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Plus, X, ChevronRight, Headphones } from 'lucide-react-native';
import { useQuery } from '../../../hooks/useQuery';
import { CacheTTL } from '../../../services/cache.service';
import { useAuthStore } from '../../../stores/authStore';
import {
  supportService,
  type SupportTicket,
  type SupportTicketStatus,
} from '../../../services/support.service';
import { GradientHeader } from '../../../components/ui/GradientHeader';
import { Badge } from '../../../components/ui/Badge';
import { Button } from '../../../components/ui/Button';
import { Input } from '../../../components/ui/Input';
import { EmptyState } from '../../../components/ui/EmptyState';
import { ErrorState } from '../../../components/ui/ErrorState';
import { Skeleton } from '../../../components/ui/Skeleton';
import { BrandRefreshControl } from '../../../components/ui/BrandRefreshControl';
import { ConfirmModal } from '../../../components/ui/ConfirmModal';
import { LightColors, Elevation } from '../../../constants/colors';
import { useResponsive } from '../../../constants/responsive';
import { formatRelativeTime } from '../../../utils/formatDate';
import { errorMessage } from '../../../utils/errorCatalog';
import { copy } from '../../../constants/copy';
import { toast } from '../../../stores/toastStore';
import { storage } from '../../../utils/storage';

// Ticket status → Badge variant + human label. Mirrors the server's
// SupportTicket status machine (open → pending → resolved/closed).
const STATUS_META: Record<
  SupportTicketStatus,
  { label: string; variant: 'soft' | 'warning' | 'success' | 'neutral' }
> = {
  open: { label: 'Open', variant: 'soft' },
  pending: { label: 'Awaiting reply', variant: 'warning' },
  resolved: { label: 'Resolved', variant: 'success' },
  closed: { label: 'Closed', variant: 'neutral' },
};

// Category chips offered in the composer. `key` is sent verbatim as the
// ticket's `category` (free string server-side, max 50).
const CATEGORIES: { key: string; label: string }[] = [
  { key: 'general', label: 'General' },
  { key: 'booking', label: 'A booking' },
  { key: 'payment', label: 'Payments' },
  { key: 'account', label: 'My account' },
  { key: 'safety', label: 'Safety' },
  { key: 'other', label: 'Other' },
];

/**
 * ── Compose draft ──────────────────────────────────────────────────────────
 * A support ticket is the one thing a user writes when they're already upset,
 * often long, often interrupted (they leave to screenshot something, check a
 * booking number, take a call). Losing it to a backgrounded app that Android
 * reclaimed is the worst possible moment to make someone retype.
 *
 * Same idiom as the booking draft (bookingStore): a debounced write of a
 * {savedAt} envelope, the row REMOVED rather than written empty, and a stale
 * envelope dropped on hydration. Kept local to this screen because it's the
 * only compose surface — no store is warranted for three strings.
 *
 * Account scoping: the envelope stamps the author's user id and hydration
 * refuses (and deletes) an envelope belonging to anyone else, so a draft can't
 * bleed into the next account signed in on the same device.
 */
const DRAFT_STORAGE_KEY = '@support_draft_v1';
/** Coalesce keystrokes so a long message doesn't write on every character. */
const DRAFT_PERSIST_DEBOUNCE_MS = 250;
/** Older than this and the context is gone — drop it rather than resurrect it.
 *  Longer than the booking draft's 24h: an unsent complaint is still valid next
 *  week, whereas a half-built booking usually isn't. */
const DRAFT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

interface PersistedSupportDraft {
  /** Author — hydration ignores (and deletes) another account's draft. */
  userId: string;
  subject: string;
  category: string;
  message: string;
  /** epoch ms */
  savedAt: number;
}

let draftPersistTimer: ReturnType<typeof setTimeout> | null = null;

const cancelDraftPersist = () => {
  if (draftPersistTimer) {
    clearTimeout(draftPersistTimer);
    draftPersistTimer = null;
  }
};

/** Write (or delete, when the draft is empty) — never throws. */
const writeDraft = (draft: PersistedSupportDraft) => {
  if (!draft.subject.trim() && !draft.message.trim()) {
    void storage.remove(DRAFT_STORAGE_KEY).catch(() => {});
    return;
  }
  void storage.set(DRAFT_STORAGE_KEY, JSON.stringify(draft)).catch(() => {});
};

const scheduleDraftPersist = (draft: PersistedSupportDraft) => {
  cancelDraftPersist();
  draftPersistTimer = setTimeout(() => {
    draftPersistTimer = null;
    writeDraft(draft);
  }, DRAFT_PERSIST_DEBOUNCE_MS);
};

/** Write the pending draft NOW — used on dismiss, so a kill immediately after
 *  closing the sheet can't land inside the debounce window. */
const flushDraftPersist = (draft: PersistedSupportDraft) => {
  cancelDraftPersist();
  writeDraft(draft);
};

const discardDraft = () => {
  cancelDraftPersist();
  void storage.remove(DRAFT_STORAGE_KEY).catch(() => {});
};

function TicketsSkeleton() {
  return (
    <View className="px-5">
      {[1, 2, 3].map((i) => (
        <View
          key={i}
          className="flex-row items-center py-4 border-b border-divider"
        >
          <View className="flex-1">
            <Skeleton width="70%" height={14} borderRadius={4} />
            <Skeleton width={90} height={10} borderRadius={4} style={{ marginTop: 8 }} />
          </View>
          <Skeleton width={68} height={18} borderRadius={9} />
        </View>
      ))}
    </View>
  );
}

export default function SupportTicketsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { contentMaxWidth } = useResponsive();
  const userId = useAuthStore((s) => s.user?.id ?? 'anon');
  const [refreshing, setRefreshing] = useState(false);

  // Compose modal state.
  const [composeOpen, setComposeOpen] = useState(false);
  const [subject, setSubject] = useState('');
  const [category, setCategory] = useState<string>('general');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  // Guards the EXPLICIT discard of a saved draft (dismissing the sheet keeps it).
  const [discardOpen, setDiscardOpen] = useState(false);
  // False from the moment the sheet opens until the persisted draft has been
  // read back — the auto-save effect stays parked until then so an empty
  // initial render can't delete the very draft we're about to restore.
  const [draftHydrated, setDraftHydrated] = useState(false);
  // True when this compose session started from a restored draft — the one
  // thing worth telling the user, so the pre-filled fields aren't a surprise.
  const [draftRestored, setDraftRestored] = useState(false);

  const ticketsQ = useQuery<SupportTicket[]>(
    ['support', 'tickets', userId],
    async () => {
      const r = await supportService.getTickets();
      return (r.data.data ?? []) as SupportTicket[];
    },
    { staleTime: 15_000, ttl: CacheTTL.MEDIUM },
  );

  const tickets = ticketsQ.data ?? [];
  const initialLoading = ticketsQ.loading && !ticketsQ.data;
  const failed = !!ticketsQ.error && !ticketsQ.data;

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await ticketsQ.refresh();
    setRefreshing(false);
  }, [ticketsQ]);

  const resetCompose = useCallback(() => {
    setSubject('');
    setCategory('general');
    setMessage('');
    setDraftRestored(false);
  }, []);

  // Open the sheet, then restore whatever was left half-typed. Restoring
  // AFTER the modal is visible keeps opening instant; the functional setters
  // mean a keystroke that beat the read (practically impossible, but free to
  // guard) always wins over the stored value.
  const openCompose = useCallback(() => {
    setDraftHydrated(false);
    setDraftRestored(false);
    setComposeOpen(true);
    void (async () => {
      let restored = false;
      try {
        const raw = await storage.get(DRAFT_STORAGE_KEY);
        if (raw) {
          const d = (JSON.parse(raw) ?? {}) as Partial<PersistedSupportDraft>;
          const mine = d.userId === userId;
          const fresh =
            typeof d.savedAt === 'number' && Date.now() - d.savedAt < DRAFT_MAX_AGE_MS;
          const hasContent = !!(d.subject?.trim() || d.message?.trim());
          if (mine && fresh && hasContent) {
            setSubject((cur) => (cur ? cur : d.subject ?? ''));
            setMessage((cur) => (cur ? cur : d.message ?? ''));
            setCategory((cur) => (cur !== 'general' ? cur : d.category || 'general'));
            restored = true;
          } else {
            // Stale, empty, or another account's — drop it rather than leave a
            // row that can never be restored.
            void storage.remove(DRAFT_STORAGE_KEY).catch(() => {});
          }
        }
      } catch {
        // Unreadable / corrupt envelope — compose from scratch, never crash.
      }
      setDraftRestored(restored);
      setDraftHydrated(true);
    })();
  }, [userId]);

  // Auto-save while composing. Parked until hydration so the first (empty)
  // render can't clear the stored draft, and only while the sheet is open so
  // a submitted/discarded reset never writes a fresh empty envelope.
  useEffect(() => {
    if (!composeOpen || !draftHydrated) return;
    scheduleDraftPersist({
      userId,
      subject,
      category,
      message,
      savedAt: Date.now(),
    });
  }, [composeOpen, draftHydrated, userId, subject, category, message]);

  // Explicit discard (confirmed): wipe the draft everywhere and close.
  const dismissCompose = useCallback(() => {
    discardDraft();
    setDiscardOpen(false);
    setComposeOpen(false);
    resetCompose();
  }, [resetCompose]);

  // Attempted dismiss (X, Android back, scrim tap). Nothing is lost any more —
  // the draft is saved and restored next time — so this closes straight away
  // instead of interrogating the user. Flush first so a kill in the next
  // 250ms still keeps what they typed.
  const closeCompose = useCallback(() => {
    if (submitting) return;
    if (draftHydrated) {
      flushDraftPersist({ userId, subject, category, message, savedAt: Date.now() });
    }
    setComposeOpen(false);
  }, [submitting, draftHydrated, userId, subject, category, message]);

  const canSubmit = subject.trim().length > 0 && message.trim().length > 0;
  const hasDraftContent = subject.trim().length > 0 || message.trim().length > 0;

  const handleSubmit = useCallback(async () => {
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    try {
      const r = await supportService.createTicket({
        subject: subject.trim(),
        category,
        message: message.trim(),
      });
      const ticket = r.data.data;
      Haptics.notificationAsync(
        Haptics.NotificationFeedbackType.Success,
      ).catch(() => {});
      // Sent — the draft has served its purpose. Clear it before the reset so
      // a debounced write from the last keystroke can't resurrect it.
      discardDraft();
      setComposeOpen(false);
      resetCompose();
      ticketsQ.refresh().catch(() => {});
      if (ticket?.id) {
        router.push(`/(customer)/support/${ticket.id}`);
      }
    } catch (err: any) {
      Haptics.notificationAsync(
        Haptics.NotificationFeedbackType.Error,
      ).catch(() => {});
      toast.error(errorMessage(err, copy.support.createFailed));
    } finally {
      setSubmitting(false);
    }
  }, [canSubmit, submitting, subject, category, message, resetCompose, ticketsQ, router]);

  const renderTicket = useCallback(
    ({ item }: { item: SupportTicket }) => {
      const meta = STATUS_META[item.status] ?? STATUS_META.open;
      // Last message preview — fall back to a plain label for an
      // image-only reply (image_url with null content) so the row is
      // never blank below the subject.
      const preview =
        item.latest_message?.content ||
        (item.latest_message?.image_url ? 'Photo' : undefined);
      const when = item.last_message_at ?? item.created_at;
      // Unread when the newest message is an unseen agent/system reply —
      // the one event a support inbox exists to surface.
      const unread =
        !!item.latest_message &&
        item.latest_message.sender_type !== 'user' &&
        !item.latest_message.read_at;
      return (
        <Pressable
          onPress={() => {
            Haptics.selectionAsync().catch(() => {});
            router.push(`/(customer)/support/${item.id}`);
          }}
          className="flex-row items-center px-5 py-4 border-b border-divider"
          accessibilityRole="button"
          accessibilityLabel={`Ticket: ${item.subject}, ${meta.label}${
            unread ? ', unread' : ''
          }`}
        >
          <View className="flex-1 pr-3">
            <View className="flex-row items-center">
              {unread ? (
                <View className="w-2 h-2 rounded-full bg-primary mr-2" />
              ) : null}
              <Text
                className={`flex-1 text-[14px] text-textPrimary ${
                  unread ? 'font-montserrat-bold' : 'font-montserrat-semi'
                }`}
                numberOfLines={1}
              >
                {item.subject}
              </Text>
              <View className="ml-2">
                <Badge label={meta.label} variant={meta.variant} />
              </View>
            </View>
            {preview ? (
              <Text
                className={`text-[12px] mt-1 ${
                  unread
                    ? 'font-montserrat-semi text-textPrimary'
                    : 'font-montserrat text-textSecondary'
                }`}
                numberOfLines={1}
              >
                {preview}
              </Text>
            ) : null}
            {when ? (
              <Text className="text-[11px] font-montserrat text-textTertiary mt-1">
                {formatRelativeTime(when)}
              </Text>
            ) : null}
          </View>
          <ChevronRight size={16} color={LightColors.textMuted} strokeWidth={1.6} />
        </Pressable>
      );
    },
    [router],
  );

  const categoryChips = useMemo(
    () =>
      CATEGORIES.map((c) => {
        const selected = category === c.key;
        return (
          <Pressable
            key={c.key}
            onPress={() => {
              Haptics.selectionAsync().catch(() => {});
              setCategory(c.key);
            }}
            hitSlop={{ top: 6, bottom: 6 }}
            accessibilityRole="button"
            accessibilityLabel={`Category: ${c.label}`}
            accessibilityState={{ selected }}
            className={`px-3.5 py-2 rounded-full border ${
              selected ? 'bg-primary border-primary' : 'bg-surface border-divider'
            }`}
          >
            <Text
              className={`text-[12px] font-montserrat-semi ${
                selected ? 'text-white' : 'text-textSecondary'
              }`}
            >
              {c.label}
            </Text>
          </Pressable>
        );
      }),
    [category],
  );

  return (
    <View className="flex-1 bg-background">
      <GradientHeader
        title="Support"
        showBack
        fallbackHref="/(customer)/help"
      />

      <FlatList
        data={tickets}
        keyExtractor={(t) => t.id}
        renderItem={renderTicket}
        contentContainerStyle={{
          paddingBottom: 120,
          flexGrow: tickets.length === 0 ? 1 : undefined,
          maxWidth: contentMaxWidth,
          width: '100%',
          alignSelf: 'center',
        }}
        refreshControl={
          <BrandRefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        ListEmptyComponent={
          initialLoading ? (
            <TicketsSkeleton />
          ) : failed ? (
            <ErrorState
              title="Couldn't load your tickets"
              description="Check your connection and try again."
              onRetry={() => ticketsQ.refresh()}
            />
          ) : (
            <EmptyState
              icon={Headphones}
              title="No support tickets yet"
              description="Open a ticket and our team will get back to you here."
              actionLabel="New ticket"
              onAction={() => {
                Haptics.selectionAsync().catch(() => {});
                openCompose();
              }}
            />
          )
        }
      />

      {/* New-ticket FAB — hidden while the empty-state CTA is the primary
          call to action (no tickets), shown once the list has content. */}
      {tickets.length > 0 && (
        <Pressable
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
            openCompose();
          }}
          accessibilityRole="button"
          accessibilityLabel="New support ticket"
          className="absolute right-5 bg-primary rounded-full flex-row items-center justify-center"
          style={({ pressed }) => [
            {
              bottom: insets.bottom + 20,
              height: 52,
              paddingHorizontal: 20,
              gap: 8,
              ...Elevation.primary,
            },
            pressed && { opacity: 0.9 },
          ]}
        >
          <Plus size={20} color={LightColors.textInverse} strokeWidth={2.2} />
          <Text className="text-[14px] font-montserrat-bold text-white">
            New ticket
          </Text>
        </Pressable>
      )}

      {/* Compose sheet */}
      <Modal
        visible={composeOpen}
        animationType="slide"
        transparent
        onRequestClose={closeCompose}
      >
        <View className="flex-1 justify-end">
          {/* Tap-outside-to-dismiss scrim (routes through the draft guard). */}
          <Pressable
            className="absolute inset-0 bg-black/40"
            onPress={closeCompose}
            accessibilityRole="button"
            accessibilityLabel="Close"
          />
          <KeyboardAvoidingView
            // An Android <Modal> renders in its own window and does NOT inherit
            // the activity's adjustResize, so behavior=undefined leaves the
            // message field + submit button under the keyboard. 'height' lifts
            // the bottom-anchored sheet — matches every other input-bearing
            // Modal in the app (trusted-contacts, EditProfileModal, ReceiptCapture).
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          >
            <View
              className="bg-background rounded-t-3xl"
              style={{
                paddingBottom: Math.max(insets.bottom, 16),
                maxHeight: '92%',
                maxWidth: contentMaxWidth,
                width: '100%',
                alignSelf: 'center',
              }}
            >
              <View className="flex-row items-center justify-between px-5 pt-5 pb-3">
                <Text className="text-[18px] font-montserrat-bold text-textPrimary">
                  New ticket
                </Text>
                <Pressable
                  onPress={closeCompose}
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
                {/* Restored draft — say so, so pre-filled fields read as
                    "we kept this for you", not as a stale bug. */}
                {draftRestored ? (
                  <View className="bg-surfaceMuted rounded-xl px-3 py-2 mb-3">
                    <Text className="text-[12px] font-montserrat text-textSecondary">
                      We kept the draft you started earlier.
                    </Text>
                  </View>
                ) : null}

                <Input
                  label="Subject"
                  value={subject}
                  onChangeText={setSubject}
                  placeholder="What's this about?"
                  helperText="A short summary of your issue."
                  maxLength={200}
                />

                <Text className="text-[13px] font-montserrat-semi text-textSecondary mt-2 mb-2">
                  Category
                </Text>
                <View className="flex-row flex-wrap" style={{ gap: 8 }}>
                  {categoryChips}
                </View>

                <Text className="text-[13px] font-montserrat-semi text-textSecondary mt-4 mb-2">
                  Message
                </Text>
                <TextInput
                  value={message}
                  onChangeText={setMessage}
                  placeholder="Describe your issue…"
                  placeholderTextColor={LightColors.textMuted}
                  multiline
                  maxLength={2000}
                  className="bg-surface border border-divider rounded-2xl px-4 py-3 text-base font-montserrat text-textPrimary"
                  style={{ minHeight: 110, textAlignVertical: 'top' }}
                  accessibilityLabel="Ticket message"
                />
                {message.length > 1600 ? (
                  <Text className="text-[11px] font-montserrat text-textTertiary text-right mt-1">
                    {message.length}/2000
                  </Text>
                ) : null}

                <View className="mt-5">
                  <Button
                    title="Create ticket"
                    onPress={handleSubmit}
                    loading={submitting}
                    loadingTitle="Submitting…"
                    disabled={!canSubmit}
                    fullWidth
                  />
                  {!canSubmit ? (
                    <Text className="text-[12px] font-montserrat text-textSecondary text-center mt-2">
                      Add a subject and a message to continue.
                    </Text>
                  ) : null}
                  {/* Closing the sheet no longer throws the text away, so the
                      only way to lose it is to ask — explicitly, and confirmed. */}
                  {hasDraftContent ? (
                    <>
                      <Text className="text-[11px] font-montserrat text-textTertiary text-center mt-3">
                        Saved as a draft on this device.
                      </Text>
                      <Pressable
                        onPress={() => {
                          Haptics.selectionAsync().catch(() => {});
                          setDiscardOpen(true);
                        }}
                        disabled={submitting}
                        hitSlop={8}
                        accessibilityRole="button"
                        accessibilityLabel="Discard draft"
                        className="items-center py-2 mt-1"
                      >
                        {/* dangerDark, not danger: 13px destructive text needs
                            the dark rung to clear 4.5:1 on the sheet. */}
                        <Text className="text-[13px] font-montserrat-semi text-dangerDark">
                          Discard draft
                        </Text>
                      </Pressable>
                    </>
                  ) : null}
                </View>
              </ScrollView>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>

      <ConfirmModal
        visible={discardOpen}
        title="Discard this draft?"
        message="Your subject and message will be deleted from this device."
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        destructive
        onConfirm={dismissCompose}
        onCancel={() => setDiscardOpen(false)}
      />
    </View>
  );
}
