<?php

use App\Http\Controllers\HealthController;
use App\Http\Controllers\RunnerDocumentFileController;
use Illuminate\Support\Facades\Route;

Route::get('/', function () {
    return view('welcome');
});

// Deep health probe (DB + cache/Redis) for uptime monitoring — unlike the
// framework default '/up', it goes RED on a real dependency outage. (audit DR)
Route::get('/health', HealthController::class)->name('health');

/*
| KYC document viewer for the admin panel.
|
| A WEB route (session), NOT the sanctum admin API, so the Filament panel's
| <img>/link loads authorize via the admin session cookie. The path sits OUTSIDE
| the Filament `/admin` prefix to avoid its route catch-all; the admin-guard
| check lives in the controller (a 403 for anon, never a login redirect on an
| image request). Files are streamed from the private kyc disk. (audit KYC)
*/
Route::middleware('web')
    ->get('/internal/runner-documents/{document}/file', [RunnerDocumentFileController::class, 'adminShow'])
    ->name('admin.runner-documents.file');

/*
| Payment return bridge.
|
| Xendit only accepts https `success_redirect_url`s, and iOS's in-app auth
| session only auto-closes on a CUSTOM scheme. So Xendit redirects the
| checkout browser here (https) after a successful payment, and this page
| instantly forwards to the app's deep link (errandguy://payment-complete),
| which the in-app sheet intercepts and closes. Must match PAYMENT_RETURN_URL
| in the mobile app (src/utils/browser.ts).
*/
Route::get('/payment/complete', function () {
    return response(view('payment-complete'))
        ->header('Content-Type', 'text/html');
});
