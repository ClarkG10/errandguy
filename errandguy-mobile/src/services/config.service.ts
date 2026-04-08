import api from './api';

export const configService = {
  getErrandTypes() {
    return api.get('/errand-types');
  },

  getAppConfig() {
    return api.get('/config/app');
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
