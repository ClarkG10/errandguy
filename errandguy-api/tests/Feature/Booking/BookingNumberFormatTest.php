<?php

namespace Tests\Feature\Booking;

use App\Services\BookingService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Locks the booking-number format: EG-YYYYMMDD-XXXXXX (18 chars). The 6-char
 * suffix (widened from 4) must stay within the unique varchar(20) column, and
 * the value stays an opaque display string the clients don't parse. (audit Low)
 */
class BookingNumberFormatTest extends TestCase
{
    use RefreshDatabase;

    public function test_generated_number_matches_format_and_fits_the_column(): void
    {
        $number = app(BookingService::class)->generateBookingNumber();

        $this->assertMatchesRegularExpression('/^EG-\d{8}-[A-Z0-9]{6}$/', $number);
        $this->assertLessThanOrEqual(20, strlen($number), 'must fit the varchar(20) column');
    }

    public function test_generated_numbers_are_unique_across_a_batch(): void
    {
        $service = app(BookingService::class);
        $numbers = collect(range(1, 50))->map(fn () => $service->generateBookingNumber());

        $this->assertCount(50, $numbers->unique(), 'no collisions in a same-day batch');
    }
}
