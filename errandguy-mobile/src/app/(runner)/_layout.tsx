import { useCallback, useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { CenteredLoader } from '@/components/ui/Spinner';
import { Stack, useRouter, useSegments } from 'expo-router';
import { useAuthStore } from '../../stores/authStore';
import { useRunnerStore } from '../../stores/runnerStore';
import { useRealtimeNotifications } from '../../hooks/useRealtimeNotifications';
import { useIncomingRequest } from '../../hooks/useIncomingRequest';
import { invalidateQuery } from '../../hooks/useQuery';
import { IncomingRequestModal } from '../../components/runner/IncomingRequestModal';
import {
  offerExpiresAt,
  offerTimeoutSeconds,
  readAcceptDeadline,
} from '../../components/runner/offerMeta';
import { runnerService } from '../../services/runner.service';
import { toast } from '../../stores/toastStore';
import { errorMessage } from '../../utils/errorCatalog';
import { copy } from '../../constants/copy';
import { haptics } from '../../utils/haptics';
import { STACK_ANIMATION } from '../../constants/navigation';
import type { Booking } from '../../types';

// The two documents a runner MUST upload before using the app — mirrors the
// `required: true` entries of REQUIRED_DOCUMENTS in onboarding.tsx (keep in
// sync). A type counts only when a doc of that type exists and isn't rejected,
// matching onboarding's isDocComplete — so a rejected runner is sent back to
// re-upload.
const REQUIRED_RUNNER_DOC_TYPES = ['government_id', 'selfie'] as const;

export default function RunnerLayout() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const role = useAuthStore((s) => s.role);
  const user = useAuthStore((s) => s.user);
  // The cold-start boot snapshot carries only {id, role, full_name, avatar_url}
  // — never runner_profile. Reading that absent field would look exactly like
  // the server saying "this runner has no profile", so the gate below waits for
  // the real profile instead of acting on a provisional one.
  const userIsProvisional = useAuthStore((s) => s.userIsProvisional);
  const router = useRouter();
  const segments = useSegments();
  const [ready, setReady] = useState(false);
  // Grace fallback for the null-user hold in the gate below — never spin on the
  // loader forever if an offline / failed cold-start profile fetch never
  // resolves `user` (mirrors the branded-splash grace in app/index.tsx).
  const [graceElapsed, setGraceElapsed] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setGraceElapsed(true), 3000);
    return () => clearTimeout(t);
  }, []);

  // Subscribe to realtime notifications for the current user
  useRealtimeNotifications(user?.id ?? null);

  useEffect(() => {
    if (!isAuthenticated) {
      router.replace('/(auth)/welcome');
      return;
    }

    if (role === 'customer') {
      router.replace('/(customer)/(tabs)');
      return;
    }

    // Gate: only redirect brand-new runners (no runner_profile yet) to
    // onboarding. Anyone with a profile \u2014 regardless of verification
    // status (pending / approved / rejected / resubmit) \u2014 has already
    // completed signup; they belong on the tabs, where the verification
    // banner will surface any required action.
    // Verification gate. The backend auto-creates a bare runner_profile
    // (verification_status 'pending', zero documents) the instant an account
    // becomes a runner, so "has a profile" never proves signup is done. Force
    // runners to the document-upload (onboarding) screen until the two required
    // documents are uploaded and not rejected; approved runners always pass.
    // `documents` rides only on the GET /user/profile payload (not the
    // login/OTP response) — while it hasn't loaded we let the runner through
    // rather than trap them on a spinner; validateSession refetches the full
    // profile and this effect re-runs once documents arrive, redirecting then
    // if still incomplete.
    const isOnboarding = segments.includes('onboarding' as never);
    if (!isOnboarding) {
      // On a killed-state push (e.g. incoming_request) this layout can mount
      // before validateSession resolves, with `user` still null (loadFromStorage
      // restores token/isAuthenticated but never `user`). Treating null-user as
      // "no runner_profile" used to redirect an already-approved runner to the
      // document-upload onboarding screen and strand them there — once user
      // loaded, segments already showed 'onboarding', so the gate was skipped
      // and never redirected back. Hold on the loader until user hydrates; the
      // grace fallback lets the tabs render if the fetch never resolves.
      if (!user || userIsProvisional) {
        if (graceElapsed) setReady(true);
        return;
      }
      const profile = user.runner_profile;
      if (!profile) {
        router.replace('/(runner)/onboarding');
        return;
      }
      const docs = profile.documents;
      if (profile.verification_status !== 'approved' && Array.isArray(docs)) {
        const hasRequiredDocs = REQUIRED_RUNNER_DOC_TYPES.every((type) =>
          docs.some((d) => d.document_type === type && d.status !== 'rejected'),
        );
        if (!hasRequiredDocs) {
          router.replace('/(runner)/onboarding');
          return;
        }
      }
    }

    setReady(true);
  }, [isAuthenticated, role, user, userIsProvisional, router, segments, graceElapsed]);

  if (!isAuthenticated || role === 'customer') {
    return null;
  }

  // Show loading until navigation check completes — prevents tabs from fetching before redirect
  const isOnboarding = segments.includes('onboarding' as never);
  if (!ready && !isOnboarding) {
    return (
      <View className="flex-1 bg-background">
        <CenteredLoader />
      </View>
    );
  }

  // OfferWatcher renders beside the Stack (never inside it, so expo-router
  // still sees only routes) — the same shape the customer layout uses to hold
  // booking realtime above its own frozen tabs.
  return (
    <>
      <OfferWatcher />
      <Stack screenOptions={{ headerShown: false, animation: STACK_ANIMATION }} />
    </>
  );
}

/**
 * The runner's incoming-offer surface, hoisted out of the Home tab.
 *
 * The offer channel and the countdown modal used to live inside the Home
 * screen's tree. The runner tabs are `freezeOnBlur`, so the instant a waiting
 * runner switched to Earnings, History or Profile — or pushed Busy-areas,
 * notifications, payout — the subscription stopped and the modal stopped
 * rendering: a 90-second accept window could open and lapse with a push banner
 * as the only signal, against a runner who was in the app the whole time. Those
 * screens ARE the idle gap this app itself links them to.
 *
 * Mounted here it survives every tab switch and every pushed screen. This is
 * the ONE owner of the offer stream (see useIncomingRequest) — Home keeps the
 * open-offer FEED (which it can claim from) and the REST reconcile that
 * upgrades/re-raises a matched offer, both of which only write the shared
 * runnerStore.
 *
 * A matched offer can never collide with the errand cockpit: MatchingService
 * excludes runners who already hold an active errand.
 */
function OfferWatcher() {
  const router = useRouter();
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const isOnline = useRunnerStore((s) => s.isOnline);
  const incomingRequest = useRunnerStore((s) => s.incomingRequest);
  const acceptErrand = useRunnerStore((s) => s.acceptErrand);
  const declineErrand = useRunnerStore((s) => s.declineErrand);
  const clearIncomingRequest = useRunnerStore((s) => s.clearIncomingRequest);

  /** Locks the accept so a double-tap can't fire two claims. */
  const claimingRef = useRef(false);
  const upgradeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (upgradeTimerRef.current) clearTimeout(upgradeTimerRef.current);
    },
    [],
  );

  /**
   * The Reverb offer projection (App\Events\IncomingRequest::broadcastWith) is
   * deliberately thin — no `accept_deadline`, no payment method, no amount to
   * collect — so a realtime-raised offer starts on the 30s client fallback
   * while the server actually honours 90s. Pull the full runner-gated payload
   * once and swap it in, so the runner decides against the real window instead
   * of watching the modal close a minute early.
   *
   * Returns whether it upgraded, so a miss can be retried past the endpoint's
   * 5s response cache (which can otherwise still hold a pre-match read).
   */
  const upgradeOffer = useCallback(async (offerId: string): Promise<boolean> => {
    try {
      const fresh = ((await runnerService.getCurrentErrand()).data.data ??
        null) as Booking | null;
      if (!fresh || fresh.id !== offerId || fresh.status !== 'matched') return false;
      const deadline = readAcceptDeadline(fresh);
      if (!deadline) return false;
      const store = useRunnerStore.getState();
      // Only while THIS offer is still the one on screen and still wanted.
      if (store.incomingRequest?.booking?.id !== offerId) return true;
      if (store.isOfferDeclined(offerId)) return true;
      store.setIncomingRequest({ booking: fresh, expiresAt: offerExpiresAt(deadline) });
      return true;
    } catch {
      // Best effort — Home's 30s reconcile poll is the other path to the real
      // deadline, and the fallback window still lets the runner accept.
      return false;
    }
  }, []);

  useIncomingRequest(isOnline && userId ? userId : null, {
    onOffer: (offer) => {
      // Dispatch ran, so this runner's open-offer feed just changed — heal it
      // now rather than waiting out Home's staleTime. Narrow on purpose: the
      // offers list only, not the whole runner surface.
      void invalidateQuery(['runner', 'errand', 'available']);
      if (offer.status !== 'matched' || !offer.id) return;
      if (readAcceptDeadline(offer as Booking)) return;
      const id = offer.id;
      void upgradeOffer(id).then((ok) => {
        if (ok) return;
        if (upgradeTimerRef.current) clearTimeout(upgradeTimerRef.current);
        upgradeTimerRef.current = setTimeout(() => void upgradeOffer(id), 6_000);
      });
    },
    onOfferWithdrawn: () => {
      // Someone else took it (or it expired) — get the feed honest so the dead
      // card goes instead of the runner tapping it and being told it's gone.
      void invalidateQuery(['runner', 'errand', 'available']);
    },
  });

  /**
   * Accept the FIXED match. Deliberately not optimistic: the server serialises
   * the claim with a row lock, so the UI waits for its answer.
   *
   * Separate from Home's `claimOffer` (which also mutates the open-offer feed
   * it owns): a matched offer has this runner's id on it and never appears in
   * that first-come-first-served list.
   */
  const handleAccept = useCallback(async () => {
    const offer = useRunnerStore.getState().incomingRequest?.booking;
    if (!offer || claimingRef.current) return;
    claimingRef.current = true;
    try {
      const res = await runnerService.acceptErrand(offer.id);
      haptics.success();
      acceptErrand((res?.data?.data ?? offer) as Booking);
      router.push(`/(runner)/errand/${offer.id}` as any);
    } catch (err) {
      haptics.error();
      toast.error(errorMessage(err, copy.runner.acceptFailed));
      clearIncomingRequest();
      void invalidateQuery(['runner', 'errand', 'available']);
    } finally {
      claimingRef.current = false;
    }
  }, [acceptErrand, clearIncomingRequest, router]);

  const handleDecline = useCallback(() => {
    const offer = useRunnerStore.getState().incomingRequest?.booking;
    if (!offer) return;
    // Dismiss INSTANTLY, then fire the decline in the background. No rollback:
    // re-showing a declined offer is worse than a silent miss, and the server
    // expires the window regardless. The id is remembered in the store so
    // Home's reconcile poll can't re-raise it if this POST fails.
    declineErrand(offer.id);
    runnerService.declineErrand(offer.id).catch(() => {});
  }, [declineErrand]);

  /**
   * The countdown ran out on THIS device. That is not a decision, so it must
   * not touch POST /decline: that endpoint recomputes acceptance_rate, which
   * also ranks the runner inside MatchingService — a phone in a pocket was
   * permanently costing them standing. Just dismiss; the server's own
   * ExpireStaleMatchesJob re-matches the booking on time, and Home's reconcile
   * hands the offer back if the server is somehow still honouring the accept.
   */
  const handleExpire = useCallback(() => {
    clearIncomingRequest();
  }, [clearIncomingRequest]);

  if (!incomingRequest) return null;

  return (
    <IncomingRequestModal
      // Keyed per offer so a second match remounts the countdown with its own
      // deadline instead of inheriting the first one's.
      key={incomingRequest.booking.id}
      booking={incomingRequest.booking}
      onAccept={handleAccept}
      onDecline={handleDecline}
      onExpire={handleExpire}
      // The SERVER's acceptance window (accept_deadline), not a 30s guess.
      timeoutSeconds={offerTimeoutSeconds(readAcceptDeadline(incomingRequest.booking))}
      expiresAt={incomingRequest.expiresAt}
    />
  );
}
