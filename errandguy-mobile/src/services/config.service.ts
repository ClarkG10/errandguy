import api from './api';

/** Shape of each item in GET /promos → `data` (PromoResource). */
export interface Promo {
  id: string;
  code: string;
  description: string | null;
  discount_type: string;
  discount_value: number;
  max_discount: number | null;
  min_order: number | null;
  valid_until: string | null;
}

export const configService = {
  getErrandTypes() {
    // Errand types change rarely \u2014 keep them in the in-memory cache for
    // 10 minutes so navigating between Home and Book doesn't re-fetch.
    // Silent so the SWR background revalidate doesn't flash the bar.
    return api.get('/errand-types', { cacheTtlMs: 10 * 60 * 1000, silent: true });
  },

  getAppConfig() {
    return api.get('/config/app', { cacheTtlMs: 10 * 60 * 1000, silent: true });
  },

  validatePromo(code: string, amount?: number) {
    // Thread the booking fare as `?amount=N`. Without it the backend defaults
    // to 0, which (a) rejects ANY promo that has a min_order (0 < min_order)
    // and (b) makes percentage promos compute a ₱0 discount. See PromoService.
    return api.get(
      `/promos/validate/${encodeURIComponent(code)}`,
      amount != null ? { params: { amount } } : undefined,
    );
  },

  // Browse currently-valid, publicly-listable promo codes the caller can
  // still redeem. Silent so the SWR background revalidate doesn't flash
  // the network bar.
  getPromos() {
    return api.get('/promos', { cacheTtlMs: 60_000, silent: true });
  },

  submitReport(data: {
    booking_id?: string;
    subject: string;
    description: string;
    category: string;
  }) {
    return api.post('/support/report', data);
  },
};
