import { Body, Controller, HttpCode, HttpStatus, Param, Post, UseGuards } from '@nestjs/common';
import type { User } from '@prisma/client';
import { SanctumAuthGuard } from '../../common/auth/auth.guard';
import { ActiveGuard } from '../../common/auth/active.guard';
import { RolesGuard } from '../../common/auth/roles.guard';
import { Roles } from '../../common/auth/roles.decorator';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { ReviewService } from './review.service';
import { ReviewDto } from './dto/review.dto';

/**
 * Review submission. Role-agnostic logic (BookingPolicy::review allows either
 * party of a completed booking), exposed on the two role-scoped routes the
 * Laravel API declared.
 */
@Controller()
@UseGuards(SanctumAuthGuard, ActiveGuard, RolesGuard)
export class ReviewController {
  constructor(private readonly review: ReviewService) {}

  @Post('bookings/:id/review')
  @HttpCode(HttpStatus.CREATED)
  @Roles('customer')
  customerReview(@CurrentUser() user: User, @Param('id') id: string, @Body() dto: ReviewDto) {
    return this.review.store(user, id, dto);
  }

  @Post('runner/errand/:id/review')
  @HttpCode(HttpStatus.CREATED)
  @Roles('runner')
  runnerReview(@CurrentUser() user: User, @Param('id') id: string, @Body() dto: ReviewDto) {
    return this.review.store(user, id, dto);
  }
}
