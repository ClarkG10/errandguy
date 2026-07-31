import React, { useCallback, useState } from 'react';
import { View, Text, ScrollView, Pressable } from 'react-native';
import * as Haptics from 'expo-haptics';
import * as Clipboard from 'expo-clipboard';
import dayjs from 'dayjs';
import { Ticket, Copy, Clock } from 'lucide-react-native';
import { GradientHeader } from '../../components/ui/GradientHeader';
import { Card } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { Illustration } from '../../components/ui/Illustration';
import { ErrorState } from '../../components/ui/ErrorState';
import { Skeleton } from '../../components/ui/Skeleton';
import { BrandRefreshControl } from '../../components/ui/BrandRefreshControl';
import { Eyebrow } from '../../components/ui/Typography';
import { useQuery } from '../../hooks/useQuery';
import { CacheTTL } from '../../services/cache.service';
import { configService, type Promo } from '../../services/config.service';
import { useAuthStore } from '../../stores/authStore';
import { toast } from '../../stores/toastStore';
import { formatCurrency } from '../../utils/formatCurrency';
import { useResponsive } from '../../constants/responsive';
import { LightColors } from '../../constants/colors';

// Promos redeemable within this many days get a warning-toned urgency
// chip instead of the plain grey expiry line.
const EXPIRING_SOON_DAYS = 3;

// Discount headline. The numeric value / peso amount renders in Inter
// tabular-nums so the figure matches every other price in the app; the
// connective words stay in the Quicksand headline weight. Title Case
// ("Off") per the promos copy spec.
function DiscountHeadline({ promo }: { promo: Promo }) {
  const numeric = 'font-inter-semi tabular-nums';
  return (
    <Text className="text-[15px] font-montserrat-bold text-textPrimary">
      {promo.discount_type === 'percentage' ? (
        <>
          <Text className={numeric}>{promo.discount_value}%</Text> Off
          {promo.max_discount != null ? (
            <>
              {' '}(up to{' '}
              <Text className={numeric}>{formatCurrency(promo.max_discount)}</Text>)
            </>
          ) : null}
        </>
      ) : (
        <>
          <Text className={numeric}>{formatCurrency(promo.discount_value)}</Text> Off
        </>
      )}
    </Text>
  );
}

interface ExpiryInfo {
  /** "MMM D, YYYY" display date. */
  label: string;
  /** Whole days from today until expiry (0 = expires today). */
  days: number;
}

function expiryInfo(iso: string | null): ExpiryInfo | null {
  if (!iso) return null;
  const d = dayjs(iso);
  if (!d.isValid()) return null;
  return {
    label: d.format('MMM D, YYYY'),
    days: d.startOf('day').diff(dayjs().startOf('day'), 'day'),
  };
}

function urgencyLabel(days: number): string {
  if (days <= 0) return 'Expires today';
  if (days === 1) return 'Expires tomorrow';
  return `Expires in ${days} days`;
}

export default function PromosScreen() {
  const userId = useAuthStore((s) => s.user?.id ?? 'anon');
  const { contentMaxWidth } = useResponsive();
  const [refreshing, setRefreshing] = useState(false);

  const promosQ = useQuery<Promo[]>(
    ['promos', userId],
    async () => {
      const res = await configService.getPromos();
      return (res.data?.data ?? []) as Promo[];
    },
    { staleTime: 60_000, ttl: CacheTTL.MEDIUM },
  );

  const promos = promosQ.data ?? [];
  const loading = promosQ.loading && !promosQ.data;
  const loadFailed = !!promosQ.error && promos.length === 0;

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await promosQ.refresh();
    setRefreshing(false);
  }, [promosQ]);

  const handleCopy = useCallback(async (code: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    await Clipboard.setStringAsync(code);
    toast.success(`Copied ${code}`);
  }, []);

  return (
    <View className="flex-1 bg-background">
      <GradientHeader
        title="Promos & Offers"
        showBack
        fallbackHref="/(customer)/(tabs)/profile"
      />
      <ScrollView
        className="flex-1"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          width: '100%',
          maxWidth: contentMaxWidth,
          alignSelf: 'center',
          ...(promos.length === 0 && !loading
            ? { flexGrow: 1 }
            : { paddingBottom: 40 }),
        }}
        refreshControl={
          <BrandRefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        {loading ? (
          <View className="px-5 pt-1">
            {[0, 1, 2].map((i) => (
              <Skeleton
                key={i}
                height={150}
                borderRadius={24}
                style={{ marginBottom: 16 }}
              />
            ))}
          </View>
        ) : loadFailed ? (
          <ErrorState
            title="Couldn't load promos"
            onRetry={() => promosQ.refresh()}
          />
        ) : promos.length === 0 ? (
          <EmptyState
            illustration={<Illustration name="empty-promos" size={168} />}
            title="No promos right now"
            description="Check back soon — new offers are added regularly."
          />
        ) : (
          <View className="px-5 pt-1">
            {promos.map((promo) => {
              const expiry = expiryInfo(promo.valid_until);
              const expiringSoon =
                expiry != null && expiry.days >= 0 && expiry.days <= EXPIRING_SOON_DAYS;
              return (
                <Card key={promo.id} padding="lg" className="mb-4">
                  <View className="flex-row items-start">
                    <View className="w-10 h-10 rounded-full bg-surfaceMuted items-center justify-center mr-3">
                      <Ticket size={18} color={LightColors.primary} strokeWidth={1.9} />
                    </View>
                    <View className="flex-1">
                      <DiscountHeadline promo={promo} />
                      {promo.description ? (
                        <Text className="text-[12px] font-montserrat text-textSecondary mt-0.5">
                          {promo.description}
                        </Text>
                      ) : null}
                    </View>
                  </View>

                  {/* Code + copy row — dashed "ticket" divider above.
                      The code itself is a copy target too, so a tap
                      anywhere on the code/button pair copies. */}
                  <View className="border-t border-dashed border-divider mt-4 pt-3 flex-row items-center justify-between">
                    <Pressable
                      onPress={() => handleCopy(promo.code)}
                      hitSlop={8}
                      accessibilityRole="button"
                      accessibilityLabel={`Copy promo code ${promo.code}`}
                    >
                      <Eyebrow className="mb-0.5">Code</Eyebrow>
                      <Text
                        className="text-[16px] font-inter-semi text-primary"
                        style={{ letterSpacing: 1.5 }}
                      >
                        {promo.code}
                      </Text>
                    </Pressable>
                    <Pressable
                      onPress={() => handleCopy(promo.code)}
                      style={({ pressed }) => [
                        pressed && { opacity: 0.9, transform: [{ scale: 0.97 }] },
                      ]}
                      className="flex-row items-center gap-1.5 bg-primaryLight rounded-full px-4 py-2.5"
                      hitSlop={8}
                      android_ripple={{ color: `${LightColors.primary}1A`, borderless: false }}
                      accessibilityRole="button"
                      accessibilityLabel={`Copy promo code ${promo.code}`}
                    >
                      <Copy size={14} color={LightColors.primaryDark} strokeWidth={2} />
                      <Text className="text-[12px] font-montserrat-bold text-primaryDark">
                        Copy
                      </Text>
                    </Pressable>
                  </View>

                  {(promo.min_order != null || expiry) && (
                    <View className="flex-row flex-wrap items-center gap-x-4 gap-y-2 mt-3">
                      {promo.min_order != null ? (
                        <Text className="text-[11px] font-montserrat text-textTertiary">
                          Min. spend{' '}
                          <Text className="font-inter tabular-nums text-textTertiary">
                            {formatCurrency(promo.min_order)}
                          </Text>
                        </Text>
                      ) : null}
                      {expiringSoon ? (
                        <View className="flex-row items-center gap-1 bg-warningSoft rounded-full px-2.5 py-1">
                          <Clock size={12} color={LightColors.warningDark} strokeWidth={2} />
                          <Text className="text-[11px] font-montserrat-bold text-warningDark">
                            {urgencyLabel(expiry!.days)}
                          </Text>
                        </View>
                      ) : expiry ? (
                        <Text className="text-[11px] font-montserrat text-textTertiary">
                          Expires {expiry.label}
                        </Text>
                      ) : null}
                    </View>
                  )}
                </Card>
              );
            })}
          </View>
        )}
      </ScrollView>
    </View>
  );
}
