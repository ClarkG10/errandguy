<?php

namespace App\Console\Commands;

use App\Models\Booking;
use App\Models\Message;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Storage;

/**
 * One-time (idempotent) migration of legacy booking media — chat images, runner
 * completion/receipt photos, and customer item photos — off the PUBLIC disk onto
 * the private 'media' disk, rewriting the stored URL to the participant-gated
 * route. New uploads already go to the private disk (BookingMediaController);
 * this closes the exposure for media uploaded BEFORE that change, which still
 * carries a public /storage URL fetchable by anyone.
 *
 * Idempotent: rows whose URL already points at /internal/media/ are skipped, so
 * it is safe to re-run. Use --dry-run to preview.
 */
class MigrateBookingMediaToPrivate extends Command
{
    protected $signature = 'errandguy:migrate-booking-media-to-private
        {--dry-run : Report what would change without writing anything}
        {--keep-public : Copy to the private disk but do NOT delete the public original}';

    protected $description = 'Move legacy public booking media (chat/photos/item photos) onto the private media disk and gate its URL.';

    private int $migrated = 0;

    private int $missing = 0;

    private int $errors = 0;

    public function handle(): int
    {
        $dryRun = (bool) $this->option('dry-run');
        $keepPublic = (bool) $this->option('keep-public');

        $this->line(($dryRun ? '[DRY RUN] ' : '').'Migrating legacy booking media...');

        // Chat images.
        Message::whereNotNull('image_url')
            ->where('image_url', 'not like', '%/internal/media/%')
            ->orderBy('id')
            ->chunkById(200, function ($messages) use ($dryRun, $keepPublic) {
                foreach ($messages as $message) {
                    $new = $this->migrateUrl($message->image_url, $dryRun, $keepPublic);
                    if ($new !== null && ! $dryRun) {
                        $message->update(['image_url' => $new]);
                    }
                }
            });

        // Booking photos (4 columns) + the item_photos JSON array.
        Booking::orderBy('id')->chunkById(200, function ($bookings) use ($dryRun, $keepPublic) {
            foreach ($bookings as $booking) {
                $update = [];

                foreach (['pickup_photo_url', 'receipt_photo_url', 'delivery_photo_url', 'signature_url'] as $col) {
                    $new = $this->migrateUrl($booking->{$col}, $dryRun, $keepPublic);
                    if ($new !== null) {
                        $update[$col] = $new;
                    }
                }

                $photos = $booking->item_photos ?? [];
                $changed = false;
                foreach ($photos as $i => $url) {
                    $new = $this->migrateUrl($url, $dryRun, $keepPublic);
                    if ($new !== null) {
                        $photos[$i] = $new;
                        $changed = true;
                    }
                }
                if ($changed) {
                    $update['item_photos'] = $photos;
                }

                if ($update !== [] && ! $dryRun) {
                    $booking->update($update);
                }
            }
        });

        $this->newLine();
        $this->info(($dryRun ? '[DRY RUN] ' : '')."Migrated: {$this->migrated}   Missing file: {$this->missing}   Errors: {$this->errors}");

        return $this->errors === 0 ? self::SUCCESS : self::FAILURE;
    }

    /**
     * Migrate a single legacy public-disk media URL to the private disk. Returns
     * the new gated URL when migrated, or null to leave the value unchanged
     * (already gated / not a public file / missing). In --dry-run it counts but
     * returns null.
     */
    private function migrateUrl(?string $url, bool $dryRun, bool $keepPublic): ?string
    {
        if (! is_string($url) || $url === '' || str_contains($url, '/internal/media/')) {
            return null; // empty or already private
        }

        $path = $this->publicDiskPath($url);
        if ($path === null || ! Storage::disk('public')->exists($path)) {
            $this->missing++;

            return null; // not a public-disk file, or already gone
        }

        if ($dryRun) {
            $this->migrated++;

            return null;
        }

        try {
            $stream = Storage::disk('public')->readStream($path);
            Storage::disk('media')->writeStream($path, $stream);
            if (is_resource($stream)) {
                fclose($stream);
            }

            if (! Storage::disk('media')->exists($path)) {
                throw new \RuntimeException('private-disk copy could not be verified');
            }

            if (! $keepPublic) {
                Storage::disk('public')->delete($path);
            }

            $this->migrated++;

            return route('booking.media', ['path' => $path]);
        } catch (\Throwable $e) {
            $this->error("  ERROR {$path}: {$e->getMessage()}");
            $this->errors++;

            return null;
        }
    }

    /**
     * Public-disk file URL -> disk-relative path, independent of APP_URL (public
     * URLs are always ".../storage/{path}").
     */
    private function publicDiskPath(string $url): ?string
    {
        $path = parse_url($url, PHP_URL_PATH);
        if (! is_string($path) || $path === '') {
            return null;
        }

        return preg_replace('#^storage/#', '', ltrim($path, '/'));
    }
}
