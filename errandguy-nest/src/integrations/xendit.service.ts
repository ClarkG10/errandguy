import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosRequestConfig, Method } from 'axios';
import type { IntegrationsConfig } from '../config/configuration';

/**
 * Xendit REST client. Secret-key HTTP Basic auth (key as username, empty
 * password). Covers invoices (top-ups / online booking payments) and the
 * payment-methods API (linked e-wallets). Timeouts match the Laravel client's
 * hardening. Specific request/response shapes are exercised by PaymentService.
 */
@Injectable()
export class XenditService {
  private readonly logger = new Logger('Xendit');
  private readonly base = 'https://api.xendit.co';

  constructor(private readonly config: ConfigService) {}

  private get cfg(): IntegrationsConfig['xendit'] {
    return this.config.get<IntegrationsConfig>('integrations')!.xendit;
  }

  private authHeader(): string {
    return 'Basic ' + Buffer.from(`${this.cfg.secretKey}:`).toString('base64');
  }

  /** Low-level request. Returns parsed JSON; throws on non-2xx. */
  async request<T = any>(
    method: Method,
    path: string,
    body?: unknown,
    extraHeaders: Record<string, string> = {},
  ): Promise<T> {
    const opts: AxiosRequestConfig = {
      method,
      url: `${this.base}${path}`,
      headers: {
        Authorization: this.authHeader(),
        'Content-Type': 'application/json',
        ...extraHeaders,
      },
      data: body,
      timeout: 20_000,
    };
    const res = await axios.request<T>(opts);
    return res.data;
  }

  /** Create a hosted-checkout invoice. */
  async createInvoice(params: {
    externalId: string;
    amount: number;
    payerEmail?: string;
    description?: string;
    currency?: string;
    successRedirectUrl?: string;
    failureRedirectUrl?: string;
    paymentMethods?: string[];
    idempotencyKey?: string;
  }): Promise<any> {
    const body: Record<string, unknown> = {
      external_id: params.externalId,
      amount: params.amount,
      currency: params.currency ?? 'PHP',
    };
    if (params.payerEmail) body.payer_email = params.payerEmail;
    if (params.description) body.description = params.description;
    if (params.successRedirectUrl) body.success_redirect_url = params.successRedirectUrl;
    if (params.failureRedirectUrl) body.failure_redirect_url = params.failureRedirectUrl;
    if (params.paymentMethods) body.payment_methods = params.paymentMethods;
    const headers: Record<string, string> = params.idempotencyKey
      ? { 'Idempotency-key': params.idempotencyKey }
      : {};
    return this.request('POST', '/v2/invoices', body, headers);
  }

  async getInvoice(invoiceId: string): Promise<any> {
    return this.request('GET', `/v2/invoices/${invoiceId}`);
  }

  /** Create a reusable payment method (linked e-wallet). */
  async createPaymentMethod(body: Record<string, unknown>, idempotencyKey?: string): Promise<any> {
    const headers: Record<string, string> = idempotencyKey ? { 'Idempotency-key': idempotencyKey } : {};
    return this.request('POST', '/v2/payment_methods', body, headers);
  }

  async getPaymentMethod(id: string): Promise<any> {
    return this.request('GET', `/v2/payment_methods/${id}`);
  }

  /** Create a payment request against a linked method. */
  async createPaymentRequest(body: Record<string, unknown>, idempotencyKey?: string): Promise<any> {
    const headers: Record<string, string> = idempotencyKey ? { 'Idempotency-key': idempotencyKey } : {};
    return this.request('POST', '/payment_requests', body, headers);
  }

  /** Create a Xendit customer (required for reusable methods). */
  async createCustomer(body: Record<string, unknown>): Promise<any> {
    return this.request('POST', '/customers', body);
  }

  /** Verify an incoming webhook's `x-callback-token` against the configured token. */
  verifyWebhookToken(token: string | undefined | null): boolean {
    const expected = this.cfg.webhookToken;
    if (!expected) return false;
    return typeof token === 'string' && token === expected;
  }
}
