import api from './api';

export const configService = {
  getErrandTypes() {
    // Errand types change rarely \u2014 keep them in the in-memory cache for
    // 10 minutes so navigating between Home and Book doesn't re-fetch.
    // Silent so the SWR background revalidate doesn't flash the bar.
    return api.get('/errand-types', { cacheTtlMs: 10 * 60 * 1000, silent: true } as any);
  },

  getAppConfig() {
    return api.get('/config/app', { cacheTtlMs: 10 * 60 * 1000, silent: true } as any);
  },

  validatePromo(code: string) {
    return api.get(`/promos/validate/${encodeURIComponent(code)}`);
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
