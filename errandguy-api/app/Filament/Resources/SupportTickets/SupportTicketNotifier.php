<?php

namespace App\Filament\Resources\SupportTickets;

use App\Jobs\SendPushJob;
use App\Models\SupportMessage;
use App\Models\SupportTicket;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;

/**
 * Tells the TICKET OWNER that support moved — the half of the support system
 * that was missing.
 *
 * Before this, an agent reply from /admin inserted a SupportMessage row and
 * stopped there: no in-app notification, no Reverb broadcast, no device push.
 * The user's only way to discover an answer was to back out of the thread and
 * re-open it, repeatedly. Same for a status change (resolved/closed) — silent.
 *
 * Delivery goes through the existing SendPushJob → NotificationService::sendPush,
 * i.e. an in-app notification row + a live `notifications.{userId}` Reverb
 * broadcast + a best-effort Expo/FCM device push. Queued (not inline) so the
 * admin's reply request never blocks on outbound Expo latency — the same
 * reasoning as the admin verify/dispute-resolve call sites.
 *
 * CONTRACT with the mobile app (it keys its thread refresh on these exact
 * `data.type` values, so do not rename them):
 *   • agent reply         → data { type: 'support_reply',  ticket_id }
 *   • agent status change → data { type: 'support_status', ticket_id, status }
 *
 * PRIVACY: the copy is deliberately generic. Neither the reply text nor the
 * user-authored ticket subject is interpolated — push payloads traverse
 * Expo/FCM and land in provider logs, and the thread itself already carries the
 * content.
 */
class SupportTicketNotifier
{
    /** Notification `data.type` for an agent reply landing in a thread. */
    public const TYPE_REPLY = 'support_reply';

    /** Notification `data.type` for an agent-driven ticket status change. */
    public const TYPE_STATUS = 'support_status';

    /**
     * Statuses worth telling the user about. 'pending' is deliberately absent:
     * it is the internal "awaiting" marker the reply action itself sets, so
     * notifying on it would double-notify every single agent reply.
     */
    private const NOTIFIABLE_STATUSES = ['open', 'resolved', 'closed'];

    /** Reply latch TTL (seconds) — keyed per message, so this only ever absorbs a retry. */
    private const REPLY_LATCH_TTL = 3600;

    /**
     * Status latch TTL (seconds). Absorbs a double-submitted / retried status
     * action without silencing a genuine later change (an admin re-resolving a
     * ticket 10 minutes on notifies again).
     */
    private const STATUS_LATCH_TTL = 600;

    /**
     * An agent replied in the thread. Idempotent per message: a retried
     * Livewire action or a re-run of this notifier for the same reply sends once.
     */
    public static function replied(SupportTicket $ticket, SupportMessage $message): void
    {
        if (! Cache::add('support_notified:reply:'.$message->id, true, self::REPLY_LATCH_TTL)) {
            return;
        }

        self::deliver(
            $ticket,
            'Support replied',
            'Our support team answered your ticket. Tap to read the reply.',
            [
                'type' => self::TYPE_REPLY,
                'ticket_id' => (string) $ticket->id,
            ],
        );
    }

    /**
     * An agent changed the ticket status. Idempotent per (ticket, status) inside
     * the latch window. No-ops for statuses the user has no use for.
     */
    public static function statusChanged(SupportTicket $ticket, string $status): void
    {
        if (! in_array($status, self::NOTIFIABLE_STATUSES, true)) {
            return;
        }

        if (! Cache::add("support_notified:status:{$ticket->id}:{$status}", true, self::STATUS_LATCH_TTL)) {
            return;
        }

        [$title, $body] = match ($status) {
            'resolved' => ['Ticket resolved', 'Support marked your ticket as resolved. Reply in the thread if you still need help.'],
            'closed' => ['Ticket closed', 'Support closed your ticket. Replying in the thread re-opens it.'],
            default => ['Ticket re-opened', "We've re-opened your support ticket and are looking into it again."],
        };

        self::deliver(
            $ticket,
            $title,
            $body,
            [
                'type' => self::TYPE_STATUS,
                'ticket_id' => (string) $ticket->id,
                'status' => $status,
            ],
        );
    }

    /**
     * Best-effort dispatch. A broken queue connection must never fail the
     * admin's reply — the durable state (the message / the status) is already
     * committed by the caller, mirroring AdminAlert::raise's swallow-and-log.
     *
     * @param  array<string,mixed>  $data
     */
    private static function deliver(SupportTicket $ticket, string $title, string $body, array $data): void
    {
        if (! $ticket->user_id) {
            return;
        }

        try {
            SendPushJob::dispatch((string) $ticket->user_id, $title, $body, $data);
        } catch (\Throwable $e) {
            Log::warning('SupportTicketNotifier: failed to dispatch owner notification', [
                'ticket_id' => $ticket->id,
                'type' => $data['type'] ?? null,
                'error' => $e->getMessage(),
            ]);
        }
    }
}
