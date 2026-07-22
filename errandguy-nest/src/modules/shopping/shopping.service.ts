import { HttpException, HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { RealtimeService } from '../../messaging/realtime.service';
import { asArray } from '../../common/serialization';
import type { BookingWithRelations } from '../booking/booking.resource';
import type { ShoppingItemInputDto } from './dto/update-shopping-items.dto';
import type { RunnerShoppingItemDto } from './dto/runner-shopping-items.dto';

type ShoppingItem = {
  id: string;
  name: string;
  qty: number;
  checked: boolean;
  checked_at: string | null;
};

/**
 * Booking statuses where the customer may still edit the shopping list —
 * everything strictly BEFORE the runner picks the items up.
 */
const EDITABLE_STATUSES = ['pending', 'matched', 'accepted', 'heading_to_pickup', 'arrived_at_pickup'];

/** Terminal statuses where a booking's checklist can no longer be ticked. */
const CLOSED_STATUSES = ['completed', 'cancelled'];

/** Relations BookingResource needs after a shopping-list write (mirrors ->load([...])). */
const RESOURCE_INCLUDE = {
  errandType: true,
  runner: true,
  customer: true,
  statusLogs: { orderBy: { createdAt: 'asc' } },
} as const;

@Injectable()
export class ShoppingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
  ) {}

  /** Carbon `now()->toIso8601String()` in the app TZ (UTC): "Y-m-dTH:i:s+00:00". */
  private nowIso8601(): string {
    return new Date().toISOString().replace(/\.\d{3}Z$/, '+00:00');
  }

  /**
   * ShoppingListController::update — customer replaces the whole checklist.
   * Owner-scoped (customer_id) + pre-pickup only. `checked`/`checked_at` are
   * always reset so the customer can never forge the runner's tick state.
   */
  async updateCustomerList(userId: string, id: string, items: ShoppingItemInputDto[]): Promise<BookingWithRelations> {
    const booking = await this.prisma.booking.findFirst({ where: { id, customerId: userId } });
    if (!booking) throw new NotFoundException({ message: 'Not found.' });

    if (!EDITABLE_STATUSES.includes(booking.status)) {
      throw new HttpException(
        { message: 'The shopping list can no longer be edited for this booking.' },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    const normalized: ShoppingItem[] = items.map((item) => ({
      id: randomUUID(),
      name: item.name,
      qty: item.qty != null ? Math.trunc(item.qty) : 1,
      checked: false,
      checked_at: null,
    }));

    return this.prisma.booking.update({
      where: { id: booking.id },
      data: { shoppingItems: normalized as unknown as Prisma.InputJsonValue },
      include: RESOURCE_INCLUDE,
    });
  }

  /**
   * ShoppingChecklistController::update — assigned runner ticks items off.
   * Only the runner may tick, and only while the errand is still active; the
   * refreshed list is pushed to the customer's realtime channel.
   */
  async updateRunnerChecklist(userId: string, id: string, changes: RunnerShoppingItemDto[]): Promise<BookingWithRelations> {
    const booking = await this.prisma.booking.findUnique({ where: { id } });
    if (!booking) throw new NotFoundException({ message: 'Not found.' });

    if (userId !== booking.runnerId) {
      throw new HttpException({ message: 'You are not assigned to this errand.' }, HttpStatus.FORBIDDEN);
    }

    if (CLOSED_STATUSES.includes(booking.status)) {
      throw new HttpException(
        { message: 'This errand is closed — its shopping list can no longer be updated.' },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    const existing = asArray<Record<string, unknown>>(booking.shoppingItems);
    if (existing.length === 0) {
      throw new HttpException(
        { message: 'This booking has no shopping list to update.' },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    // Index the requested checked-state changes by item id (last one wins).
    const changeMap: Record<string, boolean> = {};
    for (const change of changes) {
      changeMap[change.id] = Boolean(change.checked);
    }

    const now = this.nowIso8601();
    const items = existing.map((item) => {
      const itemId = item.id;
      if (typeof itemId === 'string' && Object.prototype.hasOwnProperty.call(changeMap, itemId)) {
        const checked = changeMap[itemId];
        return { ...item, checked, checked_at: checked ? now : null };
      }
      return item;
    });

    const full = await this.prisma.booking.update({
      where: { id: booking.id },
      data: { shoppingItems: items as unknown as Prisma.InputJsonValue },
      include: RESOURCE_INCLUDE,
    });

    // Push the fresh list to the customer so ticks land live (same direct-
    // broadcast pattern SOSService uses).
    await this.realtime.insertNotification(
      booking.customerId,
      'Shopping list updated',
      'Your runner updated the shopping checklist.',
      'shopping_items_updated',
      { booking_id: booking.id, shopping_items: items },
    );

    return full;
  }
}
