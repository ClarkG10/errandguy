<?php

namespace App\Providers;

use App\Events\BookingCancelled;
use App\Events\BookingCreated;
use App\Events\BookingStatusChanged;
use App\Events\RideDurationAlert;
use App\Events\RouteDeviationAlert;
use App\Listeners\RewardReferralOnFirstBooking;
use App\Listeners\SendBookingCancelledNotification;
use App\Listeners\SendBookingCreatedNotification;
use App\Listeners\SendBookingStatusNotification;
use App\Listeners\SendSafetyAlertNotification;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        //
    }

    public function boot(): void
    {
        Event::listen(BookingCreated::class, SendBookingCreatedNotification::class);
        Event::listen(BookingStatusChanged::class, SendBookingStatusNotification::class);
        Event::listen(BookingStatusChanged::class, RewardReferralOnFirstBooking::class);
        Event::listen(BookingCancelled::class, SendBookingCancelledNotification::class);
        Event::listen(RideDurationAlert::class, [SendSafetyAlertNotification::class, 'handleDurationAlert']);
        Event::listen(RouteDeviationAlert::class, [SendSafetyAlertNotification::class, 'handleRouteDeviation']);

        // Clamped page size for list endpoints. A client could otherwise pass
        // per_page=1000000 and force an unbounded query / huge payload. Use
        // $request->perPage($default) instead of ->integer('per_page', ...).
        Request::macro('perPage', function (int $default = 20, int $max = 100): int {
            /** @var Request $this */
            return max(1, min($this->integer('per_page', $default), $max));
        });
    }
}
