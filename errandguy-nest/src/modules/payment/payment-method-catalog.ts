import { Injectable } from '@nestjs/common';
import { CacheService } from '../../cache/cache.service';
import { SystemConfigService } from './system-config.service';

export interface CatalogEntry {
  type: string;
  label: string;
  description: string;
  online: boolean;
}

/** Port of PaymentMethodCatalog. Enabled set lives in system_config. */
@Injectable()
export class PaymentMethodCatalog {
  static readonly CONFIG_KEY = 'enabled_payment_methods';
  static readonly CATALOG: CatalogEntry[] = [
    { type: 'wallet', label: 'ErrandGuy Wallet', description: 'Pay instantly from your wallet balance', online: false },
    { type: 'gcash', label: 'GCash', description: 'Pay online via GCash', online: true },
    { type: 'maya', label: 'Maya', description: 'Pay online via Maya', online: true },
    { type: 'card', label: 'Credit / Debit Card', description: 'Pay online with your card', online: true },
    { type: 'cash', label: 'Cash on Delivery', description: 'Pay your runner directly on completion', online: false },
  ];

  constructor(
    private readonly config: SystemConfigService,
    private readonly cache: CacheService,
  ) {}

  allTypes(): string[] {
    return PaymentMethodCatalog.CATALOG.map((m) => m.type);
  }

  async enabledTypes(): Promise<string[]> {
    const raw = await this.config.getValue(PaymentMethodCatalog.CONFIG_KEY, this.allTypes().join(','));
    const valid = this.allTypes();
    const types = String(raw ?? '')
      .split(',')
      .map((t) => t.trim())
      .filter((t) => valid.includes(t));
    return types.length ? types : valid;
  }

  async isEnabled(type: string): Promise<boolean> {
    return (await this.enabledTypes()).includes(type);
  }

  async enabled(): Promise<CatalogEntry[]> {
    const enabled = await this.enabledTypes();
    return PaymentMethodCatalog.CATALOG.filter((m) => enabled.includes(m.type));
  }

  async catalogWithState(): Promise<(CatalogEntry & { enabled: boolean })[]> {
    const enabled = await this.enabledTypes();
    return PaymentMethodCatalog.CATALOG.map((m) => ({ ...m, enabled: enabled.includes(m.type) }));
  }

  async setEnabled(types: string[], updatedBy: string | null = null): Promise<string[]> {
    let valid = types.map((t) => t.trim()).filter((t) => this.allTypes().includes(t));
    if (!valid.length) valid = this.allTypes();
    await this.config.setValue(PaymentMethodCatalog.CONFIG_KEY, valid.join(','), updatedBy);
    this.cache.forget('app_config');
    this.cache.forget('payments:available_methods');
    return valid;
  }
}
