<?php

namespace App\Http\Requests;

use App\Support\ApiPayload;
use App\Support\ErrorCode;
use App\Support\Messages;
use Illuminate\Contracts\Validation\Validator;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Http\Exceptions\HttpResponseException;

/**
 * Base class for API form requests. Re-parent a FormRequest from
 * `Illuminate\Foundation\Http\FormRequest` to this to get, for free:
 *
 *   • A 422 that emits the standardized {@see ApiPayload} envelope with
 *     `code: VALIDATION_FAILED` — same `message`/`errors` shape the app already
 *     reads, plus `success`/`code`/`meta.request_id`.
 *   • A shared {@see attributes()} map of human field names, so Laravel's
 *     default messages read "The phone number field is required." instead of
 *     "The phone field is required." across every request at once.
 *
 * Subclasses keep their own `rules()`, and any bespoke `messages()` still wins
 * over the defaults. Override {@see attributeOverrides()} for request-specific
 * field names without losing the shared map.
 */
abstract class ApiFormRequest extends FormRequest
{
    /**
     * Render validation failures through the standardized envelope. `errors`
     * and the 422 status are unchanged from Laravel's default, so existing
     * `assertJsonValidationErrors()` assertions keep passing.
     */
    protected function failedValidation(Validator $validator): void
    {
        throw new HttpResponseException(
            response()->json(
                ApiPayload::error(
                    ErrorCode::VALIDATION_FAILED->value,
                    // Lead with the first field error (specific + actionable, and
                    // what the app has always shown), falling back to the generic
                    // line only if somehow empty. Field-level detail is in `errors`.
                    $validator->errors()->first() ?: Messages::for(ErrorCode::VALIDATION_FAILED),
                    $validator->errors()->toArray(),
                ),
                422,
            ),
        );
    }

    /**
     * Human-readable field names shared by every API request. Merged with any
     * per-request overrides. Kept broad on purpose — an unused key is harmless,
     * and one map beats 26 scattered ones.
     *
     * @return array<string,string>
     */
    public function attributes(): array
    {
        return array_merge([
            'phone' => 'phone number',
            'phone_or_email' => 'phone number or email',
            'email' => 'email address',
            'password' => 'password',
            'password_confirmation' => 'password confirmation',
            'amount' => 'amount',
            'payment_method_id' => 'payment method',
            'promo_code' => 'promo code',
            'code' => 'verification code',
            'pickup_address' => 'pickup address',
            'dropoff_address' => 'drop-off address',
            'pickup_phone' => 'pickup contact number',
            'dropoff_phone' => 'drop-off contact number',
            'errand_type_id' => 'errand type',
            'first_name' => 'first name',
            'last_name' => 'last name',
            'full_name' => 'full name',
        ], $this->attributeOverrides());
    }

    /**
     * Request-specific field-name overrides, merged on top of the shared map.
     *
     * @return array<string,string>
     */
    protected function attributeOverrides(): array
    {
        return [];
    }
}
