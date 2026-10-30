<?php

namespace App\Console\Commands;

use App\Models\Booking;
use App\Models\Message;
use App\Models\Notification;
use App\Services\LocationService;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Storage;

/**
 * Daily data retention:
 *
 *   - runner locations: 24 hours;
 *   - chat: 30 days after the errand ended — completed, cancelled, or left
 *     unmatched (no_runner) — messages AND their photos. Chat photos live in
 *     "chat-images/{booking}/" on the private media disk (and, for photos sent
 *     before media went private, the public disk), so the booking's whole
 *     folder goes once its messages do. Files are removed before rows, so a
 *     failure can leave a message pointing at a missing photo, never a photo
 *     nobody can find to delete;
 *   - inbox notifications: 90 days. An UNREAD SOS notice is kept up to a year:
 *     a safety message the person never saw shouldn't vanish on a timer, but
 *     it doesn't stay forever either.
 *
 * Errand photos (pickup / receipt / delivery proofs, item photos) are records
 * of the errand and are kept.
 */
class CleanupLocationsCommand extends Command
{
    public const CHAT_RETENTION_DAYS = 30;

    public const INBOX_RETENTION_DAYS = 90;

    public const UNREAD_SOS_RETENTION_DAYS = 365;

    private const BATCH = 1000;

    private const BOOKING_BATCH = 100;

    protected $signature = 'errandguy:cleanup-locations';

    protected $description = 'Delete runner locations (>24h), chats and their photos (30 days after an errand ended) and inbox notifications (>90 days).';

    public function handle(LocationService $locations): int
    {
        // Delegates to the service so there is ONE (batched, indexed) prune
        // implementation. (PERF-BE-4)
        $locationCount = $locations->cleanupOldLocations();
        $this->info("Deleted {$locationCount} old runner location records.");

        [$messageCount, $folderCount] = $this->pruneChats();
        $this->info("Deleted {$messageCount} old message records and the photos of {$folderCount} chat(s).");

        $notificationCount = $this->pruneInbox();
        $this->info("Deleted {$notificationCount} old inbox notifications.");

        return self::SUCCESS;
    }

    /**
     * Chats of errands that ended 30+ days ago, a batch of bookings at a time
     * (select ids, then delete by key — no correlated-subquery DELETE locking a
     * large slice of the table, and no DELETE … LIMIT, which SQLite rejects).
     *
     * @return array{0: int, 1: int} messages deleted, chats whose photos were removed
     */
    private function pruneChats(): array
    {
        $cutoff = now()->subDays(self::CHAT_RETENTION_DAYS);
        $messages = 0;
        $folders = 0;

        do {
            $bookingIds = Booking::query()
                ->where(function ($q) use ($cutoff) {
                    $q->where(fn ($q) => $q->where('status', 'completed')->where('completed_at', '<', $cutoff))
                        ->orWhere(fn ($q) => $q->where('status', 'cancelled')->where(
                            fn ($q) => $q->where('cancelled_at', '<', $cutoff)
                                ->orWhere(fn ($q) => $q->whereNull('cancelled_at')->where('updated_at', '<', $cutoff))
                        ))
                        ->orWhere(fn ($q) => $q->where('status', 'no_runner')->where('updated_at', '<', $cutoff));
                })
                ->whereHas('messages')
                ->limit(self::BOOKING_BATCH)
                ->pluck('id');

            $deletedThisBatch = 0;
            foreach ($bookingIds as $bookingId) {
                if (Message::where('booking_id', $bookingId)->whereNotNull('image_url')->exists()) {
                    Storage::disk('media')->deleteDirectory("chat-images/{$bookingId}");
                    Storage::disk('public')->deleteDirectory("chat-images/{$bookingId}");
                    $folders++;
                }

                $deletedThisBatch += Message::where('booking_id', $bookingId)->delete();
            }
            $messages += $deletedThisBatch;
        } while ($bookingIds->count() === self::BOOKING_BATCH && $deletedThisBatch > 0);

        return [$messages, $folders];
    }

    private function pruneInbox(): int
    {
        $cutoff = now()->subDays(self::INBOX_RETENTION_DAYS);
        $sosCutoff = now()->subDays(self::UNREAD_SOS_RETENTION_DAYS);
        $deleted = 0;

        do {
            $ids = Notification::query()
                ->where('created_at', '<', $cutoff)
                ->where(fn ($q) => $q->whereNull('type')
                    ->orWhere('type', '!=', 'sos')
                    ->orWhere('is_read', true)
                    ->orWhere('created_at', '<', $sosCutoff))
                ->limit(self::BATCH)
                ->pluck('id');

            if ($ids->isNotEmpty()) {
                $deleted += Notification::whereKey($ids)->delete();
            }
        } while ($ids->count() === self::BATCH);

        return $deleted;
    }
}
