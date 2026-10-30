<?php

namespace App\Http\Controllers\Admin;

use App\Filament\Resources\SOSAlerts\SOSAlertResource;
use App\Http\Controllers\Controller;
use App\Models\SOSAlert;
use Illuminate\Http\JsonResponse;

/**
 * The open SOS alerts, for the alarm on every admin page
 * (resources/views/filament/sos-alarm.blade.php polls this). Answers only a
 * signed-in admin who handles safety; one small indexed query per poll.
 */
class SosAlarmController extends Controller
{
    public function __invoke(): JsonResponse
    {
        abort_unless(auth('admin')->user()?->canHandleSupport() ?? false, 403);

        $alerts = SOSAlert::query()
            ->where('status', SOSAlert::STATUS_ACTIVE)
            ->with(['booking:id,booking_number', 'triggeredBy:id,full_name'])
            ->orderByDesc('triggered_at')
            ->limit(10)
            ->get();

        return response()
            ->json([
                'active' => SOSAlert::where('status', SOSAlert::STATUS_ACTIVE)->count(),
                'alerts' => $alerts->map(fn (SOSAlert $alert): array => [
                    'id' => $alert->id,
                    'title' => 'SOS: '.($alert->triggeredBy?->full_name ?? 'someone')
                        .' ('.($alert->triggered_by_role ?? 'user').')',
                    'body' => 'Errand '.($alert->booking?->booking_number ?? '—')
                        .' · '.($alert->triggered_at?->diffForHumans() ?? 'just now'),
                    'url' => SOSAlertResource::getUrl('view', ['record' => $alert->id], panel: 'admin'),
                ])->values(),
            ])
            ->header('Cache-Control', 'no-store, private');
    }
}
