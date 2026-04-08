<?php

namespace App\Providers;

use App\Events\BookingCancelled;
use App\Events\BookingCreated;
use App\Events\BookingStatusChanged;
use App\Events\RideDurationAlert;
use App\Events\RouteDeviationAlert;
use App\Listeners\SendBookingCancelledNotification;
use App\Listeners\SendBookingCreatedNotification;
use App\Listeners\SendBookingStatusNotification;
use App\Listeners\SendSafetyAlertNotification;
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
        Event::listen(BookingCancelled::class, SendBookingCancelledNotification::class);
        Event::listen(RideDurationAlert::class, [SendSafetyAlertNotification::class, 'handleDurationAlert']);
        Event::listen(RouteDeviationAlert::class, [SendSafetyAlertNotification::class, 'handleRouteDeviation']);
    }
}
