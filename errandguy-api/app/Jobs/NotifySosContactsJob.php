<?php

namespace App\Jobs;

use App\Mail\SosStaffAlert;
use App\Models\AdminAlert;
use App\Models\SOSAlert;
use App\Models\TrustedContact;
use App\Services\Sms\SmsSender;
use App\Support\OpsAlertRecipients;
use App\Support\PhilippinePhone;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;

/**
 * Gets a new SOS to people outside the app:
 *
 *   1. a text with the live-location link to each of the raiser's trusted
 *      contacts;
 *   2. a text to the staff numbers in the ops_alert_phone setting;
 *   3. an email to the staff addresses in the ops_alert_emails setting.
 *
 * SOSService dispatches this AFTER THE RESPONSE, in the same process: the
 * panic button returns at once and nothing waits on a queue worker that may be
 * down. Each channel is tried on its own, so one failing never stops the
 * others. Whatever did not go out — a send that failed, or a channel that is
 * not set up — is listed in one critical admin alert, so staff know to call
 * people themselves.
 *
 * The other person on the errand is deliberately NOT told: they may be the
 * danger. Staff decide whom to involve.
 *
 * `contacts_notified` is written here and only here, with just the contacts
 * the SMS provider accepted a text for — the app shows it to the person in the
 * emergency as who their alert reached.
 */
class NotifySosContactsJob extends BaseJob
{
    /** One attempt: a retry would text everyone a second time. */
    public int $tries = 1;

    /** How many rounds of trusted-contact texts one person's alerts may send in a Manila day. */
    public const CONTACT_TEXT_ROUNDS_PER_DAY = 3;

    public function __construct(public string $alertId) {}

    /** Today's (Manila) count of trusted-contact text rounds for one person's alerts. */
    public static function contactRoundsKey(string $userId): string
    {
        return 'sos-contact-texts:'.$userId.':'.\App\Support\BusinessDay::date();
    }

    /**
     * Whether this person's next alert will text their trusted contacts. The
     * reply to the person checks this BEFORE promising "we're texting your
     * contacts" — it must never say so when the day's rounds are used up.
     */
    public static function canTextContactsAgainToday(string $userId): bool
    {
        return (int) \Illuminate\Support\Facades\Cache::get(self::contactRoundsKey($userId), 0) < self::CONTACT_TEXT_ROUNDS_PER_DAY;
    }

    public function handle(SmsSender $sms): void
    {
        $alert = SOSAlert::with(['booking.errandType', 'triggeredBy'])->find($this->alertId);
        if (! $alert || ! $alert->booking || $alert->status !== SOSAlert::STATUS_ACTIVE) {
            return;
        }

        /** @var array<int,string> $gaps what did not go out, in plain words */
        $gaps = [];

        $this->textTrustedContacts($alert, $sms, $gaps);
        $this->textStaff($alert, $sms, $gaps);
        $this->emailStaff($alert, $gaps);

        if ($gaps !== []) {
            AdminAlert::raise(
                'sos_delivery',
                'critical',
                'SOS: some alerts did not go out',
                'Booking '.($alert->booking->booking_number ?? $alert->booking_id).' — '.implode(' ', $gaps)
                    .' Call the person and their trusted contacts from the alert page.',
                $alert->id,
            );
        }
    }

    /** @param  array<int,string>  $gaps */
    private function textTrustedContacts(SOSAlert $alert, SmsSender $sms, array &$gaps): void
    {
        $contacts = TrustedContact::where('user_id', $alert->triggered_by)
            ->where('is_active', true)
            ->orderBy('priority')
            ->orderBy('created_at')
            ->get();

        if ($contacts->isEmpty()) {
            return;
        }

        if (! $sms->isConfigured()) {
            $gaps[] = 'Texts to '.$contacts->count().' trusted '.($contacts->count() === 1 ? 'contact' : 'contacts').' were not sent: SMS is not set up.';

            return;
        }

        // At most a few rounds of texts a day per person. Raising and calling
        // off SOS in a loop otherwise texted the same (up to five) numbers each
        // time — any numbers, under our name, on our SMS bill. Not per errand:
        // someone who calls an alert off by mistake and raises it again for
        // real must reach their contacts with the new live link. Staff are
        // still alerted every time.
        $roundsKey = self::contactRoundsKey($alert->triggered_by);
        \Illuminate\Support\Facades\Cache::add($roundsKey, 0, now()->addHours(26));
        if (\Illuminate\Support\Facades\Cache::increment($roundsKey) > self::CONTACT_TEXT_ROUNDS_PER_DAY) {
            $gaps[] = 'Trusted contacts were not texted again: they were already texted '
                .self::CONTACT_TEXT_ROUNDS_PER_DAY.' times today about this person\'s alerts.';

            return;
        }

        try {
            $result = $sms->send($contacts->pluck('phone')->all(), $this->contactMessage($alert));
        } catch (\Throwable $e) {
            // Nothing went out: this round doesn't count toward the day's.
            \Illuminate\Support\Facades\Cache::decrement($roundsKey);
            Log::error('SOS trusted-contact texts failed', ['alert_id' => $alert->id, 'error' => $e->getMessage()]);
            $gaps[] = 'Texts to trusted contacts failed.';

            return;
        }

        $delivered = $contacts
            ->filter(fn (TrustedContact $contact): bool => $result->wasAccepted($contact->phone))
            ->pluck('id')
            ->values()
            ->all();

        if ($delivered !== []) {
            $alert->update(['contacts_notified' => $delivered]);
        }

        $missed = $contacts->count() - count($delivered);
        if ($missed > 0) {
            Log::warning('SOS trusted-contact texts not all sent', [
                'alert_id' => $alert->id,
                'sent' => count($delivered),
                'not_sent' => $missed,
                'error' => $result->error,
            ]);
            $gaps[] = $missed.' of '.$contacts->count().' trusted contacts could not be texted'
                .($result->error ? ' ('.$result->error.')' : '').'.';
        }
    }

    /** @param  array<int,string>  $gaps */
    private function textStaff(SOSAlert $alert, SmsSender $sms, array &$gaps): void
    {
        $phones = OpsAlertRecipients::phones();
        if ($phones === []) {
            $gaps[] = 'No staff text was sent: the ops_alert_phone setting is empty.';

            return;
        }

        if (! $sms->isConfigured()) {
            $gaps[] = 'No staff text was sent: SMS is not set up.';

            return;
        }

        try {
            $result = $sms->send($phones, $this->staffMessage($alert));
        } catch (\Throwable $e) {
            Log::error('SOS staff text failed', ['alert_id' => $alert->id, 'error' => $e->getMessage()]);
            $gaps[] = 'The staff text failed.';

            return;
        }

        if (count($result->accepted) < count($phones)) {
            $gaps[] = 'The staff text reached '.count($result->accepted).' of '.count($phones).' numbers'
                .($result->error ? ' ('.$result->error.')' : '').'.';
        }
    }

    /** @param  array<int,string>  $gaps */
    private function emailStaff(SOSAlert $alert, array &$gaps): void
    {
        $emails = OpsAlertRecipients::emails();
        if ($emails === []) {
            $gaps[] = 'No staff email was sent: the ops_alert_emails setting is empty.';

            return;
        }

        try {
            Mail::to($emails)->send(SosStaffAlert::forAlert($alert));
        } catch (\Throwable $e) {
            Log::error('SOS staff email failed', [
                'alert_id' => $alert->id,
                'recipients' => count($emails),
                'error' => $e->getMessage(),
            ]);
            $gaps[] = 'The staff email failed to send.';
        }
    }

    private function contactMessage(SOSAlert $alert): string
    {
        $name = trim((string) strtok((string) ($alert->triggeredBy?->full_name ?? ''), ' ')) ?: 'Someone you know';
        $link = rtrim((string) config('app.url'), '/').'/trip/'.$alert->live_link_token;

        return "ErrandGuy SOS: {$name} pressed the emergency button and may need help. "
            ."See where they are: {$link} Call them now. If you can't reach them, call 911.";
    }

    private function staffMessage(SOSAlert $alert): string
    {
        $person = $alert->triggeredBy;
        $role = $alert->triggered_by_role === 'runner' ? 'runner' : 'customer';
        $phone = PhilippinePhone::normalize($person?->phone) ?? ($person?->phone ?: 'no phone');
        $time = ($alert->triggered_at ?? now())->copy()
            ->timezone(config('app.business_timezone', 'Asia/Manila'))
            ->format('g:i A');
        $where = $alert->triggerMapUrl() ?? 'location unknown';

        return "ErrandGuy SOS {$time}: ".($person?->full_name ?: 'A user')." ({$role}, {$phone}), errand "
            .($alert->booking?->booking_number ?? $alert->booking_id).". {$where} Open the admin panel now.";
    }
}
