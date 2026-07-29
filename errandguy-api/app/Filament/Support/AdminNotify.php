<?php

namespace App\Filament\Support;

use App\Support\AdminActivity;
use Filament\Notifications\Notification;
use Illuminate\Database\Eloquent\Model;
use Throwable;

/**
 * Standardized admin (Filament) feedback. Replaces the scattered
 * `Notification::make()->title(...)->success()->send()` calls with helpers that:
 *
 *   • always carry RECORD CONTEXT in the body (booking #, name, ₱amount) so an
 *     admin sees exactly which record an action affected;
 *   • enforce a consistent ERROR shape — a fixed human title with the exception
 *     detail in the BODY, never a raw `$e->getMessage()` in the title;
 *   • optionally PAIR the notification with an {@see AdminActivity::log} audit
 *     entry in one call, so a sensitive action both notifies and audits together.
 *
 * Migration note: when a call site adopts `success(audit: ...)`, delete its now
 * -redundant standalone `AdminActivity::log(...)` line, or the action double-logs
 * (and double-flushes AdminCache).
 */
class AdminNotify
{
    /**
     * Success notification, optionally paired with an audit-log entry.
     *
     * @param  array<string,int|float|string|null>  $context  Label => value pairs shown in the body,
     *                                                         e.g. ['Booking' => 'EG-1023', 'Amount' => '₱450.00'].
     * @param  string|null  $audit  When set, also record AdminActivity::log($audit, $subject, $properties).
     * @param  array<string,mixed>  $properties  Audit properties (reason, amount, etc.).
     * @param  string|null  $note  Optional next-step sentence appended after the context,
     *                             e.g. "It will show as completed once Xendit confirms."
     */
    public static function success(
        string $title,
        ?Model $subject = null,
        array $context = [],
        ?string $audit = null,
        array $properties = [],
        ?string $note = null,
    ): void {
        $body = self::describe($context);
        if ($note !== null && $note !== '') {
            $body = $body !== '' ? $body.' — '.$note : $note;
        }

        Notification::make()
            ->title($title)
            ->body($body !== '' ? $body : null)
            ->success()
            ->send();

        if ($audit !== null) {
            AdminActivity::log($audit, $subject, $properties);
        }
    }

    /**
     * Error notification with a consistent shape: a fixed, human title and the
     * cause (exception message or string) in the body — never in the title.
     *
     * @param  array<string,int|float|string|null>  $context
     */
    public static function error(
        string $title,
        Throwable|string|null $reason = null,
        ?Model $subject = null,
        array $context = [],
    ): void {
        $reasonText = $reason instanceof Throwable ? $reason->getMessage() : (string) ($reason ?? '');
        $body = trim(self::describe($context).($reasonText !== '' ? ' '.$reasonText : ''));

        Notification::make()
            ->title($title)
            ->body($body !== '' ? $body : null)
            ->danger()
            ->send();
    }

    public static function warning(string $title, ?string $body = null): void
    {
        Notification::make()
            ->title($title)
            ->body($body)
            ->warning()
            ->send();
    }

    /**
     * Format record context as "Booking: EG-1023 · Amount: ₱450.00". Public so
     * it can be unit-tested without booting Filament. Null/empty values are
     * dropped so a partial context still reads cleanly.
     *
     * @param  array<string,int|float|string|null>  $context
     */
    public static function describe(array $context): string
    {
        $parts = [];
        foreach ($context as $label => $value) {
            if ($value === null || $value === '') {
                continue;
            }
            $parts[] = "{$label}: {$value}";
        }

        return implode(' · ', $parts);
    }
}
