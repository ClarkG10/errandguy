import { Controller, Get, HttpException, HttpStatus, Param } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RouteThrottle } from '../../common/throttling/throttle.decorators';
import { dec, iso } from '../../common/serialization';

@Controller('trip')
export class PublicTripController {
  constructor(private readonly prisma: PrismaService) {}

  @Get(':token')
  @RouteThrottle(60, 1)
  async show(@Param('token') token: string): Promise<Record<string, unknown>> {
    const booking = await this.prisma.booking.findFirst({
      where: {
        tripShareToken: token,
        tripShareActive: true,
        // PRIVACY: Auto-expire shared links once the trip is over so the
        // recipient can't keep watching the runner / customer addresses
        // indefinitely. The customer can still re-share if they reopen
        // (rebook) the errand.
        status: { notIn: ['completed', 'cancelled', 'no_runner'] },
      },
      include: { runner: { include: { runnerProfile: true } } },
    });
    if (!booking) throw new HttpException({ message: 'Not found.' }, HttpStatus.NOT_FOUND);

    const latestLocation = await this.prisma.runnerLocation.findFirst({
      where: { bookingId: booking.id },
      orderBy: { createdAt: 'desc' },
    });

    const runner = booking.runner;
    const profile = runner?.runnerProfile;

    return {
      data: {
        booking_id: booking.id,
        status: booking.status,
        pickup_address: booking.pickupAddress,
        dropoff_address: booking.dropoffAddress,
        pickup_lat: dec(booking.pickupLat, 7),
        pickup_lng: dec(booking.pickupLng, 7),
        dropoff_lat: dec(booking.dropoffLat, 7),
        dropoff_lng: dec(booking.dropoffLng, 7),
        errand_type: booking.errandTypeId,
        runner: runner
          ? {
              // Only first name + initial of surname so a stranger tracking the
              // link can identify the runner without getting their full
              // identity from a forwarded URL.
              name: this.shortenName(runner.fullName),
              avatar_url: runner.avatarUrl,
              rating: dec(runner.avgRating),
              vehicle_type: profile?.vehicleType ?? null,
              plate_number: profile?.vehiclePlate ?? null,
            }
          : null,
        runner_location: latestLocation
          ? {
              lat: dec(latestLocation.lat, 7),
              lng: dec(latestLocation.lng, 7),
              updated_at: iso(latestLocation.createdAt),
            }
          : null,
      },
    };
  }

  /**
   * Returns "Juan D." from "Juan Dela Cruz" so shared trip links don't leak the
   * runner's full surname to whoever the customer forwards the link to.
   */
  private shortenName(fullName?: string | null): string {
    if (!fullName) {
      return 'Runner';
    }
    const parts = fullName.trim().split(/\s+/);
    if (parts.length === 1) {
      return parts[0];
    }
    const first = parts[0];
    const lastInitial = [...parts[parts.length - 1]][0] ?? '';

    return `${first} ${lastInitial}.`;
  }
}
