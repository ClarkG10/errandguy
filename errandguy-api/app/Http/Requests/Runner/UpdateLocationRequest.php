<?php

namespace App\Http\Requests\Runner;

use Illuminate\Foundation\Http\FormRequest;

class UpdateLocationRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'lat' => ['required', 'numeric', 'between:-90,90'],
            'lng' => ['required', 'numeric', 'between:-180,180'],
            // iOS / Android GPS use -1 to mean "unknown" for heading/speed.
            // We accept any numeric here and sanitize in prepareForValidation
            // so callers don't have to special-case the sentinel value.
            'heading' => ['nullable', 'numeric'],
            'speed' => ['nullable', 'numeric'],
            'accuracy' => ['nullable', 'numeric', 'min:0'],
            // Optional: the runner's app passes the active booking id so
            // the location row is written with booking_id immediately,
            // bypassing the 30s server-side cache lookup that used to
            // leave early-match pings tagged NULL and invisible to the
            // customer's realtime subscription. Validated as a UUID; the
            // controller still verifies the runner actually owns it.
            'booking_id' => ['nullable', 'uuid'],
        ];
    }

    protected function prepareForValidation(): void
    {
        $speed = $this->input('speed');
        $heading = $this->input('heading');
        $this->merge([
            'speed' => is_numeric($speed) && $speed < 0 ? null : $speed,
            'heading' => is_numeric($heading) && $heading < 0 ? null : $heading,
        ]);
    }
}
