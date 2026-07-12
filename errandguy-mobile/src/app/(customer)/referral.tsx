import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, Pressable, Share } from 'react-native';
import * as Haptics from 'expo-haptics';
import * as Clipboard from 'expo-clipboard';
import { Gift, Copy, Share2, Users, BadgeCheck, Coins } from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { GradientHeader } from '../../components/ui/GradientHeader';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { ErrorState } from '../../components/ui/ErrorState';
import { Skeleton } from '../../components/ui/Skeleton';
import { BrandRefreshControl } from '../../components/ui/BrandRefreshControl';
import { Eyebrow } from '../../components/ui/Typography';
import { useQuery } from '../../hooks/useQuery';
import { CacheTTL } from '../../services/cache.service';
import { userService, type ReferralInfo } from '../../services/user.service';
import { useAuthStore } from '../../stores/authStore';
import { storage } from '../../utils/storage';
import { toast } from '../../stores/toastStore';
import { formatCurrency } from '../../utils/formatCurrency';
import { useResponsive } from '../../constants/responsive';
import { LightColors } from '../../constants/colors';

// The referral endpoint returns counts + total_earned but no per-referral
// reward figure, so the reward is described by its mechanic (ErrandGuy
// credit) and evidenced by the running Earned total rather than a
// hard-coded peso amount we'd otherwise be inventing.
const HOW_IT_WORKS = [
  'Share your code with friends.',
  'They sign up and finish their first errand.',
  'You both earn ErrandGuy credit.',
] as const;

export default function ReferralScreen() {
  const userId = useAuthStore((s) => s.user?.id ?? 'anon');
  const firstName = useAuthStore((s) => s.user?.full_name?.split(' ')[0] ?? '');
  const { contentMaxWidth } = useResponsive();

  const [refreshing, setRefreshing] = useState(false);
  const [codeInput, setCodeInput] = useState('');
  const [applying, setApplying] = useState(false);
  // Whether the "enter a code" block should be hidden because the user has
  // already redeemed one. The profile endpoint doesn't expose `referred_by`,
  // so we persist a per-user flag the moment an apply succeeds (or the API
  // tells us they've already used a code) and hide the block from then on.
  const [alreadyReferred, setAlreadyReferred] = useState(false);

  const referredKey = `referral_applied:${userId}`;

  useEffect(() => {
    let cancelled = false;
    storage.get(referredKey).then((v) => {
      if (!cancelled && v === '1') setAlreadyReferred(true);
    });
    return () => {
      cancelled = true;
    };
  }, [referredKey]);

  const referralQ = useQuery<ReferralInfo>(
    ['user', 'referral', userId],
    async () => {
      const res = await userService.getReferral();
      return res.data?.data as ReferralInfo;
    },
    { staleTime: 30_000, ttl: CacheTTL.MEDIUM },
  );

  const info = referralQ.data;
  const loading = referralQ.loading && !info;
  const loadFailed = !!referralQ.error && !info;

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await referralQ.refresh();
    setRefreshing(false);
  }, [referralQ]);

  const shareMessage = info
    ? `${firstName ? `${firstName} is inviting you to ` : 'Join me on '}ErrandGuy! Use my referral code ${info.referral_code} when you sign up and we'll both earn a reward once you finish your first errand. ${info.share_link}`
    : '';

  const handleCopy = useCallback(async () => {
    if (!info) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    await Clipboard.setStringAsync(info.referral_code);
    toast.success('Referral code copied');
  }, [info]);

  const handleShare = useCallback(async () => {
    if (!info) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    try {
      await Share.share({ message: shareMessage });
    } catch {
      // User dismissed the sheet or share is unavailable — nothing to do.
    }
  }, [info, shareMessage]);

  const handleApply = useCallback(async () => {
    const code = codeInput.trim();
    if (!code || applying) return;
    setApplying(true);
    try {
      await userService.applyReferral(code);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      toast.success('Referral code applied — your welcome credit is on the way!');
      setCodeInput('');
      setAlreadyReferred(true);
      storage.set(referredKey, '1').catch(() => {});
    } catch (error: any) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      const message = error?.message || 'That referral code could not be applied.';
      toast.error(message);
      // If they've already used a code, stop offering the field.
      if (/already/i.test(message)) {
        setAlreadyReferred(true);
        storage.set(referredKey, '1').catch(() => {});
      }
    } finally {
      setApplying(false);
    }
  }, [codeInput, applying, referredKey]);

  return (
    <View className="flex-1 bg-background">
      <GradientHeader title="Invite & Earn" showBack fallbackHref="/(customer)/(tabs)/profile" />
      <ScrollView
        className="flex-1"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={
          info ? { paddingBottom: 40 } : { flexGrow: 1 }
        }
        refreshControl={
          <BrandRefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
      >
        {loading ? (
          <View
            className="px-5"
            style={{ width: '100%', maxWidth: contentMaxWidth, alignSelf: 'center' }}
          >
            <Skeleton height={220} borderRadius={24} style={{ marginBottom: 20 }} />
            <Skeleton height={92} borderRadius={24} style={{ marginBottom: 20 }} />
            <Skeleton height={120} borderRadius={24} />
          </View>
        ) : loadFailed ? (
          <ErrorState
            title="Couldn't load your referral info"
            onRetry={() => referralQ.refresh()}
          />
        ) : info ? (
          <View
            className="px-5"
            style={{ width: '100%', maxWidth: contentMaxWidth, alignSelf: 'center' }}
          >
            {/* Hero — the code, front and centre, with copy + share. */}
            <Card tone="tinted" padding="lg" className="items-center mb-6">
              <View className="w-14 h-14 rounded-full bg-primary items-center justify-center mb-3">
                <Gift size={26} color={LightColors.textInverse} strokeWidth={2} />
              </View>
              <Text className="text-[15px] font-montserrat-bold text-textPrimary text-center">
                Give credit, get credit
              </Text>
              <Text className="text-[12px] font-montserrat text-textSecondary text-center mt-1 mb-4">
                When a friend signs up with your code and finishes their first
                errand, you both earn ErrandGuy credit toward your next booking.
              </Text>

              <Eyebrow className="mb-1">Your referral code</Eyebrow>
              <Pressable
                onPress={handleCopy}
                accessibilityRole="button"
                accessibilityLabel={`Copy referral code ${info.referral_code}`}
                className="flex-row items-center gap-2 mb-4"
                hitSlop={8}
              >
                <Text
                  className="text-[28px] font-inter-semi text-primary"
                  style={{ letterSpacing: 3 }}
                >
                  {info.referral_code}
                </Text>
                <Copy size={18} color={LightColors.primary} strokeWidth={2} />
              </Pressable>

              <View className="flex-row gap-3 w-full">
                <View className="flex-1">
                  <Button
                    title="Copy"
                    variant="secondary"
                    icon={Copy}
                    fullWidth
                    onPress={handleCopy}
                  />
                </View>
                <View className="flex-1">
                  <Button
                    title="Share"
                    icon={Share2}
                    fullWidth
                    onPress={handleShare}
                  />
                </View>
              </View>
            </Card>

            {/* Stats — invited / qualified / earned. */}
            <Eyebrow className="mb-2">Your rewards</Eyebrow>
            <Card padding="none" className="flex-row py-4 mb-6">
              <StatCell
                icon={Users}
                value={String(
                  info.counts.pending + info.counts.qualified + info.counts.rewarded,
                )}
                label="Invited"
              />
              <View className="w-px bg-divider my-1" />
              <StatCell
                icon={BadgeCheck}
                value={String(info.counts.qualified + info.counts.rewarded)}
                label="Qualified"
              />
              <View className="w-px bg-divider my-1" />
              <StatCell
                icon={Coins}
                value={formatCurrency(info.total_earned)}
                label="Earned"
              />
            </Card>

            {/* How it works — clarifies what "Qualified" means and keeps
                the reward promise honest without inventing an amount. */}
            <Eyebrow className="mb-2">How it works</Eyebrow>
            <Card padding="lg" className="mb-6">
              {HOW_IT_WORKS.map((step, i) => (
                <View
                  key={i}
                  className={`flex-row items-center ${i > 0 ? 'mt-3' : ''}`}
                  accessible
                  accessibilityRole="text"
                  accessibilityLabel={`Step ${i + 1}: ${step}`}
                >
                  <View className="w-7 h-7 rounded-full bg-primaryLight items-center justify-center mr-3">
                    <Text className="text-[13px] font-inter-semi tabular-nums text-primary">
                      {i + 1}
                    </Text>
                  </View>
                  <Text className="flex-1 text-[13px] font-montserrat text-textSecondary">
                    {step}
                  </Text>
                </View>
              ))}
            </Card>

            {/* Enter a code — only meaningful before the user has redeemed
                one. Hidden once applied. */}
            {!alreadyReferred && (
              <>
                <Eyebrow className="mb-2">Have a code?</Eyebrow>
                <Card padding="lg">
                  <Text className="text-[12px] font-montserrat text-textSecondary mb-3">
                    Enter a friend's referral code to claim your welcome credit
                    once you finish your first errand.
                  </Text>
                  <Input
                    label="Referral code"
                    value={codeInput}
                    onChangeText={(t) => setCodeInput(t.toUpperCase())}
                    placeholder="e.g. ABC123"
                    autoCapitalize="characters"
                    autoCorrect={false}
                    maxLength={12}
                  />
                  <Button
                    title="Apply code"
                    fullWidth
                    loading={applying}
                    loadingTitle="Applying…"
                    disabled={!codeInput.trim()}
                    onPress={handleApply}
                  />
                </Card>
              </>
            )}
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

function StatCell({
  icon: Icon,
  value,
  label,
}: {
  icon: LucideIcon;
  value: string;
  label: string;
}) {
  return (
    <View
      className="flex-1 items-center px-2"
      accessible
      accessibilityRole="text"
      accessibilityLabel={`${label}: ${value}`}
    >
      <Icon size={18} color={LightColors.primary} strokeWidth={2} />
      <Text
        className="text-[16px] font-inter-semi tabular-nums text-textPrimary mt-1.5"
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.85}
      >
        {value}
      </Text>
      <Text className="text-[11px] font-montserrat text-textTertiary mt-0.5">
        {label}
      </Text>
    </View>
  );
}
