import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  SectionList,
  type SectionListData,
  Pressable,
  ScrollView,
  InteractionManager,
} from 'react-native';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import {
  Search as SearchIcon,
  Clock,
  X,
  ChevronRight,
  ChevronDown,
  MapPin,
  Home,
  Briefcase,
  Star,
  ArrowUpCircle,
  ArrowDownCircle,
  RotateCcw,
  Wallet,
  ClipboardList,
  MessageCircle,
  SearchX,
} from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { bookingService } from '../../services/booking.service';
import { chatService } from '../../services/chat.service';
import { userService } from '../../services/user.service';
import { paymentService } from '../../services/payment.service';
import { useQuery } from '../../hooks/useQuery';
import { useDebounce } from '../../hooks/useDebounce';
import { CacheTTL } from '../../services/cache.service';
import { useAuthStore } from '../../stores/authStore';
import { Input, type InputHandle } from '../../components/ui/Input';
import { Card } from '../../components/ui/Card';
import { Avatar } from '../../components/ui/Avatar';
import { EmptyState } from '../../components/ui/EmptyState';
import { Illustration } from '../../components/ui/Illustration';
import { ErrorState } from '../../components/ui/ErrorState';
import { Skeleton, SkeletonCircle } from '../../components/ui/Skeleton';
import { GradientHeader } from '../../components/ui/GradientHeader';
import { Eyebrow } from '../../components/ui/Typography';
import { RecentErrandItem } from '../../components/customer/RecentErrandItem';
import { rankAndCount, highlightSegments } from '../../utils/universalSearch';
import { storage } from '../../utils/storage';
import { LightColors } from '../../constants/colors';
import { formatCurrency } from '../../utils/formatCurrency';
import { formatRelativeTime } from '../../utils/formatDate';
import { STATUS_LABELS } from '../../constants/statusLabels';
import type {
  Booking,
  Conversation,
  SavedAddress,
  WalletTransaction,
  WalletTransactionType,
} from '../../types';

// Persisted recent-search terms (last 6). Bumped key on shape change.
const RECENT_KEY = 'search:recent:v1';
const MAX_RECENT = 6;
// Top matches shown per category before the "+N more" affordance.
const CATEGORY_CAP = 8;

const ADDRESS_ICONS: Record<string, LucideIcon> = {
  home: Home,
  work: Briefcase,
  other: Star,
};

const TX_ICONS: Record<WalletTransactionType, { icon: LucideIcon; color: string }> = {
  top_up: { icon: ArrowUpCircle, color: LightColors.success },
  payment: { icon: ArrowDownCircle, color: LightColors.danger },
  refund: { icon: RotateCcw, color: LightColors.primary },
  payout: { icon: ArrowDownCircle, color: LightColors.warning },
  bonus: { icon: Star, color: LightColors.warning },
};

/** Primary result line with the matched substring emphasised, so the user
 *  can see WHY a row matched without re-scanning it. Nested Texts keep
 *  numberOfLines truncation intact. */
function HighlightedText({
  query,
  text,
  className,
  numberOfLines,
}: {
  query: string;
  text: string;
  className?: string;
  numberOfLines?: number;
}) {
  return (
    <Text className={className} numberOfLines={numberOfLines}>
      {highlightSegments(query, text).map((seg, i) =>
        seg.hit ? (
          <Text key={i} className="font-montserrat-bold text-primary700">
            {seg.text}
          </Text>
        ) : (
          seg.text
        ),
      )}
    </Text>
  );
}

// ── Federated row + section shapes ───────────────────────────────────────
type ResultRow =
  | { type: 'booking'; key: string; booking: Booking }
  | { type: 'conversation'; key: string; conversation: Conversation }
  | { type: 'address'; key: string; address: SavedAddress }
  | { type: 'transaction'; key: string; tx: WalletTransaction }
  | { type: 'more'; key: string; category: string; categoryTitle: string; count: number }
  | { type: 'error'; key: string; title: string; onRetry: () => void };

interface ResultSection {
  key: string;
  title: string;
  /** Match count shown beside the title; null for an error section. */
  count: number | null;
  data: ResultRow[];
}

export default function SearchScreen() {
  const router = useRouter();
  const userId = useAuthStore((s) => s.user?.id ?? 'anon');

  const [query, setQuery] = useState('');
  const debounced = useDebounce(query, 250);
  const debouncedQ = debounced.trim();

  const [recent, setRecent] = useState<string[]>([]);

  // Per-category "Show N more" expansion; reset whenever the query changes
  // so a fresh search starts back at the capped view.
  const [expandedCats, setExpandedCats] = useState<Record<string, boolean>>({});
  useEffect(() => {
    setExpandedCats({});
  }, [debouncedQ]);

  const expandCategory = useCallback((category: string) => {
    Haptics.selectionAsync().catch(() => {});
    setExpandedCats((prev) => ({ ...prev, [category]: true }));
  }, []);

  // Focus after the push transition settles instead of autoFocus at mount —
  // the keyboard slide no longer contends with the screen animation.
  const inputRef = useRef<InputHandle>(null);
  useEffect(() => {
    const task = InteractionManager.runAfterInteractions(() => {
      inputRef.current?.focus();
    });
    return () => task.cancel();
  }, []);

  // ── Federated data — SAME query keys + fetchers the list screens use, so
  //    this screen shares their cache instead of forking a parallel source
  //    of truth. Everything loads on mount; nothing is refetched per view.
  const bookingsQ = useQuery<Booking[]>(
    ['bookings', 'activity', 'all', userId],
    async () => {
      const res = await bookingService.getBookings({ page: 1, per_page: 15 });
      return (res.data.data ?? []) as Booking[];
    },
    { staleTime: 120_000, ttl: CacheTTL.LONG },
  );

  const convQ = useQuery<Conversation[]>(
    ['chat', 'conversations', userId],
    async () => {
      const res = await chatService.getConversations();
      return res.data?.data ?? [];
    },
    { staleTime: 30_000, ttl: CacheTTL.MEDIUM },
  );

  const addrQ = useQuery<SavedAddress[]>(
    ['user', 'addresses', userId],
    async () => {
      const r = await userService.getAddresses();
      return (r.data.data ?? []) as SavedAddress[];
    },
    { staleTime: 60_000, ttl: CacheTTL.LONG },
  );

  const txQ = useQuery<WalletTransaction[]>(
    ['wallet', 'transactions', userId, 'all'],
    async () => {
      const r = await paymentService.getWalletTransactions();
      return (r.data.data ?? []) as WalletTransaction[];
    },
    { staleTime: 30_000, ttl: CacheTTL.MEDIUM },
  );

  // Destructure stable pieces so the sections memo doesn't recompute on
  // every render (the query objects themselves are recreated each render).
  const { data: bookingsData, error: bookingsError, loading: bookingsLoading, refresh: refreshBookings } = bookingsQ;
  const { data: convData, error: convError, loading: convLoading, refresh: refreshConv } = convQ;
  const { data: addrData, error: addrError, loading: addrLoading, refresh: refreshAddr } = addrQ;
  const { data: txData, error: txError, loading: txLoading, refresh: refreshTx } = txQ;

  // ── Recent searches (persisted) ──
  useEffect(() => {
    let mounted = true;
    storage
      .getJSON<string[]>(RECENT_KEY)
      .then((stored) => {
        if (mounted && Array.isArray(stored)) setRecent(stored.slice(0, MAX_RECENT));
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, []);

  const persistRecent = useCallback((term: string) => {
    const t = term.trim();
    if (!t) return;
    setRecent((prev) => {
      const next = [t, ...prev.filter((r) => r.toLowerCase() !== t.toLowerCase())].slice(
        0,
        MAX_RECENT,
      );
      storage.setJSON(RECENT_KEY, next).catch(() => {});
      return next;
    });
  }, []);

  const clearRecent = useCallback(() => {
    Haptics.selectionAsync().catch(() => {});
    setRecent([]);
    storage.remove(RECENT_KEY).catch(() => {});
  }, []);

  const removeRecent = useCallback((term: string) => {
    Haptics.selectionAsync().catch(() => {});
    setRecent((prev) => {
      const next = prev.filter((r) => r !== term);
      if (next.length === 0) storage.remove(RECENT_KEY).catch(() => {});
      else storage.setJSON(RECENT_KEY, next).catch(() => {});
      return next;
    });
  }, []);

  // Persist + navigate on any result tap.
  const openResult = useCallback(
    (path: string) => {
      Haptics.selectionAsync().catch(() => {});
      persistRecent(debouncedQ);
      router.push(path as any);
    },
    [debouncedQ, persistRecent, router],
  );

  // Stable handler for RecentErrandItem (its onPress takes the booking) so the
  // row's React.memo isn't defeated by an inline closure.
  const openBooking = useCallback(
    (b: Booking) => openResult(`/(customer)/tracking/${b.id}`),
    [openResult],
  );

  const runRecent = useCallback((term: string) => {
    Haptics.selectionAsync().catch(() => {});
    setQuery(term);
  }, []);

  // ── Build federated, ranked sections ──
  const sections = useMemo<ResultSection[]>(() => {
    const q = debouncedQ;
    if (!q) return [];
    const out: ResultSection[] = [];

    const pushCategory = <T,>(
      key: string,
      title: string,
      hasError: boolean,
      hasData: boolean,
      items: readonly T[],
      getFields: (item: T) => unknown[],
      makeRow: (item: T) => ResultRow,
      onRetry: () => void,
    ) => {
      if (hasError && !hasData) {
        out.push({
          key,
          title,
          count: null,
          data: [{ type: 'error', key: `${key}-err`, title: `Couldn't load ${title.toLowerCase()}`, onRetry }],
        });
        return;
      }
      const cap = expandedCats[key] ? Number.MAX_SAFE_INTEGER : CATEGORY_CAP;
      const ranked = rankAndCount(q, items, getFields, cap);
      if (ranked.total === 0) return; // simply empty → omit
      const data: ResultRow[] = ranked.items.map(makeRow);
      if (ranked.total > ranked.items.length) {
        data.push({
          type: 'more',
          key: `${key}-more`,
          category: key,
          categoryTitle: title,
          count: ranked.total - ranked.items.length,
        });
      }
      out.push({ key, title, count: ranked.total, data });
    };

    pushCategory<Booking>(
      'errands',
      'Errands',
      !!bookingsError,
      !!bookingsData,
      bookingsData ?? [],
      (b) => [
        b.errand_type?.name,
        b.booking_number,
        STATUS_LABELS[b.status] ?? b.status,
        b.pickup_address,
        b.dropoff_address,
      ],
      (b) => ({ type: 'booking', key: `b-${b.id}`, booking: b }),
      () => refreshBookings(),
    );

    pushCategory<Conversation>(
      'messages',
      'Messages',
      !!convError,
      !!convData,
      convData ?? [],
      (c) => [
        c.counterparty?.full_name,
        c.booking_number,
        c.last_message?.preview,
        c.errand_type?.name,
      ],
      (c) => ({ type: 'conversation', key: `c-${c.booking_id}`, conversation: c }),
      () => refreshConv(),
    );

    pushCategory<SavedAddress>(
      'addresses',
      'Addresses',
      !!addrError,
      !!addrData,
      addrData ?? [],
      (a) => [a.label, a.address],
      (a) => ({ type: 'address', key: `a-${a.id}`, address: a }),
      () => refreshAddr(),
    );

    pushCategory<WalletTransaction>(
      'transactions',
      'Transactions',
      !!txError,
      !!txData,
      txData ?? [],
      (t) => [
        t.display_description ?? t.description,
        t.type.replace(/_/g, ' '),
        String(Math.abs(t.amount)),
      ],
      (t) => ({ type: 'transaction', key: `t-${t.id}`, tx: t }),
      () => refreshTx(),
    );

    return out;
  }, [
    debouncedQ,
    expandedCats,
    bookingsData, bookingsError, refreshBookings,
    convData, convError, refreshConv,
    addrData, addrError, refreshAddr,
    txData, txError, refreshTx,
  ]);

  // First-load skeleton: a query is active, nothing has been assembled yet,
  // and at least one category is still fetching with no cached data.
  const anyLoadingFirst =
    (bookingsLoading && !bookingsData) ||
    (convLoading && !convData) ||
    (addrLoading && !addrData) ||
    (txLoading && !txData);

  // Memoized so the SectionList's section headers keep cell-level bail-out on
  // every keystroke re-render (renderRow was already hoisted; this matches it).
  // Body reads only its argument + module constants, so deps are empty.
  const renderSectionHeader = useCallback(
    ({ section }: { section: SectionListData<ResultRow, ResultSection> }) => {
      const s = section as unknown as ResultSection;
      return (
        <View
          className="flex-row items-center justify-between px-5 pt-3 pb-2 bg-background"
          // Merge title + count into one header announcement so the
          // count isn't read as a detached bare number.
          accessible
          accessibilityRole="header"
          accessibilityLabel={
            s.count != null ? `${s.title}, ${s.count} results` : s.title
          }
        >
          <Eyebrow color={LightColors.textTertiary}>{s.title}</Eyebrow>
          {s.count != null && (
            <Text className="text-[10px] font-montserrat text-textTertiary">{s.count}</Text>
          )}
        </View>
      );
    },
    [],
  );

  const renderRow = useCallback(
    ({ item }: { item: ResultRow }) => {
      switch (item.type) {
        case 'booking':
          return (
            <View className="px-5">
              <RecentErrandItem
                booking={item.booking}
                onPress={openBooking}
              />
            </View>
          );
        case 'conversation': {
          const c = item.conversation;
          const lm = c.last_message;
          const preview = lm?.is_image
            ? 'Photo'
            : lm?.preview ?? (lm?.is_system ? 'System update' : 'No messages yet');
          return (
            <View className="px-5">
              <Card
                onPress={() => openResult(`/(customer)/chat/${c.booking_id}`)}
                padding="sm"
                className="mb-2.5"
                accessibilityLabel={`Open chat with ${c.counterparty?.full_name ?? 'participant'}`}
              >
                <View className="flex-row items-center">
                  <Avatar
                    uri={c.counterparty?.avatar_url}
                    name={c.counterparty?.full_name ?? '?'}
                    size="md"
                  />
                  <View className="flex-1 ml-3">
                    <HighlightedText
                      query={debouncedQ}
                      text={c.counterparty?.full_name ?? 'Errand partner'}
                      className="text-sm font-montserrat-semi text-textPrimary"
                      numberOfLines={1}
                    />
                    <Text className="text-[11px] font-montserrat text-textTertiary mt-0.5" numberOfLines={1}>
                      {c.errand_type?.name
                        ? `${c.errand_type.name}${c.booking_number ? ` · #${c.booking_number}` : ''}`
                        : c.booking_number
                          ? `#${c.booking_number}`
                          : 'Conversation'}
                    </Text>
                    <Text className="text-xs font-montserrat text-textSecondary mt-1" numberOfLines={1}>
                      {preview}
                    </Text>
                  </View>
                  <ChevronRight size={16} color={LightColors.textMuted} strokeWidth={2} />
                </View>
              </Card>
            </View>
          );
        }
        case 'address': {
          const a = item.address;
          const Icon = ADDRESS_ICONS[a.label] ?? MapPin;
          return (
            <View className="px-5">
              <Card
                onPress={() => openResult('/(customer)/addresses')}
                padding="sm"
                className="mb-2.5"
                accessibilityLabel={`Saved address ${a.label}`}
              >
                <View className="flex-row items-center">
                  <View className="w-10 h-10 rounded-full bg-primaryLight items-center justify-center mr-3">
                    <Icon size={18} color={LightColors.primary} strokeWidth={1.9} />
                  </View>
                  <View className="flex-1 mr-2">
                    <HighlightedText
                      query={debouncedQ}
                      text={a.label}
                      className="text-[14px] font-montserrat-bold text-textPrimary capitalize"
                      numberOfLines={1}
                    />
                    <Text className="text-[12px] font-montserrat text-textSecondary mt-0.5" numberOfLines={2}>
                      {a.address}
                    </Text>
                  </View>
                  <ChevronRight size={16} color={LightColors.textMuted} strokeWidth={2} />
                </View>
              </Card>
            </View>
          );
        }
        case 'transaction': {
          const t = item.tx;
          const config = TX_ICONS[t.type] ?? TX_ICONS.payment;
          const Icon = config.icon;
          const isPositive = t.type === 'top_up' || t.type === 'refund' || t.type === 'bonus';
          return (
            <View className="px-5">
              <Card
                onPress={() => openResult('/(customer)/wallet')}
                padding="sm"
                className="mb-2.5"
                accessibilityLabel={`Transaction ${t.display_description ?? t.description ?? t.type.replace(/_/g, ' ')}, ${formatCurrency(Math.abs(t.amount))}`}
              >
                <View className="flex-row items-center">
                  <View className="w-10 h-10 rounded-full bg-surfaceMuted items-center justify-center mr-3">
                    <Icon size={18} color={config.color} strokeWidth={1.9} />
                  </View>
                  <View className="flex-1 mr-2">
                    <HighlightedText
                      query={debouncedQ}
                      text={t.display_description ?? t.description ?? t.type.replace(/_/g, ' ')}
                      className="text-[14px] font-montserrat-bold text-textPrimary"
                      numberOfLines={1}
                    />
                    <Text className="text-[11px] font-montserrat text-textSecondary mt-0.5">
                      {formatRelativeTime(t.created_at)}
                    </Text>
                  </View>
                  {/* successDark: 15px is under the 17px floor where base
                      success passes AA on white. */}
                  <Text
                    className={`text-[15px] font-inter-semi tabular-nums ${isPositive ? 'text-successDark' : 'text-textPrimary'}`}
                  >
                    {isPositive ? '+' : '−'}
                    {formatCurrency(Math.abs(t.amount))}
                  </Text>
                </View>
              </Card>
            </View>
          );
        }
        case 'more':
          return (
            <Pressable
              onPress={() => expandCategory(item.category)}
              className="flex-row items-center px-5 py-3"
              style={{ minHeight: 44 }}
              accessibilityRole="button"
              accessibilityLabel={`Show ${item.count} more ${item.categoryTitle.toLowerCase()}`}
            >
              <Text className="text-[13px] font-montserrat-semi text-primary mr-1">
                Show {item.count} more
              </Text>
              <ChevronDown size={16} color={LightColors.primary} strokeWidth={2} />
            </Pressable>
          );
        case 'error':
          return (
            <View className="px-5 pb-2">
              <ErrorState compact title={item.title} onRetry={item.onRetry} />
            </View>
          );
        default:
          return null;
      }
    },
    [openResult, expandCategory, debouncedQ, openBooking],
  );

  return (
    <View className="flex-1 bg-background">
      <GradientHeader title="Search" showBack fallbackHref="/(customer)/(tabs)" flush />

      <View className="px-5 pt-3">
        <Input
          ref={inputRef}
          leftIcon={SearchIcon}
          // Cross-platform clear (clearButtonMode is iOS-only, and would
          // double up the affordance there).
          rightIcon={query.length > 0 ? X : undefined}
          onRightIconPress={() => {
            Haptics.selectionAsync().catch(() => {});
            setQuery('');
          }}
          rightIconAccessibilityLabel="Clear search"
          value={query}
          onChangeText={setQuery}
          placeholder="Search errands, messages, places…"
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          onSubmitEditing={() => persistRecent(query)}
          accessibilityLabel="Search everything"
        />
      </View>

      {!debouncedQ ? (
        // ── Pre-typing state: recent searches + quick jumps ──
        <ScrollView
          className="flex-1"
          keyboardShouldPersistTaps="handled"
          automaticallyAdjustKeyboardInsets
          contentContainerStyle={{ paddingBottom: 40 }}
          showsVerticalScrollIndicator={false}
        >
          {recent.length > 0 ? (
            <View className="px-5">
              <View className="flex-row items-center justify-between mb-1">
                <View
                  accessible
                  accessibilityRole="header"
                  accessibilityLabel="Recent searches"
                >
                  <Eyebrow>Recent searches</Eyebrow>
                </View>
                <Pressable
                  onPress={clearRecent}
                  hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                  accessibilityRole="button"
                  accessibilityLabel="Clear recent searches"
                >
                  <Text className="text-[11px] font-montserrat-bold text-primary">Clear</Text>
                </Pressable>
              </View>
              {recent.map((term) => (
                <View
                  key={term}
                  className="flex-row items-center"
                  style={{ borderBottomWidth: 1, borderBottomColor: LightColors.divider }}
                >
                  <Pressable
                    onPress={() => runRecent(term)}
                    className="flex-1 flex-row items-center py-3"
                    style={{ minHeight: 44 }}
                    accessibilityRole="button"
                    accessibilityLabel={`Search again for ${term}`}
                  >
                    <Clock size={15} color={LightColors.textMuted} strokeWidth={2} />
                    <Text className="flex-1 ml-3 text-[14px] font-montserrat text-textPrimary" numberOfLines={1}>
                      {term}
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => removeRecent(term)}
                    hitSlop={14}
                    accessibilityRole="button"
                    accessibilityLabel={`Remove ${term} from recent searches`}
                  >
                    <X size={14} color={LightColors.textMuted} strokeWidth={2} />
                  </Pressable>
                </View>
              ))}
            </View>
          ) : (
            <View className="items-center px-8 pt-16">
              <View className="w-16 h-16 rounded-full bg-primaryLight items-center justify-center">
                <SearchIcon size={28} color={LightColors.primary} strokeWidth={1.9} />
              </View>
              <Text className="text-base font-montserrat-bold text-textPrimary mt-4 text-center">
                Search everything
              </Text>
              <Text className="text-sm font-montserrat text-textSecondary mt-2 text-center leading-5">
                Find your errands, messages, saved places, and wallet activity in one place.
              </Text>
            </View>
          )}
        </ScrollView>
      ) : anyLoadingFirst && sections.length === 0 ? (
        // ── First-data skeleton ──
        <View className="pt-2">
          {[1, 2, 3, 4, 5].map((i) => (
            <View
              key={i}
              className="mx-5 mb-2.5 bg-surface rounded-2xl p-3"
              style={{ borderWidth: 1, borderColor: LightColors.divider }}
            >
              <View className="flex-row items-center">
                <SkeletonCircle size={40} />
                <View className="flex-1 ml-3">
                  <Skeleton width="55%" height={13} />
                  <Skeleton width="80%" height={11} style={{ marginTop: 7 }} />
                </View>
              </View>
            </View>
          ))}
        </View>
      ) : sections.length === 0 ? (
        // ── No matches anywhere ──
        <EmptyState
          illustration={<Illustration name="empty-search" size={168} />}
          title="No results"
          description={`Nothing matches “${debouncedQ}”. Try a booking number, name, or place.`}
          actionLabel="Clear search"
          onAction={() => setQuery('')}
        />
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item) => item.key}
          renderItem={renderRow}
          renderSectionHeader={renderSectionHeader}
          stickySectionHeadersEnabled={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          automaticallyAdjustKeyboardInsets
          maxToRenderPerBatch={10}
          windowSize={5}
          removeClippedSubviews
          contentContainerStyle={{ paddingBottom: 40 }}
        />
      )}
    </View>
  );
}
