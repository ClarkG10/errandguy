import type { Payment, PaymentMethod } from '@prisma/client';
import { iso, toFloat } from '../../common/serialization';

/** Mirrors PaymentResource (amounts as floats). */
export function paymentResource(p: Payment): Record<string, unknown> {
  return {
    id: p.id,
    booking_id: p.bookingId,
    customer_id: p.customerId,
    amount: toFloat(p.amount),
    currency: p.currency,
    method: p.method,
    status: p.status,
    paid_at: iso(p.paidAt),
    refund_amount: p.refundAmount !== null ? toFloat(p.refundAmount) : null,
    refunded_at: iso(p.refundedAt),
    created_at: iso(p.createdAt),
    updated_at: iso(p.updatedAt),
  };
}

/** PaymentMethod raw model with gateway_token/gateway_ref hidden. */
export function paymentMethodResource(m: PaymentMethod): Record<string, unknown> {
  return {
    id: m.id,
    user_id: m.userId,
    type: m.type,
    status: m.status,
    label: m.label,
    is_default: m.isDefault,
    last_four: m.lastFour,
    card_brand: m.cardBrand,
    channel_code: m.channelCode,
    expires_at: m.expiresAt ? m.expiresAt.toISOString().slice(0, 10) : null,
    created_at: iso(m.createdAt),
  };
}
