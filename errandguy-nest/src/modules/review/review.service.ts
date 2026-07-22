import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { User } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { userResource } from '../../common/resources/user.resource';
import { iso } from '../../common/serialization';
import { ReviewDto } from './dto/review.dto';

@Injectable()
export class ReviewService {
  constructor(private readonly prisma: PrismaService) {}

  async store(user: User, bookingId: string, dto: ReviewDto): Promise<Record<string, unknown>> {
    const booking = await this.prisma.booking.findUnique({ where: { id: bookingId } });
    if (!booking) throw new HttpException({ message: 'Not found.' }, HttpStatus.NOT_FOUND);

    // BookingPolicy::review — participant AND completed.
    const isParticipant =
      user.id === booking.customerId ||
      (booking.runnerId !== null && user.id === booking.runnerId);
    if (!isParticipant || booking.status !== 'completed') {
      throw new HttpException({ message: 'This action is unauthorized.' }, HttpStatus.FORBIDDEN);
    }

    let revieweeId: string | null;
    if (user.id === booking.customerId) revieweeId = booking.runnerId;
    else revieweeId = booking.customerId;
    if (!revieweeId) {
      throw new HttpException(
        { message: 'No counter-party to review on this booking.' },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    const existing = await this.prisma.review.findFirst({
      where: { bookingId: booking.id, reviewerId: user.id },
      select: { id: true },
    });
    if (existing) {
      throw new HttpException(
        { message: 'You have already reviewed this booking.' },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    const reviewId = await this.prisma.$transaction(async (tx) => {
      const review = await tx.review.create({
        data: {
          bookingId: booking.id,
          reviewerId: user.id,
          revieweeId: revieweeId!,
          rating: dto.rating,
          comment: dto.comment ?? null,
        },
      });
      // Lock reviewee, recompute aggregate rating.
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${revieweeId}::uuid FOR UPDATE`;
      const stats = await tx.review.aggregate({
        where: { revieweeId: revieweeId! },
        _avg: { rating: true },
        _count: { _all: true },
      });
      await tx.user.update({
        where: { id: revieweeId! },
        data: {
          avgRating: new Prisma.Decimal((stats._avg.rating ?? 0).toFixed(2)),
          totalRatings: stats._count._all,
        },
      });
      return review.id;
    });

    const review = await this.prisma.review.findUnique({
      where: { id: reviewId },
      include: { reviewer: true },
    });

    return {
      data: {
        id: review!.id,
        rating: review!.rating,
        comment: review!.comment,
        reviewer: userResource(review!.reviewer, user.id),
        created_at: iso(review!.createdAt),
      },
      message: 'Review submitted successfully.',
    };
  }
}
