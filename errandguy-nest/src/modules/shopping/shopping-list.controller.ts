import { Body, Controller, Param, Put, UseGuards } from '@nestjs/common';
import type { User } from '@prisma/client';
import { SanctumAuthGuard } from '../../common/auth/auth.guard';
import { ActiveGuard } from '../../common/auth/active.guard';
import { RolesGuard } from '../../common/auth/roles.guard';
import { Roles } from '../../common/auth/roles.decorator';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { bookingResource } from '../booking/booking.resource';
import { ShoppingService } from './shopping.service';
import { UpdateShoppingItemsDto } from './dto/update-shopping-items.dto';

/** PUT /bookings/{id}/shopping-items — customer replaces the checklist pre-pickup. */
@Controller('bookings')
@UseGuards(SanctumAuthGuard, ActiveGuard, RolesGuard)
@Roles('customer')
export class ShoppingListController {
  constructor(private readonly shopping: ShoppingService) {}

  @Put(':id/shopping-items')
  async update(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() dto: UpdateShoppingItemsDto,
  ): Promise<Record<string, unknown>> {
    const booking = await this.shopping.updateCustomerList(user.id, id, dto.items);
    return {
      data: bookingResource(booking, user.id),
      message: 'Shopping list updated.',
    };
  }
}
