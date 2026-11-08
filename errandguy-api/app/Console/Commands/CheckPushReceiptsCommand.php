<?php

namespace App\Console\Commands;

use App\Models\AdminAlert;
use App\Models\DeviceToken;
use App\Models\PushTicket;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

/**
 * Read Expo's delivery receipts for pushes sent at least 15 minutes ago.
 *
 * A push "ticket" only says Expo accepted the message. Whether Apple or
 * Google took it arrives later as a receipt:
 *   - DeviceNotRegistered: the app was uninstalled — the token is deleted so
 *     pushes stop going to it (most of these only show up here, not at send);
 *   - InvalidCredentials / MismatchSenderId: the FCM or APNs credentials Expo
 *     holds for the app are wrong — EVERY push on that platform is failing,
 *     including runners' offer pushes. Nothing said so; now staff get a
 *     critical alert (at most every 6 hours);
 *   - anything else (MessageTooBig, MessageRateExceeded) is logged.
 *
 * Tickets are deleted once their receipt is read, and dropped after a day
 * (Expo keeps receipts for 24 hours).
 */
class CheckPushReceiptsCommand extends Command
{
    protected $signature = 'errandguy:check-push-receipts';

    protected $description = 'Read Expo push receipts: prune uninstalled devices, alert on broken push credentials';

    private const BATCH = 1000;

    private const MAX_PER_RUN = 10000;

    private const CREDENTIAL_ERRORS = ['InvalidCredentials', 'MismatchSenderId'];

    public function handle(): int
    {
        PushTicket::where('created_at', '<', now()->subDay())->delete();

        $checked = 0;
        $pruned = 0;
        $failed = [];

        PushTicket::where('created_at', '<=', now()->subMinutes(15))
            ->orderBy('id')
            ->limit(self::MAX_PER_RUN)
            ->get()
            ->chunk(self::BATCH)
            ->each(function ($tickets) use (&$checked, &$pruned, &$failed) {
                try {
                    $response = Http::connectTimeout(3)->timeout(15)
                        ->post('https://exp.host/--/api/v2/push/getReceipts', ['ids' => $tickets->pluck('ticket_id')->all()]);
                } catch (\Throwable $e) {
                    Log::warning('Expo receipts request failed', ['error' => $e->getMessage()]);

                    return; // tried again next run
                }
                if (! $response->successful()) {
                    Log::warning('Expo receipts request refused', ['status' => $response->status()]);

                    return;
                }

                $receipts = (array) ($response->json('data') ?? []);
                $byTicket = $tickets->keyBy('ticket_id');
                $dead = [];
                foreach ($receipts as $ticketId => $receipt) {
                    $ticket = $byTicket->get($ticketId);
                    if (! $ticket || ($receipt['status'] ?? null) !== 'error') {
                        continue;
                    }
                    $error = (string) ($receipt['details']['error'] ?? 'unknown');
                    if ($error === 'DeviceNotRegistered') {
                        $dead[] = $ticket->token;
                    } else {
                        $failed[$error] = $receipt['message'] ?? $error;
                    }
                }

                if ($dead !== []) {
                    $pruned += DeviceToken::whereIn('token', array_unique($dead))->delete();
                }

                // Read receipts are done with; a ticket with no receipt yet
                // stays for the next run (until the day is up).
                $checked += PushTicket::whereIn('ticket_id', array_keys($receipts))->delete();
            });

        foreach ($failed as $error => $message) {
            Log::error('Expo push receipt error', ['error' => $error, 'message' => $message]);
        }

        $credentialError = array_values(array_intersect(array_keys($failed), self::CREDENTIAL_ERRORS))[0] ?? null;
        if ($credentialError !== null && Cache::add('push_credentials_broken_alert', true, now()->addHours(6))) {
            AdminAlert::raise(
                'push_credentials_broken',
                'critical',
                'Push notifications are not being delivered',
                'Apple or Google refused our push credentials ('.$credentialError.': '.$failed[$credentialError].'). '
                    .'Phones on that platform get no pushes, including runners\' new-errand offers. Check the FCM / APNs '
                    .'keys in the Expo (EAS) project credentials.',
            );
        }

        $this->info("Read {$checked} receipts, removed {$pruned} uninstalled devices.");

        return self::SUCCESS;
    }
}
