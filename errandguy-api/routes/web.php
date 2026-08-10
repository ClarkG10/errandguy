<?php

use Illuminate\Support\Facades\Route;

Route::get('/', function () {
    return view('welcome');
});

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

/*
| Admin KYC-document viewer (SEC-1).
|
| Runner identity documents live on the PRIVATE disk. The Filament admin panel
| (session guard `admin`) renders them via this authenticated route — an admin's
| browser sends its session cookie, so an <img>/link pointing here loads the
| file, while it stays unreachable to the public. Named so Filament resources
| can reference it.
*/
Route::get('/admin/runner-documents/{document}/file', [
    \App\Http\Controllers\Runner\RunnerDocumentFileController::class, 'showForAdmin',
])->middleware(['web', 'auth:admin'])->name('admin.runner-documents.file');
