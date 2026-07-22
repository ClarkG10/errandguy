import { Module } from '@nestjs/common';
import { BookingModule } from '../booking/booking.module';
import { ShoppingListController } from './shopping-list.controller';
import { ShoppingChecklistController } from './shopping-checklist.controller';
import { ShoppingService } from './shopping.service';

/**
 * Shopping checklist: customer edits the list pre-pickup (PUT
 * bookings/{id}/shopping-items) and the runner ticks items while shopping
 * (PATCH runner/errand/{id}/shopping-items). Imports BookingModule for the
 * shared bookingResource serializer.
 */
@Module({
  imports: [BookingModule],
  controllers: [ShoppingListController, ShoppingChecklistController],
  providers: [ShoppingService],
})
export class ShoppingModule {}
