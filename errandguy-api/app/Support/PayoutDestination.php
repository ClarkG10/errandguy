<?php

namespace App\Support;

use Illuminate\Validation\Rule;

/**
 * Where a payout goes: GCash, Maya or a bank account, with the account
 * number and the account holder's name.
 *
 * Shape (what WalletTransaction::payout_destination stores, encrypted):
 *   channel         'gcash' | 'maya' | 'bank', or 'ewallet' for a runner
 *                   who saved an e-wallet number before the channel was
 *                   recorded (staff pick GCash or Maya when sending)
 *   channel_code    the Xendit Payouts channel (PH_GCASH, PH_PAYMAYA, PH_BDO…)
 *                   or null when staff have to pick it at send time
 *   account_number  mobile number (e-wallet) or account number (bank)
 *   account_name    account holder's name (may be null on older rows)
 *   bank_name       bank channel only
 *
 * The request fields are the same everywhere a destination is entered —
 * customer withdrawals, a runner's payout method and account deletion:
 * channel, account_number, account_name and (bank only) bank_name.
 */
final class PayoutDestination
{
    public const EWALLET_CHANNEL_CODES = [
        'gcash' => 'PH_GCASH',
        'maya' => 'PH_PAYMAYA',
    ];

    /**
     * Xendit PH payout channel codes staff can send to. Verify the exact set
     * the account supports via Xendit's dashboard / GET /payout_channels.
     */
    public const CHANNEL_CODES = [
        'PH_GCASH' => 'GCash',
        'PH_PAYMAYA' => 'Maya',
        'PH_BDO' => 'BDO',
        'PH_BPI' => 'BPI',
        'PH_UBP' => 'UnionBank',
        'PH_METROBANK' => 'Metrobank',
        'PH_LANDBANK' => 'Landbank',
        'PH_PNB' => 'PNB',
        'PH_RCBC' => 'RCBC',
        'PH_SECURITY' => 'Security Bank',
        'PH_CHINABANK' => 'China Bank',
        'PH_EASTWEST' => 'EastWest',
    ];

    private const PH_MOBILE = '/^(\+63|0)9\d{9}$/';

    /**
     * Validation rules for the four destination fields.
     *
     * @param  mixed  $channel    the submitted channel, which decides how the
     *                            account number is checked
     * @param  bool   $allowBank  customers withdraw to GCash or Maya only
     * @param  bool   $required   false when the destination is optional (account
     *                            deletion with an empty wallet)
     * @return array<string, array<int, mixed>>
     */
    public static function rules(mixed $channel, bool $allowBank = true, bool $required = true): array
    {
        $channels = $allowBank ? ['gcash', 'maya', 'bank'] : ['gcash', 'maya'];
        $presence = $required ? 'required' : 'required_with:channel';

        return [
            'channel' => [$required ? 'required' : 'nullable', 'string', Rule::in($channels)],
            'account_number' => [
                $presence,
                'nullable',
                'string',
                'max:30',
                function (string $attribute, mixed $value, \Closure $fail) use ($channel): void {
                    $value = (string) $value;
                    if (in_array($channel, ['gcash', 'maya'], true) && ! preg_match(self::PH_MOBILE, $value)) {
                        $fail('Enter the GCash or Maya mobile number, e.g. 09171234567.');
                    } elseif ($channel === 'bank' && ! preg_match('/^\d{6,20}$/', self::digits($value))) {
                        $fail('Enter the bank account number (digits only).');
                    }
                },
            ],
            'account_name' => [$presence, 'nullable', 'string', 'max:100'],
            'bank_name' => ['required_if:channel,bank', 'nullable', 'string', 'max:100'],
        ];
    }

    /** Validation copy shared by every endpoint that takes a destination. */
    public static function messages(bool $allowBank = true): array
    {
        $choose = $allowBank
            ? 'Choose where to send the money: GCash, Maya or a bank account.'
            : 'Choose where to send the money: GCash or Maya.';

        return [
            'channel.in' => $choose,
            'channel.required' => $choose,
            'account_number.required' => 'Enter the account number to send the money to.',
            'account_number.required_with' => 'Enter the account number to send the money to.',
            'account_name.required' => 'Enter the account holder’s name.',
            'account_name.required_with' => 'Enter the account holder’s name.',
            'bank_name.required_if' => 'Enter the bank’s name.',
        ];
    }

    /**
     * Build a destination from validated request input.
     *
     * @param  array<string, mixed>  $input  channel, account_number, account_name, bank_name
     * @return array<string, ?string>
     */
    public static function fromInput(array $input): array
    {
        return self::make(
            (string) $input['channel'],
            (string) $input['account_number'],
            isset($input['account_name']) ? (string) $input['account_name'] : null,
            isset($input['bank_name']) ? (string) $input['bank_name'] : null,
        );
    }

    /**
     * @return array<string, ?string>
     */
    public static function make(
        string $channel,
        string $accountNumber,
        ?string $accountName = null,
        ?string $bankName = null,
        ?string $channelCode = null,
    ): array {
        $isEwallet = in_array($channel, ['gcash', 'maya', 'ewallet'], true);
        $bankName = $channel === 'bank' ? (trim((string) $bankName) ?: null) : null;

        return [
            'channel' => $channel,
            'channel_code' => $channelCode
                ?? self::EWALLET_CHANNEL_CODES[$channel]
                ?? ($bankName !== null ? self::bankChannelCode($bankName) : null),
            'account_number' => $isEwallet ? self::normalizeMobile($accountNumber) : self::digits($accountNumber),
            'account_name' => trim((string) $accountName) ?: null,
            'bank_name' => $bankName,
        ];
    }

    /** "GCash •••• 4567", "BDO •••• 1234" — never more than the last four digits. */
    public static function label(?array $destination): string
    {
        if (! $destination || blank($destination['account_number'] ?? null)) {
            return 'bank or e-wallet';
        }

        $name = match ($destination['channel'] ?? null) {
            'gcash' => 'GCash',
            'maya' => 'Maya',
            'bank' => $destination['bank_name'] ?? 'bank account',
            default => self::CHANNEL_CODES[$destination['channel_code'] ?? ''] ?? 'e-wallet',
        };

        return $name.' •••• '.substr(self::digits((string) $destination['account_number']), -4);
    }

    /** The Xendit code for a bank, matched on its name; null if unknown. */
    public static function bankChannelCode(string $bankName): ?string
    {
        $needle = strtolower(trim($bankName));
        foreach (self::CHANNEL_CODES as $code => $label) {
            if (! in_array($code, self::EWALLET_CHANNEL_CODES, true) && strtolower($label) === $needle) {
                return $code;
            }
        }

        return null;
    }

    /** The app-facing channel for a Xendit code (PH_GCASH → gcash). */
    public static function channelForCode(?string $channelCode): ?string
    {
        $channel = array_search($channelCode, self::EWALLET_CHANNEL_CODES, true);

        return $channel === false ? null : $channel;
    }

    private static function normalizeMobile(string $number): string
    {
        $number = preg_replace('/[\s-]/', '', $number) ?? '';

        return str_starts_with($number, '+63') ? '0'.substr($number, 3) : $number;
    }

    private static function digits(string $value): string
    {
        return preg_replace('/\D/', '', $value) ?? '';
    }
}
