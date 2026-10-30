<?php

namespace App\Services\Sms;

/**
 * Sends one text message to one or more Philippine mobile numbers.
 *
 * Bound in AppServiceProvider: SemaphoreSmsSender once SEMAPHORE_API_KEY is
 * set, LogSmsSender (sends nothing) until then. Callers decide what to tell
 * people from the returned SmsResult and must never assume a send worked.
 */
interface SmsSender
{
    /** True when a real SMS provider is set up and texts can actually go out. */
    public function isConfigured(): bool;

    /**
     * @param  array<int,string>  $numbers  any accepted Philippine format
     *                                      (+639…, 639…, 09…, 9…)
     */
    public function send(array $numbers, string $message): SmsResult;
}
