<?php

namespace App\Services;

use App\Enums\BookingStatus;
use App\Models\AdminUser;
use App\Models\Booking;
use App\Models\BookingStatusLog;
use App\Models\BookingStop;
use App\Models\Message;
use App\Models\Notification;
use App\Models\Review;
use App\Models\RunnerProfile;
use App\Models\SOSAlert;
use App\Models\SupportMessage;
use App\Models\SupportTicket;
use App\Models\User;
use App\Models\WalletTransaction;
use App\Support\AdminActivity;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

/**
 * Right to erasure (PH Data Privacy Act) — the one way an account is deleted,
 * whether the person does it in the app (ProfileController::deleteAccount) or
 * staff do it for them after a request by email (the user page's "Erase
 * account"; also for a suspended account, which can't use the app). Both used
 * to need this; only the app had it, so an emailed request could only be done
 * by hand in the database, skipping the money checks and half the erasure.
 *
 * A soft delete leaves child PII intact (the FK cascade only fires on a HARD
 * delete), so it is erased explicitly. Financial records (bookings, payments,
 * wallet transactions) are kept for audit and tax; the personal details in or
 * attached to them are removed or redacted. What stays is listed on the
 * public /delete-account page — keep the two in step.
 *
 * Money rules (decided under the account's row lock):
 *   • a POSITIVE balance is sent out as a pending payout to the destination
 *     given (or the runner's saved one); the destination is recorded on the
 *     payout itself, because the account's own details are erased;
 *   • a NEGATIVE balance is money owed from cash errands, and is refused —
 *     erasing the identity would make it uncollectable;
 *   • bonus credit (non-withdrawable) never blocks; it lapses with the account.
 */
class AccountErasureService
{
    public const ERASED_TEXT = '[Deleted with the account]';

    public const ERASED_NAME = 'Deleted User';

    /**
     * @param  array<string, ?string>|null  $destination  a PayoutDestination, or null for the saved one
     * @return array{status: 'erased'|'already_erased'|'active_errand'|'debt'|'needs_destination', balance?: float, payout?: ?WalletTransaction}
     */
    public function erase(User $user, ?array $destination = null, ?AdminUser $staff = null, ?string $reason = null): array
    {
        // Not while an errand is in flight on either side: it would strand the
        // other person and orphan the GPS, chat and payout. Checked again under
        // the account lock below (an accept could land in between).
        if ($this->hasActiveErrand($user->id)) {
            return ['status' => 'active_errand'];
        }

        $profile = $user->runnerProfile;
        $destination ??= $profile?->payoutDestination($user->full_name);
        $name = (string) $user->full_name;

        // Files are removed only once the rows are gone: file deletes are not
        // transactional, so doing them after the commit never orphans a live
        // account's files should the transaction roll back.
        $publicFiles = [];
        $kycFiles = [];
        if ($profile) {
            foreach ($profile->documents as $doc) {
                // KYC docs live on the private kyc disk (file_path); legacy rows
                // still carry a public file_url. Erase whichever applies.
                if ($doc->file_path) {
                    $kycFiles[] = $doc->file_path;
                } elseif ($doc->file_url) {
                    $publicFiles[] = self::publicDiskPath($doc->file_url);
                }
            }
            if ($profile->vehicle_photo_url) {
                $publicFiles[] = self::publicDiskPath($profile->vehicle_photo_url);
            }
        }
        if ($user->avatar_url) {
            $publicFiles[] = self::publicDiskPath($user->avatar_url);
        }
        // Photos they sent in chats. Their messages' links are cleared below,
        // and the 30-day chat cleanup only removes a chat's photo folder while
        // some message still links a photo — so delete these files here.
        // Only a photo in THAT chat's own folder: before chat images were
        // server-made, a message's link was whatever the app sent, so a link
        // could name someone else's avatar or another errand's proof photo.
        $mediaFiles = [];
        $messages = Message::where('sender_id', $user->id)->whereNotNull('image_url')->get(['booking_id', 'image_url']);
        foreach ($messages as $message) {
            $folder = 'chat-images/'.$message->booking_id.'/';
            $private = self::mediaDiskPath((string) $message->image_url);
            $public = self::publicDiskPath((string) $message->image_url); // pre-private-disk photos
            if ($private !== null && str_starts_with($private, $folder)) {
                $mediaFiles[] = $private;
            } elseif ($private === null && self::isChatImagePath($public, $folder)) {
                $publicFiles[] = $public;
            }
        }

        $outcome = DB::transaction(function () use ($user, $profile, $destination, $name) {
            // The balance is decided under the account's row lock, so a payout,
            // earning or refund landing at the same moment can't slip past it.
            $locked = User::whereKey($user->id)->lockForUpdate()->first();
            if (! $locked) {
                return ['status' => 'already_erased']; // a racing request erased it first
            }

            // An accept or a new booking committed since the first check holds
            // this row's lock too, so this sees it.
            if ($this->hasActiveErrand($locked->id)) {
                return ['status' => 'active_errand'];
            }

            $balance = round((float) $locked->wallet_balance, 2);
            if ($balance < 0) {
                return ['status' => 'debt', 'balance' => $balance];
            }

            $payout = null;
            if ($balance > 0) {
                if ($destination === null) {
                    return ['status' => 'needs_destination', 'balance' => $balance];
                }

                $payout = app(WalletService::class)->createPendingPayout(
                    $locked->id,
                    $balance,
                    (string) Str::uuid(),
                    $destination,
                    0.0,
                    'Withdrawal on account deletion',
                );
            }

            if ($profile) {
                // A payout requested before payout details were recorded on the
                // payout itself is sent to the profile's details, which are
                // about to be erased: copy them onto it first, or staff would
                // have nowhere to send it.
                $profileDestination = $profile->payoutDestination($name);
                if ($profileDestination !== null) {
                    WalletTransaction::where('user_id', $user->id)
                        ->where('type', 'payout')
                        ->where('status', 'pending')
                        ->whereNull('payout_destination')
                        ->get()
                        ->each(fn (WalletTransaction $pending) => $pending->update(['payout_destination' => $profileDestination]));
                }

                // KYC identity documents (gov ID / selfie / licence): rows here,
                // files after the commit.
                $profile->documents()->delete();
                $profile->update([
                    'bank_name' => null,
                    'bank_account_number' => null,
                    'ewallet_number' => null,
                    'payout_channel_code' => null,
                    'payout_channel' => null,
                    'payout_account_name' => null,
                    // The vehicle and where they were or worked.
                    'vehicle_plate' => null,
                    'vehicle_photo_url' => null,
                    'current_lat' => null,
                    'current_lng' => null,
                    'last_location_at' => null,
                    'working_area_lat' => null,
                    'working_area_lng' => null,
                ]);

                // Their name in the notes the system wrote ("Accepted by runner
                // Juan Dela Cruz", and "Runner matched: …" from before offers
                // stopped naming the runner) — matched as whole notes, so a
                // customer's or staff member's own words are never edited, and
                // on any errand: an offer they declined no longer carries them
                // as its runner.
                // Scoped to rows that are theirs — the accept is logged under
                // their id, and an offer note under an errand they ran — so a
                // different runner with the same name is never touched, and the
                // update uses an index instead of scanning (and on MySQL
                // locking) the whole status log. Offers they only declined
                // aren't named to customers (BookingResource rewrites them).
                if ($name !== '') {
                    BookingStatusLog::where('changed_by', $user->id)
                        ->where('note', 'Accepted by runner '.$name)
                        ->update(['note' => 'Accepted by runner '.self::ERASED_NAME]);
                    BookingStatusLog::whereIn('booking_id', Booking::where('runner_id', $user->id)->select('id'))
                        ->where('note', 'Runner matched: '.$name)
                        ->update(['note' => 'Offered to a runner']);
                }
            }

            // Pure-PII child rows — no financial value (a legacy linked
            // payment account holds a gateway token, not money).
            $user->savedAddresses()->delete();
            $user->trustedContacts()->delete();
            $user->paymentMethods()->delete();
            // Their inbox: messages to them, about their errands.
            Notification::where('user_id', $user->id)->delete();

            // Redact the contact PII the user entered on THEIR OWN (customer)
            // bookings — keep the booking (financial record), drop the personal
            // contact details. Scoped to their own bookings so another party's
            // PII on a shared booking is never touched.
            $bookingIds = Booking::where('customer_id', $user->id)->pluck('id');
            if ($bookingIds->isNotEmpty()) {
                Booking::whereIn('id', $bookingIds)->update([
                    'pickup_contact_name' => null,
                    'pickup_contact_phone' => null,
                    'dropoff_contact_name' => null,
                    'dropoff_contact_phone' => null,
                ]);
                BookingStop::whereIn('booking_id', $bookingIds)->update([
                    'contact_name' => null,
                    'contact_phone' => null,
                ]);
            }

            // What they wrote elsewhere. The rows stay — a support thread, a
            // chat, a review's star rating and an SOS record are history the
            // other side and staff still need — but the words and places are
            // erased.
            SupportMessage::where('sender_id', $user->id)
                ->where('sender_type', 'user')
                ->update(['content' => self::ERASED_TEXT, 'image_url' => null]);
            SupportTicket::where('user_id', $user->id)->update(['subject' => self::ERASED_TEXT]);
            Message::where('sender_id', $user->id)->update(['content' => self::ERASED_TEXT, 'image_url' => null]);
            // Comments only: the rating is unchanged, so no average moves.
            Review::where('reviewer_id', $user->id)->whereNotNull('comment')->update(['comment' => null]);
            SOSAlert::where('triggered_by', $user->id)->update([
                'trigger_lat' => null,
                'trigger_lng' => null,
                'trigger_accuracy_m' => null,
                'live_link_token' => null,
            ]);
            SOSAlert::where('customer_id', $user->id)->update(['customer_lat' => null, 'customer_lng' => null]);
            SOSAlert::where('runner_id', $user->id)->update(['runner_lat' => null, 'runner_lng' => null]);

            // Anonymize the account row itself. Only these columns are written
            // (the balance was just debited through the ledger on its own row).
            $user->update([
                'full_name' => self::ERASED_NAME,
                'email' => null,
                'phone' => null,
                'avatar_url' => null,
                'fcm_token' => null,
                'default_lat' => null,
                'default_lng' => null,
            ]);

            // Revoke all API tokens, and drop every registered push device (the
            // FK cascade only fires on a HARD delete, and this is a soft delete)
            // so a deleted account stops receiving pushes.
            $user->tokens()->delete();
            $user->deviceTokens()->delete();

            // A deleted runner can't answer an offer: stop matching them.
            RunnerProfile::switchOffline($user->id);

            $user->delete();

            return ['status' => 'erased', 'payout' => $payout];
        });

        if ($outcome['status'] !== 'erased') {
            return $outcome;
        }

        // Remove the collected PII files from disk (best-effort, post-commit).
        // One bad path (a legacy link with "../" makes the disk throw) must not
        // stop the others, or the staff audit entry below.
        foreach ([['public', array_filter($publicFiles)], ['kyc', array_filter($kycFiles)], ['media', $mediaFiles]] as [$disk, $paths]) {
            foreach ($paths as $path) {
                try {
                    Storage::disk($disk)->delete($path);
                } catch (\Throwable $e) {
                    \Illuminate\Support\Facades\Log::warning('Account erasure: a file could not be deleted', [
                        'user_id' => $user->id, 'disk' => $disk, 'error' => $e->getMessage(),
                    ]);
                }
            }
        }

        if ($staff !== null) {
            AdminActivity::log('user.erased', $user, [
                'reason' => $reason,
                'payout_id' => ($outcome['payout'] ?? null)?->id,
            ], 'Erased an account on request');
        }

        return $outcome;
    }

    /** An errand still in flight on either side of the account. */
    private function hasActiveErrand(string $userId): bool
    {
        return Booking::where(fn ($q) => $q->where('customer_id', $userId)->orWhere('runner_id', $userId))
            ->whereNotIn('status', BookingStatus::ENDED)
            ->exists();
    }

    /** A public-disk path that is a photo directly in the given chat-images/{booking}/ folder. */
    private static function isChatImagePath(?string $path, string $folder): bool
    {
        return $path !== null
            && str_starts_with($path, $folder)
            && preg_match('#^chat-images/[0-9a-fA-F-]{36}/[A-Za-z0-9._-]+$#', $path) === 1;
    }

    /** The private media-disk path behind a booking media URL (…/internal/media/{path}), or null. */
    private static function mediaDiskPath(string $url): ?string
    {
        $path = (string) parse_url($url, PHP_URL_PATH);
        $at = strpos($path, '/internal/media/');
        if ($at === false) {
            return null;
        }
        $relative = rawurldecode(substr($path, $at + strlen('/internal/media/')));

        // The same shape BookingMediaController serves: never anything else.
        return preg_match('#^(chat-images|booking-photos)/[0-9a-fA-F-]{36}/[A-Za-z0-9._-]+$#', $relative) === 1
            ? $relative
            : null;
    }

    /**
     * Turn a public-disk file URL into a disk-relative path, independent of the
     * APP_URL it was generated under — public URLs are always ".../storage/{path}",
     * so a later domain change can't leave a gov-ID / avatar file undeletable
     * (a plain str_replace of the current base URL would silently no-op then).
     */
    private static function publicDiskPath(string $url): ?string
    {
        $path = parse_url($url, PHP_URL_PATH);
        if (! is_string($path) || $path === '') {
            return null;
        }

        // Strip the leading "/storage/" public-disk symlink prefix.
        return preg_replace('#^storage/#', '', ltrim($path, '/'));
    }
}
