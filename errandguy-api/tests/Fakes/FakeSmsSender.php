<?php

namespace Tests\Fakes;

use App\Services\Sms\SmsResult;
use App\Services\Sms\SmsSender;
use App\Support\PhilippinePhone;

/**
 * An SMS sender for tests: sends nothing, records every call, and accepts
 * every valid number except the ones listed in $reject.
 */
class FakeSmsSender implements SmsSender
{
    /** @var array<int, array{numbers: array<int,string>, message: string}> */
    public array $sent = [];

    /**
     * @param  array<int,string>  $reject  numbers the "provider" refuses
     */
    public function __construct(
        private bool $configured = true,
        private array $reject = [],
        private bool $throw = false,
    ) {}

    public function isConfigured(): bool
    {
        return $this->configured;
    }

    public function send(array $numbers, string $message): SmsResult
    {
        if ($this->throw) {
            throw new \RuntimeException('provider exploded');
        }

        $this->sent[] = ['numbers' => $numbers, 'message' => $message];

        $rejected = array_map(fn ($n) => PhilippinePhone::normalize($n), $this->reject);
        $accepted = [];
        foreach ($numbers as $number) {
            $normalised = PhilippinePhone::normalize($number);
            if ($normalised !== null && ! in_array($normalised, $rejected, true)) {
                $accepted[] = $normalised;
            }
        }

        return new SmsResult(array_values(array_unique($accepted)), $accepted === [] ? 'rejected' : null);
    }

    /** Every number any call was sent to, normalised. */
    public function recipients(): array
    {
        return collect($this->sent)
            ->flatMap(fn ($call) => $call['numbers'])
            ->map(fn ($n) => PhilippinePhone::normalize($n))
            ->unique()
            ->values()
            ->all();
    }
}
