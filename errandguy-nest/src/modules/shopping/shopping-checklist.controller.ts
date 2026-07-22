import { Body, Controller, Param, Patch, UseGuards } from '@nestjs/common';
import type { User } from '@prisma/client';
import { SanctumAuthGuard } from '../../common/auth/auth.guard';
import { ActiveGuard } from '../../common/auth/active.guard';
import { RolesGuard } from '../../common/auth/roles.guard';
import { Roles } from '../../common/auth/roles.decorator';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { bookingResource } from '../booking/booking.resource';
import { ShoppingService } from './shopping.service';
import { RunnerUpdateShoppingItemsDto } from './dto/runner-shopping-items.dto';

/** PATCH /runner/errand/{id}/shopping-items — runner ticks items while shopping. */
@Controller('runner/errand')
@UseGuards(SanctumAuthGuard, ActiveGuard, RolesGuard)
@Roles('runner')
export class ShoppingChecklistController {
  constructor(private readonly shopping: ShoppingService) {}

  @Patch(':id/shopping-items')
  async update(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() dto: RunnerUpdateShoppingItemsDto,
  ): Promise<Record<string, unknown>> {
    const booking = await this.shopping.updateRunnerChecklist(user.id, id, dto.items);
    return {
      data: bookingResource(booking, user.id),
      message: 'Shopping checklist updated.',
    };
  }
}
