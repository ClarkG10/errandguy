<?php

namespace App\Http\Requests\Booking;

use Illuminate\Foundation\Http\FormRequest;

/**
 * Customer-side full replacement of a booking's shopping checklist.
 *
 * The whole list is sent under `items`; each element only needs a `name`
 * (qty defaults to 1). Any `id` / `checked` / `checked_at` fields are
 * ignored here — the controller normalizes those so the customer can never
 * forge a runner's tick state.
 */
class ShoppingItemsRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'items' => ['present', 'array', 'max:100'],
            'items.*.name' => ['required', 'string', 'max:200'],
            'items.*.qty' => ['nullable', 'integer', 'min:1', 'max:999'],
        ];
    }

    public function messages(): array
    {
        return [
            'items.present' => 'A shopping list (items) is required.',
            'items.*.name.required' => 'Every shopping item needs a name.',
        ];
    }
}
