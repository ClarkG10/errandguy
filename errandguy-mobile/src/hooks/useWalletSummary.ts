import { useQuery } from './useQuery';
import { CacheTTL } from '../services/cache.service';
import { paymentService, parseWalletSummary } from '../services/payment.service';
import { useAuthStore } from '../stores/authStore';
import type { WalletSummary } from '../types';

/**
 * The customer's wallet in full: `balance`, what is `withdrawable`, and any
 * `bonus_balance` (old referral credit — spendable on errands, never
 * withdrawable).
 *
 * Its own cache key because ['wallet','balance',userId] holds the bare balance
 * NUMBER that Home, the boot snapshot and older cached entries all agree on;
 * changing that shape would poison them. Both keys sit under ['wallet'], so
 * every invalidateQuery(['wallet']) after a booking, tip or withdrawal
 * refreshes this too, and the API layer coalesces the two reads of
 * GET /wallet/balance into one request.
 */
export function useWalletSummary(options: { enabled?: boolean } = {}) {
  const userId = useAuthStore((s) => s.user?.id ?? 'anon');
  return useQuery<WalletSummary>(
    ['wallet', 'summary', userId],
    async () => parseWalletSummary((await paymentService.getWalletBalance()).data?.data),
    { staleTime: 15_000, ttl: CacheTTL.SHORT, enabled: options.enabled },
  );
}

/**
 * What a BOOKING can draw on: the withdrawable balance plus bonus credit, which
 * the server spends first (and exactly what it checks before charging the
 * wallet). Tips and withdrawals use the withdrawable balance alone.
 */
export const spendableOnErrands = (s: WalletSummary): number =>
  Math.round((s.balance + s.bonus_balance) * 100) / 100;
